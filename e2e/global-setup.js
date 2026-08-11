/**
 * Builds and boots the stack once per run, from an empty database.
 *
 * Set E2E_REUSE_STACK=1 to skip the rebuild and reuse whatever is already
 * running — much faster when iterating on a spec, at the cost of carrying over
 * state written by the previous run.
 */
const { up, down, waitForHealth } = require('./lib/stack');
const { resolveBaseUrl, resolveLanHost, PORT } = require('./lib/lanHost');

module.exports = async function globalSetup() {
  const baseUrl = resolveBaseUrl();

  console.log(`\n[e2e] Host address: ${resolveLanHost()} (port ${PORT})`);

  if (process.env.E2E_REUSE_STACK === '1') {
    console.log('[e2e] E2E_REUSE_STACK=1 — reusing the running stack.');
  } else {
    console.log('[e2e] Tearing down any previous e2e stack...');
    down(PORT);

    console.log('[e2e] Building and starting the stack (first run pulls images)...');
    up(PORT);
  }

  console.log(`[e2e] Waiting for ${baseUrl}/api/health ...`);
  await waitForHealth(baseUrl);
  console.log('[e2e] Stack is healthy.\n');
};
