/**
 * Idempotent Phase 4 ledger integration schema.
 * Run: npm run db:migrate-phase4
 */
const { pool } = require('../config/db');

const SQL = `
CREATE TABLE IF NOT EXISTS ledger_exports (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(30) NOT NULL,
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    voucher_count INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'generated',
    payload TEXT,
    remote_ref VARCHAR(200),
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_exports_provider ON ledger_exports (provider, created_at DESC);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tally_exported_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS zoho_exported_at TIMESTAMPTZ;

-- Catalog images may be URLs or compressed data URLs
ALTER TABLE perfumes ALTER COLUMN image TYPE TEXT;
`;

async function migratePhase4() {
    const client = await pool.connect();
    try {
        await client.query(SQL);
        console.log('✅ Phase 4 schema migration OK');
    } finally {
        client.release();
    }
}

if (require.main === module) {
    require('../config/env').validateEnv();
    migratePhase4()
        .then(() => pool.end())
        .catch((err) => {
            console.error('❌ Phase 4 migration failed:', err);
            process.exit(1);
        });
}

module.exports = { migratePhase4 };
