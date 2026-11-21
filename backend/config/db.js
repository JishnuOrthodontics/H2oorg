const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || '';
const isLocal =
  connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
// Supabase and most hosted Postgres require SSL
const isSupabase = connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com');

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // Supabase transaction pooler (port 6543) — avoid prepared-statement issues
  ...(isSupabase && connectionString.includes(':6543')
    ? { max: 5 }
    : {})
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
