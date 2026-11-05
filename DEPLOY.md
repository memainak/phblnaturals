# Deploying PHBL Naturals

- Static storefront → **Firebase Hosting**, built from
  `frontend/phbl_naturals_website` into `dist/` by `scripts/build-static.mjs`
- API → one **Cloud Function** (`api`, region `asia-south1`) running the
  Express app
- Data → **Supabase Postgres**

Firebase project: **phblnaturals-50d1c** (already set in `.firebaserc`).
Hosting, the function and the Blaze plan are already live; what follows is the
Supabase side plus a redeploy.

The storefront folder is never modified. The build copies it and injects the
`/storefront-api.js` tag into the copy.

## 1. Create the Supabase project

At [supabase.com](https://supabase.com) → **New project**.

| Choice | Set it to |
| --- | --- |
| Region | **South Asia (Mumbai)** — next to the function in `asia-south1` |
| Database password | generate a strong one; you will need it in step 2 |

There are no tables to create. The schema is applied and the catalogue seeded
on the first request after deploy.

## 2. Get the pooler connection string

**Project Settings → Database → Connection string → URI**, and switch the mode
selector to **Connection pooling / Transaction**. You want the URI on port
**6543**, which looks like:

```
postgresql://postgres.abcdefgh:YOUR-PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
```

**Use the pooler, not the direct connection on 5432.** This matters more than
it looks. Every Cloud Function instance opens its own connection pool, so the
real ceiling is instances × pool size. A dozen cold starts against the direct
connection will exhaust Postgres's connection limit and checkout starts
failing under exactly the traffic you want. The pooler (Supavisor) multiplexes
instead. `config.js` warns at boot if it sees a Supabase URL without `:6543`,
and the function's pool is capped at 2 connections when it detects it is
running serverless.

Replace `YOUR-PASSWORD` with the password from step 1.

## 3. Set it as a secret

```bash
firebase functions:secrets:set DATABASE_URL --project phblnaturals-50d1c
```

Paste the full URI when prompted. The other five secrets are already set from
the earlier deploy and do not need touching:

| Secret | State |
| --- | --- |
| `SESSION_SECRET` | set |
| `ADMIN_KEY` | set — read it back with `firebase functions:secrets:access ADMIN_KEY` |
| `RAZORPAY_KEY_ID` | `unset` placeholder — replace when you have the keys |
| `RAZORPAY_KEY_SECRET` | `unset` placeholder |
| `RAZORPAY_WEBHOOK_SECRET` | `unset` placeholder |

Those three placeholders read back as "not configured", so the shop runs cash
on delivery only and online orders are saved as `pending` with a clear message
to the shopper. Replacing them with real keys turns online payment on at the
next deploy, with no code change.

In production the server **refuses to start** without `SESSION_SECRET`,
`ADMIN_KEY` and `DATABASE_URL`. That is deliberate: a missing database would
otherwise fall back to the local PGlite file and lose every order silently on
the next cold start.

## 4. Deploy

```bash
npm run deploy
```

That builds `dist/`, then pushes the function and Hosting.

```bash
npm run deploy:api       # function only
npm run deploy:hosting   # static site only
```

## 5. Check it

```bash
curl https://phblnaturals-50d1c.web.app/api/health
```

- `"database": "postgres"` — correct
- `"database": "pglite"` — `DATABASE_URL` did not reach the function. Stop:
  orders would be written to a file that vanishes with the instance.

Then place one cash-on-delivery order on the live site and confirm it appears
in the admin dashboard with the stock reduced. That single check exercises
pricing, stock reservation and the order write together.

In the Supabase dashboard, **Table Editor** now shows `products`, `orders`,
`order_items`, `users`, `sessions`, `carts`, `newsletter` and `messages` — this
is the thing Firestore could not give you.

## 6. Razorpay webhook

In the Razorpay dashboard: **Settings → Webhooks → Add**

- URL: `https://phblnaturals-50d1c.web.app/api/payments/razorpay/webhook`
- Events: `payment.captured` and `payment.failed`
- Put the signing secret into `RAZORPAY_WEBHOOK_SECRET` and redeploy

The webhook is the backstop for when a shopper closes the tab mid-payment. It
is verified against the raw request bytes, so it must stay mounted ahead of the
JSON body parser — it already is, in `src/app.js`.

## 7. Custom domain

**Hosting → Add custom domain**, then point the DNS records Firebase shows at
it. Session cookies are `secure` in production, so the site must be served over
HTTPS; Firebase issues the certificate automatically.

## Running it locally

No database server, no Docker, no Java. PGlite — real Postgres compiled to
WASM — is used whenever `DATABASE_URL` is absent:

```bash
cd backend && npm install && npm run dev
```

```bash
npm run smoke   # 68 end-to-end checks
```

```bash
npm run race    # 8 simultaneous checkouts for one unit of stock
```

Both suites use a throwaway database and never touch the real shop.

Local settings go in **`backend/.env.local`**, not `.env`. The name matters:
`backend/` is the Cloud Functions source directory, and Firebase treats a
`.env` there as the deployed production environment — it would ship your
development values live and override Secret Manager.

To run the suites against real Postgres, which is worth doing once before
launch:

```bash
SMOKE_DATABASE_URL="postgresql://...6543/postgres" npm run smoke
```

```bash
RACE_DATABASE_URL="postgresql://...6543/postgres" npm run race
```

The race test especially: PGlite runs a single connection, so it cannot truly
reproduce two clients contending for the last unit of stock. Only real
Postgres proves that.

## Leftovers from the Firestore attempt

The project briefly ran on Firestore. Harmless, but you can tidy up:

- The Firestore database still exists with 16 seeded products and one test
  order. Delete it in the [GCP console](https://console.cloud.google.com/firestore/databases?project=phblnaturals-50d1c)
  if you want it gone; it costs nothing idle.
- Set an image cleanup policy so old function builds do not accrue storage
  charges: `firebase functions:artifacts:setpolicy --project phblnaturals-50d1c`

## Before taking real money

1. Replace the 16 demo products in `backend/src/catalogue.js` with the verified
   PHBL Naturals catalogue, prices, ingredient lists and photography
2. Set real stock levels in the admin dashboard
3. Switch Razorpay from test keys to live keys, and place one real order
4. Check `FREE_SHIPPING_OVER`, `SHIPPING_FLAT` and `COD_FEE` against real costs
5. Run `RACE_DATABASE_URL=... npm run race` against Supabase
6. Turn on Supabase's **Point-in-Time Recovery** or daily backups — the
   database holds every order and customer
7. Add transactional email; order confirmations are stored, not emailed
