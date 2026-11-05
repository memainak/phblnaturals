# Deploying PHBL Naturals to Firebase

Everything below is done once. After that, `npm run deploy` from the repository
root pushes the whole site.

- Static storefront → Firebase Hosting, built from `frontend/phbl_naturals_website`
  into `dist/` by `scripts/build-static.mjs`
- API → one Cloud Function (`api`, region `asia-south1`) running the Express app
- Data → Firestore

The project is already set in `.firebaserc`: **phblnaturals-50d1c**.

The storefront folder is never modified. The build copies it and injects the
`/storefront-api.js` tag into the copy.

## 1. Sign in and pick the plan

```bash
firebase login
```

Cloud Functions requires the **Blaze** (pay-as-you-go) plan — the free Spark
plan cannot run functions at all, and a function on Spark could not reach any
outside service even if it could run. Blaze has a free monthly allowance that a
shop of this size will most likely stay inside, but it needs a card on file.

Upgrade at **console.firebase.google.com → phblnaturals-50d1c → ⚙ → Usage and
billing → Modify plan**. Set a budget alert while you are there.

## 2. Create the Firestore database

In the console: **Build → Firestore Database → Create database**.

| Choice | Set it to |
| --- | --- |
| Mode | **Production mode** — the API is the only client, and `firestore.rules` denies everything else |
| Location | **asia-south1 (Mumbai)**, matching the function's region |

The location is permanent, so get it right the first time. Any location works,
but one far from `asia-south1` adds latency to every order.

There are no tables to create. The collections appear on first write, and the
catalogue seeds itself on the first request after deploy.

## 3. Set the secrets

These live in Secret Manager, never in the repository. Each command prompts for
the value:

```bash
firebase functions:secrets:set SESSION_SECRET
```

```bash
firebase functions:secrets:set ADMIN_KEY
```

Generate each of those two as a long random string:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then the Razorpay keys, from **Razorpay dashboard → Account & Settings → API
Keys**:

```bash
firebase functions:secrets:set RAZORPAY_KEY_ID
```

```bash
firebase functions:secrets:set RAZORPAY_KEY_SECRET
```

```bash
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
```

All five must exist before the first deploy, because `functions.js` declares
them. If you do not have the Razorpay keys yet, create those three as the
literal `unset`, which the server reads as "not configured":

```bash
printf 'unset' | firebase functions:secrets:set RAZORPAY_KEY_ID --data-file -
``` Without real keys the shop runs cash-on-delivery only, and online
orders are saved as `pending` with a clear message to the shopper.

In production the server **refuses to start** without `SESSION_SECRET` and
`ADMIN_KEY`. That is deliberate: a missing admin key would leave the dashboard
unreachable, and a missing session secret would sign every customer out on each
deploy.

## 4. Deploy

```bash
npm run deploy
```

That builds `dist/`, then pushes Firestore rules and indexes, the function, and
Hosting. The first run takes several minutes while Google enables Cloud Build,
Artifact Registry and Secret Manager, and it may ask you to confirm each.

To push one piece at a time:

```bash
npm run deploy:rules && npm run deploy:api && npm run deploy:hosting
```

## 5. Check it

```bash
curl https://phblnaturals-50d1c.web.app/api/health
```

- `"database": "firestore"` — correct
- `"database": "firestore-emulator"` — `FIRESTORE_EMULATOR_HOST` leaked into
  the deployed config. Stop and fix it; nothing would be saved.

Then in a browser:

- `https://phblnaturals-50d1c.web.app/` — the storefront, with products loaded
  from the API rather than the hardcoded demo list
- `https://phblnaturals-50d1c.web.app/admin.html` — paste your `ADMIN_KEY`

Place one cash-on-delivery order and confirm it appears in the admin dashboard
and that the product's stock went down by the right amount. That single check
exercises the pricing, the stock reservation and the order write together.

## 6. Razorpay webhook

In the Razorpay dashboard: **Settings → Webhooks → Add**

- URL: `https://phblnaturals-50d1c.web.app/api/payments/razorpay/webhook`
- Events: `payment.captured` and `payment.failed`
- Put the signing secret into `RAZORPAY_WEBHOOK_SECRET` and redeploy the
  function

The webhook is the backstop for when a shopper closes the tab mid-payment. It
is verified against the raw request bytes, so it must stay mounted ahead of the
JSON body parser — it already is, in `src/app.js`.

## 7. Custom domain

**Hosting → Add custom domain**, then point the DNS records Firebase shows at
it. Session cookies are `secure` in production, so the site must be served over
HTTPS; Firebase issues the certificate automatically.

## Running it locally

The Firestore emulator needs a Java runtime. OpenJDK is already installed on
this machine; it is keg-only, so it is not on the `PATH` by default. Put it
there permanently:

```bash
printf '\nexport PATH="/opt/homebrew/opt/openjdk/bin:$PATH"\n' >> ~/.zshrc
```

Open a new terminal after that, or prefix the one command that needs it:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npm run emulator
```

The `sudo ln -s` line Homebrew suggests is for the system Java wrappers and is
not needed here.

With the emulator running in one terminal, start the server in another:

```bash
cd backend && npm install && npm run dev
```

```bash
npm run smoke   # 68 end-to-end checks, against the emulator
```

```bash
npm run race    # 8 simultaneous checkouts for one unit of stock
```

Both suites wipe the emulator before they start and never touch the real
database. `backend/.env.example` documents the alternative — pointing the
server at the live Firestore with a service-account key — but prefer the
emulator, since the live database holds real orders.

`npm install` warns that the project wants Node 22 while this machine runs
Node 24. That is only a warning: 22 is pinned because it is what Cloud
Functions runs.

## What the port to Firestore changed

Worth knowing, because it is not a like-for-like swap:

- **Stock reservation** is now a Firestore transaction that reads every
  product, checks each one, then writes. If another shopper touches the same
  product first, Firestore aborts and re-runs it, so the last unit still cannot
  be sold twice. `npm run race` proves this: 8 simultaneous checkouts for a
  single unit produce one order and seven clean "out of stock" rejections.
- **Order line items** live in an `items` array on the order document rather
  than a separate table, so reading an order is one document read.
- **Unique emails and mobile numbers** are enforced by claim documents in
  `userEmails/` and `userPhones/`, written in the same transaction as the
  account. Firestore has no unique constraint of its own.
- **Admin order search** has no equivalent of `ILIKE`, so it reads the 2,000
  most recent orders and filters them in memory. Responses say `scanCap` when
  they depend on that window.
- **The dashboard statistics** are totalled in memory from that same window,
  since Firestore cannot join or group. Both numbers are honest at shop scale;
  past tens of thousands of orders they should become counters maintained on
  each write.
- **User ids are now strings** (Firestore auto-ids) instead of integers.
  Product and message ids stayed numeric, because the API contract promises a
  number there.

## Before taking real money

1. Replace the 16 demo products in `backend/src/catalogue.js` with the verified
   PHBL Naturals catalogue, prices, ingredient lists and photography
2. Set real stock levels in the admin dashboard
3. Switch Razorpay from test keys to live keys, and place one real order
4. Check `FREE_SHIPPING_OVER`, `SHIPPING_FLAT` and `COD_FEE` against real costs
5. Turn on Firestore backups — **Firestore → Backups** — the database holds
   every order and customer
6. Add transactional email; order confirmations are stored, not emailed
