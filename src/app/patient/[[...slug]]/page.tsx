import { PatientPortal } from '@/features/portals';

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  return <PatientPortal slug={(await params).slug ?? []} />;
}
