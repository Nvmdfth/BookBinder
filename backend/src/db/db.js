const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Load env configurations
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  user: process.env.DB_USER || process.env.PGUSER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'postgres',
  database: process.env.DB_NAME || process.env.PGDATABASE || 'bookbinder',
  port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test DB Connection
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

const query = (text, params) => pool.query(text, params);

/**
 * Initializes the database schema and seeds default configuration/admin records
 */
async function initDb() {
  const client = await pool.connect();
  try {
    console.log('⚡ Initializing database schema...');
    
    // 1. Read and execute the structural schema script
    const schemaPath = path.join(__dirname, 'init.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schemaSql);
    console.log('✅ Structural schema initialized successfully.');

    // 2. Perform first-time Admin Account Seeding if users table is empty
    const userCheck = await client.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(userCheck.rows[0].count, 10);

    if (userCount === 0) {
      console.log('📝 Users database is empty. Verifying environment-based admin credentials...');
      const adminEmail = process.env.BOOKBINDER_ADMIN_EMAIL;
      const adminPass = process.env.BOOKBINDER_ADMIN_PASS;

      if (adminEmail && adminPass) {
        console.log(`👤 Seeding root administrator profile: ${adminEmail}`);
        const salt = await bcrypt.genSalt(10);
        const passHash = await bcrypt.hash(adminPass, salt);

        await client.query(
          `INSERT INTO users (email, password_hash, role) 
           VALUES ($1, $2, 'admin')`,
          [adminEmail.trim().toLowerCase(), passHash]
        );
        console.log('✅ Root administrator seeded successfully.');
      } else {
        console.warn(
          '⚠️ WARNING: No users exist, but BOOKBINDER_ADMIN_EMAIL or BOOKBINDER_ADMIN_PASS environment variables are missing! Admin profile seeding skipped.'
        );
      }
    } else {
      console.log(`ℹ️ Database contains existing users (${userCount}). Seeding skipped.`);
    }

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  initDb,
};
