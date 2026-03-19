/**
 * db/database.js â€” PostgreSQL connection + table setup
 *
 * Uses the "pg" library to connect to PostgreSQL.
 * Railway provides a DATABASE_URL environment variable automatically.
 */

const { Pool } = require("pg");

// Create a connection pool using the DATABASE_URL from Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Required for Railway PostgreSQL (SSL in production)
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

/**
 * Run a query against the database.
 * @param {string} text - SQL query string (use $1, $2, ... for params)
 * @param {Array}  params - array of parameter values
 */
async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release(); // Always release connection back to pool
  }
}

/**
 * Create all tables if they don't exist.
 * Called once on server startup.
 */
async function initTables() {
  // â”€â”€ USERS TABLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Stores Google users who have logged in
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      google_id   VARCHAR(255) UNIQUE NOT NULL,  -- Google's unique user ID
      name        VARCHAR(255) NOT NULL,
      email       VARCHAR(255) UNIQUE NOT NULL,
      picture     TEXT,                           -- Profile photo URL
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    );
  `);

  // â”€â”€ SUBSCRIPTIONS TABLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Stores active and past subscriptions
  await query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      plan_key        VARCHAR(50) NOT NULL,      -- "monthly","quarterly","halfyearly","yearly"
      plan_label      VARCHAR(100) NOT NULL,
      amount_paid     INTEGER NOT NULL,          -- in rupees
      duration_days   INTEGER NOT NULL,          -- total access days (including bonuses)
      starts_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at      TIMESTAMP NOT NULL,        -- starts_at + duration_days
      status          VARCHAR(20) DEFAULT 'active',   -- "active","expired","cancelled"
      created_at      TIMESTAMP DEFAULT NOW()
    );
  `);

  // â”€â”€ PAYMENTS TABLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Stores every payment transaction for audit trail
  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id                   SERIAL PRIMARY KEY,
      user_id              INTEGER REFERENCES users(id) ON DELETE SET NULL,
      subscription_id      INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
      razorpay_order_id    VARCHAR(255) UNIQUE NOT NULL,
      razorpay_payment_id  VARCHAR(255),
      razorpay_signature   TEXT,
      plan_key             VARCHAR(50) NOT NULL,
      amount               INTEGER NOT NULL,     -- in rupees
      currency             VARCHAR(10) DEFAULT 'INR',
      status               VARCHAR(20) DEFAULT 'created',  -- "created","paid","failed"
      created_at           TIMESTAMP DEFAULT NOW(),
      verified_at          TIMESTAMP
    );
  `);

  console.log("   â†’ users, subscriptions, payments tables ready");
}

module.exports = { query, initTables };
