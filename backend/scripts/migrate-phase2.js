/**
 * Idempotent Phase 2 employee/security schema migration.
 * Run: npm run db:migrate-phase2
 * Also invoked on server start.
 */
const { pool } = require('../config/db');

const SQL = `
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voided_by INT REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE TABLE IF NOT EXISTS shift_logs (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out TIMESTAMPTZ,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_shift_logs_user_open ON shift_logs (user_id) WHERE clock_out IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_logs_user_day ON shift_logs (user_id, clock_in);

CREATE TABLE IF NOT EXISTS audit_overrides (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    actor_user_id INT REFERENCES users(id),
    manager_user_id INT REFERENCES users(id),
    detail JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transactions_employee ON transactions (employee_id);
`;

async function migratePhase2() {
    const client = await pool.connect();
    try {
        await client.query(SQL);
        console.log('✅ Phase 2 schema migration OK');
    } finally {
        client.release();
    }
}

if (require.main === module) {
    require('../config/env').validateEnv();
    migratePhase2()
        .then(() => pool.end())
        .catch((err) => {
            console.error('❌ Phase 2 migration failed:', err);
            process.exit(1);
        });
}

module.exports = { migratePhase2 };
