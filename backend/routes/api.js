const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');
const { finalizeSale } = require('../services/sales');
const { voidSale } = require('../services/voidSale');
const {
    authenticateToken,
    isManagerRole,
    assertManagerPin,
    requireManagerOverride,
    logAuditOverride,
    JWT_SECRET
} = require('../middleware/auth');

const COMMISSION_RATE = 0.05;

// --- STAFF LOGIN ---
router.post('/auth/login', async (req, res) => {
    const { username, pin } = req.body;

    if (!username || !pin) {
        return res.status(400).json({ error: 'Username and PIN are required' });
    }

    try {
        const result = await db.query(
            'SELECT id, username, name, role FROM users WHERE username = $1 AND pin = $2',
            [username.toLowerCase(), pin]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid Username or PIN' });
        }

        const user = result.rows[0];
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
                username: user.username
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error during login' });
    }
});

// --- VERIFY MANAGER PIN (for UI pre-check) ---
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
                    'batchNo', b.batch_no, 
                    'mfgDate', to_char(b.mfg_date, 'YYYY-MM-DD'), 
                    'expDate', to_char(b.exp_date, 'YYYY-MM-DD'), 
                    'cost', b.cost::numeric, 
                    'qty', b.qty_current
                )), '[]') FROM batches b WHERE b.perfume_id = p.id ORDER BY b.exp_date ASC) as batches
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
    const { name, brand, family, size, concentration, price, cost, batchNo, qty, expiry, notes } = req.body;

    if (!name || !brand || !size || !price || !cost || !batchNo || !qty || !expiry) {
        return res.status(400).json({ error: 'Missing required fields' });
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
        } else {
            const ingredientNotes = notes ? notes.split(',').map(n => n.trim()) : ['Fragrance Blends'];
            await db.query(
                'INSERT INTO perfumes (id, name, brand, family, gender, notes, image, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [perfumeId, name, brand, family || 'Woody', 'Unisex', ingredientNotes, 'assets/images/oud.png', `${name} by ${brand}`]
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
        const formatted = result.rows.map(r => {
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
                scentProfile: {
                    preferred: r.preferred_notes || [],
                    disliked: r.disliked_notes || [],
                    skinType: r.skin_type,
                    remarks: r.remarks || 'No specific sensitivities.'
                }
            };
        });
        res.json(formatted);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

// --- CRM: REGISTER NEW CUSTOMER ---
router.post('/customers', async (req, res) => {
    const { name, phone, email, preferred, disliked, skinType, remarks } = req.body;

    if (!name || !phone) {
        return res.status(400).json({ error: 'Name and Phone are required' });
    }

    try {
        const id = 'c_' + Date.now();
        await db.query(
            `INSERT INTO customers (id, name, phone, email, loyalty_points, skin_type, preferred_notes, disliked_notes, remarks) 
             VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8)`,
            [
                id,
                name,
                encrypt(phone),
                email ? encrypt(email) : null,
                skinType || 'Normal',
                preferred || [],
                disliked || [],
                remarks || ''
            ]
        );
        res.status(201).json({ message: 'Customer registered successfully', id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to register customer' });
    }
});

// --- POS: PROCESS TRANSACTIONS (CASH / NON-GATEWAY) ---
router.post('/transactions', authenticateToken, async (req, res) => {
    const {
        invoiceNo, customerId, customerName, employeeName, subtotal, cgst, sgst, total,
        paymentMethod, referenceId, items, splits
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
            items
        });

        res.status(201).json({ message: 'Transaction processed successfully', transactionId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Transaction failed' });
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
            'SELECT * FROM shift_logs WHERE user_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
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

module.exports = router;
