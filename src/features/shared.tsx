'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, Pencil, Phone, Printer, Send, Trash2 } from 'lucide-react';
import type { Doctor, DocumentRow, Message, Notification, Patient, Prescription, Vital } from '../shared/schemas';
import { EMERGENCY_NUMBER, FREQUENCY_LABEL } from '../shared/reference';
import { ageOn, formatDate, formatDateTime, formatTime } from '../shared/time';
import { api, errorText, request, useData } from '../ui/api';
import { Async, Badge, Confirm, Empty, Notice, PageTitle, Section } from '../ui/components';
import { useShell } from '../ui/shell';

export function EmergencyBanner() {
  return <div className="emergency" role="note"><AlertTriangle size={18} /><span><strong>Not for emergencies.</strong> If you have chest pain, difficulty breathing, severe bleeding, or another emergency, call <a href={`tel:${EMERGENCY_NUMBER}`}>{EMERGENCY_NUMBER}</a> or go to the nearest emergency department.</span><a className="button small danger" href={`tel:${EMERGENCY_NUMBER}`}><Phone size={14} />Call {EMERGENCY_NUMBER}</a></div>;
}

export function NotificationsPage() {
  const { refreshBadges } = useShell();
  const list = useData<Notification[]>('c/notifications');
  const refresh = () => { list.reload(); refreshBadges(); };
  return <>
    <PageTitle title="Notifications" actions={<button className="button secondary small" onClick={async () => { await api.post('notifications/read-all'); refresh(); }}>Mark all read</button>}>
      Push, SMS, and email delivery are simulated in this demo; the channels each alert would use are shown on it.
    </PageTitle>
    <Async state={list}>{rows => !rows.length ? <Empty title="No notifications" /> : <ul className="rows card">{[...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(n => <li key={n.id} className={`row ${n.readAt ? '' : 'unread'}`}>
      <div className="row-main"><strong>{n.title}</strong><p>{n.body}</p><small>{formatDateTime(n.createdAt)} · via {n.channels.join(', ') || 'in-app'}</small></div>
      <div className="row-actions">
        {n.link && <Link className="link" href={n.link} onClick={() => !n.readAt && api.patch(`c/notifications/${n.id}`, { read: true }).then(refresh)}>Open</Link>}
        <button className="link-button" onClick={async () => { await api.patch(`c/notifications/${n.id}`, { read: !n.readAt }); refresh(); }}>{n.readAt ? 'Mark unread' : 'Mark read'}</button>
        <button className="icon-button danger" aria-label="Delete notification" onClick={async () => { await api.del(`c/notifications/${n.id}`); refresh(); }}><Trash2 size={15} /></button>
      </div></li>)}</ul>}</Async>
  </>;
}

/** Opens a protected document in a new tab via an authenticated fetch. */
export function DocumentLink({ doc }: { doc: DocumentRow }) {
  const [error, setError] = useState('');
  return <span className="doc-link">
    <button className="link-button" onClick={async () => {
      setError('');
      const tab = window.open('', '_blank');
      try {
        const response = await fetch(`/api/v1/documents/${doc.id}/file`, { cache: 'no-store' });
        if (!response.ok) throw new Error('The file is unavailable.');
        const url = URL.createObjectURL(await response.blob());
        if (tab) tab.location.href = url; else window.location.href = url;
      } catch (e) { tab?.close(); setError(errorText(e)); }
    }}><FileText size={15} />{doc.title}</button>
    {error && <small className="field-error">{error}</small>}
  </span>;
}

export function VitalsSummary({ vital }: { vital?: Vital }) {
  if (!vital) return <p className="muted">No vitals recorded.</p>;
  const items: [string, string | undefined][] = [
    ['Blood pressure', vital.systolic && vital.diastolic ? `${vital.systolic}/${vital.diastolic} mmHg` : undefined],
    ['Pulse', vital.pulse ? `${vital.pulse} bpm` : undefined], ['SpO₂', vital.spo2 ? `${vital.spo2}%` : undefined],
    ['Glucose', vital.glucoseMgDl ? `${vital.glucoseMgDl} mg/dL` : undefined], ['Weight', vital.weightKg ? `${vital.weightKg} kg` : undefined], ['Height', vital.heightCm ? `${vital.heightCm} cm` : undefined],
  ];
  return <div className="vital-grid">{items.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value ?? '—'}</strong></div>)}<small className="vital-note">Recorded {formatDateTime(vital.recordedAt)} · {vital.source}</small></div>;
}

export const vitalLine = (v: Vital) => [v.systolic && v.diastolic && `BP ${v.systolic}/${v.diastolic}`, v.pulse && `Pulse ${v.pulse}`, v.spo2 && `SpO₂ ${v.spo2}%`, v.glucoseMgDl && `Glucose ${v.glucoseMgDl}`, v.weightKg && `${v.weightKg} kg`, v.heightCm && `${v.heightCm} cm`].filter(Boolean).join(' · ') || 'No values';

/** Printable e-prescription with the fields a prescription must carry. */
export function PrescriptionDocument({ id, back }: { id: string; back: string }) {
  const rx = useData<Prescription>(`c/prescriptions/${id}`);
  const doctors = useData<Doctor[]>('c/doctors');
  const patient = useData<Patient>(rx.data ? `c/patients/${rx.data.patientId}` : null);
  return <Async state={rx}>{p => {
    const doctor = doctors.data?.find(d => d.id === p.doctorId);
    return <div className="prescription-page">
      <div className="no-print button-row"><Link className="button secondary" href={back}>Back</Link><button className="button" onClick={() => window.print()}><Printer size={16} />Print or save as PDF</button></div>
      <article className="prescription card">
        <header><div><h2>{doctor?.name ?? 'Doctor'}</h2><p>{doctor?.qualifications}<br />Reg. no. {doctor?.councilNumber} · {doctor?.specialty}</p></div><div className="right"><strong>{doctor?.clinic}</strong><p>{doctor?.clinicAddress}</p></div></header>
        <div className="rx-patient"><span><strong>Patient:</strong> {patient.data?.name ?? '…'}</span><span><strong>Age/Sex:</strong> {patient.data ? `${ageOn(patient.data.dateOfBirth)} y / ${patient.data.gender}` : '…'}</span><span><strong>Date:</strong> {formatDate(p.signedAt ?? p.createdAt)}</span></div>
        <div className="rx-symbol">℞</div>
        <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
          <tbody>{p.items.map((item, i) => <tr key={i}><td>{i + 1}</td><td><strong>{item.drug}</strong>{item.strength && <small> {item.strength}</small>}</td><td>{item.dose}</td><td>{FREQUENCY_LABEL[item.frequency]}</td><td>{item.durationDays} days</td><td>{item.instructions}</td></tr>)}</tbody></table></div>
        {p.notes && <p><strong>Notes:</strong> {p.notes}</p>}
        <footer>{p.status === 'signed' ? <div className="signature"><strong>Digitally signed by {doctor?.name}</strong><small>{formatDateTime(p.signedAt)} · Signature {p.signature?.slice(0, 16)}…</small><small>Demo signature — not a legally valid e-signature.</small></div> : <Badge>draft</Badge>}</footer>
      </article>
    </div>;
  }}</Async>;
}

type Party = { id: string; name: string; subtitle?: string };
/** Two-way secure messaging between a patient and a doctor. */
export function MessageCenter({ role }: { role: 'patient' | 'doctor' }) {
  const { session, activePatientId } = useShell();
  const messages = useData<Message[]>('c/messages');
  const parties = useData<Party[]>(role === 'doctor' ? 'my/patients' : 'directory');
  const appointments = useData<{ doctorId: string; patientId: string; status: string }[]>(role === 'patient' ? 'c/appointments' : null);
  const [selected, setSelected] = useState('');
  const patientId = role === 'patient' ? activePatientId : selected;
  const doctorId = role === 'doctor' ? session.doctorId! : selected;
  // Patients can message doctors they have seen or booked; doctors can message their patients.
  const contacts = useMemo(() => {
    const all = (parties.data ?? []).map(p => ({ id: p.id, name: p.name, subtitle: (p as unknown as Doctor).specialty }));
    if (role === 'doctor') return all;
    const linked = new Set([...(appointments.data ?? []).filter(a => a.patientId === activePatientId && !['cancelled', 'rejected'].includes(a.status)).map(a => a.doctorId), ...(messages.data ?? []).filter(m => m.patientId === activePatientId).map(m => m.doctorId)]);
    return all.filter(c => linked.has(c.id));
  }, [parties.data, appointments.data, messages.data, role, activePatientId]);
  useEffect(() => { if (!selected && contacts[0]) setSelected(contacts[0].id); }, [contacts, selected]);
  const thread = (messages.data ?? []).filter(m => m.patientId === patientId && m.doctorId === doctorId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const unreadFrom = (id: string) => (messages.data ?? []).filter(m => (role === 'doctor' ? m.patientId === id : m.doctorId === id && m.patientId === activePatientId) && !m.readAt && m.senderUserId !== session.user.id).length;

  const reload = messages.reload;
  useEffect(() => { // mark incoming messages in the open conversation as read
    const unread = thread.filter(m => !m.readAt && m.senderUserId !== session.user.id);
    if (unread.length) void Promise.all(unread.map(m => api.patch(`c/messages/${m.id}`, { read: true }))).then(reload);
  }, [thread.map(m => m.id + (m.readAt ?? '')).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>
    <PageTitle title="Messages">{role === 'patient' ? 'Secure messages with your doctors. For emergencies, call 112.' : 'Secure messages with your patients for post-visit follow-up.'}</PageTitle>
    <div className="messages-layout">
      <Section className="contacts" title={role === 'patient' ? 'Doctors' : 'Patients'}>
        {!contacts.length ? <Empty title="No conversations">{role === 'patient' ? 'Book a doctor to start messaging.' : 'Patients appear after a booking or referral.'}</Empty>
          : <ul className="contact-list">{contacts.map(c => <li key={c.id}><button className={c.id === selected ? 'active' : ''} onClick={() => setSelected(c.id)}><strong>{c.name}</strong>{c.subtitle && <small>{c.subtitle}</small>}{unreadFrom(c.id) > 0 && <span className="dot">{unreadFrom(c.id)}</span>}</button></li>)}</ul>}
      </Section>
      <Section className="thread" title={contacts.find(c => c.id === selected)?.name ?? 'Conversation'}>
        {selected ? <Thread messages={thread} me={session.user.id} onChange={reload} patientId={patientId} doctorId={doctorId} /> : <Empty title="Choose a conversation" />}
      </Section>
    </div>
  </>;
}

function Thread({ messages, me, onChange, patientId, doctorId }: { messages: Message[]; me: string; onChange: () => void; patientId: string; doctorId: string }) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [editing, setEditing] = useState<Message | null>(null); const [deleting, setDeleting] = useState<Message | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return; setError('');
    try {
      if (editing) await api.patch(`c/messages/${editing.id}`, { body: text });
      else await api.post('c/messages', { patientId, doctorId, body: text });
      setText(''); setEditing(null); onChange();
    } catch (err) { setError(errorText(err)); }
  }
  return <>
    <div className="bubbles">{!messages.length && <p className="muted center">No messages yet.</p>}{messages.map(m => <div key={m.id} className={`bubble ${m.senderUserId === me ? 'mine' : ''}`}>
      <p>{m.body}</p><small>{formatDate(m.createdAt)} {formatTime(m.createdAt)}{m.updatedAt !== m.createdAt && m.senderUserId === me && m.body ? ' · edited' : ''}{m.senderUserId === me && (m.readAt ? ' · read' : ' · sent')}</small>
      {m.senderUserId === me && <span className="bubble-actions"><button className="icon-button" aria-label="Edit message" onClick={() => { setEditing(m); setText(m.body); }}><Pencil size={13} /></button><button className="icon-button" aria-label="Delete message" onClick={() => setDeleting(m)}><Trash2 size={13} /></button></span>}
    </div>)}<div ref={end} /></div>
    {error && <Notice>{error}</Notice>}
    <form className="composer" onSubmit={send}><label className="sr-only" htmlFor="compose">Message</label><textarea id="compose" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Write a message" maxLength={2000} />
      <div className="button-row">{editing && <button type="button" className="button secondary small" onClick={() => { setEditing(null); setText(''); }}>Cancel edit</button>}<button className="button small" disabled={!text.trim()}><Send size={14} />{editing ? 'Save' : 'Send'}</button></div></form>
    {deleting && <Confirm title="Delete message?" message="It will be removed for both of you." onClose={() => setDeleting(null)} onConfirm={async () => { await api.del(`c/messages/${deleting.id}`); onChange(); }} />}
  </>;
}

export async function downloadExport() {
  const response = await fetch('/api/v1/privacy/export', { cache: 'no-store' });
  if (!response.ok) throw new Error('Export failed. Please retry.');
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a'); a.href = url; a.download = `my-health-data.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { request };
