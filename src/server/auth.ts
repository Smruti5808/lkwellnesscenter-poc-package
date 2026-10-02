// Demo authentication: any active account signs in with its email or phone and the shared PIN 1234.
// Sessions are opaque random tokens; only their hash is stored. Sessions expire after 30 idle minutes or 8 hours.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DEMO_PIN, doctorInput, patientInput, type Data, type SessionInfo, type User } from '../shared/schemas';
import { ApiError, audit, conflict, invalid, newId, notify, nowIso, type Ctx } from './context';
import { managedPatientIds } from './access';
import { refillReminders } from './clinical';
import { formatDate } from '../shared/time';

export const COOKIE = 'lkw_session';
export const IDLE_MS = 30 * 60_000;
export const MAX_MS = 8 * 3_600_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const failures = new Map<string, number[]>();

export const loginInput = z.object({ identifier: z.string().trim().min(3).max(160), pin: z.string().max(20) }).strict();
export const registerPatientInput = patientInput.omit({ guardianPatientId: true, relationship: true }).extend({
  email: z.email().max(160), phone: z.string().trim().min(6).max(30), acceptTerms: z.literal(true, 'You must accept the terms.'),
  telemedicineConsent: z.boolean().default(false), dataSharingConsent: z.boolean().default(false),
}).strict();
export const registerDoctorInput = doctorInput.extend({ email: z.email().max(160), phone: z.string().trim().min(6).max(30) }).strict();

function pinMatches(pin: string) {
  const a = Buffer.from(hash(pin), 'hex'), b = Buffer.from(hash(DEMO_PIN), 'hex');
  return timingSafeEqual(a, b);
}

export function startSession(data: Data, user: User): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  data.sessions = data.sessions.filter(s => Date.parse(s.expiresAt) > now && now - Date.parse(s.lastSeenAt) < IDLE_MS);
  data.sessions.push({ id: newId(), tokenHash: hash(token), userId: user.id, createdAt: new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(), expiresAt: new Date(now + MAX_MS).toISOString() });
  audit(data, { user }, 'SIGN_IN', { detail: user.role });
  return token;
}

export function login(data: Data, input: z.output<typeof loginInput>): { user: User; token: string } {
  const key = input.identifier.toLowerCase();
  const recent = (failures.get(key) ?? []).filter(t => Date.now() - t < 60_000);
  if (recent.length >= 5) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
  const user = data.users.find(u => u.active && (u.email.toLowerCase() === key || u.phone.replace(/\s/g, '') === input.identifier.replace(/\s/g, '')));
  if (!user || !pinMatches(input.pin)) {
    failures.set(key, [...recent, Date.now()]);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Account or PIN not recognised. The demo PIN is 1234.');
  }
  failures.delete(key);
  return { user, token: startSession(data, user) };
}

/** Resolves the session cookie to a request context, extending the idle timer. */
export function resolveSession(data: Data, token: string | undefined, requestId: string): Ctx {
  const now = Date.now();
  const session = token ? data.sessions.find(s => s.tokenHash === hash(token)) : undefined;
  const user = session && data.users.find(u => u.id === session.userId && u.active);
  if (!session || !user || Date.parse(session.expiresAt) <= now || now - Date.parse(session.lastSeenAt) >= IDLE_MS) {
    throw new ApiError(401, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
  }
  if (now - Date.parse(session.lastSeenAt) > 60_000) session.lastSeenAt = new Date(now).toISOString();
  return { requestId, user, patientIds: managedPatientIds(data, user), doctor: user.doctorId ? data.doctors.find(d => d.id === user.doctorId) : undefined };
}

export function endSession(data: Data, token: string | undefined) {
  const session = token ? data.sessions.find(s => s.tokenHash === hash(token)) : undefined;
  if (!session) return;
  data.sessions = data.sessions.filter(s => s.id !== session.id);
  const user = data.users.find(u => u.id === session.userId);
  if (user) audit(data, { user }, 'SIGN_OUT');
}

export function sessionInfo(data: Data, ctx: Ctx, token: string): SessionInfo {
  const session = data.sessions.find(s => s.tokenHash === hash(token))!;
  if (ctx.user.role === 'patient') for (const r of refillReminders(data).filter(r => r.userId === ctx.user.id)) notify(data, r.userId, `Refill due: ${r.medication}`, `Refill by ${formatDate(r.refillDate)}.`, '/patient/health', r.key);
  const expiresAt = new Date(Math.min(Date.parse(session.expiresAt), Date.parse(session.lastSeenAt) + IDLE_MS)).toISOString();
  return { user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role, email: ctx.user.email }, patientId: ctx.user.patientId, doctorId: ctx.user.doctorId, doctorVerification: ctx.doctor?.verification, expiresAt };
}

function assertUnique(data: Data, email: string, phone: string) {
  if (data.users.some(u => u.email.toLowerCase() === email.toLowerCase() || u.phone.replace(/\s/g, '') === phone.replace(/\s/g, ''))) throw conflict('An account with this email or phone already exists. Sign in instead.');
}

export function registerPatient(data: Data, input: z.output<typeof registerPatientInput>): User {
  assertUnique(data, input.email, input.phone);
  const at = nowIso(), userId = newId(), patientId = newId();
  const { acceptTerms: _terms, telemedicineConsent, dataSharingConsent, ...profile } = input;
  const user: User = { id: userId, createdAt: at, updatedAt: at, role: 'patient', name: input.name, email: input.email, phone: input.phone, active: true, notificationChannels: ['push', 'email'], patientId };
  data.users.push(user);
  data.patients.push({ id: patientId, createdAt: at, updatedAt: at, userId, ...profile });
  for (const [kind, granted] of [['terms', true], ['telemedicine', telemedicineConsent], ['dataSharing', dataSharingConsent]] as const) {
    data.consents.push({ id: newId(), createdAt: at, updatedAt: at, patientId, kind, granted });
  }
  audit(data, { user }, 'REGISTER', { patientId });
  return user;
}

export function registerDoctor(data: Data, input: z.output<typeof registerDoctorInput>): User {
  assertUnique(data, input.email, input.phone);
  const at = nowIso(), userId = newId(), doctorId = newId();
  const { email, phone, ...profile } = input;
  const user: User = { id: userId, createdAt: at, updatedAt: at, role: 'doctor', name: input.name, email, phone, active: true, notificationChannels: ['push', 'email'], doctorId };
  data.users.push(user);
  data.doctors.push({ id: doctorId, createdAt: at, updatedAt: at, userId, verification: 'pending', ...profile });
  data.appointmentTypes.push({ id: newId(), createdAt: at, updatedAt: at, doctorId, name: 'Consultation', durationMinutes: 20, fee: 500 });
  audit(data, { user }, 'REGISTER');
  for (const admin of data.users.filter(u => u.role === 'admin')) notify(data, admin.id, 'Doctor awaiting verification', `${input.name} (${input.specialty}) registered.`, '/admin/doctors');
  return user;
}

export function requireRole(ctx: Ctx, ...roles: User['role'][]) {
  if (!roles.includes(ctx.user.role)) throw new ApiError(403, 'FORBIDDEN', 'This area is for another account type.');
}
export const assertValid = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid('Please check the highlighted fields.', z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  return result.data;
};
