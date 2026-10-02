'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Bell, LogOut, ShieldCheck } from 'lucide-react';
import type { Notification, Patient, SessionInfo } from '../shared/schemas';
import { api, useData } from './api';
import { Brand, Loading, Notice } from './components';

type Role = SessionInfo['user']['role'];
type ShellValue = {
  session: SessionInfo;
  /** Patient role: the record being viewed (self or a dependent). */
  activePatientId: string; setActivePatientId: (id: string) => void; family: Patient[]; reloadFamily: () => void;
  refreshBadges: () => void;
};
const ShellContext = createContext<ShellValue | null>(null);
export const useShell = () => { const value = useContext(ShellContext); if (!value) throw new Error('useShell outside AppShell'); return value; };

const NAV: Record<Role, { href: string; label: string }[]> = {
  patient: [{ href: '/patient', label: 'Home' }, { href: '/patient/health', label: 'Health profile' }, { href: '/patient/doctors', label: 'Find a doctor' }, { href: '/patient/appointments', label: 'Appointments' }, { href: '/patient/records', label: 'Visits & results' }, { href: '/patient/messages', label: 'Messages' }, { href: '/patient/privacy', label: 'Privacy' }, { href: '/patient/profile', label: 'Profile & family' }],
  doctor: [{ href: '/doctor', label: 'Today' }, { href: '/doctor/schedule', label: 'Schedule' }, { href: '/doctor/patients', label: 'Patients' }, { href: '/doctor/messages', label: 'Messages' }, { href: '/doctor/referrals', label: 'Referrals' }, { href: '/doctor/performance', label: 'Earnings & performance' }, { href: '/doctor/profile', label: 'Profile' }],
  admin: [{ href: '/admin', label: 'Overview' }, { href: '/admin/doctors', label: 'Doctor verification' }, { href: '/admin/users', label: 'Users' }],
};
// Pages without their own nav item highlight the section they belong to.
const NAV_ALIAS: Record<string, string> = { '/patient/prescriptions': '/patient/records', '/doctor/prescriptions': '/doctor/patients', '/doctor/consult': '/doctor' };

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const pathname = usePathname();
  const session = useData<SessionInfo>('auth/session');
  const notifications = useData<Notification[]>(session.data ? 'c/notifications' : null);
  const family = useData<Patient[]>(session.data?.user.role === 'patient' ? 'c/patients' : null);
  const [activePatientId, setActivePatientId] = useState('');

  useEffect(() => { if (session.data && session.data.user.role !== role) window.location.replace(`/${session.data.user.role}`); }, [session.data, role]);
  useEffect(() => { if (session.data?.patientId && !activePatientId) setActivePatientId(session.data.patientId); }, [session.data, activePatientId]);
  // Refresh the unread badge when moving between pages.
  const reloadNotifications = notifications.reload;
  useEffect(() => { reloadNotifications(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session.error) return <main className="page"><Notice action={<button className="link-button" onClick={session.reload}>Retry</button>}>{session.error}</Notice></main>;
  if (!session.data || session.data.user.role !== role) return <main className="page"><Loading /></main>;
  const unread = (notifications.data ?? []).filter(n => !n.readAt).length;
  const nav = NAV[role];
  const here = Object.entries(NAV_ALIAS).find(([from]) => pathname.startsWith(`${from}/`))?.[1] ?? pathname;
  const active = nav.filter(n => here === n.href || (n.href !== `/${role}` && here.startsWith(`${n.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
  const signOut = async () => { await api.del('auth/session').catch(() => {}); window.location.replace('/login'); };
  const value: ShellValue = {
    session: session.data, activePatientId: activePatientId || session.data.patientId || '', setActivePatientId,
    family: family.data ?? [], reloadFamily: family.reload, refreshBadges: notifications.reload,
  };

  return <ShellContext.Provider value={value}>
    <div className="demo-strip"><ShieldCheck size={13} /> Demo · dummy data · PIN 1234 for every account</div>
    <header className="app-header">
      <Link href={`/${role}`} aria-label="Home"><Brand /></Link>
      <div className="header-right">
        <Link href={`/${role}/notifications`} className="icon-button bell" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Bell size={19} />{unread > 0 && <span className="dot">{unread}</span>}</Link>
        <span className="who"><strong>{session.data.user.name}</strong><small>{role === 'doctor' ? 'Doctor' : role === 'admin' ? 'Administrator' : 'Patient'}</small></span>
        <button className="icon-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
      </div>
    </header>
    <nav className="main-nav" aria-label="Main"><div className="nav-inner">{nav.map(n => <Link key={n.href} href={n.href} className={active?.href === n.href ? 'active' : ''} aria-current={active?.href === n.href ? 'page' : undefined}>{n.label}</Link>)}</div></nav>
    {role === 'patient' && value.family.length > 1 && <div className="family-bar"><div className="nav-inner"><span>Viewing records for</span>
      {value.family.sort((a, b) => Number(!!a.guardianPatientId) - Number(!!b.guardianPatientId)).map(p => <button key={p.id} className={p.id === value.activePatientId ? 'chip active' : 'chip'} onClick={() => setActivePatientId(p.id)}>{p.name}{p.guardianPatientId ? ` (${p.relationship ?? 'dependent'})` : ' (you)'}</button>)}
    </div></div>}
    {role === 'doctor' && session.data.doctorVerification !== 'verified' && <div className="nav-inner"><Notice kind="warning">Your profile is {session.data.doctorVerification === 'rejected' ? 'not approved' : 'awaiting admin verification'}. You can set up your profile and schedule, but patients cannot book you yet.</Notice></div>}
    <main className="page">{children}</main>
    <footer className="app-footer"><Brand small /><span>Proof of concept with dummy data · Asia/Kolkata</span></footer>
  </ShellContext.Provider>;
}
