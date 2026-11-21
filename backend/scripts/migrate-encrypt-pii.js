/**
 * One-shot migration: encrypt any plaintext customer phone/email rows.
 * Safe to re-run — skips values already prefixed with enc:v1:
 *
 * Usage: node scripts/migrate-encrypt-pii.js
 */
const { pool } = require('../config/db');
const { validateEnv } = require('../config/env');
const { encrypt, isEncrypted } = require('../config/crypto');

validateEnv();

async function migrate() {
    const client = await pool.connect();
    try {
        // Widen columns if still VARCHAR
        await client.query(`
            ALTER TABLE customers
                ALTER COLUMN phone TYPE TEXT,
                ALTER COLUMN email TYPE TEXT;
        `);

        const { rows } = await client.query('SELECT id, phone, email FROM customers');
        let updated = 0;

        for (const row of rows) {
            const phone = isEncrypted(row.phone) ? row.phone : encrypt(row.phone);
            const email = row.email == null || row.email === ''
                ? row.email
                : (isEncrypted(row.email) ? row.email : encrypt(row.email));

            if (phone !== row.phone || email !== row.email) {
                await client.query(
                    'UPDATE customers SET phone = $1, email = $2 WHERE id = $3',
                    [phone, email, row.id]
                );
                updated += 1;
            }
        }

        console.log(`✅ PII migration complete. Updated ${updated} of ${rows.length} customer(s).`);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
