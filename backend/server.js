const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const apiRouter = require('./routes/api');
const db = require('./config/db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Configure CORS
app.use(cors({
    origin: '*', // In production, restrict this to your frontend domain (e.g., https://pos.auraparfums.com)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Mount routes
app.use('/api', apiRouter);

// Health Check Endpoint
app.get('/health', async (req, res) => {
    try {
        const dbCheck = await db.query('SELECT NOW()');
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

// Root Endpoint
app.get('/', (req, res) => {
    res.send('🌌 AURA Perfumery POS Cloud Backend API is running.');
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API Health Check available at http://localhost:${PORT}/health`);
});
