const { spawn } = require('child_process');

/**
 * 256 MB. A personal library dumps to tens of kilobytes; this exists so a
 * pathological archive fails loudly instead of exhausting the container.
 */
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

/**
 * Connection arguments, read from the same env vars db.js uses.
 *
 * Passed as an array to spawn with no shell, so a database name containing a
 * quote or a semicolon is an argument and never a second command.
 */
function connectionArgs() {
  return [
    '-h', process.env.DB_HOST || 'localhost',
    '-p', String(process.env.DB_PORT || 5432),
    '-U', process.env.DB_USER || 'postgres',
    '-d', process.env.DB_NAME || 'bookbinder',
  ];
}

/** The password never appears in argv, where any process listing would show it. */
function childEnv() {
  return { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'postgres' };
}

function describeSpawnError(binary, error) {
  if (error.code === 'ENOENT') {
    return new Error(
      `${binary} is not available in this container. The image must install the ` +
      'postgresql16-client package.'
    );
  }
  return error;
}

/**
 * Produce a --format=custom archive.
 *
 * Buffers rather than streams to the response on purpose. Streaming commits the
 * HTTP headers on the first chunk, so a dump that dies halfway is delivered as a
 * truncated file carrying a 200 — an unusable backup that every automated check
 * records as a success. Holding the bytes until the exit code is known keeps the
 * process result and the HTTP status on the same side of the decision.
 *
 * `maxBytes` defaults to MAX_ARCHIVE_BYTES; it is overridable only so tests can
 * exercise the cap without allocating a real 256MB buffer.
 */
function dumpDatabase({ maxBytes = MAX_ARCHIVE_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', [...connectionArgs(), '--format=custom', '--no-owner'], {
      env: childEnv(),
    });

    const chunks = [];
    let size = 0;
    let stderr = '';
    let settled = false;
    let closeReceived = false;
    let closeCode = null;
    let stdoutEnded = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    /**
     * The process closing and stdout ending are two separate events, and Node
     * delivers buffered stdout data on a later tick than 'close'. Resolving on
     * 'close' alone risks resolving before the buffered bytes have arrived —
     * an empty or truncated archive despite a 0 exit code. Only settle once
     * both have happened.
     */
    const tryFinish = () => {
      if (settled || !closeReceived || !stdoutEnded) return;
      settled = true;
      if (closeCode === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(stderr.trim() || `pg_dump exited with code ${closeCode}.`));
      }
    };

    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill();
        fail(new Error(`Backup exceeds the ${maxBytes} byte limit.`));
        return;
      }
      chunks.push(chunk);
    });

    child.stdout.on('end', () => {
      stdoutEnded = true;
      tryFinish();
    });

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => fail(describeSpawnError('pg_dump', error)));

    child.on('close', (code) => {
      closeReceived = true;
      closeCode = code;
      tryFinish();
    });
  });
}

/**
 * Replace the database from an archive.
 *
 * --single-transaction is the load-bearing flag: without it a malformed archive
 * leaves the database half-dropped, recoverable only from another backup. With
 * it, any failure rolls back and the existing data is untouched.
 */
function restoreDatabase(archive) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pg_restore',
      [...connectionArgs(), '--clean', '--if-exists', '--single-transaction', '--no-owner'],
      { env: childEnv() }
    );

    let stderr = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => fail(describeSpawnError('pg_restore', error)));

    // EPIPE is expected if the child rejects the archive and exits early; the
    // close handler already owns that failure and reports the real stderr.
    child.stdin.on('error', () => {});
    child.stdin.end(archive);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) return resolve();
      reject(new Error(stderr.trim() || `pg_restore exited with code ${code}.`));
    });
  });
}

module.exports = { dumpDatabase, restoreDatabase, MAX_ARCHIVE_BYTES };
