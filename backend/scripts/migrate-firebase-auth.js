/**
 * Idempotent Firebase staff-auth schema migration.
 * Run: npm run db:migrate-firebase-auth
 * Also runs on server boot.
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS override_pin_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_firebase_uid_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_firebase_uid_key UNIQUE (firebase_uid);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
`;

async function backfillStaffAuth(client) {
    const emailJishnu = (process.env.STAFF_EMAIL_JISHNU || 'h2organization2025@gmail.com').trim().toLowerCase();
    const emailSiddharth = (process.env.STAFF_EMAIL_SIDDHARTH || '').trim().toLowerCase();
    const overridePin = String(process.env.MANAGER_OVERRIDE_PIN || '9999').trim();

    if (emailJishnu) {
        await client.query(
            `UPDATE users SET email = $1
             WHERE LOWER(username) = 'jishnu' AND (email IS NULL OR email = '')`,
            [emailJishnu]
        );
    }
    if (emailSiddharth) {
        await client.query(
            `UPDATE users SET email = $1
             WHERE LOWER(username) = 'siddharth' AND (email IS NULL OR email = '')`,
            [emailSiddharth]
        );
    }

    // Hash override PIN for manager rows that still lack override_pin_hash
    const managers = await client.query(
        `SELECT id, pin FROM users
         WHERE override_pin_hash IS NULL
           AND (
             LOWER(role) = 'manager'
             OR LOWER(role) LIKE '%owner%'
             OR LOWER(name) LIKE '%owner%'
           )`
    );
    const hash = await bcrypt.hash(overridePin, 12);
    for (const row of managers.rows) {
        // Prefer env override PIN; fall back to legacy plaintext pin if present
        const pinToHash = overridePin || (row.pin ? String(row.pin) : null);
        if (!pinToHash) continue;
        const rowHash = pinToHash === overridePin ? hash : await bcrypt.hash(pinToHash, 12);
        await client.query(`UPDATE users SET override_pin_hash = $1 WHERE id = $2`, [rowHash, row.id]);
    }
}

async function migrateFirebaseAuth() {
    const client = await pool.connect();
    try {
        await client.query(SQL);
        await backfillStaffAuth(client);
        console.log('✅ Firebase staff-auth schema migration OK');
    } finally {
        client.release();
    }
}

if (require.main === module) {
    require('../config/env').validateEnv();
    migrateFirebaseAuth()
        .then(() => pool.end())
        .catch((err) => {
            console.error('❌ Firebase auth migration failed:', err);
            process.exit(1);
        });
}

module.exports = { migrateFirebaseAuth };
