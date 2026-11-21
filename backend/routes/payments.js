const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/db');
const { getClient, getKeyId, isConfigured, verifyPaymentSignature } = require('../config/razorpay');
const { finalizePaidOrder } = require('../services/sales');

const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized: Access token missing' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden: Invalid token' });
        req.user = user;
        next();
    });
}

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

// POST /api/payments/create-order
router.post('/create-order', authenticateToken, async (req, res) => {
    if (!isConfigured()) {
        return res.status(503).json({ error: 'Razorpay is not configured on this server' });
    }

    const {
        invoiceNo,
        customerId,
        customerName,
        employeeName,
        subtotal,
        cgst,
        sgst,
        total,
        cashAmount = 0,
        digitalAmount,
        items
    } = req.body;

    if (!invoiceNo || !customerName || !items || !items.length) {
        return res.status(400).json({ error: 'Missing transaction details' });
    }

    const cash = round2(cashAmount || 0);
    const digital = round2(digitalAmount != null ? digitalAmount : total);
    const saleTotal = round2(total);

    if (digital <= 0) {
        return res.status(400).json({ error: 'digitalAmount must be greater than 0 for Razorpay' });
    }
    if (round2(cash + digital) !== saleTotal) {
        return res.status(400).json({
            error: `cashAmount (${cash}) + digitalAmount (${digital}) must equal total (${saleTotal})`
        });
    }

    const paymentMethod =
        cash > 0 ? 'Split: Cash+Razorpay' : 'Razorpay';

    const splits = [];
    if (cash > 0) splits.push({ method: 'cash', amount: cash, referenceId: '' });
    splits.push({ method: 'razorpay', amount: digital, referenceId: '' });

    const payload = {
        invoiceNo,
        customerId: customerId || 'walkin',
        customerName,
        employeeName: employeeName || (req.user && req.user.name) || 'Cashier',
        employeeId: req.user && req.user.id,
        subtotal,
        cgst,
        sgst,
        total: saleTotal,
        paymentMethod,
        splits,
        items
    };

    try {
        const amountPaise = Math.round(digital * 100);
        const rz = getClient();
        const order = await rz.orders.create({
            amount: amountPaise,
            currency: 'INR',
            receipt: invoiceNo.slice(0, 40),
            notes: {
                invoiceNo,
                cashAmount: String(cash),
                digitalAmount: String(digital)
            }
        });

        const localId = 'po_' + Date.now();
        await db.query(
            `INSERT INTO payment_orders (id, razorpay_order_id, amount, currency, status, payload)
             VALUES ($1, $2, $3, 'INR', 'created', $4)`,
            [localId, order.id, digital, JSON.stringify(payload)]
        );

        res.status(201).json({
            orderId: order.id,
            amount: amountPaise,
            currency: 'INR',
            keyId: getKeyId(),
            invoiceNo,
            cashAmount: cash,
            digitalAmount: digital
        });
    } catch (err) {
        console.error('create-order failed:', err);
        res.status(500).json({ error: err.message || 'Failed to create Razorpay order' });
    }
});

// POST /api/payments/verify
router.post('/verify', authenticateToken, async (req, res) => {
    if (!isConfigured()) {
        return res.status(503).json({ error: 'Razorpay is not configured on this server' });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing Razorpay verification fields' });
    }

    if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
        return res.status(400).json({ error: 'Invalid payment signature' });
    }

    try {
        const result = await finalizePaidOrder(razorpay_order_id, razorpay_payment_id);
        if (!result.ok) {
            return res.status(404).json({ error: 'Payment order not found' });
        }
        res.json({
            message: result.alreadyPaid ? 'Payment already recorded' : 'Payment verified',
            transactionId: result.transactionId
        });
    } catch (err) {
        console.error('verify failed:', err);
        res.status(500).json({ error: 'Payment verification failed' });
    }
});

module.exports = router;
