// HTTP routing for /api/v1. Responses use { data } or { error: { code, message, fieldErrors } }.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prescriptionItem, type CollectionName, type Data, type DocumentRow } from '../shared/schemas';
import { istDate } from '../shared/time';
import { ApiError, audit, conflict, forbidden, invalid, newId, notFound, notify, nowIso, accountOfPatient, type Ctx } from './context';
import { accessiblePatientIds, canAccessPatient } from './access';
import { COOKIE, MAX_MS, assertValid, endSession, login, loginInput, registerDoctor, registerDoctorInput, registerPatient, registerPatientInput, requireRole, resolveSession, sessionInfo, startSession } from './auth';
import { analytics, careSummary, deletePatients, doctorPerformance, patientSummary, safetyCheck, signatureFor } from './clinical';
import { computeSlots, nextAvailable } from './scheduling';
import { ruleFor } from './collections';
import * as crud from './crud';
import { getStorage } from './storage';

const JSON_LIMIT = 256 * 1024;
const UPLOAD_LIMIT = 5 * 1024 * 1024;
const UPLOAD_TYPES: Record<string, string> = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' };

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(400, 'INVALID_JSON', 'Send a JSON request body.');
  const text = await request.text();
  if (text.length > JSON_LIMIT) throw new ApiError(413, 'TOO_LARGE', 'The request is too large.');
  try { return text ? JSON.parse(text) : {}; } catch { throw new ApiError(400, 'INVALID_JSON', 'Malformed JSON.'); }
}

/** Rejects cross-site writes: the browser's Origin must match the host serving the app. */
function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? new URL(request.url).host;
  let originHost = '';
  try { originHost = origin ? new URL(origin).host : ''; } catch { /* malformed origin */ }
  if (originHost !== host) throw new ApiError(403, 'ORIGIN_DENIED', 'Request origin was rejected.');
}

const ok = (data: unknown, status = 200) => Response.json({ data }, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: ApiError, requestId: string) => Response.json({ error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors }, meta: { requestId } }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
function withCookie(response: Response, request: Request, token: string) {
  response.headers.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? MAX_MS / 1000 : 0}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`);
  return response;
}

function directory(data: Data) {
  return data.doctors.filter(d => d.verification === 'verified' && data.users.find(u => u.id === d.userId)?.active).map(d => {
    const feedback = data.feedback.filter(f => f.doctorId === d.id);
    const types = data.appointmentTypes.filter(t => t.doctorId === d.id);
    return {
      ...d, types, minFee: types.length ? Math.min(...types.map(t => t.fee)) : null,
      rating: feedback.length ? Math.round((feedback.reduce((s, f) => s + f.rating, 0) / feedback.length) * 10) / 10 : null,
      ratingCount: feedback.length, nextAvailable: nextAvailable(data, d.id) ?? null,
    };
  });
}

function patientList(data: Data, ctx: Ctx) {
  return accessiblePatientIds(data, ctx).map(id => {
    const p = data.patients.find(x => x.id === id)!;
    const mine = data.appointments.filter(a => a.patientId === id && a.doctorId === ctx.doctor?.id);
    const past = mine.filter(a => a.status === 'completed').sort((a, b) => b.start.localeCompare(a.start))[0];
    const next = mine.filter(a => ['requested', 'confirmed', 'checked-in'].includes(a.status) && a.end > nowIso()).sort((a, b) => a.start.localeCompare(b.start))[0];
    return { id, name: p.name, dateOfBirth: p.dateOfBirth, gender: p.gender, phone: p.phone, lastVisit: past?.start ?? null, nextAppointment: next?.start ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function handleUpload(request: Request, data: Data, ctx: Ctx) {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw invalid('Choose a file to upload.', { file: ['Required'] });
  if (file.size > UPLOAD_LIMIT) throw invalid('Files must be 5 MB or smaller.', { file: ['Too large'] });
  const extension = UPLOAD_TYPES[file.type];
  if (!extension) throw invalid('Upload a PDF, PNG, or JPEG file.', { file: ['Unsupported type'] });
  const optional = (key: string) => (form.get(key) === null ? {} : { [key]: form.get(key) });
  const meta = ruleFor('documents').input!.safeParse({ patientId: form.get('patientId'), title: form.get('title'), category: form.get('category'), documentDate: form.get('documentDate'), ...optional('issuedBy'), ...optional('notes') });
  if (!meta.success) throw invalid('Please check the highlighted fields.', z.flattenError(meta.error).fieldErrors as Record<string, string[]>);
  const fields = meta.data as { patientId: string; title: string; category: DocumentRow['category']; documentDate: string; issuedBy?: string; notes?: string };
  if (!canAccessPatient(data, ctx, fields.patientId)) throw forbidden();
  const id = newId(), fileName = `${id}${extension}`, at = nowIso();
  await (await getStorage()).writeUpload(fileName, new Uint8Array(await file.arrayBuffer()), file.type);
  const row = { id, createdAt: at, updatedAt: at, ...fields, fileName, mimeType: file.type, byteSize: file.size, storage: 'upload' as const, uploadedBy: ctx.user.id };
  data.documents.push(row);
  audit(data, ctx, 'CREATE', { collection: 'documents', recordId: id, patientId: fields.patientId });
  if (ctx.user.role === 'patient') {
    for (const doctorId of new Set(data.appointments.filter(a => a.patientId === fields.patientId && ['requested', 'confirmed', 'checked-in'].includes(a.status)).map(a => a.doctorId))) {
      notify(data, data.doctors.find(d => d.id === doctorId)?.userId, fields.category === 'prescription' ? 'New prescription uploaded' : 'New document uploaded',`${data.patients.find(p => p.id === fields.patientId)?.name}: ${fields.title}`, `/doctor/patients/${fields.patientId}`);
    }
  }
  return row;
}

export async function handleApi(request: Request, segments: string[]): Promise<Response> {
  const requestId = randomUUID();
  const method = request.method;
  const route = segments.join('/');
  try {
    if (method !== 'GET') checkOrigin(request);
    const isUpload = route === 'documents/upload' && method === 'POST';
    const body = ['POST', 'PATCH'].includes(method) && !isUpload ? await readJson(request) : undefined;
    const token = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

    const storage = await getStorage();
    return await storage.transaction(async data => {
      // ---- Public ----
      if (route === 'auth/demo-accounts' && method === 'GET') {
        return ok(data.users.filter(u => u.active).map(u => ({ name: u.name, role: u.role, email: u.email, detail: u.role === 'doctor' ? data.doctors.find(d => d.id === u.doctorId)?.specialty : u.role === 'patient' ? 'Patient' : 'Administrator', pending: u.role === 'doctor' && data.doctors.find(d => d.id === u.doctorId)?.verification !== 'verified' })));
      }
      if (route === 'auth/login' && method === 'POST') {
        const { user, token: fresh } = login(data, assertValid(loginInput, body));
        return withCookie(ok({ role: user.role }), request, fresh);
      }
      if ((route === 'auth/register/patient' || route === 'auth/register/doctor') && method === 'POST') {
        const user = route.endsWith('patient') ? registerPatient(data, assertValid(registerPatientInput, body)) : registerDoctor(data, assertValid(registerDoctorInput, body));
        return withCookie(ok({ role: user.role }, 201), request, startSession(data, user));
      }

      // ---- Signed in ----
      const ctx = resolveSession(data, token, requestId);
      if (route === 'auth/session' && method === 'GET') return ok(sessionInfo(data, ctx, token!));
      if (route === 'auth/session' && method === 'DELETE') { endSession(data, token); return withCookie(ok({ signedOut: true }), request, ''); }

      if (route === 'directory' && method === 'GET') return ok(directory(data));
      if (segments[0] === 'doctors' && segments[2] === 'slots' && method === 'GET') {
        const q = new URL(request.url).searchParams;
        const days = Math.min(Number(q.get('days') ?? 14) || 14, 30);
        return ok(computeSlots(data, { doctorId: segments[1], typeId: q.get('typeId') ?? '', from: q.get('from') ?? istDate(), days, excludeAppointmentId: q.get('exclude') ?? undefined }));
      }

      if (route === 'my/patients' && method === 'GET') { requireRole(ctx, 'doctor'); return ok(patientList(data, ctx)); }
      if (segments[0] === 'patients' && segments[2] === 'summary' && method === 'GET') {
        const patient = data.patients.find(p => p.id === segments[1]);
        if (!patient || !canAccessPatient(data, ctx, patient.id)) throw notFound();
        if (ctx.user.role === 'doctor') audit(data, ctx, 'RECORD_VIEWED', { patientId: patient.id });
        return ok(patientSummary(data, patient, ctx.user.role === 'doctor' ? 'doctor' : 'patient', ctx.doctor?.id));
      }

      if (route === 'prescriptions/check' && method === 'POST') {
        requireRole(ctx, 'doctor');
        const input = assertValid(z.object({ patientId: z.string(), items: z.array(prescriptionItem).max(20) }).strict(), body);
        if (!canAccessPatient(data, ctx, input.patientId)) throw notFound();
        return ok(safetyCheck(data, input.patientId, input.items));
      }
      if (segments[0] === 'prescriptions' && segments[2] === 'sign' && method === 'POST') {
        requireRole(ctx, 'doctor');
        const input = assertValid(z.object({ acknowledgedWarnings: z.array(z.string()).max(50).default([]) }).strict(), body);
        const rx = data.prescriptions.find(p => p.id === segments[1]);
        if (!rx || rx.doctorId !== ctx.doctor?.id || !canAccessPatient(data, ctx, rx.patientId)) throw notFound();
        if (rx.status === 'signed') throw conflict('Already signed. Edit the prescription to sign a new version.');
        const warnings = safetyCheck(data, rx.patientId, rx.items).map(w => w.message);
        const missing = warnings.filter(w => !input.acknowledgedWarnings.includes(w));
        if (missing.length) throw new ApiError(409, 'SAFETY_WARNINGS', 'Review and acknowledge the safety warnings before signing.', { warnings: missing });
        rx.signedAt = nowIso(); rx.status = 'signed'; rx.acknowledgedWarnings = warnings; rx.updatedAt = rx.signedAt;
        rx.signature = signatureFor(rx, ctx.doctor!, rx.signedAt);
        audit(data, ctx, 'PRESCRIPTION_SIGNED', { collection: 'prescriptions', recordId: rx.id, patientId: rx.patientId });
        notify(data, accountOfPatient(data, rx.patientId), 'New e-prescription', `${ctx.doctor!.name} issued a prescription.`, `/patient/prescriptions/${rx.id}`);
        return ok(rx);
      }
      if (segments[0] === 'consultations' && segments[2] === 'care-summary' && method === 'POST') {
        requireRole(ctx, 'doctor');
        const c = data.consultations.find(x => x.id === segments[1]);
        if (!c || c.doctorId !== ctx.doctor?.id || !canAccessPatient(data, ctx, c.patientId)) throw notFound();
        c.careSummary = careSummary(data, c); c.updatedAt = nowIso();
        audit(data, ctx, 'UPDATE', { collection: 'consultations', recordId: c.id, patientId: c.patientId, detail: 'careSummary' });
        return ok(c);
      }

      if (isUpload) return ok(await handleUpload(request, data, ctx), 201);
      if (segments[0] === 'documents' && segments[2] === 'file' && method === 'GET') {
        const doc = data.documents.find(d => d.id === segments[1]);
        if (!doc || !canAccessPatient(data, ctx, doc.patientId)) throw notFound();
        const bytes = await storage.readDocument(doc).catch(() => { throw new ApiError(404, 'FILE_MISSING', 'The file for this document is missing.'); });
        if (ctx.user.role === 'doctor') audit(data, ctx, 'DOCUMENT_VIEWED', { recordId: doc.id, patientId: doc.patientId });
        return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': doc.mimeType, 'Content-Disposition': `inline; filename="${doc.fileName}"`, 'Cache-Control': 'private, no-store' } });
      }

      if (route === 'privacy/export' && method === 'GET') {
        requireRole(ctx, 'patient');
        const ids = new Set(ctx.patientIds);
        const mine = <T extends { patientId?: string }>(rows: T[]) => rows.filter(r => r.patientId && ids.has(r.patientId));
        const exported = {
          exportedAt: nowIso(), account: ctx.user, patients: data.patients.filter(p => ids.has(p.id)),
          consents: mine(data.consents), conditions: mine(data.conditions), allergies: mine(data.allergies), medications: mine(data.medications), doseLogs: mine(data.doseLogs),
          vitals: mine(data.vitals), documents: mine(data.documents), appointments: mine(data.appointments), consultations: mine(data.consultations).filter(c => c.status === 'final'),
          prescriptions: mine(data.prescriptions).filter(p => p.status === 'signed'), orders: mine(data.orders), messages: mine(data.messages), referrals: mine(data.referrals),
          feedback: mine(data.feedback), accessBlocks: mine(data.accessBlocks), accessLog: mine(data.audit),
        };
        audit(data, ctx, 'DATA_EXPORTED', { patientId: ctx.user.patientId });
        return new Response(JSON.stringify(exported, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="my-health-data-${istDate()}.json"`, 'Cache-Control': 'no-store' } });
      }
      if (route === 'privacy/delete-account' && method === 'POST') {
        requireRole(ctx, 'patient');
        assertValid(z.object({ confirm: z.literal('DELETE', 'Type DELETE to confirm.') }).strict(), body);
        const uploads = data.documents.filter(d => d.storage === 'upload' && ctx.patientIds.includes(d.patientId)).map(d => d.fileName);
        deletePatients(data, ctx.patientIds);
        data.users = data.users.filter(u => u.id !== ctx.user.id);
        data.sessions = data.sessions.filter(s => s.userId !== ctx.user.id);
        data.notifications = data.notifications.filter(n => n.userId !== ctx.user.id);
        audit(data, null, 'ACCOUNT_DELETED', { detail: `${ctx.patientIds.length} patient record(s)` });
        for (const file of uploads) await storage.deleteUpload(file);
        return withCookie(ok({ deleted: true }), request, '');
      }

      if (route === 'doctor/performance' && method === 'GET') { requireRole(ctx, 'doctor'); return ok(doctorPerformance(data, ctx.doctor!.id)); }
      if (route === 'notifications/read-all' && method === 'POST') {
        const at = nowIso();
        for (const n of data.notifications) if (n.userId === ctx.user.id && !n.readAt) { n.readAt = at; n.updatedAt = at; }
        return ok({ done: true });
      }

      if (segments[0] === 'admin') {
        requireRole(ctx, 'admin');
        if (route === 'admin/analytics' && method === 'GET') return ok(analytics(data));
        if (segments[1] === 'doctors' && segments[3] === 'verification' && method === 'POST') {
          const { verification } = assertValid(z.object({ verification: z.enum(['pending', 'verified', 'rejected']) }).strict(), body);
          const doctor = data.doctors.find(d => d.id === segments[2]);
          if (!doctor) throw notFound();
          doctor.verification = verification; doctor.updatedAt = nowIso();
          audit(data, ctx, 'DOCTOR_VERIFICATION', { collection: 'doctors', recordId: doctor.id, detail: verification });
          notify(data, doctor.userId, `Profile ${verification}`, verification === 'verified' ? 'Your profile is live. Patients can now book with you.' : `Verification status: ${verification}.`, '/doctor');
          return ok(doctor);
        }
      }

      // ---- Generic CRUD: /c/{collection}[/{id}] ----
      if (segments[0] === 'c' && segments.length >= 2 && segments.length <= 3) {
        const name = segments[1] as CollectionName;
        const rule = ruleFor(name);
        const id = segments[2];
        if (!id && method === 'GET') return ok(crud.list(rule, data, ctx, name, Object.fromEntries(new URL(request.url).searchParams)));
        if (!id && method === 'POST') return ok(await crud.create(rule, data, ctx, name, body), 201);
        if (id && method === 'GET') return ok(crud.read(rule, data, ctx, name, id));
        if (id && method === 'PATCH') return ok(await crud.update(rule, data, ctx, name, id, body));
        if (id && method === 'DELETE') return ok(await crud.remove(rule, data, ctx, name, id));
      }
      throw notFound();
    });
  } catch (error) {
    if (error instanceof ApiError) return fail(error, requestId);
    console.error(JSON.stringify({ requestId, route, error: (error as Error).message }));
    return fail(new ApiError(503, 'STORE_UNAVAILABLE', 'The data store is unavailable. Check the server and retry.'), requestId);
  }
}
