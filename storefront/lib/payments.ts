import { api } from './client-api';

export async function launchPaystack(orderId: string) {
  const { url } = await api<{ url: string }>(`/orders/${orderId}/payment`, {
    method: 'POST',
    body: '{}',
  });
  const target = new URL(url);
  if (
    target.protocol !== 'https:' ||
    target.hostname !== 'checkout.paystack.com' ||
    target.username ||
    target.password
  )
    throw new Error('Invalid payment destination');
  window.location.assign(target.href);
}
