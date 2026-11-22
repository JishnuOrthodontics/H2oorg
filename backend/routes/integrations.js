const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const {
    authenticateToken,
    isManagerRole,
    JWT_SECRET
} = require('../middleware/auth');
const {
    exportTallyPeriod,
    defaultYesterdayRange,
    defaultTodayRange
} = require('../services/tallyExport');
const { syncPaidSales, isZohoConfigured } = require('../services/zohoBooks');
const db = require('../config/db');

function authorizeCronOrManager(req, res) {
    const cronSecret = process.env.CRON_SECRET;
    const headerSecret = req.headers['x-cron-secret'];
    if (cronSecret && headerSecret && headerSecret === cronSecret) {
        return true;
    }
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        res.status(401).json({ error: 'Unauthorized: Manager JWT or X-Cron-Secret required' });
        return false;
    }
    try {
        const user = jwt.verify(token, JWT_SECRET);
        if (!isManagerRole(user.role)) {
            res.status(403).json({ error: 'Manager role or CRON_SECRET required' });
            return false;
        }
        req.user = user;
        return true;
    } catch (_) {
        res.status(403).json({ error: 'Forbidden: Invalid token' });
        return false;
    }
}

function parseRange(req) {
    const q = req.query || {};
    const b = req.body || {};
    let from = b.from || q.from;
    let to = b.to || q.to;
    if (!from || !to) {
        const def = (b.period || q.period) === 'today' ? defaultTodayRange() : defaultYesterdayRange();
        from = from || def.from;
        to = to || def.to;
    }
    return { from, to };
}

// POST /api/integrations/tally/export — generate (+ optional push) Tally XML for a date range
router.post('/tally/export', async (req, res) => {
    if (!authorizeCronOrManager(req, res)) return;
    try {
        const { from, to } = parseRange(req);
        const unsyncedOnly = Boolean(req.body && req.body.unsyncedOnly);
        const pushRemote = req.body && req.body.pushRemote === false ? false : true;
        const result = await exportTallyPeriod({ from, to, unsyncedOnly, pushRemote, markExported: true });
        res.json({
            message: result.status === 'pushed' ? 'Tally XML pushed' : 'Tally XML generated',
            exportId: result.exportId,
            status: result.status,
            voucherCount: result.voucherCount,
            from: result.from,
            to: result.to,
            tallyConfigured: result.tallyConfigured,
            error: result.error || undefined,
            xml: result.xml
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Tally export failed' });
    }
});

// GET /api/integrations/tally/export — download XML for Managers (today by default)
router.get('/tally/export', authenticateToken, async (req, res) => {
    if (!isManagerRole(req.user.role)) {
        return res.status(403).json({ error: 'Manager only' });
    }
    try {
        const { from, to } = parseRange(req);
        const result = await exportTallyPeriod({
            from,
            to,
            unsyncedOnly: false,
            pushRemote: false,
            markExported: false
        });
        res.type('application/xml').send(result.xml);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Tally download failed' });
    }
});

// POST /api/integrations/zoho/sync
router.post('/zoho/sync', async (req, res) => {
    if (!authorizeCronOrManager(req, res)) return;
    try {
        if (!isZohoConfigured()) {
            return res.status(503).json({
                error: 'Zoho Books is not configured (set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID)'
            });
        }
        const { from, to } = parseRange(req);
        const result = await syncPaidSales({ from, to });
        res.json({ message: 'Zoho sync finished', ...result, from, to });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Zoho sync failed' });
    }
});

// GET /api/integrations/exports — recent ledger export log
router.get('/exports', authenticateToken, async (req, res) => {
    if (!isManagerRole(req.user.role)) {
        return res.status(403).json({ error: 'Manager only' });
    }
    try {
        const result = await db.query(
            `SELECT id, provider, period_from, period_to, voucher_count, status, remote_ref, error, created_at
             FROM ledger_exports
             ORDER BY created_at DESC
             LIMIT 30`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load export log' });
    }
});

module.exports = router;
