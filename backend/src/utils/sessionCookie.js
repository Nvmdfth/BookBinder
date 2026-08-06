/**
 * Session cookie transport attributes (NFR 5.4).
 *
 * `secure` follows the connection the request actually arrived on, not the
 * build mode. Keying it off NODE_ENV stamps `Secure` on every cookie in a
 * production container, and a browser silently discards a `Secure` cookie from
 * any plain-HTTP origin that is not localhost — so hosting on a LAN address
 * logs the user in, drops the cookie, and leaves every later request with no
 * session, while localhost keeps working and hides the fault.
 *
 * Behind a TLS-terminating proxy the socket is plain HTTP, so `req.secure`
 * depends on the `trust proxy` setting in app.js honouring X-Forwarded-Proto.
 */

/** 30 days. */
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Attributes identifying the cookie. clearCookie must be given exactly these —
 * browsers keep the original cookie when they disagree and the session outlives
 * logout.
 */
function sessionCookieAttributes(req) {
  return {
    httpOnly: true,
    secure: req.secure === true,
    sameSite: 'strict',
  };
}

/** Attributes plus lifetime, for issuing a session. */
function sessionCookieOptions(req) {
  return {
    ...sessionCookieAttributes(req),
    maxAge: SESSION_MAX_AGE_MS,
  };
}

module.exports = {
  SESSION_MAX_AGE_MS,
  sessionCookieAttributes,
  sessionCookieOptions,
};
