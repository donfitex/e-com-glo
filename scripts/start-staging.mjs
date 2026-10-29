import process from 'node:process';
import { setTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const children = new Set();
let stopping = false;
const publicPort = process.env.PORT ?? '10000';
const origin = process.env.STOREFRONT_ORIGIN ?? process.env.RENDER_EXTERNAL_URL;
if (!origin) throw new Error('Set STOREFRONT_ORIGIN before starting staging');
const serviceEnv = {
  ...process.env,
  STOREFRONT_ORIGIN: origin,
  CORS_ORIGINS: origin,
  COMMERCE_API_URL: 'http://127.0.0.1:3010',
};
function child(args, env = serviceEnv) {
  const processChild = spawn(process.execPath, args, { stdio: 'inherit', env });
  children.add(processChild);
  processChild.once('exit', () => children.delete(processChild));
  return processChild;
}
async function command(args, env = serviceEnv) {
  await new Promise((resolve, reject) => {
    const task = child(args, env);
    task.on('error', reject);
    task.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Staging initialization failed')),
    );
  });
}
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const task of children) task.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const task of children) task.kill('SIGKILL');
    process.exit(1);
  }, 12000);
  timer.unref();
  Promise.all(
    [...children].map(
      (task) => new Promise((resolve) => task.once('exit', resolve)),
    ),
  ).then(() => process.exit(code));
}
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
try {
  await command(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    ...serviceEnv,
    DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || serviceEnv.DATABASE_URL,
  });
  await command(['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts']);
  if (process.env.ALLOW_DEMO_SEED === 'true')
    await command(['node_modules/tsx/dist/cli.mjs', 'scripts/seed-demo.ts']);
  if (process.env.ADMIN_EMAIL)
    await command([
      'node_modules/tsx/dist/cli.mjs',
      'scripts/provision-staging-admin.ts',
    ]);
  const worker = child(['dist/workers/order-events.js']);
  worker.once('exit', () => {
    if (!stopping) shutdown(1);
  });
  const api = child(['dist/index.js'], { ...serviceEnv, PORT: '3010' });
  api.once('exit', () => {
    if (!stopping) shutdown(1);
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await globalThis.fetch('http://127.0.0.1:3010/ready', {
        signal: globalThis.AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* bounded startup wait */
    }
    await delay(500);
  }
  if (!ready) throw new Error('API dependencies did not become ready');
  const web = child(['storefront/server.js'], {
    ...serviceEnv,
    PORT: publicPort,
    HOSTNAME: '0.0.0.0',
  });
  web.once('exit', () => {
    if (!stopping) shutdown(1);
  });
} catch {
  process.stderr.write(
    'Staging startup failed. Review database connectivity and required configuration.\n',
  );
  shutdown(1);
}
