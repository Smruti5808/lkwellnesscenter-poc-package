import { randomUUID } from 'node:crypto';
import type { Data, Doctor, User } from '../shared/schemas';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors: Record<string, string[]> = {}) { super(message); }
}
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'This record is unavailable.');
export const forbidden = (message = 'You do not have permission for this action.') => new ApiError(403, 'FORBIDDEN', message);
export const conflict = (message: string, code = 'CONFLICT') => new ApiError(409, code, message);
export const invalid = (message: string, fieldErrors: Record<string, string[]> = {}) => new ApiError(422, 'VALIDATION_ERROR', message, fieldErrors);

/** Who is making the request. `patientIds` are the patient records this user manages (self and dependents). */
export type Ctx = { requestId: string; user: User; patientIds: string[]; doctor?: Doctor };

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();

export function audit(data: Data, ctx: Pick<Ctx, 'user'> | null, action: string, fields: { collection?: string; recordId?: string; patientId?: string; detail?: string } = {}) {
  data.audit.push({ id: newId(), at: nowIso(), ...(ctx ? { actorUserId: ctx.user.id } : {}), action, ...fields });
}

/** In-app notification. Push/SMS/email delivery is simulated: the user's chosen channels are recorded on the message. */
export function notify(data: Data, userId: string | undefined, title: string, body: string, link?: string, dedupeKey?: string) {
  const user = data.users.find(u => u.id === userId);
  if (!user || !user.active) return;
  if (dedupeKey && data.notifications.some(n => n.userId === user.id && n.dedupeKey === dedupeKey)) return;
  const at = nowIso();
  data.notifications.push({ id: newId(), createdAt: at, updatedAt: at, userId: user.id, title, body, channels: user.notificationChannels, ...(link ? { link } : {}), ...(dedupeKey ? { dedupeKey } : {}) });
}

export const userOfDoctor = (data: Data, doctorId: string) => data.doctors.find(d => d.id === doctorId)?.userId;
/** The login account responsible for a patient (the patient, or the guardian for a dependent). */
export function accountOfPatient(data: Data, patientId: string): string | undefined {
  const patient = data.patients.find(p => p.id === patientId);
  if (!patient) return undefined;
  if (patient.userId) return patient.userId;
  return patient.guardianPatientId ? accountOfPatient(data, patient.guardianPatientId) : undefined;
}
