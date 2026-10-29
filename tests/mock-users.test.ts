import request from 'supertest';
import { mockUsersApp } from '../src/learning/mock-users';
test('isolated mock CRUD validates, creates, reads, updates, deletes and returns safe errors', async () => {
  const app = mockUsersApp();
  await request(app)
    .post('/api/users')
    .send({ name: 'Example', email: 'bad' })
    .expect(400);
  const created = await request(app)
    .post('/api/users')
    .send({ name: 'Example', email: 'EXAMPLE@example.com' })
    .expect(201);
  const id = created.body.data.id;
  expect(
    (await request(app).get('/api/users').expect(200)).body.data,
  ).toHaveLength(1);
  expect(
    (await request(app).get(`/api/users/${id}`).expect(200)).body.data.email,
  ).toBe('example@example.com');
  expect(
    (
      await request(app)
        .patch(`/api/users/${id}`)
        .send({ name: 'Updated' })
        .expect(200)
    ).body.data.name,
  ).toBe('Updated');
  await request(app)
    .patch(`/api/users/${id}`)
    .send({ role: 'ADMIN' })
    .expect(400);
  await request(app).delete(`/api/users/${id}`).expect(204);
  expect(
    (await request(app).get(`/api/users/${id}`).expect(404)).body.error.code,
  ).toBe('NOT_FOUND');
});
