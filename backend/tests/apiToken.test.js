/**
 * Token minting is the one place a credential exists in plaintext. These
 * assertions pin the two properties the rest of the system assumes: enough
 * entropy that the hash need not be a KDF, and a stable hash so lookup by
 * hash is a single indexed equality.
 */
const { generateToken, hashToken, TOKEN_PREFIX } = require('../src/utils/apiToken');

describe('generateToken', () => {
  it('prefixes tokens so they are recognisable in a config file', () => {
    expect(generateToken().startsWith(TOKEN_PREFIX)).toBe(true);
  });

  it('carries 32 bytes of entropy as base64url', () => {
    const body = generateToken().slice(TOKEN_PREFIX.length);
    expect(body).toHaveLength(43);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', () => {
    const many = new Set(Array.from({ length: 500 }, generateToken));
    expect(many.size).toBe(500);
  });
});

describe('hashToken', () => {
  it('produces a 64-char hex digest that fits the token_hash column', () => {
    const hash = hashToken('bb_example');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic, so lookup by hash is a single indexed equality', () => {
    expect(hashToken('bb_example')).toBe(hashToken('bb_example'));
  });

  it('separates distinct tokens', () => {
    expect(hashToken('bb_one')).not.toBe(hashToken('bb_two'));
  });
});
