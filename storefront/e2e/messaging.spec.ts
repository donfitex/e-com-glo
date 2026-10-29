import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { ScryptHasher } from '../../src/modules/auth/security';
import { createInboxKey } from '../lib/contact-crypto';
const url = process.env.E2E_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Use an isolated test database');
const db = new PrismaClient({ datasources: { db: { url } } });
const stamp = Date.now(),
  email = `conversation-admin-${stamp}@example.com`,
  customerEmail = `conversation-customer-${stamp}@example.com`,
  password = 'Conversation-login-password-123',
  recovery = 'Administrator-recovery-passphrase-123';
let store: Awaited<ReturnType<typeof createInboxKey>>;
test.beforeAll(async () => {
  store = await createInboxKey(recovery);
  await db.inboxKey.updateMany({
    where: { active: true },
    data: { active: false },
  });
  await db.inboxKey.create({
    data: {
      id: store.publicKey.id,
      publicJwk: JSON.parse(JSON.stringify(store.publicKey.publicJwk)),
      fingerprint: store.publicKey.fingerprint,
    },
  });
  await db.user.create({
    data: {
      email,
      name: 'Conversation Admin',
      role: 'ADMIN',
      passwordHash: await new ScryptHasher().hash(password),
    },
  });
});
test.afterAll(async () => {
  await db.$disconnect();
});
test('customer and admin exchange encrypted replies, automatic sign-in sync, updates and address choices', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const customerContext = await browser.newContext({ baseURL });
  const customer = await customerContext.newPage();
  await customer.goto('/register?next=/account/inbox');
  await customer.getByLabel('Full name').fill('Conversation Customer');
  await customer.getByLabel('Email address').fill(customerEmail);
  await customer.getByLabel('Password', { exact: true }).fill(password);
  await customer
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    customer.getByRole('heading', { name: 'Your private inbox', exact: true }),
  ).toBeVisible();
  await expect(customer.getByLabel('Recovery key file')).toHaveCount(0);
  await expect(
    customer.getByRole('button', { name: 'New conversation', exact: true }),
  ).toBeEnabled();
  await customer
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(customer.getByLabel('Your reply')).toBeEnabled();
  const complaint =
    'Private delivery question: please confirm my arrival date.';
  const request = customer.waitForRequest(
    (r) =>
      r.method() === 'POST' &&
      /\/conversations\/[^/]+\/messages$/.test(r.url()),
  );
  await customer.getByLabel('Your reply').fill(complaint);
  await customer
    .getByRole('button', { name: 'Send reply', exact: true })
    .click();
  const sent = await request;
  expect(sent.postData()).not.toContain(complaint);
  await expect(customer.getByText(complaint, { exact: true })).toBeVisible();
  const thread = JSON.parse(sent.postData()!).conversationId;
  await page.goto('/login?next=/admin?section=conversations');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Customer conversations', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Recovery key file').setInputFiles({
    name: 'store-key.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(store.backup)),
  });
  await page.getByLabel('Recovery passphrase', { exact: true }).fill(recovery);
  await page
    .getByRole('button', { name: 'Unlock conversations', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: new RegExp(`Support · ${thread.slice(0, 8)}`),
    })
    .click();
  await expect(page.getByText(complaint, { exact: true })).toBeVisible();
  await customer.goto('/account');
  const reply =
    'Your delivery is scheduled for Friday. Can we help with anything else?';
  await page.getByLabel('Your reply').fill(reply);
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await customer.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    customer.getByRole('link', { name: /Your inbox, 1 unread messages/ }),
  ).toBeVisible();
  await customer.goto('/account/inbox');
  await customer
    .getByRole('button', {
      name: new RegExp(`Support · ${thread.slice(0, 8)}`),
    })
    .click();
  await expect(customer.getByText(reply, { exact: true })).toBeVisible();
  await customer
    .getByLabel('Your reply')
    .fill('Thank you. That resolves my question.');
  await customer
    .getByRole('button', { name: 'Send reply', exact: true })
    .click();
  await expect(
    customer.getByText('Thank you. That resolves my question.', {
      exact: true,
    }),
  ).toBeVisible();
  await customer
    .getByRole('button', { name: 'Mark resolved', exact: true })
    .click();
  await expect(
    customer.getByRole('button', { name: 'Reopen conversation', exact: true }),
  ).toBeVisible();
  const ciphertext = JSON.stringify(
    await db.conversationMessage.findMany({
      where: { conversationId: thread },
    }),
  );
  expect(ciphertext).not.toContain(complaint);
  expect(ciphertext).not.toContain(reply);
  // A fresh device uses only the normal account login, never a recovery-file prompt.
  const secondContext = await browser.newContext({ baseURL });
  const second = await secondContext.newPage();
  await second.goto('/login?next=/account/inbox');
  await second.getByLabel('Email address').fill(customerEmail);
  await second.getByLabel('Password', { exact: true }).fill(password);
  await second.getByRole('button', { name: 'Sign in', exact: true }).click();
  await second
    .getByRole('button', {
      name: new RegExp(`Support · ${thread.slice(0, 8)}`),
    })
    .click();
  await expect(second.getByText(reply, { exact: true })).toBeVisible();
  await expect(second.getByLabel('Recovery key file')).toHaveCount(0);
  await page.getByRole('button', { name: 'Broadcasts', exact: true }).click();
  await page.getByLabel('Announcement title').fill(`Community update ${stamp}`);
  await page
    .getByLabel('Announcement message')
    .fill('A new collection is ready to explore.');
  await page
    .getByRole('button', { name: 'Save announcement draft', exact: true })
    .click();
  await expect(
    page.getByText('Draft saved. Preview it below before publishing.', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Publish announcement', exact: true })
    .first()
    .click();
  await expect(
    page.getByText('Published to registered users’ store inboxes.', {
      exact: true,
    }),
  ).toBeVisible();
  await second.goto('/account/updates');
  await expect(
    second.getByRole('heading', {
      name: `Community update ${stamp}`,
      exact: true,
    }),
  ).toBeVisible();
  await second
    .getByRole('button', { name: 'Mark update read', exact: true })
    .first()
    .click();
  await second
    .getByLabel('Receive offers and promotions in my store inbox')
    .uncheck();
  await expect(
    second.getByText('Notification preference saved.', { exact: true }),
  ).toBeVisible();
  const user = await db.user.findUniqueOrThrow({
    where: { email: customerEmail },
  });
  expect(
    (
      await db.customerPreferences.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).promotions,
  ).toBe(false);
  await second.goto('/account/addresses');
  await second
    .getByLabel('Phone number', { exact: true })
    .fill('+1 202 555 0123');
  await second
    .getByLabel('Address line 1', { exact: true })
    .fill('10 Saved Road');
  await second.getByLabel('City', { exact: true }).fill('New York');
  await second.getByLabel('Postal code', { exact: true }).fill('10001');
  await second.getByLabel('Country code (e.g. NG)', { exact: true }).fill('US');
  await second
    .getByRole('button', { name: 'Save delivery address', exact: true })
    .click();
  await expect(
    second.getByText('10 Saved Road', { exact: false }).first(),
  ).toBeVisible();
  await second.goto('/shop');
  await second
    .getByRole('link', { name: 'Everyday wireless headphones', exact: true })
    .last()
    .click();
  await second.getByRole('button', { name: 'Add to bag', exact: true }).click();
  await expect(second.getByRole('status')).toContainText('Added to your bag');
  await second.goto('/checkout');
  await second
    .getByLabel('Use a saved delivery address')
    .selectOption({ label: 'Home · Default · New York, US' });
  await expect(
    second.getByLabel('Address line 1', { exact: true }),
  ).toHaveValue('10 Saved Road');
  await second.getByLabel('Use a saved delivery address').selectOption('');
  await expect(
    second.getByLabel('Address line 1', { exact: true }),
  ).toHaveValue('');
  await second.setViewportSize({ width: 390, height: 844 });
  await second.goto('/account/inbox');
  await second
    .getByRole('button', {
      name: new RegExp(`Support · ${thread.slice(0, 8)}`),
    })
    .click();
  await expect(second.getByText(reply, { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Dark mode', exact: true }).click();
  expect(
    await second.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await second.screenshot({
    path: '../work/customer-conversation-mobile.png',
    fullPage: true,
  });
  await customerContext.close();
  await secondContext.close();
});
