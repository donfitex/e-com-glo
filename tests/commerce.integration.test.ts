import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import pino from 'pino';
import { createApp } from '../src/app';
import { CatalogCache } from '../src/infrastructure/cache';
import { RedisRateLimiter } from '../src/infrastructure/rate-limit';
import { JwtTokens, ScryptHasher } from '../src/modules/auth/security';
import { configSchema } from '../src/config';
const enabled = Boolean(process.env.TEST_DATABASE_URL);
const suite = enabled ? describe : describe.skip;
suite('commerce HTTP integration with real PostgreSQL and Redis', () => {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://unused:unused@localhost:5432/ecom_test';
  if (enabled && !new URL(url).pathname.endsWith('_test'))
    throw new Error(
      'Integration tests require a dedicated database whose name ends in _test',
    );
  const db = new PrismaClient({ datasources: { db: { url } } });
  const redis = createClient({
    url: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    disableOfflineQueue: true,
  });
  const tokens = new JwtTokens(
    'integration-only-secret-at-least-32-characters',
  );
  const limiter = new RedisRateLimiter(redis);
  const cache = new CatalogCache(redis);
  const config = configSchema.parse({
    DATABASE_URL: url,
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'integration-only-secret-at-least-32-characters',
    CORS_ORIGINS: 'https://shop.example',
    NODE_ENV: 'test',
  });
  const app = createApp(config, {
    db,
    cache,
    limiter,
    tokens,
    passwords: new ScryptHasher(),
    logger: pino({ level: 'silent' }),
    ready: async () => {
      await db.$queryRaw`SELECT 1`;
      await redis.ping();
    },
  });
  let customer: string,
    other: string,
    admin: string,
    customerId: string,
    categoryId: string,
    productId: string;
  const shippingAddress = {
    name: 'Global Buyer',
    line1: '10 Market Road',
    city: 'Lagos',
    postalCode: '100001',
    country: 'NG',
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    redis.on('error', () => {});
    await redis.connect();
    await db.$connect();
  }, 20000);
  beforeEach(async () => {
    await db.orderItem.deleteMany();
    await db.order.deleteMany();
    await db.cartItem.deleteMany();
    await db.cart.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();
    await db.auditEvent.deleteMany();
    await db.user.deleteMany();
    // Tests share only a dedicated Redis database (15 by default).
    await redis.flushDb();
    const user = await db.user.create({
      data: {
        email: 'buyer@example.com',
        name: 'Buyer',
        passwordHash: await new ScryptHasher().hash('long-password-123'),
      },
    });
    customerId = user.id;
    customer = tokens.sign({ sub: user.id, role: user.role });
    const second = await db.user.create({
      data: {
        email: 'other@example.com',
        name: 'Other',
        passwordHash: 'unused',
      },
    });
    other = tokens.sign({ sub: second.id, role: second.role });
    const manager = await db.user.create({
      data: {
        email: 'admin@example.com',
        name: 'Admin',
        passwordHash: 'unused',
        role: 'ADMIN',
      },
    });
    admin = tokens.sign({ sub: manager.id, role: manager.role });
    const category = await db.category.create({
      data: { name: 'Electronics', slug: 'electronics' },
    });
    categoryId = category.id;
    const product = await db.product.create({
      data: {
        sku: 'HEADPHONES-USD',
        name: 'Headphones',
        description: 'Wireless music',
        price: 1999,
        currency: 'USD',
        stock: 10,
        categoryId,
      },
    });
    productId = product.id;
  });
  afterAll(async () => {
    await redis.quit();
    await db.$disconnect();
  });
  async function add(token = customer, id = productId, quantity = 1) {
    return request(app)
      .post('/api/v1/cart/items')
      .set(auth(token))
      .send({ productId: id, quantity });
  }
  function checkout(token = customer, key = 'checkout-key-123') {
    return request(app)
      .post('/api/v1/orders/checkout')
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send({ shippingAddress });
  }
  test('liveness, dependency readiness, headers and safe errors', async () => {
    expect((await request(app).get('/health')).body.service).toBe(
      'E-com Global',
    );
    expect((await request(app).get('/ready')).status).toBe(200);
    const result = await request(app).get('/missing');
    expect(result.status).toBe(404);
    expect(result.headers['x-request-id']).toBeDefined();
    expect(result.headers['x-content-type-options']).toBe('nosniff');
  });
  test('registration normalizes email, prevents role assignment and duplicate emails', async () => {
    const input = {
      name: 'New Customer',
      email: 'NEW@example.com',
      password: 'long-password-123',
    };
    expect(
      (
        await request(app)
          .post('/api/v1/auth/register')
          .send({ ...input, role: 'ADMIN' })
      ).status,
    ).toBe(400);
    const result = await request(app).post('/api/v1/auth/register').send(input);
    expect(result.status).toBe(201);
    expect(result.body.data.user.email).toBe('new@example.com');
    expect(result.body.data.user.passwordHash).toBeUndefined();
    expect(
      (await request(app).post('/api/v1/auth/register').send(input)).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/register')
          .send({ ...input, password: 'short' })
      ).status,
    ).toBe(400);
  });
  test('login authenticates and rejects invalid credentials', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: 'buyer@example.com', password: 'incorrect-password' })
      ).status,
    ).toBe(401);
    const result = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'buyer@example.com', password: 'long-password-123' });
    expect(result.status).toBe(200);
    expect(tokens.verify(result.body.data.accessToken).sub).toBe(customerId);
  });
  test('authentication and admin permissions protect writes', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/categories')
          .send({ name: 'Books', slug: 'books' })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/categories')
          .set(auth(customer))
          .send({ name: 'Books', slug: 'books' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/categories')
          .set(auth(admin))
          .send({ name: 'Books', slug: 'books' })
      ).status,
    ).toBe(201);
  });
  test('catalog validates filters and uses stable pagination', async () => {
    expect((await request(app).get('/api/v1/products?limit=1000')).status).toBe(
      400,
    );
    const result = await request(app).get(
      `/api/v1/products?categoryId=${categoryId}&currency=USD&minPrice=100&available=true`,
    );
    expect(result.body.data.total).toBe(1);
    expect(result.body.data.items[0].id).toBe(productId);
    expect(
      (await request(app).get('/api/v1/products?currency=EUR')).body.data.total,
    ).toBe(0);
  });
  test('search has a usable text fallback', async () => {
    const result = await request(app).get('/api/v1/search?q=wireless');
    expect(result.status).toBe(200);
    expect(result.body.meta.mode).toBe('text');
    expect(result.body.data.total).toBe(1);
  });
  test('cart rejects invalid quantities, inactive products and mixed currencies', async () => {
    expect((await add(customer, productId, 0)).status).toBe(400);
    expect((await add()).status).toBe(200);
    const euro = await db.product.create({
      data: {
        sku: 'EUR',
        name: 'Other',
        description: '',
        currency: 'EUR',
        price: 100,
        stock: 2,
        categoryId,
      },
    });
    expect((await add(customer, euro.id)).status).toBe(409);
    await db.product.update({
      where: { id: productId },
      data: { active: false },
    });
    expect((await add()).status).toBe(409);
  });
  test('checkout snapshots current prices, clears cart and is idempotent', async () => {
    await add(customer, productId, 2);
    await db.product.update({
      where: { id: productId },
      data: { price: 2500 },
    });
    const result = await checkout();
    expect(result.status).toBe(201);
    expect(result.body.data.total).toBe(5000);
    expect(result.body.data.items[0].price).toBe(2500);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock,
    ).toBe(8);
    expect(await db.cartItem.count()).toBe(0);
    const repeat = await checkout();
    expect(repeat.body.data.id).toBe(result.body.data.id);
    expect(await db.order.count()).toBe(1);
  });
  test('checkout rejects client totals and address changes on replay', async () => {
    await add();
    expect(
      (
        await request(app)
          .post('/api/v1/orders/checkout')
          .set(auth(customer))
          .set('Idempotency-Key', 'unique-key-123')
          .send({ shippingAddress, total: 1 })
      ).status,
    ).toBe(400);
    await checkout();
    expect(
      (
        await request(app)
          .post('/api/v1/orders/checkout')
          .set(auth(customer))
          .set('Idempotency-Key', 'checkout-key-123')
          .send({ shippingAddress: { ...shippingAddress, city: 'Abuja' } })
      ).status,
    ).toBe(409);
  });
  test('insufficient stock leaves orders, stock and cart unchanged', async () => {
    await add(customer, productId, 2);
    await db.product.update({ where: { id: productId }, data: { stock: 1 } });
    expect((await checkout()).status).toBe(409);
    expect(await db.order.count()).toBe(0);
    expect(await db.cartItem.count()).toBe(1);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock,
    ).toBe(1);
  });
  test('concurrent buyers cannot oversell the last unit', async () => {
    await db.product.update({ where: { id: productId }, data: { stock: 1 } });
    await add();
    await add(other);
    const results = await Promise.all([
      checkout(customer, 'first-buyer-key'),
      checkout(other, 'second-buyer-key'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock,
    ).toBe(0);
    expect(await db.order.count()).toBe(1);
  });
  test('concurrent identical checkouts create one order', async () => {
    await add();
    const results = await Promise.all([checkout(), checkout()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
    expect(await db.order.count()).toBe(1);
  });
  test('customers cannot read other customers orders', async () => {
    await add();
    const result = await checkout();
    expect(
      (
        await request(app)
          .get(`/api/v1/orders/${result.body.data.id}`)
          .set(auth(other))
      ).status,
    ).toBe(404);
    expect(
      (await request(app).get('/api/v1/admin/orders').set(auth(customer)))
        .status,
    ).toBe(403);
  });
  test('cancellation restores inventory once and audits the transition', async () => {
    await add();
    const result = await checkout();
    const route = `/api/v1/admin/orders/${result.body.data.id}/status`;
    expect(
      (
        await request(app)
          .patch(route)
          .set(auth(admin))
          .send({ status: 'CANCELLED' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .patch(route)
          .set(auth(admin))
          .send({ status: 'CANCELLED' })
      ).status,
    ).toBe(409);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock,
    ).toBe(10);
    expect(
      await db.auditEvent.count({ where: { action: 'order.status_changed' } }),
    ).toBe(1);
  });
  test('catalog writes invalidate cached public reads', async () => {
    await request(app).get(`/api/v1/products/${productId}`);
    await request(app)
      .patch(`/api/v1/products/${productId}`)
      .set(auth(admin))
      .send({ price: 3000 });
    expect(
      (await request(app).get(`/api/v1/products/${productId}`)).body.data.price,
    ).toBe(3000);
  });
  test('rate limits share atomic counters across instances', async () => {
    const second = new RedisRateLimiter(redis);
    expect((await limiter.consume('integration-shared', 1, 60)).allowed).toBe(
      true,
    );
    expect((await second.consume('integration-shared', 1, 60)).allowed).toBe(
      false,
    );
  });
});
