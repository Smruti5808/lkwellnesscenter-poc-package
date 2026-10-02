import { createHash } from 'node:crypto';
import type { Consultation, Data, Doctor, Patient, Prescription, PrescriptionItem, SafetyWarning } from '../shared/schemas';
import { DRUGS, FREQUENCY_LABEL, FREQUENCY_PER_DAY, INTERACTIONS } from '../shared/reference';
import { ageOn, formatDate } from '../shared/time';

const drugInfo = (name: string) => DRUGS.find(d => d.name.toLowerCase() === name.trim().toLowerCase());
const classOf = (name: string) => drugInfo(name)?.drugClass;
/** "500 mg" → 500; "1 g" → 1000; other units are not dose-checked. */
function milligrams(dose: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(mg|g)\b/i.exec(dose);
  if (!match) return undefined;
  return Number(match[1]) * (match[2].toLowerCase() === 'g' ? 1000 : 1);
}

/** Demo safety rules: drug interactions, allergy conflicts, duplicate therapy, and maximum daily dose. */
export function safetyCheck(data: Data, patientId: string, items: PrescriptionItem[]): SafetyWarning[] {
  const warnings: SafetyWarning[] = [];
  const current = data.medications.filter(m => m.patientId === patientId && m.active).map(m => m.name);
  const names = items.map(i => i.drug.trim());
  const everything = [...names.map(name => ({ name, source: 'this prescription' })), ...current.map(name => ({ name, source: 'current medications' }))];

  for (const rule of INTERACTIONS) {
    const matches = (n: string, key: string) => n.toLowerCase() === key.toLowerCase() || classOf(n) === key;
    const a = everything.find(e => matches(e.name, rule.a));
    const b = everything.find(e => e !== a && matches(e.name, rule.b));
    if (a && b && (names.includes(a.name) || names.includes(b.name))) warnings.push({ kind: 'interaction', severity: rule.severity, message: `${a.name} with ${b.name} (${b.source}): ${rule.note}.` });
  }
  for (const allergy of data.allergies.filter(a => a.patientId === patientId && a.category === 'drug')) {
    const substance = allergy.substance.toLowerCase();
    for (const name of names) {
      const drugClass = classOf(name)?.toLowerCase() ?? '';
      if (name.toLowerCase().includes(substance) || drugClass.includes(substance)) warnings.push({ kind: 'allergy', severity: 'serious', message: `${name} conflicts with recorded ${allergy.substance} allergy (${allergy.reaction || allergy.severity}).` });
    }
  }
  const seen = new Map<string, string>();
  for (const entry of everything) {
    const key = classOf(entry.name) ?? entry.name.toLowerCase();
    const earlier = seen.get(key);
    if (earlier && (names.includes(entry.name) || names.includes(earlier))) warnings.push({ kind: 'duplicate', severity: 'caution', message: `Possible duplicate therapy: ${earlier} and ${entry.name}${classOf(entry.name) ? ` (both ${classOf(entry.name)})` : ''}.` });
    else seen.set(key, entry.name);
  }
  for (const item of items) {
    const info = drugInfo(item.drug), mg = milligrams(item.dose);
    if (info?.maxDailyMg && mg !== undefined && mg * FREQUENCY_PER_DAY[item.frequency] > info.maxDailyMg) {
      warnings.push({ kind: 'dose', severity: 'serious', message: `${item.drug}: ${mg * FREQUENCY_PER_DAY[item.frequency]} mg/day exceeds the ${info.maxDailyMg} mg/day limit.` });
    }
  }
  return warnings.filter((w, i) => warnings.findIndex(x => x.message === w.message) === i);
}

/** Simulated digital signature: a hash binding doctor registration, patient, items, and time. Not a legal e-signature. */
export function signatureFor(rx: Pick<Prescription, 'id' | 'patientId' | 'items'>, doctor: Pick<Doctor, 'councilNumber'>, signedAt: string): string {
  return createHash('sha256').update(JSON.stringify([rx.id, rx.patientId, rx.items, doctor.councilNumber, signedAt])).digest('hex');
}

/** Template-based plain-language care summary (no AI). */
export function careSummary(data: Data, c: Consultation): string {
  const patient = data.patients.find(p => p.id === c.patientId);
  const rx = data.prescriptions.filter(p => p.consultationId === c.id && p.status === 'signed').flatMap(p => p.items);
  const orders = data.orders.filter(o => o.consultationId === c.id && o.status !== 'cancelled');
  const lines = [
    `Visit summary for ${patient?.name ?? 'patient'}.`,
    c.subjective && `What you told us: ${c.subjective}`,
    c.diagnoses.length ? `Diagnosis: ${c.diagnoses.map(d => `${d.label} (${d.code})`).join('; ')}.` : c.assessment && `Assessment: ${c.assessment}`,
    rx.length ? `Medicines: ${rx.map(i => `${i.drug} ${i.dose}, ${FREQUENCY_LABEL[i.frequency].toLowerCase()} for ${i.durationDays} days`).join('; ')}.` : '',
    orders.length ? `Tests ordered: ${orders.map(o => o.test).join(', ')}.` : '',
    c.plan && `Plan: ${c.plan}`,
    c.followUpDate ? `Follow-up: around ${formatDate(c.followUpDate)}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

const byPatient = <T extends { patientId: string }>(rows: T[], patientId: string) => rows.filter(r => r.patientId === patientId);
const newestFirst = <T>(rows: T[], key: (r: T) => string) => [...rows].sort((a, b) => key(b).localeCompare(key(a)));

/** Everything about one patient that the viewer may see, for the single-screen record and the patient's own records. */
export function patientSummary(data: Data, patient: Patient, viewer: 'patient' | 'doctor', doctorId?: string) {
  const doctorName = (id: string) => data.doctors.find(d => d.id === id)?.name ?? 'Unknown doctor';
  const consultations = newestFirst(byPatient(data.consultations, patient.id).filter(c => viewer === 'doctor' || c.status === 'final'), c => c.createdAt);
  return {
    patient: { ...patient, age: ageOn(patient.dateOfBirth) },
    guardian: patient.guardianPatientId ? data.patients.find(p => p.id === patient.guardianPatientId)?.name : undefined,
    conditions: byPatient(data.conditions, patient.id),
    allergies: byPatient(data.allergies, patient.id),
    medications: byPatient(data.medications, patient.id),
    vitals: newestFirst(byPatient(data.vitals, patient.id), v => v.recordedAt),
    documents: newestFirst(byPatient(data.documents, patient.id), d => d.documentDate),
    consultations: consultations.map(c => ({ ...c, doctorName: doctorName(c.doctorId) })),
    prescriptions: newestFirst(byPatient(data.prescriptions, patient.id).filter(p => viewer === 'doctor' || p.status === 'signed'), p => p.createdAt).map(p => ({ ...p, doctorName: doctorName(p.doctorId) })),
    orders: newestFirst(byPatient(data.orders, patient.id), o => o.createdAt).map(o => ({ ...o, doctorName: doctorName(o.doctorId) })),
    appointments: newestFirst(byPatient(data.appointments, patient.id).filter(a => viewer === 'patient' || a.doctorId === doctorId), a => a.start).map(a => ({ ...a, doctorName: doctorName(a.doctorId), typeName: data.appointmentTypes.find(t => t.id === a.typeId)?.name ?? 'Appointment' })),
    referrals: byPatient(data.referrals, patient.id).map(r => ({ ...r, fromName: doctorName(r.fromDoctorId), toName: doctorName(r.toDoctorId) })),
  };
}
export type PatientSummary = ReturnType<typeof patientSummary>;

/** Removes the given patients and every record that belongs to them (privacy "delete my data"). */
export function deletePatients(data: Data, patientIds: string[]) {
  const gone = new Set(patientIds);
  const keep = <T extends { patientId?: string }>(rows: T[]) => rows.filter(r => !r.patientId || !gone.has(r.patientId));
  data.patients = data.patients.filter(p => !gone.has(p.id));
  data.consents = keep(data.consents); data.conditions = keep(data.conditions); data.allergies = keep(data.allergies);
  data.medications = keep(data.medications); data.doseLogs = keep(data.doseLogs); data.vitals = keep(data.vitals);
  data.documents = keep(data.documents); data.appointments = keep(data.appointments); data.consultations = keep(data.consultations);
  data.prescriptions = keep(data.prescriptions); data.orders = keep(data.orders); data.messages = keep(data.messages);
  data.referrals = keep(data.referrals); data.feedback = keep(data.feedback); data.accessBlocks = keep(data.accessBlocks);
}

export function doctorPerformance(data: Data, doctorId: string) {
  const appointments = data.appointments.filter(a => a.doctorId === doctorId);
  const completed = appointments.filter(a => a.status === 'completed');
  const durations = completed.filter(a => a.startedAt && a.endedAt).map(a => (Date.parse(a.endedAt!) - Date.parse(a.startedAt!)) / 60_000);
  const feedback = data.feedback.filter(f => f.doctorId === doctorId);
  const months = new Map<string, { month: string; consultations: number; earnings: number }>();
  for (const a of completed) {
    const month = a.start.slice(0, 7);
    const entry = months.get(month) ?? { month, consultations: 0, earnings: 0 };
    entry.consultations++; entry.earnings += a.fee; months.set(month, entry);
  }
  return {
    consultations: completed.length,
    noShows: appointments.filter(a => a.status === 'no-show').length,
    earnings: completed.reduce((sum, a) => sum + a.fee, 0),
    averageMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    averageRating: feedback.length ? Math.round((feedback.reduce((s, f) => s + f.rating, 0) / feedback.length) * 10) / 10 : null,
    ratingCount: feedback.length,
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    feedback: feedback.map(f => ({ id: f.id, rating: f.rating, comment: f.comment, createdAt: f.createdAt })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export function analytics(data: Data) {
  const count = <T>(rows: T[], key: (r: T) => string) => rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});
  return {
    users: count(data.users, u => u.role), inactiveUsers: data.users.filter(u => !u.active).length,
    doctors: count(data.doctors, d => d.verification), patients: data.patients.length,
    appointments: count(data.appointments, a => a.status), consultations: data.consultations.length,
    prescriptions: data.prescriptions.filter(p => p.status === 'signed').length, orders: count(data.orders, o => o.status),
    averageRating: data.feedback.length ? Math.round((data.feedback.reduce((s, f) => s + f.rating, 0) / data.feedback.length) * 10) / 10 : null,
  };
}

/** Creates refill reminders for active medications due within three days (once per medication and refill date). */
export function refillReminders(data: Data): { userId: string; medication: string; refillDate: string; key: string }[] {
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  return data.medications.filter(m => m.active && m.refillDate && m.refillDate <= soon).map(m => {
    const patient = data.patients.find(p => p.id === m.patientId);
    const owner = patient?.userId ?? data.patients.find(p => p.id === patient?.guardianPatientId)?.userId ?? '';
    return { userId: owner, medication: `${m.name}${patient && !patient.userId ? ` for ${patient.name}` : ''}`, refillDate: m.refillDate!, key: `refill:${m.id}:${m.refillDate}` };
  });
}
