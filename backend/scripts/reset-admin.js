#!/usr/bin/env node
/**
 * Reset a BookBinder account password from the host.
 *
 * The way back in when nobody can authenticate — a forgotten admin password,
 * or an administrator who disabled their own account. Run it against a running
 * stack:
 *
 *   docker compose exec app npm run reset-admin
 *   docker compose exec app npm run reset-admin -- --email someone@example.com
 *
 * The password is prompted for rather than passed as an argument, so it stays
 * out of shell history, process listings and .env.
 */
const readline = require('readline');
const { pool } = require('../src/db/db');
const { resetUserPassword } = require('../src/utils/adminReset');

/** Read --email, falling back to the address the installer seeded. */
function targetEmail(argv) {
  const flagIndex = argv.findIndex((a) => a === '--email' || a === '-e');
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];

  const inline = argv.find((a) => a.startsWith('--email='));
  if (inline) return inline.slice('--email='.length);

  return process.env.BOOKBINDER_ADMIN_EMAIL || '';
}

/** Prompt without echoing, so the password never appears on screen. */
function promptHidden(questionText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) rl.output.write(chunk);
    };

    rl.question(questionText, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });

    // Only after the prompt itself has been written
    muted = true;
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const email = targetEmail(argv);

  if (!email) {
    console.error(
      '✖ No account specified. Pass --email you@example.com, or set BOOKBINDER_ADMIN_EMAIL.'
    );
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(
      '✖ This command prompts for the new password and needs an interactive terminal.\n' +
      '  Run it with a TTY, e.g. docker compose exec app npm run reset-admin'
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Resetting the password for: ${email}`);

  const password = await promptHidden('New password: ');
  const confirmation = await promptHidden('Confirm password: ');

  if (password !== confirmation) {
    console.error('✖ Those passwords do not match. Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  const account = await resetUserPassword({ email, password });

  console.log(`✔ Password updated for ${account.email} (${account.role}).`);
  if (account.wasDisabled) {
    console.log('  The account was disabled and has been re-enabled.');
  }
  console.log('  Existing sessions for this account are now signed out.');
}

main()
  .catch((err) => {
    console.error(`✖ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
