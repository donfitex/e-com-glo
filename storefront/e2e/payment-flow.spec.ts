import { test, expect } from '@playwright/test';
const orderId = 'acbddcbc-639a-468c-b7a1-9305944ca0e1';
const user = {
  id: 'c9208c44-5dfe-4ebe-8a27-073eaa3dafda',
  name: 'Test Buyer',
  email: 'test@example.com',
  role: 'CUSTOMER',
};

test('placing a payable order redirects directly to Paystack hosted checkout', async ({
  page,
}) => {
  let initialized = 0;
  await page.route('**/api/commerce/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path.endsWith('/auth/me')) data = user;
    else if (path.endsWith('/cart'))
      data = {
        currency: 'NGN',
        subtotal: 10000,
        total: 10000,
        items: [
          {
            productId: orderId,
            name: 'Merchant product',
            quantity: 1,
            lineTotal: 10000,
          },
        ],
      };
    else if (path.endsWith('/orders/quote'))
      data = {
        currency: 'NGN',
        subtotal: 10000,
        shipping: 0,
        tax: 0,
        total: 10000,
        ruleVersion: 'test',
      };
    else if (path.endsWith('/orders/checkout'))
      data = { id: orderId, paymentStatus: 'UNPAID' };
    else if (path.endsWith(`/orders/${orderId}/payment`)) {
      initialized++;
      expect(route.request().method()).toBe('POST');
      data = { url: 'https://checkout.paystack.com/test-hosted-checkout' };
    } else return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ json: { data } });
  });
  await page.route('https://checkout.paystack.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Paystack test checkout</h1>',
    }),
  );
  await page.goto('/checkout');
  await page.getByLabel('Phone number').fill('+2348012345678');
  await expect(page.getByLabel('Contact email')).toHaveValue(
    'test@example.com',
  );
  await page
    .getByLabel('Address line 1', { exact: true })
    .fill('10 Market Road');
  await page.getByLabel('City', { exact: true }).fill('Lagos');
  await page.getByLabel('Postal code').fill('100001');
  await page.getByLabel('Country code').fill('NG');
  await page.getByRole('button', { name: 'Calculate delivery & tax' }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(
    'https://checkout.paystack.com/test-hosted-checkout',
  );
  expect(initialized).toBe(1);
});

test('an expired session returns to sign-in with the existing order preserved', async ({
  page,
}) => {
  await page.route('**/api/commerce/**', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'SESSION_EXPIRED', message: 'Sign in again' } },
    }),
  );
  await page.goto(`/checkout/payment?order=${orderId}`);
  await expect(page).toHaveURL(new RegExp('/login\\?next='));
  expect(new URL(page.url()).searchParams.get('next')).toBe(
    `/checkout/payment?order=${orderId}`,
  );
  await expect(
    page.getByRole('heading', { name: 'Sign in to E-com Global' }),
  ).toBeVisible();
  await expect(page.getByText('Bearer token required')).toHaveCount(0);
});

test('dark account cards and form labels have readable contrast', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/commerce/auth/me', (route) =>
    route.fulfill({ json: { data: user } }),
  );
  await page.route('**/api/commerce/cart', (route) =>
    route.fulfill({ json: { data: { items: [] } } }),
  );
  await page.goto('/account');
  const card = page.locator('.account-card').first();
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS('background-color', 'rgb(28, 41, 34)');
  await expect(card.locator('h2')).toHaveCSS('color', 'rgb(229, 236, 230)');
  await page.goto('/login');
  await expect(page.locator('.form-card small').first()).toHaveCSS(
    'color',
    'rgb(172, 185, 175)',
  );
});
