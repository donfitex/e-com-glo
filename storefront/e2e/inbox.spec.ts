import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { ScryptHasher } from '../../src/modules/auth/security';
import { readFile } from 'node:fs/promises';
const url = process.env.E2E_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Use an isolated _test database');
const db = new PrismaClient({ datasources: { db: { url } } });
const stamp = Date.now();
const email = `inbox-admin-${stamp}@example.com`;
const password = 'Browser-inbox-login-123';
const recovery = 'Browser-recovery-passphrase-123';
test.beforeAll(async () => {
  await db.supportMessage.deleteMany();
  await db.inboxKey.deleteMany();
  await db.user.create({
    data: {
      email,
      name: 'Inbox Admin',
      role: 'ADMIN',
      passwordHash: await new ScryptHasher().hash(password),
    },
  });
});
test.afterAll(async () => {
  await db.$disconnect();
});
test('customer contact is encrypted before transmission and admin recovers, reads and resolves it', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  await page.goto(`/login?next=${encodeURIComponent('/admin?section=inbox')}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your secure inbox.' }),
  ).toBeVisible();
  await page.getByLabel('Recovery passphrase', { exact: true }).fill(recovery);
  await page.getByLabel('Confirm recovery passphrase').fill(recovery);
  await page
    .getByRole('button', { name: 'Create recovery key', exact: true })
    .click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('button', { name: 'Download recovery key', exact: true })
      .click(),
  ]);
  const file = (await download.path())!;
  const backup = JSON.parse(await readFile(file, 'utf8'));
  expect(JSON.stringify(backup)).not.toContain('"d":');
  expect(JSON.stringify(backup)).not.toContain(recovery);
  await page
    .getByRole('button', { name: 'Activate inbox', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Secure inbox activated',
  );
  const customer = await browser.newContext({ baseURL });
  const name = 'Private browser customer';
  const sender = `private-${stamp}@example.com`;
  const body =
    'This confidential complaint must only be readable in the admin browser.';
  try {
    const contact = await customer.newPage();
    await contact.goto('/contact');
    await contact.getByLabel('Your name', { exact: true }).fill(name);
    await contact.getByLabel('Email address', { exact: true }).fill(sender);
    await contact
      .getByLabel('Subject', { exact: true })
      .fill('Shipment complaint');
    await contact
      .getByLabel('Order reference (optional)')
      .fill('EG-PRIVATE-123');
    await contact.getByLabel('Message', { exact: true }).fill(body);
    const sentRequest = contact.waitForRequest(
      (request) =>
        request.url().endsWith('/api/commerce/contact/messages') &&
        request.method() === 'POST',
    );
    await contact.getByRole('button', { name: 'Send secure message' }).click();
    const request = await sentRequest;
    for (const value of [name, sender, body, 'EG-PRIVATE-123'])
      expect(request.postData()).not.toContain(value);
    const envelope = request.postDataJSON();
    await expect(contact.getByRole('status')).toContainText(
      'Your encrypted message was sent',
    );
    const stored = await db.supportMessage.findUniqueOrThrow({
      where: { id: envelope.id },
    });
    for (const value of [name, sender, body])
      expect(JSON.stringify(stored)).not.toContain(value);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Refresh inbox' }).click();
    await expect(
      page.getByRole('link', { name: 'Admin inbox, 1 unread messages' }),
    ).toBeVisible();
    await expect(
      page.getByText('New support message', { exact: true }),
    ).toBeVisible();
    const item = page
      .locator('.inbox-item')
      .filter({ hasText: envelope.id.slice(0, 8).toUpperCase() });
    await item.click();
    await expect(page.locator('.inbox-reader')).toContainText(body);
    await expect(page.locator('.inbox-reader')).toContainText(sender);
    await expect(
      page.getByRole('link', { name: 'Admin inbox, 0 unread messages' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Remove saved copy from this device' })
      .click();
    await expect(page.locator('.inbox-reader')).not.toContainText(body);
    await page.getByLabel('Recovery key file').setInputFiles(file);
    await page
      .getByLabel('Recovery passphrase', { exact: true })
      .fill(recovery);
    await page
      .getByRole('button', { name: 'Unlock inbox', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Inbox unlocked' }),
    ).toBeVisible();
    await item.click();
    await expect(page.locator('.inbox-reader')).toContainText(body);
    await page.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(item).toContainText('RESOLVED');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: '../work/encrypted-inbox-mobile.png',
      fullPage: true,
    });
  } finally {
    await customer.close();
  }
});
