const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');

const JWT_SECRET = process.env.JWT_SECRET;

// --- AUTH MIDDLEWARE ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Access token missing' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Forbidden: Invalid token' });
        }
        req.user = user;
        next();
    });
}

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

// --- ADD NEW PRODUCT / VARIANT ---
router.post('/products', authenticateToken, async (req, res) => {
    const { name, brand, family, size, concentration, price, cost, batchNo, qty, expiry, notes } = req.body;

    if (!name || !brand || !size || !price || !cost || !batchNo || !qty || !expiry) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Start transaction
        await db.query('BEGIN');

        // Check if perfume exists
        let perfumeId = 'p_' + Date.now();
        const perfCheck = await db.query(
            'SELECT id FROM perfumes WHERE LOWER(name) = LOWER($1) AND LOWER(brand) = LOWER($2)',
            [name, brand]
        );

        if (perfCheck.rows.length > 0) {
            perfumeId = perfCheck.rows[0].id;
        } else {
            // Insert perfume
            const ingredientNotes = notes ? notes.split(',').map(n => n.trim()) : ['Fragrance Blends'];
            await db.query(
                'INSERT INTO perfumes (id, name, brand, family, gender, notes, image, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [perfumeId, name, brand, family || 'Woody', 'Unisex', ingredientNotes, 'assets/images/oud.png', `${name} by ${brand}`]
            );
        }

        // Insert variant
        const variantId = 'v_' + Date.now();
        const sku = (brand.substring(0,3) + '-' + name.substring(0,3) + '-' + concentration + '-' + size.replace(/\D/g,'')).toUpperCase();
        const barcode = '890' + Math.floor(100000000 + Math.random() * 900000000);

        await db.query(
            'INSERT INTO variants (id, perfume_id, size, concentration, price, sku, barcode) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [variantId, perfumeId, size, concentration, price, sku, barcode]
        );

        // Insert batch
        const batchId = 'b_' + Date.now();
        await db.query(
            'INSERT INTO batches (id, perfume_id, variant_id, batch_no, mfg_date, exp_date, cost, qty_current, qty_initial) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $7)',
            [batchId, perfumeId, variantId, batchNo, expiry, cost, qty]
        );

        await db.query('COMMIT');
        res.status(201).json({ message: 'Product variant registered successfully', sku, barcode });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Failed to create product variant' });
    }
});

// --- RESTOCK / ADD STOCK ---
router.post('/products/restock', authenticateToken, async (req, res) => {
    const { perfumeId, variantId, qty, batchNo, expiry } = req.body;

    if (!perfumeId || !variantId || !qty || !batchNo || !expiry) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Check if this batch exists for this variant
        const batchCheck = await db.query(
            'SELECT id FROM batches WHERE variant_id = $1 AND batch_no = $2',
            [variantId, batchNo]
        );

        if (batchCheck.rows.length > 0) {
            // Update existing batch quantity
            await db.query(
                'UPDATE batches SET qty_current = qty_current + $1, exp_date = $2 WHERE id = $3',
                [qty, expiry, batchCheck.rows[0].id]
            );
        } else {
            // Create a new batch shipment
            const batchId = 'b_' + Date.now();
            // Fetch fallback cost
            const costResult = await db.query('SELECT cost FROM batches WHERE variant_id = $1 LIMIT 1', [variantId]);
            const cost = costResult.rows.length > 0 ? costResult.rows[0].cost : 1500.00;

            await db.query(
                'INSERT INTO batches (id, perfume_id, variant_id, batch_no, mfg_date, exp_date, cost, qty_current, qty_initial) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $7)',
                [batchId, perfumeId, variantId, batchNo, expiry, cost, qty]
            );
        }

        res.json({ message: 'Stock restocked successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to restock variant' });
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

// --- POS: PROCESS TRANSACTIONS (CHECKOUT) ---
router.post('/transactions', authenticateToken, async (req, res) => {
    const { invoiceNo, customerId, customerName, employeeName, subtotal, cgst, sgst, total, paymentMethod, referenceId, items } = req.body;

    if (!invoiceNo || !customerName || !items || items.length === 0) {
        return res.status(400).json({ error: 'Missing transaction details' });
    }

    try {
        await db.query('BEGIN');

        const transactionId = 'tx_' + Date.now();

        // 1. Insert Transaction record
        await db.query(
            `INSERT INTO transactions (id, invoice_no, customer_name, employee_name, subtotal, cgst, sgst, total, payment_method, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [transactionId, invoiceNo, customerName, employeeName, subtotal, cgst, sgst, total, paymentMethod, referenceId || '']
        );

        // 2. Loop through items to deduct inventory and log items
        for (const item of items) {
            // Deduct stock using FIFO (First-Expired, First-Out)
            let qtyRemainingToDeduct = item.qty;
            
            // Fetch active batches for this variant with stock
            const batchesResult = await db.query(
                'SELECT id, qty_current FROM batches WHERE variant_id = $1 AND qty_current > 0 ORDER BY exp_date ASC',
                [item.variantId]
            );

            for (const batch of batchesResult.rows) {
                if (qtyRemainingToDeduct <= 0) break;
                
                const deduct = Math.min(qtyRemainingToDeduct, batch.qty_current);
                await db.query(
                    'UPDATE batches SET qty_current = qty_current - $1 WHERE id = $2',
                    [deduct, batch.id]
                );
                qtyRemainingToDeduct -= deduct;
            }

            // Insert transaction item
            await db.query(
                'INSERT INTO transaction_items (transaction_id, variant_id, name, qty, price) VALUES ($1, $2, $3, $4, $5)',
                [transactionId, item.variantId, item.name, item.qty, item.price]
            );
        }

        // 3. Update customer loyalty points if customerId is provided
        if (customerId && customerId !== 'walkin') {
            const loyaltyEarned = Math.floor(total / 10);
            await db.query(
                'UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2',
                [loyaltyEarned, customerId]
            );
        }

        await db.query('COMMIT');
        res.status(201).json({ message: 'Transaction processed successfully', transactionId });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Transaction failed' });
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

// --- REPORTS: DAILY SUMMARY KPI METRICS ---
router.get('/reports/summary', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT 
                coalesce(SUM(total), 0)::numeric as gross_sales,
                coalesce(SUM(cgst) + SUM(sgst), 0)::numeric as total_tax,
                coalesce(COUNT(*), 0)::int as tx_count,
                coalesce(SUM(subtotal) * 0.05, 0)::numeric as commission
             FROM transactions
             WHERE date >= CURRENT_DATE`
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to calculate financial summary' });
    }
});

module.exports = router;
