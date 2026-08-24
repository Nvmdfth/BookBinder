/**
 * Transaction helper coverage.
 *
 * The catalog and the shelf mapping are written by two separate statements. On
 * the pool they autocommit independently, so a failure between them leaves a
 * books row that no user_books row references — an orphan the admin has to
 * prune by hand. This helper is what binds the pair into one unit.
 */
const { withTransaction } = require('../src/db/transaction');

/** A pool double recording every statement its client is asked to run. */
function fakePool({ failOn = null } = {}) {
  const statements = [];
  const client = {
    query: jest.fn(async (text, params) => {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      statements.push(sql);
      if (failOn && failOn.test(sql)) throw new Error('statement failed');
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  return { pool: { connect: jest.fn(async () => client) }, client, statements };
}

describe('withTransaction', () => {
  it('wraps the callback’s statements in BEGIN and COMMIT', async () => {
    const { pool, statements } = fakePool();

    await withTransaction(pool, async (tx) => {
      await tx('INSERT INTO books (isbn) VALUES ($1)', ['x']);
      await tx('INSERT INTO user_books (book_id) VALUES ($1)', [1]);
    });

    expect(statements).toEqual([
      'BEGIN',
      'INSERT INTO books (isbn) VALUES ($1)',
      'INSERT INTO user_books (book_id) VALUES ($1)',
      'COMMIT',
    ]);
  });

  it('returns whatever the callback returned', async () => {
    const { pool } = fakePool();

    const result = await withTransaction(pool, async () => ({ status: 201, id: 7 }));

    expect(result).toEqual({ status: 201, id: 7 });
  });

  it('rolls back instead of committing when the callback throws', async () => {
    const { pool, statements } = fakePool();

    await expect(
      withTransaction(pool, async (tx) => {
        await tx('INSERT INTO books (isbn) VALUES ($1)', ['x']);
        throw new Error('mapping insert failed');
      })
    ).rejects.toThrow('mapping insert failed');

    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it('rolls back when a statement inside the transaction fails', async () => {
    const { pool, statements } = fakePool({ failOn: /INSERT INTO user_books/ });

    await expect(
      withTransaction(pool, async (tx) => {
        await tx('INSERT INTO books (isbn) VALUES ($1)', ['x']);
        await tx('INSERT INTO user_books (book_id) VALUES ($1)', [1]);
      })
    ).rejects.toThrow('statement failed');

    // The catalog insert is undone rather than left behind as an orphan
    expect(statements).toEqual([
      'BEGIN',
      'INSERT INTO books (isbn) VALUES ($1)',
      'INSERT INTO user_books (book_id) VALUES ($1)',
      'ROLLBACK',
    ]);
  });

  it('releases the client after a successful transaction', async () => {
    const { pool, client } = fakePool();

    await withTransaction(pool, async () => 'ok');

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client after a rolled back transaction', async () => {
    const { pool, client } = fakePool();

    await expect(withTransaction(pool, async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('surfaces the original failure even if the rollback itself fails', async () => {
    const { pool } = fakePool({ failOn: /ROLLBACK/ });

    await expect(
      withTransaction(pool, async () => { throw new Error('original cause'); })
    ).rejects.toThrow('original cause');
  });
});
