# Deploying PHBL Naturals to Vercel

The repo is ready to deploy. Everything below is done once; after that every
`git push` to `main` redeploys automatically.

- Static storefront → Vercel's CDN, built from `frontend/phbl_naturals_website`
  into `dist/` by `scripts/build-static.mjs`
- API → one Vercel Function at `api/index.js`, running the Express app
- Data → Postgres (Neon or Vercel Postgres)

The storefront folder is never modified. The build copies it and injects the
`/storefront-api.js` tag into the copy.

## 1. Fix the existing project (do not create a new one)

You already have two Vercel projects connected to `memainak/phblnaturals`:
**`backend`** and **`server`**. They are not stray — both auto-deploy on every
push, and both have **failed on every push since the first commit**, because
each points at a subfolder. The function entry (`api/index.js`) and the static
build both live at the repository root.

So repurpose one instead of deleting and re-importing — it keeps the GitHub
connection that already works.

In **`backend` → Settings → Build and Deployment**:

| Setting | Change to |
| --- | --- |
| Root Directory | `./` (clear it — currently `backend`) |
| Framework Preset | Other (currently Express) |
| Build Command | `node scripts/build-static.mjs` |
| Output Directory | `dist` |
| Node.js Version | 22.x |

Rename it to something sensible while you are there (**Settings → General →
Project Name**), since `backend` now serves the whole site.

Then delete the **`server`** project — it points at the old `server/` folder,
which is superseded, and leaving it connected means a failed deployment email
on every push.

### Turn off Vercel Authentication

`backend` currently has **Vercel Authentication enabled for all deployments
except custom domains**. That means anyone opening the `.vercel.app` URL is
asked to log into Vercel first — your shoppers cannot see the store.

**Settings → Deployment Protection → Vercel Authentication → Disabled**, or
add a custom domain, which is exempt.

## 2. Add a database

In the project: **Storage → Create Database → Postgres** (Neon). Vercel adds
`DATABASE_URL` and `POSTGRES_URL` to the project automatically — the server
reads either.

Nothing else is needed: the schema is created and the catalogue seeded on the
first request after deploy.

## 3. Set the environment variables

**Settings → Environment Variables**, for Production and Preview:

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | a long random string — `openssl rand -hex 48` |
| `ADMIN_KEY` | another long random string; this opens `/admin.html` |
| `NODE_ENV` | `production` |
| `RAZORPAY_KEY_ID` | from the Razorpay dashboard (optional at first) |
| `RAZORPAY_KEY_SECRET` | from the Razorpay dashboard (optional at first) |
| `RAZORPAY_WEBHOOK_SECRET` | set after step 5 |

Do not copy the values from your local `backend/.env`. That file is gitignored
and should stay local; generate fresh secrets for production.

Without the Razorpay keys the site still works — cash on delivery only, and
online orders are saved as `pending` with a clear message to the shopper.

In production the server **refuses to start** without `SESSION_SECRET`,
`ADMIN_KEY` and `DATABASE_URL`. That is deliberate: a missing database would
otherwise lose every order silently.

## 4. Deploy

Click **Deploy**, then check:

- `https://<your-app>.vercel.app/api/health` → `"database": "postgres"`
- `https://<your-app>.vercel.app/` → the storefront, with products loaded
- `https://<your-app>.vercel.app/admin.html` → paste your `ADMIN_KEY`

If health reports `"pglite"`, `DATABASE_URL` did not reach the function — the
site would lose data, so fix that before taking orders.

## 5. Razorpay webhook

In the Razorpay dashboard: **Settings → Webhooks → Add**

- URL: `https://<your-app>.vercel.app/api/payments/razorpay/webhook`
- Events: `payment.captured` and `payment.failed`
- Copy the signing secret into `RAZORPAY_WEBHOOK_SECRET` and redeploy

The webhook is the backstop for when a shopper closes the tab mid-payment.
It is verified against the raw request bytes, so it must stay mounted ahead of
the JSON body parser — it already is.

## 6. Custom domain

**Settings → Domains → Add**, then point the DNS records Vercel shows at it.

Session cookies are `secure` in production, so the site must be served over
HTTPS — Vercel does that automatically.

## Running it locally

No database server needed. PGlite (real Postgres compiled to WASM) is used
whenever `DATABASE_URL` is absent:

```bash
cd backend && npm install && npm run dev
```

```bash
npm run smoke   # 68 end-to-end checks
```

To run the tests against real Postgres instead:

```bash
SMOKE_DATABASE_URL="postgres://…" npm run smoke
```

## Before taking real money

1. Replace the 16 demo products in `backend/src/catalogue.js` with the verified
   PHBL Naturals catalogue, prices, ingredient lists and photography
2. Set real stock levels in the admin dashboard
3. Switch Razorpay from test keys to live keys, and place one real order
4. Check `FREE_SHIPPING_OVER`, `SHIPPING_FLAT` and `COD_FEE` against real costs
5. Set up Neon's backups — the database holds every order and customer
6. Add transactional email; order confirmations are stored, not emailed
