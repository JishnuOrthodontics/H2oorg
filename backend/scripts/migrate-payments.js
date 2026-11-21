/**
 * Idempotent Phase 1 payment schema migration (safe on live Supabase).
 * Run: npm run db:migrate-payments
 * Also invoked on server start.
 */
const { pool } = require('../config/db');

const SQL = `
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'paid';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(100);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(100);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS customer_id VARCHAR(50);

CREATE TABLE IF NOT EXISTS payment_orders (
    id VARCHAR(50) PRIMARY KEY,
    razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'created',
    payload JSONB NOT NULL,
    transaction_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_splits (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50) REFERENCES transactions(id) ON DELETE CASCADE,
    method VARCHAR(50) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    reference_id VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_rz ON payment_orders (razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_rz_order ON transactions (razorpay_order_id);
`;

async function migratePayments() {
    const client = await pool.connect();
    try {
        await client.query(SQL);
        console.log('✅ Payment schema migration OK');
    } finally {
        client.release();
    }
}

if (require.main === module) {
    require('../config/env').validateEnv();
    migratePayments()
        .then(() => pool.end())
        .catch((err) => {
            console.error('❌ Payment migration failed:', err);
            process.exit(1);
        });
}

module.exports = { migratePayments };
