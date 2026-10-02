'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, ClipboardList, MessageSquare, Search, Send, Stethoscope, UserCheck } from 'lucide-react';
import type { Appointment, AppointmentType, Consultation, Doctor, DocumentRow, Favorite, Leave, Notification, Order, Prescription, Referral, Schedule, Vital, Allergy, Medication, Condition, Patient } from '../shared/schemas';
import { FREQUENCY_LABEL } from '../shared/reference';
import { WEEKDAYS, addDays, ageOn, formatDate, formatDateTime, formatMoney, formatTime, formatWeekday, istDate } from '../shared/time';
import { api, errorText, useData } from '../ui/api';
import { Async, Avatar, Badge, Confirm, Dialog, Empty, KeyValues, Notice, PageTitle, Section, Stars, Tabs } from '../ui/components';
import { CrudList, RecordForm, type FieldDef } from '../ui/crud';
import { useShell } from '../ui/shell';
import { DocumentLink, VitalsSummary } from './shared';
import { HealthSections, SlotPicker } from './patient-health';
import { openConsultation } from './consult';
import { HealthRecords } from './records';

type PatientRow = { id: string; name: string; dateOfBirth: string; gender: string; phone?: string; lastVisit: string | null; nextAppointment: string | null };
type Summary = {
  patient: Patient & { age: number }; guardian?: string; conditions: Condition[]; allergies: Allergy[]; medications: Medication[]; vitals: Vital[]; documents: DocumentRow[];
  consultations: (Consultation & { doctorName: string })[]; prescriptions: (Prescription & { doctorName: string })[]; orders: (Order & { doctorName: string })[];
  appointments: (Appointment & { doctorName: string; typeName: string })[]; referrals: (Referral & { fromName: string; toName: string })[];
};
const usePatientNames = () => { const list = useData<PatientRow[]>('my/patients'); return { list, name: (id: string) => list.data?.find(p => p.id === id)?.name ?? 'Patient' }; };

function QueueActions({ a, onChange }: { a: Appointment; onChange: (message?: string) => void }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const status = async (s: Appointment['status'], message: string) => { setError(''); try { await api.patch(`c/appointments/${a.id}`, { status: s }); onChange(message); } catch (e) { setError(errorText(e)); } };
  return <div className="row-actions wrap">
    {a.status === 'requested' && <><button className="button small" onClick={() => status('confirmed', 'Booking accepted.')}>Accept</button><button className="link-button danger" onClick={() => status('rejected', 'Booking rejected.')}>Reject</button></>}
    {a.status === 'confirmed' && istDate(a.start) === istDate() && <button className="link-button" onClick={() => status('checked-in', 'Patient checked in.')}>Check in</button>}
    {['confirmed', 'checked-in', 'in-consultation'].includes(a.status) && <button className="button small" onClick={async () => { try { router.push(`/doctor/consult/${await openConsultation(a)}`); } catch (e) { setError(errorText(e)); } }}><Stethoscope size={14} />{a.status === 'in-consultation' ? 'Resume consult' : 'Start consult'}</button>}
    {['confirmed', 'checked-in'].includes(a.status) && <button className="link-button danger" onClick={() => status('no-show', 'Marked as no-show.')}>No-show</button>}
    {a.status === 'no-show' && <button className="link-button" onClick={() => status('confirmed', 'No-show undone.')}>Undo no-show</button>}
    {error && <small className="field-error">{error}</small>}
  </div>;
}

export function DoctorToday() {
  const { session } = useShell();
  const appts = useData<Appointment[]>('c/appointments');
  const types = useData<AppointmentType[]>(`c/appointmentTypes?doctorId=${session.doctorId}`);
  const orders = useData<Order[]>(`c/orders?doctorId=${session.doctorId}`);
  const notes = useData<Notification[]>('c/notifications');
  const { name } = usePatientNames();
  const [message, setMessage] = useState('');
  const today = (appts.data ?? []).filter(a => istDate(a.start) === istDate()).sort((a, b) => a.start.localeCompare(b.start));
  const requests = (appts.data ?? []).filter(a => a.status === 'requested').sort((a, b) => a.start.localeCompare(b.start));
  const abnormal = (orders.data ?? []).filter(o => o.abnormal && o.status === 'resulted').sort((a, b) => (b.resultedAt ?? '').localeCompare(a.resultedAt ?? ''));
  const unread = (notes.data ?? []).filter(n => !n.readAt);
  const changed = (m?: string) => { appts.reload(); if (m) setMessage(m); };
  return <>
    <PageTitle eyebrow={formatWeekday(istDate()).toUpperCase()} title="Today's clinic">All consultations are face-to-face. Patients check in on arrival.</PageTitle>
    {message && <Notice kind="success">{message}</Notice>}
    <div className="stats">
      <div className="stat"><strong>{today.filter(a => !['cancelled', 'rejected'].includes(a.status)).length}</strong><span>appointments today</span></div>
      <div className="stat"><strong>{today.filter(a => a.status === 'checked-in').length}</strong><span>waiting</span></div>
      <div className="stat"><strong>{requests.length}</strong><span>booking requests</span></div>
      <div className="stat alert"><strong>{abnormal.length}</strong><span>abnormal results</span></div>
    </div>
    <Section title={<><ClipboardList size={17} /> Day queue</>}>
      <Async state={appts}>{() => !today.length ? <Empty title="No appointments today" /> : <ul className="rows">{today.map(a => <li key={a.id} className={`row queue ${a.status}`}>
        <span className="time">{formatTime(a.start)}</span>
        <div className="row-main"><span className="row-title"><Link className="link strong" href={`/doctor/patients/${a.patientId}`}>{name(a.patientId)}</Link> <Badge>{a.status}</Badge></span>
          <p>{types.data?.find(t => t.id === a.typeId)?.name ?? 'Appointment'}{a.intake?.chiefComplaint ? ` · ${a.intake.chiefComplaint}` : a.reason ? ` · ${a.reason}` : ''}</p>{a.checkedInAt && a.status === 'checked-in' && <small>Waiting since {formatTime(a.checkedInAt)}</small>}</div>
        <QueueActions a={a} onChange={changed} /></li>)}</ul>}</Async>
    </Section>
    <div className="grid-2">
      <Section title="Booking requests" actions={<Link className="link" href="/doctor/schedule">Calendar</Link>}>
        {!requests.length ? <Empty title="No pending requests" /> : <ul className="rows">{requests.map(a => <li key={a.id} className="row"><div className="row-main"><strong>{name(a.patientId)}</strong><p>{formatDateTime(a.start)}{a.reason ? ` · ${a.reason}` : ''}</p></div><QueueActions a={a} onChange={changed} /></li>)}</ul>}
      </Section>
      <Section title={<><AlertTriangle size={16} /> Alerts</>}>
        <ul className="rows">
          {abnormal.slice(0, 5).map(o => <li key={o.id} className="row"><div className="row-main"><strong>{name(o.patientId)}: {o.test}</strong><p>{o.result} {o.unit}{o.referenceRange ? ` (ref ${o.referenceRange})` : ''} · {formatDate(o.resultedAt)}</p></div><Badge tone="red">abnormal</Badge></li>)}
          {unread.slice(0, 5).map(n => <li key={n.id} className="row"><div className="row-main"><strong>{n.title}</strong><p>{n.body}</p></div>{n.link && <Link className="link" href={n.link}>Open</Link>}</li>)}
          {!abnormal.length && !unread.length && <li className="row muted">No alerts.</li>}
        </ul>
      </Section>
    </div>
  </>;
}

const scheduleFields: FieldDef[] = [
  { name: 'weekday', label: 'Day', type: 'select', required: true, options: WEEKDAYS.map((d, i) => ({ value: String(i), label: d })) },
  { name: 'start', label: 'Start', type: 'time', required: true }, { name: 'end', label: 'End', type: 'time', required: true },
  { name: 'breakStart', label: 'Break from', type: 'time' }, { name: 'breakEnd', label: 'Break to', type: 'time' },
  { name: 'bufferMinutes', label: 'Buffer between visits (min)', type: 'number', min: 0, required: true },
];

export function DoctorSchedule() {
  const { session } = useShell();
  const [tab, setTab] = useState('calendar');
  const mine = { doctorId: session.doctorId ?? '' };
  return <>
    <PageTitle eyebrow="SCHEDULE" title="Schedule management">Working hours, breaks, buffers, leave, appointment types, and bookings.</PageTitle>
    <Tabs tabs={[{ id: 'calendar', label: 'Calendar' }, { id: 'hours', label: 'Working hours' }, { id: 'leave', label: 'Leave' }, { id: 'types', label: 'Appointment types & fees' }]} value={tab} onChange={setTab} />
    {tab === 'calendar' && <Calendar />}
    {tab === 'hours' && <CrudList<Schedule> collection="schedules" noun="Working hours" title="Weekly working hours" query={mine} fields={scheduleFields} defaults={{ start: '09:00', end: '17:00', bufferMinutes: 0 }}
      sort={(a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.start.localeCompare(b.start)}
      render={s => <><strong>{WEEKDAYS[s.weekday]}</strong><p>{s.start}–{s.end}{s.breakStart ? ` · break ${s.breakStart}–${s.breakEnd}` : ''}{s.bufferMinutes ? ` · ${s.bufferMinutes} min buffer` : ''}</p></>} />}
    {tab === 'leave' && <CrudList<Leave> collection="leaves" noun="Leave" title="Leave and time off" query={mine} fields={[{ name: 'startDate', label: 'From', type: 'date', required: true }, { name: 'endDate', label: 'To', type: 'date', required: true }, { name: 'reason', label: 'Reason', wide: true }]}
      sort={(a, b) => a.startDate.localeCompare(b.startDate)} render={l => <><strong>{formatDate(l.startDate)} – {formatDate(l.endDate)}</strong><p>{l.reason || 'No reason given'} · no slots offered on these days</p></>} />}
    {tab === 'types' && <CrudList<AppointmentType> collection="appointmentTypes" noun="Appointment type" title="Appointment types and fees" query={mine}
      fields={[{ name: 'name', label: 'Name', required: true }, { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', required: true, min: 5 }, { name: 'fee', label: 'Fee (₹)', type: 'number', required: true, min: 0 }]}
      render={t => <><strong>{t.name}</strong><p>{t.durationMinutes} min · {formatMoney(t.fee)} · in person</p></>} />}
  </>;
}

function Calendar() {
  const appts = useData<Appointment[]>('c/appointments');
  const types = useData<AppointmentType[]>('c/appointmentTypes');
  const { name } = usePatientNames();
  const [range, setRange] = useState<'upcoming' | 'past'>('upcoming');
  const [action, setAction] = useState<{ kind: 'reschedule' | 'cancel' | 'delete'; a: Appointment } | null>(null);
  const [message, setMessage] = useState('');
  const today = istDate();
  const rows = (appts.data ?? []).filter(a => range === 'upcoming' ? istDate(a.start) >= today : istDate(a.start) < today && istDate(a.start) >= addDays(today, -60)).sort((a, b) => range === 'upcoming' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start));
  const days = [...new Set(rows.map(a => istDate(a.start)))];
  const changed = (m?: string) => { appts.reload(); setAction(null); if (m) setMessage(m); };
  return <>
    <div className="toolbar"><Tabs tabs={[{ id: 'upcoming', label: 'Today & upcoming' }, { id: 'past', label: 'Past 60 days' }]} value={range} onChange={setRange} /></div>
    {message && <Notice kind="success">{message}</Notice>}
    <Async state={appts}>{() => !days.length ? <Empty title="No appointments" /> : days.map(d => <Section key={d} title={formatWeekday(d)}><ul className="rows">{rows.filter(a => istDate(a.start) === d).map(a => <li key={a.id} className="row queue">
      <span className="time">{formatTime(a.start)}</span>
      <div className="row-main"><span className="row-title"><Link className="link strong" href={`/doctor/patients/${a.patientId}`}>{name(a.patientId)}</Link> <Badge>{a.status}</Badge></span><p>{types.data?.find(t => t.id === a.typeId)?.name ?? 'Appointment'} · {formatMoney(a.fee)}{a.reason ? ` · ${a.reason}` : ''}</p></div>
      <QueueActions a={a} onChange={changed} />
      <div className="row-actions">
        {['requested', 'confirmed'].includes(a.status) && <><button className="link-button" onClick={() => setAction({ kind: 'reschedule', a })}>Reschedule</button><button className="link-button danger" onClick={() => setAction({ kind: 'cancel', a })}>Cancel</button></>}
        {['cancelled', 'rejected', 'no-show'].includes(a.status) && <button className="link-button danger" onClick={() => setAction({ kind: 'delete', a })}>Delete</button>}
      </div></li>)}</ul></Section>)}</Async>
    {action?.kind === 'reschedule' && <RescheduleDialog a={action.a} onClose={() => setAction(null)} onDone={() => changed('Appointment rescheduled; the patient was notified.')} />}
    {action?.kind === 'cancel' && <Dialog title="Cancel appointment" onClose={() => setAction(null)}><RecordForm fields={[{ name: 'cancelReason', label: 'Reason shared with the patient', type: 'textarea' }]} submitLabel="Cancel appointment" onCancel={() => setAction(null)} onSubmit={async v => { await api.patch(`c/appointments/${action.a.id}`, { status: 'cancelled', ...(v.cancelReason ? { cancelReason: v.cancelReason } : {}) }); changed('Appointment cancelled.'); }} /></Dialog>}
    {action?.kind === 'delete' && <Confirm title="Delete appointment?" message="This removes it from the calendar." onClose={() => setAction(null)} onConfirm={async () => { await api.del(`c/appointments/${action.a.id}`); changed('Appointment deleted.'); }} />}
  </>;
}

function RescheduleDialog({ a, onClose, onDone }: { a: Appointment; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState(''); const [error, setError] = useState('');
  return <Dialog title="Reschedule" onClose={onClose} wide><SlotPicker doctorId={a.doctorId} typeId={a.typeId} exclude={a.id} value={start} onChange={setStart} />{error && <Notice>{error}</Notice>}
    <div className="button-row"><button className="button" disabled={!start} onClick={async () => { try { await api.patch(`c/appointments/${a.id}`, { start }); onDone(); } catch (e) { setError(errorText(e)); } }}>Move to {start && formatDateTime(start)}</button></div></Dialog>;
}

export function DoctorPatients() {
  const list = useData<PatientRow[]>('my/patients');
  const [q, setQ] = useState(''); const [filter, setFilter] = useState('all');
  const rows = (list.data ?? []).filter(p => (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.dateOfBirth === q || (p.phone ?? '').replace(/\s/g, '').includes(q.replace(/\s/g, '')))
    && (filter === 'all' || (filter === 'upcoming' ? !!p.nextAppointment : filter === 'seen' ? !!p.lastVisit : !p.lastVisit)));
  return <>
    <PageTitle eyebrow="PATIENTS" title="Your patients">Patients with a booking, referral, or visit with you. Patients can block access in their privacy settings.</PageTitle>
    <section className="card filters">
      <label className="field field-wide"><span><Search size={13} /> Search name, phone, or date of birth (YYYY-MM-DD)</span><input value={q} onChange={e => setQ(e.target.value)} /></label>
      <label className="field"><span>Show</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All patients</option><option value="upcoming">With upcoming visit</option><option value="seen">Seen before</option><option value="new">Not yet seen</option></select></label>
    </section>
    <Async state={list}>{() => !rows.length ? <Empty title="No matching patients" /> : <ul className="rows card">{rows.map(p => <li key={p.id} className="row"><Avatar name={p.name} size="sm" />
      <div className="row-main"><Link className="link strong" href={`/doctor/patients/${p.id}`}>{p.name}</Link><p>{ageOn(p.dateOfBirth)} y · {p.gender} · born {formatDate(p.dateOfBirth)}</p></div>
      <div className="row-meta"><small>Last visit: {p.lastVisit ? formatDate(p.lastVisit) : '—'}</small><small>Next: {p.nextAppointment ? formatDateTime(p.nextAppointment) : '—'}</small></div></li>)}</ul>}</Async>
  </>;
}

/** Compact clinical snapshot shown beside the consultation workspace. */
export function PatientSnapshot({ patientId, appointment }: { patientId: string; appointment?: Appointment }) {
  const summary = useData<Summary>(`patients/${patientId}/summary`);
  return <Section title="Patient snapshot"><Async state={summary}>{s => <>
    <p><strong>{s.patient.name}</strong> · {s.patient.age} y · {s.patient.gender}{s.patient.bloodGroup ? ` · ${s.patient.bloodGroup}` : ''}</p>
    <h3>Allergies</h3>{s.allergies.length ? <div className="chip-row">{s.allergies.map(a => <Badge key={a.id} tone={a.category === 'drug' ? 'red' : 'amber'}>{a.substance} ({a.severity})</Badge>)}</div> : <p className="muted">None recorded</p>}
    <h3>Current medications</h3>{s.medications.filter(m => m.active).map(m => <p key={m.id} className="tight">{m.name} {m.dose} · {m.frequency}</p>)}{!s.medications.some(m => m.active) && <p className="muted">None recorded</p>}
    <h3>Latest vitals</h3><VitalsSummary vital={s.vitals[0]} />
    {appointment?.intake && <><h3>Pre-consultation answers</h3><KeyValues items={[['Concern', appointment.intake.chiefComplaint], ['Symptoms', appointment.intake.symptoms], ['Duration', appointment.intake.duration], ['Fever', appointment.intake.fever === undefined ? undefined : appointment.intake.fever ? 'Yes' : 'No'], ['Notes', appointment.intake.notes]]} /></>}
  </>}</Async></Section>;
}

export function DoctorPatientRecord({ patientId }: { patientId: string }) {
  const router = useRouter();
  const { session } = useShell();
  const summary = useData<Summary>(`patients/${patientId}/summary`);
  const [tab, setTab] = useState('overview');
  const [referring, setReferring] = useState(false); const [error, setError] = useState('');
  async function startConsult(s: Summary) {
    setError('');
    try {
      const today = s.appointments.find(a => istDate(a.start) === istDate() && ['confirmed', 'checked-in', 'in-consultation'].includes(a.status));
      const id = today ? await openConsultation(today) : (await api.post<Consultation>('c/consultations', { patientId })).id;
      router.push(`/doctor/consult/${id}`);
    } catch (e) { setError(errorText(e)); }
  }
  return <Async state={summary}>{s => {
    const next = s.appointments.filter(a => ['requested', 'confirmed', 'checked-in'].includes(a.status)).sort((a, b) => a.start.localeCompare(b.start))[0];
    return <>
      <div className="record-head"><Avatar name={s.patient.name} size="lg" /><div><div className="eyebrow">PATIENT RECORD</div><h1>{s.patient.name}</h1>
        <p className="muted">{s.patient.age} y · {s.patient.gender} · born {formatDate(s.patient.dateOfBirth)}{s.patient.bloodGroup ? ` · ${s.patient.bloodGroup}` : ''}{s.guardian ? ` · dependent of ${s.guardian}` : ''}</p>
        {s.allergies.some(a => a.category === 'drug') && <p><Badge tone="red">Drug allergy: {s.allergies.filter(a => a.category === 'drug').map(a => a.substance).join(', ')}</Badge></p>}</div>
        <div className="actions"><button className="button" onClick={() => startConsult(s)}><Stethoscope size={16} />Start consultation</button><Link className="button secondary" href="/doctor/messages"><MessageSquare size={16} />Message</Link><button className="button secondary" onClick={() => setReferring(true)}><Send size={16} />Refer</button></div></div>
      {error && <Notice>{error}</Notice>}
      <Tabs tabs={[{ id: 'overview', label: 'Summary' }, { id: 'records', label: 'Health records' }, { id: 'history', label: 'History' }, { id: 'allergies', label: 'Allergies' }, { id: 'medications', label: 'Medications' }, { id: 'vitals', label: 'Vitals' }, { id: 'documents', label: 'Documents' }]} value={tab} onChange={t => { setTab(t); if (t === 'overview' || t === 'records') summary.reload(); }} />
      {tab === 'records' ? <HealthRecords patientId={patientId} summary={s} rxHref={id => `/doctor/prescriptions/${id}`} consultHref={c => (c.doctorId === session.doctorId ? `/doctor/consult/${c.id}` : undefined)} onChange={summary.reload} />
        : tab !== 'overview' ? <HealthSections key={tab} patientId={patientId} tab={tab} /> : <div className="summary-grid">
        <Section title="Demographics"><KeyValues items={[['Phone', s.patient.phone], ['Email', s.patient.email], ['Address', s.patient.address], ['Emergency contact', s.patient.emergencyContactName && `${s.patient.emergencyContactName} ${s.patient.emergencyContactPhone ?? ''}`]]} /></Section>
        <Section title="Latest vitals"><VitalsSummary vital={s.vitals[0]} /></Section>
        <Section title="History & conditions">{s.conditions.length ? <ul className="plain">{s.conditions.map(c => <li key={c.id}><strong>{c.name}</strong> <small className="muted">{c.category}{c.relation ? ` · ${c.relation}` : ''}{c.date ? ` · ${formatDate(c.date)}` : ''}</small></li>)}</ul> : <p className="muted">None recorded</p>}</Section>
        <Section title="Allergies">{s.allergies.length ? <ul className="plain">{s.allergies.map(a => <li key={a.id}><strong>{a.substance}</strong> <Badge>{a.severity}</Badge> <small className="muted">{a.category} · {a.reaction}</small></li>)}</ul> : <p className="muted">None recorded</p>}</Section>
        <Section title="Current medications">{s.medications.filter(m => m.active).length ? <ul className="plain">{s.medications.filter(m => m.active).map(m => <li key={m.id}><strong>{m.name}</strong> {m.dose} · {m.frequency}</li>)}</ul> : <p className="muted">None recorded</p>}</Section>
        <Section title="Pre-consultation answers">{next?.intake ? <><small className="muted">For {formatDateTime(next.start)}</small><KeyValues items={[['Concern', next.intake.chiefComplaint], ['Symptoms', next.intake.symptoms], ['Duration', next.intake.duration], ['Fever', next.intake.fever === undefined ? undefined : next.intake.fever ? 'Yes' : 'No'], ['Taking medicines', next.intake.takingMedication === undefined ? undefined : next.intake.takingMedication ? 'Yes' : 'No'], ['Notes', next.intake.notes]]} /></> : <p className="muted">No upcoming intake answers.</p>}</Section>
        <Section title="Previous consultations" className="span-2">{!s.consultations.length ? <Empty title="No consultations yet" /> : <ul className="rows">{s.consultations.map(c => <li key={c.id} className="row"><div className="row-main">
          <span className="row-title"><strong>{formatDate(c.createdAt)} · {c.doctorName}</strong> <Badge>{c.status}</Badge>{c.diagnoses.map(d => <Badge key={d.code} tone="teal">{d.code}</Badge>)}</span>
          <p><strong>A:</strong> {c.assessment || '—'} <strong>P:</strong> {c.plan || '—'}</p></div>{c.doctorId === session.doctorId && <Link className="link" href={`/doctor/consult/${c.id}`}>Open</Link>}</li>)}</ul>}</Section>
        <Section title="Prescriptions">{!s.prescriptions.length ? <p className="muted">None</p> : <ul className="plain">{s.prescriptions.map(p => <li key={p.id}><Link className="link" href={`/doctor/prescriptions/${p.id}`}>{p.items.map(i => `${i.drug} ${i.dose} ${FREQUENCY_LABEL[i.frequency].toLowerCase()}`).join('; ')}</Link> <Badge>{p.status}</Badge><small className="block muted">{p.doctorName} · {formatDate(p.createdAt)}</small></li>)}</ul>}</Section>
        <Section title="Lab & imaging">{!s.orders.length ? <p className="muted">None</p> : <ul className="plain">{s.orders.map(o => <li key={o.id}><strong>{o.test}</strong> <Badge>{o.status}</Badge>{o.abnormal && <Badge tone="red">abnormal</Badge>}<small className="block muted">{o.result ? `${o.result} ${o.unit ?? ''}` : 'Awaiting result'} · {o.doctorName}</small></li>)}</ul>}</Section>
        <Section title="Uploaded reports" className="span-2">{!s.documents.length ? <p className="muted">None</p> : <ul className="plain">{s.documents.map(d => <li key={d.id}><DocumentLink doc={d} /> <small className="muted">{d.category} · {formatDate(d.documentDate)}</small></li>)}</ul>}</Section>
      </div>}
      {referring && <ReferDialog patientId={patientId} onClose={() => setReferring(false)} />}
    </>;
  }}</Async>;
}

function ReferDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const { session } = useShell();
  const doctors = useData<Doctor[]>('c/doctors');
  const [done, setDone] = useState(false);
  return <Dialog title="Refer to another doctor" onClose={onClose}>{done ? <><Notice kind="success">Referral sent. The doctor and patient were notified.</Notice><div className="button-row"><button className="button" onClick={onClose}>Close</button></div></> : <Async state={doctors}>{list =>
    <RecordForm fields={[{ name: 'toDoctorId', label: 'Refer to', type: 'select', required: true, options: list.filter(d => d.id !== session.doctorId && d.verification === 'verified').map(d => ({ value: d.id, label: `${d.name} · ${d.specialty}` })) }, { name: 'reason', label: 'Reason and clinical question', type: 'textarea', required: true }]}
      fixed={{ patientId }} submitLabel="Send referral" onCancel={onClose} onSubmit={async v => { await api.post('c/referrals', v); setDone(true); }} />}</Async>}</Dialog>;
}

export function DoctorReferrals() {
  const { session } = useShell();
  const list = useData<Referral[]>('c/referrals');
  const doctors = useData<Doctor[]>('c/doctors');
  const { name } = usePatientNames();
  const [editing, setEditing] = useState<Referral | null>(null); const [deleting, setDeleting] = useState<Referral | null>(null);
  const doctorName = (id: string) => doctors.data?.find(d => d.id === id)?.name ?? 'Doctor';
  const received = (list.data ?? []).filter(r => r.toDoctorId === session.doctorId), sent = (list.data ?? []).filter(r => r.fromDoctorId === session.doctorId);
  const setStatus = async (r: Referral, status: Referral['status']) => { await api.patch(`c/referrals/${r.id}`, { status }); list.reload(); };
  return <>
    <PageTitle eyebrow="CONTINUITY OF CARE" title="Referrals">Accepting a referral gives you access to the patient&apos;s record.</PageTitle>
    <div className="grid-2">
      <Section title={<><UserCheck size={16} /> Received</>}><Async state={list}>{() => !received.length ? <Empty title="No referrals received" /> : <ul className="rows">{received.map(r => <li key={r.id} className="row"><div className="row-main">
        <span className="row-title"><Link className="link strong" href={`/doctor/patients/${r.patientId}`}>{name(r.patientId)}</Link> <Badge>{r.status}</Badge></span><p>From {doctorName(r.fromDoctorId)}: {r.reason}</p><small>{formatDate(r.createdAt)}</small></div>
        <div className="row-actions wrap">{r.status === 'sent' && <><button className="button small" onClick={() => setStatus(r, 'accepted')}>Accept</button><button className="link-button danger" onClick={() => setStatus(r, 'declined')}>Decline</button></>}{r.status === 'accepted' && <button className="link-button" onClick={() => setStatus(r, 'completed')}>Mark completed</button>}</div></li>)}</ul>}</Async></Section>
      <Section title={<><Send size={16} /> Sent</>}><Async state={list}>{() => !sent.length ? <Empty title="No referrals sent">Refer from a patient record.</Empty> : <ul className="rows">{sent.map(r => <li key={r.id} className="row"><div className="row-main">
        <span className="row-title"><strong>{name(r.patientId)} → {doctorName(r.toDoctorId)}</strong> <Badge>{r.status}</Badge></span><p>{r.reason}</p></div>
        <div className="row-actions"><button className="link-button" onClick={() => setEditing(r)}>Edit</button><button className="link-button danger" onClick={() => setDeleting(r)}>Withdraw</button></div></li>)}</ul>}</Async></Section>
    </div>
    {editing && <Dialog title="Edit referral" onClose={() => setEditing(null)}><RecordForm fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]} initial={editing} onCancel={() => setEditing(null)} onSubmit={async v => { await api.patch(`c/referrals/${editing.id}`, v); setEditing(null); list.reload(); }} /></Dialog>}
    {deleting && <Confirm title="Withdraw referral?" message="The referral will be deleted." confirmLabel="Withdraw" onClose={() => setDeleting(null)} onConfirm={async () => { await api.del(`c/referrals/${deleting.id}`); list.reload(); }} />}
  </>;
}

type Performance = { consultations: number; noShows: number; earnings: number; averageMinutes: number | null; averageRating: number | null; ratingCount: number; byMonth: { month: string; consultations: number; earnings: number }[]; feedback: { id: string; rating: number; comment?: string; createdAt: string }[] };
export function DoctorPerformance() {
  const perf = useData<Performance>('doctor/performance');
  return <>
    <PageTitle eyebrow="EARNINGS & PERFORMANCE" title="Earnings and performance">Earnings are fees of completed visits. Payment collection, payouts, and invoices are to be decided.</PageTitle>
    <Async state={perf}>{p => <>
      <div className="stats">
        <div className="stat"><strong>{formatMoney(p.earnings)}</strong><span>earned (completed visits)</span></div>
        <div className="stat"><strong>{p.consultations}</strong><span>consultations</span></div>
        <div className="stat"><strong>{p.averageMinutes ?? '—'}{p.averageMinutes !== null && <small> min</small>}</strong><span>average duration</span></div>
        <div className="stat"><strong>{p.averageRating ?? '—'}</strong><span>{p.ratingCount} rating{p.ratingCount === 1 ? '' : 's'}</span></div>
        <div className="stat"><strong>{p.noShows}</strong><span>no-shows</span></div>
      </div>
      <div className="grid-2">
        <Section title="By month">{!p.byMonth.length ? <Empty title="No completed visits yet" /> : <table className="table"><thead><tr><th>Month</th><th>Visits</th><th>Earnings</th></tr></thead><tbody>{p.byMonth.map(m => <tr key={m.month}><td>{formatDate(`${m.month}-01`).replace(/^1 /, '')}</td><td>{m.consultations}</td><td>{formatMoney(m.earnings)}</td></tr>)}</tbody></table>}</Section>
        <Section title="Patient feedback">{!p.feedback.length ? <Empty title="No feedback yet" /> : <ul className="rows">{p.feedback.map(f => <li key={f.id} className="row"><div className="row-main"><Stars value={f.rating} /><p>{f.comment || <span className="muted">No comment</span>}</p><small>{formatDate(f.createdAt)}</small></div></li>)}</ul>}</Section>
      </div>
    </>}</Async>
  </>;
}

export function DoctorProfile() {
  const { session } = useShell();
  const doctor = useData<Doctor>(session.doctorId ? `c/doctors/${session.doctorId}` : null);
  const [saved, setSaved] = useState(false);
  return <>
    <PageTitle eyebrow="PROFILE" title="Your profile">This information appears to patients when they search and book.</PageTitle>
    {saved && <Notice kind="success">Profile saved.</Notice>}
    <div className="grid-2 wide-left">
      <Section title={<>Profile <Badge>{doctor.data?.verification ?? ''}</Badge></>}><Async state={doctor}>{d => <RecordForm key={d.updatedAt} initial={d} onSubmit={async v => { await api.patch(`c/doctors/${d.id}`, v); doctor.reload(); setSaved(true); }} fields={[
        { name: 'name', label: 'Name', required: true }, { name: 'specialty', label: 'Specialty', required: true }, { name: 'qualifications', label: 'Qualifications', required: true, wide: true },
        { name: 'councilNumber', label: 'Medical council no.', required: true }, { name: 'licenseNumber', label: 'Licence no.', required: true },
        { name: 'languages', label: 'Languages (comma separated)', type: 'list', required: true }, { name: 'experienceYears', label: 'Years of experience', type: 'number' },
        { name: 'clinic', label: 'Clinic / hospital', required: true }, { name: 'clinicAddress', label: 'Clinic address' }, { name: 'bio', label: 'Bio', type: 'textarea' },
      ]} />}</Async></Section>
      <CrudList<Favorite> collection="favorites" noun="Favourite prescription" title="Favourite prescriptions" canCreate={false} fields={[{ name: 'name', label: 'Name', required: true }]}
        emptyText="Save favourites from the prescription editor" render={f => <><strong>{f.name}</strong><p>{f.items.map(i => `${i.drug} ${i.dose} ${i.frequency} × ${i.durationDays}d`).join('; ')}</p></>} />
    </div>
  </>;
}
