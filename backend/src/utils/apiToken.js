const crypto = require('crypto');

/** Marks a BookBinder credential on sight in a config file or a log line. */
const TOKEN_PREFIX = 'bb_';

/**
 * Mint a token. 32 bytes from the CSPRNG, base64url so it survives being pasted
 * into a header, a query string or a YAML file without escaping.
 */
function generateToken() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash for storage and lookup.
 *
 * SHA-256, not bcrypt: the input is 256 bits of server-generated entropy, so
 * there is no dictionary to run and no work factor worth paying on every
 * request. A KDF here would slow only the legitimate caller.
 */
function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

module.exports = { generateToken, hashToken, TOKEN_PREFIX };
