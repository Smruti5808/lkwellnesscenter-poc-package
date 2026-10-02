'use client';
// Health records shared by the patient's "Visits & results" page and the doctor's patient record:
// one timeline of visits, prescriptions (clinic-issued and uploaded), lab and imaging results, and reports.
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { FileText, FileUp, FlaskConical, Pill, Search, Stethoscope } from 'lucide-react';
import type { Consultation, DocumentRow, Order, Prescription } from '../shared/schemas';
import { FREQUENCY_LABEL } from '../shared/reference';
import { formatDate, formatMonth, istDate } from '../shared/time';
import { Badge, Empty, Section } from '../ui/components';
import { CrudList } from '../ui/crud';
import { DocumentLink } from './shared';
import { UploadDialog, prescriptionUploadFields } from './patient-health';

/** The parts of /patients/{id}/summary the records views use. */
export type RecordSummary = {
  consultations: (Consultation & { doctorName: string })[]; prescriptions: (Prescription & { doctorName: string })[];
  orders: (Order & { doctorName: string })[]; documents: DocumentRow[];
};

type Kind = 'visit' | 'prescription' | 'result' | 'report';
type Entry = { key: string; kind: Kind; date: string; title: ReactNode; tags?: ReactNode; detail?: ReactNode; action?: ReactNode; search: string };
const KIND_ICON: Record<Kind, ReactNode> = { visit: <Stethoscope size={16} />, prescription: <Pill size={16} />, result: <FlaskConical size={16} />, report: <FileText size={16} /> };
const FILTERS: { id: 'all' | Kind; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'visit', label: 'Visits' }, { id: 'prescription', label: 'Prescriptions' }, { id: 'result', label: 'Lab & imaging' }, { id: 'report', label: 'Reports' },
];
const CATEGORY_LABEL: Record<DocumentRow['category'], string> = { lab: 'lab report', imaging: 'imaging', discharge: 'discharge summary', prescription: 'prescription', other: 'document' };

function toEntries(s: RecordSummary, rxHref: (id: string) => string, consultHref?: (c: Consultation) => string | undefined): Entry[] {
  const visits = s.consultations.map((c): Entry => {
    const href = consultHref?.(c);
    return {
      key: `visit-${c.id}`, kind: 'visit', date: c.createdAt, title: `Visit with ${c.doctorName}`,
      tags: <>{c.status !== 'final' && <Badge>{c.status}</Badge>}{c.diagnoses.map(d => <Badge key={d.code} tone="teal">{d.code} {d.label}</Badge>)}</>,
      detail: <>{(c.careSummary || c.plan) && <details><summary>Care summary</summary><p className="pre">{c.careSummary || c.plan}</p></details>}{c.followUpDate && <p>Follow-up: {formatDate(c.followUpDate)}</p>}</>,
      action: href && <Link className="link" href={href}>Open</Link>,
      search: [c.doctorName, c.assessment, c.plan, c.careSummary, ...c.diagnoses.map(d => `${d.code} ${d.label}`)].join(' '),
    };
  });
  const issued = s.prescriptions.map((p): Entry => ({
    key: `rx-${p.id}`, kind: 'prescription', date: p.signedAt ?? p.createdAt, title: p.items.map(i => i.drug).join(', '),
    tags: <><Badge tone="teal">clinic e-prescription</Badge>{p.status !== 'signed' && <Badge>{p.status}</Badge>}</>,
    detail: <><p>{p.items.map(i => `${i.drug} ${i.dose}, ${FREQUENCY_LABEL[i.frequency].toLowerCase()} for ${i.durationDays} days`).join('; ')}</p><small>{p.doctorName}</small></>,
    action: <Link className="link" href={rxHref(p.id)}>View</Link>,
    search: [p.doctorName, p.notes, ...p.items.map(i => `${i.drug} ${i.instructions ?? ''}`)].join(' '),
  }));
  const documents = s.documents.map((d): Entry => ({
    key: `doc-${d.id}`, kind: d.category === 'prescription' ? 'prescription' : 'report', date: d.documentDate, title: <DocumentLink doc={d} />,
    tags: d.category === 'prescription' ? <Badge tone="amber">uploaded</Badge> : <Badge tone="grey">{CATEGORY_LABEL[d.category]}</Badge>,
    detail: (d.issuedBy || d.notes) && <>{d.issuedBy && <p>{d.issuedBy}</p>}{d.notes && <small>{d.notes}</small>}</>,
    search: [d.title, d.category, d.issuedBy, d.notes].join(' '),
  }));
  const results = s.orders.filter(o => o.status !== 'cancelled').map((o): Entry => ({
    key: `ord-${o.id}`, kind: 'result', date: o.resultedAt ?? o.createdAt, title: o.test,
    tags: <><Badge tone="grey">{o.kind}</Badge>{o.status !== 'resulted' ? <Badge>{o.status}</Badge> : o.abnormal ? <Badge tone="red">Outside range</Badge> : <Badge tone="green">Normal</Badge>}</>,
    detail: <><p>{o.status === 'resulted' ? <>{o.result} {o.unit}{o.referenceRange && <span className="muted"> (ref {o.referenceRange})</span>}</> : 'Awaiting result'}</p><small>Ordered by {o.doctorName} · {formatDate(o.createdAt)}</small></>,
    search: [o.test, o.kind, o.result, o.doctorName].join(' '),
  }));
  return [...visits, ...issued, ...documents, ...results].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Timeline of everything in the patient's record, grouped by month, with counts, filters, and search.
 * `rxHref` links e-prescriptions; `consultHref` optionally links visits (the doctor's own notes).
 */
export function HealthRecords({ patientId, summary, rxHref, consultHref, onChange }: {
  patientId: string; summary: RecordSummary; rxHref: (id: string) => string; consultHref?: (c: Consultation) => string | undefined; onChange: () => void;
}) {
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [q, setQ] = useState(''); const [uploading, setUploading] = useState(false);
  const all = toEntries(summary, rxHref, consultHref);
  const shown = all.filter(e => (filter === 'all' || e.kind === filter) && (!q.trim() || e.search.toLowerCase().includes(q.trim().toLowerCase())));
  const months = [...new Set(shown.map(e => istDate(e.date).slice(0, 7)))];
  const count = (kind: 'all' | Kind) => (kind === 'all' ? all.length : all.filter(e => e.kind === kind).length);
  const resulted = summary.orders.filter(o => o.status === 'resulted');
  const outside = resulted.filter(o => o.abnormal).length;
  const uploaded = summary.documents.filter(d => d.category === 'prescription').length;
  const lastVisit = summary.consultations[0];
  return <>
    <div className="stats">
      <div className="stat"><strong>{count('visit')}</strong><span>visits{lastVisit ? ` · last ${formatDate(lastVisit.createdAt)}` : ''}</span></div>
      <div className="stat"><strong>{count('prescription')}</strong><span>prescriptions · {uploaded} uploaded</span></div>
      <div className={`stat ${outside ? 'alert' : ''}`}><strong>{resulted.length}</strong><span>test results{outside ? ` · ${outside} outside range` : ''}</span></div>
      <div className="stat"><strong>{count('report')}</strong><span>reports and documents</span></div>
    </div>
    <section className="card records-tools">
      <div className="chip-row" role="group" aria-label="Record type">{FILTERS.map(f => <button type="button" key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} <small>{count(f.id)}</small></button>)}</div>
      <div className="records-search">
        <label className="search-box"><Search size={15} /><span className="sr-only">Search records</span><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search medicine, test, diagnosis, or doctor" /></label>
        <button className="button small" onClick={() => setUploading(true)}><FileUp size={15} />Upload prescription</button>
      </div>
    </section>
    {!shown.length ? <Empty title={all.length ? 'No records match' : 'No records yet'}>{all.length ? 'Try another filter or search.' : 'Visits, prescriptions, and results appear here.'}</Empty>
      : months.map(m => <Section key={m} title={formatMonth(`${m}-01`)}><ul className="timeline">{shown.filter(e => istDate(e.date).startsWith(m)).map(e => <li key={e.key} className="timeline-item">
        <span className={`timeline-icon ${e.kind}`} aria-hidden="true">{KIND_ICON[e.kind]}</span>
        <div className="row-main"><span className="row-title"><strong>{e.title}</strong> {e.tags}</span>{e.detail}<small className="block muted">{formatDate(e.date)}</small></div>
        {e.action && <div className="row-actions">{e.action}</div>}
      </li>)}</ul></Section>)}
    {uploading && <UploadDialog patientId={patientId} category="prescription" onClose={() => setUploading(false)} onDone={() => { setUploading(false); onChange(); }} />}
  </>;
}

/** Prescriptions the patient (or a doctor) uploaded, with upload, view, edit, and delete. */
export function UploadedPrescriptions({ patientId, editable = true, onChange }: { patientId: string; editable?: boolean; onChange?: () => void }) {
  const [uploading, setUploading] = useState(false); const [key, setKey] = useState(0);
  return <>
    <CrudList<DocumentRow> key={key} collection="documents" noun="Uploaded prescription" title={<><FileUp size={16} /> Uploaded prescriptions</>} query={{ patientId, category: 'prescription' }}
      fields={prescriptionUploadFields} canCreate={false} canEdit={editable} canDelete={editable} onChange={onChange} emptyText="No prescriptions uploaded yet"
      actions={editable && <button className="button small" onClick={() => setUploading(true)}><FileUp size={15} />Upload prescription</button>}
      sort={(a, b) => b.documentDate.localeCompare(a.documentDate)}
      render={d => <><span className="row-title"><DocumentLink doc={d} /> <Badge tone="amber">uploaded</Badge></span><p>{[formatDate(d.documentDate), d.issuedBy].filter(Boolean).join(' · ')}</p>{d.notes && <small>{d.notes}</small>}</>} />
    {uploading && <UploadDialog patientId={patientId} category="prescription" onClose={() => setUploading(false)} onDone={() => { setUploading(false); setKey(k => k + 1); onChange?.(); }} />}
  </>;
}
