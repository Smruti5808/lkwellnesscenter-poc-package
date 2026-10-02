'use client';
// Maps URL segments to screens for each portal.
import { AppShell } from '../ui/shell';
import { Notice } from '../ui/components';
import { MessageCenter, NotificationsPage, PrescriptionDocument } from './shared';
import { PatientHealth, PatientHome } from './patient-health';
import { BookDoctor, FindDoctor, PatientAppointments, PatientPrivacy, PatientProfile, PatientRecords } from './patient-care';
import { DoctorPatientRecord, DoctorPatients, DoctorPerformance, DoctorProfile, DoctorReferrals, DoctorSchedule, DoctorToday } from './doctor';
import { ConsultWorkspace } from './consult';
import { AdminDoctors, AdminOverview, AdminUsers } from './admin';

const notFound = <Notice>This page does not exist.</Notice>;

export function PatientPortal({ slug }: { slug: string[] }) {
  const [page, id] = slug;
  const screen = !page ? <PatientHome />
    : page === 'health' ? <PatientHealth />
    : page === 'doctors' ? (id ? <BookDoctor doctorId={id} /> : <FindDoctor />)
    : page === 'appointments' ? <PatientAppointments />
    : page === 'records' ? <PatientRecords />
    : page === 'prescriptions' && id ? <PrescriptionDocument id={id} back="/patient/records" />
    : page === 'messages' ? <MessageCenter role="patient" />
    : page === 'privacy' ? <PatientPrivacy />
    : page === 'profile' ? <PatientProfile />
    : page === 'notifications' ? <NotificationsPage />
    : notFound;
  return <AppShell role="patient">{screen}</AppShell>;
}

export function DoctorPortal({ slug }: { slug: string[] }) {
  const [page, id] = slug;
  const screen = !page ? <DoctorToday />
    : page === 'schedule' ? <DoctorSchedule />
    : page === 'patients' ? (id ? <DoctorPatientRecord key={id} patientId={id} /> : <DoctorPatients />)
    : page === 'consult' && id ? <ConsultWorkspace consultationId={id} />
    : page === 'prescriptions' && id ? <PrescriptionDocument id={id} back="/doctor/patients" />
    : page === 'messages' ? <MessageCenter role="doctor" />
    : page === 'referrals' ? <DoctorReferrals />
    : page === 'performance' ? <DoctorPerformance />
    : page === 'profile' ? <DoctorProfile />
    : page === 'notifications' ? <NotificationsPage />
    : notFound;
  return <AppShell role="doctor">{screen}</AppShell>;
}

export function AdminPortal({ slug }: { slug: string[] }) {
  const [page] = slug;
  const screen = !page ? <AdminOverview /> : page === 'doctors' ? <AdminDoctors /> : page === 'users' ? <AdminUsers /> : page === 'notifications' ? <NotificationsPage /> : notFound;
  return <AppShell role="admin">{screen}</AppShell>;
}
