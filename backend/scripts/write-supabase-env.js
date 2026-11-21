/**
 * Builds backend/.env for Supabase once you have the DB password.
 * Usage (from repo root):
 *   node backend/scripts/write-supabase-env.js "YOUR_DB_PASSWORD"
 *
 * Project: h2o-pos (psavsjxqrcvximffbivu) — Mumbai / ap-south-1
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node backend/scripts/write-supabase-env.js "<database-password>"');
  process.exit(1);
}

const projectRef = 'psavsjxqrcvximffbivu';
const region = 'ap-south-1';
const encoded = encodeURIComponent(password);
// Use Session pooler (IPv4). Direct db.*.supabase.co is IPv6-only and fails on many networks.
const databaseUrl = `postgresql://postgres.${projectRef}:${encoded}@aws-0-${region}.pooler.supabase.com:5432/postgres`;

const envPath = path.join(__dirname, '..', '.env');
let jwt = crypto.randomBytes(48).toString('hex');
let pii = crypto.randomBytes(32).toString('hex');

if (fs.existsSync(envPath)) {
  const existing = fs.readFileSync(envPath, 'utf8');
  const jwtMatch = existing.match(/^JWT_SECRET=(.+)$/m);
  const piiMatch = existing.match(/^PII_ENCRYPTION_KEY=(.+)$/m);
  if (jwtMatch) jwt = jwtMatch[1].trim();
  if (piiMatch) pii = piiMatch[1].trim();
}

const content = [
  `# Supabase project h2o-pos (${projectRef}) — do not commit`,
  `DATABASE_URL=${databaseUrl}`,
  `JWT_SECRET=${jwt}`,
  `PII_ENCRYPTION_KEY=${pii}`,
  'FRONTEND_ORIGIN=http://localhost:8080,http://127.0.0.1:8080,https://h2oorg.com,https://www.h2oorg.com',
  'NODE_ENV=development',
  'PORT=5000',
  ''
].join('\n');

fs.writeFileSync(envPath, content);
console.log('Wrote backend/.env for Supabase project', projectRef);
console.log('Next: cd backend && npm run db:seed');
