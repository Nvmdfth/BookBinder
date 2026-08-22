/**
 * The process boundary.
 *
 * These tests mock child_process the way testApp.js mocks the db layer: the
 * bugs that matter here are in how the command is built and how its exit code
 * is read, not in Postgres. The exit-code assertions are the regression guard
 * for the failure this design exists to prevent — a dump that fails midway and
 * is reported as a success.
 */
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');

const { dumpDatabase, restoreDatabase, MAX_ARCHIVE_BYTES } = require('../src/services/pgBackup');

/**
 * A fake child process. Tests drive it: push stdout bytes, push stderr text,
 * then close with an exit code.
 */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = jest.fn();
  return child;
}

beforeEach(() => {
  process.env.DB_HOST = 'db';
  process.env.DB_USER = 'postgres';
  process.env.DB_PASSWORD = 'secret-pw';
  process.env.DB_NAME = 'bookbinder';
  process.env.DB_PORT = '5432';
});

describe('dumpDatabase', () => {
  it('resolves the archive bytes when pg_dump exits 0', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end(Buffer.from('PGDMP-archive-bytes'));
    child.emit('close', 0);

    await expect(promise).resolves.toEqual(Buffer.from('PGDMP-archive-bytes'));
  });

  it('spawns pg_dump with an argument array and no shell', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end();
    child.emit('close', 0);
    await promise;

    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe('pg_dump');
    expect(Array.isArray(args)).toBe(true);
    expect(options.shell).toBeFalsy();
    expect(args).toEqual(expect.arrayContaining(['--format=custom', '-d', 'bookbinder']));
  });

  it('passes the password through the child env, never through argv', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end();
    child.emit('close', 0);
    await promise;

    const [, args, options] = spawn.mock.calls[0];
    expect(options.env.PGPASSWORD).toBe('secret-pw');
    expect(args.join(' ')).not.toContain('secret-pw');
  });

  it('rejects with stderr when pg_dump exits non-zero', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end(Buffer.from('half-an-archive'));
    child.stderr.end('pg_dump: error: connection failed');
    // Both PassThrough streams deliver their buffered data asynchronously (on a
    // later tick), not synchronously with .end(). Yield once so both streams
    // have finished emitting 'data'/'end' before the process "closes" — otherwise
    // this races the stderr text the assertion depends on. See task-4 correction 2.
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('close', 1);

    await expect(promise).rejects.toThrow('connection failed');
  });

  it('rejects rather than resolving a partial archive on a mid-dump failure', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end(Buffer.from('truncated'));
    child.emit('close', 2);

    // The whole point: bytes arrived, but the exit code says they are not a backup.
    await expect(promise).rejects.toThrow();
  });

  it('kills the child and rejects when the archive exceeds the cap', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    // A real MAX_ARCHIVE_BYTES + 1 buffer would allocate 256MB on every test
    // run; the cap is injected instead so the same guard logic is exercised
    // cheaply. See task-4 correction 1. dumpDatabase() with no args still
    // defaults to the real MAX_ARCHIVE_BYTES (covered by the tests above).
    const promise = dumpDatabase({ maxBytes: 64 });
    child.stdout.write(Buffer.alloc(65));

    await expect(promise).rejects.toThrow(/exceeds/i);
    expect(child.kill).toHaveBeenCalled();
  });

  it('rejects when the binary is missing', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.emit('error', Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' }));

    await expect(promise).rejects.toThrow(/ENOENT|not available/i);
  });

  it('rejects rather than crashing the process on a stdout stream error', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    // Simulates EPIPE after child.kill() tears down the pipe mid-write.
    child.stdout.emit('error', Object.assign(new Error('read EPIPE'), { code: 'EPIPE' }));

    await expect(promise).rejects.toThrow(/EPIPE/);
  });

  it('rejects rather than crashing the process on a stderr stream error', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stderr.emit('error', Object.assign(new Error('read EPIPE'), { code: 'EPIPE' }));

    await expect(promise).rejects.toThrow(/EPIPE/);
  });

  it('honours the PG* fallbacks db.js also reads, so both modules resolve the same connection', async () => {
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_NAME;
    delete process.env.DB_PASSWORD;
    process.env.PGHOST = 'pg-host';
    process.env.PGPORT = '6543';
    process.env.PGUSER = 'pg-user';
    process.env.PGDATABASE = 'pg-database';
    process.env.PGPASSWORD = 'pg-secret';

    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end();
    child.emit('close', 0);
    await promise;

    const [, args, options] = spawn.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining(['-h', 'pg-host', '-p', '6543', '-U', 'pg-user', '-d', 'pg-database'])
    );
    expect(options.env.PGPASSWORD).toBe('pg-secret');

    delete process.env.PGHOST;
    delete process.env.PGPORT;
    delete process.env.PGUSER;
    delete process.env.PGDATABASE;
    delete process.env.PGPASSWORD;
  });
});

describe('restoreDatabase', () => {
  it('restores under a single transaction so a bad archive rolls back', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('archive'));
    child.emit('close', 0);
    await promise;

    const [command, args] = spawn.mock.calls[0];
    expect(command).toBe('pg_restore');
    expect(args).toEqual(expect.arrayContaining(['--clean', '--if-exists', '--single-transaction']));
  });

  it('writes the archive to stdin rather than a temp file', async () => {
    const child = fakeChild();
    const written = [];
    child.stdin.on('data', (chunk) => written.push(chunk));
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('archive-bytes'));
    child.emit('close', 0);
    await promise;

    expect(Buffer.concat(written)).toEqual(Buffer.from('archive-bytes'));
  });

  it('rejects with stderr when pg_restore exits non-zero', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('corrupt'));
    child.stderr.end('pg_restore: error: did not find magic string in file header');
    // Same stderr-delivery race as pg_dump's equivalent test above.
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('close', 1);

    await expect(promise).rejects.toThrow(/magic string/);
  });

  it('drains stdout so a chatty child does not hang on the unread pipe buffer', async () => {
    // A fake PassThrough has no OS-level pipe buffer, so it can't reproduce the
    // real hang (writing past ~64KB with nothing reading it blocks 'close'
    // forever on a real ChildProcess). Assert the fix directly instead: stdout
    // must be put into flowing mode so a real pipe never backs up.
    const child = fakeChild();
    const resumeSpy = jest.spyOn(child.stdout, 'resume');
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('archive'));
    child.emit('close', 0);
    await promise;

    expect(resumeSpy).toHaveBeenCalled();
  });

  it('rejects rather than crashing the process on a stdout stream error', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('archive'));
    child.stdout.emit('error', Object.assign(new Error('read EPIPE'), { code: 'EPIPE' }));

    await expect(promise).rejects.toThrow(/EPIPE/);
  });

  it('rejects rather than crashing the process on a stderr stream error', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('archive'));
    child.stderr.emit('error', Object.assign(new Error('read EPIPE'), { code: 'EPIPE' }));

    await expect(promise).rejects.toThrow(/EPIPE/);
  });
});
