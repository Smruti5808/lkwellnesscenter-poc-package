'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Heart, Inbox, X } from 'lucide-react';

export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark"><Heart size={small ? 16 : 22} strokeWidth={1.8} /></span><span>LK <strong>Wellness</strong><small>DOCTOR · PATIENT</small></span></span>;
}

export function Notice({ kind = 'error', children, action }: { kind?: 'error' | 'warning' | 'success' | 'info'; children: ReactNode; action?: ReactNode }) {
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}><span>{children}</span>{action}</div>;
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" />{label}</div>;
}
export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox size={26} />}<strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
/** Shows loading / error / content for a useData() result. */
export function Async<T>({ state, children }: { state: { data?: T; error?: string; loading: boolean; reload: () => void }; children: (data: T) => ReactNode }) {
  if (state.error) return <Notice action={<button className="link-button" onClick={state.reload}>Retry</button>}>{state.error}</Notice>;
  if (state.data === undefined) return <Loading />;
  return <>{children(state.data)}</>;
}

export function PageTitle({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{children && <p className="muted">{children}</p>}</div>{actions && <div className="actions">{actions}</div>}</div>;
}
export function Section({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{(title || actions) && <div className="card-head">{title && <h2>{title}</h2>}{actions && <div className="actions">{actions}</div>}</div>}{children}</section>;
}

const TONE: Record<string, string> = {
  requested: 'amber', confirmed: 'teal', 'checked-in': 'blue', 'in-consultation': 'blue', completed: 'green', cancelled: 'grey', rejected: 'red', 'no-show': 'red',
  draft: 'amber', final: 'green', signed: 'green', ordered: 'amber', resulted: 'green', pending: 'amber', verified: 'green', sent: 'amber', accepted: 'teal', declined: 'red',
  severe: 'red', moderate: 'amber', mild: 'grey', serious: 'red', caution: 'amber',
};
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone ?? TONE[String(children)] ?? 'grey'}`}>{children}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(t => <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>{t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}</button>)}</div>;
}

/** Modal dialog built on the native <dialog> element (focus trapping and Escape handling come from the browser). */
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} aria-label={title}>
    <div className="dialog-head"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
    {children}
  </dialog>;
}

export function Confirm({ title, message, confirmLabel = 'Delete', danger = true, onConfirm, onClose }: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Dialog title={title} onClose={onClose}>
    <p>{message}</p>
    {error && <Notice>{error}</Notice>}
    <div className="button-row"><button className="button secondary" onClick={onClose}>Cancel</button>
      <button className={`button ${danger ? 'danger' : ''}`} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setBusy(false); } }}>{busy ? 'Working…' : confirmLabel}</button></div>
  </Dialog>;
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return <dl className="key-values">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v === undefined || v === null || v === '' ? <span className="muted">Not recorded</span> : v}</dd></div>)}</dl>;
}
export const initials = (name: string) => name.replace(/^Dr\.?\s+/, '').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{initials(name)}</span>;
}
export function Stars({ value }: { value: number | null }) {
  return value === null ? <span className="muted">No ratings yet</span> : <span className="stars" aria-label={`${value} out of 5`}>{'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))} <small>{value}</small></span>;
}
