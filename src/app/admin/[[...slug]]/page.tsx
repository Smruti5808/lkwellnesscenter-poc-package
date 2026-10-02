import { AdminPortal } from '@/features/portals';

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  return <AdminPortal slug={(await params).slug ?? []} />;
}
