# H2O Perfume Retail POS — Implementation Roadmap

Repo: https://github.com/JishnuOrthodontics/H2oorg
Live site target: h2oorg.com
**Hosting:** frontend on **Cloudflare** · Postgres on **Supabase** (`h2o-pos` / `psavsjxqrcvximffbivu`) · Express API on **Render** free (`render.yaml` → `h2o-pos-api`)
Based on: client brief `POS CHART.docx` / `POS_System_Implementation_Requirements.xlsx` (REQ-01–REQ-10), cross-checked against the actual code in `backend/` and `frontend/` as of commit `12a64c4` (2026-11-21).

Status legend: ✅ Done · 🟡 Partial/simulated · ⬜ Not started

---

## Phase 0 — Make it production-safe (before anyone takes real money)
Goal: the demo becomes a real, deployable system without changing its feature set.

- ✅ Point Cloudflare frontend at hosted Express API using **Supabase Postgres**.
  - Supabase **`h2o-pos`** (`psavsjxqrcvximffbivu`, Mumbai) via Session pooler; schema + seed + encrypted PII loaded.
  - Render free **`h2o-pos-api`** (`render.yaml`); `frontend/config.js` → `https://h2o-pos-api.onrender.com/api`.
  - `GET /health` → `database: connected` (verified 2026-11-21).
- ✅ Remove hardcoded JWT fallback secret; require `JWT_SECRET` from env.
- ✅ Lock down CORS to Cloudflare origins via `FRONTEND_ORIGIN`.
- ✅ Fix path handling in `frontend/server.js` (path-traversal guard).
- ✅ Encrypt customer phone/email at rest (AES-256-GCM).
- ✅ `.env.example` + `.env` gitignored.

**Exit criteria:** backend reachable over HTTPS from a real domain, no secrets in source, customer PII encrypted at rest.
**Status:** ✅ Complete (Cloudflare + Supabase + Render).

### Phase 0 finish checklist (Cloudflare + Supabase)
1. ✅ Create Supabase project → copy Database URI into `backend/.env` as `DATABASE_URL`.
2. ✅ Set `JWT_SECRET`, `PII_ENCRYPTION_KEY`, `FRONTEND_ORIGIN=https://h2oorg.com,https://www.h2oorg.com`.
3. ✅ Run `npm run db:seed` against Supabase (or `db:migrate-pii` if data already exists).
4. ✅ Host Express API on Render free with the same env vars — Supabase is the DB, not the Node host.
5. ✅ Set `frontend/config.js` → `https://h2o-pos-api.onrender.com/api` and push so Cloudflare redeploys.
6. ✅ Confirm `GET https://h2o-pos-api.onrender.com/health` → `database: connected`.

---

## Phase 1 — Complete core checkout (REQ-01)
- ✅ Card + UPI via **Razorpay Checkout.js** (replaces PhonePe mock). Backend: `POST /api/payments/create-order` + `POST /api/payments/verify`.
- ✅ Payment confirmation via signature verify + `POST /api/webhooks/razorpay` (`payment.captured` / `payment.failed`); no timer auto-complete.
- ✅ Split tender UI: optional cash amount + Razorpay remainder in the cart panel (`payment_splits`).
- ✅ HID barcode: `#pos-product-search` Enter exact-matches `barcode`/`sku` and adds to cart (Simulate Scan kept as fallback).

**Exit criteria:** a real transaction can be taken with a real card or UPI app and reconciled against the gateway's dashboard.
**Status:** 🟡 Code complete — add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` on Render + webhook URL `https://h2o-pos-api.onrender.com/api/webhooks/razorpay`, then take a Test-mode payment to close Phase 1.

---

## Phase 2 — Employee & security controls (REQ-05, part of REQ-06)
- ✅ Per-employee commission: `employee_id` on sales; `GET /reports/summary` returns `byEmployee` (5% of that staff’s paid subtotal).
- ✅ Void/refund: `POST /transactions/:id/void` restores stock + reverses loyalty; Manager PIN required for cashiers (`audit_overrides`).
- ✅ Price override (cart) + stock adjust (restock / add product / catalog price) gated by Manager PIN for non-managers.
- ✅ Shift log: `POST /shifts/clock-in|clock-out`, `GET /shifts/me`; POS topbar Clock In/Out.

**Exit criteria:** Reports tab can show "sales & commission by staff member"; a cashier cannot refund or edit stock without a manager PIN.
**Status:** ✅ Complete (Manager PIN override; no SMS OTP).

---

## Phase 3 — Reporting & CRM depth (REQ-03, REQ-04)
- ✅ Top performers: `GET /reports/top-performers?groupBy=brand|family|note` (+ Reports UI).
- ✅ Dead stock: `GET /reports/dead-stock?days=N` (qty & batch age; Reports UI).
- ✅ Birthday/anniversary on customers; `GET /crm/upcoming-occasions`; Twilio SMS outbox + `POST /crm/birthday-offers/run` (no fake `alert()` success).
- ✅ Loyalty tiers Silver/Gold/Platinum; redeem 100 pts = ₹100 at checkout; void restores redemptions.

**Exit criteria:** owner can answer "what's our dead stock?" and "which customers are due a birthday offer?" from the dashboard.
**Status:** ✅ Complete (Twilio optional — without keys, SMS rows are `logged` in `message_outbox`).

---

## Phase 4 — Integration polish (REQ-06, REQ-07)
- ⬜ Automate Tally export (currently manual XML download) — scheduled push or Tally's HTTP import API.
- ⬜ Optional: Zoho Books sync as an alternative ledger integration.
- ⬜ Dedicated owner/manager remote dashboard view (read-only KPIs + inventory) distinct from the cashier POS screen, confirmed usable from a phone browser off the store Wi-Fi.

**Exit criteria:** daily sales land in the accounting ledger without manual file handling; owner checks the shop from home on a phone.

---

## Phase 5 — Future scope (REQ-08, REQ-09, REQ-10 — explicitly deferred in the original brief)
- ⬜ True offline-first mode: local write queue that replays to the backend on reconnect (today's "mock mode" fallback just keeps using stale in-memory data, it doesn't queue and sync).
- ⬜ Shopify/WooCommerce catalog sync if an e-commerce storefront launches.
- ⬜ Multi-store data model (`store_id` on inventory/transactions) + inter-branch stock transfer requests, ahead of the Calicut/Trivandrum expansion mentioned in the brief.

---

## Open decisions needed from the owner
1. ~~Payment gateway~~ → **Settled: Razorpay** (Test keys first; switch to Live when ready).
2. ~~Hosting choice for Phase 0~~ → **Settled: Cloudflare frontend + Supabase Postgres + Render Express (`h2o-pos-api.onrender.com`).**
3. ~~Gifting channel~~ → **Settled: Twilio SMS** via `message_outbox` (WhatsApp can reuse the same outbox later).

---
*Last updated: 2026-11-22. Update this file as phases are started/completed rather than creating a new plan doc.*
