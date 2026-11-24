const express = require('express');
const cors = require('cors');
const { validateEnv, getAllowedOrigins } = require('./config/env');
const apiRouter = require('./routes/api');
const paymentsRouter = require('./routes/payments');
const integrationsRouter = require('./routes/integrations');
const webhooksRouter = require('./routes/webhooks');
const db = require('./config/db');
const { migratePayments } = require('./scripts/migrate-payments');
const { migratePhase2 } = require('./scripts/migrate-phase2');
const { migratePhase3 } = require('./scripts/migrate-phase3');
const { migratePhase4 } = require('./scripts/migrate-phase4');
const { migrateFirebaseAuth } = require('./scripts/migrate-firebase-auth');
const { isConfigured } = require('./config/razorpay');
const { isFirebaseConfigured, initFirebaseAdmin } = require('./config/firebase');
const { isTwilioConfigured, isMsg91Configured, smsProvider } = require('./services/messaging');
const { isZohoConfigured } = require('./services/zohoBooks');

validateEnv();

const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = getAllowedOrigins();

// Render / reverse proxies — needed for express-rate-limit client IP
app.set('trust proxy', 1);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        console.warn(`CORS blocked for origin: ${origin}`);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Cron-Secret']
}));

// Razorpay webhooks need the raw body for HMAC verification
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

app.use(express.json({ limit: '2mb' }));

app.use('/api', apiRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/integrations', integrationsRouter);

app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT NOW()');
        res.json({
            status: 'UP',
            timestamp: new Date(),
            services: {
                api: 'healthy',
                database: 'connected',
                razorpay: isConfigured() ? 'configured' : 'not_configured',
                sms: smsProvider(),
                msg91: isMsg91Configured() ? 'configured' : 'not_configured',
                twilio: isTwilioConfigured() ? 'configured' : 'not_configured',
                zoho: isZohoConfigured() ? 'configured' : 'not_configured',
                tallyHttp: process.env.TALLY_HTTP_URL ? 'configured' : 'not_configured',
                firebaseAuth: isFirebaseConfigured() ? 'configured' : 'not_configured'
            }
        });
    } catch (err) {
        res.status(500).json({
            status: 'DOWN',
            timestamp: new Date(),
            services: {
                api: 'healthy',
                database: 'disconnected',
                error: err.message
            }
        });
    }
});

app.get('/', (req, res) => {
    res.send('H2O Perfume Retail POS Cloud Backend API is running.');
});

if (isFirebaseConfigured()) {
    try {
        initFirebaseAdmin();
        console.log('🔥 Firebase Admin initialized for staff Google Sign-In');
    } catch (err) {
        console.error('Firebase Admin init failed:', err.message);
    }
}

Promise.all([
    migratePayments().catch((err) => console.error('Payment migration on boot failed:', err.message)),
    migratePhase2().catch((err) => console.error('Phase 2 migration on boot failed:', err.message)),
    migratePhase3().catch((err) => console.error('Phase 3 migration on boot failed:', err.message)),
    migratePhase4().catch((err) => console.error('Phase 4 migration on boot failed:', err.message)),
    migrateFirebaseAuth().catch((err) => console.error('Firebase auth migration on boot failed:', err.message))
]).finally(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🔒 CORS allowed origins: ${allowedOrigins.join(', ')}`);
        console.log(`💳 Razorpay: ${isConfigured() ? 'configured' : 'not configured (set RAZORPAY_* env)'}`);
        console.log(`🔥 Firebase Auth: ${isFirebaseConfigured() ? 'configured' : 'not configured (set FIREBASE_* env)'}`);
        console.log(`📱 SMS provider: ${smsProvider()}${isMsg91Configured() ? ' (MSG91)' : isTwilioConfigured() ? ' (Twilio)' : ' — messages logged to outbox'}`);
        console.log(`📒 Zoho Books: ${isZohoConfigured() ? 'configured' : 'not configured'}`);
        console.log(`📥 Tally HTTP: ${process.env.TALLY_HTTP_URL ? 'configured' : 'generate-only (set TALLY_HTTP_URL to push)'}`);
    });
});
