import { test, expect } from '@playwright/test';
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
  await page
    .getByLabel('Address line 1', { exact: true })
    .fill('10 Example Road');
  await page.getByLabel('City', { exact: true }).fill('New York');
  await page.getByLabel('State / region').fill('NY');
  await page.getByLabel('Postal code').fill('10001');
  await page.getByLabel('Country code').fill('US');
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
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByRole('status')).toContainText('Product saved');
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
