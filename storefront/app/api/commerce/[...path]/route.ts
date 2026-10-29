import { revalidatePath } from 'next/cache';
import { limitedBody, BodyTooLarge } from '@/lib/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { apiOrigin } from '@/lib/server-api';
export const runtime = 'nodejs';
const COOKIE = 'ecom_session';
const allowed =
  /^(wishlist(?:\/(?:ids|[0-9a-f-]+))?|contact\/(?:key|messages)|site-content|openapi\.json|checkout\/options|auth\/(login|register|me|logout)|categories(?:\/[0-9a-f-]+)?|products(?:\/[0-9a-f-]+)?|search|cart(?:\/items(?:\/[0-9a-f-]+)?)?|orders(?:\/(?:preview|quote|checkout|[0-9a-f-]+(?:\/payment)?))?|admin\/(?:inbox\/(?:keys|summary|messages(?:\/[0-9a-f-]+)?)|content|health|events(?:\/[0-9a-f-]+\/retry)?|images|orders(?:\/[0-9a-f-]+\/(?:status|shipment))?|products))$/;
async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join('/');
  if (!allowed.test(path))
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Route not found' } },
      { status: 404 },
    );
  if (req.method !== 'GET') {
    const expected = process.env.STOREFRONT_ORIGIN ?? new URL(req.url).origin;
    if (req.headers.get('origin') !== expected)
      return NextResponse.json(
        {
          error: {
            code: 'CSRF_REJECTED',
            message: 'Request origin is not allowed',
          },
        },
        { status: 403 },
      );
  }
  if (path === 'auth/logout') {
    if (req.method !== 'POST') return new NextResponse(null, { status: 405 });
    const res = new NextResponse(null, { status: 204 });
    res.cookies.delete(COOKIE);
    return res;
  }
  const headers: Record<string, string> = {
    'Content-Type':
      path === 'admin/images'
        ? (req.headers.get('content-type') ?? 'application/octet-stream')
        : 'application/json',
  };
  const token = req.cookies.get(COOKIE)?.value;
  if (token) headers.Authorization = `Bearer ${token}`;
  const key = req.headers.get('idempotency-key');
  if (key) headers['Idempotency-Key'] = key;
  try {
    const body =
      req.method === 'GET'
        ? undefined
        : await limitedBody(
            req,
            path === 'admin/images' ? 3 * 1024 * 1024 : 65536,
          );
    if (
      body &&
      body.byteLength > (path === 'admin/images' ? 3 * 1024 * 1024 : 65536)
    )
      return NextResponse.json(
        { error: { message: 'Request exceeds size limit' } },
        { status: 413 },
      );
    const upstream = await fetch(
      `${apiOrigin()}/api/v1/${path}${req.nextUrl.search}`,
      {
        method: req.method,
        headers,
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    const payload = await upstream.json();
    if (
      upstream.status === 401 &&
      !['auth/login', 'auth/register'].includes(path)
    ) {
      payload.error = {
        code: 'SESSION_EXPIRED',
        message: 'Your session has expired. Sign in again to continue.',
      };
    }
    if (
      upstream.ok &&
      req.method !== 'GET' &&
      /^(products|categories|admin\/content)(\/|$)/.test(path)
    ) {
      revalidatePath('/', 'layout');
    }
    let accessToken: string | undefined;
    if (upstream.ok && ['auth/login', 'auth/register'].includes(path)) {
      accessToken = payload.data.accessToken;
      delete payload.data.accessToken;
    }
    const res = NextResponse.json(payload, {
      status: upstream.status,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (accessToken)
      res.cookies.set(COOKIE, accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 900,
      });
    if (upstream.status === 401) res.cookies.delete(COOKIE);
    const retry = upstream.headers.get('retry-after');
    if (retry) res.headers.set('Retry-After', retry);
    return res;
  } catch (error) {
    if (error instanceof BodyTooLarge)
      return NextResponse.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Request exceeds size limit',
          },
        },
        { status: 413 },
      );
    return NextResponse.json(
      {
        error: {
          code: 'API_UNAVAILABLE',
          message: 'The store is temporarily unavailable. Please try again.',
        },
      },
      { status: 503 },
    );
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PATCH,
  proxy as DELETE,
  proxy as PUT,
};
