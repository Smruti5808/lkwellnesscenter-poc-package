// Shared data contract for the whole app. Every collection in the JSON store is described here.
// Each `*Input` schema lists the fields a client may send; ids, timestamps, and ownership are set by the server.
import { z } from 'zod';

const text = (max = 500) => z.string().trim().max(max);
const required = (max = 200) => z.string().trim().min(1, 'Required').max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const dateTime = z.iso.datetime({ offset: true });
const id = z.string().min(1).max(80);
const optionalNumber = (min: number, max: number) => z.number().min(min).max(max).optional();

export const ROLES = ['patient', 'doctor', 'admin'] as const;
export const CHANNELS = ['push', 'sms', 'email'] as const;
export const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'rejected', 'cancelled', 'checked-in', 'in-consultation', 'completed', 'no-show'] as const;
/** Statuses that occupy a slot in the doctor's calendar. */
export const ACTIVE_APPOINTMENT = ['requested', 'confirmed', 'checked-in', 'in-consultation', 'completed'] as const;

export const userInput = z.object({
  role: z.enum(ROLES), name: required(120), email: z.email().max(160), phone: text(30),
  active: z.boolean().default(true), notificationChannels: z.array(z.enum(CHANNELS)).max(3).default(['push']),
}).strict();

export const patientInput = z.object({
  name: required(120), dateOfBirth: date, gender: z.enum(['female', 'male', 'other', 'undisclosed']),
  phone: text(30).optional(), email: text(160).optional(), address: text(300).optional(), bloodGroup: text(5).optional(),
  emergencyContactName: text(120).optional(), emergencyContactPhone: text(30).optional(),
  guardianPatientId: id.optional(), relationship: text(40).optional(),
}).strict();

export const consentInput = z.object({
  patientId: id, kind: z.enum(['terms', 'telemedicine', 'dataSharing']), granted: z.boolean(),
}).strict();

export const conditionInput = z.object({
  patientId: id, category: z.enum(['past', 'chronic', 'surgery', 'hospitalization', 'family']),
  name: required(160), date: date.optional(), relation: text(60).optional(), notes: text(1000).optional(),
}).strict();

export const allergyInput = z.object({
  patientId: id, category: z.enum(['drug', 'food', 'environmental']), substance: required(120),
  reaction: text(300).optional(), severity: z.enum(['mild', 'moderate', 'severe']),
}).strict();

export const medicationInput = z.object({
  patientId: id, name: required(120), dose: text(60).optional(), frequency: text(60).optional(),
  startDate: date.optional(), refillDate: date.optional(), active: z.boolean().default(true),
}).strict();

export const doseLogInput = z.object({ patientId: id, medicationId: id, date, taken: z.boolean() }).strict();

export const vitalInput = z.object({
  patientId: id, recordedAt: dateTime, heightCm: optionalNumber(30, 250), weightKg: optionalNumber(1, 400),
  systolic: optionalNumber(40, 300), diastolic: optionalNumber(20, 200), pulse: optionalNumber(20, 250),
  glucoseMgDl: optionalNumber(10, 900), spo2: optionalNumber(50, 100), source: z.enum(['manual', 'device', 'clinic']).default('manual'),
}).strict();

export const documentInput = z.object({
  patientId: id, title: required(160), category: z.enum(['lab', 'imaging', 'discharge', 'prescription', 'other']), documentDate: date,
  issuedBy: text(160).optional(), notes: text(1000).optional(),
}).strict();

export const doctorInput = z.object({
  name: required(120), councilNumber: required(60), licenseNumber: required(60), specialty: required(80),
  qualifications: required(200), bio: text(1500).optional(), languages: z.array(required(40)).min(1).max(10),
  clinic: required(160), clinicAddress: text(300).optional(), experienceYears: z.number().int().min(0).max(70).optional(),
}).strict();

export const appointmentTypeInput = z.object({
  name: required(80), durationMinutes: z.number().int().min(5).max(240), fee: z.number().min(0).max(100000),
}).strict();

export const scheduleInput = z.object({
  weekday: z.number().int().min(0).max(6), start: time, end: time,
  breakStart: time.optional(), breakEnd: time.optional(), bufferMinutes: z.number().int().min(0).max(120).default(0),
}).strict().refine(s => s.start < s.end, 'End must be after start').refine(s => !s.breakStart === !s.breakEnd, 'Give both break times or neither');

export const leaveInput = z.object({ startDate: date, endDate: date, reason: text(200).optional() }).strict()
  .refine(l => l.startDate <= l.endDate, 'End date must be on or after start date');

export const intakeSchema = z.object({
  chiefComplaint: text(300), symptoms: text(1000).optional(), duration: text(100).optional(),
  fever: z.boolean().optional(), takingMedication: z.boolean().optional(), notes: text(1000).optional(),
}).strict();

export const appointmentInput = z.object({
  patientId: id, doctorId: id, typeId: id, start: dateTime, reason: text(300).optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(), intake: intakeSchema.optional(), cancelReason: text(300).optional(),
}).strict();

export const diagnosisSchema = z.object({ code: required(12), label: required(200) }).strict();
export const consultationInput = z.object({
  appointmentId: id.optional(), patientId: id, subjective: text(4000).default(''), objective: text(4000).default(''),
  assessment: text(4000).default(''), plan: text(4000).default(''), diagnoses: z.array(diagnosisSchema).max(20).default([]),
  followUpDate: date.optional(), status: z.enum(['draft', 'final']).default('draft'), careSummary: text(6000).optional(),
}).strict();

export const prescriptionItem = z.object({
  drug: required(120), strength: text(40).optional(), dose: required(40), frequency: z.enum(['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS']),
  durationDays: z.number().int().min(1).max(365), instructions: text(300).optional(),
}).strict();
export const prescriptionInput = z.object({
  consultationId: id.optional(), patientId: id, items: z.array(prescriptionItem).min(1).max(20), notes: text(1000).optional(),
}).strict();
export const favoriteInput = z.object({ name: required(80), items: z.array(prescriptionItem).min(1).max(20) }).strict();

export const orderInput = z.object({
  patientId: id, consultationId: id.optional(), kind: z.enum(['lab', 'imaging']), test: required(160),
  status: z.enum(['ordered', 'resulted', 'cancelled']).default('ordered'), result: text(2000).optional(),
  unit: text(30).optional(), referenceRange: text(60).optional(), abnormal: z.boolean().optional(),
}).strict();

export const messageInput = z.object({ patientId: id, doctorId: id, body: required(2000), read: z.boolean().optional() }).strict();
export const referralInput = z.object({
  patientId: id, toDoctorId: id, reason: required(1000), status: z.enum(['sent', 'accepted', 'declined', 'completed']).default('sent'),
}).strict();
export const feedbackInput = z.object({ appointmentId: id, rating: z.number().int().min(1).max(5), comment: text(1000).optional() }).strict();
export const notificationInput = z.object({ read: z.boolean() }).strict();
export const accessBlockInput = z.object({ patientId: id, doctorId: id, reason: text(300).optional() }).strict();

type Row = { id: string; createdAt: string; updatedAt: string };
export type User = Row & z.output<typeof userInput> & { patientId?: string; doctorId?: string };
export type Patient = Row & z.output<typeof patientInput> & { userId?: string };
export type Consent = Row & z.output<typeof consentInput>;
export type Condition = Row & z.output<typeof conditionInput> & { recordedBy: string };
export type Allergy = Row & z.output<typeof allergyInput> & { recordedBy: string };
export type Medication = Row & z.output<typeof medicationInput> & { recordedBy: string };
export type DoseLog = Row & z.output<typeof doseLogInput>;
export type Vital = Row & z.output<typeof vitalInput> & { recordedBy: string };
export type DocumentRow = Row & z.output<typeof documentInput> & { fileName: string; mimeType: string; byteSize: number; storage: 'seed' | 'upload'; uploadedBy: string };
export type Doctor = Row & z.output<typeof doctorInput> & { userId: string; verification: 'pending' | 'verified' | 'rejected' };
export type AppointmentType = Row & z.output<typeof appointmentTypeInput> & { doctorId: string };
export type Schedule = Row & z.output<typeof scheduleInput> & { doctorId: string };
export type Leave = Row & z.output<typeof leaveInput> & { doctorId: string };
export type Intake = z.output<typeof intakeSchema>;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type Appointment = Row & Omit<z.output<typeof appointmentInput>, 'status'> & {
  status: AppointmentStatus; end: string; fee: number; bookedBy: string; checkedInAt?: string; startedAt?: string; endedAt?: string;
};
export type Diagnosis = z.output<typeof diagnosisSchema>;
export type Consultation = Row & z.output<typeof consultationInput> & { doctorId: string };
export type PrescriptionItem = z.output<typeof prescriptionItem>;
export type Prescription = Row & z.output<typeof prescriptionInput> & {
  doctorId: string; status: 'draft' | 'signed'; signedAt?: string; signature?: string; acknowledgedWarnings?: string[];
};
export type Favorite = Row & z.output<typeof favoriteInput> & { doctorId: string };
export type Order = Row & z.output<typeof orderInput> & { doctorId: string; resultedAt?: string };
export type Message = Row & Omit<z.output<typeof messageInput>, 'read'> & { sender: 'patient' | 'doctor'; senderUserId: string; readAt?: string };
export type Referral = Row & z.output<typeof referralInput> & { fromDoctorId: string };
export type Feedback = Row & z.output<typeof feedbackInput> & { patientId: string; doctorId: string };
export type Notification = Row & { userId: string; title: string; body: string; channels: string[]; link?: string; readAt?: string; dedupeKey?: string };
export type AccessBlock = Row & z.output<typeof accessBlockInput>;
export type Session = { id: string; tokenHash: string; userId: string; createdAt: string; lastSeenAt: string; expiresAt: string };
export type AuditEntry = { id: string; at: string; actorUserId?: string; action: string; collection?: string; recordId?: string; patientId?: string; detail?: string };

export type Data = {
  version: 1;
  users: User[]; patients: Patient[]; consents: Consent[]; conditions: Condition[]; allergies: Allergy[]; medications: Medication[];
  doseLogs: DoseLog[]; vitals: Vital[]; documents: DocumentRow[]; doctors: Doctor[]; appointmentTypes: AppointmentType[];
  schedules: Schedule[]; leaves: Leave[]; appointments: Appointment[]; consultations: Consultation[]; prescriptions: Prescription[];
  favorites: Favorite[]; orders: Order[]; messages: Message[]; referrals: Referral[]; feedback: Feedback[];
  notifications: Notification[]; accessBlocks: AccessBlock[]; sessions: Session[]; audit: AuditEntry[];
};
/** Collections that hold records (everything except version). */
export type CollectionName = Exclude<keyof Data, 'version'>;
export const COLLECTIONS: CollectionName[] = ['users', 'patients', 'consents', 'conditions', 'allergies', 'medications', 'doseLogs', 'vitals', 'documents', 'doctors', 'appointmentTypes', 'schedules', 'leaves', 'appointments', 'consultations', 'prescriptions', 'favorites', 'orders', 'messages', 'referrals', 'feedback', 'notifications', 'accessBlocks', 'sessions', 'audit'];

export type SessionInfo = { user: Pick<User, 'id' | 'name' | 'role' | 'email'>; patientId?: string; doctorId?: string; doctorVerification?: Doctor['verification']; expiresAt: string };
export type SafetyWarning = { kind: 'interaction' | 'allergy' | 'duplicate' | 'dose'; severity: 'caution' | 'serious'; message: string };

export const CLINIC_TIMEZONE = 'Asia/Kolkata';
export const DEMO_PIN = '1234';
