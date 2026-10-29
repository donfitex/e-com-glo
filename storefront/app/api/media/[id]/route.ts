import { apiOrigin } from '@/lib/server-api';
export const runtime = 'nodejs';
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  try {
    const response = await fetch(`${apiOrigin()}/api/v1/media/${id}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) return new Response(null, { status: response.status });
    return new Response(response.body, {
      headers: {
        'Content-Type': 'image/webp',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
