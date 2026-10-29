import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  webServer: process.env.CI
    ? [
        {
          command: 'node ../scripts/start-test-api.mjs',
          url: 'http://127.0.0.1:3000/ready',
          timeout: 60000,
          reuseExistingServer: false,
          env: {
            DATABASE_URL: process.env.E2E_DATABASE_URL!,
            REDIS_URL: 'redis://localhost:6379/14',
            JWT_SECRET: 'browser-ci-test-only-secret-at-least-32-characters',
            CORS_ORIGINS: 'http://localhost:3001',
            CHECKOUT_RULES_JSON: JSON.stringify([
              {
                country: 'US',
                currency: 'USD',
                shipping: 700,
                taxBasisPoints: 0,
              },
            ]),
            PORT: '3000',
            API_RATE_LIMIT_PER_MINUTE: '600',
          },
        },
        {
          command: 'npm run dev',
          url: 'http://localhost:3001',
          timeout: 60000,
          reuseExistingServer: false,
          env: {
            COMMERCE_API_URL: 'http://127.0.0.1:3000',
            STOREFRONT_ORIGIN: 'http://localhost:3001',
            NEXT_TELEMETRY_DISABLED: '1',
          },
        },
      ]
    : undefined,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        }
      : {},
  },
});
