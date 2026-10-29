import sharp from 'sharp';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { PaystackGateway } from '../src/modules/payments/gateway';
import { PaymentService } from '../src/modules/payments/service';
import { PaymentGateway, PaymentNotice } from '../src/modules/payments/gateway';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import pino from 'pino';
import { createApp } from '../src/app';
import { CatalogCache } from '../src/infrastructure/cache';
import { RedisRateLimiter } from '../src/infrastructure/rate-limit';
import {
  JwtTokens,
  ScryptHasher,
  BcryptHasher,
} from '../src/modules/auth/security';
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
    CHECKOUT_RULES_JSON: JSON.stringify([
      { country: 'NG', currency: 'USD', shipping: 0, taxBasisPoints: 0 },
    ]),
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
    email: 'delivery@example.com',
    phone: '+2348012345678',
    line1: '10 Market Road',
    city: 'Lagos',
    postalCode: '100001',
    country: 'NG',
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  test('admin uploads a real image and its product is immediately visible in its category', async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#336655' },
    })
      .png()
      .toBuffer();
    await request(app)
      .post('/api/v1/admin/images')
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(401);
    await request(app)
      .post('/api/v1/admin/images')
      .set(auth(customer))
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(403);
    await request(app)
      .post('/api/v1/admin/images')
      .set(auth(admin))
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not an image'))
      .expect(422);
    await request(app)
      .post('/api/v1/admin/images')
      .set(auth(admin))
      .set('Content-Type', 'image/svg+xml')
      .send('<svg/>')
      .expect(415);
    const image = await request(app)
      .post('/api/v1/admin/images')
      .set(auth(admin))
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(201);
    const publicImage = await request(app)
      .get(image.body.data.url.replace('/api/media/', '/api/v1/media/'))
      .expect(200);
    expect(publicImage.headers['content-type']).toContain('image/webp');
    expect((await sharp(publicImage.body as Buffer).metadata()).format).toBe(
      'webp',
    );
    const listUrl = `/api/v1/products?categoryId=${categoryId}&currency=NGN`;
    await request(app).get(listUrl).expect(200); // Prime the public catalog cache.
    const saved = await request(app)
      .post('/api/v1/products')
      .set(auth(admin))
      .send({
        sku: 'UPLOAD-NGN',
        name: 'Uploaded product',
        description: 'Real merchant photo',
        price: 50000,
        currency: 'NGN',
        stock: 5,
        categoryId,
        attributes: { imageUrl: image.body.data.url },
      })
      .expect(201);
    const listing = await request(app).get(listUrl).expect(200);
    expect(listing.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: saved.body.data.id,
          attributes: { imageUrl: image.body.data.url },
        }),
      ]),
    );
    await request(app)
      .post('/api/v1/admin/images')
      .set(auth(admin))
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(3 * 1024 * 1024 + 1))
      .expect(413);
  });
  beforeAll(async () => {
    redis.on('error', () => {});
    await redis.connect();
    await db.$connect();
  }, 20000);
  beforeEach(async () => {
    await db.supportMessage.deleteMany();
    await db.inboxKey.deleteMany();
    await db.storeContent.deleteMany();
    await db.productImage.deleteMany();
    await db.paymentEvent.deleteMany();
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
  test('checkout requires and persists normalized delivery contact details', async () => {
    await add();
    for (const contact of [
      { email: undefined },
      { email: 'invalid' },
      { phone: undefined },
      { phone: '08012345678' },
    ]) {
      await request(app)
        .post('/api/v1/orders/quote')
        .set(auth(customer))
        .send({ shippingAddress: { ...shippingAddress, ...contact } })
        .expect(400);
    }
    const order = await request(app)
      .post('/api/v1/orders/checkout')
      .set(auth(customer))
      .set('Idempotency-Key', 'delivery-contact-test')
      .send({
        shippingAddress: {
          ...shippingAddress,
          email: ' DELIVERY@EXAMPLE.COM ',
          phone: '+234 (801) 234-5678',
        },
      })
      .expect(201);
    expect(order.body.data.shippingAddress).toMatchObject({
      email: 'delivery@example.com',
      phone: '+2348012345678',
    });
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: order.body.data.id } }))
        .shippingAddress,
    ).toMatchObject({ email: 'delivery@example.com', phone: '+2348012345678' });
  });
  test('checkout options expose configured country/currency pairs without authentication', async () => {
    const options = await request(app)
      .get('/api/v1/checkout/options')
      .expect(200);
    expect(options.body.data.destinations).toEqual([
      { country: 'NG', currency: 'USD' },
    ]);
    expect(options.body.data.paymentCurrencies).toBeNull();
    expect(options.headers['cache-control']).toBe('no-store');
  });
  test('paid orders expose delivery estimates and only admins can ship and mark delivery', async () => {
    await db.product.update({ where: { id: productId }, data: { price: 0 } });
    await add();
    const created = await checkout();
    expect(created.status).toBe(201);
    const order = created.body.data;
    expect(order.status).toBe('CONFIRMED');
    expect(order.paidAt).toBeTruthy();
    expect(
      new Date(order.estimatedDeliveryFrom).getTime() -
        new Date(order.paidAt).getTime(),
    ).toBe(3 * 86400000);
    expect(
      new Date(order.estimatedDeliveryTo).getTime() -
        new Date(order.paidAt).getTime(),
    ).toBe(7 * 86400000);
    await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/shipment`)
      .set(auth(customer))
      .send({ carrier: 'Test courier' })
      .expect(403);
    await request(app)
      .get(`/api/v1/orders/${order.id}`)
      .set(auth(other))
      .expect(404);
    await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/shipment`)
      .set(auth(admin))
      .send({ trackingUrl: 'javascript:alert(1)' })
      .expect(400);
    await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/shipment`)
      .set(auth(admin))
      .send({ expectedDeliveryDate: '2000-01-01' })
      .expect(422);
    const expectedDate = new Date(Date.now() + 5 * 86400000)
      .toISOString()
      .slice(0, 10);
    const details = {
      carrier: 'Test courier',
      trackingNumber: 'TRACK-123',
      trackingUrl: 'https://example.com/track/TRACK-123',
      expectedDeliveryDate: expectedDate,
    };
    await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/shipment`)
      .set(auth(admin))
      .send(details)
      .expect(200);
    const shipped = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(auth(admin))
      .send({ status: 'SHIPPED' })
      .expect(200);
    expect(shipped.body.data.shippedAt).toBeTruthy();
    const delivered = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(auth(admin))
      .send({ status: 'DELIVERED' })
      .expect(200);
    expect(delivered.body.data.deliveredAt).toBeTruthy();
    const tracking = await request(app)
      .get(`/api/v1/orders/${order.id}`)
      .set(auth(customer))
      .expect(200);
    expect(tracking.body.data).toMatchObject({
      status: 'DELIVERED',
      carrier: 'Test courier',
      trackingNumber: 'TRACK-123',
      deliveredAt: delivered.body.data.deliveredAt,
    });
    expect(tracking.body.data.estimatedDeliveryTo.slice(0, 10)).toBe(
      expectedDate,
    );
    await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(auth(admin))
      .send({ status: 'DELIVERED' })
      .expect(409);
    await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/shipment`)
      .set(auth(admin))
      .send({ carrier: 'Changed after delivery' })
      .expect(409);
    expect(
      await db.auditEvent.count({
        where: { entityId: order.id, action: 'order.status_changed' },
      }),
    ).toBe(2);
    await db.product.update({
      where: { id: productId },
      data: { price: 1999 },
    });
    await add();
    const pending = (await checkout(customer, 'pending-shipment-test')).body
      .data;
    await request(app)
      .patch(`/api/v1/admin/orders/${pending.id}/status`)
      .set(auth(admin))
      .send({ status: 'SHIPPED' })
      .expect(409);
    await request(app)
      .patch(`/api/v1/admin/orders/${pending.id}/shipment`)
      .set(auth(admin))
      .send({ carrier: 'Test courier' })
      .expect(409);
  });
  test('request logs contain ISO timing fields without credentials or bodies', async () => {
    const lines: string[] = [];
    const logged = createApp(config, {
      db,
      cache,
      limiter,
      tokens,
      passwords: new ScryptHasher(),
      logger: pino(
        { level: 'info' },
        {
          write: (line: string) => {
            lines.push(line);
          },
        },
      ),
      ready: async () => {},
    });
    await request(logged)
      .get('/health?secret=never-log-this')
      .set('Authorization', 'Bearer private-token')
      .expect(200);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      method: 'GET',
      path: '/health',
      status: 200,
    });
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
    expect(typeof record.durationMs).toBe('number');
    expect(lines.join('')).not.toMatch(/private-token|never-log-this/);
  });
  test('login throttles each normalized account to five attempts per fifteen minutes', async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'buyer@example.com',
          password: 'incorrect-password-123',
        })
        .expect(401);
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'BUYER@example.com', password: 'long-password-123' })
      .expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(800);
    await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'different@example.com',
        password: 'incorrect-password-123',
      })
      .expect(401);
  });
  test('a successful legacy login upgrades its stored hash without changing credentials', async () => {
    const secured = createApp(config, {
      db,
      cache,
      limiter,
      tokens,
      passwords: new BcryptHasher(),
      logger: pino({ level: 'silent' }),
      ready: async () => {},
    });
    await request(secured)
      .post('/api/v1/auth/login')
      .send({ email: 'buyer@example.com', password: 'long-password-123' })
      .expect(200);
    const account = await db.user.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(account.passwordHash).toMatch(/^bcrypt-sha256:v1:/);
    expect(
      await new BcryptHasher().verify(
        'long-password-123',
        account.passwordHash,
      ),
    ).toBe(true);
  });
  test('CORS exposes responses only to configured browser origins', async () => {
    const allowed = await request(app)
      .get('/health')
      .set('Origin', 'https://shop.example')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://shop.example',
    );
    const denied = await request(app)
      .get('/health')
      .set('Origin', 'https://untrusted.example')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  test('OpenAPI is public and deep diagnostics require administrator access', async () => {
    const contract = await request(app).get('/api/v1/openapi.json').expect(200);
    expect(contract.body.openapi).toBe('3.1.0');
    expect(
      contract.body.paths['/api/v1/orders/checkout'].post.parameters[0].name,
    ).toBe('Idempotency-Key');
    await request(app).get('/api/v1/admin/health').expect(401);
    await request(app)
      .get('/api/v1/admin/health')
      .set(auth(customer))
      .expect(403);
    const health = await request(app)
      .get('/api/v1/admin/health')
      .set(auth(admin))
      .expect(200);
    expect(health.body.data.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(health.body.data.cache).toHaveProperty('hits');
    expect(JSON.stringify(health.body)).not.toMatch(
      /postgresql:|redis:\/\/|password|token/i,
    );
    const monitored = createApp(config, {
      db,
      cache,
      limiter,
      tokens,
      passwords: new ScryptHasher(),
      logger: pino({ level: 'silent' }),
      ready: async () => {},
      workerHeartbeat: async () => null,
    });
    const degraded = await request(monitored)
      .get('/api/v1/admin/health')
      .set(auth(admin))
      .expect(503);
    expect(degraded.body.data.worker).toMatchObject({
      configured: true,
      healthy: false,
    });
    await request(app)
      .get('/api/v1/admin/events')
      .set(auth(customer))
      .expect(403);
  });
  test('homepage publishing is admin-only, revision protected and visible immediately', async () => {
    const initial = await request(app).get('/api/v1/site-content').expect(200);
    expect(initial.body.data.content.hero.title).toBe('Good finds.');
    const input = {
      ...initial.body.data,
      content: {
        ...initial.body.data.content,
        hero: {
          ...initial.body.data.content.hero,
          title: 'Merchant-selected finds',
        },
      },
    };
    await request(app)
      .put('/api/v1/admin/content')
      .set(auth(customer))
      .send(input)
      .expect(403);
    const saved = await request(app)
      .put('/api/v1/admin/content')
      .set(auth(admin))
      .send(input)
      .expect(200);
    expect(saved.body.data.revision).toBe(1);
    expect(
      (await request(app).get('/api/v1/site-content')).body.data.content.hero
        .title,
    ).toBe('Merchant-selected finds');
    await request(app)
      .put('/api/v1/admin/content')
      .set(auth(admin))
      .send(input)
      .expect(409);
    await request(app)
      .put('/api/v1/admin/content')
      .set(auth(admin))
      .send({
        revision: 1,
        content: {
          ...input.content,
          hero: { ...input.content.hero, buttonHref: 'javascript:alert(1)' },
        },
      })
      .expect(400);
  });
  test('encrypted inbox stores no contact plaintext, enforces roles and tracks unread status', async () => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicExponent: 0x10001,
    });
    const jwk = {
      ...pair.publicKey.export({ format: 'jwk' }),
      alg: 'RSA-OAEP-256',
      ext: true,
      key_ops: ['encrypt'],
    };
    const key = { id: randomUUID(), expectedCurrentId: null, publicJwk: jwk };
    await request(app)
      .post('/api/v1/admin/inbox/keys')
      .set(auth(customer))
      .send(key)
      .expect(403);
    await request(app)
      .post('/api/v1/admin/inbox/keys')
      .set(auth(admin))
      .send({ ...key, publicJwk: { ...jwk, d: 'private-data' } })
      .expect(400);
    await request(app)
      .post('/api/v1/admin/inbox/keys')
      .set(auth(admin))
      .send(key)
      .expect(201);
    const active = await request(app).get('/api/v1/contact/key').expect(200);
    expect(active.body.data.id).toBe(key.id);
    expect(active.body.data.fingerprint).toHaveLength(64);
    const envelope = {
      version: 1,
      id: randomUUID(),
      keyId: key.id,
      iv: Buffer.alloc(12, 1).toString('base64'),
      wrappedKey: Buffer.alloc(384, 2).toString('base64'),
      ciphertext: Buffer.alloc(100, 3).toString('base64'),
    };
    await request(app)
      .post('/api/v1/contact/messages')
      .send({
        name: 'plaintext',
        email: 'secret@example.com',
        message: 'should reject',
      })
      .expect(400);
    await request(app)
      .post('/api/v1/contact/messages')
      .send(envelope)
      .expect(201);
    await request(app)
      .post('/api/v1/contact/messages')
      .send(envelope)
      .expect(201);
    expect(await db.supportMessage.count()).toBe(1);
    const stored = await db.supportMessage.findUniqueOrThrow({
      where: { id: envelope.id },
    });
    expect(JSON.stringify(stored)).not.toMatch(
      /plaintext|secret@example.com|should reject/,
    );
    expect(
      (await request(app).get('/api/v1/admin/inbox/summary').set(auth(admin)))
        .body.data.unread,
    ).toBe(1);
    await request(app)
      .get(`/api/v1/admin/inbox/messages/${envelope.id}`)
      .set(auth(customer))
      .expect(403);
    await request(app)
      .get(`/api/v1/admin/inbox/messages/${envelope.id}`)
      .expect(401);
    await request(app)
      .patch(`/api/v1/admin/inbox/messages/${envelope.id}`)
      .set(auth(admin))
      .send({ status: 'READ' })
      .expect(200);
    expect(
      (await request(app).get('/api/v1/admin/inbox/summary').set(auth(admin)))
        .body.data.unread,
    ).toBe(0);
    await request(app)
      .patch(`/api/v1/admin/inbox/messages/${envelope.id}`)
      .set(auth(admin))
      .send({ status: 'RESOLVED' })
      .expect(200);
    await request(app)
      .post('/api/v1/contact/messages')
      .send({
        ...envelope,
        ciphertext: Buffer.alloc(100, 4).toString('base64'),
      })
      .expect(409);
    const second = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicExponent: 0x10001,
    });
    const newKey = {
      id: randomUUID(),
      expectedCurrentId: key.id,
      publicJwk: {
        ...second.publicKey.export({ format: 'jwk' }),
        alg: 'RSA-OAEP-256',
        ext: true,
        key_ops: ['encrypt'],
      },
    };
    await request(app)
      .post('/api/v1/admin/inbox/keys')
      .set(auth(admin))
      .send(newKey)
      .expect(201);
    await request(app)
      .post('/api/v1/contact/messages')
      .send({ ...envelope, id: randomUUID() })
      .expect(409);
    expect(
      (
        await request(app)
          .get(`/api/v1/admin/inbox/messages/${envelope.id}`)
          .set(auth(admin))
      ).body.data.envelope,
    ).toMatchObject(envelope);
    expect(
      (await request(app).get('/api/v1/admin/inbox/keys').set(auth(admin))).body
        .data,
    ).toHaveLength(2);
  }, 20000);
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
    expect(await db.outboxEvent.count()).toBe(0);
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
    expect(
      await db.outboxEvent.count({
        where: { orderId: results[0].body.data.id, type: 'OrderCreated' },
      }),
    ).toBe(1);
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
  test('checkout quotes destination totals and rejects stale quotes', async () => {
    await add();
    const quote = await request(app)
      .post('/api/v1/orders/quote')
      .set(auth(customer))
      .send({ shippingAddress });
    expect(quote.status).toBe(200);
    expect(quote.body.data.total).toBe(1999);
    expect(
      (
        await request(app)
          .post('/api/v1/orders/quote')
          .set(auth(customer))
          .send({ shippingAddress: { ...shippingAddress, country: 'ZZ' } })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post('/api/v1/orders/checkout')
          .set(auth(customer))
          .set('Idempotency-Key', 'quote-guard-key')
          .send({
            shippingAddress,
            quote: { total: 1, ruleVersion: quote.body.data.ruleVersion },
          })
      ).status,
    ).toBe(409);
  });
  test('verified payment notifications confirm an order exactly once', async () => {
    await add();
    const result = await checkout();
    const orderId = result.body.data.id;
    const notice: PaymentNotice = {
      id: 'evt_' + orderId,
      type: 'paid',
      orderId,
      reference: 'ecom-' + orderId,
      amount: 1999,
      currency: 'USD',
    };
    const gateway: PaymentGateway = {
      create: async () => ({
        id: 'ecom-' + orderId,
        url: 'https://checkout.paystack.com/test',
      }),
      confirm: async (notice) => notice,
      verify: () => notice,
    };
    const payments = new PaymentService(db, cache, gateway);
    await payments.webhook(Buffer.from('fixture'), 'fixture');
    const firstConfirmation = await db.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(firstConfirmation.paidAt).not.toBeNull();
    expect(firstConfirmation.estimatedDeliveryTo).not.toBeNull();
    await payments.webhook(Buffer.from('fixture'), 'fixture');
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: orderId } })).paidAt,
    ).toEqual(firstConfirmation.paidAt);
    expect(await db.order.findUnique({ where: { id: orderId } })).toMatchObject(
      { status: 'CONFIRMED', paymentStatus: 'PAID' },
    );
    expect(await db.paymentEvent.count({ where: { orderId } })).toBe(1);
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/orders/${orderId}/status`)
          .set(auth(admin))
          .send({ status: 'CANCELLED' })
      ).status,
    ).toBe(409);
  });
  test('amount mismatch cannot mark an order paid or consume an event', async () => {
    await add();
    const orderId = (await checkout()).body.data.id;
    const gateway: PaymentGateway = {
      create: async () => ({
        id: 'unused',
        url: 'https://checkout.paystack.com/test',
      }),
      confirm: async (notice) => notice,
      verify: () => ({
        id: 'evt_wrong_' + orderId,
        type: 'paid',
        orderId,
        reference: 'ecom-' + orderId,
        amount: 1,
        currency: 'USD',
      }),
    };
    await expect(
      new PaymentService(db, cache, gateway).webhook(
        Buffer.from('fixture'),
        'fixture',
      ),
    ).rejects.toThrow('does not match');
    expect(await db.order.findUnique({ where: { id: orderId } })).toMatchObject(
      { paymentStatus: 'UNPAID', status: 'PENDING' },
    );
    expect(await db.paymentEvent.count({ where: { orderId } })).toBe(0);
  });
  test('expired unpaid reservations release stock once; late payment requires refund review', async () => {
    await add();
    const orderId = (await checkout()).body.data.id;
    await db.order.update({
      where: { id: orderId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const notice: PaymentNotice = {
      id: 'evt_late_' + orderId,
      type: 'paid',
      orderId,
      reference: 'ecom-' + orderId,
      amount: 1999,
      currency: 'USD',
    };
    const gateway: PaymentGateway = {
      create: async () => ({
        id: 'unused',
        url: 'https://checkout.paystack.com/test',
      }),
      confirm: async (notice) => notice,
      verify: () => notice,
    };
    const payments = new PaymentService(db, cache, gateway);
    await payments.expireUnpaid();
    await payments.expireUnpaid();
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock,
    ).toBe(10);
    await payments.webhook(Buffer.from('fixture'), 'fixture');
    expect(await db.order.findUnique({ where: { id: orderId } })).toMatchObject(
      { status: 'CANCELLED', paymentStatus: 'REFUND_REQUIRED' },
    );
  });
  test('unpaid orders cannot be manually confirmed and payment setup fails clearly', async () => {
    await add();
    const orderId = (await checkout()).body.data.id;
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/orders/${orderId}/status`)
          .set(auth(admin))
          .send({ status: 'CONFIRMED' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/api/v1/orders/${orderId}/payment`)
          .set(auth(customer))
          .send({})
      ).status,
    ).toBe(503);
  });
  test('payment initialization is serialized and reuses one persisted Paystack URL', async () => {
    await add();
    const orderId = (await checkout()).body.data.id;
    const create = jest
      .fn<
        ReturnType<PaymentGateway['create']>,
        Parameters<PaymentGateway['create']>
      >()
      .mockResolvedValue({
        id: `ecom-${orderId}`,
        url: 'https://checkout.paystack.com/initialized',
      });
    const gateway: PaymentGateway = {
      create,
      verify: () => ({ id: 'unused', type: 'ignored' }),
      confirm: async (notice) => notice,
    };
    const payments = new PaymentService(db, cache, gateway);
    const result = await Promise.all([
      payments.start(customerId, orderId),
      payments.start(customerId, orderId),
    ]);
    expect(result).toEqual([
      { url: 'https://checkout.paystack.com/initialized' },
      { url: 'https://checkout.paystack.com/initialized' },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].email).toBe('delivery@example.com');
    expect(await db.order.findUnique({ where: { id: orderId } })).toMatchObject(
      { paymentProvider: 'paystack', paymentReference: `ecom-${orderId}` },
    );
  });
  test('server-priced free orders are confirmed without an external payment', async () => {
    await db.product.update({ where: { id: productId }, data: { price: 0 } });
    await add();
    const result = await checkout();
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({
      total: 0,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentProvider: 'free',
    });
  });
  test('provider verification failure cannot confirm an order', async () => {
    await add();
    const orderId = (await checkout()).body.data.id;
    const gateway: PaymentGateway = {
      create: async () => ({
        id: `ecom-${orderId}`,
        url: 'https://checkout.paystack.com/test',
      }),
      verify: () => ({
        id: `paystack:charge:failure-${orderId}`,
        type: 'paid',
        orderId,
        reference: `ecom-${orderId}`,
        amount: 1999,
        currency: 'USD',
      }),
      confirm: async () => {
        throw new Error('Provider unavailable');
      },
    };
    await expect(
      new PaymentService(db, cache, gateway).webhook(
        Buffer.from('fixture'),
        'fixture',
      ),
    ).rejects.toThrow('Provider unavailable');
    expect(await db.order.findUnique({ where: { id: orderId } })).toMatchObject(
      { paymentStatus: 'UNPAID', status: 'PENDING' },
    );
  });
  test('raw Paystack webhook validates its header and verifies the transaction before confirming', async () => {
    await add();
    const orderId = (await checkout()).body.data.id;
    const reference = `ecom-${orderId}`;
    const data = {
      id: 987654,
      domain: 'test',
      status: 'success',
      reference,
      amount: 1999,
      currency: 'USD',
      metadata: { orderId },
    };
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify({ status: true, data })));
    const secret = 'sk_test_http_fixture';
    const gateway = new PaystackGateway(
      secret,
      'https://shop.example',
      ['USD'],
      transport,
    );
    const paymentApp = createApp(config, {
      db,
      cache,
      limiter,
      tokens,
      passwords: new ScryptHasher(),
      paymentGateway: gateway,
      logger: pino({ level: 'silent' }),
      ready: async () => {},
    });
    const payload = JSON.stringify({ event: 'charge.success', data });
    const signature = createHmac('sha512', secret)
      .update(payload)
      .digest('hex');
    expect(
      (
        await request(paymentApp)
          .post('/api/v1/payments/paystack/webhook')
          .set('Content-Type', 'application/json')
          .set('x-paystack-signature', 'forged')
          .send(payload)
      ).status,
    ).toBe(400);
    expect(transport).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(paymentApp)
            .post('/api/v1/payments/paystack/webhook')
            .set('Content-Type', 'application/json')
            .set('x-paystack-signature', signature)
            .send(payload)
        ).status,
      ).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await db.order.findUnique({ where: { id: orderId } })).toMatchObject(
      {
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paymentReference: reference,
        providerTransactionId: '987654',
      },
    );
  });
});
