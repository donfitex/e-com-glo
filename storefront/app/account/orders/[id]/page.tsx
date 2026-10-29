import { Orders } from '@/components/orders';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Orders id={(await params).id} />;
}
