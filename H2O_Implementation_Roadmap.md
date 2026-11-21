# H2O Perfume Retail POS — Implementation Roadmap

Repo: https://github.com/JishnuOrthodontics/H2oorg
Live site target: h2oorg.com
**Hosting:** frontend on **Cloudflare** · Postgres on **Supabase** (`h2o-pos` / `psavsjxqrcvximffbivu`) · Express API on **Render** free (`render.yaml` → `h2o-pos-api`)
Based on: client brief `POS CHART.docx` / `POS_System_Implementation_Requirements.xlsx` (REQ-01–REQ-10), cross-checked against the actual code in `backend/` and `frontend/` as of commit `12a64c4` (2026-11-21).

Status legend: ✅ Done · 🟡 Partial/simulated · ⬜ Not started

---

## Phase 0 — Make it production-safe (before anyone takes real money)
Goal: the demo becomes a real, deployable system without changing its feature set.

- 🟡 Point Cloudflare frontend at a hosted Express API using **Supabase Postgres**.
  - **Code ready:** `frontend/config.js`, SSL-aware `backend/config/db.js`, Phase 0 security hardening.
  - **Done:** Supabase project **`h2o-pos`** (`psavsjxqrcvximffbivu`, Mumbai). `backend/.env` uses Session pooler (IPv4). Schema + seed + encrypted PII loaded.
  - **Still needed:** host Express API (free) with same env vars; point `frontend/config.js` at that API URL; push so Cloudflare picks it up.
- ✅ Remove hardcoded JWT fallback secret; require `JWT_SECRET` from env.
- ✅ Lock down CORS to Cloudflare origins via `FRONTEND_ORIGIN`.
- ✅ Fix path handling in `frontend/server.js` (path-traversal guard).
- ✅ Encrypt customer phone/email at rest (AES-256-GCM).
- ✅ `.env.example` + `.env` gitignored.

**Exit criteria:** backend reachable over HTTPS from a real domain, no secrets in source, customer PII encrypted at rest.
**Status:** security code done; Supabase project + API host wiring in progress.

### Phase 0 finish checklist (Cloudflare + Supabase)
1. Create Supabase project → copy Database URI into `backend/.env` as `DATABASE_URL`.
2. Set `JWT_SECRET`, `PII_ENCRYPTION_KEY`, `FRONTEND_ORIGIN=https://h2oorg.com,https://www.h2oorg.com`.
3. Run `npm run db:seed` against Supabase (or `db:migrate-pii` if data already exists).
4. Host Express API somewhere free (e.g. Render free / Fly free) with the same env vars — Supabase is the DB, not the Node host.
5. Set `frontend/config.js` → `https://<api-host>/api` and push so Cloudflare redeploys.
6. Confirm `GET https://<api-host>/health` → `database: connected` from the live site.

---

## Phase 1 — Complete core checkout (REQ-01)
- ⬜ Card payment acceptance (Visa/Mastercard/RuPay) — needs a real payment gateway (Razorpay/PayU/Cashfree support cards + UPI in one SDK; consider replacing the fake PhonePe flow with one of these for both card and UPI).
- ⬜ Real payment confirmation via webhook instead of the 6-second `setTimeout` in `processPhonePePayment()`.
- ⬜ Split payment UI (e.g. part cash + part UPI) in the cart/checkout panel.
- ⬜ Real barcode scanner input handling (HID scanners type into focused input + Enter — wire a listener on the search/cart input instead of only the "Simulate Scan" button).

**Exit criteria:** a real transaction can be taken with a real card or UPI app and reconciled against the gateway's dashboard.

---

## Phase 2 — Employee & security controls (REQ-05, part of REQ-06)
- ⬜ Per-employee commission attribution: store `employee_id` on each transaction (currently only `employee_name` string), compute commission per staff member, not a flat 5% of total daily revenue.
- ⬜ Refund / void flow with manager PIN or OTP override (none exists today).
- ⬜ Price-override and stock-adjustment guard requiring manager approval.
- ⬜ Basic clock-in/clock-out or shift log for hours tracking.

**Exit criteria:** Reports tab can show "sales & commission by staff member"; a cashier cannot refund or edit stock without a manager PIN.

---

## Phase 3 — Reporting & CRM depth (REQ-03, REQ-04)
- ⬜ "Top performers" report: revenue by brand / fragrance family / note.
- ⬜ Dead-stock report: variants with no sales in N days, by batch age.
- ⬜ Birthday/anniversary field on customer profile + scheduled WhatsApp/SMS trigger (real integration, not an `alert()`).
- ⬜ Loyalty tiers (e.g. Silver/Gold/Platinum bands) with redemption flow, replacing flat point accrual with no spend path.

**Exit criteria:** owner can answer "what's our dead stock?" and "which customers are due a birthday offer?" from the dashboard.

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
1. Which payment gateway to commit to for real cards + UPI (Razorpay/PayU/Cashfree) — affects Phase 1 scope and cost.
2. ~~Hosting choice for Phase 0~~ → **Settled: Cloudflare frontend + GCP backend (GitHub deploy).** Remaining: share the live GCP API base URL so `config.js` / CORS can be finalized.
3. Whether WhatsApp Business API (paid, needs Meta approval) or a cheaper SMS gateway is preferred for Phase 3 gifting automation.

---
*Last updated: 2026-11-21. Update this file as phases are started/completed rather than creating a new plan doc.*
