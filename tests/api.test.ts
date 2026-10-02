import { as, call, data, login, reset, store, upload } from './helpers';
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(reset);
const ANANYA = 'ananya@example.com', VIKRAM = 'vikram@example.com', DOCTOR = 'padmanaban@example.com', ADMIN = 'admin@example.com';
/** The dummy data has a single doctor; tests that need another one register it through the API (verified unless pending). */
let extraCount = 0;
async function extraDoctor(pending = false) {
  const n = ++extraCount, email = `extra${n}@example.com`;
  await call(null, 'POST', 'auth/register/doctor', { name: `Dr Extra ${n}`, email, phone: `+91 80000 0000${n}`, councilNumber: `X-${n}`, licenseNumber: `L-${n}`, specialty: 'Dermatology', qualifications: 'MBBS', languages: ['English'], clinic: 'Clinic' });
  const d = await data();
  const doctorId = d.users.find(u => u.email === email)!.doctorId!;
  if (!pending) await (await as(ADMIN)).post(`admin/doctors/${doctorId}/verification`, { verification: 'verified' });
  return { client: await as(email), doctorId, typeId: d.appointmentTypes.find(t => t.doctorId === doctorId)!.id, userId: d.users.find(u => u.email === email)!.id };
}
async function firstSlot(client: Awaited<ReturnType<typeof as>>, doctorId: string, typeId: string, n = 0) {
  const slots = await client.get(`doctors/${doctorId}/slots?typeId=${typeId}&days=14`);
  return slots.body.data[n] as string;
}

describe('authentication', () => {
  test('PIN 1234 signs in by email or phone; other PINs and unknown accounts fail', async () => {
    assert.equal((await call(null, 'POST', 'auth/login', { identifier: ANANYA, pin: '1234' })).status, 200);
    assert.equal((await call(null, 'POST', 'auth/login', { identifier: '+91 90000 00001', pin: '1234' })).status, 200);
    assert.equal((await call(null, 'POST', 'auth/login', { identifier: ANANYA, pin: '0000' })).status, 401);
    assert.equal((await call(null, 'POST', 'auth/login', { identifier: 'nobody@example.com', pin: '1234' })).status, 401);
  });
  test('repeated failures are rate limited', async () => {
    // A throwaway identifier, so the one-minute lockout does not affect other tests.
    for (let i = 0; i < 5; i++) assert.equal((await call(null, 'POST', 'auth/login', { identifier: 'locked@example.com', pin: '9999' })).status, 401);
    assert.equal((await call(null, 'POST', 'auth/login', { identifier: 'locked@example.com', pin: '1234' })).status, 429);
  });
  test('sign-out, idle timeout, and deactivation end sessions', async () => {
    const a = await as(ANANYA);
    assert.equal((await a.get('auth/session')).body.data.user.role, 'patient');
    await a.del('auth/session');
    assert.equal((await a.get('auth/session')).status, 401);
    const b = await as(ANANYA);
    await store.transaction(d => { for (const s of d.sessions) s.lastSeenAt = new Date(Date.now() - 31 * 60_000).toISOString(); });
    assert.equal((await b.get('auth/session')).status, 401);
    const c = await as(ANANYA);
    const admin = await as(ADMIN);
    assert.equal((await admin.patch('c/users/usr-ananya', { active: false })).status, 200);
    assert.equal((await c.get('auth/session')).status, 401);
    assert.equal((await call(null, 'POST', 'auth/login', { identifier: ANANYA, pin: '1234' })).status, 401);
  });
  test('writes from another origin are rejected', async () => {
    const res = await call(null, 'POST', 'auth/login', { identifier: ANANYA, pin: '1234' }, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });
  test('patient registration creates account, profile, and consents; duplicates are refused', async () => {
    const res = await call(null, 'POST', 'auth/register/patient', { name: 'Kiran Patel', dateOfBirth: '1990-02-03', gender: 'female', email: 'kiran@example.com', phone: '+91 90000 55555', acceptTerms: true, dataSharingConsent: true });
    assert.equal(res.status, 201);
    const d = await data();
    const user = d.users.find(u => u.email === 'kiran@example.com')!;
    assert.equal(d.consents.filter(c => c.patientId === user.patientId).length, 3);
    assert.equal((await call(null, 'POST', 'auth/register/patient', { name: 'Again', dateOfBirth: '1990-02-03', gender: 'female', email: 'KIRAN@example.com', phone: '+91 90000 12345', acceptTerms: true })).status, 409);
    assert.equal((await call(null, 'POST', 'auth/register/patient', { name: 'No terms', dateOfBirth: '1990-02-03', gender: 'male', email: 'x@example.com', phone: '+91 90000 66666', acceptTerms: false })).status, 422);
  });
  test('doctor registration is pending, hidden from search, and notifies admins', async () => {
    const res = await call(null, 'POST', 'auth/register/doctor', { name: 'Dr New', email: 'new.doc@example.com', phone: '+91 90000 77777', councilNumber: 'X-1', licenseNumber: 'L-1', specialty: 'Cardiology', qualifications: 'MBBS', languages: ['English'], clinic: 'Clinic' });
    assert.equal(res.status, 201);
    const d = await data();
    const doc = d.doctors.find(x => x.name === 'Dr New')!;
    assert.equal(doc.verification, 'pending');
    assert.ok(d.appointmentTypes.some(t => t.doctorId === doc.id));
    assert.ok(d.notifications.some(n => n.userId === 'usr-admin' && n.title === 'Doctor awaiting verification'));
    const patient = await as(ANANYA);
    assert.ok(!(await patient.get('directory')).body.data.some((x: { id: string }) => x.id === doc.id));
  });
});

describe('access rules', () => {
  test('patients see only their own and dependents’ records', async () => {
    const a = await as(ANANYA);
    assert.equal((await a.get('patients/pat-aarav/summary')).status, 200);
    assert.equal((await a.get('patients/pat-vikram/summary')).status, 404);
    const allergies = (await a.get('c/allergies')).body.data as { patientId: string }[];
    assert.ok(allergies.length > 0 && allergies.every(x => ['pat-ananya', 'pat-aarav'].includes(x.patientId)));
    assert.equal((await a.post('c/allergies', { patientId: 'pat-vikram', category: 'food', substance: 'X', severity: 'mild' })).status, 403);
    assert.equal((await a.get('c/conditions/cnd-vikram-dm')).status, 404);
  });
  test('doctors need a care relationship; blocks and pending verification remove access; admins never see clinical data', async () => {
    const doctor = await as(DOCTOR), otherDoctor = (await extraDoctor()).client, pendingDoctor = (await extraDoctor(true)).client, admin = await as(ADMIN);
    assert.equal((await doctor.get('patients/pat-vikram/summary')).status, 200);
    assert.equal((await otherDoctor.get('patients/pat-ananya/summary')).status, 404);
    assert.equal((await pendingDoctor.get('patients/pat-ananya/summary')).status, 404);
    assert.equal((await admin.get('patients/pat-ananya/summary')).status, 404);
    assert.equal((await admin.get('c/allergies')).body.data.length, 0);
    const ananya = await as(ANANYA);
    assert.equal((await ananya.post('c/accessBlocks', { patientId: 'pat-ananya', doctorId: 'doc-padmanaban' })).status, 201);
    assert.equal((await doctor.get('patients/pat-ananya/summary')).status, 404);
    assert.ok(!(await doctor.get('my/patients')).body.data.some((p: { id: string }) => p.id === 'pat-ananya'));
  });
  test('doctor record views are logged and visible to the patient', async () => {
    const doctor = await as(DOCTOR);
    await doctor.get('patients/pat-ananya/summary');
    const log = (await (await as(ANANYA)).get('c/audit')).body.data as { action: string; actorUserId: string }[];
    assert.ok(log.some(e => e.action === 'RECORD_VIEWED' && e.actorUserId === 'usr-padmanaban'));
    assert.equal((await (await as(VIKRAM)).get('c/audit')).body.data.filter((e: { patientId: string }) => e.patientId === 'pat-ananya').length, 0);
  });
});

describe('generic CRUD', () => {
  test('create, read, update (merge and clear), delete', async () => {
    const a = await as(ANANYA);
    const created = await a.post('c/allergies', { patientId: 'pat-ananya', category: 'drug', substance: 'Sulfa', reaction: 'Hives', severity: 'severe' });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.recordedBy, 'usr-ananya');
    const id = created.body.data.id;
    assert.equal((await a.get(`c/allergies/${id}`)).body.data.substance, 'Sulfa');
    const updated = await a.patch(`c/allergies/${id}`, { severity: 'moderate', reaction: null });
    assert.deepEqual([updated.body.data.severity, updated.body.data.reaction, updated.body.data.substance], ['moderate', undefined, 'Sulfa']);
    assert.equal((await a.del(`c/allergies/${id}`)).status, 200);
    assert.equal((await a.get(`c/allergies/${id}`)).status, 404);
  });
  test('server-owned and unknown fields are rejected', async () => {
    const a = await as(ANANYA);
    assert.equal((await a.post('c/allergies', { patientId: 'pat-ananya', category: 'food', substance: 'X', severity: 'mild', recordedBy: 'usr-padmanaban' })).status, 422);
    assert.equal((await a.patch('c/allergies/alg-ananya-pen', { recordedBy: 'someone' })).status, 422);
    assert.equal((await a.patch('c/patients/pat-ananya', { userId: 'usr-vikram' })).status, 422);
    const doctor = await as(DOCTOR);
    assert.equal((await doctor.patch('c/doctors/doc-padmanaban', { verification: 'verified' })).status, 422);
  });
  test('cross-field rules are re-checked on edit', async () => {
    const doctor = await as(DOCTOR);
    assert.equal((await doctor.patch('c/schedules/sch-padmanaban-1', { end: '08:00' })).status, 422);
    assert.equal((await doctor.patch('c/leaves/lv-padmanaban-conf', { endDate: '2000-01-01' })).status, 422);
  });
  test('doctors cannot edit another doctor’s setup', async () => {
    const otherDoctor = (await extraDoctor()).client;
    assert.equal((await otherDoctor.patch('c/appointmentTypes/typ-padmanaban-new', { fee: 1 })).status, 403);
    assert.equal((await otherDoctor.get('c/leaves')).body.data.length, 0);
  });
  test('patients add and remove dependents; removal cascades', async () => {
    const a = await as(ANANYA);
    const child = await a.post('c/patients', { name: 'Isha Rao', dateOfBirth: '2020-01-01', gender: 'female', relationship: 'Daughter' });
    assert.equal(child.status, 201);
    assert.equal(child.body.data.guardianPatientId, 'pat-ananya');
    await a.post('c/allergies', { patientId: child.body.data.id, category: 'food', substance: 'Milk', severity: 'mild' });
    assert.equal((await a.del(`c/patients/${child.body.data.id}`)).status, 200);
    assert.ok(!(await data()).allergies.some(x => x.patientId === child.body.data.id));
    assert.equal((await a.del('c/patients/pat-ananya')).status, 403, 'own record is deleted via privacy, not generic delete');
  });
});

describe('appointments', () => {
  test('booking must use a free slot; double booking is refused', async () => {
    const meera = await as('meera@example.com');
    const start = await firstSlot(meera, 'doc-padmanaban', 'typ-padmanaban-new');
    const ok = await meera.post('c/appointments', { patientId: 'pat-meera', doctorId: 'doc-padmanaban', typeId: 'typ-padmanaban-new', start, intake: { chiefComplaint: 'Rash' } });
    assert.equal(ok.status, 201);
    assert.deepEqual([ok.body.data.status, ok.body.data.fee], ['requested', 1000]);
    assert.equal((await meera.post('c/appointments', { patientId: 'pat-meera', doctorId: 'doc-padmanaban', typeId: 'typ-padmanaban-new', start })).status, 422);
    assert.equal((await meera.post('c/appointments', { patientId: 'pat-meera', doctorId: 'doc-padmanaban', typeId: 'typ-padmanaban-new', start: '2020-01-01T05:30:00.000Z' })).status, 422);
    const pending = await extraDoctor(true);
    assert.equal((await meera.post('c/appointments', { patientId: 'pat-meera', doctorId: pending.doctorId, typeId: pending.typeId, start })).status, 422, 'pending doctors are not bookable');
    assert.ok((await data()).notifications.some(n => n.userId === 'usr-padmanaban' && n.title === 'New booking request'));
  });
  test('leave days and booked times produce no slots', async () => {
    const meera = await as('meera@example.com');
    const d = await data();
    const leave = d.leaves[0];
    const slots = (await meera.get(`doctors/doc-padmanaban/slots?typeId=typ-padmanaban-new&from=${leave.startDate}&days=2`)).body.data;
    assert.deepEqual(slots, []);
  });
  test('status transitions follow the workflow', async () => {
    const otherDoctor = await as(DOCTOR), meera = await as('meera@example.com');
    assert.equal((await meera.patch('c/appointments/apt-meera-new', { status: 'completed' })).status, 409);
    assert.equal((await meera.patch('c/appointments/apt-meera-new', { status: 'checked-in' })).status, 409, 'not confirmed yet');
    assert.equal((await otherDoctor.patch('c/appointments/apt-meera-new', { status: 'confirmed' })).status, 200);
    assert.equal((await meera.patch('c/appointments/apt-meera-new', { status: 'checked-in' })).status, 409, 'check-in only on the day');
    assert.equal((await meera.patch('c/appointments/apt-meera-new', { status: 'cancelled', cancelReason: 'Travel' })).status, 200);
    assert.equal((await otherDoctor.patch('c/appointments/apt-meera-new', { status: 'confirmed' })).status, 409);
    assert.ok((await data()).notifications.some(n => n.userId === 'usr-padmanaban' && n.body.includes('Travel')));
  });
  test('patient reschedule returns the booking to requested; doctor reschedule stays confirmed', async () => {
    const doctor = await as(DOCTOR), ananya = await as(ANANYA);
    const start = await firstSlot(ananya, 'doc-padmanaban', 'typ-padmanaban-fu', 5);
    const moved = await ananya.patch('c/appointments/apt-ananya-today', { start });
    assert.deepEqual([moved.status, moved.body.data.status], [200, 'requested']);
    const start2 = await firstSlot(doctor, 'doc-padmanaban', 'typ-padmanaban-fu', 8);
    const again = await doctor.patch('c/appointments/apt-ananya-today', { start: start2 });
    assert.deepEqual([again.status, again.body.data.status], [200, 'confirmed']);
    assert.equal((await ananya.patch('c/appointments/apt-ananya-1', { start: start2 })).status, 409, 'completed visits cannot move');
  });
  test('check-in, consult, complete stamps times; feedback once per completed visit', async () => {
    const doctor = await as(DOCTOR), ananya = await as(ANANYA);
    assert.equal((await ananya.patch('c/appointments/apt-ananya-today', { status: 'checked-in' })).body.data.status, 'checked-in');
    await doctor.patch('c/appointments/apt-ananya-today', { status: 'in-consultation' });
    const done = (await doctor.patch('c/appointments/apt-ananya-today', { status: 'completed' })).body.data;
    assert.ok(done.checkedInAt && done.startedAt && done.endedAt);
    assert.equal((await ananya.post('c/feedback', { appointmentId: 'apt-ananya-today', rating: 5 })).status, 201);
    assert.equal((await ananya.post('c/feedback', { appointmentId: 'apt-ananya-today', rating: 4 })).status, 409);
    assert.equal((await ananya.post('c/feedback', { appointmentId: 'apt-ananya-wellness', rating: 4 })).status, 409, 'not completed');
  });
});

describe('consultations, prescriptions, orders', () => {
  test('signing requires acknowledging safety warnings; editing invalidates the signature; patients see only signed', async () => {
    const doctor = await as(DOCTOR), ananya = await as(ANANYA);
    const rx = await doctor.post('c/prescriptions', { patientId: 'pat-ananya', consultationId: 'cns-ananya-2', items: [{ drug: 'Amoxicillin', dose: '500 mg', frequency: 'TDS', durationDays: 5 }] });
    assert.equal(rx.status, 201);
    assert.equal((await ananya.get(`c/prescriptions/${rx.body.data.id}`)).status, 404, 'drafts are hidden');
    const refused = await doctor.post(`prescriptions/${rx.body.data.id}/sign`, {});
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.fieldErrors.warnings[0], /Penicillin/);
    const signed = await doctor.post(`prescriptions/${rx.body.data.id}/sign`, { acknowledgedWarnings: refused.body.error.fieldErrors.warnings });
    assert.equal(signed.body.data.status, 'signed');
    assert.match(signed.body.data.signature, /^[0-9a-f]{64}$/);
    assert.equal((await ananya.get(`c/prescriptions/${rx.body.data.id}`)).status, 200);
    const edited = await doctor.patch(`c/prescriptions/${rx.body.data.id}`, { notes: 'Changed' });
    assert.deepEqual([edited.body.data.status, edited.body.data.signature], ['draft', undefined]);
    assert.equal((await ananya.get(`c/prescriptions/${rx.body.data.id}`)).status, 404);
  });
  test('safety checks find interactions, duplicates, and dose limits', async () => {
    const doctor = await as(DOCTOR);
    const res = await doctor.post('prescriptions/check', { patientId: 'pat-ananya', items: [
      { drug: 'Warfarin', dose: '5 mg', frequency: 'OD', durationDays: 5 }, { drug: 'Ibuprofen', dose: '400 mg', frequency: 'TDS', durationDays: 5 },
      { drug: 'Aspirin', dose: '75 mg', frequency: 'OD', durationDays: 5 }, { drug: 'Paracetamol', dose: '1.5 g', frequency: 'QID', durationDays: 3 }, { drug: 'Paracetamol', dose: '500 mg', frequency: 'OD', durationDays: 3 },
    ] });
    const kinds = new Set((res.body.data as { kind: string }[]).map(w => w.kind));
    assert.deepEqual([...kinds].sort(), ['dose', 'duplicate', 'interaction']);
    assert.equal((await (await as(ANANYA)).post('prescriptions/check', { patientId: 'pat-ananya', items: [] })).status, 403);
  });
  test('finalizing a consultation generates a care summary and notifies the patient', async () => {
    const doctor = await as(DOCTOR);
    const c = await doctor.post('c/consultations', { patientId: 'pat-vikram', appointmentId: 'apt-vikram-today', subjective: 'Tired afternoons', diagnoses: [{ code: 'E11.9', label: 'Type 2 diabetes mellitus without complications' }], plan: 'Continue metformin.' });
    assert.equal(c.status, 201);
    const vikram = await as(VIKRAM);
    assert.equal((await vikram.get(`c/consultations/${c.body.data.id}`)).status, 404, 'drafts hidden');
    const final = await doctor.patch(`c/consultations/${c.body.data.id}`, { status: 'final' });
    assert.match(final.body.data.careSummary, /E11\.9/);
    assert.equal((await vikram.get(`c/consultations/${c.body.data.id}`)).status, 200);
    assert.ok((await data()).notifications.some(n => n.userId === 'usr-vikram' && n.title === 'Visit summary available'));
    assert.equal((await (await extraDoctor()).client.patch(`c/consultations/${c.body.data.id}`, { plan: 'x' })).status, 404, 'other doctors cannot edit');
  });
  test('an abnormal result alerts the doctor and notifies the patient', async () => {
    const doctor = await as(DOCTOR);
    const res = await doctor.patch('c/orders/ord-vikram-hba1c', { status: 'resulted', result: '8.4', unit: '%', referenceRange: '< 5.7', abnormal: true });
    assert.ok(res.body.data.resultedAt);
    const d = await data();
    assert.ok(d.notifications.some(n => n.userId === 'usr-padmanaban' && n.title.startsWith('Abnormal result')));
    assert.ok(d.notifications.some(n => n.userId === 'usr-vikram' && n.title === 'New result available'));
  });
  test('referrals grant the receiving doctor access', async () => {
    const doctor = await as(DOCTOR), other = await extraDoctor(), otherDoctor = other.client;
    assert.equal((await otherDoctor.get('patients/pat-vikram/summary')).status, 404);
    const ref = await doctor.post('c/referrals', { patientId: 'pat-vikram', toDoctorId: other.doctorId, reason: 'Skin review' });
    assert.equal(ref.status, 201);
    assert.equal((await otherDoctor.get('patients/pat-vikram/summary')).status, 200);
    assert.equal((await doctor.patch(`c/referrals/${ref.body.data.id}`, { status: 'accepted' })).status, 403, 'only the receiver changes status');
    assert.equal((await otherDoctor.patch(`c/referrals/${ref.body.data.id}`, { status: 'accepted' })).body.data.status, 'accepted');
  });
});

describe('messages, privacy, admin, reports', () => {
  test('messaging needs a care relationship; only the sender edits; recipient marks read', async () => {
    const ananya = await as(ANANYA), doctor = await as(DOCTOR), other = await extraDoctor();
    assert.equal((await ananya.post('c/messages', { patientId: 'pat-ananya', doctorId: other.doctorId, body: 'Hi' })).status, 403);
    const msg = await ananya.post('c/messages', { patientId: 'pat-ananya', doctorId: 'doc-padmanaban', body: 'Question' });
    assert.equal(msg.body.data.sender, 'patient');
    assert.equal((await doctor.patch(`c/messages/${msg.body.data.id}`, { body: 'Tampered' })).status, 403);
    assert.ok((await doctor.patch(`c/messages/${msg.body.data.id}`, { read: true })).body.data.readAt);
    assert.equal((await doctor.del(`c/messages/${msg.body.data.id}`)).status, 403);
    assert.equal((await ananya.del(`c/messages/${msg.body.data.id}`)).status, 200);
  });
  test('export contains only the account’s data; deletion removes everything', async () => {
    const ananya = await as(ANANYA);
    const exported = (await ananya.get('privacy/export')).body;
    assert.deepEqual(exported.patients.map((p: { id: string }) => p.id).sort(), ['pat-aarav', 'pat-ananya']);
    assert.ok(exported.appointments.every((a: { patientId: string }) => ['pat-aarav', 'pat-ananya'].includes(a.patientId)));
    assert.equal((await ananya.post('privacy/delete-account', { confirm: 'nope' })).status, 422);
    assert.equal((await ananya.post('privacy/delete-account', { confirm: 'DELETE' })).status, 200);
    const d = await data();
    assert.ok(!d.users.some(u => u.id === 'usr-ananya'));
    for (const rows of [d.patients.map(p => ({ patientId: p.id })), d.appointments, d.consultations, d.prescriptions, d.orders, d.messages, d.allergies]) {
      assert.ok(!rows.some(r => ['pat-ananya', 'pat-aarav'].includes(r.patientId)));
    }
    assert.equal((await ananya.get('auth/session')).status, 401);
  });
  test('admin manages verification and users within limits', async () => {
    const admin = await as(ADMIN);
    const pending = await extraDoctor(true);
    assert.ok(!(await (await as(ANANYA)).get('directory')).body.data.some((d: { id: string }) => d.id === pending.doctorId));
    assert.equal((await admin.post(`admin/doctors/${pending.doctorId}/verification`, { verification: 'verified' })).body.data.verification, 'verified');
    assert.ok((await (await as(ANANYA)).get('directory')).body.data.some((d: { id: string }) => d.id === pending.doctorId));
    assert.equal((await admin.post('c/users', { role: 'patient', name: 'X', email: 'x@example.com', phone: '1' })).status, 422);
    assert.equal((await admin.post('c/users', { role: 'admin', name: 'Second Admin', email: 'admin2@example.com', phone: '+91 2' })).status, 201);
    assert.equal((await admin.del('c/users/usr-padmanaban')).status, 409, 'doctor with clinical records');
    assert.equal((await admin.del('c/users/usr-admin')).status, 403, 'cannot delete self');
    assert.equal((await admin.get('admin/analytics')).body.data.patients, 4);
    assert.equal((await (await as(DOCTOR)).get('admin/analytics')).status, 403);
  });
  test('documents stream only to people with access', async () => {
    const ananya = await as(ANANYA), doctor = await as(DOCTOR), vikram = await as(VIKRAM);
    const ok = await call(ananya.cookie, 'GET', 'documents/doc-ananya-lipid/file');
    assert.equal(ok.status, 200);
    assert.equal((await call(doctor.cookie, 'GET', 'documents/doc-ananya-lipid/file')).status, 200);
    assert.equal((await call(vikram.cookie, 'GET', 'documents/doc-ananya-lipid/file')).status, 404);
  });
  test('patients upload prescriptions that their doctor sees in the record', async () => {
    const ananya = await as(ANANYA), doctor = await as(DOCTOR), vikram = await as(VIKRAM);
    const seeded = (await ananya.get('c/documents?patientId=pat-ananya&category=prescription')).body.data;
    assert.equal(seeded.length, 1, 'one sample prescription per patient');
    assert.equal((await call(ananya.cookie, 'GET', `documents/${seeded[0].id}/file`)).status, 200);
    for (const id of ['doc-aarav-rx-upload', 'doc-vikram-rx-upload', 'doc-meera-rx-upload']) assert.ok((await data()).documents.some(d => d.id === id));
    const fields = { patientId: 'pat-ananya', title: 'Prescription: migraine', category: 'prescription', documentDate: '2026-09-01', issuedBy: 'Dr. Outside, City Clinic', notes: 'Walk-in visit' };
    const res = await upload(ananya.cookie, fields);
    assert.equal(res.status, 201);
    assert.deepEqual([res.body.data.storage, res.body.data.issuedBy, res.body.data.notes, res.body.data.uploadedBy], ['upload', 'Dr. Outside, City Clinic', 'Walk-in visit', 'usr-ananya']);
    const summary = (await doctor.get('patients/pat-ananya/summary')).body.data;
    assert.ok(summary.documents.some((d: { title: string; category: string }) => d.title === 'Prescription: migraine' && d.category === 'prescription'));
    assert.ok((await data()).notifications.some(n => n.userId === 'usr-padmanaban' && n.title === 'New prescription uploaded'));
    assert.equal((await doctor.get(`documents/${res.body.data.id}/file`)).status, 200);
    assert.equal((await upload(vikram.cookie, fields)).status, 403, "cannot upload into another patient's record");
    assert.equal((await ananya.patch(`c/documents/${res.body.data.id}`, { issuedBy: null, notes: 'Edited' })).body.data.issuedBy, undefined);
  });
  test('doctor performance totals completed visits and ratings', async () => {
    const perf = (await (await as(DOCTOR)).get('doctor/performance')).body.data;
    assert.deepEqual([perf.consultations, perf.earnings, perf.noShows, perf.ratingCount], [4, 1000 + 600 + 1000 + 1000, 1, 3]);
  });
});

describe('store', () => {
  test('a failure before the write leaves the file unchanged', async () => {
    const before = JSON.stringify(await data());
    store.beforeCommit = () => { throw new Error('injected'); };
    const a = await as(ANANYA).catch(e => e);
    store.beforeCommit = undefined;
    assert.ok(a instanceof Error, 'login could not commit its session');
    assert.equal(JSON.stringify(await data()), before);
  });
  test('concurrent writes are serialised without lost updates', async () => {
    const ananya = await as(ANANYA);
    await Promise.all(Array.from({ length: 10 }, (_, i) => ananya.post('c/vitals', { patientId: 'pat-ananya', recordedAt: new Date(Date.now() - i * 60_000).toISOString(), pulse: 70 + i, source: 'manual' })));
    assert.equal((await data()).vitals.filter(v => v.patientId === 'pat-ananya').length, 13);
  });
  test('a corrupt data file returns 503 and reset recovers it', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(store.filePath, '{ broken');
    assert.equal((await call(null, 'GET', 'auth/demo-accounts')).status, 503);
    const { makeSeedData } = await import('../demo/seed-data');
    assert.equal(await store.seed(makeSeedData(), true), true);
    assert.equal((await call(null, 'GET', 'auth/demo-accounts')).status, 200);
  });
});
