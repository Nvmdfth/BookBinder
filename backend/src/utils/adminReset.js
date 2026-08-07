/**
 * Credential recovery for a locked-out account.
 *
 * BOOKBINDER_ADMIN_PASS seeds the administrator on a genuinely empty database
 * and never applies again, so once the password has been changed — or
 * forgotten — there is no way back in through the app itself. This is that way
 * back, reached from scripts/reset-admin.js.
 *
 * Deliberately not reachable over HTTP. Running it already requires host
 * access, which already implies database access; an unauthenticated network
 * route would be strictly worse than the shell it replaces.
 */
const bcrypt = require('bcryptjs');
const { query } = require('../db/db');

/** Matches the floor the profile form enforces, so the two cannot disagree. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Set an account's password, returning the account it acted on.
 *
 * Never creates an account: a typo must fail loudly rather than quietly mint a
 * second administrator. Clears is_disabled too — a disabled account is as
 * locked out as a forgotten one, and half a recovery is no recovery.
 *
 * The new hash changes the account's password signature, so every existing
 * session for it stops validating. That is the intent: whoever else was
 * holding one is signed out.
 */
async function resetUserPassword({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('An account email is required.');
  }

  if (!password || String(password).trim().length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const found = await query(
    'SELECT id, email, role, is_disabled FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (found.rows.length === 0) {
    throw new Error(
      `No account exists for ${normalizedEmail}. Recovery never creates one — check the address.`
    );
  }

  const user = found.rows[0];
  const hash = await bcrypt.hash(password, await bcrypt.genSalt(10));

  await query(
    'UPDATE users SET password_hash = $1, is_disabled = FALSE, updated_at = NOW() WHERE id = $2',
    [hash, user.id]
  );

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    wasDisabled: user.is_disabled === true,
  };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  resetUserPassword,
};
