const express = require('express');
const router = express.Router();
const { verifyWebhookSignature } = require('../config/razorpay');
const { finalizePaidOrder } = require('../services/sales');
const db = require('../config/db');

/**
 * POST /api/webhooks/razorpay
 * Requires express.raw body (Buffer) mounted in server.js.
 */
router.post('/razorpay', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));

        if (!signature || !verifyWebhookSignature(rawBody, signature)) {
            console.warn('Razorpay webhook: invalid signature');
            return res.status(400).json({ error: 'Invalid webhook signature' });
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        const eventType = event.event;

        if (eventType === 'payment.captured') {
            const payment = event.payload && event.payload.payment && event.payload.payment.entity;
            if (payment && payment.order_id && payment.id) {
                await finalizePaidOrder(payment.order_id, payment.id);
            }
        } else if (eventType === 'payment.failed') {
            const payment = event.payload && event.payload.payment && event.payload.payment.entity;
            if (payment && payment.order_id) {
                await db.query(
                    `UPDATE payment_orders SET status = 'failed' WHERE razorpay_order_id = $1 AND status = 'created'`,
                    [payment.order_id]
                );
            }
        }

        res.json({ status: 'ok' });
    } catch (err) {
        console.error('Razorpay webhook error:', err);
        // Still 200 to avoid endless retries on non-transient app bugs after logging
        res.status(200).json({ status: 'error_logged' });
    }
});

module.exports = router;
