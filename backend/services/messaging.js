/**
 * SMS outbox — MSG91 preferred, then Twilio; otherwise status=logged (no fake success).
 *
 * MSG91 (India): needs Authkey + Sender ID. For DLT, also set MSG91_TEMPLATE_ID (Flow)
 * and put the free-text body into MSG91_BODY_VAR (default VAR1).
 */
const db = require('../config/db');

function envTrim(key) {
    const v = process.env[key];
    return v && String(v).trim() ? String(v).trim() : '';
}

function msg91AuthKey() {
    return envTrim('MSG91_AUTH_KEY') || envTrim('MSG91_AUTHKEY');
}

function isMsg91Configured() {
    return Boolean(msg91AuthKey() && envTrim('MSG91_SENDER_ID'));
}

function isTwilioConfigured() {
    return Boolean(
        envTrim('TWILIO_ACCOUNT_SID') &&
        envTrim('TWILIO_AUTH_TOKEN') &&
        envTrim('TWILIO_FROM')
    );
}

function isSmsConfigured() {
    return isMsg91Configured() || isTwilioConfigured();
}

function smsProvider() {
    if (isMsg91Configured()) return 'msg91';
    if (isTwilioConfigured()) return 'twilio';
    return 'none';
}

/** Normalize to digits with country code (default 91 for 10-digit IN mobiles). */
function normalizeMobile(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = `91${digits}`;
    if (digits.startsWith('0') && digits.length === 11) digits = `91${digits.slice(1)}`;
    return digits;
}

async function enqueueSms({ toPhone, body, template, customerId, scheduledFor }) {
    const status = isSmsConfigured() ? 'queued' : 'logged';
    const result = await db.query(
        `INSERT INTO message_outbox (channel, to_phone, body, template, customer_id, status, scheduled_for)
         VALUES ('sms', $1, $2, $3, $4, $5, coalesce($6::timestamptz, NOW()))
         RETURNING *`,
        [toPhone, body, template || null, customerId || null, status, scheduledFor || null]
    );
    const row = result.rows[0];
    if (status === 'queued') {
        try {
            await dispatchSms(row);
        } catch (err) {
            console.error('SMS send failed:', err.message);
        }
    }
    return row;
}

async function dispatchSms(row) {
    if (isMsg91Configured()) return sendMsg91Sms(row);
    if (isTwilioConfigured()) return sendTwilioSms(row);
    return row;
}

async function sendMsg91Sms(row) {
    const authkey = msg91AuthKey();
    const sender = envTrim('MSG91_SENDER_ID');
    const templateId = envTrim('MSG91_TEMPLATE_ID') || envTrim('MSG91_FLOW_ID');
    const bodyVar = envTrim('MSG91_BODY_VAR') || 'VAR1';
    const mobiles = normalizeMobile(row.to_phone);

    if (!mobiles || mobiles.length < 10) {
        await db.query(
            `UPDATE message_outbox SET status = 'failed', error = $1 WHERE id = $2`,
            ['Invalid mobile number', row.id]
        );
        throw new Error('Invalid mobile number');
    }

    let res;
    let data = {};

    if (templateId) {
        const recipient = { mobiles };
        recipient[bodyVar] = String(row.body || '').slice(0, 500);
        res = await fetch('https://control.msg91.com/api/v5/flow', {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authkey
            },
            body: JSON.stringify({
                template_id: templateId,
                sender,
                short_url: '0',
                recipients: [recipient]
            })
        });
        data = await res.json().catch(() => ({}));
    } else {
        // Legacy sendhttp — may be rejected in India without DLT template approval
        const params = new URLSearchParams({
            authkey,
            mobiles,
            message: String(row.body || '').slice(0, 1000),
            sender,
            route: '4',
            country: '91'
        });
        res = await fetch(`https://api.msg91.com/api/sendhttp.php?${params.toString()}`, {
            method: 'GET'
        });
        const text = await res.text().catch(() => '');
        try {
            data = JSON.parse(text);
        } catch (_) {
            data = { message: text, type: /^\d+$/.test(String(text).trim()) ? 'success' : 'error' };
        }
    }

    const failed =
        !res.ok ||
        data.type === 'error' ||
        data.code === '201' ||
        (typeof data.message === 'string' && /invalid|fail|error|missing/i.test(data.message) && data.type !== 'success');

    if (failed && data.type !== 'success' && !/^\d+$/.test(String(data.message || '').trim())) {
        const errMsg = data.message || data.msg || JSON.stringify(data).slice(0, 400) || `HTTP ${res.status}`;
        await db.query(
            `UPDATE message_outbox SET status = 'failed', error = $1 WHERE id = $2`,
            [String(errMsg).slice(0, 500), row.id]
        );
        throw new Error(String(errMsg));
    }

    const ref = String(data.message || data.request_id || data.type || 'msg91').slice(0, 100);
    await db.query(
        `UPDATE message_outbox SET status = 'sent', provider_ref = $1, sent_at = NOW(), error = NULL WHERE id = $2`,
        [ref, row.id]
    );
    return { ...row, status: 'sent', provider_ref: ref };
}

async function sendTwilioSms(row) {
    if (!isTwilioConfigured()) return row;
    const sid = envTrim('TWILIO_ACCOUNT_SID');
    const token = envTrim('TWILIO_AUTH_TOKEN');
    const from = envTrim('TWILIO_FROM');
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
        throw new Error(data.message || 'Twilio send failed');
    }
    await db.query(
        `UPDATE message_outbox SET status = 'sent', provider_ref = $1, sent_at = NOW(), error = NULL WHERE id = $2`,
        [data.sid || null, row.id]
    );
    return { ...row, status: 'sent', provider_ref: data.sid };
}

async function processOutbox(limit = 20) {
    if (!isSmsConfigured()) {
        return { processed: 0, note: 'No SMS provider configured (MSG91 or Twilio)' };
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
            await dispatchSms(row);
            processed += 1;
        } catch (_) {
            /* already marked failed */
        }
    }
    return { processed };
}

module.exports = {
    isTwilioConfigured,
    isMsg91Configured,
    isSmsConfigured,
    smsProvider,
    enqueueSms,
    processOutbox,
    sendTwilioSms,
    sendMsg91Sms
};
