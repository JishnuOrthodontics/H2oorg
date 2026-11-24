/**
 * Load and validate required environment variables before the app starts.
 * Fail fast — never fall back to hardcoded secrets in production.
 */
require('dotenv').config();

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'PII_ENCRYPTION_KEY'];

function validateEnv() {
    const missing = REQUIRED.filter((key) => !process.env[key] || !String(process.env[key]).trim());
    if (missing.length) {
        console.error(`❌ Missing required environment variable(s): ${missing.join(', ')}`);
        console.error('   Copy backend/.env.example to backend/.env and fill in real values.');
        process.exit(1);
    }

    const key = process.env.PII_ENCRYPTION_KEY.trim();
    // Accept 32-byte hex (64 chars) or any passphrase >= 32 chars (hashed to key material)
    if (key.length < 32) {
        console.error('❌ PII_ENCRYPTION_KEY must be at least 32 characters (use a long random secret).');
        process.exit(1);
    }

    if (process.env.JWT_SECRET.trim().length < 32) {
        console.error('❌ JWT_SECRET must be at least 32 characters.');
        process.exit(1);
    }

    const rzReady = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET;
    if (!rzReady) {
        console.warn('⚠️  RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — Card/UPI checkout will return 503 until configured.');
    }

    const fbReady =
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY &&
        String(process.env.FIREBASE_PRIVATE_KEY).includes('BEGIN PRIVATE KEY');
    if (!fbReady) {
        console.warn('⚠️  FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY not set — Staff Google Sign-In will return 503 until configured.');
    }
}

function getAllowedOrigins() {
    const raw = process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGINS || '';
    const origins = raw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

    if (!origins.length) {
        // Local-dev defaults only when NODE_ENV is not production
        if (process.env.NODE_ENV === 'production') {
            console.error('❌ FRONTEND_ORIGIN (or CORS_ORIGINS) is required in production.');
            process.exit(1);
        }
        return ['http://localhost:8080', 'http://127.0.0.1:8080'];
    }
    return origins;
}

module.exports = { validateEnv, getAllowedOrigins };
