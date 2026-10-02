// Who may see and change which patient's records.
//  - Patients manage their own record and their dependents' records.
//  - Doctors (verified only) see a patient when they have a care relationship — an appointment, a referral,
//    or clinical work they authored — unless the patient has blocked them in privacy settings.
//  - Admins manage users and doctors but never see clinical records.
import type { Data, User } from '../shared/schemas';
import type { Ctx } from './context';

export function managedPatientIds(data: Data, user: User): string[] {
  if (user.role !== 'patient' || !user.patientId) return [];
  return [user.patientId, ...data.patients.filter(p => p.guardianPatientId === user.patientId).map(p => p.id)];
}

export function hasCareRelationship(data: Data, doctorId: string, patientId: string): boolean {
  return data.appointments.some(a => a.doctorId === doctorId && a.patientId === patientId && a.status !== 'rejected' && a.status !== 'cancelled')
    || data.referrals.some(r => r.patientId === patientId && r.status !== 'declined' && (r.toDoctorId === doctorId || r.fromDoctorId === doctorId))
    || data.consultations.some(c => c.doctorId === doctorId && c.patientId === patientId);
}

export function doctorCanAccess(data: Data, ctx: Ctx, patientId: string): boolean {
  const doctor = ctx.doctor;
  if (!doctor || doctor.verification !== 'verified' || !data.patients.some(p => p.id === patientId)) return false;
  if (data.accessBlocks.some(b => b.patientId === patientId && b.doctorId === doctor.id)) return false;
  return hasCareRelationship(data, doctor.id, patientId);
}

/** Read and write access to a patient's own records (profile, history, vitals, documents...). */
export function canAccessPatient(data: Data, ctx: Ctx, patientId: string | undefined): boolean {
  if (!patientId) return false;
  if (ctx.user.role === 'patient') return ctx.patientIds.includes(patientId);
  if (ctx.user.role === 'doctor') return doctorCanAccess(data, ctx, patientId);
  return false;
}

export function accessiblePatientIds(data: Data, ctx: Ctx): string[] {
  if (ctx.user.role === 'patient') return ctx.patientIds;
  if (ctx.user.role === 'doctor') return data.patients.filter(p => doctorCanAccess(data, ctx, p.id)).map(p => p.id);
  return [];
}
