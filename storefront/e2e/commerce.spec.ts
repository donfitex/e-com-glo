import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { ScryptHasher } from '../../src/modules/auth/security';
const database = process.env.E2E_DATABASE_URL;
if (!database || !new URL(database).pathname.endsWith('_test'))
  throw new Error(
    'Set E2E_DATABASE_URL to a dedicated _test database before running browser tests',
  );
const db = new PrismaClient({ datasources: { db: { url: database } } });
const stamp = Date.now();
const adminEmail = `browser-admin-${stamp}@example.com`;
const password = 'Browser-test-password-123';
test.beforeAll(async () => {
  await db.user.create({
    data: {
      email: adminEmail,
      name: 'Browser Admin',
      role: 'ADMIN',
      passwordHash: await new ScryptHasher().hash(password),
    },
  });
});
test.afterAll(async () => {
  await db.$disconnect();
});
test('customer journey: discover, register, add to bag, quote and place unpaid order', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Good finds. Global possibilities.' }),
  ).toBeVisible();
  await page.screenshot({
    path: '../work/storefront-desktop.png',
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Find your next favorite' }).click();
  await expect(page).toHaveURL(/\/shop/);
  await page.locator('select[name="currency"]').selectOption('USD');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page
    .getByRole('link', { name: 'Everyday wireless headphones', exact: true })
    .last()
    .click();
  await page.getByRole('link', { name: 'Sign in to add to bag' }).click();
  await page
    .getByRole('link', { name: 'Create an account', exact: true })
    .click();
  await page.getByLabel('Full name').fill('Browser Customer');
  await page
    .getByLabel('Email address')
    .fill(`browser-customer-${stamp}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page).toHaveURL(/\/products\//);
  await page.getByRole('button', { name: 'Add to bag', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Added to your bag');
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'ecom_session')?.httpOnly).toBe(true);
  expect(
    await page.evaluate(() => localStorage.getItem('accessToken')),
  ).toBeNull();
  await page.getByRole('link', { name: 'View bag' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your shopping bag.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Continue to checkout' }).click();
  await page.getByLabel('Contact email').fill(`contact-${stamp}@example.com`);
  await page.getByLabel('Phone number').fill('+1 202 555 0123');
  await page
    .getByLabel('Address line 1', { exact: true })
    .fill('10 Example Road');
  await page.getByLabel('City', { exact: true }).fill('New York');
  await page.getByLabel('State / region').fill('NY');
  await page.getByLabel('Postal code').fill('10001');
  await page.getByLabel('Delivery country').selectOption('US');
  await page.getByRole('button', { name: 'Calculate delivery & tax' }).click();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/checkout\/payment\?order=/);
  await expect(page.getByText('UNPAID', { exact: true })).toBeVisible();
  const createdOrder = new URL(page.url()).searchParams.get('order');
  await page.goto(
    `/checkout/payment?order=${createdOrder}&reference=untrusted-callback`,
  );
  await expect(page.getByText('UNPAID', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Continue to Paystack', exact: true })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Paystack test checkout' }),
  ).toContainText('not configured');
  await page.getByRole('link', { name: 'View your order' }).click();
  await expect(
    page.getByText('Everyday wireless headphones × 1'),
  ).toBeVisible();
  await expect(
    page.getByText(`contact-${stamp}@example.com`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('+12025550123', { exact: false })).toBeVisible();
  await page.goto('/admin');
  await expect(
    page.getByText('Administrator access is required.'),
  ).toBeVisible();
});
test('mobile catalog has working navigation and no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Fashion', exact: true })
    .click();
  await expect(page).toHaveURL(/category=fashion/);
  await expect(
    page.getByRole('heading', { name: 'Fashion', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '../work/storefront-mobile.png',
    fullPage: true,
  });
});
test('administrator can create categories/products and update inventory', async ({
  page,
}) => {
  await page.goto('/login?next=/admin');
  await page.getByLabel('Email address').fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Behind the good finds.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await page
    .getByLabel('Name', { exact: true })
    .fill(`Browser Category ${stamp}`);
  await page.getByLabel('Slug', { exact: true }).fill(`browser-${stamp}`);
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByRole('status')).toContainText('Category saved');
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await page.getByLabel('Product name').fill(`Browser product ${stamp}`);
  await page.getByLabel('SKU', { exact: true }).fill(`BROWSER-${stamp}`);
  await page
    .getByLabel('Description', { exact: true })
    .fill('End-to-end inventory verification');
  await page.getByLabel('Price (minor units)').fill('1250');
  await page.getByLabel('Stock', { exact: true }).fill('5');
  await page
    .getByLabel('Category', { exact: true })
    .selectOption({ label: `Browser Category ${stamp}` });
  await page.getByLabel('Product photo', { exact: true }).setInputFiles({
    name: 'merchant-photo.png',
    mimeType: 'image/png',
    buffer: await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#336655' },
    })
      .png()
      .toBuffer(),
  });
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByRole('status')).toContainText('Product saved');
  const categoryUrl = await page
    .getByRole('link', { name: 'View category' })
    .getAttribute('href');
  const categoryPage = await page.context().newPage();
  await categoryPage.goto(categoryUrl!);
  await expect(
    categoryPage.getByRole('heading', {
      name: `Browser product ${stamp}`,
      exact: true,
    }),
  ).toBeVisible();
  const photo = categoryPage.locator('.product-image img').first();
  await expect(photo).toHaveAttribute('src', /\/api\/media\//);
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await categoryPage.close();
  const row = page
    .locator('.admin-row')
    .filter({ hasText: `Browser product ${stamp}` });
  await expect(row).toContainText('5 in stock');
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Stock', { exact: true }).fill('9');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(row).toContainText('9 in stock');
  await row.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(row).toContainText('INACTIVE');
});
test('BFF rejects cross-origin writes without exposing tokens', async ({
  request,
}) => {
  const response = await request.post('/api/commerce/auth/login', {
    headers: { origin: 'https://untrusted.example' },
    data: { email: adminEmail, password },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('CSRF_REJECTED');
});

test('proxy bounds request bodies and the raw payment endpoint rejects unsigned notifications', async ({
  request,
  baseURL,
}) => {
  const oversized = await request.post('/api/commerce/auth/login', {
    headers: { origin: new URL(baseURL!).origin },
    data: { email: 'boundary@example.com', password: 'x'.repeat(70000) },
  });
  expect(oversized.status()).toBe(413);
  const webhook = await request.post('/api/payments/paystack/webhook', {
    data: { id: 'unsigned-test-event' },
  });
  expect(webhook.status()).toBe(400);
  const disallowed = await request.get('/api/commerce/internal-configuration');
  expect(disallowed.status()).toBe(404);
});

test('buyer tracks a paid order while admin saves shipping details and marks it delivered', async ({
  page,
  browser,
  baseURL,
}) => {
  const buyerEmail = `tracking-buyer-${stamp}@example.com`;
  const buyer = await db.user.create({
    data: {
      email: buyerEmail,
      name: 'Tracking Buyer',
      passwordHash: await new ScryptHasher().hash(password),
    },
  });
  const paidAt = new Date();
  const order = await db.order.create({
    data: {
      userId: buyer.id,
      idempotencyKey: `tracking-${stamp}`,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentProvider: 'browser-test-fixture',
      currency: 'NGN',
      total: 10000,
      subtotal: 10000,
      paidAt,
      estimatedDeliveryFrom: new Date(paidAt.getTime() + 3 * 86400000),
      estimatedDeliveryTo: new Date(paidAt.getTime() + 7 * 86400000),
      shippingAddress: {
        name: 'Tracking Buyer',
        email: buyerEmail,
        phone: '+2348012345678',
        line1: '10 Market Road',
        city: 'Lagos',
        country: 'NG',
        postalCode: '100001',
      },
    },
  });
  await page.goto(`/login?next=/account/orders/${order.id}`);
  await page.getByLabel('Email address').fill(buyerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Payment confirmed — awaiting delivery',
    }),
  ).toBeVisible();
  await expect(page.locator('.delivery-estimate')).toContainText(
    'Estimated delivery',
  );
  await expect(page.locator('.tracking-timeline li')).toHaveCount(4);
  const adminContext = await browser.newContext({ baseURL });
  try {
    const adminPage = await adminContext.newPage();
    await adminPage.goto('/login?next=/admin');
    await adminPage.getByLabel('Email address').fill(adminEmail);
    await adminPage.getByLabel('Password', { exact: true }).fill(password);
    await adminPage
      .getByRole('button', { name: 'Sign in', exact: true })
      .click();
    await adminPage
      .getByRole('button', { name: 'Orders', exact: true })
      .click();
    const row = adminPage
      .locator('.admin-order-row')
      .filter({ hasText: order.id.slice(0, 8).toUpperCase() });
    await row
      .getByLabel('Delivery partner', { exact: true })
      .fill('Example courier');
    await row
      .getByLabel('Tracking number', { exact: true })
      .fill('EG-TRACK-123');
    await row
      .getByLabel('Carrier tracking link')
      .fill('https://example.com/track/EG-TRACK-123');
    await row
      .getByLabel('Expected delivery date')
      .fill(new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10));
    await row.getByRole('button', { name: 'Save shipment details' }).click();
    await expect(adminPage.getByRole('status')).toContainText(
      'Shipment details updated',
    );
    await row.getByRole('button', { name: 'Mark as shipped' }).click();
    await expect(
      row.getByText('SHIPPED / PAID', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Refresh tracking' }).click();
    await expect(
      page.getByRole('heading', { name: 'On the way — awaiting delivery' }),
    ).toBeVisible();
    await expect(page.getByText('EG-TRACK-123', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Track with carrier' }),
    ).toHaveAttribute('href', 'https://example.com/track/EG-TRACK-123');
    await row.getByRole('button', { name: 'Mark as delivered' }).click();
    await expect(
      row.getByText('DELIVERED / PAID', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Refresh tracking' }).click();
    await expect(
      page.getByRole('heading', { name: 'Delivered to your address' }),
    ).toBeVisible();
    await expect(
      page.getByText('Marked delivered on', { exact: false }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: '../work/order-tracking-mobile.png',
      fullPage: true,
    });
  } finally {
    await adminContext.close();
  }
});
