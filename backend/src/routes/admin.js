import express from 'express';
import { countUsers, listCustomersWithOrderStats } from '../accounts.js';
import {
  docsOf,
  messages,
  newsletter,
  nextId,
  orders,
  products,
  serverTimestamp,
  toIso
} from '../db.js';
import { requireAdmin } from '../middleware.js';
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  findOrder,
  shapeOrder,
  updateOrderStatus,
  updatePaymentStatus
} from '../orders.js';
import { getProduct, listProducts } from '../store.js';
import { bad, notFound, posInt, slugify, str } from '../util.js';

export const adminRouter = express.Router();

adminRouter.use(requireAdmin);

/**
 * Firestore has no aggregation across collections and no substring search, so
 * the dashboard reads a bounded window of recent orders and computes totals in
 * memory. The cap is reported in every response that depends on it, so a shop
 * that outgrows it sees that rather than a quietly wrong number.
 */
const ORDER_SCAN_CAP = 2000;

const recentOrders = async (limit = ORDER_SCAN_CAP) =>
  docsOf(await orders().orderBy('createdAt', 'desc').limit(limit).get());

/* ----------------------------------------------------------------- orders */

adminRouter.get('/orders', async (req, res) => {
  const status = str(req.query.status, 20);
  const paymentStatus = str(req.query.paymentStatus, 20);
  const q = str(req.query.q, 80).toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  if (status && !ORDER_STATUSES.includes(status)) throw bad(`Unknown status "${status}".`);
  if (paymentStatus && !PAYMENT_STATUSES.includes(paymentStatus)) {
    throw bad(`Unknown payment status "${paymentStatus}".`);
  }

  let query = orders().orderBy('createdAt', 'desc');
  if (status) query = query.where('status', '==', status);
  if (paymentStatus) query = query.where('paymentStatus', '==', paymentStatus);

  // A text search has to be done in memory, so it reads a wider window first
  // and narrows afterwards; the equality filters above stay server-side.
  const rows = docsOf(await query.limit(q ? ORDER_SCAN_CAP : limit).get());

  const matched = q
    ? rows.filter(row =>
        [row.id, row.customerName, row.email, row.phone]
          .filter(Boolean)
          .some(field => String(field).toLowerCase().includes(q))
      )
    : rows;

  const orderList = matched.slice(0, limit).map(row => shapeOrder(row));

  res.json({
    ok: true,
    count: orderList.length,
    ...(q ? { searchedWithin: rows.length, scanCap: ORDER_SCAN_CAP } : {}),
    orders: orderList
  });
});

adminRouter.get('/orders/:id', async (req, res) => {
  const row = await findOrder(req.params.id);
  if (!row) throw notFound('Order not found.');
  res.json({ ok: true, order: shapeOrder(row) });
});

adminRouter.patch('/orders/:id', async (req, res) => {
  const row = await findOrder(req.params.id);
  if (!row) throw notFound('Order not found.');

  let order = shapeOrder(row);
  if (req.body?.status !== undefined) {
    order = await updateOrderStatus(row.id, str(req.body.status, 20));
  }
  if (req.body?.paymentStatus !== undefined) {
    order = await updatePaymentStatus(row.id, str(req.body.paymentStatus, 20));
  }

  res.json({ ok: true, order });
});

/* --------------------------------------------------------------- products */

adminRouter.get('/products', async (_req, res) => {
  res.json({ ok: true, products: await listProducts({ includeInactive: true }) });
});

adminRouter.post('/products', async (req, res) => {
  const name = str(req.body?.name, 160);
  const category = str(req.body?.category, 60);
  if (!name || !category) throw bad('A product needs at least a name and a category.');

  const slug = str(req.body?.slug, 120) || slugify(`${name}-${str(req.body?.size, 40)}`);
  if (!(await products().where('slug', '==', slug).limit(1).get()).empty) {
    throw bad(`A product with slug "${slug}" already exists.`);
  }

  // Seeded ids are fixed, so a new product takes the next id from the counter.
  const id = await nextId('products', 1);

  await products()
    .doc(String(id))
    .set({
      id,
      slug,
      name,
      category,
      price: posInt(req.body?.price, { field: 'Price', min: 0 }),
      oldPrice:
        req.body?.oldPrice == null ? null : posInt(req.body.oldPrice, { field: 'Old price', min: 0 }),
      badge: str(req.body?.badge, 40),
      size: str(req.body?.size, 40),
      image: str(req.body?.image, 300),
      desc: str(req.body?.description ?? req.body?.desc, 600),
      ingredients: str(req.body?.ingredients, 2000),
      benefits: str(req.body?.benefits, 2000),
      usage: str(req.body?.usage, 2000),
      stock: req.body?.stock == null ? 0 : posInt(req.body.stock, { field: 'Stock', min: 0 }),
      active: req.body?.active !== false,
      sortOrder:
        req.body?.sortOrder == null ? 999 : posInt(req.body.sortOrder, { field: 'Sort order', min: 0 }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

  res.status(201).json({ ok: true, product: await getProduct(id) });
});

const PATCHABLE = {
  name: v => str(v, 160),
  category: v => str(v, 60),
  price: v => posInt(v, { field: 'Price', min: 0 }),
  oldPrice: v => (v == null ? null : posInt(v, { field: 'Old price', min: 0 })),
  badge: v => str(v, 40),
  size: v => str(v, 40),
  image: v => str(v, 300),
  desc: v => str(v, 600),
  ingredients: v => str(v, 2000),
  benefits: v => str(v, 2000),
  usage: v => str(v, 2000),
  stock: v => posInt(v, { field: 'Stock', min: 0 }),
  active: v => Boolean(v),
  sortOrder: v => posInt(v, { field: 'Sort order', min: 0 })
};

// The old SQL column names stay accepted, so anything already calling the
// API keeps working.
const ALIASES = {
  old_price: 'oldPrice',
  description: 'desc',
  sort_order: 'sortOrder',
  usage_text: 'usage'
};

adminRouter.patch('/products/:id', async (req, res) => {
  const id = posInt(req.params.id, { field: 'Product id' });
  if (!(await getProduct(id))) throw notFound('Product not found.');

  const patch = {};

  for (const [key, raw] of Object.entries(req.body ?? {})) {
    const field = ALIASES[key] ?? key;
    const parse = PATCHABLE[field];
    if (!parse) continue;
    patch[field] = parse(raw);
  }

  if (!Object.keys(patch).length) {
    throw bad('Nothing to update. Send at least one editable field.');
  }

  patch.updatedAt = serverTimestamp();
  await products().doc(String(id)).update(patch);

  res.json({ ok: true, product: await getProduct(id) });
});

/** Products are deactivated rather than deleted, so past orders stay readable. */
adminRouter.delete('/products/:id', async (req, res) => {
  const id = posInt(req.params.id, { field: 'Product id' });
  if (!(await getProduct(id))) throw notFound('Product not found.');

  await products().doc(String(id)).update({ active: false, updatedAt: serverTimestamp() });
  res.json({ ok: true, product: await getProduct(id) });
});

/* ------------------------------------------------- customers and messages */

adminRouter.get('/customers', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

  const customers = await listCustomersWithOrderStats(limit, await recentOrders());

  res.json({ ok: true, count: customers.length, customers, scanCap: ORDER_SCAN_CAP });
});

adminRouter.get('/messages', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  const rows = docsOf(await messages().orderBy('createdAt', 'desc').limit(limit).get()).map(
    row => ({ ...row, id: Number(row.id), createdAt: toIso(row.createdAt) })
  );

  res.json({ ok: true, count: rows.length, messages: rows });
});

adminRouter.patch('/messages/:id', async (req, res) => {
  const id = posInt(req.params.id, { field: 'Message id' });
  const handled = req.body?.handled !== false;

  const ref = messages().doc(String(id));
  if (!(await ref.get()).exists) throw notFound('Message not found.');

  await ref.update({ handled });
  res.json({ ok: true, id, handled });
});

adminRouter.get('/newsletter', async (_req, res) => {
  const subscribers = docsOf(await newsletter().orderBy('createdAt', 'desc').get()).map(row => ({
    email: row.email ?? row.id,
    createdAt: toIso(row.createdAt),
    active: Boolean(row.active)
  }));

  res.json({ ok: true, count: subscribers.length, subscribers });
});

/* ------------------------------------------------------------------ stats */

adminRouter.get('/stats', async (_req, res) => {
  const [orderRows, catalogue, customerCount, newsletterRows, messageRows] = await Promise.all([
    recentOrders(),
    listProducts({ includeInactive: true }),
    countUsers(),
    newsletter().where('active', '==', true).count().get(),
    messages().get()
  ]);

  const countBy = status => orderRows.filter(row => row.status === status).length;

  const paid = orderRows.filter(row => row.paymentStatus === 'paid' && row.status !== 'cancelled');
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;

  const sum = (rows, pick = row => row.total ?? 0) => rows.reduce((n, row) => n + pick(row), 0);

  // Units sold per product, over everything that was not cancelled.
  const sold = new Map();
  for (const order of orderRows) {
    if (order.status === 'cancelled') continue;
    for (const item of order.items ?? []) {
      const entry = sold.get(item.productId) ?? {
        productId: item.productId,
        name: item.name,
        unitsSold: 0,
        revenue: 0
      };
      entry.unitsSold += item.qty;
      entry.revenue += item.lineTotal;
      sold.set(item.productId, entry);
    }
  }

  const unhandled = messageRows.docs.filter(doc => doc.data().handled === false).length;

  res.json({
    ok: true,
    stats: {
      orders: {
        total: orderRows.length,
        pending: countBy('pending'),
        confirmed: countBy('confirmed'),
        shipped: countBy('shipped'),
        delivered: countBy('delivered'),
        cancelled: countBy('cancelled')
      },
      revenue: {
        paidTotal: sum(paid),
        last30Days: sum(
          paid.filter(row => {
            const placed = toIso(row.createdAt);
            return placed && Date.parse(placed) >= thirtyDaysAgo;
          })
        )
      },
      customers: { total: customerCount },
      newsletter: { total: newsletterRows.data().count },
      messages: { total: messageRows.size, open: unhandled },
      lowStock: catalogue
        .filter(product => product.active && product.stock <= 5)
        .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
        .map(({ id, name, stock }) => ({ id, name, stock })),
      topProducts: [...sold.values()].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 10),
      scanCap: ORDER_SCAN_CAP
    }
  });
});
