/**
 * Static assertions over init.sql (PRD 4.2.2, 4.4.2).
 *
 * initDb() replays this script on every boot, so the statements it contains have
 * to be safe to re-run against a populated database.
 */
const fs = require('fs');
const path = require('path');

const schema = fs.readFileSync(path.join(__dirname, '../src/db/init.sql'), 'utf8');
const normalized = schema.replace(/\s+/g, ' ');

describe('Foundational tables (Req 4.2.2)', () => {
  it.each([
    'users',
    'books',
    'bookshelves',
    'user_books',
    'shelf_shares',
    'system_settings',
  ])('defines the %s table idempotently', (table) => {
    expect(normalized).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'));
  });
});

describe('Settings seeding is re-run safe', () => {
  it('seeds allow_open_registration closed by default (Req 4.4.2)', () => {
    expect(normalized).toMatch(/\('allow_open_registration', 'false'\)/);
  });

  it('does not overwrite existing settings values on re-seed', () => {
    // Regression guard: ON CONFLICT DO UPDATE reset the admin's registration
    // toggle back to 'false' on every container restart (Req 4.4.3).
    const seedBlock = normalized.match(/INSERT INTO system_settings[\s\S]*?;/)[0];
    expect(seedBlock).toMatch(/ON CONFLICT \(key\) DO NOTHING/i);
    expect(seedBlock).not.toMatch(/DO UPDATE/i);
  });
});

describe('Data integrity constraints', () => {
  it('deduplicates the global catalog on isbn (Req 4.2.1)', () => {
    expect(normalized).toMatch(/isbn VARCHAR\(\d+\) UNIQUE NOT NULL/i);
  });

  it('constrains roles to the two-tier RBAC model (PRD §2)', () => {
    expect(normalized).toMatch(/CHECK \(role IN \('user', 'admin'\)\)/i);
  });

  it('constrains share scopes to view and collaborator (Req 4.2.2)', () => {
    expect(normalized).toMatch(/CHECK \(permission IN \('view', 'collaborator'\)\)/i);
  });

  it('permits only one share row per shelf/recipient pair', () => {
    expect(normalized).toMatch(/UNIQUE \(bookshelf_id, shared_with_user_id\)/i);
  });

  it('stores physical_location as unbounded free text (Req 4.2.3)', () => {
    expect(normalized).toMatch(/physical_location TEXT/i);
  });

  it('cascades shelf and mapping rows when a user is removed', () => {
    const cascades = normalized.match(/REFERENCES users\(id\) ON DELETE CASCADE/gi) || [];
    expect(cascades.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Migrations are additive', () => {
  it('adds later columns with IF NOT EXISTS so existing deployments survive upgrades', () => {
    const alters = normalized.match(/ALTER TABLE \w+ ADD COLUMN[^;]*/gi) || [];
    expect(alters.length).toBeGreaterThan(0);
    for (const alter of alters) {
      expect(alter).toMatch(/IF NOT EXISTS/i);
    }
  });

  it('never drops a column or table', () => {
    expect(normalized).not.toMatch(/DROP (TABLE|COLUMN)/i);
  });
});
