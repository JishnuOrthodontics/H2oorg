/**
 * Shared sale finalization used by cash POST /transactions and Razorpay verify/webhook.
 */
const db = require('../config/db');

/**
 * @param {object} sale
 * @param {string} sale.invoiceNo
 * @param {string} [sale.customerId]
 * @param {string} sale.customerName
 * @param {string} sale.employeeName
 * @param {number} sale.subtotal
 * @param {number} sale.cgst
 * @param {number} sale.sgst
 * @param {number} sale.total
 * @param {string} sale.paymentMethod
 * @param {string} [sale.referenceId]
 * @param {string} [sale.paymentStatus]
 * @param {string} [sale.razorpayOrderId]
 * @param {string} [sale.razorpayPaymentId]
 * @param {Array<{method:string,amount:number,referenceId?:string}>} [sale.splits]
 * @param {Array<{variantId:string,name:string,qty:number,price:number}>} sale.items
 * @param {import('pg').PoolClient} [externalClient] — if provided, caller owns BEGIN/COMMIT
 */
async function finalizeSale(sale, externalClient = null) {
    const ownTx = !externalClient;
    const client = externalClient || (await db.pool.connect());

    try {
        if (ownTx) await client.query('BEGIN');

        const transactionId = 'tx_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

        await client.query(
            `INSERT INTO transactions (
                id, invoice_no, customer_name, employee_name, subtotal, cgst, sgst, total,
                payment_method, reference_id, payment_status, razorpay_order_id, razorpay_payment_id, customer_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
                transactionId,
                sale.invoiceNo,
                sale.customerName,
                sale.employeeName,
                sale.subtotal,
                sale.cgst,
                sale.sgst,
                sale.total,
                sale.paymentMethod,
                sale.referenceId || '',
                sale.paymentStatus || 'paid',
                sale.razorpayOrderId || null,
                sale.razorpayPaymentId || null,
                sale.customerId && sale.customerId !== 'walkin' ? sale.customerId : null
            ]
        );

        for (const item of sale.items) {
            let qtyRemainingToDeduct = item.qty;
            const batchesResult = await client.query(
                'SELECT id, qty_current FROM batches WHERE variant_id = $1 AND qty_current > 0 ORDER BY exp_date ASC',
                [item.variantId]
            );

            for (const batch of batchesResult.rows) {
                if (qtyRemainingToDeduct <= 0) break;
                const deduct = Math.min(qtyRemainingToDeduct, batch.qty_current);
                await client.query(
                    'UPDATE batches SET qty_current = qty_current - $1 WHERE id = $2',
                    [deduct, batch.id]
                );
                qtyRemainingToDeduct -= deduct;
            }

            await client.query(
                'INSERT INTO transaction_items (transaction_id, variant_id, name, qty, price) VALUES ($1, $2, $3, $4, $5)',
                [transactionId, item.variantId, item.name, item.qty, item.price]
            );
        }

        if (sale.customerId && sale.customerId !== 'walkin') {
            const loyaltyEarned = Math.floor(Number(sale.total) / 10);
            await client.query(
                'UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2',
                [loyaltyEarned, sale.customerId]
            );
        }

        if (Array.isArray(sale.splits)) {
            for (const split of sale.splits) {
                await client.query(
                    'INSERT INTO payment_splits (transaction_id, method, amount, reference_id) VALUES ($1, $2, $3, $4)',
                    [transactionId, split.method, split.amount, split.referenceId || '']
                );
            }
        }

        if (ownTx) await client.query('COMMIT');
        return { transactionId };
    } catch (err) {
        if (ownTx) await client.query('ROLLBACK');
        throw err;
    } finally {
        if (ownTx) client.release();
    }
}

/**
 * Finalize a pending payment_orders row after Razorpay capture (idempotent).
 */
async function finalizePaidOrder(razorpayOrderId, razorpayPaymentId) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        const orderRes = await client.query(
            'SELECT * FROM payment_orders WHERE razorpay_order_id = $1 FOR UPDATE',
            [razorpayOrderId]
        );
        if (orderRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'order_not_found' };
        }

        const order = orderRes.rows[0];
        if (order.status === 'paid' && order.transaction_id) {
            await client.query('COMMIT');
            return { ok: true, transactionId: order.transaction_id, alreadyPaid: true };
        }

        const payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
        const { transactionId } = await finalizeSale(
            {
                ...payload,
                paymentStatus: 'paid',
                razorpayOrderId,
                razorpayPaymentId,
                referenceId: razorpayPaymentId
            },
            client
        );

        await client.query(
            `UPDATE payment_orders SET status = 'paid', transaction_id = $1 WHERE razorpay_order_id = $2`,
            [transactionId, razorpayOrderId]
        );

        await client.query('COMMIT');
        return { ok: true, transactionId, alreadyPaid: false };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { finalizeSale, finalizePaidOrder };
