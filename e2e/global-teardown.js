/**
 * Removes the stack and its volumes after the run.
 *
 * Set E2E_KEEP_STACK=1 to leave it up for inspection after a failure.
 */
const { down } = require('./lib/stack');
const { PORT } = require('./lib/lanHost');

module.exports = async function globalTeardown() {
  if (process.env.E2E_KEEP_STACK === '1' || process.env.E2E_REUSE_STACK === '1') {
    console.log('\n[e2e] Leaving the stack running.');
    return;
  }

  console.log('\n[e2e] Tearing down the stack...');
  down(PORT);
};
