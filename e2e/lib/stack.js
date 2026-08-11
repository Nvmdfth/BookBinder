/**
 * Brings the containerised stack up and down for the e2e run.
 *
 * The suite runs against the real production image — Express serving the built
 * SPA under NODE_ENV=production — rather than the Vite dev server. The bugs
 * worth an e2e test here are production-path bugs: cookie attributes, SPA
 * catch-all routing, and static asset serving all behave differently under
 * `vite dev`, so testing that would test the wrong application.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const E2E_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(E2E_DIR, '..');
const PROJECT = 'bookbinder-e2e';

const COMPOSE_FILES = [
  '-f', path.join(REPO_ROOT, 'docker-compose.yml'),
  '-f', path.join(E2E_DIR, 'docker-compose.e2e.yml'),
];

function compose(args, { port, quiet = false } = {}) {
  const result = spawnSync(
    'docker',
    ['compose', '-p', PROJECT, ...COMPOSE_FILES, ...args],
    {
      cwd: REPO_ROOT,
      // PORT is what the base compose file interpolates into its published
      // port mapping; overriding the mapping in the override file would append
      // rather than replace it.
      env: { ...process.env, PORT: String(port ?? '') },
      stdio: quiet ? 'pipe' : 'inherit',
      encoding: 'utf8',
    }
  );

  return result;
}

/** Polls /api/health until the app answers or the budget runs out. */
async function waitForHealth(baseUrl, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.status === 'ok') return;
        lastError = `unexpected health payload: ${JSON.stringify(body)}`;
      } else {
        lastError = `health returned HTTP ${res.status}`;
      }
    } catch (error) {
      lastError = error.message;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(
    `Stack did not become healthy at ${baseUrl} within ${timeoutMs}ms. Last attempt: ${lastError}`
  );
}

function up(port) {
  const result = compose(['up', '-d', '--build', '--wait'], { port });
  if (result.status !== 0) {
    throw new Error(`docker compose up failed with exit code ${result.status}`);
  }
}

/** Tears the stack down including volumes, so each run starts from a clean database. */
function down(port) {
  compose(['down', '-v'], { port, quiet: true });
}

module.exports = { up, down, waitForHealth, PROJECT };
