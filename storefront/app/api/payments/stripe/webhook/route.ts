import { limitedBody, BodyTooLarge } from '@/lib/request-body';
import { apiOrigin } from '@/lib/server-api';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature)
    return Response.json(
      { error: { message: 'Stripe signature required' } },
      { status: 400 },
    );
  try {
    const body = await limitedBody(request);
    if (body.byteLength > 65536) return new Response(null, { status: 413 });
    const result = await fetch(
      `${apiOrigin()}/api/v1/payments/stripe/webhook`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    return new Response(await result.text(), {
      status: result.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof BodyTooLarge)
      return new Response(null, { status: 413 });
    return Response.json(
      { error: { message: 'Payment notification temporarily unavailable' } },
      { status: 503 },
    );
  }
}
