const { pool } = require('./db');
const { validateEnv } = require('./env');
const { encrypt } = require('./crypto');

validateEnv();

const schema = `
-- Drop existing tables if they exist
DROP TABLE IF EXISTS ledger_exports CASCADE;
DROP TABLE IF EXISTS message_outbox CASCADE;
DROP TABLE IF EXISTS loyalty_redemptions CASCADE;
DROP TABLE IF EXISTS audit_overrides CASCADE;
DROP TABLE IF EXISTS shift_logs CASCADE;
DROP TABLE IF EXISTS payment_splits CASCADE;
DROP TABLE IF EXISTS payment_orders CASCADE;
DROP TABLE IF EXISTS transaction_items CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS batches CASCADE;
DROP TABLE IF EXISTS variants CASCADE;
DROP TABLE IF EXISTS perfumes CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Users (Staff) Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    pin VARCHAR(10) NOT NULL,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'Cashier'
);

-- 2. Customers Table (phone/email stored encrypted — TEXT holds ciphertext)
CREATE TABLE customers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    loyalty_points INT DEFAULT 0,
    skin_type VARCHAR(50) DEFAULT 'Normal',
    preferred_notes TEXT[],
    disliked_notes TEXT[],
    remarks TEXT,
    birthday DATE,
    anniversary DATE
);

-- 3. Perfumes Table
CREATE TABLE perfumes (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    brand VARCHAR(100) NOT NULL,
    family VARCHAR(50) NOT NULL,
    gender VARCHAR(20) NOT NULL DEFAULT 'Unisex',
    notes TEXT[],
    image TEXT,
    description TEXT
);

-- 4. Product Variants Table
CREATE TABLE variants (
    id VARCHAR(50) PRIMARY KEY,
    perfume_id VARCHAR(50) REFERENCES perfumes(id) ON DELETE CASCADE,
    size VARCHAR(20) NOT NULL,
    concentration VARCHAR(50) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    sku VARCHAR(50) UNIQUE NOT NULL,
    barcode VARCHAR(50) UNIQUE NOT NULL
);

-- 5. Batches (Inventory Stock) Table
CREATE TABLE batches (
    id VARCHAR(50) PRIMARY KEY,
    perfume_id VARCHAR(50) REFERENCES perfumes(id) ON DELETE CASCADE,
    variant_id VARCHAR(50) REFERENCES variants(id) ON DELETE CASCADE,
    batch_no VARCHAR(50) NOT NULL,
    mfg_date DATE NOT NULL,
    exp_date DATE NOT NULL,
    cost NUMERIC(10, 2) NOT NULL,
    qty_current INT NOT NULL DEFAULT 0,
    qty_initial INT NOT NULL
);

-- 6. Transactions Table
CREATE TABLE transactions (
    id VARCHAR(50) PRIMARY KEY,
    invoice_no VARCHAR(50) UNIQUE NOT NULL,
    date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    customer_name VARCHAR(100) NOT NULL,
    employee_name VARCHAR(100) NOT NULL,
    subtotal NUMERIC(10, 2) NOT NULL,
    cgst NUMERIC(10, 2) NOT NULL,
    sgst NUMERIC(10, 2) NOT NULL,
    total NUMERIC(10, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    reference_id VARCHAR(100),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'paid',
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    customer_id VARCHAR(50),
    employee_id INT REFERENCES users(id),
    voided_at TIMESTAMPTZ,
    voided_by INT REFERENCES users(id),
    void_reason TEXT,
    tally_exported_at TIMESTAMPTZ,
    zoho_exported_at TIMESTAMPTZ
);

-- 7. Transaction Items Table
CREATE TABLE transaction_items (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50) REFERENCES transactions(id) ON DELETE CASCADE,
    variant_id VARCHAR(50) REFERENCES variants(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    qty INT NOT NULL,
    price NUMERIC(10, 2) NOT NULL
);

-- 8. Pending Razorpay orders (cart payload for verify/webhook finalize)
CREATE TABLE payment_orders (
    id VARCHAR(50) PRIMARY KEY,
    razorpay_order_id VARCHAR(100) UNIQUE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'created',
    payload JSONB NOT NULL,
    transaction_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 9. Tender splits (cash + Razorpay)
CREATE TABLE payment_splits (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50) REFERENCES transactions(id) ON DELETE CASCADE,
    method VARCHAR(50) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    reference_id VARCHAR(100)
);

-- 10. Shift clock-in / clock-out
CREATE TABLE shift_logs (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out TIMESTAMPTZ,
    notes TEXT
);

-- 11. Manager override audit trail
CREATE TABLE audit_overrides (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    actor_user_id INT REFERENCES users(id),
    manager_user_id INT REFERENCES users(id),
    detail JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 12. Loyalty redemptions
CREATE TABLE loyalty_redemptions (
    id SERIAL PRIMARY KEY,
    customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE SET NULL,
    transaction_id VARCHAR(50) REFERENCES transactions(id) ON DELETE SET NULL,
    points INT NOT NULL,
    amount_inr NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 13. Message outbox (Twilio SMS / future WhatsApp)
CREATE TABLE message_outbox (
    id SERIAL PRIMARY KEY,
    channel VARCHAR(20) NOT NULL DEFAULT 'sms',
    to_phone TEXT NOT NULL,
    body TEXT NOT NULL,
    template VARCHAR(50),
    customer_id VARCHAR(50) REFERENCES customers(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    provider_ref VARCHAR(100),
    error TEXT,
    scheduled_for TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 14. Ledger export audit (Tally / Zoho)
CREATE TABLE ledger_exports (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(30) NOT NULL,
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    voucher_count INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'generated',
    payload TEXT,
    remote_ref VARCHAR(200),
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
`;

const seedData = async () => {
  const client = await pool.connect();
  try {
    console.log("⏳ Initializing database schema...");
    await client.query(schema);
    console.log("✅ Schema created successfully.");

    console.log("⏳ Seeding staff users...");
    await client.query(`
      INSERT INTO users (username, pin, name, role) VALUES 
      ('siddharth', '1234', 'Siddharth M.', 'Cashier'),
      ('jishnu', '9999', 'Dr. Jishnu Sen', 'Manager');
    `);

    console.log("⏳ Seeding customers (PII encrypted at rest)...");
    const seedCustomers = [
      {
        id: 'c1', name: 'Anjali Menon', phone: '+91 98765 43210', email: 'anjali@example.com',
        points: 340, skin: 'Dry', preferred: ['Jasmine', 'Rose', 'Vanilla'], disliked: ['Oud'],
        remarks: 'Allergic to heavy oriental profiles. Prefers soft, sweet florals.',
        birthday: '1992-11-25', anniversary: '2018-03-12'
      },
      {
        id: 'c2', name: 'Rahul Krishnan', phone: '+91 94470 11223', email: 'rahul@example.com',
        points: 890, skin: 'Oily', preferred: ['Oud', 'Cardamom', 'Cedarwood'], disliked: ['Jasmine'],
        remarks: 'Loves strong sillage and long-lasting spicy/woody scents.',
        birthday: '1988-06-14', anniversary: null
      },
      {
        id: 'c3', name: 'Dr. Jishnu Sen', phone: '+91 99612 88776', email: 'jishnu@example.com',
        points: 1200, skin: 'Normal', preferred: ['Bergamot', 'Neroli', 'Sandalwood'], disliked: ['Rose'],
        remarks: 'Prefers fresh citrus for daytime/clinic, sandalwood for evenings.',
        birthday: '1985-11-22', anniversary: '2015-01-20'
      }
    ];
    for (const c of seedCustomers) {
      await client.query(
        `INSERT INTO customers (id, name, phone, email, loyalty_points, skin_type, preferred_notes, disliked_notes, remarks, birthday, anniversary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [c.id, c.name, encrypt(c.phone), encrypt(c.email), c.points, c.skin, c.preferred, c.disliked, c.remarks, c.birthday, c.anniversary]
      );
    }

    console.log("⏳ Seeding perfumes...");
    // 1. Royal Oud Extreme
    await client.query(`
      INSERT INTO perfumes (id, name, brand, family, gender, notes, image, description) VALUES
      ('p1', 'Royal Oud Extreme', 'AURA Artisan', 'Woody', 'Unisex', ARRAY['Assam Oud', 'Cedarwood', 'Sandalwood', 'Musk'], 'assets/images/oud.png', 'A deep, prestigious formulation highlighting wild-harvested Assam Oud. Complemented by Mysore sandalwood and smoky musk.');
    `);
    // 2. Neroli & Bergamot Breeze
    await client.query(`
      INSERT INTO perfumes (id, name, brand, family, gender, notes, image, description) VALUES
      ('p2', 'Neroli & Bergamot Breeze', 'AURA Artisan', 'Fresh', 'Unisex', ARRAY['Italian Bergamot', 'Neroli', 'Petitgrain', 'Sea Salt'], 'assets/images/citrus.png', 'A bright, uplifting splash of sun-drenched Italian bergamot blended with hand-picked neroli blossoms.');
    `);
    // 3. Jasmine & Velvet Rose
    await client.query(`
      INSERT INTO perfumes (id, name, brand, family, gender, notes, image, description) VALUES
      ('p3', 'Jasmine & Velvet Rose', 'AURA Artisan', 'Floral', 'Feminine', ARRAY['Mogra Jasmine', 'Velvet Rose', 'Vanilla', 'Amber'], 'assets/images/rose.png', 'An opulent bouquet of fresh Mogra jasmine and damask roses, anchored by a warm vanilla-amber base.');
    `);
    // 4. Cardamom & Saffron Wood
    await client.query(`
      INSERT INTO perfumes (id, name, brand, family, gender, notes, image, description) VALUES
      ('p4', 'Cardamom & Saffron Wood', 'AURA Artisan', 'Spicy', 'Masculine', ARRAY['Kerala Cardamom', 'Kashmiri Saffron', 'Leather', 'Patchouli'], 'assets/images/spicy.png', 'A sophisticated blend of warm Kerala cardamom and precious Kashmiri saffron, resting on rich leather and patchouli.');
    `);

    console.log("⏳ Seeding variants...");
    // p1 Variants
    await client.query(`
      INSERT INTO variants (id, perfume_id, size, concentration, price, sku, barcode) VALUES
      ('v1', 'p1', '30ml', 'Attar', 3499.00, 'AUR-ROD-ATT-30', '8901001001'),
      ('v2', 'p1', '50ml', 'EDP', 4999.00, 'AUR-ROD-EDP-50', '8901001002'),
      ('v3', 'p1', '100ml', 'EDP', 7999.00, 'AUR-ROD-EDP-100', '8901001003');
    `);
    // p2 Variants
    await client.query(`
      INSERT INTO variants (id, perfume_id, size, concentration, price, sku, barcode) VALUES
      ('v4', 'p2', '50ml', 'EDT', 2899.00, 'AUR-NBB-EDT-50', '8901001004'),
      ('v5', 'p2', '100ml', 'EDP', 4499.00, 'AUR-NBB-EDP-100', '8901001005');
    `);
    // p3 Variants
    await client.query(`
      INSERT INTO variants (id, perfume_id, size, concentration, price, sku, barcode) VALUES
      ('v6', 'p3', '50ml', 'EDP', 3299.00, 'AUR-JVR-EDP-50', '8901001006'),
      ('v7', 'p3', '100ml', 'EDP', 5200.00, 'AUR-JVR-EDP-100', '8901001007');
    `);
    // p4 Variants
    await client.query(`
      INSERT INTO variants (id, perfume_id, size, concentration, price, sku, barcode) VALUES
      ('v8', 'p4', '50ml', 'EDP', 3699.00, 'AUR-CSW-EDP-50', '8901001008'),
      ('v9', 'p4', '100ml', 'EDP', 5800.00, 'AUR-CSW-EDP-100', '8901001009');
    `);

    console.log("⏳ Seeding inventory stock batches...");
    await client.query(`
      INSERT INTO batches (id, perfume_id, variant_id, batch_no, mfg_date, exp_date, cost, qty_current, qty_initial) VALUES
      ('b1', 'p1', 'v1', 'B-OUD-26A', '2026-01-10', '2031-01-10', 1500.00, 18, 20),
      ('b2', 'p1', 'v2', 'B-OUD-26A', '2026-01-10', '2031-01-10', 2200.00, 18, 20),
      ('b3', 'p1', 'v3', 'B-OUD-26A', '2026-01-10', '2031-01-10', 3500.00, 18, 20),
      ('b4', 'p2', 'v4', 'B-CIT-26B', '2024-02-15', '2029-02-15', 1200.00, 25, 30),
      ('b5', 'p2', 'v5', 'B-CIT-26B', '2024-02-15', '2029-02-15', 1800.00, 25, 30),
      ('b6', 'p3', 'v6', 'B-FLO-26A', '2025-03-01', '2030-03-01', 1400.00, 12, 15),
      ('b7', 'p3', 'v7', 'B-FLO-26A', '2025-03-01', '2030-03-01', 2200.00, 14, 15),
      ('b8', 'p4', 'v8', 'B-SPI-26C', '2025-05-20', '2030-05-20', 1600.00, 10, 10),
      ('b9', 'p4', 'v9', 'B-SPI-26C', '2025-05-20', '2030-05-20', 2500.00, 9, 10);
    `);

    console.log("🏁 Database seeding complete!");
  } catch (err) {
    console.error("❌ Error during database seeding:", err);
  } finally {
    client.release();
    await pool.end();
  }
};

seedData();
