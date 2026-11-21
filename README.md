# H2O Perfume Retail POS

Point-of-sale for H2O perfume retail: checkout, inventory, customers, and basic reporting.

| Layer | Host |
| --- | --- |
| Frontend | [Cloudflare](https://www.h2oorg.com) (publishes `frontend/` at domain root) |
| API | [Render](https://h2o-pos-api.onrender.com) free web service (`h2o-pos-api`) |
| Database | [Supabase](https://supabase.com) Postgres (`h2o-pos`) |

Repo: [JishnuOrthodontics/H2oorg](https://github.com/JishnuOrthodontics/H2oorg)

## Stack

- **Frontend:** static HTML/CSS/JS (`frontend/`)
- **Backend:** Node.js + Express (`backend/`)
- **DB:** PostgreSQL via `pg` (Supabase; use the Session pooler URI for IPv4)
- **Auth:** JWT (`JWT_SECRET`)
- **PII:** customer phone/email encrypted at rest (AES-256-GCM, `PII_ENCRYPTION_KEY`)

## Repo layout

```
frontend/          POS UI + local static server
backend/           Express API, seed, PII helpers
render.yaml        Render Blueprint for h2o-pos-api
H2O_Implementation_Roadmap.md
```

## Local development

### 1. Backend

```bash
cd backend
cp ../.env.example .env
# Fill DATABASE_URL (Supabase pooler), JWT_SECRET, PII_ENCRYPTION_KEY, FRONTEND_ORIGIN
npm install
npm run db:seed
npm run dev
```

API: `http://localhost:5000` · health: `GET /health`

### 2. Frontend

```bash
cd frontend
node server.js
```

Open `http://localhost:8080`. On localhost, `config.js` points at `http://localhost:5000/api`.

## Environment

See `.env.example`. Required:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres URI (prefer Session pooler) |
| `JWT_SECRET` | ≥32 char secret for tokens |
| `PII_ENCRYPTION_KEY` | ≥32 char secret for phone/email encryption |
| `FRONTEND_ORIGIN` | Comma-separated allowed CORS origins |
| `PORT` | API port (default `5000`) |

Never commit `.env`. Production secrets live in the Render dashboard (Blueprint marks them `sync: false`).

## Production

- **Site:** https://www.h2oorg.com  
- **API:** https://h2o-pos-api.onrender.com/api  
- **Health:** https://h2o-pos-api.onrender.com/health  

`frontend/config.js` uses localhost for local hostnames and Render for everything else. Cloudflare serves `frontend/` from the repo root of that folder.

Redeploy API: push to `main` (Render Blueprint sync) or **Manual Sync** on the `h2o-pos` Blueprint.

## Scripts (`backend/`)

| Command | Description |
| --- | --- |
| `npm start` | Production server |
| `npm run dev` | Nodemon |
| `npm run db:seed` | Schema + seed data |
| `npm run db:migrate-pii` | Encrypt existing plaintext customer PII |

## Roadmap

Phased work (payments, staff controls, CRM, integrations) is tracked in [`H2O_Implementation_Roadmap.md`](./H2O_Implementation_Roadmap.md). **Phase 0** (production-safe deploy) is complete.
