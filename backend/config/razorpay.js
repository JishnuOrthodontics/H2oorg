/**
 * Razorpay client — optional until keys are set (payment routes return 503).
 */
const Razorpay = require('razorpay');
const crypto = require('crypto');

function isConfigured() {
    return Boolean(
        process.env.RAZORPAY_KEY_ID &&
        process.env.RAZORPAY_KEY_SECRET &&
        String(process.env.RAZORPAY_KEY_ID).trim() &&
        String(process.env.RAZORPAY_KEY_SECRET).trim()
    );
}

function getClient() {
    if (!isConfigured()) {
        const err = new Error('Razorpay is not configured (set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)');
        err.code = 'RAZORPAY_NOT_CONFIGURED';
        throw err;
    }
    return new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID.trim(),
        key_secret: process.env.RAZORPAY_KEY_SECRET.trim()
    });
}

function getKeyId() {
    return process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID.trim() : null;
}

function verifyPaymentSignature(orderId, paymentId, signature) {
    const body = `${orderId}|${paymentId}`;
    const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET.trim())
        .update(body)
        .digest('hex');
    return expected === signature;
}

function verifyWebhookSignature(rawBody, signature) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !String(secret).trim()) {
        return false;
    }
    const expected = crypto
        .createHmac('sha256', secret.trim())
        .update(rawBody)
        .digest('hex');
    return expected === signature;
}

module.exports = {
    isConfigured,
    getClient,
    getKeyId,
    verifyPaymentSignature,
    verifyWebhookSignature
};
