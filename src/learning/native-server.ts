import { createServer } from 'node:http';
import { platform } from 'node:os';

export function nativeServer() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    let body: unknown;
    if (request.method === 'GET' && path === '/')
      body = { service: 'E-com Global learning server' };
    else if (request.method === 'GET' && path === '/api/users')
      body = { data: [{ id: 'example-user', name: 'Example user' }] };
    else if (request.method === 'GET' && path === '/api/health')
      body = {
        status: 'ok',
        uptime: process.uptime(),
        platform: platform(),
        timestamp: new Date().toISOString(),
      };
    else {
      response.statusCode = 404;
      body = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
    }
    response.end(JSON.stringify(body));
  });
}
if (require.main === module) {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Learning servers are disabled in production');
  const server = nativeServer().listen(3101, '127.0.0.1', () =>
    process.stdout.write('Native learning server: http://127.0.0.1:3101\n'),
  );
  const stop = () => server.close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
