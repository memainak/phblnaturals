/**
 * PHBL Naturals — storefront server.
 * Serves the static site in ../web and the small API the checkout needs.
 *
 * Every amount is recomputed here from web/data/products.json and site.json.
 * Nothing the browser sends about prices is trusted.
 */
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Razorpay from 'razorpay';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

const PORT = process.env.PORT || 3000;
const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  ADMIN_KEY,
} = process.env;

const paymentsEnabled = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
const razorpay = paymentsEnabled
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
  : null;

/* ------------------------------------------------------------------ catalogue */
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
let catalogue = {
  site: readJson(path.join(WEB_DIR, 'data', 'site.json')),
  products: readJson(path.join(WEB_DIR, 'data', 'products.json')),
};
// Pick up edits to the data files without a restart.
for (const file of ['site.json', 'products.json']) {
  fs.watchFile(path.join(WEB_DIR, 'data', file), { interval: 2000 }, () => {
    try {
      catalogue = {
        site: readJson(path.join(WEB_DIR, 'data', 'site.json')),
        products: readJson(path.join(WEB_DIR, 'data', 'products.json')),
      };
      console.log(`[catalogue] reloaded after change to ${file}`);
    } catch (err) {
      console.error(`[catalogue] ${file} is not valid JSON, keeping the previous version:`, err.message);
    }
  });
}

/* ------------------------------------------------------------------ storage */
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const file of [ORDERS_FILE, MESSAGES_FILE]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
}

let writeQueue = Promise.resolve();
/** Serialised, atomic write so two orders at once cannot corrupt the file. */
function writeFileSafe(file, value) {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
    await fsp.rename(tmp, file);
  });
  return writeQueue;
}
const loadOrders = () => readJson(ORDERS_FILE);

/* ------------------------------------------------------------------ pricing */
function priceOrder({ items, coupon, payment }) {
  const { site, products } = catalogue;
  const c = site.commerce;
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Your cart is empty.');
  if (items.length > 50) throw new HttpError(400, 'Too many items in one order.');

  const lines = items.map((raw) => {
    const product = products.find((p) => p.handle === raw.handle);
    if (!product) throw new HttpError(400, 'One of the products is no longer available.');
    const variant = product.variants.find((v) => v.sku === raw.sku);
    if (!variant) throw new HttpError(400, `That size of ${product.title} is no longer available.`);
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1) throw new HttpError(400, 'Invalid quantity.');
    if (qty > 20) throw new HttpError(400, `Maximum 20 units of one item per order. Contact us for bulk orders.`);
    if (variant.stock < qty) throw new HttpError(409, `Only ${variant.stock} left of ${product.title} (${variant.size}).`);
    return {
      handle: product.handle,
      sku: variant.sku,
      title: product.title,
      size: variant.size,
      qty,
      unitPrice: variant.price,
      unitMrp: variant.mrp || variant.price,
      lineTotal: variant.price * qty,
      tags: product.tags || [],
    };
  });

  const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);

  let discount = 0;
  let couponLabel = '';
  const found = (site.coupons || []).find(
    (x) => x.code.toUpperCase() === String(coupon || '').trim().toUpperCase()
  );
  if (found && subtotal >= (found.minCart || 0)) {
    const base = found.appliesToTag
      ? lines.filter((l) => l.tags.includes(found.appliesToTag)).reduce((n, l) => n + l.lineTotal, 0)
      : subtotal;
    discount = found.type === 'percent' ? Math.round((base * found.value) / 100) : Math.min(found.value, base);
    couponLabel = found.code;
  }

  const afterDiscount = Math.max(0, subtotal - discount);
  const prepaid = payment === 'prepaid' ? Math.round((afterDiscount * c.prepaidDiscountPercent) / 100) : 0;
  const shipping = afterDiscount >= c.freeShippingThreshold ? 0 : c.shippingFee;
  const codFee = payment === 'cod' ? c.codFee || 0 : 0;
  const total = Math.max(1, afterDiscount - prepaid + shipping + codFee);

  return {
    lines,
    totals: {
      subtotal,
      discount,
      couponLabel,
      prepaid,
      shipping,
      codFee,
      total,
      freeGift: afterDiscount >= c.freeGiftThreshold,
      freeGiftLabel: afterDiscount >= c.freeGiftThreshold ? c.freeGiftLabel : '',
    },
  };
}

/* ------------------------------------------------------------------ helpers */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters
const newOrderId = () =>
  'PHBL-' + Array.from(crypto.randomFillSync(new Uint8Array(8))).map((b) => ALPHABET[b % ALPHABET.length]).join('');

const clean = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

function validateCustomer(input = {}) {
  const customer = {
    name: clean(input.name, 80),
    phone: clean(input.phone, 10),
    email: clean(input.email, 120),
    address1: clean(input.address1, 200),
    address2: clean(input.address2, 200),
    city: clean(input.city, 80),
    state: clean(input.state, 80),
    pincode: clean(input.pincode, 6),
    notes: clean(input.notes, 500),
  };
  const bad = [];
  if (customer.name.length < 2) bad.push('name');
  if (!/^[6-9]\d{9}$/.test(customer.phone)) bad.push('phone');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customer.email)) bad.push('email');
  if (customer.address1.length < 5) bad.push('address');
  if (!/^[1-9]\d{5}$/.test(customer.pincode)) bad.push('pincode');
  if (customer.city.length < 2) bad.push('city');
  if (customer.state.length < 2) bad.push('state');
  if (bad.length) throw new HttpError(400, `Please check these fields: ${bad.join(', ')}.`);
  return customer;
}

/* Simple in-memory rate limit, enough for a single-instance shop. */
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    list.push(now);
    hits.set(key, list);
    next();
  };
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

/* ------------------------------------------------------------------ app */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// The webhook needs the raw body to check its signature, so it is mounted before the JSON parser.
app.post('/api/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!RAZORPAY_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook secret not configured.' });
  const signature = req.get('x-razorpay-signature') || '';
  const expected = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(req.body).digest('hex');
  const ok =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!ok) return res.status(400).json({ error: 'Bad signature.' });

  const event = JSON.parse(req.body.toString('utf8'));
  const rzpOrderId = event?.payload?.payment?.entity?.order_id;
  if (event.event === 'payment.captured' && rzpOrderId) {
    const orders = loadOrders();
    const order = orders.find((o) => o.razorpayOrderId === rzpOrderId);
    if (order && order.status === 'pending_payment') {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      order.razorpayPaymentId = event.payload.payment.entity.id;
      order.history.push({ at: order.paidAt, note: 'Payment captured (webhook)' });
      await writeFileSafe(ORDERS_FILE, orders);
      console.log(`[order] ${order.orderId} paid via webhook`);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '64kb' }));

/* ---- config for the front end ---- */
app.get('/api/config', (req, res) => {
  res.json({ paymentsEnabled, codEnabled: catalogue.site.commerce.codEnabled });
});

/* ---- create an order ---- */
app.post('/api/orders', rateLimit(12, 60_000), async (req, res, next) => {
  try {
    const { items, coupon, payment, customer } = req.body || {};
    if (payment !== 'prepaid' && payment !== 'cod') throw new HttpError(400, 'Choose a payment method.');
    if (payment === 'cod' && !catalogue.site.commerce.codEnabled) throw new HttpError(400, 'Cash on Delivery is not available.');
    if (payment === 'prepaid' && !paymentsEnabled) {
      throw new HttpError(503, 'Online payment is not set up yet. Please choose Cash on Delivery or contact us on WhatsApp.');
    }

    const buyer = validateCustomer(customer);
    const { lines, totals } = priceOrder({ items, coupon, payment });

    const order = {
      orderId: newOrderId(),
      token: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
      status: payment === 'cod' ? 'cod_confirmed' : 'pending_payment',
      payment,
      customer: buyer,
      items: lines,
      totals,
      tracking: '',
      history: [{ at: new Date().toISOString(), note: `Order placed (${payment})` }],
    };

    if (payment === 'prepaid') {
      const rzpOrder = await razorpay.orders.create({
        amount: totals.total * 100, // paise
        currency: 'INR',
        receipt: order.orderId,
        notes: { orderId: order.orderId, phone: buyer.phone },
      });
      order.razorpayOrderId = rzpOrder.id;
    }

    const orders = loadOrders();
    orders.push(order);
    await writeFileSafe(ORDERS_FILE, orders);
    console.log(`[order] ${order.orderId} created · ${payment} · ₹${totals.total}`);

    res.json({
      orderId: order.orderId,
      token: order.token,
      amountPaise: totals.total * 100,
      totals,
      razorpayOrderId: order.razorpayOrderId || null,
      razorpayKeyId: payment === 'prepaid' ? RAZORPAY_KEY_ID : null,
    });
  } catch (err) {
    next(err);
  }
});

/* ---- verify a payment signature ---- */
app.post('/api/payments/verify', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new HttpError(400, 'Missing payment details.');
    }
    const orders = loadOrders();
    const order = orders.find((o) => o.orderId === orderId);
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.razorpayOrderId !== razorpay_order_id) throw new HttpError(400, 'That payment belongs to another order.');

    const expected = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    const verified =
      expected.length === razorpay_signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));

    if (!verified) {
      order.history.push({ at: new Date().toISOString(), note: 'Signature check FAILED' });
      await writeFileSafe(ORDERS_FILE, orders);
      throw new HttpError(400, 'We could not verify that payment.');
    }

    if (order.status === 'pending_payment') {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      order.razorpayPaymentId = razorpay_payment_id;
      order.history.push({ at: order.paidAt, note: 'Payment verified' });
      await writeFileSafe(ORDERS_FILE, orders);
    }
    console.log(`[order] ${order.orderId} paid`);
    res.json({ verified: true, orderId: order.orderId, token: order.token });
  } catch (err) {
    next(err);
  }
});

/* ---- customer order lookup: needs the token from checkout, or the phone number ---- */
app.get('/api/orders/lookup', rateLimit(30, 60_000), (req, res, next) => {
  try {
    const { id, phone, t } = req.query;
    const order = loadOrders().find((o) => o.orderId === String(id || '').trim().toUpperCase());
    if (!order) throw new HttpError(404, 'We could not find that order number.');
    const byToken = t && order.token === t;
    const byPhone = phone && order.customer.phone === String(phone).trim();
    if (!byToken && !byPhone) throw new HttpError(403, 'Enter the phone number used for this order.');

    const { token, ...safe } = order;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

/* ---- contact form ---- */
app.post('/api/contact', rateLimit(5, 60_000), async (req, res, next) => {
  try {
    const message = {
      at: new Date().toISOString(),
      name: clean(req.body?.name, 80),
      email: clean(req.body?.email, 120),
      phone: clean(req.body?.phone, 10),
      subject: clean(req.body?.subject, 150),
      message: clean(req.body?.message, 2000),
    };
    if (message.name.length < 2 || message.message.length < 5) throw new HttpError(400, 'Please add your name and a message.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(message.email)) throw new HttpError(400, 'Please enter a valid email address.');

    const all = readJson(MESSAGES_FILE);
    all.push(message);
    await writeFileSafe(MESSAGES_FILE, all);
    console.log(`[contact] ${message.email}: ${message.subject || '(no subject)'}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---- admin: list orders and update status ---- */
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: 'Set ADMIN_KEY in .env to use the admin API.' });
  const given = req.get('x-admin-key') || '';
  const a = Buffer.from(given.padEnd(ADMIN_KEY.length).slice(0, ADMIN_KEY.length));
  const b = Buffer.from(ADMIN_KEY);
  if (given.length !== ADMIN_KEY.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorised.' });
  }
  next();
}

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = loadOrders()
    .slice()
    .reverse()
    .map(({ token, ...o }) => o);
  const revenue = orders
    .filter((o) => ['paid', 'cod_confirmed', 'packed', 'shipped', 'delivered'].includes(o.status))
    .reduce((n, o) => n + o.totals.total, 0);
  res.json({ count: orders.length, revenue, orders });
});

app.post('/api/admin/orders/:id', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['paid', 'cod_confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
    const { status, tracking, note } = req.body || {};
    if (status && !allowed.includes(status)) throw new HttpError(400, `Status must be one of: ${allowed.join(', ')}`);
    const orders = loadOrders();
    const order = orders.find((o) => o.orderId === req.params.id);
    if (!order) throw new HttpError(404, 'Order not found.');
    if (status) order.status = status;
    if (tracking != null) order.tracking = clean(tracking, 120);
    order.history.push({ at: new Date().toISOString(), note: clean(note, 200) || `Updated to ${order.status}` });
    await writeFileSafe(ORDERS_FILE, orders);
    res.json({ ok: true, order: { ...order, token: undefined } });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ static site */
app.use(
  express.static(WEB_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      // Images and fonts are safe to cache hard. Code, markup and catalogue data must
      // revalidate, otherwise a price or copy change never reaches a returning visitor.
      // CSS and JS are requested with a ?v= version (bump ASSET_VERSION in the HTML when you
      // edit them), so they can be cached hard. HTML and catalogue JSON must always revalidate.
      if (/\.(css|js|jpg|jpeg|png|webp|avif|svg|woff2?)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Unknown endpoint.' });
  res.status(404).sendFile(path.join(WEB_DIR, 'index.html'));
});

/* ------------------------------------------------------------------ errors */
app.use((err, req, res, _next) => {
  const known = err instanceof HttpError;
  const status = known ? err.status : 500;
  if (!known) console.error('[error]', err);
  // Known errors carry a message written for the customer; unexpected ones must not leak internals.
  res.status(status).json({ error: known ? err.message : 'Something went wrong on our side. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`\n  PHBL Naturals running at http://localhost:${PORT}`);
  console.log(`  Payments: ${paymentsEnabled ? 'Razorpay live keys loaded' : 'NOT configured (COD only) — add keys to server/.env'}`);
  console.log(`  Orders file: ${ORDERS_FILE}\n`);
});
