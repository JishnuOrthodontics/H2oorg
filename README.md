# H2O Perfume Retail POS

Point-of-sale for H2O perfume retail: checkout, inventory, customers, and basic reporting.

| Layer | Host |
| --- | --- |
| Frontend | [Cloudflare](https://www.h2oorg.com) (publishes `frontend/` at domain root) |
| API | [Render](https://h2o-pos-api.onrender.com) free web service (`h2o-pos-api`) |
| Database | [Supabase](https://supabase.com) Postgres (`h2o-pos`) |
| Payments | [Razorpay](https://razorpay.com) Checkout (card + UPI) |

Repo: [JishnuOrthodontics/H2oorg](https://github.com/JishnuOrthodontics/H2oorg)

## Stack

- **Frontend:** static HTML/CSS/JS (`frontend/`)
- **Backend:** Node.js + Express (`backend/`)
- **DB:** PostgreSQL via `pg` (Supabase; use the Session pooler URI for IPv4)
- **Auth:** JWT (`JWT_SECRET`)
- **PII:** customer phone/email encrypted at rest (AES-256-GCM, `PII_ENCRYPTION_KEY`)
- **Payments:** Razorpay Orders + Checkout.js + webhook (`payment.captured`)

## Repo layout

```
frontend/          POS UI + local static server
backend/           Express API, seed, payments, PII helpers
render.yaml        Render Blueprint for h2o-pos-api
H2O_Implementation_Roadmap.md
```

## Local development

### 1. Backend

```bash
cd backend
cp .env.example .env
# Fill DATABASE_URL, JWT_SECRET, PII_ENCRYPTION_KEY, FRONTEND_ORIGIN
# Optional for digital pay: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
npm install
npm run db:migrate-payments   # idempotent; also runs on server start
# npm run db:seed             # only for empty DBs (drops tables)
npm run dev
```

API: `http://localhost:5000` · health: `GET /health` (includes `razorpay: configured|not_configured`)

### 2. Frontend

```bash
cd frontend
node server.js
```

Open `http://localhost:8080`. On localhost, `config.js` points at `http://localhost:5000/api`.

**Checkout:** Cash Pay (full total) or **Pay (Card / UPI)** via Razorpay. Optional split: enter cash amount → remainder charged on Razorpay. Barcode scanners: focus search, scan, Enter.

## Environment

See `.env.example` / `backend/.env.example`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres URI (prefer Session pooler) |
| `JWT_SECRET` | ≥32 char secret for tokens |
| `PII_ENCRYPTION_KEY` | ≥32 char secret for phone/email encryption |
| `FRONTEND_ORIGIN` | Comma-separated allowed CORS origins |
| `RAZORPAY_KEY_ID` | Razorpay Key Id (`rzp_test_…` or live) |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signing secret |
| `TWILIO_ACCOUNT_SID` / `AUTH_TOKEN` / `FROM` | Optional SMS (else outbox `logged`) |
| `CRON_SECRET` | Optional auth for birthday-offers cron |
| `PORT` | API port (default `5000`) |

Never commit `.env`. Production secrets live in the Render dashboard.

### Razorpay on Render

1. Add the three `RAZORPAY_*` env vars on service `h2o-pos-api` (Blueprint lists them as secrets).
2. Razorpay Dashboard → Webhooks → URL:  
   `https://h2o-pos-api.onrender.com/api/webhooks/razorpay`  
   Events: `payment.captured`, `payment.failed`.
3. Client verify (`POST /api/payments/verify`) is the primary UX path; webhook reconciles if the browser closes mid-flow. Free-tier cold starts can delay webhooks — wake the service before a live sale if needed.

### Staff security (Phase 2)

- Sales store `employee_id` from the JWT; Reports shows **Sales & commission by staff** (5% of paid subtotal).
- Cashiers need a **Manager PIN** (seeded manager: `jishnu` / `9999`) to void sales, edit cart prices, restock, or add products. Managers skip the prompt.
- POS topbar **Clock In / Clock Out** writes `shift_logs` (`GET /api/shifts/me`).

### CRM & reports (Phase 3)

- Reports: **Top performers** (brand/family/note) and **Dead stock** (N days).
- CRM: birthday/anniversary; **Upcoming occasions**; Queue SMS / run birthday offers.
- Loyalty: Silver (&lt;500) / Gold (500–1499) / Platinum (≥1500); redeem **100 pts = ₹100** at checkout.
- Twilio: set `TWILIO_*` on Render. Cron: `POST /api/crm/birthday-offers/run` with header `X-Cron-Secret: $CRON_SECRET` (or Manager JWT).

## Production

- **Site:** https://www.h2oorg.com  
- **API:** https://h2o-pos-api.onrender.com/api  
- **Health:** https://h2o-pos-api.onrender.com/health  

Redeploy API: push to `main` (Render Blueprint sync) or **Manual Sync** on the `h2o-pos` Blueprint.

## Scripts (`backend/`)

| Command | Description |
| --- | --- |
| `npm start` | Production server |
| `npm run dev` | Nodemon |
| `npm run db:seed` | Schema + seed data (destructive) |
| `npm run db:migrate-pii` | Encrypt existing plaintext customer PII |
| `npm run db:migrate-payments` | Add payment columns / `payment_orders` / `payment_splits` |
| `npm run db:migrate-phase2` | employee_id, void fields, `shift_logs`, `audit_overrides` |
| `npm run db:migrate-phase3` | birthday/anniversary, `loyalty_redemptions`, `message_outbox` |

## Roadmap

Phased work is tracked in [`H2O_Implementation_Roadmap.md`](./H2O_Implementation_Roadmap.md). **Phase 0–3** complete in code. Add Razorpay / Twilio keys on Render when ready for live payments and SMS.
