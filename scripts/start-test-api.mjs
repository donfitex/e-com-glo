import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers';
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error('Browser API/worker requires an isolated _test database');
const children = ['dist/index.js', 'dist/workers/order-events.js'].map(
  (entry) =>
    spawn(process.execPath, [entry], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'inherit',
      env: { ...process.env, WORKER_POLL_INTERVAL_MS: '250' },
    }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 12000);
  timer.unref();
}
for (const child of children) {
  child.once('error', () => {
    process.exitCode = 1;
    stop();
  });
  child.once('exit', () => {
    if (!stopping) {
      process.exitCode = 1;
      stop();
    }
  });
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
