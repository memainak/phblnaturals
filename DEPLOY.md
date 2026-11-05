# Deploying PHBL Naturals: Vercel + Supabase + GitHub

- **GitHub** `memainak/phblnaturals`, every push to `main` redeploys
- **Vercel** serves the storefront (`dist/`, built by `scripts/build-static.mjs`) and
  runs the Express API as one function (`api/index.js`)
- **Supabase** is the Postgres database

The storefront folder is never modified. The build copies it and injects the
`/storefront-api.js` tag into the copy.

## 1. Supabase: get the connection string

Project **phblnaturals** → **Connect** → **Direct** tab → **Transaction pooler** →
copy the URI. It ends in `:6543/postgres` and the host contains `pooler.supabase.com`.

Use the pooler, not the direct 5432 connection. Every function instance opens
its own pool, so a burst of cold starts exhausts Postgres's connection limit on
the direct port. `config.js` warns at boot if it sees Supabase without `:6543`.

Passwords with special characters must be percent-encoded (`@` is `%40`);
easiest is to reset the database password to letters and digits only.

There are no tables to create. The schema is applied and the catalogue seeded on
the first request.

## 2. Vercel: fix the existing project

The `backend` project is already connected to the GitHub repo but points at the
wrong folder, so every push fails. In **Vercel → backend → Settings**:

| Where | Setting | Value |
| --- | --- | --- |
| General | Project Name | `phbl-naturals` (optional) |
| Build and Deployment | **Root Directory** | **empty** (currently `backend`). This is the one that matters |
| Build and Deployment | Framework Preset | Other |
| Build and Deployment | Build / Output / Install | leave on defaults; `vercel.json` sets them |
| Deployment Protection | **Vercel Authentication** | **Disabled**. Otherwise shoppers see a Vercel login |

Everything else (build command, output directory, Node 22, the function region
`hnd1`, the `/api` rewrite) comes from `vercel.json` in the repo.

Delete the **`server`** project; it points at the old `server/` folder and
fails on every push.

## 3. Vercel: environment variables

**Settings → Environment Variables**, scope Production (and Preview if wanted):

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the pooler URI from step 1 |
| `SESSION_SECRET` | `openssl rand -hex 48` |
| `ADMIN_KEY` | `openssl rand -hex 24` (this opens `/admin.html`; keep a copy) |
| `NODE_ENV` | `production` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | from Razorpay, or leave unset. COD works without them |

In production the server **refuses to start** without `SESSION_SECRET`,
`ADMIN_KEY` and `DATABASE_URL`. That is deliberate: a missing database would
otherwise fall back to a local file and lose orders silently.

## 4. Deploy and check

Push to `main` (or **Deployments → Redeploy**), then:

```bash
curl https://<your-app>.vercel.app/api/health
```

- `"database": "postgres"` is correct
- `"database": "pglite"` means `DATABASE_URL` did not reach the function. Stop and fix it

Place one cash-on-delivery order and confirm it appears at `/admin.html` and in
Supabase's **Table Editor** (`orders`, `order_items`, `products`...), with the
stock reduced.

## 5. Razorpay webhook

Razorpay → **Settings → Webhooks → Add**: URL
`https://<your-app>.vercel.app/api/payments/razorpay/webhook`, events
`payment.captured` and `payment.failed`. Put the signing secret in
`RAZORPAY_WEBHOOK_SECRET` and redeploy.

## 6. Custom domain

**Settings → Domains → Add**. Session cookies are `secure` in production, which
Vercel's HTTPS satisfies.

## Region

The function runs in `hnd1` (Tokyo) because the Supabase project is in Tokyo
(`ap-northeast-1`); keeping them together matters more than distance to the
shopper, since checkout makes several sequential queries. If you recreate
Supabase in Mumbai, change `regions` in `vercel.json` to `["bom1"]`.

## Running locally

No database server, Docker or Java: PGlite (real Postgres in WASM) is used when
`DATABASE_URL` is unset.

```bash
cd backend && npm install && npm run dev
npm run smoke   # 68 end-to-end checks
npm run race    # 8 simultaneous checkouts for one unit of stock
```

Against real Postgres (worth doing once before launch, because PGlite is a
single connection and cannot truly contend for a row):

```bash
SMOKE_DATABASE_URL="postgresql://...:6543/postgres" npm run smoke
RACE_DATABASE_URL="postgresql://...:6543/postgres" npm run race
```

## Leftovers from the Firebase attempt

The Firebase project `phblnaturals-50d1c` still hosts an old storefront, a
Firestore-backed function and six secrets. Nothing points at them. Delete the
project in the Firebase console when convenient, or leave it; it costs nothing
idle.

## Before taking real money

1. Replace the 16 demo products in `backend/src/catalogue.js` with the real catalogue
2. Set real stock in the admin dashboard
3. Move Razorpay to live keys and place one real order
4. Check `FREE_SHIPPING_OVER`, `SHIPPING_FLAT`, `COD_FEE`
5. Run `RACE_DATABASE_URL=... npm run race` against Supabase
6. Turn on Supabase backups; the database holds every order and customer
7. Add transactional email; order confirmations are stored, not emailed
