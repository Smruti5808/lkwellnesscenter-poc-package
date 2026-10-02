import { DoctorPortal } from '@/features/portals';

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  return <DoctorPortal slug={(await params).slug ?? []} />;
}
