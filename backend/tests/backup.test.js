/**
 * The backup endpoints.
 *
 * Two behaviours here are load-bearing and easy to regress:
 *   1. A failed dump must not arrive as a 200 with a Content-Disposition
 *      header, or n8n will file a truncated file as a good backup.
 *   2. Restore must not reach pg_restore without the exact confirmation
 *      string, or a misfiring automation destroys the database.
 */
const request = require('supertest');

jest.mock('../src/services/pgBackup', () => ({
  dumpDatabase: jest.fn(),
  restoreDatabase: jest.fn(),
  MAX_ARCHIVE_BYTES: 256 * 1024 * 1024,
}));

const { dumpDatabase, restoreDatabase } = require('../src/services/pgBackup');
const { app, mockSql, authCookie } = require('./helpers/testApp');

// superagent does not buffer application/octet-stream responses by default,
// so a plain res.body assertion against the archive bytes would not work.
// Attaching this parser collects the raw response stream into a Buffer.
const binaryParser = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

beforeEach(() => {
  dumpDatabase.mockReset();
  restoreDatabase.mockReset();
});

describe('Admin guard on the backup endpoints', () => {
  it('rejects GET /api/admin/backup from a standard user with 403', async () => {
    mockSql([], { authenticatedAs: 'stranger' });

    const res = await request(app).get('/api/admin/backup').set('Cookie', authCookie('stranger'));

    expect(res.status).toBe(403);
    expect(dumpDatabase).not.toHaveBeenCalled();
  });

  it('rejects an anonymous GET /api/admin/backup with 401', async () => {
    mockSql([]);

    const res = await request(app).get('/api/admin/backup');

    expect(res.status).toBe(401);
    expect(dumpDatabase).not.toHaveBeenCalled();
  });

  it('rejects an anonymous POST /api/admin/restore with 401', async () => {
    mockSql([]);

    const res = await request(app)
      .post('/api/admin/restore')
      .field('confirm', 'REPLACE_ALL_DATA')
      .attach('file', Buffer.from('archive'), 'backup.dump');

    expect(res.status).toBe(401);
    expect(restoreDatabase).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/backup', () => {
  it('returns the archive as a dated attachment', async () => {
    mockSql([], { authenticatedAs: 'admin' });
    dumpDatabase.mockResolvedValue(Buffer.from('PGDMP-archive'));

    const res = await request(app)
      .get('/api/admin/backup')
      .set('Cookie', authCookie('admin'))
      .buffer()
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="bookbinder-\d{4}-\d{2}-\d{2}\.dump"/
    );
    expect(Buffer.from(res.body)).toEqual(Buffer.from('PGDMP-archive'));
  });

  it('reports a failed dump as a 500 with no attachment header', async () => {
    mockSql([], { authenticatedAs: 'admin' });
    dumpDatabase.mockRejectedValue(new Error('pg_dump: error: connection refused'));

    const res = await request(app).get('/api/admin/backup').set('Cookie', authCookie('admin'));

    // The regression guard: an automated caller branches on this status. If a
    // failure ever arrives as a 200, it files a broken file as a good backup.
    expect(res.status).toBe(500);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.body.error).toMatch(/connection refused/);
  });

  describe('Bearer-token path (n8n automation)', () => {
    const TOKEN = 'bb_validtoken';

    it('succeeds with a valid Bearer token for an admin-owned token row', async () => {
      mockSql([
        [
          /SELECT t\.id AS token_id, u\.id, u\.email, u\.role, u\.is_disabled\s+FROM api_tokens t\s+JOIN users u ON u\.id = t\.user_id\s+WHERE t\.token_hash = \$1 AND t\.revoked_at IS NULL/,
          [{ token_id: 3, id: 9, email: 'admin@library.com', role: 'admin', is_disabled: false }],
        ],
        [/UPDATE api_tokens SET last_used_at = NOW\(\) WHERE id = \$1/, []],
      ]);
      dumpDatabase.mockResolvedValue(Buffer.from('PGDMP-archive'));

      const res = await request(app)
        .get('/api/admin/backup')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.status).toBe(200);
      expect(dumpDatabase).toHaveBeenCalled();
    });

    it('rejects a Bearer token owned by a non-admin user with 403 and does not dump', async () => {
      mockSql([
        [
          /SELECT t\.id AS token_id, u\.id, u\.email, u\.role, u\.is_disabled\s+FROM api_tokens t\s+JOIN users u ON u\.id = t\.user_id\s+WHERE t\.token_hash = \$1 AND t\.revoked_at IS NULL/,
          [{ token_id: 4, id: 4, email: 'stranger@library.com', role: 'user', is_disabled: false }],
        ],
        [/UPDATE api_tokens SET last_used_at = NOW\(\) WHERE id = \$1/, []],
      ]);

      const res = await request(app)
        .get('/api/admin/backup')
        .set('Authorization', `Bearer ${TOKEN}`);

      expect(res.status).toBe(403);
      expect(dumpDatabase).not.toHaveBeenCalled();
    });
  });
});

describe('POST /api/admin/restore', () => {
  it('restores when the confirmation is exact', async () => {
    mockSql([], { authenticatedAs: 'admin' });
    restoreDatabase.mockResolvedValue();

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .field('confirm', 'REPLACE_ALL_DATA')
      .attach('file', Buffer.from('archive-bytes'), 'backup.dump');

    expect(res.status).toBe(200);
    expect(restoreDatabase).toHaveBeenCalledWith(Buffer.from('archive-bytes'));
  });

  it('refuses a request with no confirmation, before spawning anything', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .attach('file', Buffer.from('archive-bytes'), 'backup.dump');

    expect(res.status).toBe(400);
    expect(restoreDatabase).not.toHaveBeenCalled();
  });

  it.each(['replace_all_data', 'REPLACE ALL DATA', 'yes', 'true'])(
    'refuses the near-miss confirmation %p',
    async (confirm) => {
      mockSql([], { authenticatedAs: 'admin' });

      const res = await request(app)
        .post('/api/admin/restore')
        .set('Cookie', authCookie('admin'))
        .field('confirm', confirm)
        .attach('file', Buffer.from('archive-bytes'), 'backup.dump');

      expect(res.status).toBe(400);
      expect(restoreDatabase).not.toHaveBeenCalled();
    }
  );

  it('refuses a confirmed request carrying no file', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .field('confirm', 'REPLACE_ALL_DATA');

    expect(res.status).toBe(400);
    expect(restoreDatabase).not.toHaveBeenCalled();
  });

  it('surfaces the Postgres error when the archive is rejected', async () => {
    mockSql([], { authenticatedAs: 'admin' });
    restoreDatabase.mockRejectedValue(new Error('pg_restore: error: did not find magic string'));

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .field('confirm', 'REPLACE_ALL_DATA')
      .attach('file', Buffer.from('not-an-archive'), 'backup.dump');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/magic string/);
  });
});
