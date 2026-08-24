/**
 * Run a set of statements as one unit of work.
 *
 * Ingesting a book writes two rows: the shared catalog entry in `books` and the
 * ownership mapping in `user_books`. Issued through the pool they land in two
 * separate autocommit transactions, so anything that interrupts the pair — the
 * mapping insert throwing, the client disconnecting, the container restarting —
 * leaves a committed catalog row that nothing references. The FK cascades
 * books → user_books, never the reverse, so nothing cleans that row up and it
 * accumulates until an admin runs the orphan prune.
 *
 * The callback receives an `exec` with the same (text, params) signature as the
 * pooled `query`, bound to the single client holding the transaction. Anything
 * run through it commits together or not at all; a throw rolls the whole unit
 * back and propagates, so callers still see the original failure.
 *
 * Keep external I/O outside the callback. The client is checked out for the
 * duration, and holding one across a 12-second metadata lookup would exhaust
 * the pool under concurrent scans.
 */
async function withTransaction(pool, fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // A failed rollback must not mask what actually went wrong: the connection
    // is already broken in that case, and releasing it discards it either way.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Rollback failed after transaction error:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
