/**
 * Credential recovery for a locked-out account.
 *
 * This is the path back in when nobody can authenticate, so its failure modes
 * matter more than its happy path: it must never invent an account to "fix" a
 * typo, and it must leave the account genuinely usable afterwards rather than
 * merely holding a new password.
 */
const bcrypt = require('bcryptjs');

jest.mock('../src/db/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn(), on: jest.fn(), end: jest.fn() },
  initDb: jest.fn(),
}));

const { query } = require('../src/db/db');
const { resetUserPassword, MIN_PASSWORD_LENGTH } = require('../src/utils/adminReset');

/** Install a lookup result, capturing whatever UPDATE the reset issues. */
function mockAccount(row) {
  query.mockImplementation(async (sql) => {
    if (/SELECT id, email, role, is_disabled FROM users/.test(sql)) {
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE users SET password_hash/.test(sql)) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
}

const ADMIN = { id: 1, email: 'admin@library.com', role: 'admin', is_disabled: false };

describe('resetUserPassword', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('sets a bcrypt hash the new password actually verifies against', async () => {
    mockAccount(ADMIN);

    await resetUserPassword({ email: 'admin@library.com', password: 'a-new-secret' });

    const update = query.mock.calls.find(([sql]) => /UPDATE users SET password_hash/.test(sql));
    const [storedHash] = update[1];
    expect(await bcrypt.compare('a-new-secret', storedHash)).toBe(true);
  });

  it('refuses an unknown address instead of creating an account', async () => {
    mockAccount(null);

    await expect(
      resetUserPassword({ email: 'typo@library.com', password: 'a-new-secret' })
    ).rejects.toThrow(/no account/i);

    // A recovery tool that silently mints a second admin is a backdoor
    expect(query.mock.calls.some(([sql]) => /INSERT INTO users/.test(sql))).toBe(false);
  });

  it('re-enables a disabled account, which is otherwise still locked out', async () => {
    mockAccount({ ...ADMIN, is_disabled: true });

    const result = await resetUserPassword({ email: 'admin@library.com', password: 'a-new-secret' });

    const update = query.mock.calls.find(([sql]) => /UPDATE users SET password_hash/.test(sql));
    expect(update[0]).toMatch(/is_disabled = FALSE/i);
    expect(result.wasDisabled).toBe(true);
  });

  it('matches the address regardless of casing or stray whitespace', async () => {
    mockAccount(ADMIN);

    await resetUserPassword({ email: '  ADMIN@Library.com \n', password: 'a-new-secret' });

    const lookup = query.mock.calls.find(([sql]) => /SELECT id, email, role/.test(sql));
    expect(lookup[1]).toEqual(['admin@library.com']);
  });

  it('rejects a password below the length the profile form also enforces', async () => {
    mockAccount(ADMIN);

    await expect(
      resetUserPassword({ email: 'admin@library.com', password: 'ab12' })
    ).rejects.toThrow(new RegExp(`${MIN_PASSWORD_LENGTH} characters`));

    expect(query).not.toHaveBeenCalled();
  });

  it('requires an address', async () => {
    await expect(resetUserPassword({ email: '', password: 'a-new-secret' })).rejects.toThrow(/email is required/i);
    expect(query).not.toHaveBeenCalled();
  });
});
