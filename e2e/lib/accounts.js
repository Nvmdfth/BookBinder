/**
 * Account provisioning over the API.
 *
 * Specs share one database, so each one registers its own account rather than
 * reusing a fixture user. Open registration ships disabled (init.sql seeds
 * allow_open_registration=false), so provisioning goes through the seeded admin
 * to switch it on once per run.
 */
const { request } = require('@playwright/test');
const { resolveBaseUrl } = require('./lanHost');

/** Matches BOOKBINDER_ADMIN_* in docker-compose.e2e.yml. */
const ADMIN = {
  email: 'e2e-admin@library.com',
  password: 'e2e-password-123',
};

let registrationOpened = false;

async function apiContext() {
  return request.newContext({ baseURL: resolveBaseUrl() });
}

/** Asserts on failure rather than returning a status — a broken fixture should not read as a test failure. */
async function expectOk(response, what) {
  if (!response.ok()) {
    throw new Error(
      `[e2e fixture] ${what} failed: HTTP ${response.status()} ${await response.text()}`
    );
  }
  return response;
}

/** Flips allow_open_registration on, once per process. */
async function openRegistration() {
  if (registrationOpened) return;

  const api = await apiContext();
  try {
    await expectOk(
      await api.post('/api/auth/login', { data: ADMIN }),
      'admin login'
    );
    await expectOk(
      await api.put('/api/settings', { data: { allow_open_registration: 'true' } }),
      'enabling open registration'
    );
    registrationOpened = true;
  } finally {
    await api.dispose();
  }
}

/**
 * Registers a fresh account and returns its credentials.
 *
 * `label` only makes the address readable in logs; uniqueness comes from the
 * timestamp and counter, so repeated runs against a reused stack do not collide.
 */
let counter = 0;
async function createAccount(label = 'user') {
  await openRegistration();

  counter += 1;
  const credentials = {
    email: `e2e-${label}-${Date.now()}-${counter}@library.com`,
    password: 'initial-password-1',
  };

  const api = await apiContext();
  try {
    await expectOk(
      await api.post('/api/auth/register', { data: credentials }),
      `registering ${credentials.email}`
    );
  } finally {
    await api.dispose();
  }

  return credentials;
}

/** Signs in through the real login form, leaving the page on the dashboard. */
async function signIn(page, { email, password }) {
  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/');
}

module.exports = { ADMIN, createAccount, signIn, openRegistration };
