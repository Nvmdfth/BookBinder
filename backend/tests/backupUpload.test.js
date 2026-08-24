/**
 * multer errors on POST /api/admin/restore.
 *
 * multer's own errors carry no `.status`, so the app's global handler would
 * report both of these as a bare 500. backupRouter.js handles them directly:
 * over the size cap is 413, and a file sent under the wrong field name is 400
 * naming the expected field — the case an automated client hits if its
 * binary property isn't named "file".
 *
 * MAX_ARCHIVE_BYTES is mocked small here so the size-cap case doesn't have to
 * allocate a quarter-gigabyte buffer just to exercise it.
 */
const request = require('supertest');

jest.mock('../src/services/pgBackup', () => ({
  dumpDatabase: jest.fn(),
  restoreDatabase: jest.fn(),
  MAX_ARCHIVE_BYTES: 1024,
}));

const { restoreDatabase } = require('../src/services/pgBackup');
const { app, mockSql, authCookie } = require('./helpers/testApp');

beforeEach(() => restoreDatabase.mockReset());

describe('multer errors on POST /api/admin/restore', () => {
  it('returns 413 when the archive exceeds the size cap', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .field('confirm', 'REPLACE_ALL_DATA')
      .attach('file', Buffer.alloc(2048), 'backup.dump');

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
    expect(restoreDatabase).not.toHaveBeenCalled();
  });

  it('returns 400 naming the expected field when the file is sent under the wrong name', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .field('confirm', 'REPLACE_ALL_DATA')
      .attach('archive', Buffer.from('bytes'), 'backup.dump');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/field/i);
    expect(res.body.error).toMatch(/"file"/);
    expect(restoreDatabase).not.toHaveBeenCalled();
  });
});
