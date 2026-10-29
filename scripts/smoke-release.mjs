import process from 'node:process';
import { URL } from 'node:url';
const base = new URL(process.env.SMOKE_BASE_URL ?? 'http://localhost:3001');
if (
  !['http:', 'https:'].includes(base.protocol) ||
  base.username ||
  base.password ||
  (base.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(base.hostname))
)
  throw new Error('Use HTTPS or a local test origin without URL credentials');
let cookie = '';
const checks = [];
async function request(path, options = {}) {
  const response = await globalThis.fetch(new URL(path, base.origin), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Origin: base.origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Smoke check failed: ${path} (${response.status})`);
  return { response, payload: await response.json() };
}
try {
  await request('/api/health');
  checks.push('dependency readiness');
  const contract = await request('/api/commerce/openapi.json');
  if (contract.payload.openapi !== '3.1.0')
    throw new Error('OpenAPI contract missing');
  checks.push('OpenAPI contract');
  for (const path of [
    '/categories',
    '/products?limit=1',
    '/search?q=headphones',
  ]) {
    const { payload } = await request(`/api/commerce${path}`);
    if (!payload.data) throw new Error('Invalid commerce response');
    checks.push(path.split('?')[0]);
  }
  const authenticated = Boolean(
    process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD,
  );
  if (authenticated) {
    const { response, payload } = await request('/api/commerce/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: process.env.SMOKE_EMAIL,
        password: process.env.SMOKE_PASSWORD,
      }),
    });
    const session =
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith('ecom_session=')) ?? '';
    if (!/;\s*httponly(?:;|$)/i.test(session))
      throw new Error('Session cookie must be HTTP-only');
    cookie = session.split(';')[0] ?? '';
    if (!cookie || payload.data?.accessToken)
      throw new Error('Session cookie missing or token exposed');
    for (const path of ['/auth/me', '/cart', '/orders'])
      await request(`/api/commerce${path}`);
    checks.push('HTTP-only BFF session', 'account ownership', 'cart', 'orders');
    if (payload.data.user.role === 'ADMIN') {
      await request('/api/commerce/admin/health');
      checks.push('admin deep health and worker heartbeat');
    }
    await globalThis.fetch(new URL('/api/commerce/auth/logout', base.origin), {
      method: 'POST',
      headers: { Origin: base.origin, Cookie: cookie },
      signal: globalThis.AbortSignal.timeout(10000),
    });
  }
  process.stdout.write(
    JSON.stringify(
      {
        checks,
        authenticatedChecks: authenticated
          ? 'passed'
          : 'skipped: supply dedicated smoke-account credentials',
        checkoutWrite:
          'not performed; use the sandbox browser/payment checklist',
      },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  process.stderr.write(
    error instanceof Error
      ? `${error.message}\n`
      : 'Release smoke check failed\n',
  );
  process.exitCode = 1;
}
