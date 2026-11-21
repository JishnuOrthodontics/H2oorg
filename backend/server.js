const express = require('express');
const cors = require('cors');
const { validateEnv, getAllowedOrigins } = require('./config/env');
const apiRouter = require('./routes/api');
const db = require('./config/db');

validateEnv();

const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = getAllowedOrigins();

app.use(cors({
    origin(origin, callback) {
        // Allow non-browser clients (curl, server-to-server) with no Origin header
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        console.warn(`CORS blocked for origin: ${origin}`);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use('/api', apiRouter);

app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT NOW()');
        res.json({
            status: 'UP',
            timestamp: new Date(),
            services: {
                api: 'healthy',
                database: 'connected'
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔒 CORS allowed origins: ${allowedOrigins.join(', ')}`);
});
