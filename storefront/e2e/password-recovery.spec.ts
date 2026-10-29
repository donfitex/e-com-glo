import { test, expect } from '@playwright/test';
test('forgot password is linked from sign-in, reset consumes a hidden token and validates confirmation', async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route('**/api/commerce/auth/forgot-password', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'customer@example.com',
    });
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ data: { accepted: true } }),
    });
  });
  await page.route('**/api/commerce/auth/reset-password', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { reset: true } }),
    });
  });
  await page.goto('/login');
  await page
    .getByRole('link', { name: 'Forgot password?', exact: true })
    .click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page
    .getByLabel('Email address', { exact: true })
    .fill('customer@example.com');
  await page
    .getByRole('button', { name: 'Send reset link', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Check your email.', exact: true }),
  ).toBeVisible();
  const token = 'a'.repeat(64);
  await page.goto(`/reset-password#token=${token}`);
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);
  await page
    .getByLabel('New password', { exact: true })
    .fill('New-secure-password-123');
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('Different-password-456');
  await page
    .getByRole('button', { name: 'Update password', exact: true })
    .click();
  await expect(page.locator('.notice[role="alert"]')).toContainText(
    'Your passwords do not match.',
  );
  expect(requests).toHaveLength(0);
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('New-secure-password-123');
  await page
    .getByRole('button', { name: 'Update password', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Your password is updated.',
      exact: true,
    }),
  ).toBeVisible();
  expect(requests).toEqual([{ token, password: 'New-secure-password-123' }]);
  await expect(
    page.getByRole('link', { name: 'Back to sign in', exact: true }),
  ).toBeVisible();
});
test('reset page rejects missing links and shows expired-token errors without losing password inputs', async ({
  page,
}) => {
  await page.goto('/reset-password');
  await expect(page.locator('.notice[role="alert"]')).toContainText(
    'missing or invalid',
  );
  await expect(
    page.getByRole('button', { name: 'Update password', exact: true }),
  ).toBeDisabled();
  await page.route('**/api/commerce/auth/reset-password', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'INVALID_RESET_LINK',
          message:
            'This reset link is invalid, expired or already used. Request a new link.',
        },
      }),
    }),
  );
  await page.goto(`/reset-password#token=${'b'.repeat(64)}`);
  await page
    .getByLabel('New password', { exact: true })
    .fill('New-secure-password-123');
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('New-secure-password-123');
  await page
    .getByRole('button', { name: 'Update password', exact: true })
    .click();
  await expect(page.locator('.notice[role="alert"]')).toContainText(
    'expired or already used',
  );
  await expect(
    page.getByRole('link', { name: 'Request a new reset link', exact: true }),
  ).toBeVisible();
});
