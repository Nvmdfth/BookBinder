/**
 * Design tour — captures every screen, overlay and interaction state to a
 * folder of screenshots for review, and audits text contrast while it is there.
 *
 * This is a reviewing tool, not a test: it asserts almost nothing and never
 * fails a build. It lives outside tests/ so `playwright test` does not pick it
 * up. The point is to make the app's *visual* state inspectable in one command,
 * because the failures it is meant to surface — a field that reads as disabled,
 * a red zero next to a green all-clear — are invisible to assertions that only
 * ever check behaviour.
 *
 *   npm run tour
 *
 * Screenshots land in tour/shots/. The contrast audit prints to stdout.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const { up, waitForHealth } = require('../lib/stack');
const { resolveBaseUrl, resolveLanHost, PORT } = require('../lib/lanHost');
const { createAccount, signIn, ADMIN } = require('../lib/accounts');
const { seedLibrary } = require('../lib/seed');
const { auditContrast, WCAG_AA } = require('./contrast');

const SHOTS = path.join(__dirname, 'shots');
const BASE = resolveBaseUrl();
const DESKTOP = { width: 1440, height: 900 };
const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};

let shotIndex = 0;

/**
 * Settling matters more here than in a test: a screenshot taken mid-transition
 * shows a state no user ever sees, and every card in this app has a 220ms ease
 * on it.
 */
async function shot(page, name, { full = false } = {}) {
  shotIndex += 1;
  const file = `${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: full });
  console.log(`  ${file}`);
}

async function section(title) {
  console.log(`\n${title}`);
}

/* ---------------------------------------------------------------- screens */

async function tourScreens(page, shelfIds) {
  await section('Screens');

  await page.goto(`${BASE}/login`);
  await shot(page, 'login');

  await page.goto(`${BASE}/register`);
  await shot(page, 'register');

  await page.goto(`${BASE}/`);
  await shot(page, 'dashboard', { full: true });

  await page.goto(`${BASE}/bookshelves/${shelfIds[0]}`);
  await shot(page, 'shelf-populated', { full: true });

  await page.goto(`${BASE}/bookshelves/${shelfIds[2]}`);
  await shot(page, 'shelf-empty');

  await page.goto(`${BASE}/profile`);
  await shot(page, 'profile', { full: true });
}

/* ----------------------------------------------------------------- modals */

async function tourModals(page, shelfIds) {
  await section('Overlays');

  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: /New Bookshelf/i }).click();
  await shot(page, 'modal-construct-bookshelf');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Book Roulette/i }).click();
  await page.waitForTimeout(1200); // it spins before it lands
  await shot(page, 'modal-book-roulette');
  await page.keyboard.press('Escape');

  await page.goto(`${BASE}/bookshelves/${shelfIds[0]}`);

  /* The catalogue card opens from a cover in the grid. waitFor rather than
     count(): count() resolves immediately against whatever has rendered so
     far, so on a cold navigation it reports zero and the overlay is silently
     skipped rather than captured. */
  const firstCover = page.locator('.cover-open').first();
  await firstCover.waitFor({ state: 'visible' });
  await firstCover.click();
  await shot(page, 'modal-catalogue-card');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Share Shelf/i }).click();
  await shot(page, 'modal-share-console');
  await page.keyboard.press('Escape');
}

/* ------------------------------------------------------ interaction states */

/*
 * The sign-in states need their own context. /login is wrapped in PublicRoute,
 * so an authenticated session is redirected to the dashboard and the form is
 * never reachable on the signed-in page.
 */
async function tourSignedOutStates(browser) {
  await section('Interaction states — signed out');

  const context = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
  const page = await context.newPage();

  // Focus ring on a field, which is where the recessed-well treatment either
  // reads as depth or reads as a disabled control.
  await page.goto(`${BASE}/login`);
  await page.locator('#login-email').focus();
  await shot(page, 'state-input-focus');

  // Hover on a primary action.
  await page.locator('#login-email').blur();
  await page.getByRole('button', { name: 'Sign In' }).hover();
  await shot(page, 'state-button-hover');

  // A rejected sign-in — the error banner and its shake animation.
  await page.locator('#login-email').fill('nobody@library.com');
  await page.locator('#login-password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForTimeout(900);
  await shot(page, 'state-login-rejected');

  await context.close();
}

async function tourInteractionStates(page, shelfIds) {
  await section('Interaction states — signed in');

  // Client-side validation: mismatched new passwords never reach the server.
  await page.goto(`${BASE}/profile`);
  await page.getByPlaceholder('Leave blank to keep current').fill('one-password-1');
  await page.getByPlaceholder('Repeat new password').fill('other-password-2');
  await page.getByPlaceholder('Enter current password to save changes').fill('irrelevant');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await page.waitForTimeout(600);
  await shot(page, 'state-validation-mismatch');

  // A filter that matches nothing — the empty state inside a populated shelf,
  // which is a different problem from an empty shelf.
  await page.goto(`${BASE}/bookshelves/${shelfIds[0]}`);
  await page.getByPlaceholder(/Filter by title/i).fill('zzzzzz');
  await page.waitForTimeout(600);
  await shot(page, 'state-filter-no-matches');

  // Read/unread filters and the list view, which the grid hides.
  await page.getByPlaceholder(/Filter by title/i).fill('');
  const unread = page.getByRole('button', { name: /^Unread$/ });
  if (await unread.count()) {
    await unread.click();
    await shot(page, 'state-filter-unread');
  }
}

/* ----------------------------------------------------------------- mobile */

async function tourMobile(browser, account, shelfIds) {
  await section('Phone (390px)');

  const context = await browser.newContext({ baseURL: BASE, ...PHONE });
  const page = await context.newPage();
  await signIn(page, account);

  await shot(page, 'mobile-dashboard');
  await page.goto(`${BASE}/bookshelves/${shelfIds[0]}`);
  await shot(page, 'mobile-shelf');
  await page.goto(`${BASE}/profile`);
  await shot(page, 'mobile-profile');

  // The bottom tray is fixed; a full-page capture would strand it mid-document
  // and invent a bug that is not there.
  await page.goto(`${BASE}/`);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(page, 'mobile-scrolled');

  await context.close();
}

/* ------------------------------------------------------------------ admin */

async function tourAdmin(browser) {
  await section('Admin');

  const context = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
  const page = await context.newPage();
  await signIn(page, ADMIN);
  await page.goto(`${BASE}/admin`);
  await page.waitForTimeout(900);
  await shot(page, 'admin', { full: true });
  await context.close();
}

/* ------------------------------------------------------------------- main */

(async () => {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  console.log(`\n[tour] ${resolveLanHost()}:${PORT}`);
  if (process.env.E2E_REUSE_STACK !== '1') {
    up(PORT);
  }
  await waitForHealth(BASE);

  const account = await createAccount('tour');
  const shelfIds = await seedLibrary(account);

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
  const page = await context.newPage();
  await signIn(page, account);

  await tourScreens(page, shelfIds);
  await tourModals(page, shelfIds);
  await tourSignedOutStates(browser);
  await tourInteractionStates(page, shelfIds);

  await section('Contrast audit');
  const findings = [];
  for (const route of ['/', `/bookshelves/${shelfIds[0]}`, '/profile']) {
    await page.goto(`${BASE}${route}`);
    await page.waitForTimeout(700);
    for (const failure of await auditContrast(page)) {
      findings.push({ route, ...failure });
    }
  }
  if (findings.length === 0) {
    console.log(`  no text below ${WCAG_AA}:1`);
  } else {
    for (const f of findings) {
      console.log(`  ${f.ratio}:1  (needs ${f.min})  "${f.text}"  — ${f.route}`);
    }
  }

  await context.close();
  await tourMobile(browser, account, shelfIds);
  await tourAdmin(browser);
  await browser.close();

  console.log(`\n[tour] ${shotIndex} screenshots in ${path.relative(process.cwd(), SHOTS)}`);
  console.log('[tour] stack left running; `npm run stack:down` when finished.\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
