/**
 * Idempotent Phase 3 CRM/reporting schema migration.
 * Run: npm run db:migrate-phase3
 */
const { pool } = require('../config/db');

const SQL = `
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS anniversary DATE;

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
    id SERIAL PRIMARY KEY,
    customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE SET NULL,
    transaction_id VARCHAR(50) REFERENCES transactions(id) ON DELETE SET NULL,
    points INT NOT NULL,
    amount_inr NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_outbox (
    id SERIAL PRIMARY KEY,
    channel VARCHAR(20) NOT NULL DEFAULT 'sms',
    to_phone TEXT NOT NULL,
    body TEXT NOT NULL,
    template VARCHAR(50),
    customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    provider_ref VARCHAR(100),
    error TEXT,
    scheduled_for TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_outbox_status ON message_outbox (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_customers_birthday ON customers (birthday);
CREATE INDEX IF NOT EXISTS idx_customers_anniversary ON customers (anniversary);

UPDATE customers SET birthday = '1992-11-25', anniversary = '2018-03-12' WHERE id = 'c1' AND birthday IS NULL;
UPDATE customers SET birthday = '1988-06-14' WHERE id = 'c2' AND birthday IS NULL;
UPDATE customers SET birthday = '1985-11-22', anniversary = '2015-01-20' WHERE id = 'c3' AND birthday IS NULL;
`;

async function migratePhase3() {
    const client = await pool.connect();
    try {
        await client.query(SQL);
        console.log('✅ Phase 3 schema migration OK');
    } finally {
        client.release();
    }
}

if (require.main === module) {
    require('../config/env').validateEnv();
    migratePhase3()
        .then(() => pool.end())
        .catch((err) => {
            console.error('❌ Phase 3 migration failed:', err);
            process.exit(1);
        });
}

module.exports = { migratePhase3 };
