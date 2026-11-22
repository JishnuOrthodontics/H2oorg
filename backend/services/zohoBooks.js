/**
 * Optional Zoho Books invoice sync — only active when ZOHO_* env is set.
 */
const db = require('../config/db');

function isZohoConfigured() {
    return Boolean(
        process.env.ZOHO_CLIENT_ID &&
        process.env.ZOHO_CLIENT_SECRET &&
        process.env.ZOHO_REFRESH_TOKEN &&
        process.env.ZOHO_ORG_ID &&
        String(process.env.ZOHO_CLIENT_ID).trim() &&
        String(process.env.ZOHO_CLIENT_SECRET).trim() &&
        String(process.env.ZOHO_REFRESH_TOKEN).trim() &&
        String(process.env.ZOHO_ORG_ID).trim()
    );
}

async function getAccessToken() {
    const params = new URLSearchParams({
        refresh_token: process.env.ZOHO_REFRESH_TOKEN.trim(),
        client_id: process.env.ZOHO_CLIENT_ID.trim(),
        client_secret: process.env.ZOHO_CLIENT_SECRET.trim(),
        grant_type: 'refresh_token'
    });
    const accountsBase = (process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in').replace(/\/$/, '');
    const res = await fetch(`${accountsBase}/oauth/v2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        throw new Error(data.error || 'Zoho token refresh failed');
    }
    return data.access_token;
}

async function syncPaidSales({ from, to }) {
    if (!isZohoConfigured()) {
        return { synced: 0, skipped: true, reason: 'Zoho not configured' };
    }

    const sales = await db.query(
        `SELECT t.*, 
            coalesce(json_agg(json_build_object(
              'name', ti.name, 'qty', ti.qty, 'price', ti.price
            )) filter (where ti.id is not null), '[]') as items
         FROM transactions t
         LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
         WHERE COALESCE(t.payment_status, 'paid') = 'paid'
           AND t.zoho_exported_at IS NULL
           AND t.date::date >= $1::date
           AND t.date::date <= $2::date
         GROUP BY t.id
         ORDER BY t.date ASC`,
        [from, to]
    );

    const token = await getAccessToken();
    const apiBase = (process.env.ZOHO_API_BASE || 'https://www.zohoapis.in/books/v3').replace(/\/$/, '');
    const orgId = process.env.ZOHO_ORG_ID.trim();
    let synced = 0;
    const errors = [];

    for (const tx of sales.rows) {
        const lineItems = (typeof tx.items === 'string' ? JSON.parse(tx.items) : tx.items || []).map((it) => ({
            name: it.name,
            rate: Number(it.price),
            quantity: Number(it.qty)
        }));
        if (!lineItems.length) {
            lineItems.push({ name: `Sale ${tx.invoice_no}`, rate: Number(tx.total), quantity: 1 });
        }

        const body = {
            customer_name: tx.customer_name || 'Walk-in Customer',
            date: (tx.date instanceof Date ? tx.date.toISOString() : String(tx.date)).slice(0, 10),
            reference_number: tx.invoice_no,
            line_items: lineItems,
            notes: `H2O POS ${tx.payment_method || ''}`
        };

        try {
            const res = await fetch(`${apiBase}/invoices?organization_id=${encodeURIComponent(orgId)}`, {
                method: 'POST',
                headers: {
                    Authorization: `Zoho-oauthtoken ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                errors.push({ invoice: tx.invoice_no, error: data.message || JSON.stringify(data).slice(0, 200) });
                continue;
            }
            await db.query('UPDATE transactions SET zoho_exported_at = NOW() WHERE id = $1', [tx.id]);
            synced += 1;
        } catch (err) {
            errors.push({ invoice: tx.invoice_no, error: err.message });
        }
    }

    await db.query(
        `INSERT INTO ledger_exports (provider, period_from, period_to, voucher_count, status, payload, error)
         VALUES ('zoho', $1, $2, $3, $4, $5, $6)`,
        [
            from,
            to,
            synced,
            errors.length ? 'partial' : 'pushed',
            JSON.stringify({ synced, attempted: sales.rows.length }),
            errors.length ? JSON.stringify(errors).slice(0, 1000) : null
        ]
    );

    return { synced, attempted: sales.rows.length, errors, skipped: false };
}

module.exports = { isZohoConfigured, syncPaidSales };
