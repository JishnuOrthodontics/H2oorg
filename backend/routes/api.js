const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');
const { finalizeSale } = require('../services/sales');
const { voidSale } = require('../services/voidSale');
const { loyaltyTier } = require('../services/loyalty');
const { enqueueSms, processOutbox, isTwilioConfigured, isMsg91Configured, smsProvider } = require('../services/messaging');
const { verifyIdToken, isFirebaseConfigured } = require('../config/firebase');
const {
    authenticateToken,
    isManagerRole,
    assertManagerPin,
    requireManagerOverride,
    logAuditOverride,
    JWT_SECRET
} = require('../middleware/auth');

function requireOwner(req, res) {
    if (!isManagerRole(req.user && req.user.role)) {
        res.status(403).json({ error: 'Owner / Manager only — staff accounts are managed by the owner' });
        return false;
    }
    return true;
}

function normalizeStaffEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function slugUsername(nameOrEmail) {
    const base = String(nameOrEmail || 'staff')
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 40);
    return base || 'staff';
}

const COMMISSION_RATE = 0.05;

const firebaseLoginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again in a minute.' }
});

function formatCustomer(r) {
    let phone = r.phone;
    let email = r.email;
    try {
        phone = decrypt(r.phone);
        email = r.email ? decrypt(r.email) : null;
    } catch (decErr) {
        console.error(`Failed to decrypt PII for customer ${r.id}:`, decErr.message);
    }
    return {
        id: r.id,
        name: r.name,
        phone,
        email: email || 'N/A',
        loyaltyPoints: r.loyalty_points,
        loyaltyTier: loyaltyTier(r.loyalty_points),
        birthday: r.birthday,
        anniversary: r.anniversary,
        scentProfile: {
            preferred: r.preferred_notes || [],
            disliked: r.disliked_notes || [],
            skinType: r.skin_type,
            remarks: r.remarks || 'No specific sensitivities.'
        }
    };
}

function occasionWithinDays(dateVal, days) {
    if (!dateVal) return false;
    const d = new Date(dateVal);
    const now = new Date();
    for (let i = 0; i <= days; i++) {
        const check = new Date(now);
        check.setDate(now.getDate() + i);
        if (d.getUTCMonth() === check.getMonth() && d.getUTCDate() === check.getDate()) {
            return true;
        }
    }
    return false;
}

// --- STAFF LOGIN (PIN deprecated — use Google / Firebase) ---
router.post('/auth/login', (_req, res) => {
    res.status(410).json({
        error: 'PIN login has been removed. Use Google Sign-In via POST /api/auth/firebase.'
    });
});

// --- STAFF LOGIN via Firebase Google ID token ---
router.post('/auth/firebase', firebaseLoginLimiter, async (req, res) => {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
        return res.status(400).json({ error: 'idToken is required' });
    }
    if (!isFirebaseConfigured()) {
        return res.status(503).json({ error: 'Staff Google Sign-In is not configured on the server' });
    }

    try {
        const decoded = await verifyIdToken(idToken);
        const email = String(decoded.email || '').trim().toLowerCase();
        if (!email || !decoded.email_verified) {
            return res.status(403).json({ error: 'Google account email must be verified' });
        }

        const result = await db.query(
            `SELECT id, username, name, role, email, firebase_uid, is_active
             FROM users WHERE LOWER(email) = $1 LIMIT 1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({
                error: 'This Google account is not authorized for Staff POS. Ask the owner to add your email.'
            });
        }

        const user = result.rows[0];
        if (user.is_active === false) {
            return res.status(403).json({ error: 'This staff account is disabled' });
        }

        if (decoded.uid && user.firebase_uid !== decoded.uid) {
            await db.query(`UPDATE users SET firebase_uid = $1 WHERE id = $2`, [decoded.uid, user.id]);
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                username: user.username,
                email: user.email
            }
        });
    } catch (err) {
        if (err.status === 503) {
            return res.status(503).json({ error: err.message });
        }
        console.error('Firebase auth failed:', err.message);
        return res.status(401).json({ error: 'Invalid or expired Google sign-in. Please try again.' });
    }
});

// --- VERIFY MANAGER OVERRIDE PIN (for UI pre-check) ---
router.post('/auth/verify-manager', authenticateToken, async (req, res) => {
    try {
        const manager = await assertManagerPin(req.body.pin || req.body.managerPin);
        res.json({ ok: true, manager: { id: manager.id, name: manager.name, role: manager.role } });
    } catch (err) {
        res.status(err.status || 403).json({ error: err.message || 'Invalid manager PIN' });
    }
});

// --- GET PRODUCTS (CATALOG & INVENTORY) ---
router.get('/products', async (req, res) => {
    try {
        const queryText = `
            SELECT p.*, 
                (SELECT coalesce(json_agg(json_build_object(
                    'id', v.id, 
                    'size', v.size, 
                    'concentration', v.concentration, 
                    'price', v.price::numeric, 
                    'sku', v.sku, 
                    'barcode', v.barcode
                )), '[]') FROM variants v WHERE v.perfume_id = p.id) as variants,
                (SELECT coalesce(json_agg(json_build_object(
                    'id', b.id,
                    'variantId', b.variant_id,
                    'batchNo', b.batch_no, 
                    'mfgDate', to_char(b.mfg_date, 'YYYY-MM-DD'), 
                    'expDate', to_char(b.exp_date, 'YYYY-MM-DD'), 
                    'cost', b.cost::numeric, 
                    'qty', b.qty_current
                ) ORDER BY b.exp_date ASC), '[]') FROM batches b WHERE b.perfume_id = p.id) as batches
            FROM perfumes p;
        `;
        const result = await db.query(queryText);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// --- ADD NEW PRODUCT / VARIANT (manager PIN if cashier) ---
router.post('/products', authenticateToken, async (req, res) => {
    const { name, brand, family, size, concentration, price, cost, batchNo, qty, expiry, notes, image } = req.body;

    if (!name || !brand || !size || !price || !cost || !batchNo || !qty || !expiry) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const imageValue = (typeof image === 'string' && image.trim())
        ? image.trim()
        : 'assets/images/oud.png';
    if (imageValue.length > 1_500_000) {
        return res.status(400).json({ error: 'Image is too large (max ~1.5MB encoded). Use a smaller photo or a URL.' });
    }

    try {
        const manager = await requireManagerOverride(req);

        await db.query('BEGIN');

        let perfumeId = 'p_' + Date.now();
        const perfCheck = await db.query(
            'SELECT id FROM perfumes WHERE LOWER(name) = LOWER($1) AND LOWER(brand) = LOWER($2)',
            [name, brand]
        );

        if (perfCheck.rows.length > 0) {
            perfumeId = perfCheck.rows[0].id;
            if (image && String(image).trim()) {
                await db.query('UPDATE perfumes SET image = $1 WHERE id = $2', [imageValue, perfumeId]);
            }
        } else {
            const ingredientNotes = notes ? notes.split(',').map(n => n.trim()) : ['Fragrance Blends'];
            await db.query(
                'INSERT INTO perfumes (id, name, brand, family, gender, notes, image, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [perfumeId, name, brand, family || 'Woody', 'Unisex', ingredientNotes, imageValue, `${name} by ${brand}`]
            );
        }

        const variantId = 'v_' + Date.now();
        const sku = (brand.substring(0, 3) + '-' + name.substring(0, 3) + '-' + concentration + '-' + size.replace(/\D/g, '')).toUpperCase();
        const barcode = '890' + Math.floor(100000000 + Math.random() * 900000000);

        await db.query(
            'INSERT INTO variants (id, perfume_id, size, concentration, price, sku, barcode) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [variantId, perfumeId, size, concentration, price, sku, barcode]
        );

        const batchId = 'b_' + Date.now();
        await db.query(
            'INSERT INTO batches (id, perfume_id, variant_id, batch_no, mfg_date, exp_date, cost, qty_current, qty_initial) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $7)',
            [batchId, perfumeId, variantId, batchNo, expiry, cost, qty]
        );

        await db.query('COMMIT');

        await logAuditOverride({
            action: 'stock_adjust',
            actorUserId: req.user.id,
            managerUserId: manager.id,
            detail: { type: 'add_product', sku, barcode, qty }
        });

        res.status(201).json({ message: 'Product variant registered successfully', sku, barcode });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error(err);
        res.status(err.status || 500).json({ error: err.message || 'Failed to create product variant' });
    }
});

// --- RESTOCK / ADD STOCK (manager PIN if cashier) ---
router.post('/products/restock', authenticateToken, async (req, res) => {
    const { perfumeId, variantId, qty, batchNo, expiry } = req.body;

    if (!perfumeId || !variantId || !qty || !batchNo || !expiry) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const manager = await requireManagerOverride(req);

        const batchCheck = await db.query(
            'SELECT id FROM batches WHERE variant_id = $1 AND batch_no = $2',
            [variantId, batchNo]
        );

        if (batchCheck.rows.length > 0) {
            await db.query(
                'UPDATE batches SET qty_current = qty_current + $1, exp_date = $2 WHERE id = $3',
                [qty, expiry, batchCheck.rows[0].id]
            );
        } else {
            const batchId = 'b_' + Date.now();
            const costResult = await db.query('SELECT cost FROM batches WHERE variant_id = $1 LIMIT 1', [variantId]);
            const cost = costResult.rows.length > 0 ? costResult.rows[0].cost : 1500.00;

            await db.query(
                'INSERT INTO batches (id, perfume_id, variant_id, batch_no, mfg_date, exp_date, cost, qty_current, qty_initial) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $7)',
                [batchId, perfumeId, variantId, batchNo, expiry, cost, qty]
            );
        }

        await logAuditOverride({
            action: 'stock_adjust',
            actorUserId: req.user.id,
            managerUserId: manager.id,
            detail: { type: 'restock', variantId, qty, batchNo }
        });

        res.json({ message: 'Stock restocked successfully' });
    } catch (err) {
        console.error(err);
        res.status(err.status || 500).json({ error: err.message || 'Failed to restock variant' });
    }
});

// --- PERMANENT CATALOG PRICE EDIT (manager PIN if cashier) ---
router.post('/products/:variantId/price', authenticateToken, async (req, res) => {
    const { variantId } = req.params;
    const { price } = req.body;
    if (price == null || Number(price) <= 0) {
        return res.status(400).json({ error: 'Valid price is required' });
    }

    try {
        const manager = await requireManagerOverride(req);
        const result = await db.query(
            'UPDATE variants SET price = $1 WHERE id = $2 RETURNING id, price',
            [price, variantId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Variant not found' });
        }

        await logAuditOverride({
            action: 'price_edit',
            actorUserId: req.user.id,
            managerUserId: manager.id,
            detail: { variantId, price: Number(price) }
        });

        res.json({ message: 'Price updated', variantId, price: Number(result.rows[0].price) });
    } catch (err) {
        console.error(err);
        res.status(err.status || 500).json({ error: err.message || 'Failed to update price' });
    }
});

// --- EDIT PRODUCT + VARIANT (catalog fields; manager PIN if cashier) ---
router.put('/products/:perfumeId/variants/:variantId', authenticateToken, async (req, res) => {
    const { perfumeId, variantId } = req.params;
    const { name, brand, family, notes, image, size, concentration, price } = req.body || {};

    if (!name || !brand || !size || price == null || Number(price) <= 0) {
        return res.status(400).json({ error: 'Name, brand, size, and a valid price are required' });
    }

    try {
        const manager = await requireManagerOverride(req);

        const variantCheck = await db.query(
            'SELECT id FROM variants WHERE id = $1 AND perfume_id = $2',
            [variantId, perfumeId]
        );
        if (!variantCheck.rows.length) {
            return res.status(404).json({ error: 'Product variant not found' });
        }

        const notesArr = Array.isArray(notes)
            ? notes
            : (typeof notes === 'string' && notes.trim()
                ? notes.split(',').map((n) => n.trim()).filter(Boolean)
                : null);

        await db.query('BEGIN');

        await db.query(
            `UPDATE perfumes SET
                name = $1,
                brand = $2,
                family = coalesce($3, family),
                notes = coalesce($4, notes),
                image = coalesce($5, image)
             WHERE id = $6`,
            [
                name.trim(),
                brand.trim(),
                family || null,
                notesArr,
                (typeof image === 'string' && image.trim()) ? image.trim() : null,
                perfumeId
            ]
        );

        await db.query(
            `UPDATE variants SET
                size = $1,
                concentration = coalesce($2, concentration),
                price = $3
             WHERE id = $4`,
            [size.trim(), concentration || null, Number(price), variantId]
        );

        await db.query('COMMIT');

        await logAuditOverride({
            action: 'product_edit',
            actorUserId: req.user.id,
            managerUserId: manager.id,
            detail: { perfumeId, variantId, name, brand, size, price: Number(price) }
        });

        res.json({ message: 'Product updated', perfumeId, variantId });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error(err);
        res.status(err.status || 500).json({ error: err.message || 'Failed to update product' });
    }
});

// --- AUDIT: cart price override log (cashier must send managerPin) ---
router.post('/overrides/price', authenticateToken, async (req, res) => {
    const { variantId, oldPrice, newPrice } = req.body;
    try {
        const manager = await requireManagerOverride(req);
        await logAuditOverride({
            action: 'price_override',
            actorUserId: req.user.id,
            managerUserId: manager.id,
            detail: { variantId, oldPrice, newPrice }
        });
        res.json({ ok: true, managerName: manager.name });
    } catch (err) {
        res.status(err.status || 403).json({ error: err.message || 'Manager approval failed' });
    }
});

// --- CRM: GET CUSTOMERS ---
router.get('/customers', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM customers ORDER BY name ASC');
        res.json(result.rows.map(formatCustomer));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

// --- CRM: REGISTER NEW CUSTOMER ---
router.post('/customers', async (req, res) => {
    const { name, phone, email, preferred, disliked, skinType, remarks, birthday, anniversary } = req.body;

    if (!name || !phone) {
        return res.status(400).json({ error: 'Name and Phone are required' });
    }

    try {
        const id = 'c_' + Date.now();
        await db.query(
            `INSERT INTO customers (id, name, phone, email, loyalty_points, skin_type, preferred_notes, disliked_notes, remarks, birthday, anniversary) 
             VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10)`,
            [
                id,
                name,
                encrypt(phone),
                email ? encrypt(email) : null,
                skinType || 'Normal',
                preferred || [],
                disliked || [],
                remarks || '',
                birthday || null,
                anniversary || null
            ]
        );
        res.status(201).json({ message: 'Customer registered successfully', id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to register customer' });
    }
});

// --- CRM: UPDATE CUSTOMER (birthday / anniversary / profile) ---
router.patch('/customers/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, phone, email, preferred, disliked, skinType, remarks, birthday, anniversary } = req.body;
    try {
        const existing = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
        if (!existing.rows.length) return res.status(404).json({ error: 'Customer not found' });
        const cur = existing.rows[0];
        await db.query(
            `UPDATE customers SET
                name = coalesce($1, name),
                phone = coalesce($2, phone),
                email = coalesce($3, email),
                skin_type = coalesce($4, skin_type),
                preferred_notes = coalesce($5, preferred_notes),
                disliked_notes = coalesce($6, disliked_notes),
                remarks = coalesce($7, remarks),
                birthday = coalesce($8, birthday),
                anniversary = coalesce($9, anniversary)
             WHERE id = $10`,
            [
                name || null,
                phone ? encrypt(phone) : null,
                email ? encrypt(email) : null,
                skinType || null,
                preferred || null,
                disliked || null,
                remarks != null ? remarks : null,
                birthday !== undefined ? birthday || null : null,
                anniversary !== undefined ? anniversary || null : null,
                id
            ]
        );
        // If birthday explicitly null-ish via empty string handled above; reload
        const updated = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
        res.json(formatCustomer(updated.rows[0]));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// --- POS: PROCESS TRANSACTIONS (CASH / NON-GATEWAY) ---
router.post('/transactions', authenticateToken, async (req, res) => {
    const {
        invoiceNo, customerId, customerName, employeeName, subtotal, cgst, sgst, total,
        paymentMethod, referenceId, items, splits, redeemPoints
    } = req.body;

    if (!invoiceNo || !customerName || !items || items.length === 0) {
        return res.status(400).json({ error: 'Missing transaction details' });
    }

    const method = String(paymentMethod || '');
    if (/phonepe/i.test(method)) {
        return res.status(400).json({
            error: 'PhonePe mock checkout is retired. Use Cash or Razorpay (Card/UPI).'
        });
    }
    if (!/^cash$/i.test(method)) {
        return res.status(400).json({
            error: 'Use POST /payments/create-order for Razorpay digital payments'
        });
    }

    try {
        const saleSplits = Array.isArray(splits) && splits.length
            ? splits
            : [{ method: 'cash', amount: total, referenceId: referenceId || '' }];

        const { transactionId } = await finalizeSale({
            invoiceNo,
            customerId,
            customerName,
            employeeName: employeeName || req.user.name,
            employeeId: req.user.id,
            subtotal,
            cgst,
            sgst,
            total,
            paymentMethod: method || 'Cash',
            referenceId: referenceId || '',
            paymentStatus: 'paid',
            splits: saleSplits,
            items,
            redeemPoints: redeemPoints || 0
        });

        res.status(201).json({ message: 'Transaction processed successfully', transactionId });
    } catch (err) {
        console.error(err);
        res.status(err.status || 500).json({ error: err.message || 'Transaction failed' });
    }
});

// --- VOID / REFUND (manager PIN required for cashiers) ---
router.post('/transactions/:id/void', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const reason = (req.body && req.body.reason) || '';

    try {
        const manager = await requireManagerOverride(req);
        const result = await voidSale(id, { voidedBy: manager.id, reason });

        await logAuditOverride({
            action: 'refund',
            actorUserId: req.user.id,
            managerUserId: manager.id,
            detail: { transactionId: id, reason, alreadyVoided: result.alreadyVoided }
        });

        res.json({
            message: result.alreadyVoided ? 'Transaction was already voided' : 'Transaction voided',
            transactionId: id
        });
    } catch (err) {
        console.error(err);
        res.status(err.status || 500).json({ error: err.message || 'Void failed' });
    }
});

// --- REPORTS: TODAY'S SALES LEDGER ---
router.get('/transactions/today', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT t.*, 
                coalesce(json_agg(json_build_object('name', ti.name, 'qty', ti.qty, 'price', ti.price)) filter (where ti.id is not null), '[]') as items
             FROM transactions t
             LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
             WHERE t.date >= CURRENT_DATE
             GROUP BY t.id
             ORDER BY t.date DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch sales ledger' });
    }
});

// --- REPORTS: DAILY SUMMARY + PER-EMPLOYEE COMMISSION ---
router.get('/reports/summary', authenticateToken, async (req, res) => {
    try {
        const totals = await db.query(
            `SELECT 
                coalesce(SUM(total), 0)::numeric as gross_sales,
                coalesce(SUM(cgst) + SUM(sgst), 0)::numeric as total_tax,
                coalesce(COUNT(*), 0)::int as tx_count,
                coalesce(SUM(subtotal) * ${COMMISSION_RATE}, 0)::numeric as commission
             FROM transactions
             WHERE date >= CURRENT_DATE AND COALESCE(payment_status, 'paid') = 'paid'`
        );

        const byEmp = await db.query(
            `SELECT 
                t.employee_id as "employeeId",
                coalesce(u.name, t.employee_name, 'Unknown') as name,
                coalesce(SUM(t.subtotal), 0)::numeric as sales,
                coalesce(SUM(t.subtotal) * ${COMMISSION_RATE}, 0)::numeric as commission,
                COUNT(*)::int as tx_count
             FROM transactions t
             LEFT JOIN users u ON u.id = t.employee_id
             WHERE t.date >= CURRENT_DATE AND COALESCE(t.payment_status, 'paid') = 'paid'
             GROUP BY t.employee_id, coalesce(u.name, t.employee_name, 'Unknown')
             ORDER BY sales DESC`
        );

        res.json({
            ...totals.rows[0],
            byEmployee: byEmp.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to calculate financial summary' });
    }
});

// --- REPORTS: TOP PERFORMERS (brand / family / note) ---
router.get('/reports/top-performers', authenticateToken, async (req, res) => {
    const days = Math.max(1, parseInt(req.query.days, 10) || 30);
    const groupBy = String(req.query.groupBy || 'brand').toLowerCase();
    try {
        let sql;
        if (groupBy === 'note') {
            sql = `
                SELECT note AS label,
                       coalesce(SUM(ti.qty * ti.price), 0)::numeric AS revenue,
                       coalesce(SUM(ti.qty), 0)::int AS units
                FROM transaction_items ti
                JOIN transactions t ON t.id = ti.transaction_id
                JOIN variants v ON v.id = ti.variant_id
                JOIN perfumes p ON p.id = v.perfume_id
                CROSS JOIN LATERAL unnest(coalesce(p.notes, ARRAY[]::text[])) AS note
                WHERE COALESCE(t.payment_status, 'paid') = 'paid'
                  AND t.date >= CURRENT_DATE - ($1::int || ' days')::interval
                GROUP BY note
                ORDER BY revenue DESC
                LIMIT 25`;
        } else if (groupBy === 'family') {
            sql = `
                SELECT p.family AS label,
                       coalesce(SUM(ti.qty * ti.price), 0)::numeric AS revenue,
                       coalesce(SUM(ti.qty), 0)::int AS units
                FROM transaction_items ti
                JOIN transactions t ON t.id = ti.transaction_id
                JOIN variants v ON v.id = ti.variant_id
                JOIN perfumes p ON p.id = v.perfume_id
                WHERE COALESCE(t.payment_status, 'paid') = 'paid'
                  AND t.date >= CURRENT_DATE - ($1::int || ' days')::interval
                GROUP BY p.family
                ORDER BY revenue DESC
                LIMIT 25`;
        } else {
            sql = `
                SELECT p.brand AS label,
                       coalesce(SUM(ti.qty * ti.price), 0)::numeric AS revenue,
                       coalesce(SUM(ti.qty), 0)::int AS units
                FROM transaction_items ti
                JOIN transactions t ON t.id = ti.transaction_id
                JOIN variants v ON v.id = ti.variant_id
                JOIN perfumes p ON p.id = v.perfume_id
                WHERE COALESCE(t.payment_status, 'paid') = 'paid'
                  AND t.date >= CURRENT_DATE - ($1::int || ' days')::interval
                GROUP BY p.brand
                ORDER BY revenue DESC
                LIMIT 25`;
        }
        const result = await db.query(sql, [days]);
        res.json({ days, groupBy, rows: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load top performers' });
    }
});

// --- REPORTS: DEAD STOCK ---
router.get('/reports/dead-stock', authenticateToken, async (req, res) => {
    const days = Math.max(1, parseInt(req.query.days, 10) || 30);
    try {
        const result = await db.query(
            `SELECT
                v.id AS "variantId",
                p.name AS perfume,
                p.brand,
                v.size,
                v.sku,
                v.barcode,
                coalesce(SUM(b.qty_current), 0)::int AS qty,
                MIN(b.mfg_date) AS oldest_mfg,
                MIN(b.exp_date) AS nearest_exp,
                (CURRENT_DATE - MIN(b.mfg_date))::int AS batch_age_days,
                MAX(ls.last_sale) AS last_sale
             FROM variants v
             JOIN perfumes p ON p.id = v.perfume_id
             JOIN batches b ON b.variant_id = v.id
             LEFT JOIN LATERAL (
                SELECT MAX(t.date) AS last_sale
                FROM transaction_items ti
                JOIN transactions t ON t.id = ti.transaction_id
                WHERE ti.variant_id = v.id
                  AND COALESCE(t.payment_status, 'paid') = 'paid'
             ) ls ON true
             GROUP BY v.id, p.name, p.brand, v.size, v.sku, v.barcode
             HAVING coalesce(SUM(b.qty_current), 0) > 0
                AND (
                    MAX(ls.last_sale) IS NULL
                    OR MAX(ls.last_sale) < CURRENT_DATE - ($1::int || ' days')::interval
                )
             ORDER BY batch_age_days DESC NULLS LAST, qty DESC`,
            [days]
        );
        res.json({ days, rows: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load dead stock' });
    }
});

// --- CRM: UPCOMING BIRTHDAYS / ANNIVERSARIES ---
router.get('/crm/upcoming-occasions', authenticateToken, async (req, res) => {
    const days = Math.max(1, parseInt(req.query.days, 10) || 7);
    try {
        const result = await db.query('SELECT * FROM customers ORDER BY name ASC');
        const rows = [];
        for (const r of result.rows) {
            const formatted = formatCustomer(r);
            const occasions = [];
            if (occasionWithinDays(r.birthday, days)) occasions.push('birthday');
            if (occasionWithinDays(r.anniversary, days)) occasions.push('anniversary');
            if (occasions.length) {
                rows.push({ ...formatted, occasions });
            }
        }
        res.json({ days, rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load upcoming occasions' });
    }
});

// --- CRM: QUEUE / RUN BIRTHDAY OFFERS ---
router.post('/crm/birthday-offers/run', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const headerSecret = req.headers['x-cron-secret'];
    const cronOk = Boolean(cronSecret && headerSecret && headerSecret === cronSecret);

    if (!cronOk) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Unauthorized: Manager JWT or X-Cron-Secret required' });
        }
        try {
            const user = jwt.verify(token, JWT_SECRET);
            if (!isManagerRole(user.role)) {
                return res.status(403).json({ error: 'Manager role or CRON_SECRET required' });
            }
            req.user = user;
        } catch (_) {
            return res.status(403).json({ error: 'Forbidden: Invalid token' });
        }
    }

    const days = Math.max(1, parseInt((req.body && req.body.days) || req.query.days, 10) || 7);
    try {
        const result = await db.query('SELECT * FROM customers ORDER BY name ASC');
        const queued = [];
        for (const r of result.rows) {
            const occasions = [];
            if (occasionWithinDays(r.birthday, days)) occasions.push('birthday');
            if (occasionWithinDays(r.anniversary, days)) occasions.push('anniversary');
            if (!occasions.length) continue;
            const customer = formatCustomer(r);
            const label = occasions.join(' & ');
            const body = `Hi ${customer.name}, H2O Perfumes wishes you a happy ${label}! Enjoy 10% off in-store this week with code GIFT10.`;
            const msg = await enqueueSms({
                toPhone: customer.phone,
                body,
                template: 'occasion_offer',
                customerId: customer.id
            });
            queued.push({ customerId: customer.id, name: customer.name, occasions, messageId: msg.id, status: msg.status });
        }
        await processOutbox(50);
        res.json({
            days,
            smsProvider: smsProvider(),
            msg91Configured: isMsg91Configured(),
            twilioConfigured: isTwilioConfigured(),
            queued
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to run birthday offers' });
    }
});

// Queue a single CRM offer SMS
router.post('/crm/customers/:id/offer-sms', authenticateToken, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Customer not found' });
        const customer = formatCustomer(result.rows[0]);
        const body = (req.body && req.body.body) ||
            `Hi ${customer.name}, a new batch matching your scent profile has arrived at H2O Kochi. Visit us for 10% off with code LOYALTY10.`;
        const msg = await enqueueSms({
            toPhone: customer.phone,
            body,
            template: 'crm_offer',
            customerId: customer.id
        });
        res.status(201).json({ message: msg.status === 'sent' ? 'SMS sent' : (msg.status === 'logged' ? 'SMS logged (Twilio not configured)' : 'SMS queued'), outbox: msg });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to queue SMS' });
    }
});

router.post('/messaging/process-outbox', authenticateToken, async (req, res) => {
    if (!isManagerRole(req.user && req.user.role)) {
        return res.status(403).json({ error: 'Manager only' });
    }
    try {
        const result = await processOutbox(50);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Outbox processing failed' });
    }
});

// --- SHIFTS ---
router.post('/shifts/clock-in', authenticateToken, async (req, res) => {
    try {
        const open = await db.query(
            'SELECT id FROM shift_logs WHERE user_id = $1 AND clock_out IS NULL LIMIT 1',
            [req.user.id]
        );
        if (open.rows.length) {
            return res.status(400).json({ error: 'Already clocked in', shiftId: open.rows[0].id });
        }
        const result = await db.query(
            'INSERT INTO shift_logs (user_id, notes) VALUES ($1, $2) RETURNING *',
            [req.user.id, req.body.notes || null]
        );
        res.status(201).json({ message: 'Clocked in', shift: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Clock-in failed' });
    }
});

router.post('/shifts/clock-out', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE shift_logs SET clock_out = NOW()
             WHERE user_id = $1 AND clock_out IS NULL
             RETURNING *`,
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'No open shift to clock out' });
        }
        res.json({ message: 'Clocked out', shift: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Clock-out failed' });
    }
});

router.get('/shifts/me', authenticateToken, async (req, res) => {
    try {
        const open = await db.query(
            'SELECT * FROM shift_logs WHERE user_id = $1 AND clock_out IS NULL LIMIT 1',
            [req.user.id]
        );
        const today = await db.query(
            `SELECT * FROM shift_logs
             WHERE user_id = $1 AND clock_in >= CURRENT_DATE
             ORDER BY clock_in DESC`,
            [req.user.id]
        );
        const hoursRes = await db.query(
            `SELECT coalesce(SUM(
                EXTRACT(EPOCH FROM (coalesce(clock_out, NOW()) - clock_in)) / 3600.0
             ), 0)::numeric as hours_today
             FROM shift_logs
             WHERE user_id = $1 AND clock_in >= CURRENT_DATE`,
            [req.user.id]
        );
        res.json({
            openShift: open.rows[0] || null,
            todayShifts: today.rows,
            hoursToday: Number(hoursRes.rows[0].hours_today)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load shifts' });
    }
});

// --- STAFF ACCOUNTS (Owner / Manager only — no public self-registration) ---
router.get('/staff', authenticateToken, async (req, res) => {
    if (!requireOwner(req, res)) return;
    try {
        const result = await db.query(
            `SELECT id, username, name, role, email, firebase_uid IS NOT NULL AS linked_google,
                    is_active, (override_pin_hash IS NOT NULL) AS has_override_pin
             FROM users
             ORDER BY is_active DESC, name ASC`
        );
        res.json({ staff: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list staff' });
    }
});

router.post('/staff', authenticateToken, async (req, res) => {
    if (!requireOwner(req, res)) return;
    const email = normalizeStaffEmail(req.body && req.body.email);
    const name = String((req.body && req.body.name) || '').trim();
    let role = String((req.body && req.body.role) || 'Cashier').trim() || 'Cashier';
    let username = String((req.body && req.body.username) || '').trim().toLowerCase();
    const overridePin = req.body && req.body.overridePin != null
        ? String(req.body.overridePin).trim()
        : '';

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'A valid Google email is required' });
    }
    if (!name) {
        return res.status(400).json({ error: 'Staff name is required' });
    }
    if (!username) username = slugUsername(email);

    const roleLower = role.toLowerCase();
    if (roleLower.includes('owner') || roleLower === 'manager') {
        role = roleLower === 'manager' ? 'Manager' : role;
    } else {
        role = 'Cashier';
    }

    try {
        const dup = await db.query(
            `SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 LIMIT 1`,
            [email, username]
        );
        if (dup.rows.length) {
            return res.status(409).json({ error: 'A staff account with this email or username already exists' });
        }

        let overrideHash = null;
        if (isManagerRole(role)) {
            const pin = overridePin || String(process.env.MANAGER_OVERRIDE_PIN || '9999').trim();
            if (!pin) {
                return res.status(400).json({ error: 'Manager accounts need an override PIN' });
            }
            overrideHash = await bcrypt.hash(pin, 12);
        } else if (overridePin) {
            overrideHash = await bcrypt.hash(overridePin, 12);
        }

        const inserted = await db.query(
            `INSERT INTO users (username, name, role, email, override_pin_hash, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             RETURNING id, username, name, role, email, is_active,
                       (override_pin_hash IS NOT NULL) AS has_override_pin,
                       false AS linked_google`,
            [username, name, role, email, overrideHash]
        );
        res.status(201).json({ staff: inserted.rows[0] });
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Email or username already in use' });
        }
        res.status(500).json({ error: 'Failed to create staff account' });
    }
});

router.patch('/staff/:id', authenticateToken, async (req, res) => {
    if (!requireOwner(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid staff id' });
    }

    const updates = [];
    const values = [];
    let i = 1;

    if (req.body && req.body.email != null) {
        const email = normalizeStaffEmail(req.body.email);
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'A valid Google email is required' });
        }
        updates.push(`email = $${i++}`);
        values.push(email);
        updates.push('firebase_uid = NULL'); // force re-link on next Google login
    }
    if (req.body && req.body.name != null) {
        const name = String(req.body.name).trim();
        if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
        updates.push(`name = $${i++}`);
        values.push(name);
    }
    if (req.body && req.body.role != null) {
        let role = String(req.body.role).trim();
        const rl = role.toLowerCase();
        if (!(rl === 'manager' || rl.includes('owner') || rl === 'cashier')) {
            return res.status(400).json({ error: 'Role must be Cashier, Manager, or Owner' });
        }
        if (rl === 'cashier') role = 'Cashier';
        else if (rl === 'manager') role = 'Manager';
        updates.push(`role = $${i++}`);
        values.push(role);
    }
    if (req.body && typeof req.body.isActive === 'boolean') {
        if (id === req.user.id && req.body.isActive === false) {
            return res.status(400).json({ error: 'You cannot deactivate your own account' });
        }
        updates.push(`is_active = $${i++}`);
        values.push(req.body.isActive);
    }
    if (req.body && req.body.overridePin != null) {
        const pin = String(req.body.overridePin).trim();
        if (!pin) {
            updates.push('override_pin_hash = NULL');
        } else {
            const hash = await bcrypt.hash(pin, 12);
            updates.push(`override_pin_hash = $${i++}`);
            values.push(hash);
        }
    }

    if (!updates.length) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    try {
        const result = await db.query(
            `UPDATE users SET ${updates.join(', ')}
             WHERE id = $${i}
             RETURNING id, username, name, role, email, is_active,
                       firebase_uid IS NOT NULL AS linked_google,
                       (override_pin_hash IS NOT NULL) AS has_override_pin`,
            values
        );
        if (!result.rows.length) {
            return res.status(404).json({ error: 'Staff account not found' });
        }
        res.json({ staff: result.rows[0] });
    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Email already in use' });
        }
        res.status(500).json({ error: 'Failed to update staff account' });
    }
});

// --- OWNER DASHBOARD (read-only aggregate for phone) ---
router.get('/owner/dashboard', authenticateToken, async (req, res) => {
    if (!isManagerRole(req.user.role)) {
        return res.status(403).json({ error: 'Manager / Owner only' });
    }
    try {
        const summary = await db.query(
            `SELECT 
                coalesce(SUM(total), 0)::numeric as gross_sales,
                coalesce(SUM(cgst) + SUM(sgst), 0)::numeric as total_tax,
                coalesce(COUNT(*), 0)::int as tx_count,
                coalesce(SUM(subtotal) * ${COMMISSION_RATE}, 0)::numeric as commission
             FROM transactions
             WHERE date >= CURRENT_DATE AND COALESCE(payment_status, 'paid') = 'paid'`
        );

        const byEmp = await db.query(
            `SELECT 
                coalesce(u.name, t.employee_name, 'Unknown') as name,
                coalesce(SUM(t.subtotal), 0)::numeric as sales,
                coalesce(SUM(t.subtotal) * ${COMMISSION_RATE}, 0)::numeric as commission,
                COUNT(*)::int as tx_count
             FROM transactions t
             LEFT JOIN users u ON u.id = t.employee_id
             WHERE t.date >= CURRENT_DATE AND COALESCE(t.payment_status, 'paid') = 'paid'
             GROUP BY coalesce(u.name, t.employee_name, 'Unknown')
             ORDER BY sales DESC`
        );

        const inventory = await db.query(
            `SELECT p.name AS perfume, p.brand, v.size, v.sku,
                    coalesce(SUM(b.qty_current), 0)::int AS qty,
                    MIN(b.exp_date) AS nearest_exp
             FROM variants v
             JOIN perfumes p ON p.id = v.perfume_id
             LEFT JOIN batches b ON b.variant_id = v.id
             GROUP BY p.name, p.brand, v.size, v.sku
             ORDER BY qty ASC
             LIMIT 40`
        );

        const dead = await db.query(
            `SELECT p.name AS perfume, v.size, v.sku,
                    coalesce(SUM(b.qty_current), 0)::int AS qty,
                    (CURRENT_DATE - MIN(b.mfg_date))::int AS batch_age_days
             FROM variants v
             JOIN perfumes p ON p.id = v.perfume_id
             JOIN batches b ON b.variant_id = v.id
             LEFT JOIN LATERAL (
                SELECT MAX(t.date) AS last_sale
                FROM transaction_items ti
                JOIN transactions t ON t.id = ti.transaction_id
                WHERE ti.variant_id = v.id AND COALESCE(t.payment_status, 'paid') = 'paid'
             ) ls ON true
             GROUP BY p.name, v.size, v.sku
             HAVING coalesce(SUM(b.qty_current), 0) > 0
                AND (MAX(ls.last_sale) IS NULL OR MAX(ls.last_sale) < CURRENT_DATE - INTERVAL '30 days')
             ORDER BY batch_age_days DESC NULLS LAST
             LIMIT 20`
        );

        const lowStock = inventory.rows.filter((r) => Number(r.qty) < 10);

        res.json({
            generatedAt: new Date().toISOString(),
            summary: summary.rows[0],
            byEmployee: byEmp.rows,
            lowStock,
            deadStock: dead.rows,
            inventory: inventory.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load owner dashboard' });
    }
});

module.exports = router;
