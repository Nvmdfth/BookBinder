// Deterministic environment for the test suite. Must run before any src/ module
// is required, since authMiddleware captures JWT_SECRET at import time.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_do_not_use_in_production';

// Keep expected console noise (routers log handled errors) out of the test report.
// Tests that assert on logging can spy on these directly.
global.console.log = jest.fn();
global.console.warn = jest.fn();
global.console.error = jest.fn();

// Router tests drive hundreds of requests from one address and must not trip
// the limiters. The middleware itself is exercised at a real limit in
// rateLimit.test.js, which builds its own instances rather than relying on
// these values — so raising them here disables nothing that was being tested.
process.env.RATE_LIMIT_AUTH_MAX = '1000000';
process.env.RATE_LIMIT_ADMIN_MAX = '1000000';
