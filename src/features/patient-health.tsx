'use client';
import Link from 'next/link';
import { useState } from 'react';
import { CalendarCheck, Check, FileUp, MessageSquare, Pill, Stethoscope, X } from 'lucide-react';
import type { Allergy, Appointment, Condition, DoseLog, DocumentRow, Medication, Message, Order, Vital } from '../shared/schemas';
import { addDays, formatDate, formatDateTime, formatWeekday, istDate } from '../shared/time';
import { api, useData } from '../ui/api';
import { Async, Badge, Dialog, Empty, Loading, Notice, PageTitle, Section, Tabs } from '../ui/components';
import { CrudList, FieldInput, RecordForm, type FieldDef } from '../ui/crud';
import { useShell } from '../ui/shell';
import { DocumentLink, EmergencyBanner, VitalsSummary, vitalLine } from './shared';

const opt = (values: string[], labels?: Record<string, string>) => values.map(v => ({ value: v, label: labels?.[v] ?? v[0].toUpperCase() + v.slice(1) }));
type Named = { id: string; name: string };

export function PatientHome() {
  const { session, activePatientId, family } = useShell();
  const me = family.find(p => p.id === activePatientId);
  const appts = useData<(Appointment)[]>('c/appointments');
  const meds = useData<Medication[]>(`c/medications?patientId=${activePatientId}`);
  const orders = useData<Order[]>(`c/orders?patientId=${activePatientId}`);
  const messages = useData<Message[]>('c/messages');
  const doctors = useData<Named[]>('c/doctors');
  const doctorName = (id: string) => doctors.data?.find(d => d.id === id)?.name ?? 'Doctor';
  const upcoming = (appts.data ?? []).filter(a => a.patientId === activePatientId && ['requested', 'confirmed', 'checked-in'].includes(a.status) && a.end > new Date().toISOString()).sort((a, b) => a.start.localeCompare(b.start));
  const refills = (meds.data ?? []).filter(m => m.active && m.refillDate && m.refillDate <= addDays(istDate(), 7));
  const results = (orders.data ?? []).filter(o => o.status === 'resulted').sort((a, b) => (b.resultedAt ?? '').localeCompare(a.resultedAt ?? '')).slice(0, 3);
  const unread = (messages.data ?? []).filter(m => !m.readAt && m.senderUserId !== session.user.id).length;
  const ready = !!(appts.data && meds.data && orders.data && messages.data);
  return <>
    <PageTitle eyebrow="PATIENT PORTAL" title={`Hello, ${me?.name.split(' ')[0] ?? session.user.name.split(' ')[0]}`} actions={<Link className="button" href="/patient/doctors"><Stethoscope size={16} />Book a visit</Link>}>All consultations are face-to-face at the clinic.</PageTitle>
    <EmergencyBanner />
    <div className="grid-2">
      <Section title="Upcoming appointments" actions={<Link className="link" href="/patient/appointments">All appointments</Link>}>
        {!ready ? <Loading /> : !upcoming.length ? <Empty title="No upcoming visits"><Link className="link" href="/patient/doctors">Find a doctor</Link></Empty>
          : <ul className="rows">{upcoming.slice(0, 3).map(a => <li className="row" key={a.id}><div className="row-main"><strong>{doctorName(a.doctorId)}</strong><p>{formatDateTime(a.start)}</p></div><Badge>{a.status}</Badge></li>)}</ul>}
      </Section>
      <Section title="Reminders">
        {!ready ? <Loading /> : <ul className="rows">
          {refills.map(m => <li className="row" key={m.id}><Pill size={16} /><div className="row-main"><strong>Refill {m.name}</strong><p>Due {formatDate(m.refillDate)}</p></div></li>)}
          {unread > 0 && <li className="row"><MessageSquare size={16} /><div className="row-main"><strong>{unread} unread message{unread > 1 ? 's' : ''}</strong><p><Link className="link" href="/patient/messages">Open messages</Link></p></div></li>}
          {upcoming.filter(a => a.status === 'confirmed' && istDate(a.start) === istDate()).map(a => <li className="row" key={a.id}><CalendarCheck size={16} /><div className="row-main"><strong>Visit today at {formatDateTime(a.start).split(', ')[1]}</strong><p><Link className="link" href="/patient/appointments">Check in when you arrive</Link></p></div></li>)}
          {!refills.length && !unread && <li className="row muted">Nothing needs your attention.</li>}
        </ul>}
      </Section>
    </div>
    <Section title="Recent results" actions={<Link className="link" href="/patient/records">All visits & results</Link>}>
      {!ready ? <Loading /> : !results.length ? <Empty title="No results yet" /> : <ul className="rows">{results.map(o => <li className="row" key={o.id}><div className="row-main"><strong>{o.test}</strong><p>{o.result} {o.unit}{o.referenceRange && <span className="muted"> (ref {o.referenceRange})</span>}</p><small>{formatDate(o.resultedAt)}</small></div>{o.abnormal ? <Badge tone="red">Outside range</Badge> : <Badge tone="green">Normal</Badge>}</li>)}</ul>}
    </Section>
  </>;
}

const conditionFields: FieldDef[] = [
  { name: 'category', label: 'Type', type: 'select', required: true, options: opt(['past', 'chronic', 'surgery', 'hospitalization', 'family'], { past: 'Past condition', chronic: 'Chronic condition', family: 'Family history' }) },
  { name: 'name', label: 'Condition or procedure', required: true }, { name: 'date', label: 'Date', type: 'date' },
  { name: 'relation', label: 'Family member (for family history)' }, { name: 'notes', label: 'Notes', type: 'textarea' },
];
const allergyFields: FieldDef[] = [
  { name: 'category', label: 'Type', type: 'select', required: true, options: opt(['drug', 'food', 'environmental']) },
  { name: 'substance', label: 'Substance', required: true }, { name: 'severity', label: 'Severity', type: 'select', required: true, options: opt(['mild', 'moderate', 'severe']) },
  { name: 'reaction', label: 'Reaction', wide: true },
];
const medicationFields: FieldDef[] = [
  { name: 'name', label: 'Medicine', required: true }, { name: 'dose', label: 'Dose', placeholder: '5 mg' }, { name: 'frequency', label: 'How often', placeholder: 'Once daily' },
  { name: 'startDate', label: 'Started', type: 'date' }, { name: 'refillDate', label: 'Refill due', type: 'date', hint: 'You get a reminder 3 days before.' }, { name: 'active', label: 'Currently taking', type: 'checkbox' },
];
export const vitalFields: FieldDef[] = [
  { name: 'recordedAt', label: 'Measured at', type: 'datetime', required: true }, { name: 'source', label: 'Source', type: 'select', required: true, options: opt(['manual', 'device', 'clinic'], { manual: 'Entered manually', device: 'Connected device (simulated)', clinic: 'Measured at clinic' }) },
  { name: 'systolic', label: 'BP systolic (mmHg)', type: 'number' }, { name: 'diastolic', label: 'BP diastolic (mmHg)', type: 'number' },
  { name: 'pulse', label: 'Pulse (bpm)', type: 'number' }, { name: 'spo2', label: 'SpO₂ (%)', type: 'number' },
  { name: 'glucoseMgDl', label: 'Glucose (mg/dL)', type: 'number' }, { name: 'weightKg', label: 'Weight (kg)', type: 'number', step: '0.1' }, { name: 'heightCm', label: 'Height (cm)', type: 'number' },
];
const documentFields: FieldDef[] = [
  { name: 'title', label: 'Title', required: true }, { name: 'category', label: 'Type', type: 'select', required: true, options: opt(['lab', 'imaging', 'discharge', 'prescription', 'other'], { lab: 'Lab report', imaging: 'Imaging', discharge: 'Discharge summary', prescription: 'Prescription' }) },
  { name: 'documentDate', label: 'Report date', type: 'date', required: true }, { name: 'issuedBy', label: 'Doctor or hospital' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
/** Fields for an uploaded prescription (the category is fixed). */
export const prescriptionUploadFields: FieldDef[] = [
  { name: 'title', label: 'Title', required: true, placeholder: 'e.g. Prescription: fever' }, { name: 'documentDate', label: 'Prescription date', type: 'date', required: true },
  { name: 'issuedBy', label: 'Prescribed by (doctor or hospital)', wide: true }, { name: 'notes', label: 'Notes', type: 'textarea' },
];

/** Health profile sections, shared by the patient portal and the doctor's record view. */
export function HealthSections({ patientId, tab, editable = true }: { patientId: string; tab: string; editable?: boolean }) {
  const q = { patientId }, fixed = { patientId };
  const [vitalsKey, setVitalsKey] = useState(0);
  if (tab === 'history') return <CrudList<Condition> collection="conditions" noun="Medical history entry" title="Medical history" query={q} fixed={fixed} fields={conditionFields} canCreate={editable} canEdit={editable} canDelete={editable}
    sort={(a, b) => a.category.localeCompare(b.category) || (b.date ?? '').localeCompare(a.date ?? '')}
    render={c => <><span className="row-title"><strong>{c.name}</strong> <Badge tone="teal">{conditionFields[0].options!.find(o => o.value === c.category)?.label}</Badge></span><p>{[c.relation, c.date && formatDate(c.date), c.notes].filter(Boolean).join(' · ') || <span className="muted">No details</span>}</p></>} />;
  if (tab === 'allergies') return <CrudList<Allergy> collection="allergies" noun="Allergy" title="Allergies" query={q} fixed={fixed} fields={allergyFields} canCreate={editable} canEdit={editable} canDelete={editable} emptyText="No allergies recorded (this does not confirm no allergies)"
    render={a => <><span className="row-title"><strong>{a.substance}</strong> <Badge>{a.severity}</Badge> <Badge tone="grey">{a.category}</Badge></span><p>{a.reaction || <span className="muted">Reaction not recorded</span>}</p></>} />;
  if (tab === 'medications') return <><CrudList<Medication> collection="medications" noun="Medication" title="Current medications" query={q} fixed={fixed} defaults={{ active: true }} fields={medicationFields} canCreate={editable} canEdit={editable} canDelete={editable}
    sort={(a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)}
    render={m => <><span className="row-title"><strong>{m.name}</strong> {!m.active && <Badge tone="grey">stopped</Badge>}</span><p>{[m.dose, m.frequency].filter(Boolean).join(' · ') || 'Dose not recorded'}{m.refillDate && <> · refill {formatDate(m.refillDate)}</>}</p></>} />
    <Adherence patientId={patientId} editable={editable} /></>;
  if (tab === 'vitals') return <><LatestVitals patientId={patientId} key={vitalsKey} />
    <CrudList<Vital> collection="vitals" noun="Vitals reading" title="Vitals history" query={q} fixed={fixed} defaults={() => ({ recordedAt: new Date().toISOString(), source: 'manual' })} fields={vitalFields} canCreate={editable} canEdit={editable} canDelete={editable} onChange={() => setVitalsKey(k => k + 1)}
      sort={(a, b) => b.recordedAt.localeCompare(a.recordedAt)} render={v => <><strong>{formatDateTime(v.recordedAt)}</strong> <Badge tone="grey">{v.source}</Badge><p>{vitalLine(v)}</p></>} /></>;
  return <Documents patientId={patientId} editable={editable} />;
}

function LatestVitals({ patientId }: { patientId: string }) {
  const vitals = useData<Vital[]>(`c/vitals?patientId=${patientId}`);
  return <Section title="Latest vitals"><Async state={vitals}>{rows => <VitalsSummary vital={[...rows].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]} />}</Async></Section>;
}

/** Medication adherence: a tick per day for the last seven days. */
function Adherence({ patientId, editable }: { patientId: string; editable: boolean }) {
  const meds = useData<Medication[]>(`c/medications?patientId=${patientId}`);
  const logs = useData<DoseLog[]>(`c/doseLogs?patientId=${patientId}`);
  const [error, setError] = useState('');
  const days = Array.from({ length: 7 }, (_, i) => istDate(new Date(), i - 6));
  const active = (meds.data ?? []).filter(m => m.active);
  async function toggle(medicationId: string, date: string, log?: DoseLog) {
    setError('');
    try {
      if (!log) await api.post('c/doseLogs', { patientId, medicationId, date, taken: true });
      else if (log.taken) await api.patch(`c/doseLogs/${log.id}`, { taken: false });
      else await api.del(`c/doseLogs/${log.id}`);
      logs.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }
  return <Section title="Adherence — last 7 days">
    <p className="muted small">Tap a day to cycle: taken → missed → not recorded.</p>
    {error && <Notice>{error}</Notice>}
    {!active.length ? <Empty title="No active medications" /> : <div className="table-wrap"><table className="table adherence"><thead><tr><th>Medicine</th>{days.map(d => <th key={d}>{formatWeekday(d).split(' ')[0]}<br /><small>{d.slice(8)}</small></th>)}</tr></thead>
      <tbody>{active.map(m => <tr key={m.id}><td>{m.name}</td>{days.map(d => {
        const log = logs.data?.find(l => l.medicationId === m.id && l.date === d);
        return <td key={d}><button className={`dose ${log ? (log.taken ? 'taken' : 'missed') : ''}`} disabled={!editable} aria-label={`${m.name} ${d}: ${log ? (log.taken ? 'taken' : 'missed') : 'not recorded'}`} onClick={() => toggle(m.id, d, log)}>{log ? (log.taken ? <Check size={14} /> : <X size={14} />) : '·'}</button></td>;
      })}</tr>)}</tbody></table></div>}
  </Section>;
}

function Documents({ patientId, editable }: { patientId: string; editable: boolean }) {
  const [uploading, setUploading] = useState(false); const [key, setKey] = useState(0);
  return <>
    <CrudList<DocumentRow> key={key} collection="documents" noun="Document" title="Documents and reports" query={{ patientId }} fields={documentFields} canCreate={false} canEdit={editable} canDelete={editable}
      sort={(a, b) => b.documentDate.localeCompare(a.documentDate)}
      render={d => <><span className="row-title"><DocumentLink doc={d} /> <Badge tone="grey">{d.category}</Badge></span><p>{[formatDate(d.documentDate), d.issuedBy, `${(d.byteSize / 1024).toFixed(0)} KB`].filter(Boolean).join(' · ')}</p>{d.notes && <small>{d.notes}</small>}</>} />
    {editable && <div className="button-row"><button className="button" onClick={() => setUploading(true)}><FileUp size={16} />Upload a document</button></div>}
    {uploading && <UploadDialog patientId={patientId} onClose={() => setUploading(false)} onDone={() => { setUploading(false); setKey(k => k + 1); }} />}
  </>;
}

/** Uploads a file to the patient's record. With `category`, the type is fixed (e.g. an uploaded prescription). */
export function UploadDialog({ patientId, category, onClose, onDone }: { patientId: string; category?: 'prescription'; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  return <Dialog title={category === 'prescription' ? 'Upload a prescription' : 'Upload a document'} onClose={onClose}>
    <label className="field field-wide"><span>File (PDF, PNG or JPEG, up to 5 MB) <span className="required">*</span></span><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
    {category === 'prescription' && <p className="muted small">A photo or scan of a prescription from any doctor. It is kept in your record, and doctors you book can see it.</p>}
    <RecordForm fields={category === 'prescription' ? prescriptionUploadFields : documentFields} initial={undefined} submitLabel="Upload" onCancel={onClose} onSubmit={async payload => {
      if (!file) throw new Error('Choose a file to upload.');
      const form = new FormData();
      form.set('file', file); form.set('patientId', patientId);
      if (category) form.set('category', category);
      for (const [k, v] of Object.entries(payload)) if (v !== null && v !== undefined) form.set(k, String(v));
      await api.upload('documents/upload', form); onDone();
    }} />
  </Dialog>;
}

export function PatientHealth() {
  const { activePatientId, family } = useShell();
  const [tab, setTab] = useState('history');
  const who = family.find(p => p.id === activePatientId);
  return <>
    <PageTitle eyebrow="HEALTH PROFILE" title={who ? `${who.name}${who.guardianPatientId ? ` (${who.relationship ?? 'dependent'})` : ''}` : 'Health profile'}>Keep history, allergies, medicines, vitals, and documents up to date before your visit.</PageTitle>
    <Tabs tabs={[{ id: 'history', label: 'Medical history' }, { id: 'allergies', label: 'Allergies' }, { id: 'medications', label: 'Medications' }, { id: 'vitals', label: 'Vitals' }, { id: 'documents', label: 'Documents' }]} value={tab} onChange={setTab} />
    {activePatientId && <HealthSections key={`${activePatientId}-${tab}`} patientId={activePatientId} tab={tab} />}
  </>;
}

/** Date strip + time chips for choosing a free slot. */
export function SlotPicker({ doctorId, typeId, exclude, value, onChange }: { doctorId: string; typeId: string; exclude?: string; value: string; onChange: (iso: string) => void }) {
  const slots = useData<string[]>(typeId ? `doctors/${doctorId}/slots?typeId=${typeId}&days=21${exclude ? `&exclude=${exclude}` : ''}` : null);
  const [day, setDay] = useState('');
  if (!typeId) return <p className="muted">Choose an appointment type first.</p>;
  return <Async state={slots}>{list => {
    const days = [...new Set(list.map(s => istDate(s)))];
    const current = day && days.includes(day) ? day : days[0];
    if (!days.length) return <Empty title="No free slots in the next 3 weeks" />;
    return <div className="slot-picker">
      <div className="chip-row" role="group" aria-label="Day">{days.map(d => <button type="button" key={d} className={`chip ${d === current ? 'active' : ''}`} onClick={() => setDay(d)}>{formatWeekday(d)}</button>)}</div>
      <div className="chip-row" role="group" aria-label="Time">{list.filter(s => istDate(s) === current).map(s => <button type="button" key={s} className={`chip time ${s === value ? 'active' : ''}`} aria-pressed={s === value} onClick={() => onChange(s)}>{formatDateTime(s).split(', ')[1]}</button>)}</div>
    </div>;
  }}</Async>;
}

export const intakeFields: FieldDef[] = [
  { name: 'chiefComplaint', label: 'Main concern', required: true, wide: true, placeholder: 'What would you like to discuss?' },
  { name: 'symptoms', label: 'Symptoms', type: 'textarea' }, { name: 'duration', label: 'How long?', placeholder: 'e.g. 3 days' },
  { name: 'fever', label: 'I have a fever', type: 'checkbox' }, { name: 'takingMedication', label: 'I am taking medicines for this', type: 'checkbox' },
  { name: 'notes', label: 'Anything else the doctor should know', type: 'textarea' },
];
export { FieldInput };
