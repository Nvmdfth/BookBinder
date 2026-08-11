/**
 * Regression guard for 1044d9c — "stop stranding the client after a password
 * change".
 *
 * Changing a password mints a replacement session cookie so the current device
 * stays signed in. When that cookie was stamped `Secure` from NODE_ENV rather
 * than from the connection, a browser on a plain-HTTP LAN address discarded it,
 * and because the old cookie's signature no longer matched the new password
 * hash, the next request had no valid session at all. The user was signed out
 * by the act of changing their password, with nothing on screen to explain it.
 *
 * The backend unit test asserts the cookie *attributes*. This asserts the thing
 * the user actually cared about: that they are still logged in afterwards. It
 * only has teeth because the suite runs over a LAN address — on localhost the
 * browser accepts the Secure cookie and the bug hides. See lib/lanHost.js.
 */
const { test, expect } = require('@playwright/test');
const { createAccount, signIn } = require('../lib/accounts');

const NEW_PASSWORD = 'replacement-password-2';

test.describe('Password change', () => {
  test('leaves the session intact on a plain-HTTP LAN address', async ({ page }) => {
    const account = await createAccount('pwchange');
    await signIn(page, account);

    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();

    await page.getByPlaceholder('Leave blank to keep current').fill(NEW_PASSWORD);
    await page.getByPlaceholder('Repeat new password').fill(NEW_PASSWORD);
    await page.getByPlaceholder('Enter current password to save changes').fill(account.password);
    await page.getByRole('button', { name: 'Save Settings' }).click();

    await expect(page.getByText('Profile updated successfully.')).toBeVisible();

    /*
     * The in-memory user survives the change on its own, so the failure only
     * surfaces once the browser has to present the cookie again. Reloading is
     * the shortest path to that; it is also literally what the reporting user
     * did.
     */
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
    expect(page.url()).not.toContain('/login');
  });

  test('reissues a session cookie the browser will keep over plain HTTP', async ({ page, context }) => {
    const account = await createAccount('pwcookie');
    await signIn(page, account);

    /*
     * The pre-change token is the control. Asserting only that *a* token cookie
     * survives with secure=false proves nothing: when the replacement is
     * rejected the jar simply keeps this one, which was issued at login and is
     * already non-Secure. The replacement is only observable as a change in
     * value.
     */
    const before = (await context.cookies()).find((c) => c.name === 'token');
    expect(before, 'no session cookie after sign-in').toBeDefined();

    await page.goto('/profile');
    await page.getByPlaceholder('Leave blank to keep current').fill(NEW_PASSWORD);
    await page.getByPlaceholder('Repeat new password').fill(NEW_PASSWORD);
    await page.getByPlaceholder('Enter current password to save changes').fill(account.password);
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByText('Profile updated successfully.')).toBeVisible();

    /*
     * Direct evidence of the mechanism rather than its symptom: the token the
     * browser is holding must be the one minted against the new password hash.
     * A Secure cookie from this plain-HTTP origin never reaches the jar, so
     * under the bug this value is unchanged from the login token above.
     */
    const after = (await context.cookies()).find((c) => c.name === 'token');
    expect(after, 'session cookie was discarded by the browser').toBeDefined();
    expect(after.value, 'reissued token never reached the browser').not.toBe(before.value);
    expect(after.secure, 'Secure was set on a plain-HTTP origin').toBe(false);
    expect(after.httpOnly).toBe(true);
  });

  test('accepts the new password on a fresh sign-in', async ({ page, context }) => {
    const account = await createAccount('pwlogin');
    await signIn(page, account);

    await page.goto('/profile');
    await page.getByPlaceholder('Leave blank to keep current').fill(NEW_PASSWORD);
    await page.getByPlaceholder('Repeat new password').fill(NEW_PASSWORD);
    await page.getByPlaceholder('Enter current password to save changes').fill(account.password);
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByText('Profile updated successfully.')).toBeVisible();

    /*
     * Companion assertion, not a guard for this bug: it passes with the Secure
     * regression reintroduced, because the hash was written either way. It is
     * here so the two tests above cannot be satisfied by an update that keeps
     * the session alive by never changing the password at all.
     */
    await context.clearCookies();
    await signIn(page, { email: account.email, password: NEW_PASSWORD });

    await expect(page.getByRole('heading', { name: 'My Libraries' })).toBeVisible();
  });
});
