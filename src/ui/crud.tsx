'use client';
// Generic form + list used by most screens: describe the fields once and get add / edit / delete.
import { useState, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorText, useData, ClientError } from './api';
import { Confirm, Dialog, Empty, Loading, Notice } from './components';

export type FieldDef = {
  name: string; label: string; required?: boolean; hint?: string; placeholder?: string; wide?: boolean;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'time' | 'datetime' | 'select' | 'checkbox' | 'list' | 'email' | 'tel';
  options?: { value: string; label: string }[]; step?: string; min?: number; max?: number;
};
type Values = Record<string, string | boolean>;
type AnyRow = { id: string; [key: string]: unknown };

/** Converts a stored value into the string/boolean an input expects. */
function toInput(field: FieldDef, value: unknown): string | boolean {
  if (field.type === 'checkbox') return Boolean(value);
  if (value === undefined || value === null) return '';
  if (field.type === 'list') return (value as string[]).join(', ');
  if (field.type === 'datetime') { // ISO → clinic-local "YYYY-MM-DDTHH:MM"
    return new Date(Date.parse(String(value)) + 5.5 * 3_600_000).toISOString().slice(0, 16);
  }
  return String(value);
}
/** Converts form values to an API payload. Empty optional fields are left out on create and cleared (null) on edit. */
export function toPayload(fields: FieldDef[], values: Values, editing: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'checkbox') { out[f.name] = Boolean(v); continue; }
    const s = String(v ?? '').trim();
    if (s === '') { if (editing) out[f.name] = null; continue; }
    if (f.type === 'number') out[f.name] = Number(s);
    else if (f.type === 'list') out[f.name] = s.split(',').map(x => x.trim()).filter(Boolean);
    else if (f.type === 'datetime') out[f.name] = new Date(`${s}:00+05:30`).toISOString();
    else out[f.name] = s;
  }
  return out;
}

export function FieldInput({ field, value, onChange, error }: { field: FieldDef; value: string | boolean; onChange: (v: string | boolean) => void; error?: string[] }) {
  const common = { id: `f-${field.name}`, required: field.required, placeholder: field.placeholder, 'aria-invalid': !!error };
  const input = field.type === 'textarea' ? <textarea {...common} rows={3} value={String(value)} onChange={e => onChange(e.target.value)} />
    : field.type === 'select' ? <select {...common} value={String(value)} onChange={e => onChange(e.target.value)}>{!field.required && <option value="">—</option>}{field.required && value === '' && <option value="" disabled>Choose…</option>}{field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    : field.type === 'checkbox' ? <input {...common} type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />
    : <input {...common} type={field.type === 'datetime' ? 'datetime-local' : field.type === 'list' || !field.type ? 'text' : field.type} step={field.step} min={field.min} max={field.max} value={String(value)} onChange={e => onChange(e.target.value)} />;
  return <label className={`field ${field.type === 'checkbox' ? 'field-check' : ''} ${field.wide || field.type === 'textarea' ? 'field-wide' : ''}`} htmlFor={common.id}>
    <span>{field.label}{field.required && <span className="required"> *</span>}</span>{input}
    {field.hint && <small>{field.hint}</small>}{error && <small className="field-error">{error.join(' ')}</small>}
  </label>;
}

/** Add/edit form for one record. `fixed` values are always sent (e.g. the patient the record belongs to). */
export function RecordForm({ fields, initial, defaults, fixed = {}, submitLabel = 'Save', onSubmit, onCancel }: {
  fields: FieldDef[]; initial?: Record<string, unknown>; defaults?: Record<string, unknown>; fixed?: Record<string, unknown>; submitLabel?: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>; onCancel?: () => void;
}) {
  const [values, setValues] = useState<Values>(() => Object.fromEntries(fields.map(f => [f.name, toInput(f, (initial ?? defaults)?.[f.name])])));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <form className="form-grid" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError(''); setErrors({});
    try { await onSubmit({ ...toPayload(fields, values, !!initial), ...fixed }); setBusy(false); }
    catch (err) { setError(errorText(err)); if (err instanceof ClientError) setErrors(err.fieldErrors); setBusy(false); }
  }}>
    {fields.map(f => <FieldInput key={f.name} field={f} value={values[f.name]} error={errors[f.name]} onChange={v => setValues(s => ({ ...s, [f.name]: v }))} />)}
    {error && <div className="field-wide"><Notice>{error}</Notice></div>}
    <div className="button-row field-wide">{onCancel && <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>}<button className="button" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
  </form>;
}

/**
 * List of records from one collection with add / edit / delete.
 * `query` filters the list (e.g. { patientId }); `fixed` fields are added to new records.
 */
export function CrudList<T extends AnyRow>({ collection, query = {}, fields, fixed, defaults, render, title, noun, sort, canCreate = true, canEdit = true, canDelete = true, emptyText, onChange, editFields, actions }: {
  collection: string; query?: Record<string, string>; fields: FieldDef[]; editFields?: FieldDef[]; fixed?: Record<string, unknown>; defaults?: Record<string, unknown> | (() => Record<string, unknown>);
  render: (row: T) => ReactNode; title?: ReactNode; noun: string; sort?: (a: T, b: T) => number;
  canCreate?: boolean; canEdit?: boolean | ((row: T) => boolean); canDelete?: boolean | ((row: T) => boolean); emptyText?: string; onChange?: () => void;
  /** Extra buttons shown in the card header. */
  actions?: ReactNode;
}) {
  const qs = new URLSearchParams(query).toString();
  const list = useData<T[]>(`c/${collection}${qs ? `?${qs}` : ''}`);
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const changed = () => { list.reload(); onChange?.(); };
  const rows = [...(list.data ?? [])].sort(sort ?? ((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))));
  const allowed = (rule: boolean | ((row: T) => boolean), row: T) => (typeof rule === 'function' ? rule(row) : rule);
  return <section className="card crud">
    <div className="card-head"><h2>{title ?? noun}</h2>{(canCreate || actions) && <div className="actions">{actions}{canCreate && <button className="button small" onClick={() => setEditing('new')}><Plus size={15} />Add {noun.toLowerCase()}</button>}</div>}</div>
    {list.error ? <Notice action={<button className="link-button" onClick={list.reload}>Retry</button>}>{list.error}</Notice>
      : !list.data ? <Loading />
      : !rows.length ? <Empty title={emptyText ?? `No ${noun.toLowerCase()} recorded`} />
      : <ul className="rows">{rows.map(row => <li key={row.id} className="row">
          <div className="row-main">{render(row)}</div>
          <div className="row-actions">
            {allowed(canEdit, row) && <button className="icon-button" aria-label={`Edit ${noun.toLowerCase()}`} onClick={() => setEditing(row)}><Pencil size={15} /></button>}
            {allowed(canDelete, row) && <button className="icon-button danger" aria-label={`Delete ${noun.toLowerCase()}`} onClick={() => setDeleting(row)}><Trash2 size={15} /></button>}
          </div>
        </li>)}</ul>}
    {editing && <Dialog title={editing === 'new' ? `Add ${noun.toLowerCase()}` : `Edit ${noun.toLowerCase()}`} onClose={() => setEditing(null)}>
      <RecordForm fields={editing === 'new' ? fields : editFields ?? fields} initial={editing === 'new' ? undefined : editing} defaults={typeof defaults === 'function' ? defaults() : defaults} fixed={editing === 'new' ? fixed : undefined}
        onCancel={() => setEditing(null)}
        onSubmit={async payload => {
          if (editing === 'new') await api.post(`c/${collection}`, payload); else await api.patch(`c/${collection}/${editing.id}`, payload);
          setEditing(null); changed();
        }} />
    </Dialog>}
    {deleting && <Confirm title={`Delete ${noun.toLowerCase()}?`} message="This permanently removes the record." onClose={() => setDeleting(null)} onConfirm={async () => { await api.del(`c/${collection}/${deleting.id}`); changed(); }} />}
  </section>;
}
