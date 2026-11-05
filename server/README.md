# PHBL Naturals — server

Serves the static site in `../web` and the small API the checkout needs. Express + Razorpay,
three dependencies, no database.

```bash
npm install
cp .env.example .env     # then fill it in
npm start                # http://localhost:3000
```

## Environment

| Variable | Needed for | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Online payments | Razorpay Dashboard → Account & Settings → API Keys. Start with `rzp_test_…` |
| `RAZORPAY_WEBHOOK_SECRET` | Payment webhook | Dashboard → Settings → Webhooks |
| `ADMIN_KEY` | `/admin.html` | Any long random string: `openssl rand -hex 24` |
| `PORT` | | Defaults to 3000 |

Without Razorpay keys the site still runs and takes **COD orders only**; the prepaid option
returns a clear message instead of failing silently.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/config` | Whether payments and COD are available |
| `POST` | `/api/orders` | Validate, price and store an order. Creates the Razorpay order for prepaid |
| `POST` | `/api/payments/verify` | Verify the Razorpay signature and mark the order paid |
| `POST` | `/api/razorpay/webhook` | Server-to-server payment confirmation (survives a closed browser) |
| `GET` | `/api/orders/lookup?id=&t=` or `&phone=` | Customer order lookup |
| `POST` | `/api/contact` | Contact form |
| `GET` | `/api/admin/orders` | All orders + revenue (needs `x-admin-key`) |
| `POST` | `/api/admin/orders/:id` | Update status and tracking number (needs `x-admin-key`) |

## How the money is handled

- **The browser never sets a price.** It sends only `{handle, sku, qty}`. The server recomputes
  every line, the coupon, the prepaid discount, delivery and the total from `web/data/*.json`.
  Editing prices in the browser console changes nothing.
- **Stock is enforced server-side** and capped at 20 units of one item per order.
- **Payments are confirmed by signature**, never by the browser saying so. The HMAC is checked
  with a timing-safe comparison, and a payment belonging to another order is rejected. Failed
  checks are recorded in that order's history.
- **The webhook is a second, independent confirmation** for when a customer closes the tab
  mid-payment, so a paid order is never lost.
- **Order lookup needs proof**: either the one-time token issued at checkout or the phone number
  on the order. An order number alone will not reveal a customer's address.

## Data

Orders and messages are JSON files in `server/data/`, written atomically through a queue so two
simultaneous orders cannot corrupt them. They are gitignored because they contain customer data.

**Back them up.** A nightly copy is enough at low volume:

```bash
cp server/data/orders.json ~/backups/orders-$(date +%F).json
```

Move to SQLite or Postgres when you pass roughly a few thousand orders, or when you want
reporting beyond the admin page.

## Going live

1. **Test first.** With `rzp_test_…` keys place one prepaid order using Razorpay's test cards
   and one COD order. Check both appear in `/admin.html` and that the prepaid one shows `paid`.
2. **Switch to live keys**, complete Razorpay KYC, then place one real ₹1 order and refund it.
3. **Serve over HTTPS.** Razorpay and browsers require it. A reverse proxy (Caddy, Nginx) or a
   host that terminates TLS for you both work.
4. **Keep the process running** with `pm2 start server.js --name phbl` or a systemd unit.
5. **Register the webhook** at `https://yourdomain.com/api/razorpay/webhook` for `payment.captured`.
6. **Set a strong `ADMIN_KEY`** and never share the URL publicly.

### Hosting options

| Option | Notes |
|---|---|
| A small VPS (Hostinger, DigitalOcean, Lightsail) | Cheapest full control. Node + Caddy for automatic HTTPS |
| Render / Railway / Fly.io | Easiest. Push the repo, set the env vars. Use a persistent disk for `server/data` |
| Static host + separate API | Put `web/` on Netlify, Vercel or GitHub Pages and run only `server/` on a Node host. Set `window.PHBL_API` to the API URL in the HTML, and enable CORS |

> On hosts with an ephemeral filesystem (including Vercel and Heroku) the JSON order files are
> wiped on redeploy. Attach a persistent disk or move to a managed database before taking real
> orders there.

## Still to connect

- **Email and WhatsApp confirmations** are not wired up. Add them where the server logs
  `[order] … created`: an SMTP service for email, and AiSensy, Interakt or WATI for WhatsApp.
- **Pincode serviceability** currently answers from `site.json > commerce.deliveryEta`. Swap in
  a Shiprocket or Delhivery API call in `web/assets/js/product.js` when you have an account.
- **Invoices.** Orders hold everything a GST invoice needs; generating the PDF is not built.
