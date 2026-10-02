'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck, Stethoscope, UserRound, UserCog } from 'lucide-react';
import { LANGUAGES, SPECIALTIES } from '../shared/reference';
import { api, errorText, useData } from '../ui/api';
import { Brand, Loading, Notice, Tabs } from '../ui/components';
import { RecordForm, type FieldDef } from '../ui/crud';

type DemoAccount = { name: string; role: 'patient' | 'doctor' | 'admin'; email: string; detail?: string; pending?: boolean };
const ROLE_ICON = { patient: <UserRound size={16} />, doctor: <Stethoscope size={16} />, admin: <UserCog size={16} /> };

function AuthFrame({ children }: { children: React.ReactNode }) {
  return <div className="auth-page">
    <header className="auth-header"><Brand /><span className="badge badge-teal"><ShieldCheck size={12} /> DEMO · DUMMY DATA</span></header>
    <main className="auth-main">
      <section className="auth-story"><div className="eyebrow">DOCTOR · PATIENT APP</div><h1>Care that keeps<br /><em>every detail</em> together.</h1>
        <p>Book face-to-face visits, keep your health profile current, and receive prescriptions, results, and care summaries — all in one place.</p>
        <ul className="story-points"><li>Health profile, family, and documents</li><li>Doctor search, booking, and clinic check-in</li><li>SOAP notes, e-prescriptions with safety checks, orders</li><li>Privacy controls and access log</li></ul></section>
      <section className="auth-panel">{children}</section>
    </main>
  </div>;
}

export function LoginPage() {
  const accounts = useData<DemoAccount[]>('auth/demo-accounts');
  const [identifier, setIdentifier] = useState(''); const [pin, setPin] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [expired, setExpired] = useState(false);
  useEffect(() => { setExpired(new URLSearchParams(window.location.search).has('expired')); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const { role } = await api.post<{ role: string }>('auth/login', { identifier, pin }); window.location.replace(`/${role}`); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  }
  return <AuthFrame><div className="auth-card">
    <span className="auth-icon"><LockKeyhole size={22} /></span><h2>Sign in</h2>
    <p className="muted">Use your email or phone number. Every demo account uses the PIN <strong>1234</strong>.</p>
    {expired && <Notice kind="info">Your session ended. Please sign in again.</Notice>}
    <form onSubmit={submit} className="stack-form">
      <label className="field"><span>Email or phone</span><input value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" required placeholder="you@example.com" /></label>
      <label className="field"><span>PIN</span><input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} autoComplete="current-password" required placeholder="4-digit PIN" /></label>
      {error && <Notice>{error}</Notice>}
      <button className="button full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={17} /></button>
    </form>
    <p className="muted center">New here? <Link className="link" href="/register">Create an account</Link></p>
    <div className="quick-accounts"><div className="eyebrow">DEMO ACCOUNTS — TAP TO FILL</div>
      {accounts.data ? accounts.data.map(a => <button key={a.email} type="button" className="quick-account" onClick={() => { setIdentifier(a.email); setPin(''); }}>
        {ROLE_ICON[a.role]}<span><strong>{a.name}</strong><small>{a.detail}{a.pending ? ' · awaiting verification' : ''}</small></span><small className="muted">{a.email}</small>
      </button>) : accounts.error ? <Notice>{accounts.error}</Notice> : <Loading />}
    </div>
  </div></AuthFrame>;
}

const patientFields: FieldDef[] = [
  { name: 'name', label: 'Full name', required: true, wide: true },
  { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { name: 'gender', label: 'Gender', type: 'select', required: true, options: [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }, { value: 'undisclosed', label: 'Prefer not to say' }] },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'phone', label: 'Mobile number', type: 'tel', required: true, hint: 'In a live app this would be verified by OTP.' },
  { name: 'acceptTerms', label: 'I accept the terms of use and privacy notice', type: 'checkbox', required: true, wide: true },
  { name: 'telemedicineConsent', label: 'I consent to remote follow-up (messages)', type: 'checkbox', wide: true },
  { name: 'dataSharingConsent', label: 'I consent to sharing my records with doctors I book', type: 'checkbox', wide: true },
];
const doctorFields: FieldDef[] = [
  { name: 'name', label: 'Full name (as registered)', required: true, wide: true, placeholder: 'Dr …' },
  { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Mobile number', type: 'tel', required: true },
  { name: 'councilNumber', label: 'Medical council registration no.', required: true }, { name: 'licenseNumber', label: 'Licence number', required: true },
  { name: 'specialty', label: 'Specialty', type: 'select', required: true, options: SPECIALTIES.map(s => ({ value: s, label: s })) },
  { name: 'qualifications', label: 'Qualifications', required: true, placeholder: 'MBBS, MD' },
  { name: 'languages', label: 'Languages', type: 'list', required: true, hint: `Comma separated, e.g. ${LANGUAGES.slice(0, 3).join(', ')}` },
  { name: 'clinic', label: 'Clinic or hospital', required: true }, { name: 'experienceYears', label: 'Years of experience', type: 'number', min: 0 },
  { name: 'bio', label: 'Short bio', type: 'textarea' },
];

export function RegisterPage() {
  const [tab, setTab] = useState<'patient' | 'doctor'>('patient');
  return <AuthFrame><div className="auth-card wide">
    <h2>Create an account</h2><p className="muted">You will sign in with the demo PIN <strong>1234</strong>.</p>
    <Tabs tabs={[{ id: 'patient', label: 'I am a patient' }, { id: 'doctor', label: 'I am a doctor' }]} value={tab} onChange={setTab} />
    {tab === 'doctor' && <Notice kind="info">Doctor profiles go live after an admin verifies the registration details.</Notice>}
    <RecordForm key={tab} fields={tab === 'patient' ? patientFields : doctorFields} submitLabel="Create account"
      onSubmit={async payload => { const { role } = await api.post<{ role: string }>(`auth/register/${tab}`, payload); window.location.replace(`/${role}`); }} />
    <p className="muted center">Already registered? <Link className="link" href="/login">Sign in</Link></p>
  </div></AuthFrame>;
}
