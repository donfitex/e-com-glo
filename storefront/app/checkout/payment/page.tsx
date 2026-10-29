import { Suspense } from 'react';
import { Payment } from '@/components/payment';
export default function Page() {
  return (
    <Suspense fallback={<p>Loading payment…</p>}>
      <Payment />
    </Suspense>
  );
}
