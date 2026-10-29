import express, { type ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors';
const input = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();
type MockUser = z.infer<typeof input> & { id: string };
class MockUsers {
  private readonly users = new Map<string, MockUser>();
  list() {
    return [...this.users.values()];
  }
  get(id: string) {
    const user = this.users.get(id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    return user;
  }
  create(data: z.infer<typeof input>) {
    const user = { ...data, id: randomUUID() };
    this.users.set(user.id, user);
    return user;
  }
  update(id: string, data: Partial<z.infer<typeof input>>) {
    const user = { ...this.get(id), ...data };
    this.users.set(id, user);
    return user;
  }
  remove(id: string) {
    this.get(id);
    this.users.delete(id);
  }
}
export function mockUsersApp() {
  const app = express();
  const users = new MockUsers();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/users', (_req, res) => res.json({ data: users.list() }));
  app.get('/api/users/:id', (req, res, next) => {
    try {
      res.json({ data: users.get(req.params.id) });
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/users', (req, res, next) => {
    try {
      res.status(201).json({ data: users.create(input.parse(req.body)) });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/api/users/:id', (req, res, next) => {
    try {
      res.json({
        data: users.update(req.params.id, input.partial().parse(req.body)),
      });
    } catch (error) {
      next(error);
    }
  });
  app.delete('/api/users/:id', (req, res, next) => {
    try {
      users.remove(req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  app.use((_req, _res, next) =>
    next(new AppError(404, 'NOT_FOUND', 'Route not found')),
  );
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    const status =
      error instanceof AppError ? error.status : invalid ? 400 : 500;
    res.status(status).json({
      error: {
        code:
          error instanceof AppError
            ? error.code
            : invalid
              ? 'VALIDATION_ERROR'
              : 'INTERNAL_ERROR',
        message:
          error instanceof AppError
            ? error.message
            : invalid
              ? 'Invalid request'
              : 'Request failed',
      },
    });
  };
  app.use(errors);
  return app;
}
if (require.main === module) {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Learning servers are disabled in production');
  const server = mockUsersApp().listen(3102, '127.0.0.1', () =>
    process.stdout.write(
      'Mock CRUD exercise: http://127.0.0.1:3102/api/users\n',
    ),
  );
  process.once('SIGINT', () => server.close());
  process.once('SIGTERM', () => server.close());
}
