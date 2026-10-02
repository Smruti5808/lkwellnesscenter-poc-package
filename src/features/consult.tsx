'use client';
// Doctor consultation workspace: SOAP notes, diagnosis coding, prescriptions with safety checks, orders, follow-up, care summary.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Mic, MicOff, Plus, Save, ShieldAlert, Signature, Star, Trash2, Wand2 } from 'lucide-react';
import type { Appointment, AppointmentType, Consultation, Diagnosis, Favorite, Order, Prescription, PrescriptionItem, SafetyWarning } from '../shared/schemas';
import { DRUGS, FREQUENCY_LABEL, ICD10, QUICK_TEXT, SOAP_TEMPLATES } from '../shared/reference';
import { formatDate, formatDateTime } from '../shared/time';
import { api, errorText, useData } from '../ui/api';
import { Async, Badge, Confirm, Dialog, Empty, Notice, Section } from '../ui/components';
import { CrudList, RecordForm, type FieldDef } from '../ui/crud';
import { useShell } from '../ui/shell';
import { SlotPicker } from './patient-health';
import { PatientSnapshot } from './doctor';

type SoapField = 'subjective' | 'objective' | 'assessment' | 'plan';
const SOAP: [SoapField, string][] = [['subjective', 'S — Subjective'], ['objective', 'O — Objective'], ['assessment', 'A — Assessment'], ['plan', 'P — Plan']];
const EDITABLE = ['subjective', 'objective', 'assessment', 'plan', 'diagnoses', 'followUpDate', 'careSummary'] as const;
const blankToNull = (v: unknown) => (v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ? null : v);

type SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null };
function speechRecognition(): (new () => SpeechRecognitionLike) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function ConsultWorkspace({ consultationId }: { consultationId: string }) {
  const router = useRouter();
  const consultation = useData<Consultation>(`c/consultations/${consultationId}`);
  return <Async state={consultation}>{c => <Workspace key={c.id} initial={c} onReload={consultation.reload} onDeleted={() => router.replace(`/doctor/patients/${c.patientId}`)} />}</Async>;
}

function Workspace({ initial, onReload, onDeleted }: { initial: Consultation; onReload: () => void; onDeleted: () => void }) {
  const { session } = useShell();
  const [form, setForm] = useState(initial);
  const [focus, setFocus] = useState<SoapField>('subjective');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false); const [deleting, setDeleting] = useState(false); const [listening, setListening] = useState(false);
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const appointment = useData<Appointment>(initial.appointmentId ? `c/appointments/${initial.appointmentId}` : null);
  // Compare only the fields this screen edits; server fields such as updatedAt change on every save.
  const dirty = EDITABLE.some(k => JSON.stringify(blankToNull(form[k])) !== JSON.stringify(blankToNull(initial[k])));
  const final = initial.status === 'final';
  const set = <K extends keyof Consultation>(k: K, v: Consultation[K]) => setForm(f => ({ ...f, [k]: v }));
  const append = (text: string) => setForm(f => ({ ...f, [focus]: `${f[focus] ? `${f[focus]} ` : ''}${text}` }));

  async function save(extra: Partial<Consultation> = {}) {
    setBusy(true); setMessage(null);
    try {
      await api.patch(`c/consultations/${initial.id}`, { subjective: form.subjective, objective: form.objective, assessment: form.assessment, plan: form.plan, diagnoses: form.diagnoses, followUpDate: form.followUpDate ?? null, careSummary: form.careSummary || null, ...extra });
      setMessage({ kind: 'success', text: extra.status === 'final' ? 'Consultation finalized and shared with the patient.' : 'Notes saved.' }); onReload();
    } catch (e) { setMessage({ kind: 'error', text: errorText(e) }); } finally { setBusy(false); }
  }
  function toggleVoice() {
    const Recognition = speechRecognition();
    if (!Recognition) { setMessage({ kind: 'error', text: 'Voice dictation is not supported in this browser. Use quick text instead.' }); return; }
    if (listening) { recognizer.current?.stop(); return; }
    const r = new Recognition(); r.lang = 'en-IN'; r.interimResults = false; r.continuous = true;
    r.onresult = e => append(Array.from(e.results).slice(-1)[0][0].transcript.trim());
    r.onend = () => setListening(false);
    recognizer.current = r; r.start(); setListening(true);
  }
  useEffect(() => () => recognizer.current?.stop(), []);

  return <div className="workspace">
    <div className="workspace-head">
      <div><div className="eyebrow">CONSULTATION · FACE-TO-FACE</div><h1>Consultation workspace</h1><p className="muted">Started {formatDateTime(initial.createdAt)} · <Badge>{initial.status}</Badge>{dirty && <Badge tone="amber">unsaved</Badge>}</p></div>
      <div className="actions">
        <Link className="link" href={`/doctor/patients/${initial.patientId}`}>Full record</Link>
        <button className="button secondary" disabled={busy || !dirty} onClick={() => save()}><Save size={16} />Save notes</button>
        {!final && <button className="button" disabled={busy} onClick={() => save({ status: 'final' })}><CheckCircle2 size={16} />Finalize & share</button>}
        {final && appointment.data && !['completed', 'cancelled'].includes(appointment.data.status) && <button className="button" onClick={async () => { await api.patch(`c/appointments/${appointment.data!.id}`, { status: 'completed' }); appointment.reload(); setMessage({ kind: 'success', text: 'Visit marked complete.' }); }}>Complete visit</button>}
        <button className="icon-button danger" aria-label="Delete consultation" onClick={() => setDeleting(true)}><Trash2 size={16} /></button>
      </div>
    </div>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    <div className="workspace-grid">
      <div className="stack">
        <Section title="SOAP notes" actions={<>
          <select aria-label="Apply template" value="" onChange={e => { const t = SOAP_TEMPLATES.find(x => x.name === e.target.value); if (t) setForm(f => ({ ...f, subjective: t.subjective, objective: t.objective, assessment: t.assessment, plan: t.plan })); }}><option value="">Apply template…</option>{SOAP_TEMPLATES.map(t => <option key={t.name}>{t.name}</option>)}</select>
          <button className={`button small ${listening ? 'danger' : 'secondary'}`} onClick={toggleVoice} aria-pressed={listening}>{listening ? <MicOff size={14} /> : <Mic size={14} />}{listening ? 'Stop dictation' : 'Dictate'}</button></>}>
          {SOAP.map(([key, label]) => <label key={key} className="field"><span>{label}{focus === key && <small className="muted"> · quick text & dictation go here</small>}</span><textarea rows={key === 'plan' ? 4 : 3} value={form[key]} onFocus={() => setFocus(key)} onChange={e => set(key, e.target.value)} /></label>)}
          <div className="chip-row">{QUICK_TEXT.map(t => <button key={t} type="button" className="chip" onClick={() => append(t)}>+ {t}</button>)}</div>
        </Section>
        <Diagnoses value={form.diagnoses} onChange={d => set('diagnoses', d)} />
        <Section title="Follow-up">
          <label className="field"><span>Follow-up date</span><input type="date" value={form.followUpDate ?? ''} onChange={e => set('followUpDate', e.target.value || undefined)} /></label>
          <FollowUpBooking patientId={initial.patientId} doctorId={session.doctorId!} />
        </Section>
        <Section title="Care summary for the patient" actions={<button className="button small secondary" onClick={async () => { const c = await api.post<Consultation>(`consultations/${initial.id}/care-summary`); set('careSummary', c.careSummary); onReload(); }}><Wand2 size={14} />Generate from notes</button>}>
          <textarea rows={9} aria-label="Care summary" value={form.careSummary ?? ''} onChange={e => set('careSummary', e.target.value)} placeholder="Plain-language summary shared with the patient when the consultation is finalized." />
          <small className="muted">Template-based; review and edit before sharing. No AI is used.</small>
        </Section>
      </div>
      <div className="stack">
        <PatientSnapshot patientId={initial.patientId} appointment={appointment.data} />
        <Prescriptions consultation={initial} />
        <CrudList<Order> collection="orders" noun="Order" title="Lab & imaging orders" query={{ consultationId: initial.id }} fixed={{ patientId: initial.patientId, consultationId: initial.id }} defaults={{ kind: 'lab', status: 'ordered' }} fields={ORDER_FIELDS}
          render={o => <><span className="row-title"><strong>{o.test}</strong> <Badge tone="grey">{o.kind}</Badge> <Badge>{o.status}</Badge>{o.abnormal && <Badge tone="red">abnormal</Badge>}</span><p>{o.result ? `${o.result} ${o.unit ?? ''}${o.referenceRange ? ` (ref ${o.referenceRange})` : ''}` : 'Awaiting result — edit to enter the result when it returns.'}</p></>} />
      </div>
    </div>
    {deleting && <Confirm title="Delete this consultation?" message="Notes are removed; linked prescriptions and orders stay on the record." onClose={() => setDeleting(false)} onConfirm={async () => { await api.del(`c/consultations/${initial.id}`); onDeleted(); }} />}
  </div>;
}

export const ORDER_FIELDS: FieldDef[] = [
  { name: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'lab', label: 'Lab test' }, { value: 'imaging', label: 'Imaging' }] },
  { name: 'test', label: 'Test', required: true, placeholder: 'e.g. HbA1c, Chest X-ray' },
  { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'ordered', label: 'Ordered' }, { value: 'resulted', label: 'Result returned' }, { value: 'cancelled', label: 'Cancelled' }] },
  { name: 'result', label: 'Result', type: 'textarea' }, { name: 'unit', label: 'Unit' }, { name: 'referenceRange', label: 'Reference range' },
  { name: 'abnormal', label: 'Outside reference range (alerts patient and doctor)', type: 'checkbox', wide: true },
];

function Diagnoses({ value, onChange }: { value: Diagnosis[]; onChange: (d: Diagnosis[]) => void }) {
  const [q, setQ] = useState('');
  const matches = q.length < 2 ? [] : ICD10.filter(d => !value.some(v => v.code === d.code) && (d.code.toLowerCase().includes(q.toLowerCase()) || d.label.toLowerCase().includes(q.toLowerCase()))).slice(0, 6);
  return <Section title="Diagnosis (ICD-10)">
    <div className="chip-row">{value.length ? value.map(d => <span key={d.code} className="chip active">{d.code} · {d.label}<button className="chip-x" aria-label={`Remove ${d.code}`} onClick={() => onChange(value.filter(v => v.code !== d.code))}>×</button></span>) : <span className="muted">No diagnosis coded.</span>}</div>
    <label className="field"><span>Search code or term</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. I10 or hypertension" /></label>
    {matches.length > 0 && <ul className="suggestions">{matches.map(d => <li key={d.code}><button onClick={() => { onChange([...value, d]); setQ(''); }}><strong>{d.code}</strong> {d.label}</button></li>)}</ul>}
    <small className="muted">Built-in ICD-10 subset for the demo.</small>
  </Section>;
}

function FollowUpBooking({ patientId, doctorId }: { patientId: string; doctorId: string }) {
  const types = useData<AppointmentType[]>(`c/appointmentTypes?doctorId=${doctorId}`);
  const [open, setOpen] = useState(false); const [typeId, setTypeId] = useState(''); const [start, setStart] = useState(''); const [result, setResult] = useState('');
  return <>
    <button className="button small secondary" onClick={() => setOpen(true)}><Plus size={14} />Book follow-up appointment</button>{result && <Notice kind="success">{result}</Notice>}
    {open && <Dialog title="Book follow-up" onClose={() => setOpen(false)} wide>
      <label className="field"><span>Type</span><select value={typeId} onChange={e => { setTypeId(e.target.value); setStart(''); }}><option value="">Choose…</option>{types.data?.map(t => <option key={t.id} value={t.id}>{t.name} · {t.durationMinutes} min</option>)}</select></label>
      <SlotPicker doctorId={doctorId} typeId={typeId} value={start} onChange={setStart} />
      <div className="button-row"><button className="button" disabled={!start} onClick={async () => { await api.post('c/appointments', { patientId, doctorId, typeId, start, reason: 'Follow-up' }); setResult(`Follow-up booked for ${formatDateTime(start)}. The patient has been notified.`); setOpen(false); }}>Book {start && formatDateTime(start)}</button></div>
    </Dialog>}
  </>;
}

const blankItem = (): PrescriptionItem => ({ drug: '', dose: '', frequency: 'OD', durationDays: 5 });

function Prescriptions({ consultation }: { consultation: Consultation }) {
  const list = useData<Prescription[]>(`c/prescriptions?consultationId=${consultation.id}`);
  const [editing, setEditing] = useState<Prescription | 'new' | null>(null);
  return <Section title="Prescriptions" actions={<button className="button small" onClick={() => setEditing('new')}><Plus size={14} />New prescription</button>}>
    <Async state={list}>{rows => !rows.length ? <Empty title="No prescriptions for this visit" /> : <ul className="rows">{rows.map(p => <li className="row" key={p.id}><div className="row-main"><span className="row-title"><strong>{p.items.map(i => `${i.drug} ${i.dose}`).join(', ')}</strong> <Badge>{p.status}</Badge></span><p>{p.items.map(i => `${FREQUENCY_LABEL[i.frequency]} × ${i.durationDays} d`).join(' · ')}</p>{p.signedAt && <small>Signed {formatDateTime(p.signedAt)}</small>}</div>
      <div className="row-actions"><button className="link-button" onClick={() => setEditing(p)}>{p.status === 'signed' ? 'Edit (re-sign)' : 'Edit / sign'}</button><Link className="link" href={`/doctor/prescriptions/${p.id}`}>View</Link></div></li>)}</ul>}</Async>
    {editing && <PrescriptionEditor consultation={consultation} existing={editing === 'new' ? undefined : editing} onClose={() => { setEditing(null); list.reload(); }} />}
  </Section>;
}

function PrescriptionEditor({ consultation, existing, onClose }: { consultation: Consultation; existing?: Prescription; onClose: () => void }) {
  const favorites = useData<Favorite[]>('c/favorites');
  const [items, setItems] = useState<PrescriptionItem[]>(existing?.items ?? [blankItem()]);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [warnings, setWarnings] = useState<SafetyWarning[]>([]);
  const [ack, setAck] = useState(false);
  const [record, setRecord] = useState(existing);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  const complete = items.filter(i => i.drug.trim() && i.dose.trim());
  const updateItem = (i: number, patch: Partial<PrescriptionItem>) => setItems(list => list.map((it, j) => j === i ? { ...it, ...patch } : it));

  useEffect(() => { // live safety checks
    if (!complete.length) { setWarnings([]); return; }
    const timer = setTimeout(() => api.post<SafetyWarning[]>('prescriptions/check', { patientId: consultation.patientId, items: complete }).then(w => { setWarnings(w); setAck(false); }).catch(() => {}), 300);
    return () => clearTimeout(timer);
  }, [JSON.stringify(complete)]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveDraft(): Promise<Prescription> {
    const saved = record
      ? await api.patch<Prescription>(`c/prescriptions/${record.id}`, { items: complete, notes: notes || null })
      : await api.post<Prescription>('c/prescriptions', { patientId: consultation.patientId, consultationId: consultation.id, items: complete, ...(notes ? { notes } : {}) });
    setRecord(saved); return saved;
  }
  async function run(action: 'save' | 'sign') {
    setBusy(true); setError('');
    try {
      const saved = await saveDraft();
      if (action === 'sign') await api.post(`prescriptions/${saved.id}/sign`, { acknowledgedWarnings: warnings.map(w => w.message) });
      onClose();
    } catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return <Dialog title={existing ? 'Edit prescription' : 'New prescription'} onClose={onClose} wide>
    {existing?.status === 'signed' && <Notice kind="warning">Saving changes removes the current signature. Sign again to reissue.</Notice>}
    <div className="chip-row"><span className="muted small">Favourites:</span>{favorites.data?.map(f => <button key={f.id} className="chip" onClick={() => setItems(f.items.map(i => ({ ...i })))}><Star size={12} /> {f.name}</button>)}
      {complete.length > 0 && <button className="chip" onClick={async () => { const name = window.prompt('Name this favourite'); if (name) { await api.post('c/favorites', { name, items: complete }); favorites.reload(); } }}>+ Save as favourite</button>}</div>
    <datalist id="drug-list">{DRUGS.map(d => <option key={d.name} value={d.name}>{d.drugClass}</option>)}</datalist>
    <div className="rx-items">{items.map((item, i) => <div className="rx-item" key={i}>
      <label className="field"><span>Medicine</span><input list="drug-list" value={item.drug} onChange={e => { const info = DRUGS.find(d => d.name === e.target.value); updateItem(i, info ? { drug: info.name, strength: info.strengths[0], dose: info.defaultDose, frequency: info.defaultFrequency } : { drug: e.target.value }); }} /></label>
      <label className="field"><span>Strength</span><input value={item.strength ?? ''} onChange={e => updateItem(i, { strength: e.target.value || undefined })} /></label>
      <label className="field"><span>Dose</span><input value={item.dose} onChange={e => updateItem(i, { dose: e.target.value })} placeholder="500 mg" /></label>
      <label className="field"><span>Frequency</span><select value={item.frequency} onChange={e => updateItem(i, { frequency: e.target.value as PrescriptionItem['frequency'] })}>{Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></label>
      <label className="field"><span>Days</span><input type="number" min={1} max={365} value={item.durationDays} onChange={e => updateItem(i, { durationDays: Number(e.target.value) || 1 })} /></label>
      <label className="field"><span>Instructions</span><input value={item.instructions ?? ''} onChange={e => updateItem(i, { instructions: e.target.value || undefined })} placeholder="After food" /></label>
      <button className="icon-button danger" aria-label={`Remove medicine ${i + 1}`} onClick={() => setItems(list => list.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
    </div>)}</div>
    <button className="link-button" onClick={() => setItems(list => [...list, blankItem()])}><Plus size={14} />Add medicine</button>
    <label className="field"><span>Notes</span><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <div className="safety">{!complete.length ? <p className="muted">Safety checks run as you add medicines.</p> : !warnings.length ? <Notice kind="success">No interaction, allergy, duplicate, or dose-limit warnings found (demo rules).</Notice>
      : <><Notice kind="warning"><ShieldAlert size={16} /> {warnings.length} safety warning{warnings.length > 1 ? 's' : ''} (demo rules — not clinical guidance)</Notice><ul className="warnings">{warnings.map(w => <li key={w.message}><Badge>{w.severity}</Badge> <Badge tone="grey">{w.kind}</Badge> {w.message}</li>)}</ul>
        <label className="field field-check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /><span>I have reviewed these warnings and want to proceed</span></label></>}</div>
    {error && <Notice>{error}</Notice>}
    <div className="button-row">
      {record && <button className="link-button danger" onClick={() => setConfirmDelete(true)}>Delete prescription</button>}
      <button className="button secondary" disabled={busy || !complete.length} onClick={() => run('save')}>Save draft</button>
      <button className="button" disabled={busy || !complete.length || (warnings.length > 0 && !ack)} onClick={() => run('sign')}><Signature size={16} />Sign & issue</button>
    </div>
    {confirmDelete && record && <Confirm title="Delete prescription?" message="It will be removed from the patient's record." onClose={() => setConfirmDelete(false)} onConfirm={async () => { await api.del(`c/prescriptions/${record.id}`); onClose(); }} />}
  </Dialog>;
}

/** Starts (or resumes) the consultation for an appointment and opens the workspace. */
export async function openConsultation(appointment: Appointment): Promise<string> {
  const existing = await api.get<Consultation[]>(`c/consultations?appointmentId=${appointment.id}`);
  if (existing[0]) return existing[0].id;
  if (['confirmed', 'checked-in'].includes(appointment.status)) await api.patch(`c/appointments/${appointment.id}`, { status: 'in-consultation' });
  const c = await api.post<Consultation>('c/consultations', { patientId: appointment.patientId, appointmentId: appointment.id, subjective: appointment.intake?.chiefComplaint ? `${appointment.intake.chiefComplaint}. ${appointment.intake.symptoms ?? ''}`.trim() : '' });
  return c.id;
}
export { RecordForm, formatDate };
