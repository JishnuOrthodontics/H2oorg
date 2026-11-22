/**
 * Void a paid transaction: restore stock, reverse loyalty, mark voided.
 */
const db = require('../config/db');

async function voidSale(transactionId, { voidedBy, reason }) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const txRes = await client.query(
            'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
            [transactionId]
        );
        if (txRes.rows.length === 0) {
            const err = new Error('Transaction not found');
            err.status = 404;
            throw err;
        }

        const tx = txRes.rows[0];
        if (tx.payment_status === 'voided' || tx.voided_at) {
            await client.query('COMMIT');
            return { ok: true, alreadyVoided: true, transactionId };
        }
        if (tx.payment_status && tx.payment_status !== 'paid') {
            const err = new Error('Only paid transactions can be voided');
            err.status = 400;
            throw err;
        }

        const itemsRes = await client.query(
            'SELECT variant_id, qty FROM transaction_items WHERE transaction_id = $1',
            [transactionId]
        );

        for (const item of itemsRes.rows) {
            if (!item.variant_id) continue;
            // Restore to the soonest-expiring batch (or create void restock batch)
            const batchRes = await client.query(
                `SELECT id FROM batches WHERE variant_id = $1 ORDER BY exp_date ASC LIMIT 1`,
                [item.variant_id]
            );
            if (batchRes.rows.length > 0) {
                await client.query(
                    'UPDATE batches SET qty_current = qty_current + $1 WHERE id = $2',
                    [item.qty, batchRes.rows[0].id]
                );
            } else {
                const variantMeta = await client.query(
                    'SELECT perfume_id FROM variants WHERE id = $1',
                    [item.variant_id]
                );
                if (variantMeta.rows.length) {
                    const batchId = 'b_void_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                    await client.query(
                        `INSERT INTO batches (id, perfume_id, variant_id, batch_no, mfg_date, exp_date, cost, qty_current, qty_initial)
                         VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + INTERVAL '5 years', 0, $5, $5)`,
                        [batchId, variantMeta.rows[0].perfume_id, item.variant_id, 'VOID-RESTORE', item.qty]
                    );
                }
            }
        }

        if (tx.customer_id) {
            // Reverse accrual on net total
            const loyaltyEarned = Math.floor(Number(tx.total) / 10);
            if (loyaltyEarned > 0) {
                await client.query(
                    'UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $1) WHERE id = $2',
                    [loyaltyEarned, tx.customer_id]
                );
            }
            // Restore redeemed points
            const redemptions = await client.query(
                'SELECT points FROM loyalty_redemptions WHERE transaction_id = $1',
                [transactionId]
            );
            for (const row of redemptions.rows) {
                await client.query(
                    'UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2',
                    [row.points, tx.customer_id]
                );
            }
        }

        await client.query(
            `UPDATE transactions
             SET payment_status = 'voided', voided_at = NOW(), voided_by = $1, void_reason = $2
             WHERE id = $3`,
            [voidedBy || null, reason || '', transactionId]
        );

        await client.query('COMMIT');
        return { ok: true, alreadyVoided: false, transactionId };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { voidSale };
