# PHBL Naturals — backend

The storefront API behind `frontend/phbl_naturals_website`: catalogue, customer
accounts, cart, orders, Razorpay payments, newsletter, contact messages and an
admin dashboard.

Node 22+ only. It uses the built-in `node:sqlite` and `node:crypto`, so the only
dependencies are Express, dotenv and the Razorpay SDK — no native build step, no
separate database server.

## Run it

```bash
cd backend
npm install
cp .env.example .env     # then fill in SESSION_SECRET and ADMIN_KEY
npm run dev
```

- Storefront — http://localhost:4000/
- API health — http://localhost:4000/api/health
- Admin — http://localhost:4000/admin.html (paste your `ADMIN_KEY`)

The catalogue is seeded automatically on first boot from `src/catalogue.js`, and
`data/phbl.db` is created next to it. Delete that file to start over.

```bash
npm run smoke   # 67 end-to-end checks against a scratch database
```

## How the frontend is wired up

The storefront folder is read-only, so **no file in it was edited**. The server
serves `index.html` with one extra script tag injected before `</body>`:

```html
<script src="/storefront-api.js" defer></script>
```

`public/storefront-api.js` then takes the page over:

| Page behaviour before | Now |
| --- | --- |
| 16 products hard-coded in `script.js` | fetched from `GET /api/products` |
| sign in / sign up showed "not connected yet" | real accounts, session cookie |
| checkout showed "demo order… no payment was taken" | real order, stock reserved, Razorpay when configured |
| newsletter showed "connect a newsletter service" | stored in the database |
| cart only in `localStorage` | also saved server-side while signed in |

It never patches `script.js`. The page's demo handlers are intercepted with a
capture-phase `submit` listener on `document`, which runs first and calls
`stopImmediatePropagation()`. If the API is unreachable the page silently falls
back to its original demo behaviour.

Hosting the frontend elsewhere instead? Set `CORS_ORIGINS` to that origin, add
`<script>window.PHBL_API_BASE='https://api.yourdomain.com'</script>` before the
bridge, and serve `storefront-api.js` alongside the page.

## API

Money is in whole rupees. Every response is `{ ok: true, … }` or
`{ ok: false, error: "…" }`.

### Public

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness |
| GET | `/api/config` | pricing rules, which payment methods are live, current user |
| GET | `/api/products` | catalogue; `?category=&q=&sort=featured\|low\|high\|name&limit=` |
| GET | `/api/products/:idOrSlug` | one product |
| GET | `/api/products/categories` | categories with counts |
| POST | `/api/products/quote` | re-price a basket (`{ items, paymentMethod }`) |
| POST | `/api/orders` | place an order (guest or signed in) |
| GET | `/api/orders/lookup?id=&phone=` | guest order tracking |
| POST | `/api/newsletter` | subscribe |
| POST | `/api/contact` | contact form |

### Accounts

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` | `{ fullName, emailMobile, password, cart? }` |
| POST | `/api/auth/login` | `{ emailMobile, password, cart? }` |
| POST | `/api/auth/logout` · `/logout-all` | end this session / every session |
| GET · PATCH | `/api/auth/me` | read / update the profile |
| POST | `/api/auth/change-password` | signs other devices out |
| GET · PUT · DELETE | `/api/cart` | the signed-in cart |
| POST | `/api/cart/items` | `{ productId, qty }` or `{ productId, delta }` |
| DELETE | `/api/cart/items/:productId` | remove one line |
| GET | `/api/cart/quote` | totals for the saved cart |
| GET | `/api/orders` · `/api/orders/:id` | order history |
| POST | `/api/orders/:id/cancel` | cancel before dispatch; stock is returned |

The single "email or mobile number" field on the page is accepted as either; an
account can carry both. Passwords are scrypt-hashed. Sessions are opaque random
tokens stored hashed in the database and sent as an httpOnly, SameSite=Lax
cookie, so they can be revoked server-side.

`/api/auth/google`, `/api/auth/otp/*` and `/api/auth/forgot-password` answer 501
with a clear message — the routes are reserved, the providers are not wired up.

### Payments

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/payments/config` | is Razorpay live? |
| POST | `/api/payments/razorpay/order` | `{ orderId }` → Razorpay order |
| POST | `/api/payments/razorpay/verify` | checks the checkout signature |
| POST | `/api/payments/razorpay/webhook` | `payment.captured` / `payment.failed` |
| GET | `/api/payments/status/:orderId` | poll after a redirect |

Without Razorpay keys the API still runs: cash on delivery works and online
orders are saved as `pending` with a clear message. Add the keys and the same
checkout flow starts collecting payment, no frontend change needed.

### Admin — `X-Admin-Key: <ADMIN_KEY>`

`GET /api/admin/stats`, `GET|PATCH /api/admin/orders[/:id]`,
`GET|POST|PATCH|DELETE /api/admin/products[/:id]`, `GET /api/admin/customers`,
`GET|PATCH /api/admin/messages[/:id]`, `GET /api/admin/newsletter`.

Products are deactivated rather than deleted so past orders stay readable.

## What the server guarantees

- **Prices are never taken from the client.** `POST /api/orders` reads only
  product ids and quantities; every rupee is recomputed from the database.
- **Stock is reserved inside the order transaction** and released again on
  cancellation, so two shoppers cannot buy the last unit.
- **Payment decides status.** A COD order is `confirmed` immediately; an online
  order stays `pending` / `unpaid` until a verified signature or a signed
  webhook arrives.
- **Webhooks are verified against raw bytes** — the webhook route is mounted
  with a raw body parser ahead of `express.json()`.
- **Guest order tracking needs the order id *and* the phone on the order.**
- Login, signup, checkout, contact and newsletter are rate limited per IP.
- Sign-in failures never reveal whether an account exists.

## Order and payment states

`pending → confirmed → packed → shipped → delivered`, plus `cancelled`.
Payment: `unpaid → paid`, or `failed` / `refunded`.

## Before going live

1. Set `NODE_ENV=production`, a real `SESSION_SECRET` and `ADMIN_KEY` — the
   server refuses to start in production without them.
2. Put it behind HTTPS (session cookies are marked `secure` in production) and a
   reverse proxy; `trust proxy` is already on.
3. Replace the seed catalogue in `src/catalogue.js` with verified PHBL Naturals
   products, prices, ingredient lists and photography, and set real stock.
4. Add live Razorpay keys and register the webhook URL.
5. Check `FREE_SHIPPING_OVER`, `SHIPPING_FLAT` and `COD_FEE` against real
   shipping costs.
6. Back up `data/phbl.db` on a schedule — it holds every order and customer.
7. Wire up transactional email (order confirmations are stored, not emailed) and
   decide on Google / OTP sign-in if you want the buttons on the page to work.

## Layout

```
backend/
  server.js               boot, middleware order, static + bridge injection
  src/
    config.js             env, defaults, production guards
    db.js                 SQLite schema and transactions
    catalogue.js          seed product data
    seed.js               idempotent seeding (keeps admin stock edits)
    util.js               validation, scrypt passwords, ids
    middleware.js         cors, security headers, rate limit, sessions, errors
    store.js              products, cart, basket pricing, stock
    orders.js             order creation, state changes, stock release
    routes/               auth · products · cart · orders · payments · content · admin
  public/
    storefront-api.js     frontend ↔ API bridge, injected into index.html
    admin.html            admin dashboard
  tools/smoke.mjs         end-to-end tests
```
