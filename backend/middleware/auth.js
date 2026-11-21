const jwt = require('jsonwebtoken');
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
 * Resolve a Manager/Owner by PIN (any matching manager account).
 */
async function assertManagerPin(pin) {
    if (!pin || !String(pin).trim()) {
        const err = new Error('Manager PIN is required');
        err.status = 403;
        throw err;
    }
    const result = await db.query(
        `SELECT id, username, name, role FROM users
         WHERE pin = $1 AND (
           LOWER(role) = 'manager'
           OR LOWER(role) LIKE '%owner%'
           OR LOWER(name) LIKE '%owner%'
         )
         LIMIT 1`,
        [String(pin).trim()]
    );
    if (result.rows.length === 0) {
        const err = new Error('Invalid manager PIN');
        err.status = 403;
        throw err;
    }
    return result.rows[0];
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
