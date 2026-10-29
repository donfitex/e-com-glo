import { test, expect } from '@playwright/test';

test('save products across reloads, share and clear device browsing history', async ({
  page,
}) => {
  const stamp = Date.now();
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Saved Products Customer');
  await page.getByLabel('Email address').fill(`saved-${stamp}@example.com`);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Browser-test-password-123');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page).not.toHaveURL(/register/);
  await page.goto('/shop');
  await page
    .getByRole('link', { name: 'Everyday wireless headphones', exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/);
  const productUrl = page.url();
  const save = page.getByRole('button', {
    name: 'Save Everyday wireless headphones for later',
    exact: true,
  });
  await expect(save).toBeVisible();
  await save.click();
  await expect(
    page.getByRole('button', {
      name: 'Remove Everyday wireless headphones from saved products',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/wishlist');
  await expect(
    page.getByText('1 saved products', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole('link', { name: 'Everyday wireless headphones', exact: true })
      .last(),
  ).toBeVisible();
  await page.goto(productUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { copied: string }).copied = value;
        },
      },
    });
  });
  await page
    .getByRole('button', { name: 'Share product', exact: true })
    .click();
  await expect(
    page.getByText('Product link copied.', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(productUrl);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Recently viewed.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear history', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Recently viewed.' }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('ecom-recent-v1')),
  ).toBeNull();
  await page.goto('/wishlist');
  await page
    .getByRole('button', {
      name: 'Remove Everyday wireless headphones from saved products',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'A little inspiration, saved.' }),
  ).toBeVisible();
});
