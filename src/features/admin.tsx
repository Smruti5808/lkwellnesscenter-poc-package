'use client';
import { useState } from 'react';
import { BadgeCheck, Ban, RotateCcw } from 'lucide-react';
import type { Doctor, User } from '../shared/schemas';
import { formatDate } from '../shared/time';
import { api, errorText, useData } from '../ui/api';
import { Async, Badge, KeyValues, Notice, PageTitle, Section, Tabs } from '../ui/components';
import { CrudList } from '../ui/crud';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
type Analytics = { users: Record<string, number>; inactiveUsers: number; doctors: Record<string, number>; patients: number; appointments: Record<string, number>; consultations: number; prescriptions: number; orders: Record<string, number>; averageRating: number | null };

export function AdminOverview() {
  const stats = useData<Analytics>('admin/analytics');
  return <>
    <PageTitle eyebrow="ADMIN" title="Overview">Platform activity. Administrators manage accounts and doctor verification; they cannot open clinical records.</PageTitle>
    <Async state={stats}>{s => <>
      <div className="stats">
        <div className="stat"><strong>{s.patients}</strong><span>patient records</span></div>
        <div className="stat"><strong>{s.doctors.verified ?? 0}</strong><span>verified doctors</span></div>
        <div className="stat alert"><strong>{s.doctors.pending ?? 0}</strong><span>awaiting verification</span></div>
        <div className="stat"><strong>{s.consultations}</strong><span>consultations</span></div>
        <div className="stat"><strong>{s.averageRating ?? '—'}</strong><span>average rating</span></div>
      </div>
      <div className="grid-2">
        <Section title="Appointments by status"><KeyValues items={Object.entries(s.appointments).map(([k, v]) => [cap(k), String(v)])} /></Section>
        <Section title="Accounts"><KeyValues items={[...Object.entries(s.users).map(([k, v]) => [`${cap(k)}s`, String(v)] as [string, string]), ['Inactive accounts', String(s.inactiveUsers)], ['Signed prescriptions', String(s.prescriptions)], ...Object.entries(s.orders).map(([k, v]) => [`Orders ${k}`, String(v)] as [string, string])]} /></Section>
      </div>
      <Notice kind="info">Disputes and refunds depend on payments, which are to be decided.</Notice>
    </>}</Async>
  </>;
}

export function AdminDoctors() {
  const doctors = useData<Doctor[]>('c/doctors');
  const [tab, setTab] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const [error, setError] = useState('');
  const setStatus = async (d: Doctor, verification: Doctor['verification']) => { setError(''); try { await api.post(`admin/doctors/${d.id}/verification`, { verification }); doctors.reload(); } catch (e) { setError(errorText(e)); } };
  const rows = (doctors.data ?? []).filter(d => d.verification === tab);
  return <>
    <PageTitle eyebrow="ADMIN" title="Doctor verification">Check council registration and licence details before a profile goes live.</PageTitle>
    <Tabs tabs={(['pending', 'verified', 'rejected'] as const).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1), count: (doctors.data ?? []).filter(d => d.verification === id).length }))} value={tab} onChange={setTab} />
    {error && <Notice>{error}</Notice>}
    <Async state={doctors}>{() => !rows.length ? <Section><p className="muted">No doctors in this list.</p></Section> : <div className="stack">{rows.map(d => <Section key={d.id} title={<>{d.name} <Badge>{d.verification}</Badge></>} actions={<>
      {d.verification !== 'verified' && <button className="button small" onClick={() => setStatus(d, 'verified')}><BadgeCheck size={14} />Verify</button>}
      {d.verification !== 'rejected' && <button className="button small danger" onClick={() => setStatus(d, 'rejected')}><Ban size={14} />Reject</button>}
      {d.verification !== 'pending' && <button className="button small secondary" onClick={() => setStatus(d, 'pending')}><RotateCcw size={14} />Back to pending</button>}</>}>
      <KeyValues items={[['Specialty', d.specialty], ['Qualifications', d.qualifications], ['Council registration', d.councilNumber], ['Licence', d.licenseNumber], ['Clinic', d.clinic], ['Languages', d.languages.join(', ')], ['Registered', formatDate(d.createdAt)]]} />
    </Section>)}</div>}</Async>
  </>;
}

export function AdminUsers() {
  const [role, setRole] = useState('');
  return <>
    <PageTitle eyebrow="ADMIN" title="User management">Activate, deactivate, edit, or delete accounts. Patients and doctors join through registration; admin accounts can be added here.</PageTitle>
    <label className="field inline"><span>Role</span><select value={role} onChange={e => setRole(e.target.value)}><option value="">All</option><option value="patient">Patients</option><option value="doctor">Doctors</option><option value="admin">Admins</option></select></label>
    <CrudList<User> key={role} collection="users" noun="Admin user" title="Accounts" query={role ? { role } : {}} defaults={{ role: 'admin', active: true }}
      fields={[{ name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'role', label: 'Role', type: 'select', required: true, options: [{ value: 'admin', label: 'Admin' }] }, { name: 'active', label: 'Active', type: 'checkbox' }]}
      editFields={[{ name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'active', label: 'Active (inactive accounts cannot sign in)', type: 'checkbox', wide: true }]}
      sort={(a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)}
      render={u => <><span className="row-title"><strong>{u.name}</strong> <Badge tone="teal">{u.role}</Badge>{!u.active && <Badge tone="red">inactive</Badge>}</span><p>{u.email} · {u.phone || 'no phone'}</p></>} />
  </>;
}
