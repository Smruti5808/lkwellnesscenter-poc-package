// Per-collection access and behaviour rules for the generic CRUD API.
import * as S from '../shared/schemas';
import type { AppointmentStatus, CollectionName, Data } from '../shared/schemas';
import { istDate, formatDateTime } from '../shared/time';
import { accountOfPatient, conflict, forbidden, invalid, notFound, notify, nowIso, userOfDoctor, type Ctx } from './context';
import { canAccessPatient, doctorCanAccess, hasCareRelationship, managedPatientIds } from './access';
import { careSummary, deletePatients } from './clinical';
import { validateSlot } from './scheduling';
import type { AnyRow, Op, Rule } from './crud';
import { getStorage } from './storage';

const str = (row: AnyRow, key: string) => row[key] as string | undefined;
const isPatient = (ctx: Ctx) => ctx.user.role === 'patient';
const isDoctor = (ctx: Ctx) => ctx.user.role === 'doctor' && ctx.doctor?.verification === 'verified';
const ownDoctor = (ctx: Ctx, row: AnyRow, key = 'doctorId') => !!ctx.doctor && str(row, key) === ctx.doctor.id;
const patientName = (data: Data, id?: string) => data.patients.find(p => p.id === id)?.name ?? 'a patient';
const doctorName = (data: Data, id?: string) => data.doctors.find(d => d.id === id)?.name ?? 'a doctor';

/** Records that belong to one patient: health profile, vitals, documents, consents, privacy settings. */
function patientOwned(input: Rule['input'], opts: { doctorRead?: boolean; doctorWrite?: boolean; stamp?: boolean } = {}): Rule {
  const { doctorRead = true, doctorWrite = true, stamp = false } = opts;
  return {
    input,
    visible: (data, ctx, row) => canAccessPatient(data, ctx, str(row, 'patientId')) && (isPatient(ctx) || doctorRead),
    allow: (data, ctx, row) => canAccessPatient(data, ctx, str(row, 'patientId')) && (isPatient(ctx) || doctorWrite),
    server: stamp ? (_d, ctx, _row, op, existing) => ({ recordedBy: op === 'create' ? ctx.user.id : existing?.recordedBy }) : undefined,
  };
}

/** Doctor-owned setup records. `publicRead` lets patients see them (e.g. appointment types for booking). */
function doctorOwned(input: Rule['input'], publicRead: boolean): Rule {
  return {
    input,
    visible: (_d, ctx, row) => publicRead || ownDoctor(ctx, row),
    allow: (_d, ctx, row) => ctx.user.role === 'doctor' && ownDoctor(ctx, row),
    server: (_d, ctx, _row, op, existing) => ({ doctorId: op === 'create' ? ctx.doctor?.id : existing?.doctorId }),
  };
}

/** Clinical work authored by a doctor: consultations, prescriptions, orders. Patients see only `patientVisible` rows. */
function doctorAuthored(input: Rule['input'], patientVisible: (row: AnyRow) => boolean): Rule {
  return {
    input,
    visible: (data, ctx, row) => isPatient(ctx) ? ctx.patientIds.includes(str(row, 'patientId')!) && patientVisible(row) : ownDoctor(ctx, row) || doctorCanAccess(data, ctx, str(row, 'patientId')!),
    allow: (data, ctx, row) => isDoctor(ctx) && ownDoctor(ctx, row) && doctorCanAccess(data, ctx, str(row, 'patientId')!),
  };
}

function checkConsultationLink(data: Data, row: AnyRow) {
  const consultationId = str(row, 'consultationId');
  if (consultationId && !data.consultations.some(c => c.id === consultationId && c.patientId === row.patientId && c.doctorId === row.doctorId)) {
    throw invalid('The linked consultation does not belong to this patient.', { consultationId: ['Unknown consultation.'] });
  }
}

// ---- Appointments: booking, rescheduling, status changes ------------------------------------------------------

const PATIENT_STATUS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = { cancelled: ['requested', 'confirmed'], 'checked-in': ['confirmed'] };
const DOCTOR_STATUS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  confirmed: ['requested', 'no-show'], rejected: ['requested'], cancelled: ['requested', 'confirmed', 'checked-in'],
  'checked-in': ['confirmed'], 'in-consultation': ['confirmed', 'checked-in'], completed: ['confirmed', 'checked-in', 'in-consultation'], 'no-show': ['confirmed', 'checked-in'],
};

const appointments: Rule = {
  input: S.appointmentInput,
  visible: (_d, ctx, row) => isPatient(ctx) ? ctx.patientIds.includes(str(row, 'patientId')!) : ownDoctor(ctx, row),
  allow: (data, ctx, row, op) => {
    if (isPatient(ctx)) return ctx.patientIds.includes(str(row, 'patientId')!) && (op !== 'delete' || row.status !== 'completed');
    if (!ownDoctor(ctx, row)) return false;
    // Doctors book follow-ups only for patients already in their care.
    return op === 'create' ? doctorCanAccess(data, ctx, str(row, 'patientId')!) : op !== 'delete' || row.status !== 'completed';
  },
  server: (data, ctx, row, op, existing) => {
    const now = nowIso();
    if (op === 'create') {
      const slot = validateSlot(data, str(row, 'doctorId')!, str(row, 'typeId')!, str(row, 'start')!);
      return { start: new Date(str(row, 'start')!).toISOString(), ...slot, status: isPatient(ctx) ? 'requested' : 'confirmed', bookedBy: ctx.user.id };
    }
    const fields: Record<string, unknown> = {};
    const moved = row.start !== existing!.start && new Date(str(row, 'start')!).toISOString() !== existing!.start || row.typeId !== existing!.typeId;
    if (moved) {
      if (['completed', 'cancelled', 'rejected', 'no-show'].includes(str(existing!, 'status')!)) throw conflict('This appointment can no longer be rescheduled.');
      Object.assign(fields, { start: new Date(str(row, 'start')!).toISOString(), ...validateSlot(data, str(row, 'doctorId')!, str(row, 'typeId')!, str(row, 'start')!, existing!.id), status: isPatient(ctx) ? 'requested' : 'confirmed' });
    }
    const status = (fields.status ?? row.status) as AppointmentStatus;
    if (!moved && status !== existing!.status) {
      const from = existing!.status as AppointmentStatus;
      const allowedFrom = (isPatient(ctx) ? PATIENT_STATUS : DOCTOR_STATUS)[status];
      if (!allowedFrom?.includes(from)) throw conflict(`Cannot change an appointment from ${from} to ${status}.`, 'INVALID_STATUS');
      if (status === 'checked-in' && istDate(str(existing!, 'start')!) !== istDate()) throw conflict('Check-in opens on the day of the appointment.', 'INVALID_STATUS');
      if (status === 'checked-in') fields.checkedInAt = now;
      if (status === 'in-consultation') fields.startedAt = now;
      if (status === 'completed') Object.assign(fields, { startedAt: existing!.startedAt ?? now, endedAt: now });
    }
    return fields;
  },
  validate: (_d, _ctx, row, op, existing) => {
    if (op === 'update' && (row.patientId !== existing!.patientId || row.doctorId !== existing!.doctorId)) throw invalid('Book a new appointment to change the patient or doctor.');
  },
  after: (data, ctx, row, op, existing) => {
    const when = formatDateTime(str(row, 'start'));
    const patientAccount = accountOfPatient(data, str(row, 'patientId')!);
    const doctorAccount = userOfDoctor(data, str(row, 'doctorId')!);
    if (op === 'create' && isPatient(ctx)) notify(data, doctorAccount, 'New booking request', `${patientName(data, str(row, 'patientId'))} requested ${when}.`, '/doctor/schedule');
    if (op === 'create' && !isPatient(ctx)) notify(data, patientAccount, 'Follow-up booked', `${doctorName(data, str(row, 'doctorId'))} booked a follow-up on ${when}.`, '/patient/appointments');
    if (op === 'update' && existing!.start !== row.start) notify(data, isPatient(ctx) ? doctorAccount : patientAccount, 'Appointment rescheduled', `New time: ${when}.`, isPatient(ctx) ? '/doctor/schedule' : '/patient/appointments');
    else if (op === 'update' && existing!.status !== row.status) {
      const target = isPatient(ctx) ? doctorAccount : patientAccount;
      notify(data, target, `Appointment ${row.status}`, `${isPatient(ctx) ? patientName(data, str(row, 'patientId')) : doctorName(data, str(row, 'doctorId'))} · ${when}${row.cancelReason ? ` · ${row.cancelReason}` : ''}`, isPatient(ctx) ? '/doctor' : '/patient/appointments');
      if (row.status === 'confirmed') notify(data, patientAccount, 'Reminder set', `We will remind you before your visit on ${when}.`, '/patient/appointments', `reminder:${row.id}:${row.start}`);
    }
  },
};

// ---- The rules table ------------------------------------------------------------------------------------------

export const RULES: Partial<Record<CollectionName, Rule>> = {
  users: {
    input: S.userInput,
    visible: (_d, ctx, row) => ctx.user.role === 'admin' || row.id === ctx.user.id,
    allow: (_d, ctx, row, op) => ctx.user.role === 'admin' ? !(op === 'delete' && row.id === ctx.user.id) : op === 'update' && row.id === ctx.user.id,
    server: (_d, ctx, row, op, existing) => op === 'create' ? {} : {
      role: existing!.role, patientId: existing!.patientId, doctorId: existing!.doctorId,
      active: ctx.user.role === 'admin' && row.id !== ctx.user.id ? row.active : existing!.active,
    },
    validate: (data, _ctx, row, op) => {
      if (op === 'create' && row.role !== 'admin') throw invalid('Patients and doctors join through registration.', { role: ['Only admin accounts can be created here.'] });
      if (op !== 'delete' && data.users.some(u => u.id !== row.id && (u.email.toLowerCase() === str(row, 'email')!.toLowerCase() || (row.phone && u.phone === row.phone)))) throw conflict('Another account uses this email or phone.');
      if (op === 'delete' && row.doctorId && [data.consultations, data.prescriptions, data.orders].some(rows => rows.some(r => r.doctorId === row.doctorId))) throw conflict('This doctor has clinical records. Deactivate the account instead.');
    },
    after: (data, _ctx, row, op) => {
      if (op !== 'delete') return;
      data.sessions = data.sessions.filter(s => s.userId !== row.id);
      if (row.patientId) deletePatients(data, managedPatientIds(data, row as unknown as S.User));
      if (row.doctorId) {
        const id = row.doctorId;
        data.doctors = data.doctors.filter(d => d.id !== id);
        data.appointmentTypes = data.appointmentTypes.filter(r => r.doctorId !== id); data.schedules = data.schedules.filter(r => r.doctorId !== id);
        data.leaves = data.leaves.filter(r => r.doctorId !== id); data.favorites = data.favorites.filter(r => r.doctorId !== id);
        data.appointments = data.appointments.filter(r => r.doctorId !== id); data.messages = data.messages.filter(r => r.doctorId !== id);
      }
      data.notifications = data.notifications.filter(n => n.userId !== row.id);
    },
  },

  patients: {
    input: S.patientInput,
    visible: (data, ctx, row) => canAccessPatient(data, ctx, row.id),
    allow: (data, ctx, row, op) => op === 'update' ? canAccessPatient(data, ctx, row.id) : isPatient(ctx) && !!ctx.user.patientId && row.guardianPatientId === ctx.user.patientId,
    server: (_d, ctx, _row, op, existing) => op === 'create' ? { guardianPatientId: ctx.user.patientId } : { guardianPatientId: existing!.guardianPatientId, userId: existing!.userId },
    after: (data, _ctx, row, op) => { if (op === 'delete') deletePatients(data, [row.id]); },
    patientOf: row => row.id,
  },

  consents: patientOwned(S.consentInput, { doctorWrite: false }),
  conditions: patientOwned(S.conditionInput, { stamp: true }),
  allergies: patientOwned(S.allergyInput, { stamp: true }),
  medications: patientOwned(S.medicationInput, { stamp: true }),
  vitals: patientOwned(S.vitalInput, { stamp: true }),
  accessBlocks: {
    ...patientOwned(S.accessBlockInput, { doctorRead: false, doctorWrite: false }),
    validate: (data, _ctx, row, op) => {
      if (op === 'delete') return;
      if (!data.doctors.some(d => d.id === row.doctorId)) throw invalid('Choose a doctor.', { doctorId: ['Unknown doctor.'] });
      if (data.accessBlocks.some(b => b.id !== row.id && b.patientId === row.patientId && b.doctorId === row.doctorId)) throw conflict('This doctor is already blocked.');
    },
  },
  doseLogs: {
    ...patientOwned(S.doseLogInput, { doctorWrite: false }),
    validate: (data, _ctx, row, op) => {
      if (op === 'delete') return;
      if (!data.medications.some(m => m.id === row.medicationId && m.patientId === row.patientId)) throw invalid('Unknown medication.', { medicationId: ['Unknown medication.'] });
      if (data.doseLogs.some(l => l.id !== row.id && l.medicationId === row.medicationId && l.date === row.date)) throw conflict('This day is already recorded.');
    },
  },
  documents: {
    ...patientOwned(S.documentInput),
    creatable: false, // created through the upload endpoint
    after: async (_d, _ctx, row, op) => {
      if (op === 'delete' && row.storage === 'upload') await (await getStorage()).deleteUpload(str(row, 'fileName')!);
    },
  },

  doctors: {
    input: S.doctorInput, creatable: false, deletable: false,
    visible: (data, ctx, row) => ctx.user.role === 'admin' || ownDoctor(ctx, row, 'id') || (row.verification === 'verified' && !!data.users.find(u => u.id === row.userId)?.active),
    allow: (_d, ctx, row) => ctx.user.role === 'admin' || ownDoctor(ctx, row, 'id'),
    server: (_d, _ctx, _row, _op, existing) => ({ userId: existing!.userId, verification: existing!.verification }),
  },
  appointmentTypes: doctorOwned(S.appointmentTypeInput, true),
  schedules: doctorOwned(S.scheduleInput, true),
  leaves: doctorOwned(S.leaveInput, false),
  favorites: doctorOwned(S.favoriteInput, false),

  appointments,

  consultations: {
    ...doctorAuthored(S.consultationInput, row => row.status === 'final'),
    server: (data, ctx, row, op, existing) => {
      const fields: Record<string, unknown> = { doctorId: op === 'create' ? ctx.doctor?.id : existing!.doctorId };
      if (row.status === 'final' && !row.careSummary) fields.careSummary = careSummary(data, { ...row, ...fields } as unknown as S.Consultation);
      return fields;
    },
    validate: (data, _ctx, row, op) => {
      const appointmentId = str(row, 'appointmentId');
      if (op !== 'delete' && appointmentId && !data.appointments.some(a => a.id === appointmentId && a.patientId === row.patientId && a.doctorId === row.doctorId)) {
        throw invalid('The appointment does not match this patient.', { appointmentId: ['Unknown appointment.'] });
      }
    },
    after: (data, _ctx, row, op, existing) => {
      if (row.status === 'final' && (op === 'create' || existing?.status !== 'final')) notify(data, accountOfPatient(data, str(row, 'patientId')!), 'Visit summary available', `${doctorName(data, str(row, 'doctorId'))} shared your care summary.`, '/patient/records');
      if (op === 'delete') {
        for (const rows of [data.prescriptions, data.orders]) for (const r of rows) if (r.consultationId === row.id) delete r.consultationId;
      }
    },
  },

  prescriptions: {
    ...doctorAuthored(S.prescriptionInput, row => row.status === 'signed'),
    // Any edit invalidates the signature; the doctor signs again through /prescriptions/{id}/sign.
    server: (_d, ctx, _row, op, existing) => ({ doctorId: op === 'create' ? ctx.doctor?.id : existing!.doctorId, status: 'draft', signedAt: undefined, signature: undefined, acknowledgedWarnings: undefined }),
    validate: (data, _ctx, row, op) => { if (op !== 'delete') checkConsultationLink(data, row); },
  },

  orders: {
    ...doctorAuthored(S.orderInput, () => true),
    server: (_d, ctx, row, op, existing) => ({
      doctorId: op === 'create' ? ctx.doctor?.id : existing!.doctorId,
      resultedAt: row.status === 'resulted' ? existing?.resultedAt ?? nowIso() : undefined,
    }),
    validate: (data, _ctx, row, op) => { if (op !== 'delete') checkConsultationLink(data, row); },
    after: (data, _ctx, row, op, existing) => {
      if (op === 'delete' || row.status !== 'resulted' || existing?.status === 'resulted') return;
      notify(data, accountOfPatient(data, str(row, 'patientId')!), 'New result available', `${row.test} has a result.`, '/patient/records');
      if (row.abnormal) notify(data, userOfDoctor(data, str(row, 'doctorId')!), `Abnormal result: ${patientName(data, str(row, 'patientId'))}`, `${row.test}: ${row.result ?? ''} ${row.unit ?? ''}${row.referenceRange ? ` (ref ${row.referenceRange})` : ''}`.trim(), `/doctor/patients/${row.patientId}`);
    },
  },

  messages: {
    input: S.messageInput, transient: ['read'],
    visible: (_d, ctx, row) => isPatient(ctx) ? ctx.patientIds.includes(str(row, 'patientId')!) : ownDoctor(ctx, row),
    allow: (data, ctx, row, op) => {
      const mine = row.senderUserId === ctx.user.id;
      if (op === 'delete') return mine;
      if (isPatient(ctx)) return ctx.patientIds.includes(str(row, 'patientId')!) && hasCareRelationship(data, str(row, 'doctorId')!, str(row, 'patientId')!) && !data.accessBlocks.some(b => b.patientId === row.patientId && b.doctorId === row.doctorId);
      return ownDoctor(ctx, row) && doctorCanAccess(data, ctx, str(row, 'patientId')!);
    },
    server: (_d, ctx, row, op, existing) => {
      if (op === 'create') return { sender: isPatient(ctx) ? 'patient' : 'doctor', senderUserId: ctx.user.id };
      if (row.body !== existing!.body && existing!.senderUserId !== ctx.user.id) throw forbidden('Only the sender can edit a message.');
      const isRecipient = existing!.senderUserId !== ctx.user.id;
      return { sender: existing!.sender, senderUserId: existing!.senderUserId, readAt: isRecipient && row.read !== undefined ? (row.read ? existing!.readAt ?? nowIso() : undefined) : existing!.readAt };
    },
    validate: (_d, _ctx, row, op, existing) => { if (op === 'update' && (row.patientId !== existing!.patientId || row.doctorId !== existing!.doctorId)) throw invalid('A message cannot move to another conversation.'); },
    after: (data, ctx, row, op) => {
      if (op !== 'create') return;
      if (isPatient(ctx)) notify(data, userOfDoctor(data, str(row, 'doctorId')!), `Message from ${patientName(data, str(row, 'patientId'))}`, str(row, 'body')!.slice(0, 120), '/doctor/messages');
      else notify(data, accountOfPatient(data, str(row, 'patientId')!), `Message from ${doctorName(data, str(row, 'doctorId'))}`, str(row, 'body')!.slice(0, 120), '/patient/messages');
    },
  },

  referrals: {
    input: S.referralInput,
    visible: (_d, ctx, row) => isPatient(ctx) ? ctx.patientIds.includes(str(row, 'patientId')!) : ownDoctor(ctx, row, 'fromDoctorId') || ownDoctor(ctx, row, 'toDoctorId'),
    allow: (data, ctx, row, op) => {
      if (!isDoctor(ctx)) return false;
      if (op === 'create') return ownDoctor(ctx, row, 'fromDoctorId') && doctorCanAccess(data, ctx, str(row, 'patientId')!);
      return op === 'delete' ? ownDoctor(ctx, row, 'fromDoctorId') : ownDoctor(ctx, row, 'fromDoctorId') || ownDoctor(ctx, row, 'toDoctorId');
    },
    server: (_d, ctx, row, op, existing) => {
      if (op === 'create') return { fromDoctorId: ctx.doctor?.id, status: 'sent' };
      const isReceiver = existing!.toDoctorId === ctx.doctor?.id;
      if (row.status !== existing!.status && !isReceiver) throw forbidden('Only the receiving doctor can change the referral status.');
      if ((row.reason !== existing!.reason || row.toDoctorId !== existing!.toDoctorId || row.patientId !== existing!.patientId) && existing!.fromDoctorId !== ctx.doctor?.id) throw forbidden('Only the referring doctor can edit the referral.');
      return { fromDoctorId: existing!.fromDoctorId };
    },
    validate: (data, _ctx, row, op) => {
      if (op === 'delete') return;
      const to = data.doctors.find(d => d.id === row.toDoctorId);
      if (!to || to.verification !== 'verified' || to.id === row.fromDoctorId) throw invalid('Choose another verified doctor.', { toDoctorId: ['Choose another verified doctor.'] });
    },
    after: (data, _ctx, row, op, existing) => {
      if (op === 'create') {
        notify(data, userOfDoctor(data, str(row, 'toDoctorId')!), `New referral from ${doctorName(data, str(row, 'fromDoctorId'))}`, `${patientName(data, str(row, 'patientId'))}: ${row.reason}`, '/doctor/referrals');
        notify(data, accountOfPatient(data, str(row, 'patientId')!), 'You have been referred', `${doctorName(data, str(row, 'fromDoctorId'))} referred you to ${doctorName(data, str(row, 'toDoctorId'))}.`, '/patient/records');
      } else if (op === 'update' && row.status !== existing!.status) {
        notify(data, userOfDoctor(data, str(row, 'fromDoctorId')!), `Referral ${row.status}`, `${doctorName(data, str(row, 'toDoctorId'))} · ${patientName(data, str(row, 'patientId'))}`, '/doctor/referrals');
      }
    },
  },

  feedback: {
    input: S.feedbackInput,
    visible: (_d, ctx, row) => ctx.user.role === 'admin' || (isPatient(ctx) ? ctx.patientIds.includes(str(row, 'patientId')!) : ownDoctor(ctx, row)),
    allow: (_d, ctx, row) => isPatient(ctx) && ctx.patientIds.includes(str(row, 'patientId')!),
    server: (data, _ctx, row, op, existing) => {
      if (op !== 'create') {
        if (row.appointmentId !== existing!.appointmentId) throw invalid('Feedback cannot move to another appointment.');
        return { patientId: existing!.patientId, doctorId: existing!.doctorId };
      }
      const appointment = data.appointments.find(a => a.id === row.appointmentId);
      if (!appointment) throw notFound();
      return { patientId: appointment.patientId, doctorId: appointment.doctorId };
    },
    validate: (data, _ctx, row, op) => {
      if (op !== 'create') return;
      if (data.appointments.find(a => a.id === row.appointmentId)?.status !== 'completed') throw conflict('Feedback opens after a completed visit.');
      if (data.feedback.some(f => f.appointmentId === row.appointmentId)) throw conflict('Feedback for this visit already exists. Edit it instead.');
    },
  },

  notifications: {
    input: S.notificationInput, creatable: false, transient: ['read'],
    visible: (_d, ctx, row) => row.userId === ctx.user.id,
    allow: (_d, ctx, row) => row.userId === ctx.user.id,
    server: (_d, _ctx, row, _op, existing) => ({ readAt: row.read ? existing?.readAt ?? nowIso() : undefined }),
  },

  audit: {
    deletable: false,
    visible: (_d, ctx, row) => ctx.user.role === 'admin' || (isPatient(ctx) && !!row.patientId && ctx.patientIds.includes(str(row, 'patientId')!)),
    allow: () => false,
  },
};

export function ruleFor(name: string): Rule {
  const rule = RULES[name as CollectionName];
  if (!rule) throw notFound();
  return rule;
}
export type { Op };
