import request from 'supertest';
import { nativeServer } from '../src/learning/native-server';

test('native HTTP exercise returns typed JSON routes and safe 404s', async () => {
  const server = nativeServer();
  expect(
    (await request(server).get('/').expect('Content-Type', /json/).expect(200))
      .body.service,
  ).toContain('E-com Global');
  expect(
    (await request(server).get('/api/users').expect(200)).body.data,
  ).toHaveLength(1);
  const health = (await request(server).get('/api/health').expect(200)).body;
  expect(health.uptime).toBeGreaterThanOrEqual(0);
  expect(health.platform).toBe(process.platform);
  expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
  await request(server).get('/unknown').expect(404);
  await request(server).post('/api/users').expect(404);
});
