const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Access token missing' });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden: Invalid token' });
        req.user = user;
        next();
    });
}

function isManagerRole(role) {
    const r = String(role || '').toLowerCase();
    return r === 'manager' || r.includes('owner');
}

/**
 * Resolve a Manager/Owner by override PIN (bcrypt hash compare).
 */
async function assertManagerPin(pin) {
    if (!pin || !String(pin).trim()) {
        const err = new Error('Manager PIN is required');
        err.status = 403;
        throw err;
    }
    const result = await db.query(
        `SELECT id, username, name, role, override_pin_hash FROM users
         WHERE is_active = true
           AND override_pin_hash IS NOT NULL
           AND (
             LOWER(role) = 'manager'
             OR LOWER(role) LIKE '%owner%'
             OR LOWER(name) LIKE '%owner%'
           )`
    );
    const candidate = String(pin).trim();
    for (const row of result.rows) {
        const ok = await bcrypt.compare(candidate, row.override_pin_hash);
        if (ok) {
            return { id: row.id, username: row.username, name: row.name, role: row.role };
        }
    }
    const err = new Error('Invalid manager PIN');
    err.status = 403;
    throw err;
}

/**
 * If actor is not a Manager, require managerPin and return approving manager.
 * Managers return themselves (no PIN needed).
 */
async function requireManagerOverride(req) {
    if (isManagerRole(req.user && req.user.role)) {
        return { id: req.user.id, name: req.user.name, role: req.user.role, selfApproved: true };
    }
    return assertManagerPin(req.body && req.body.managerPin);
}

async function logAuditOverride({ action, actorUserId, managerUserId, detail }) {
    await db.query(
        `INSERT INTO audit_overrides (action, actor_user_id, manager_user_id, detail)
         VALUES ($1, $2, $3, $4)`,
        [action, actorUserId || null, managerUserId || null, detail ? JSON.stringify(detail) : null]
    );
}

module.exports = {
    authenticateToken,
    isManagerRole,
    assertManagerPin,
    requireManagerOverride,
    logAuditOverride,
    JWT_SECRET
};
