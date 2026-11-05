/**
 * End-to-end smoke test. Starts the server on a scratch port with a scratch
 * database, exercises every public flow, and exits non-zero on the first
 * failure.
 *
 *   npm run smoke
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4987;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_KEY = 'smoke-admin-key';

// The suite runs against a throwaway database so a developer's own data is
// never touched: a scratch PGlite directory by default, or SMOKE_DATABASE_URL
// when you want to check the port against real Postgres.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'phbl-smoke-'));
const SMOKE_DATABASE_URL = process.env.SMOKE_DATABASE_URL || '';

let passed = 0;
const failures = [];

const ok = (label, condition, extra = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${extra ? ` — ${extra}` : ''}`);
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

let cookie = '';

async function call(path, { method = 'GET', body, headers = {}, keepCookie = true } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (keepCookie && setCookie.length) {
    cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 120) };
  }
  return { status: response.status, data };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitForServer(child) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error('server exited during startup');
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(150);
  }
  throw new Error('server did not start within 12s');
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    ADMIN_KEY,
    SESSION_SECRET: 'smoke-session-secret',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    DATABASE_URL: SMOKE_DATABASE_URL,
    POSTGRES_URL: '',
    // Ignored when SMOKE_DATABASE_URL is set; otherwise PGlite lives here.
    PHBL_DATA_DIR: SCRATCH
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const serverLog = [];
child.stdout.on('data', d => serverLog.push(d.toString()));
child.stderr.on('data', d => serverLog.push(d.toString()));

function restore() {
  child.kill('SIGKILL');
  try {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  } catch {
    /* the scratch directory is already gone */
  }
}

try {
  await waitForServer(child);
  const stamp = Date.now();

  console.log('\nhealth, config and catalogue');
  const health = await call('/api/health');
  ok('GET /api/health', health.status === 200 && health.data.ok);
  ok('running on Postgres', ['postgres', 'pglite'].includes(health.data.database),
    `database ${health.data.database}`);

  const conf = await call('/api/config');
  ok('GET /api/config exposes pricing', conf.data.pricing?.shippingFlat >= 0);
  ok('GET /api/config has no signed-in user', conf.data.user === null);

  const list = await call('/api/products');
  ok('GET /api/products returns the seeded catalogue', list.data.products?.length === 16,
    `got ${list.data.products?.length}`);
  ok('products carry prices and stock', list.data.products?.every(p => p.price > 0 && p.stock >= 0));
  ok('categories are summarised', list.data.categories?.length === 3);

  const filtered = await call('/api/products?category=Hair%20Care&sort=low');
  const prices = filtered.data.products.map(p => p.price);
  ok('category filter works', filtered.data.products.every(p => p.category === 'Hair Care'));
  ok('sort=low orders by price', prices.every((p, i) => i === 0 || prices[i - 1] <= p));

  const search = await call('/api/products?q=shampoo');
  ok('search matches by name', search.data.products.length >= 1);

  const one = await call('/api/products/1');
  ok('GET /api/products/1', one.data.product?.id === 1);
  ok('unknown product is a 404', (await call('/api/products/9999')).status === 404);

  console.log('\nquotes and pricing rules');
  const smallQuote = await call('/api/products/quote', {
    method: 'POST',
    body: { items: [{ productId: 5, qty: 1 }], paymentMethod: 'upi' }
  });
  ok('small basket is charged shipping', smallQuote.data.quote.shipping > 0);
  ok('quote total adds up',
    smallQuote.data.quote.total ===
      smallQuote.data.quote.subtotal + smallQuote.data.quote.shipping + smallQuote.data.quote.codFee);

  const bigQuote = await call('/api/products/quote', {
    method: 'POST',
    body: { items: [{ productId: 16, qty: 1 }], paymentMethod: 'cod' }
  });
  ok('basket over the threshold ships free', bigQuote.data.quote.shipping === 0);
  ok('cash on delivery adds its fee', bigQuote.data.quote.codFee > 0);

  const tampered = await call('/api/products/quote', {
    method: 'POST',
    body: { items: [{ productId: 5, qty: 1, price: 1 }] }
  });
  ok('client-sent prices are ignored', tampered.data.quote.subtotal === 199,
    `subtotal ${tampered.data.quote.subtotal}`);

  ok('empty basket is rejected',
    (await call('/api/products/quote', { method: 'POST', body: { items: [] } })).status === 400);
  ok('unknown product is rejected',
    (await call('/api/products/quote', { method: 'POST', body: { items: [{ productId: 9999, qty: 1 }] } })).status === 409);

  console.log('\naccounts');
  const email = `smoke${stamp}@example.com`;

  ok('signup needs a password of 8+ characters',
    (await call('/api/auth/signup', { method: 'POST', body: { fullName: 'Smoke Test', emailMobile: email, password: 'short' } })).status === 400);

  const signup = await call('/api/auth/signup', {
    method: 'POST',
    body: {
      fullName: 'Smoke Test',
      emailMobile: email,
      password: 'correct-horse-battery',
      cart: [{ productId: 2, qty: 2 }]
    }
  });
  ok('POST /api/auth/signup', signup.status === 201 && signup.data.user.email === email);
  ok('signup sets a session cookie', cookie.includes('phbl_session'));

  const me = await call('/api/auth/me');
  ok('GET /api/auth/me returns the user', me.data.user?.email === email);

  const dupe = await call('/api/auth/signup', {
    method: 'POST',
    body: { fullName: 'Smoke Test', emailMobile: email, password: 'correct-horse-battery' },
    keepCookie: false
  });
  ok('duplicate signup is a 409', dupe.status === 409);

  const guestCart = await call('/api/cart');
  ok('the guest cart was merged into the account', guestCart.data.cart.items[0]?.qty === 2);

  console.log('\ncart');
  const put = await call('/api/cart', {
    method: 'PUT',
    body: { items: [{ productId: 1, qty: 1 }, { productId: 4, qty: 3 }] }
  });
  ok('PUT /api/cart replaces the cart', put.data.cart.count === 4);
  ok('cart lines are priced from the catalogue', put.data.cart.subtotal === 249 + 499 * 3);

  const bumped = await call('/api/cart/items', { method: 'POST', body: { productId: 1, delta: 2 } });
  ok('POST /api/cart/items applies a delta', bumped.data.cart.items.find(i => i.productId === 1).qty === 3);

  const removed = await call('/api/cart/items/4', { method: 'DELETE' });
  ok('DELETE /api/cart/items/:id removes a line', removed.data.cart.items.length === 1);

  const cartQuote = await call('/api/cart/quote?paymentMethod=cod');
  ok('GET /api/cart/quote prices the saved cart', cartQuote.data.quote.subtotal === 249 * 3);

  console.log('\norders');
  ok('an order needs a valid phone number',
    (await call('/api/orders', { method: 'POST', body: { name: 'Smoke Test', email, phone: '12345', address: '12 Test Street, Test City, 700001', payment: 'cod', items: [{ productId: 1, qty: 1 }] } })).status === 400);

  ok('an order needs a real address',
    (await call('/api/orders', { method: 'POST', body: { name: 'Smoke Test', email, phone: '9876543210', address: 'x', payment: 'cod', items: [{ productId: 1, qty: 1 }] } })).status === 400);

  const stockBefore = (await call('/api/products/1')).data.product.stock;

  const codOrder = await call('/api/orders', {
    method: 'POST',
    body: {
      name: 'Smoke Test',
      email,
      phone: '9876543210',
      address: '12 Test Street, Test City, 700001',
      payment: 'Cash on delivery',
      items: [{ productId: 1, qty: 2 }]
    }
  });
  ok('POST /api/orders places a COD order', codOrder.status === 201 && /^PHBL-/.test(codOrder.data.order.id));
  ok('a COD order is confirmed straight away', codOrder.data.order.status === 'confirmed');
  ok('a COD order needs no payment step', codOrder.data.requiresPayment === false);
  ok('the COD fee is on the order', codOrder.data.order.codFee > 0);

  const stockAfter = (await call('/api/products/1')).data.product.stock;
  ok('stock is reserved when the order is placed', stockAfter === stockBefore - 2,
    `${stockBefore} → ${stockAfter}`);

  const emptied = await call('/api/cart');
  ok('the cart is emptied after checkout', emptied.data.cart.count === 0);

  const onlineOrder = await call('/api/orders', {
    method: 'POST',
    body: {
      name: 'Smoke Test',
      email,
      phone: '9876543210',
      address: '12 Test Street, Test City, 700001',
      payment: 'UPI',
      items: [{ productId: 5, qty: 1 }]
    }
  });
  ok('an online order waits for payment',
    onlineOrder.data.requiresPayment === true && onlineOrder.data.order.status === 'pending');

  ok('Razorpay is reported as unconfigured',
    (await call('/api/payments/razorpay/order', { method: 'POST', body: { orderId: onlineOrder.data.order.id } })).status === 503);

  const mine = await call('/api/orders');
  ok('GET /api/orders lists the customer\'s orders', mine.data.orders.length === 2);

  const orderId = codOrder.data.order.id;
  const lookupWrong = await call(`/api/orders/lookup?id=${orderId}&phone=9999999999`, { keepCookie: false });
  ok('order lookup is owner-scoped for the signed-in customer', lookupWrong.status === 200);

  const savedCookie = cookie;
  cookie = '';
  ok('a guest cannot read an order with the wrong phone',
    (await call(`/api/orders/lookup?id=${orderId}&phone=9999999999`, { keepCookie: false })).status === 403);
  const guestLookup = await call(`/api/orders/lookup?id=${orderId}&phone=9876543210`, { keepCookie: false });
  ok('a guest can track an order with the right phone', guestLookup.data.order?.id === orderId);
  ok('an unknown order id is a 404',
    (await call('/api/orders/lookup?id=PHBL-NOPE&phone=9876543210', { keepCookie: false })).status === 404);
  cookie = savedCookie;

  const cancelled = await call(`/api/orders/${orderId}/cancel`, { method: 'POST' });
  ok('a customer can cancel their order', cancelled.data.order.status === 'cancelled');
  ok('cancelling returns the stock',
    (await call('/api/products/1')).data.product.stock === stockBefore,
    `stock ${(await call('/api/products/1')).data.product.stock}, expected ${stockBefore}`);

  console.log('\nnewsletter and contact');
  const sub = await call('/api/newsletter', { method: 'POST', body: { email: `news${stamp}@example.com` } });
  ok('POST /api/newsletter', sub.status === 201);
  ok('an invalid address is rejected',
    (await call('/api/newsletter', { method: 'POST', body: { email: 'nope' } })).status === 400);

  const contact = await call('/api/contact', {
    method: 'POST',
    body: { name: 'Smoke Test', email, phone: '9876543210', subject: 'Hello', message: 'This is a smoke test message.' }
  });
  ok('POST /api/contact', contact.status === 201 && contact.data.id > 0);

  console.log('\nsessions');
  await call('/api/auth/logout', { method: 'POST' });
  ok('logout clears the session', (await call('/api/auth/me')).data.user === null);
  ok('the cart needs a session', (await call('/api/cart')).status === 401);

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { emailMobile: email, password: 'correct-horse-battery' }
  });
  ok('POST /api/auth/login', login.status === 200 && login.data.user.email === email);
  ok('a wrong password is a 401',
    (await call('/api/auth/login', { method: 'POST', body: { emailMobile: email, password: 'wrong-password' }, keepCookie: false })).status === 401);

  console.log('\nadmin');
  ok('admin routes reject a missing key', (await call('/api/admin/stats')).status === 401);
  ok('admin routes reject a wrong key',
    (await call('/api/admin/stats', { headers: { 'X-Admin-Key': 'nope' } })).status === 401);

  const admin = { headers: { 'X-Admin-Key': ADMIN_KEY } };
  const stats = await call('/api/admin/stats', admin);
  ok('GET /api/admin/stats', stats.data.stats?.orders.total === 2);

  const adminOrders = await call('/api/admin/orders', admin);
  ok('GET /api/admin/orders', adminOrders.data.orders.length === 2);

  const shipped = await call(`/api/admin/orders/${onlineOrder.data.order.id}`, {
    ...admin,
    method: 'PATCH',
    body: { status: 'shipped', paymentStatus: 'paid' }
  });
  ok('PATCH /api/admin/orders/:id updates status and payment',
    shipped.data.order.status === 'shipped' && shipped.data.order.paymentStatus === 'paid');

  ok('a cancelled order cannot be revived',
    (await call(`/api/admin/orders/${orderId}`, { ...admin, method: 'PATCH', body: { status: 'shipped' } })).status === 409);

  const stocked = await call('/api/admin/products/1', { ...admin, method: 'PATCH', body: { stock: 7 } });
  ok('PATCH /api/admin/products/:id updates stock', stocked.data.product.stock === 7);

  const deactivated = await call('/api/admin/products/16', { ...admin, method: 'DELETE' });
  ok('DELETE /api/admin/products/:id deactivates rather than deletes', deactivated.data.product.active === false);
  ok('a deactivated product leaves the storefront',
    (await call('/api/products')).data.products.length === 15);

  ok('GET /api/admin/customers', (await call('/api/admin/customers', admin)).data.customers.length >= 1);
  ok('GET /api/admin/messages', (await call('/api/admin/messages', admin)).data.messages.length === 1);

  console.log('\nmisc');
  ok('an unknown API route is a 404', (await call('/api/nope')).status === 404);
  const bridge = await fetch(`${BASE}/storefront-api.js`);
  ok('the storefront bridge is served', bridge.ok && (await bridge.text()).includes('PHBL'));
  const page = await fetch(BASE);
  const html = await page.text();
  ok('index.html is served with the bridge injected',
    page.ok && html.includes('storefront-api.js') && html.includes('PHBL'));
} catch (error) {
  failures.push(`harness error: ${error.message}`);
  console.error('\nharness error:', error);
  if (serverLog.length) console.error(serverLog.join(''));
} finally {
  restore();
}

console.log(`\n${passed} passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\nFailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
