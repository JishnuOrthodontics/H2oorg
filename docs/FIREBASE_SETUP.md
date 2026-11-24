# Firebase Google Sign-In setup (H2O Staff POS)

Do these steps once. When finished, staff sign in with Google on **Staff POS Portal**.

## A. Create the Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or use an existing project).
3. Name it e.g. `h2o-pos` → continue.
4. Google Analytics: optional (you can disable) → **Create project**.

## B. Enable Google Sign-In

1. Left sidebar → **Build** → **Authentication**.
2. Click **Get started** if prompted.
3. Open the **Sign-in method** tab.
4. Click **Google** → enable → set a support email → **Save**.

## C. Add a Web app (public config)

1. Project overview (gear) → **Project settings**.
2. Under **Your apps**, click the **Web** icon `</>`.
3. App nickname: `H2O Staff POS` → register (Hosting optional: skip).
4. Copy the `firebaseConfig` object fields:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`
5. Paste them into [`frontend/firebase-config.js`](../frontend/firebase-config.js).

## D. Authorized domains

1. **Authentication** → **Settings** → **Authorized domains**.
2. Ensure these exist (add if missing):
   - `localhost`
   - `h2oorg.com`
   - `www.h2oorg.com`

## E. Service account (backend Admin SDK)

1. **Project settings** → **Service accounts**.
2. Click **Generate new private key** → confirm download of a JSON file.
3. From that JSON, set in `backend/.env` (and Render later):

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-.....@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n....\n-----END PRIVATE KEY-----\n"
```

Notes:
- `project_id` → `FIREBASE_PROJECT_ID`
- `client_email` → `FIREBASE_CLIENT_EMAIL`
- `private_key` → `FIREBASE_PRIVATE_KEY` (keep the `\n` characters as a single-line quoted string)
- **Never commit** the JSON or `.env`.

## F. Allowlist the owner email

Your DB should already have the owner email from migration (`h2organization2025@gmail.com` for `jishnu`). Sign in with that Google account first.

To add more staff later: **Staff POS → Owner Live → Staff accounts** (owner only).

## G. Local smoke test

```bash
cd backend
npm run dev

cd frontend
node server.js
```

1. Open `http://localhost:8080`
2. **Staff POS Portal** → **Sign in with Google**
3. Use the allowlisted Google account
4. You should enter the POS (not a 403)

## H. Production (Render + Cloudflare)

1. Render service `h2o-pos-api` → Environment → add the three `FIREBASE_*` vars → save/redeploy.
2. Deploy updated `frontend/firebase-config.js` with Cloudflare (push to `main`).
3. Confirm authorized domains include `www.h2oorg.com`.

## Checklist

- [ ] Google provider enabled
- [ ] Web app config in `firebase-config.js`
- [ ] Domains: localhost + h2oorg.com + www.h2oorg.com
- [ ] `FIREBASE_*` in local `.env`
- [ ] `FIREBASE_*` on Render
- [ ] Owner Google email in `users.email`
- [ ] Local Google login works
