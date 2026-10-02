// Dummy data for the demo. Dates are relative to the moment of seeding so "today" always has a clinic queue.
// All people, notes, and reports are fictional.
import { statSync } from 'node:fs';
import path from 'node:path';
import type { Appointment, Data, Doctor } from '../src/shared/schemas';
import { istAt as at, istDate, istWeekday } from '../src/shared/time';
import { signatureFor } from '../src/server/clinical';

const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

export function makeSeedData(now = new Date(), documentDir = path.resolve('./demo/documents')): Data {
  const d = (offset: number) => istDate(now, offset);
  const ts = (offset: number, hhmm = '10:00') => at(d(offset), hhmm);
  const created = ts(-120);
  const row = <T extends object>(id: string, fields: T, createdAt = created) => ({ id, createdAt, updatedAt: createdAt, ...fields });

  const users: Data['users'] = [
    row('usr-ananya', { role: 'patient' as const, name: 'Ananya Rao', email: 'ananya@example.com', phone: '+91 90000 00001', active: true, notificationChannels: ['push', 'email'] as ('push' | 'email')[], patientId: 'pat-ananya' }),
    row('usr-vikram', { role: 'patient' as const, name: 'Vikram Shah', email: 'vikram@example.com', phone: '+91 90000 00002', active: true, notificationChannels: ['sms'] as 'sms'[], patientId: 'pat-vikram' }),
    row('usr-meera', { role: 'patient' as const, name: 'Meera Iyer', email: 'meera@example.com', phone: '+91 90000 00003', active: true, notificationChannels: ['push'] as 'push'[], patientId: 'pat-meera' }),
    row('usr-padmanaban', { role: 'doctor' as const, name: 'Dr. Padmanaban', email: 'padmanaban@example.com', phone: '+91 90000 10001', active: true, notificationChannels: ['push'] as 'push'[], doctorId: 'doc-padmanaban' }),
    row('usr-admin', { role: 'admin' as const, name: 'Clinic Admin', email: 'admin@example.com', phone: '+91 90000 20001', active: true, notificationChannels: ['email'] as 'email'[] }),
  ];

  const patients: Data['patients'] = [
    row('pat-ananya', { userId: 'usr-ananya', name: 'Ananya Rao', dateOfBirth: '1988-04-12', gender: 'female' as const, phone: '+91 90000 00001', email: 'ananya@example.com', address: '12 Lake View Road, Bengaluru', bloodGroup: 'B+', emergencyContactName: 'Rahul Rao', emergencyContactPhone: '+91 90000 00009' }),
    row('pat-aarav', { name: 'Aarav Rao', dateOfBirth: '2016-05-14', gender: 'male' as const, guardianPatientId: 'pat-ananya', relationship: 'Son', bloodGroup: 'O+' }),
    row('pat-vikram', { userId: 'usr-vikram', name: 'Vikram Shah', dateOfBirth: '1979-09-30', gender: 'male' as const, phone: '+91 90000 00002', email: 'vikram@example.com', address: '45 MG Road, Bengaluru', bloodGroup: 'A+' }),
    row('pat-meera', { userId: 'usr-meera', name: 'Meera Iyer', dateOfBirth: '1995-01-22', gender: 'female' as const, phone: '+91 90000 00003', email: 'meera@example.com' }),
  ];

  const consents: Data['consents'] = ['pat-ananya', 'pat-aarav', 'pat-vikram', 'pat-meera'].flatMap(patientId =>
    (['terms', 'telemedicine', 'dataSharing'] as const).map(kind => row(`con-${patientId.slice(4)}-${kind}`, { patientId, kind, granted: kind !== 'dataSharing' || patientId === 'pat-ananya' })));

  const conditions: Data['conditions'] = [
    row('cnd-ananya-htn', { patientId: 'pat-ananya', category: 'chronic' as const, name: 'Hypertension', date: '2022-03-01', notes: 'On treatment.', recordedBy: 'usr-padmanaban' }),
    row('cnd-ananya-appx', { patientId: 'pat-ananya', category: 'surgery' as const, name: 'Appendectomy', date: '2015-08-20', recordedBy: 'usr-ananya' }),
    row('cnd-ananya-dengue', { patientId: 'pat-ananya', category: 'hospitalization' as const, name: 'Dengue fever, 4-day admission', date: '2019-10-05', recordedBy: 'usr-ananya' }),
    row('cnd-ananya-fh', { patientId: 'pat-ananya', category: 'family' as const, name: 'Type 2 diabetes', relation: 'Father', recordedBy: 'usr-ananya' }),
    row('cnd-vikram-dm', { patientId: 'pat-vikram', category: 'chronic' as const, name: 'Type 2 diabetes', date: '2020-06-15', recordedBy: 'usr-padmanaban' }),
    row('cnd-aarav-asthma', { patientId: 'pat-aarav', category: 'past' as const, name: 'Childhood wheeze', date: '2019-02-10', notes: 'No episodes since 2021.', recordedBy: 'usr-ananya' }),
  ];

  const allergies: Data['allergies'] = [
    row('alg-ananya-pen', { patientId: 'pat-ananya', category: 'drug' as const, substance: 'Penicillin', reaction: 'Skin rash', severity: 'moderate' as const, recordedBy: 'usr-padmanaban' }),
    row('alg-ananya-peanut', { patientId: 'pat-ananya', category: 'food' as const, substance: 'Peanuts', reaction: 'Itching', severity: 'mild' as const, recordedBy: 'usr-ananya' }),
    row('alg-ananya-dust', { patientId: 'pat-ananya', category: 'environmental' as const, substance: 'Dust mites', reaction: 'Sneezing', severity: 'mild' as const, recordedBy: 'usr-ananya' }),
  ];

  const medications: Data['medications'] = [
    row('med-ananya-amlo', { patientId: 'pat-ananya', name: 'Amlodipine', dose: '5 mg', frequency: 'Once daily', startDate: '2022-03-01', refillDate: d(2), active: true, recordedBy: 'usr-padmanaban' }),
    row('med-ananya-ator', { patientId: 'pat-ananya', name: 'Atorvastatin', dose: '10 mg', frequency: 'At bedtime', startDate: d(-90), refillDate: d(20), active: true, recordedBy: 'usr-padmanaban' }),
    row('med-vikram-met', { patientId: 'pat-vikram', name: 'Metformin', dose: '500 mg', frequency: 'Twice daily', startDate: '2020-06-15', refillDate: d(1), active: true, recordedBy: 'usr-padmanaban' }),
  ];

  const doseLogs: Data['doseLogs'] = [-3, -2, -1].flatMap(offset => [
    row(`dose-amlo-${-offset}`, { patientId: 'pat-ananya', medicationId: 'med-ananya-amlo', date: d(offset), taken: offset !== -2 }),
    row(`dose-ator-${-offset}`, { patientId: 'pat-ananya', medicationId: 'med-ananya-ator', date: d(offset), taken: true }),
  ]);

  const vital = (id: string, patientId: string, offset: number, v: object, source: 'manual' | 'device' | 'clinic' = 'clinic') =>
    row(id, { patientId, recordedAt: ts(offset, '10:15'), source, recordedBy: source === 'clinic' ? 'usr-padmanaban' : 'usr-ananya', ...v });
  const vitals: Data['vitals'] = [
    vital('vit-ananya-1', 'pat-ananya', -90, { heightCm: 162, weightKg: 68.4, systolic: 146, diastolic: 92, pulse: 80, spo2: 98 }),
    vital('vit-ananya-2', 'pat-ananya', -30, { weightKg: 67.9, systolic: 138, diastolic: 88, pulse: 76, spo2: 99 }),
    vital('vit-ananya-3', 'pat-ananya', -5, { systolic: 132, diastolic: 84, pulse: 74 }, 'device'),
    vital('vit-vikram-1', 'pat-vikram', -60, { heightCm: 175, weightKg: 82, systolic: 128, diastolic: 82, pulse: 78, glucoseMgDl: 168, spo2: 98 }),
    vital('vit-aarav-1', 'pat-aarav', -20, { heightCm: 128, weightKg: 26, pulse: 102, spo2: 97 }),
  ];

  const docMeta = (fileName: string) => ({ fileName, mimeType: 'application/pdf', byteSize: statSync(path.join(documentDir, fileName)).size, storage: 'seed' as const });
  const documents: Data['documents'] = [
    row('doc-ananya-intake', { patientId: 'pat-ananya', title: 'Intake summary', category: 'other' as const, documentDate: d(-90), uploadedBy: 'usr-padmanaban', ...docMeta('intake-summary.pdf') }),
    row('doc-ananya-lipid', { patientId: 'pat-ananya', title: 'Lipid profile report', category: 'lab' as const, documentDate: d(-88), uploadedBy: 'usr-ananya', ...docMeta('assessment-report.pdf') }),
    // One sample prescription from an outside (fictional) family doctor per patient, as if the patient uploaded it.
    ...[
      { patientId: 'pat-ananya', by: 'usr-ananya', title: 'Prescription: allergic rhinitis', date: '2026-04-18', notes: 'From my family doctor before I started at LK Wellness.' },
      { patientId: 'pat-aarav', by: 'usr-ananya', title: 'Prescription: common cold', date: '2026-03-09', notes: 'Aarav, cold and cough in March.' },
      { patientId: 'pat-vikram', by: 'usr-vikram', title: 'Prescription: diabetes review', date: '2025-11-20', notes: 'Previous metformin prescription.' },
      { patientId: 'pat-meera', by: 'usr-meera', title: 'Prescription: skin rash', date: '2026-09-18', notes: 'Rash on forearms; bringing this to my first visit.' },
    ].map(p => row(`doc-${p.patientId.slice(4)}-rx-upload`, { patientId: p.patientId, title: p.title, category: 'prescription' as const, documentDate: p.date, issuedBy: 'Dr. S. Menon, Lakeside Family Clinic', notes: p.notes, uploadedBy: p.by, ...docMeta(`sample-prescription-${p.patientId.slice(4)}.pdf`) })),
  ];

  const doctor = (id: string, userId: string, fields: Omit<Doctor, 'id' | 'createdAt' | 'updatedAt' | 'userId' | 'verification'>, verification: Doctor['verification'] = 'verified'): Doctor => row(id, { userId, verification, ...fields });
  const doctors: Data['doctors'] = [
    doctor('doc-padmanaban', 'usr-padmanaban', { name: 'Dr. Padmanaban', councilNumber: 'DEMO-REG-0001', licenseNumber: 'DEMO-LIC-0001', specialty: 'Integrative Expert Practitioner', qualifications: 'Qualifications to be confirmed', bio: 'Integrative care that combines conventional medicine with lifestyle, nutrition, and wellness therapies.', languages: ['English'], clinic: 'LK Wellness Clinic', clinicAddress: 'Clinic address to be confirmed' }),
  ];

  const appointmentTypes: Data['appointmentTypes'] = [
    row('typ-padmanaban-new', { doctorId: 'doc-padmanaban', name: 'Integrative consultation', durationMinutes: 30, fee: 1000 }),
    row('typ-padmanaban-fu', { doctorId: 'doc-padmanaban', name: 'Follow-up', durationMinutes: 20, fee: 600 }),
  ];

  const week = (doctorId: string, days: number[], start: string, end: string, extra: { breakStart?: string; breakEnd?: string; bufferMinutes?: number } = {}) =>
    days.map(weekday => row(`sch-${doctorId.slice(4)}-${weekday}`, { doctorId, weekday, start, end, bufferMinutes: 0, ...extra }));
  const schedules: Data['schedules'] = [
    ...week('doc-padmanaban', [1, 2, 3, 4, 5, 6], '09:00', '17:00', { breakStart: '13:00', breakEnd: '14:00', bufferMinutes: 5 }),
  ];
  const leaves: Data['leaves'] = [row('lv-padmanaban-conf', { doctorId: 'doc-padmanaban', startDate: d(10), endDate: d(11), reason: 'Medical conference' })];
  // Future bookings move off Sunday, when the clinic is closed.
  const openDay = (offset: number) => (istWeekday(d(offset)) === 0 ? offset + 1 : offset);

  const appt = (id: string, patientId: string, doctorId: string, typeId: string, offset: number, hhmm: string, status: Appointment['status'], extra: Partial<Appointment> = {}): Appointment => {
    const type = appointmentTypes.find(t => t.id === typeId)!;
    const start = ts(offset > 0 ? openDay(offset) : offset, hhmm);
    return { ...row(id, {}, ts(Math.min(offset, 0) - 3)), patientId, doctorId, typeId, start, end: plus(start, type.durationMinutes), fee: type.fee, status, bookedBy: users.find(u => u.patientId === patientId)?.id ?? 'usr-ananya', ...extra };
  };
  const done = (offset: number, hhmm: string) => ({ checkedInAt: ts(offset, hhmm), startedAt: ts(offset, hhmm), endedAt: plus(ts(offset, hhmm), 14) });
  const appointments: Data['appointments'] = [
    appt('apt-ananya-1', 'pat-ananya', 'doc-padmanaban', 'typ-padmanaban-new', -90, '10:00', 'completed', { reason: 'Headaches and high BP reading at work', ...done(-90, '10:00') }),
    appt('apt-ananya-2', 'pat-ananya', 'doc-padmanaban', 'typ-padmanaban-fu', -30, '11:00', 'completed', { reason: 'BP and cholesterol follow-up', ...done(-30, '11:00') }),
    appt('apt-aarav-1', 'pat-aarav', 'doc-padmanaban', 'typ-padmanaban-new', -20, '16:00', 'completed', { reason: 'Fever for two days', ...done(-20, '16:00') }),
    appt('apt-vikram-1', 'pat-vikram', 'doc-padmanaban', 'typ-padmanaban-new', -60, '12:00', 'completed', { reason: 'Diabetes review', ...done(-60, '12:00') }),
    appt('apt-vikram-today', 'pat-vikram', 'doc-padmanaban', 'typ-padmanaban-fu', 0, '10:00', 'checked-in', { reason: 'Sugar review with reports', checkedInAt: ts(0, '09:50'), intake: { chiefComplaint: 'Diabetes follow-up', symptoms: 'Occasional tiredness in the afternoon', duration: '2 weeks', fever: false, takingMedication: true } }),
    appt('apt-ananya-today', 'pat-ananya', 'doc-padmanaban', 'typ-padmanaban-fu', 0, '10:30', 'confirmed', { reason: 'Blood pressure review', intake: { chiefComplaint: 'BP review', symptoms: 'Mild morning headaches', duration: '1 week', fever: false, takingMedication: true } }),
    appt('apt-ananya-wellness', 'pat-ananya', 'doc-padmanaban', 'typ-padmanaban-new', 4, '11:00', 'requested', { reason: 'Integrative assessment for cholesterol and BP' }),
    appt('apt-meera-new', 'pat-meera', 'doc-padmanaban', 'typ-padmanaban-new', 2, '11:20', 'requested', { reason: 'Itchy rash on forearms' }),
    appt('apt-vikram-noshow', 'pat-vikram', 'doc-padmanaban', 'typ-padmanaban-fu', -7, '15:00', 'no-show', { reason: 'Diabetes review' }),
  ];

  const consult = (id: string, appointmentId: string, patientId: string, offset: number, fields: object) =>
    row(id, { appointmentId, patientId, doctorId: 'doc-padmanaban', status: 'final' as const, diagnoses: [], subjective: '', objective: '', assessment: '', plan: '', ...fields }, ts(offset, '10:20'));
  const consultations: Data['consultations'] = [
    consult('cns-ananya-1', 'apt-ananya-1', 'pat-ananya', -90, { subjective: 'Headaches for 3 weeks, worse in the morning. BP 150/95 at a workplace camp.', objective: 'BP 146/92 mmHg, pulse 80. BMI 26. No focal deficits.', assessment: 'Hypertension, sub-optimally controlled.', plan: 'Start amlodipine 5 mg daily. Lipid profile ordered. Salt restriction, daily walk. Review in 2 months.', diagnoses: [{ code: 'I10', label: 'Essential (primary) hypertension' }], followUpDate: d(-30), careSummary: 'Visit for headaches and raised blood pressure. Diagnosis: essential hypertension. Started amlodipine 5 mg once daily. A lipid profile was ordered. Advice: reduce salt, walk daily. Follow-up in about 2 months.' }),
    consult('cns-ananya-2', 'apt-ananya-2', 'pat-ananya', -30, { subjective: 'Headaches resolved. Taking amlodipine regularly.', objective: 'BP 138/88 mmHg. Lipid profile: LDL 162 mg/dL (high).', assessment: 'Hypertension improving. Raised LDL cholesterol.', plan: 'Continue amlodipine. Start atorvastatin 10 mg at night. Integrative lifestyle and nutrition plan; review in 4 weeks.', diagnoses: [{ code: 'I10', label: 'Essential (primary) hypertension' }, { code: 'E78.5', label: 'Hyperlipidaemia, unspecified' }], followUpDate: d(0), careSummary: 'Blood pressure is improving on amlodipine. Cholesterol (LDL) is high, so atorvastatin 10 mg at bedtime was started, with a lifestyle and nutrition plan. Next review in about 4 weeks.' }),
    consult('cns-aarav-1', 'apt-aarav-1', 'pat-aarav', -20, { subjective: 'Fever 2 days, mild cough, eating well.', objective: 'Temp 38.4 °C. Throat mildly congested. Chest clear.', assessment: 'Viral upper respiratory infection.', plan: 'Paracetamol as needed for fever. Fluids, rest. Return if fever beyond 3 days.', diagnoses: [{ code: 'J06.9', label: 'Acute upper respiratory infection, unspecified' }], careSummary: 'Aarav had a viral cold with fever. Paracetamol as needed for fever, plenty of fluids and rest. Come back if the fever lasts more than 3 more days.' }),
    consult('cns-vikram-1', 'apt-vikram-1', 'pat-vikram', -60, { subjective: 'Routine review. No hypoglycaemia.', objective: 'Weight 82 kg. Random glucose 168 mg/dL.', assessment: 'Type 2 diabetes, control to be reviewed with HbA1c.', plan: 'Continue metformin. HbA1c ordered. Diet counselling.', diagnoses: [{ code: 'E11.9', label: 'Type 2 diabetes mellitus without complications' }], careSummary: 'Diabetes review. Continue metformin 500 mg twice daily. HbA1c test ordered. Diet advice given.' }),
  ];

  const sign = (offset: number) => ({ status: 'signed' as const, signedAt: ts(offset, '10:25') });
  const prescriptions: Data['prescriptions'] = [
    row('rx-ananya-1', { consultationId: 'cns-ananya-1', patientId: 'pat-ananya', doctorId: 'doc-padmanaban', items: [{ drug: 'Amlodipine', strength: '5 mg', dose: '5 mg', frequency: 'OD' as const, durationDays: 60, instructions: 'After breakfast' }], ...sign(-90) }, ts(-90, '10:25')),
    row('rx-ananya-2', { consultationId: 'cns-ananya-2', patientId: 'pat-ananya', doctorId: 'doc-padmanaban', items: [{ drug: 'Amlodipine', strength: '5 mg', dose: '5 mg', frequency: 'OD' as const, durationDays: 90 }, { drug: 'Atorvastatin', strength: '10 mg', dose: '10 mg', frequency: 'HS' as const, durationDays: 90 }], ...sign(-30) }, ts(-30, '11:20')),
    row('rx-aarav-1', { consultationId: 'cns-aarav-1', patientId: 'pat-aarav', doctorId: 'doc-padmanaban', items: [{ drug: 'Paracetamol', strength: '250 mg/5 ml', dose: '250 mg', frequency: 'SOS' as const, durationDays: 3, instructions: 'Only if temperature above 38 °C' }], ...sign(-20) }, ts(-20, '16:20')),
  ];

  for (const rx of prescriptions) rx.signature = signatureFor(rx, doctors.find(d => d.id === rx.doctorId)!, rx.signedAt!);

  const favorites: Data['favorites'] = [
    row('fav-padmanaban-fever', { doctorId: 'doc-padmanaban', name: 'Fever (adult)', items: [{ drug: 'Paracetamol', strength: '500 mg', dose: '500 mg', frequency: 'TDS' as const, durationDays: 3, instructions: 'After food' }] }),
    row('fav-padmanaban-allergy', { doctorId: 'doc-padmanaban', name: 'Allergic rhinitis', items: [{ drug: 'Cetirizine', strength: '10 mg', dose: '10 mg', frequency: 'HS' as const, durationDays: 5 }] }),
  ];

  const orders: Data['orders'] = [
    row('ord-ananya-lipid', { patientId: 'pat-ananya', doctorId: 'doc-padmanaban', consultationId: 'cns-ananya-1', kind: 'lab' as const, test: 'Lipid profile (LDL cholesterol)', status: 'resulted' as const, result: '162', unit: 'mg/dL', referenceRange: '< 100', abnormal: true, resultedAt: ts(-88, '18:00') }, ts(-90, '10:25')),
    row('ord-vikram-hba1c', { patientId: 'pat-vikram', doctorId: 'doc-padmanaban', consultationId: 'cns-vikram-1', kind: 'lab' as const, test: 'HbA1c', status: 'ordered' as const }, ts(-60, '12:20')),
    row('ord-ananya-ecg', { patientId: 'pat-ananya', doctorId: 'doc-padmanaban', consultationId: 'cns-ananya-2', kind: 'imaging' as const, test: 'ECG (12-lead)', status: 'resulted' as const, result: 'Normal sinus rhythm.', abnormal: false, resultedAt: ts(-29, '12:00') }, ts(-30, '11:20')),
  ];

  const message = (id: string, sender: 'patient' | 'doctor', offset: number, hhmm: string, body: string, read = true) =>
    row(id, { patientId: 'pat-ananya', doctorId: 'doc-padmanaban', sender, senderUserId: sender === 'patient' ? 'usr-ananya' : 'usr-padmanaban', body, ...(read ? { readAt: ts(offset, hhmm) } : {}) }, ts(offset, hhmm));
  const messages: Data['messages'] = [
    message('msg-1', 'patient', -25, '09:10', 'Hello doctor, I feel slightly dizzy after starting atorvastatin. Is that expected?'),
    message('msg-2', 'doctor', -25, '12:40', 'Mild dizziness is uncommon with it. Please check your BP at home for 3 days and share the readings.'),
    message('msg-3', 'patient', -1, '19:30', 'Readings were around 130/85. I will bring the log to my visit.', false),
  ];

  const referrals: Data['referrals'] = [];

  const feedback: Data['feedback'] = [
    row('fb-ananya-1', { appointmentId: 'apt-ananya-1', patientId: 'pat-ananya', doctorId: 'doc-padmanaban', rating: 5, comment: 'Explained everything clearly.' }, ts(-89)),
    row('fb-ananya-2', { appointmentId: 'apt-ananya-2', patientId: 'pat-ananya', doctorId: 'doc-padmanaban', rating: 4, comment: 'Short wait, helpful advice.' }, ts(-29)),
    row('fb-vikram-1', { appointmentId: 'apt-vikram-1', patientId: 'pat-vikram', doctorId: 'doc-padmanaban', rating: 4 }, ts(-59)),
  ];

  const notify = (id: string, userId: string, offset: number, title: string, body: string, link?: string, read = false) =>
    row(id, { userId, title, body, channels: users.find(u => u.id === userId)!.notificationChannels, ...(link ? { link } : {}), ...(read ? { readAt: ts(offset) } : {}) }, ts(offset, '08:00'));
  const notifications: Data['notifications'] = [
    notify('ntf-ananya-reminder', 'usr-ananya', 0, 'Appointment today at 10:30', 'Follow-up with Dr. Padmanaban at LK Wellness Clinic.', '/patient/appointments'),
    notify('ntf-ananya-result', 'usr-ananya', -88, 'New lab result', 'Your lipid profile result is available.', '/patient/records', true),
    notify('ntf-padmanaban-request', 'usr-padmanaban', -1, 'New booking request', 'Meera Iyer requested an integrative consultation.', '/doctor/schedule'),
    notify('ntf-padmanaban-abnormal', 'usr-padmanaban', -88, 'Abnormal result: Ananya Rao', 'Lipid profile (LDL cholesterol): 162 mg/dL (ref < 100).', '/doctor/patients/pat-ananya'),
  ];

  const audit: Data['audit'] = [
    { id: 'aud-1', at: ts(-30, '11:01'), actorUserId: 'usr-padmanaban', action: 'RECORD_VIEWED', patientId: 'pat-ananya' },
    { id: 'aud-2', at: ts(-30, '11:24'), actorUserId: 'usr-padmanaban', action: 'CREATE', collection: 'prescriptions', recordId: 'rx-ananya-2', patientId: 'pat-ananya' },
  ];

  return { version: 1, users, patients, consents, conditions, allergies, medications, doseLogs, vitals, documents, doctors, appointmentTypes, schedules, leaves, appointments, consultations, prescriptions, favorites, orders, messages, referrals, feedback, notifications, accessBlocks: [], sessions: [], audit };
}
