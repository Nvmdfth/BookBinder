// Deterministic environment for the test suite. Must run before any src/ module
// is required, since authMiddleware captures JWT_SECRET at import time.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_do_not_use_in_production';

// Keep expected console noise (routers log handled errors) out of the test report.
// Tests that assert on logging can spy on these directly.
global.console.log = jest.fn();
global.console.warn = jest.fn();
global.console.error = jest.fn();
