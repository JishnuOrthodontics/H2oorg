/**
 * SMS outbox — Twilio when configured; otherwise status=logged (no fake success).
 */
const db = require('../config/db');

function isTwilioConfigured() {
    return Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM &&
        String(process.env.TWILIO_ACCOUNT_SID).trim() &&
        String(process.env.TWILIO_AUTH_TOKEN).trim() &&
        String(process.env.TWILIO_FROM).trim()
    );
}

async function enqueueSms({ toPhone, body, template, customerId, scheduledFor }) {
    const status = isTwilioConfigured() ? 'queued' : 'logged';
    const result = await db.query(
        `INSERT INTO message_outbox (channel, to_phone, body, template, customer_id, status, scheduled_for)
         VALUES ('sms', $1, $2, $3, $4, $5, coalesce($6::timestamptz, NOW()))
         RETURNING *`,
        [toPhone, body, template || null, customerId || null, status, scheduledFor || null]
    );
    const row = result.rows[0];
    if (status === 'queued') {
        try {
            await sendTwilioSms(row);
        } catch (err) {
            console.error('Twilio send failed:', err.message);
        }
    }
    return row;
}

async function sendTwilioSms(row) {
    if (!isTwilioConfigured()) return row;
    const sid = process.env.TWILIO_ACCOUNT_SID.trim();
    const token = process.env.TWILIO_AUTH_TOKEN.trim();
    const from = process.env.TWILIO_FROM.trim();
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const params = new URLSearchParams({
        To: row.to_phone,
        From: from,
        Body: row.body
    });
    const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        await db.query(
            `UPDATE message_outbox SET status = 'failed', error = $1 WHERE id = $2`,
            [data.message || JSON.stringify(data), row.id]
        );
        const err = new Error(data.message || 'Twilio send failed');
        throw err;
    }
    await db.query(
        `UPDATE message_outbox SET status = 'sent', provider_ref = $1, sent_at = NOW(), error = NULL WHERE id = $2`,
        [data.sid || null, row.id]
    );
    return { ...row, status: 'sent', provider_ref: data.sid };
}

async function processOutbox(limit = 20) {
    if (!isTwilioConfigured()) {
        return { processed: 0, note: 'Twilio not configured' };
    }
    const pending = await db.query(
        `SELECT * FROM message_outbox
         WHERE status = 'queued' AND scheduled_for <= NOW()
         ORDER BY id ASC LIMIT $1`,
        [limit]
    );
    let processed = 0;
    for (const row of pending.rows) {
        try {
            await sendTwilioSms(row);
            processed += 1;
        } catch (_) {
            /* already marked failed */
        }
    }
    return { processed };
}

module.exports = { isTwilioConfigured, enqueueSms, processOutbox, sendTwilioSms };
