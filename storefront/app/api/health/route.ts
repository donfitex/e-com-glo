import { apiOrigin } from '@/lib/server-api';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const response = await fetch(`${apiOrigin()}/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    return Response.json(
      { status: response.ok ? 'ready' : 'unavailable' },
      { status: response.ok ? 200 : 503 },
    );
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
