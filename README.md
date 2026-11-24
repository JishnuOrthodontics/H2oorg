# H2O Perfume Retail POS

Point-of-sale for **HARIESH AND HELDIN ORGANIZATION (H2O)** — perfume retail storefront, staff checkout, inventory, CRM, reporting, and ledger export.

**Boutique:** 6/518/K,L, Paliyam Road, Nearby Nayara Petrol Pump, Chendamangalam, Ernakulam, Kerala, 683512 · **Phone:** +91 79073 49501 · **Email:** h2organization2025@gmail.com

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
- **Auth:** Firebase Google Sign-In → app JWT (`JWT_SECRET`); hashed Manager override PIN for cashiers
- **PII:** customer phone/email encrypted at rest (AES-256-GCM, `PII_ENCRYPTION_KEY`)
- **Payments:** Razorpay Orders + Checkout.js + webhook (`payment.captured`)

## Features

- **Public storefront:** scent finder, collections catalog (synced from API). Landing **Buy** still opens the staff POS simulation — not a customer web checkout.
- **Staff POS:** login via Staff POS Portal with **Google Sign-In** (email must be allowlisted in `users`). Checkout, barcode search, cash / Razorpay / split tender, loyalty redeem (100 pts = ₹100).
- **Inventory:** batches per variant; restock; **Add Product** with compressed **catalog image upload** (optional; default bottle image otherwise).
- **CRM:** scent profiles, birthday/anniversary, Twilio SMS outbox (or logged if keys unset).
- **Reports:** daily sales/GST, top performers, dead stock, Tally XML export.
- **Owner Live:** Manager/Owner-only sidebar tab — today’s KPIs, staff commission, low/dead stock. Not on the public nav (`owner.html` redirects into POS login).
- **Ledger:** server Tally voucher XML (+ optional `TALLY_HTTP_URL` push); optional Zoho Books sync.

## Repo layout

```
frontend/          Storefront + Staff POS UI + local static server
backend/           Express API, seed, migrations, payments, integrations
render.yaml        Render Blueprint for h2o-pos-api
H2O_Implementation_Roadmap.md
```

## Local development

### 1. Backend

```bash
cd backend
cp .env.example .env
# Fill DATABASE_URL, JWT_SECRET, PII_ENCRYPTION_KEY, FRONTEND_ORIGIN
# Fill FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
# Optional: RAZORPAY_*, TWILIO_*, TALLY_*, ZOHO_*, CRON_SECRET, STAFF_EMAIL_*
npm install
npm run db:migrate-payments        # idempotent; also runs on server start
npm run db:migrate-firebase-auth   # staff email / override_pin_hash columns
# npm run db:seed                  # only for empty DBs (drops tables)
npm run dev
```

API: `http://localhost:5000` · health: `GET /health` (shows `razorpay` / `firebaseAuth` / `twilio` / `zoho` / `tallyHttp` status)

### 2. Frontend

```bash
cd frontend
node server.js
```

Open `http://localhost:8080`. On localhost, `config.js` points at `http://localhost:5000/api`.

Fill public Firebase web keys in [`frontend/firebase-config.js`](frontend/firebase-config.js) (from Firebase Console → Project settings → Your apps).

**Checkout:** Cash Pay (full total) or **Pay (Card / UPI)** via Razorpay. Optional split: enter cash amount → remainder on Razorpay. Barcode: focus search, scan, Enter.

## Staff Google Sign-In (Firebase)

1. Create a Firebase project → **Authentication** → enable **Google**.
2. Add a **Web** app; copy config into `frontend/firebase-config.js`.
3. **Authentication → Settings → Authorized domains:** `localhost`, `h2oorg.com`, `www.h2oorg.com`.
4. **Project settings → Service accounts → Generate new private key** → set on the API:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY` (keep `\n` escapes in the env string)
5. **Staff accounts are added only by the owner** (Owner Live → Staff accounts, or seed). There is no public self-registration; Google Sign-In only works for emails already in `users`.
6. Manager override PIN (voids / price / inventory for cashiers): set when adding a Manager, or `MANAGER_OVERRIDE_PIN` on seed/migrate (default `9999`). Share out-of-band — never show on the public site.
7. Flow: Google popup → Firebase ID token → `POST /api/auth/firebase` → app JWT in `localStorage` (`h2o_pos_token`).

Unknown Google accounts receive **403**. PIN login (`POST /api/auth/login`) returns **410**. Owner APIs: `GET/POST /api/staff`, `PATCH /api/staff/:id` (Manager/Owner JWT only).

## Environment

See `.env.example` / `backend/.env.example`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres URI (prefer Session pooler) |
| `JWT_SECRET` | ≥32 char secret for tokens |
| `PII_ENCRYPTION_KEY` | ≥32 char secret for phone/email encryption |
| `FRONTEND_ORIGIN` | Comma-separated allowed CORS origins |
| `FIREBASE_PROJECT_ID` | Firebase project id (Admin SDK) |
| `FIREBASE_CLIENT_EMAIL` | Service account client email |
| `FIREBASE_PRIVATE_KEY` | Service account private key (`\n` escaped) |
| `STAFF_EMAIL_JISHNU` / `STAFF_EMAIL_SIDDHARTH` | Optional seed/migrate Google emails |
| `MANAGER_OVERRIDE_PIN` | Manager override PIN used when hashing on seed/migrate |
| `RAZORPAY_KEY_ID` | Razorpay Key Id (`rzp_test_…` or live) |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signing secret |
| `MSG91_AUTH_KEY` / `MSG91_SENDER_ID` | Preferred India SMS (Authkey + 6-char sender) |
| `MSG91_TEMPLATE_ID` / `MSG91_BODY_VAR` | DLT Flow template id; body variable (default `VAR1`) |
| `TWILIO_ACCOUNT_SID` / `AUTH_TOKEN` / `FROM` | Optional SMS fallback if MSG91 unset |
| `CRON_SECRET` | Auth for birthday-offers + Tally/Zoho cron (`X-Cron-Secret`) |
| `TALLY_HTTP_URL` / `TALLY_HTTP_TOKEN` | Optional Tally HTTP import push |
| `ZOHO_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN` / `ORG_ID` | Optional Zoho Books sync |
| `PORT` | API port (default `5000`) |

Never commit `.env`. Production secrets live in the Render dashboard.

### Razorpay on Render

1. Add the three `RAZORPAY_*` env vars on service `h2o-pos-api` (Blueprint lists them as secrets).
2. Razorpay Dashboard → Webhooks → URL:  
   `https://h2o-pos-api.onrender.com/api/webhooks/razorpay`  
   Events: `payment.captured`, `payment.failed`.
3. Client verify (`POST /api/payments/verify`) is the primary UX path; webhook reconciles if the browser closes mid-flow. Free-tier cold starts can delay webhooks — wake the service before a live sale if needed.

### Staff security (Phase 2 + Firebase)

- Staff open POS with **Google Sign-In**; only emails in `users` (`is_active`) receive a JWT. **Only the owner** can create/disable staff (Owner Live → Staff accounts).
- Sales store `employee_id` from the JWT; Reports shows **Sales & commission by staff** (5% of paid subtotal).
- Cashiers need a **Manager override PIN** (bcrypt `override_pin_hash`; seed default from `MANAGER_OVERRIDE_PIN`) to void sales, edit cart prices, restock, or add products. Managers skip the prompt.
- POS topbar **Clock In / Clock Out** writes `shift_logs` (`GET /api/shifts/me`).

### CRM & reports (Phase 3)

- Reports: **Top performers** (brand/family/note) and **Dead stock** (N days).
- CRM: birthday/anniversary; **Upcoming occasions**; Queue SMS / run birthday offers.
- Loyalty: Silver (&lt;500) / Gold (500–1499) / Platinum (≥1500); redeem **100 pts = ₹100** at checkout.
- SMS: prefer **MSG91** (`MSG91_AUTH_KEY` + `MSG91_SENDER_ID`). For India DLT, add `MSG91_TEMPLATE_ID` (Flow) so the offer text maps to `VAR1` (or `MSG91_BODY_VAR`). Twilio remains a fallback. Cron: `POST /api/crm/birthday-offers/run` with `X-Cron-Secret` (or Manager JWT).

### Ledger & Owner Live (Phase 4)

- **Tally:** Reports → Export builds XML on the API (`POST /api/integrations/tally/export`). Cron yesterday’s sales with `X-Cron-Secret`. Set `TALLY_HTTP_URL` to push; otherwise download XML from the modal.
- **Zoho (optional):** `POST /api/integrations/zoho/sync` when all `ZOHO_*` vars are set.
- **Owner Live:** Staff POS → Manager/Owner → sidebar **Owner Live** (`GET /api/owner/dashboard`).

### Inventory & catalog images

- Stock is tracked **per variant** (size/SKU); inventory table shows batch/qty/expiry for that variant.
- **Add Product** accepts an optional photo upload (JPEG/PNG/WebP/GIF). The browser compresses it; the API stores it on `perfumes.image` (TEXT). Omit the photo to keep the default bottle image.

## Production

- **Site:** https://www.h2oorg.com  
- **API:** https://h2o-pos-api.onrender.com/api  
- **Health:** https://h2o-pos-api.onrender.com/health  

Redeploy API: push to `main` (Render Blueprint sync) or **Manual Sync** on the Blueprint. Frontend updates via Cloudflare when `frontend/` lands on `main`.

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
| `npm run db:migrate-phase4` | `ledger_exports`, export timestamps, `perfumes.image` → TEXT |
| `npm run db:migrate-firebase-auth` | `users.email`, `firebase_uid`, `override_pin_hash`, `is_active` |

## Roadmap

Phased work is tracked in [`H2O_Implementation_Roadmap.md`](./H2O_Implementation_Roadmap.md). **Phase 0–4** complete in code. Phase 5 (offline queue, Shopify, multi-store) is deferred. Add Razorpay / Twilio / optional Tally HTTP or Zoho keys on Render when ready for live use.
