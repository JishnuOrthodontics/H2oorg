const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    console.log('backend/.env already exists — leaving it unchanged.');
    process.exit(0);
}

const jwt = crypto.randomBytes(48).toString('hex');
const pii = crypto.randomBytes(32).toString('hex');

const content = [
    'DATABASE_URL=postgresql://postgres:password@localhost:5432/h2o_pos',
    `JWT_SECRET=${jwt}`,
    `PII_ENCRYPTION_KEY=${pii}`,
    'FRONTEND_ORIGIN=http://localhost:8080,http://127.0.0.1:8080,https://h2oorg.com,https://www.h2oorg.com',
    'NODE_ENV=development',
    'PORT=5000',
    ''
].join('\n');

fs.writeFileSync(envPath, content);
console.log('Wrote backend/.env with generated JWT_SECRET and PII_ENCRYPTION_KEY.');
console.log('Update DATABASE_URL if your Postgres credentials differ.');
