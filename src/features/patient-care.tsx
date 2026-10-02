'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Download, Languages, MapPin, ShieldOff, Star, Trash2, UserPlus } from 'lucide-react';
import type { AccessBlock, Appointment, AppointmentType, AuditEntry, Consent, Doctor, Feedback, Patient, Referral, User } from '../shared/schemas';
import { LANGUAGES, SPECIALTIES } from '../shared/reference';
import { addDays, formatDate, formatDateTime, formatMoney, istDate } from '../shared/time';
import { api, errorText, useData } from '../ui/api';
import { Async, Avatar, Badge, Confirm, Dialog, Empty, KeyValues, Notice, PageTitle, Section, Stars, Tabs } from '../ui/components';
import { CrudList, RecordForm, type FieldDef } from '../ui/crud';
import { useShell } from '../ui/shell';
import { EmergencyBanner, downloadExport } from './shared';
import { SlotPicker, intakeFields } from './patient-health';
import { HealthRecords, UploadedPrescriptions, type RecordSummary } from './records';

type DirectoryDoctor = Doctor & { types: AppointmentType[]; minFee: number | null; rating: number | null; ratingCount: number; nextAvailable: string | null };

export function FindDoctor() {
  const directory = useData<DirectoryDoctor[]>('directory');
  const [f, setF] = useState({ q: '', specialty: '', language: '', maxFee: '', minRating: '', within: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const results = (directory.data ?? []).filter(d =>
    (!f.q || d.name.toLowerCase().includes(f.q.toLowerCase()) || d.specialty.toLowerCase().includes(f.q.toLowerCase()))
    && (!f.specialty || d.specialty === f.specialty) && (!f.language || d.languages.includes(f.language))
    && (!f.maxFee || (d.minFee ?? Infinity) <= Number(f.maxFee)) && (!f.minRating || (d.rating ?? 0) >= Number(f.minRating))
    && (!f.within || (!!d.nextAvailable && istDate(d.nextAvailable) <= addDays(istDate(), Number(f.within)))));
  return <>
    <PageTitle eyebrow="FIND A DOCTOR" title="Book a face-to-face visit">Filter by specialty, language, fee, availability, and rating.</PageTitle>
    <section className="card filters">
      <label className="field field-wide"><span>Search</span><input value={f.q} onChange={set('q')} placeholder="Doctor name or specialty" /></label>
      <label className="field"><span>Specialty</span><select value={f.specialty} onChange={set('specialty')}><option value="">Any</option>{SPECIALTIES.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="field"><span>Language</span><select value={f.language} onChange={set('language')}><option value="">Any</option>{LANGUAGES.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="field"><span>Max fee (₹)</span><input type="number" min={0} value={f.maxFee} onChange={set('maxFee')} placeholder="Any" /></label>
      <label className="field"><span>Availability</span><select value={f.within} onChange={set('within')}><option value="">Any time</option><option value="0">Today</option><option value="2">Within 3 days</option><option value="6">Within a week</option></select></label>
      <label className="field"><span>Rating</span><select value={f.minRating} onChange={set('minRating')}><option value="">Any</option><option value="4">4★ and above</option><option value="3">3★ and above</option></select></label>
    </section>
    <Async state={directory}>{() => !results.length ? <Empty title="No doctors match these filters" /> : <div className="doctor-grid">{results.map(d => <article key={d.id} className="card doctor-card">
      <div className="doctor-head"><Avatar name={d.name} /><div><h3>{d.name}</h3><p className="muted">{d.specialty} · {d.qualifications}</p><Stars value={d.rating} />{d.ratingCount > 0 && <small> ({d.ratingCount})</small>}</div></div>
      <p className="small"><Languages size={13} /> {d.languages.join(', ')} · <MapPin size={13} /> {d.clinic}</p>
      <div className="doctor-foot"><span><strong>{d.minFee !== null ? `From ${formatMoney(d.minFee)}` : 'Fee on request'}</strong><small>{d.nextAvailable ? `Next: ${formatDateTime(d.nextAvailable)}` : 'No slots in 3 weeks'}</small></span><Link className="button small" href={`/patient/doctors/${d.id}`}>View & book</Link></div>
    </article>)}</div>}</Async>
  </>;
}

export function BookDoctor({ doctorId }: { doctorId: string }) {
  const router = useRouter();
  const { activePatientId, family } = useShell();
  const directory = useData<DirectoryDoctor[]>('directory');
  const [typeId, setTypeId] = useState(''); const [start, setStart] = useState(''); const [reason, setReason] = useState('');
  const doctor = directory.data?.find(d => d.id === doctorId);
  const who = family.find(p => p.id === activePatientId);
  return <Async state={directory}>{() => !doctor ? <Notice>This doctor is not available for booking.</Notice> : <>
    <Link className="link back" href="/patient/doctors">← All doctors</Link>
    <div className="grid-2 wide-left">
      <Section title={<span className="doctor-head"><Avatar name={doctor.name} size="lg" /><span>{doctor.name}<small className="block muted">{doctor.specialty}</small></span></span>}>
        <p>{doctor.bio}</p>
        <KeyValues items={[['Qualifications', doctor.qualifications], ['Experience', doctor.experienceYears !== undefined ? `${doctor.experienceYears} years` : undefined], ['Languages', doctor.languages.join(', ')], ['Clinic', `${doctor.clinic}${doctor.clinicAddress ? `, ${doctor.clinicAddress}` : ''}`], ['Registration', doctor.councilNumber], ['Rating', <Stars key="r" value={doctor.rating} />]]} />
        <h3>Fees</h3><ul className="rows">{doctor.types.map(t => <li className="row" key={t.id}><div className="row-main"><strong>{t.name}</strong><p>{t.durationMinutes} minutes · in person</p></div><strong>{formatMoney(t.fee)}</strong></li>)}</ul>
        <Notice kind="info">Payment is collected at the clinic. Online payments are to be decided.</Notice>
      </Section>
      <Section title={`Book for ${who?.name ?? 'patient'}`}>
        <EmergencyBanner />
        <label className="field"><span>Appointment type <span className="required">*</span></span><select value={typeId} onChange={e => { setTypeId(e.target.value); setStart(''); }}><option value="">Choose…</option>{doctor.types.map(t => <option key={t.id} value={t.id}>{t.name} · {t.durationMinutes} min · {formatMoney(t.fee)}</option>)}</select></label>
        <div className="field"><span>Date and time <span className="required">*</span></span><SlotPicker doctorId={doctor.id} typeId={typeId} value={start} onChange={setStart} /></div>
        <label className="field"><span>Reason for visit</span><input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} /></label>
        <h3>Pre-consultation questions</h3>
        <RecordForm fields={intakeFields} submitLabel={start ? `Request ${formatDateTime(start)}` : 'Choose a time'} onSubmit={async intake => {
          if (!typeId || !start) throw new Error('Choose an appointment type and a time.');
          const clean = Object.fromEntries(Object.entries(intake).filter(([, v]) => v !== null));
          await api.post('c/appointments', { patientId: activePatientId, doctorId, typeId, start, ...(reason ? { reason } : {}), intake: clean });
          router.push('/patient/appointments?booked=1');
        }} />
      </Section>
    </div>
  </>}</Async>;
}

const UPCOMING = ['requested', 'confirmed', 'checked-in', 'in-consultation'];
export function PatientAppointments() {
  const { activePatientId } = useShell();
  const list = useData<Appointment[]>('c/appointments');
  const doctors = useData<Doctor[]>('c/doctors');
  const types = useData<AppointmentType[]>('c/appointmentTypes');
  const feedback = useData<Feedback[]>('c/feedback');
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [action, setAction] = useState<{ kind: 'intake' | 'reschedule' | 'cancel' | 'feedback' | 'delete'; appt: Appointment } | null>(null);
  const [notice, setNotice] = useState('');
  const mine = (list.data ?? []).filter(a => a.patientId === activePatientId);
  const rows = mine.filter(a => tab === 'upcoming' ? UPCOMING.includes(a.status) : !UPCOMING.includes(a.status)).sort((a, b) => tab === 'upcoming' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start));
  const name = (id: string) => doctors.data?.find(d => d.id === id)?.name ?? 'Doctor';
  const done = (message: string) => { setAction(null); setNotice(message); list.reload(); feedback.reload(); };
  const checkIn = async (a: Appointment) => { try { await api.patch(`c/appointments/${a.id}`, { status: 'checked-in' }); done('You are checked in. Please take a seat — the doctor will call you from the waiting room.'); } catch (e) { setNotice(errorText(e)); } };
  return <>
    <PageTitle eyebrow="APPOINTMENTS" title="Your appointments" actions={<Link className="button" href="/patient/doctors">Book a visit</Link>} />
    {typeof window !== 'undefined' && window.location.search.includes('booked') && !notice && <Notice kind="success">Request sent. The doctor will confirm it shortly; you will get a notification.</Notice>}
    {notice && <Notice kind="info">{notice}</Notice>}
    <Tabs tabs={[{ id: 'upcoming', label: 'Upcoming', count: mine.filter(a => UPCOMING.includes(a.status)).length }, { id: 'past', label: 'Past & cancelled' }]} value={tab} onChange={setTab} />
    <Async state={list}>{() => !rows.length ? <Empty title={tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'} /> : <ul className="rows card">{rows.map(a => {
      const fb = feedback.data?.find(f => f.appointmentId === a.id);
      const today = istDate(a.start) === istDate();
      return <li key={a.id} className="row appt">
        <div className="row-main"><span className="row-title"><strong>{name(a.doctorId)}</strong> <Badge>{a.status}</Badge></span>
          <p>{formatDateTime(a.start)} · {types.data?.find(t => t.id === a.typeId)?.name ?? 'Appointment'} · {formatMoney(a.fee)} · in person</p>
          {a.intake?.chiefComplaint && <small>Concern: {a.intake.chiefComplaint}</small>}{a.cancelReason && <small> · {a.cancelReason}</small>}
          {a.status === 'checked-in' && <Notice kind="success">Waiting room: you are checked in. The doctor will call you shortly.</Notice>}
          {fb && <small className="block">Your rating: {'★'.repeat(fb.rating)} {fb.comment}</small>}
        </div>
        <div className="row-actions wrap">
          {a.status === 'confirmed' && today && <button className="button small" onClick={() => checkIn(a)}>Check in</button>}
          {['requested', 'confirmed'].includes(a.status) && <>
            <button className="link-button" onClick={() => setAction({ kind: 'intake', appt: a })}>Pre-visit answers</button>
            <button className="link-button" onClick={() => setAction({ kind: 'reschedule', appt: a })}>Reschedule</button>
            <button className="link-button danger" onClick={() => setAction({ kind: 'cancel', appt: a })}>Cancel</button></>}
          {a.status === 'completed' && <><button className="link-button" onClick={() => setAction({ kind: 'feedback', appt: a })}>{fb ? 'Edit feedback' : 'Rate visit'}</button><Link className="link" href={`/patient/doctors/${a.doctorId}`}>Book follow-up</Link></>}
          {['cancelled', 'rejected', 'no-show'].includes(a.status) && <button className="icon-button danger" aria-label="Delete appointment" onClick={() => setAction({ kind: 'delete', appt: a })}><Trash2 size={15} /></button>}
        </div>
      </li>;
    })}</ul>}</Async>
    {action?.kind === 'intake' && <Dialog title="Pre-consultation questions" onClose={() => setAction(null)}>
      <RecordForm fields={intakeFields} initial={action.appt.intake ?? {}} onCancel={() => setAction(null)} onSubmit={async v => {
        await api.patch(`c/appointments/${action.appt.id}`, { intake: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) }); done('Your answers were saved.');
      }} /></Dialog>}
    {action?.kind === 'reschedule' && <Reschedule appt={action.appt} onClose={() => setAction(null)} onDone={() => done('Reschedule requested. The doctor will confirm the new time.')} />}
    {action?.kind === 'cancel' && <Dialog title="Cancel appointment" onClose={() => setAction(null)}>
      <RecordForm fields={[{ name: 'cancelReason', label: 'Reason (optional)', type: 'textarea' }]} submitLabel="Cancel appointment" onCancel={() => setAction(null)} onSubmit={async v => {
        await api.patch(`c/appointments/${action.appt.id}`, { status: 'cancelled', ...(v.cancelReason ? { cancelReason: v.cancelReason } : {}) }); done('Appointment cancelled.');
      }} /></Dialog>}
    {action?.kind === 'feedback' && <FeedbackDialog appt={action.appt} existing={feedback.data?.find(f => f.appointmentId === action.appt.id)} onClose={() => setAction(null)} onDone={() => done('Thank you for your feedback.')} />}
    {action?.kind === 'delete' && <Confirm title="Delete appointment?" message="This removes it from your list." onClose={() => setAction(null)} onConfirm={async () => { await api.del(`c/appointments/${action.appt.id}`); done('Appointment deleted.'); }} />}
  </>;
}

function Reschedule({ appt, onClose, onDone }: { appt: Appointment; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState(''); const [error, setError] = useState('');
  return <Dialog title="Choose a new time" onClose={onClose} wide>
    <SlotPicker doctorId={appt.doctorId} typeId={appt.typeId} exclude={appt.id} value={start} onChange={setStart} />
    {error && <Notice>{error}</Notice>}
    <div className="button-row"><button className="button secondary" onClick={onClose}>Keep current time</button><button className="button" disabled={!start} onClick={async () => { try { await api.patch(`c/appointments/${appt.id}`, { start }); onDone(); } catch (e) { setError(errorText(e)); } }}>Request {start ? formatDateTime(start) : 'new time'}</button></div>
  </Dialog>;
}

function FeedbackDialog({ appt, existing, onClose, onDone }: { appt: Appointment; existing?: Feedback; onClose: () => void; onDone: () => void }) {
  const fields: FieldDef[] = [{ name: 'rating', label: 'Rating', type: 'select', required: true, options: [5, 4, 3, 2, 1].map(n => ({ value: String(n), label: `${'★'.repeat(n)} (${n})` })) }, { name: 'comment', label: 'Comment', type: 'textarea' }];
  return <Dialog title="Rate your visit" onClose={onClose}>
    <RecordForm fields={fields} initial={existing ? { ...existing, rating: String(existing.rating) } : undefined} onCancel={onClose} onSubmit={async v => {
      const body = { ...v, rating: Number(v.rating) };
      if (existing) await api.patch(`c/feedback/${existing.id}`, body); else await api.post('c/feedback', { ...body, appointmentId: appt.id });
      onDone();
    }} />
    {existing && <button className="link-button danger" onClick={async () => { await api.del(`c/feedback/${existing.id}`); onDone(); }}><Star size={14} />Remove my feedback</button>}
  </Dialog>;
}

type Summary = RecordSummary & { referrals: (Referral & { fromName: string; toName: string })[] };
export function PatientRecords() {
  const { activePatientId } = useShell();
  const summary = useData<Summary>(activePatientId ? `patients/${activePatientId}/summary` : null);
  const [tab, setTab] = useState('records');
  return <>
    <PageTitle eyebrow="VISITS & RESULTS" title="Your health records">Visits and care summaries, clinic e-prescriptions and prescriptions you upload, lab and imaging results, reports, and referrals. Doctors you book see the same record.</PageTitle>
    <Tabs tabs={[{ id: 'records', label: 'All records' }, { id: 'visits', label: 'Visit history' }, { id: 'prescriptions', label: 'Prescriptions' }, { id: 'results', label: 'Lab & imaging' }, { id: 'referrals', label: 'Referrals' }]} value={tab} onChange={setTab} />
    <Async state={summary}>{s => <>
      {tab === 'records' && <HealthRecords key={activePatientId} patientId={activePatientId} summary={s} rxHref={id => `/patient/prescriptions/${id}`} onChange={summary.reload} />}
      {tab === 'visits' && (!s.consultations.length ? <Empty title="No visits yet" /> : s.consultations.map(c => <Section key={c.id} title={<>{formatDate(c.createdAt)} · {c.doctorName}</>}>
        {c.diagnoses.length > 0 && <p>{c.diagnoses.map(d => <Badge key={d.code} tone="teal">{d.code} {d.label}</Badge>)}</p>}
        <p className="pre">{c.careSummary || c.plan}</p>{c.followUpDate && <p><strong>Follow-up:</strong> {formatDate(c.followUpDate)}</p>}
      </Section>))}
      {tab === 'prescriptions' && <>
        <Section title="Clinic e-prescriptions">{!s.prescriptions.length ? <Empty title="No e-prescriptions yet" /> : <ul className="rows">{s.prescriptions.map(p => <li className="row" key={p.id}><div className="row-main"><strong>{p.items.map(i => i.drug).join(', ')}</strong><p>{p.doctorName} · signed {formatDate(p.signedAt)}</p></div><Link className="button small secondary" href={`/patient/prescriptions/${p.id}`}>View / download</Link></li>)}</ul>}</Section>
        <UploadedPrescriptions key={activePatientId} patientId={activePatientId} onChange={summary.reload} />
      </>}
      {tab === 'results' && (!s.orders.length ? <Empty title="No tests ordered" /> : <ul className="rows card">{s.orders.map(o => <li className="row" key={o.id}><div className="row-main"><span className="row-title"><strong>{o.test}</strong> <Badge tone="grey">{o.kind}</Badge> <Badge>{o.status}</Badge></span>
        <p>{o.status === 'resulted' ? <>{o.result} {o.unit}{o.referenceRange && <span className="muted"> (ref {o.referenceRange})</span>}</> : 'Awaiting result'}</p><small>Ordered by {o.doctorName} · {formatDate(o.createdAt)}{o.resultedAt && ` · resulted ${formatDate(o.resultedAt)}`}</small></div>
        {o.status === 'resulted' && (o.abnormal ? <Badge tone="red">Outside range</Badge> : <Badge tone="green">Normal</Badge>)}</li>)}</ul>)}
      {tab === 'referrals' && (!s.referrals.length ? <Empty title="No referrals" /> : <ul className="rows card">{s.referrals.map(r => <li className="row" key={r.id}><div className="row-main"><strong>{r.fromName} → {r.toName}</strong><p>{r.reason}</p></div><Badge>{r.status}</Badge></li>)}</ul>)}
    </>}</Async>
  </>;
}

const CONSENT_LABEL: Record<Consent['kind'], [string, string]> = {
  terms: ['Terms of use and privacy notice', 'Required to use the app.'],
  telemedicine: ['Remote follow-up', 'Allow doctors to follow up by secure message.'],
  dataSharing: ['Share records with my doctors', 'Doctors you book can view your health profile.'],
};
export function PatientPrivacy() {
  const { activePatientId, session } = useShell();
  const consents = useData<Consent[]>(`c/consents?patientId=${activePatientId}`);
  const doctors = useData<Doctor[]>('c/doctors');
  const log = useData<AuditEntry[]>('c/audit');
  const users = useMemo(() => new Map((doctors.data ?? []).map(d => [d.userId, d.name])), [doctors.data]);
  const [deleting, setDeleting] = useState(false); const [error, setError] = useState('');
  const actor = (e: AuditEntry) => e.actorUserId === session.user.id ? 'You' : users.get(e.actorUserId ?? '') ?? 'Clinic staff';
  return <>
    <PageTitle eyebrow="PRIVACY" title="Your data, your choice">Control consent and who can see your record, review the access log, and export or delete your data.</PageTitle>
    <div className="grid-2">
      <Section title="Consent">
        <Async state={consents}>{rows => <ul className="rows">{rows.map(c => <li className="row" key={c.id}><div className="row-main"><strong>{CONSENT_LABEL[c.kind][0]}</strong><p>{CONSENT_LABEL[c.kind][1]}</p><small>Updated {formatDate(c.updatedAt)}</small></div>
          <label className="switch"><input type="checkbox" checked={c.granted} disabled={c.kind === 'terms'} onChange={async e => { await api.patch(`c/consents/${c.id}`, { granted: e.target.checked }); consents.reload(); }} /><span>{c.granted ? 'Granted' : 'Not granted'}</span></label></li>)}</ul>}</Async>
      </Section>
      <CrudList<AccessBlock> collection="accessBlocks" noun="Blocked doctor" title={<><ShieldOff size={16} /> Who can see my records</>} query={{ patientId: activePatientId }} fixed={{ patientId: activePatientId }}
        emptyText="All doctors you book can see your record" canEdit={false}
        fields={[{ name: 'doctorId', label: 'Doctor', type: 'select', required: true, options: (doctors.data ?? []).map(d => ({ value: d.id, label: `${d.name} · ${d.specialty}` })) }, { name: 'reason', label: 'Reason (optional)' }]}
        render={b => <><strong>{doctors.data?.find(d => d.id === b.doctorId)?.name ?? 'Doctor'}</strong><p>Blocked from viewing or updating this record{b.reason ? ` · ${b.reason}` : ''}</p></>} />
    </div>
    <Section title="Access log" actions={<small className="muted">Who viewed or changed your records</small>}>
      <Async state={log}>{rows => { const mine = rows.filter(r => r.patientId === activePatientId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50); return !mine.length ? <Empty title="No access recorded" /> : <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>{mine.map(r => <tr key={r.id}><td>{formatDateTime(r.at)}</td><td>{actor(r)}</td><td>{r.action.replaceAll('_', ' ').toLowerCase()}{r.collection ? ` · ${r.collection}` : ''}</td></tr>)}</tbody></table></div>; }}</Async>
    </Section>
    <Section title="Your data">
      {error && <Notice>{error}</Notice>}
      <div className="button-row start"><button className="button secondary" onClick={() => downloadExport().catch(e => setError(errorText(e)))}><Download size={16} />Download my data (JSON)</button>
        <button className="button danger" onClick={() => setDeleting(true)}><Trash2 size={16} />Delete my account and data</button></div>
    </Section>
    {deleting && <DeleteAccount onClose={() => setDeleting(false)} />}
  </>;
}

function DeleteAccount({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(''); const [error, setError] = useState('');
  return <Dialog title="Delete account and all data?" onClose={onClose}>
    <p>This permanently deletes your account, your family members&apos; records, appointments, visit history, documents, and messages. It cannot be undone.</p>
    <label className="field"><span>Type DELETE to confirm</span><input value={text} onChange={e => setText(e.target.value)} /></label>
    {error && <Notice>{error}</Notice>}
    <div className="button-row"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button danger" disabled={text !== 'DELETE'} onClick={async () => { try { await api.post('privacy/delete-account', { confirm: text }); window.location.replace('/login'); } catch (e) { setError(errorText(e)); } }}>Delete everything</button></div>
  </Dialog>;
}

const genderOptions = [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }, { value: 'undisclosed', label: 'Prefer not to say' }];
export const demographicsFields: FieldDef[] = [
  { name: 'name', label: 'Full name', required: true }, { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { name: 'gender', label: 'Gender', type: 'select', required: true, options: genderOptions }, { name: 'bloodGroup', label: 'Blood group' },
  { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'address', label: 'Address', wide: true },
  { name: 'emergencyContactName', label: 'Emergency contact' }, { name: 'emergencyContactPhone', label: 'Emergency contact phone', type: 'tel' },
];

export function PatientProfile() {
  const { session, reloadFamily } = useShell();
  const account = useData<User>(`c/users/${session.user.id}`);
  const self = useData<Patient>(session.patientId ? `c/patients/${session.patientId}` : null);
  const [saved, setSaved] = useState('');
  return <>
    <PageTitle eyebrow="PROFILE" title="Profile and family" />
    {saved && <Notice kind="success">{saved}</Notice>}
    <div className="grid-2">
      <Section title="Demographics and contact"><Async state={self}>{p => <RecordForm key={p.updatedAt} fields={demographicsFields} initial={p} onSubmit={async v => { await api.patch(`c/patients/${p.id}`, v); self.reload(); reloadFamily(); setSaved('Profile saved.'); }} />}</Async></Section>
      <Section title="Account and notifications"><Async state={account}>{u => <RecordForm key={u.updatedAt} initial={{ ...u, push: u.notificationChannels.includes('push'), sms: u.notificationChannels.includes('sms'), email_channel: u.notificationChannels.includes('email') }}
        fields={[{ name: 'name', label: 'Display name', required: true }, { name: 'phone', label: 'Sign-in phone', type: 'tel' }, { name: 'email', label: 'Sign-in email', type: 'email', required: true, wide: true },
          { name: 'push', label: 'Push notifications', type: 'checkbox' }, { name: 'sms', label: 'SMS', type: 'checkbox' }, { name: 'email_channel', label: 'Email notifications', type: 'checkbox' }]}
        onSubmit={async v => {
          const channels = (['push', 'sms', 'email'] as const).filter(c => (c === 'email' ? v.email_channel : v[c]));
          await api.patch(`c/users/${u.id}`, { name: v.name, phone: v.phone ?? '', email: v.email, notificationChannels: channels }); account.reload(); setSaved('Account saved. Delivery is simulated in this demo.');
        }} />}</Async></Section>
    </div>
    <CrudList<Patient> collection="patients" noun="Family member" title={<><UserPlus size={16} /> Family and dependents</>} query={{ guardianPatientId: session.patientId ?? '' }} onChange={reloadFamily}
      fields={[{ name: 'name', label: 'Full name', required: true }, { name: 'relationship', label: 'Relationship', required: true, placeholder: 'Son, daughter, parent…' }, ...demographicsFields.slice(1, 4)]}
      render={p => <><strong>{p.name}</strong><p>{p.relationship} · born {formatDate(p.dateOfBirth)}</p></>}
      emptyText="No family members added" />
  </>;
}
