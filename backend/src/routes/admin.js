import express from 'express';
import { db } from '../db.js';
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

/* ----------------------------------------------------------------- orders */

adminRouter.get('/orders', (req, res) => {
  const status = str(req.query.status, 20);
  const paymentStatus = str(req.query.paymentStatus, 20);
  const q = str(req.query.q, 80);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  const where = [];
  const params = [];

  if (status) {
    if (!ORDER_STATUSES.includes(status)) throw bad(`Unknown status "${status}".`);
    where.push('status = ?');
    params.push(status);
  }
  if (paymentStatus) {
    if (!PAYMENT_STATUSES.includes(paymentStatus)) {
      throw bad(`Unknown payment status "${paymentStatus}".`);
    }
    where.push('payment_status = ?');
    params.push(paymentStatus);
  }
  if (q) {
    where.push('(id LIKE ? OR customer_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY created_at DESC LIMIT ?`;

  const orders = db.prepare(sql).all(...params, limit).map(row => shapeOrder(row));
  res.json({ ok: true, count: orders.length, orders });
});

adminRouter.get('/orders/:id', (req, res) => {
  const row = findOrder(req.params.id);
  if (!row) throw notFound('Order not found.');
  res.json({ ok: true, order: shapeOrder(row) });
});

adminRouter.patch('/orders/:id', (req, res) => {
  const row = findOrder(req.params.id);
  if (!row) throw notFound('Order not found.');

  let order = shapeOrder(row);
  if (req.body?.status !== undefined) {
    order = updateOrderStatus(row.id, str(req.body.status, 20));
  }
  if (req.body?.paymentStatus !== undefined) {
    order = updatePaymentStatus(row.id, str(req.body.paymentStatus, 20));
  }

  res.json({ ok: true, order });
});

/* --------------------------------------------------------------- products */

adminRouter.get('/products', (_req, res) => {
  res.json({ ok: true, products: listProducts({ includeInactive: true }) });
});

const insertProduct = db.prepare(`
  INSERT INTO products (
    slug, name, category, price, old_price, badge, size, image,
    description, ingredients, benefits, usage, stock, active, sort_order
  ) VALUES (
    $slug, $name, $category, $price, $oldPrice, $badge, $size, $image,
    $description, $ingredients, $benefits, $usage, $stock, $active, $sortOrder
  )
`);

adminRouter.post('/products', (req, res) => {
  const name = str(req.body?.name, 160);
  const category = str(req.body?.category, 60);
  if (!name || !category) throw bad('A product needs at least a name and a category.');

  const slug = str(req.body?.slug, 120) || slugify(`${name}-${str(req.body?.size, 40)}`);
  if (db.prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) {
    throw bad(`A product with slug "${slug}" already exists.`);
  }

  const { lastInsertRowid } = insertProduct.run({
    slug,
    name,
    category,
    price: posInt(req.body?.price, { field: 'Price', min: 0 }),
    oldPrice: req.body?.oldPrice == null ? null : posInt(req.body.oldPrice, { field: 'Old price', min: 0 }),
    badge: str(req.body?.badge, 40),
    size: str(req.body?.size, 40),
    image: str(req.body?.image, 300),
    description: str(req.body?.description ?? req.body?.desc, 600),
    ingredients: str(req.body?.ingredients, 2000),
    benefits: str(req.body?.benefits, 2000),
    usage: str(req.body?.usage, 2000),
    stock: req.body?.stock == null ? 0 : posInt(req.body.stock, { field: 'Stock', min: 0 }),
    active: req.body?.active === false ? 0 : 1,
    sortOrder: req.body?.sortOrder == null ? 999 : posInt(req.body.sortOrder, { field: 'Sort order', min: 0 })
  });

  res.status(201).json({ ok: true, product: getProduct(Number(lastInsertRowid)) });
});

const PATCHABLE = {
  name: v => str(v, 160),
  category: v => str(v, 60),
  price: v => posInt(v, { field: 'Price', min: 0 }),
  old_price: v => (v == null ? null : posInt(v, { field: 'Old price', min: 0 })),
  badge: v => str(v, 40),
  size: v => str(v, 40),
  image: v => str(v, 300),
  description: v => str(v, 600),
  ingredients: v => str(v, 2000),
  benefits: v => str(v, 2000),
  usage: v => str(v, 2000),
  stock: v => posInt(v, { field: 'Stock', min: 0 }),
  active: v => (v ? 1 : 0),
  sort_order: v => posInt(v, { field: 'Sort order', min: 0 })
};

const ALIASES = { oldPrice: 'old_price', desc: 'description', sortOrder: 'sort_order' };

adminRouter.patch('/products/:id', (req, res) => {
  const id = posInt(req.params.id, { field: 'Product id' });
  if (!getProduct(id)) throw notFound('Product not found.');

  const sets = [];
  const values = [];

  for (const [key, raw] of Object.entries(req.body ?? {})) {
    const column = ALIASES[key] ?? key;
    const parse = PATCHABLE[column];
    if (!parse) continue;
    sets.push(`${column} = ?`);
    values.push(parse(raw));
  }

  if (!sets.length) throw bad('Nothing to update. Send at least one editable field.');

  db.prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...values, id);

  res.json({ ok: true, product: getProduct(id) });
});

/** Products are deactivated rather than deleted, so past orders stay readable. */
adminRouter.delete('/products/:id', (req, res) => {
  const id = posInt(req.params.id, { field: 'Product id' });
  if (!getProduct(id)) throw notFound('Product not found.');

  db.prepare(`UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  res.json({ ok: true, product: getProduct(id) });
});

/* ------------------------------------------------- customers and messages */

adminRouter.get('/customers', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const customers = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
              COUNT(o.id) AS orderCount,
              COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END), 0) AS lifetimeValue
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT ?`
    )
    .all(limit);

  res.json({ ok: true, count: customers.length, customers });
});

adminRouter.get('/messages', (req, res) => {
  const messages = db
    .prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(Number(req.query.limit) || 100, 1), 500));
  res.json({ ok: true, count: messages.length, messages });
});

adminRouter.patch('/messages/:id', (req, res) => {
  const id = posInt(req.params.id, { field: 'Message id' });
  const handled = req.body?.handled === false ? 0 : 1;

  const { changes } = db.prepare('UPDATE messages SET handled = ? WHERE id = ?').run(handled, id);
  if (!changes) throw notFound('Message not found.');

  res.json({ ok: true, id, handled: Boolean(handled) });
});

adminRouter.get('/newsletter', (_req, res) => {
  const subscribers = db
    .prepare('SELECT email, created_at AS createdAt, active FROM newsletter ORDER BY created_at DESC')
    .all();
  res.json({ ok: true, count: subscribers.length, subscribers });
});

/* ------------------------------------------------------------------ stats */

adminRouter.get('/stats', (_req, res) => {
  const one = sql => db.prepare(sql).get();

  res.json({
    ok: true,
    stats: {
      orders: one(`
        SELECT COUNT(*) AS total,
               SUM(status = 'pending')   AS pending,
               SUM(status = 'confirmed') AS confirmed,
               SUM(status = 'shipped')   AS shipped,
               SUM(status = 'delivered') AS delivered,
               SUM(status = 'cancelled') AS cancelled
        FROM orders
      `),
      revenue: one(`
        SELECT COALESCE(SUM(total), 0) AS paidTotal,
               COALESCE(SUM(CASE WHEN created_at >= date('now', '-30 day') THEN total END), 0) AS last30Days
        FROM orders WHERE payment_status = 'paid' AND status != 'cancelled'
      `),
      customers: one('SELECT COUNT(*) AS total FROM users'),
      newsletter: one('SELECT COUNT(*) AS total FROM newsletter WHERE active = 1'),
      messages: one('SELECT COUNT(*) AS total, SUM(handled = 0) AS open FROM messages'),
      lowStock: db
        .prepare(
          `SELECT id, name, stock FROM products
           WHERE active = 1 AND stock <= 5 ORDER BY stock, name`
        )
        .all(),
      topProducts: db
        .prepare(
          `SELECT oi.product_id AS productId, oi.name, SUM(oi.qty) AS unitsSold,
                  SUM(oi.line_total) AS revenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE o.status != 'cancelled'
           GROUP BY oi.product_id
           ORDER BY unitsSold DESC
           LIMIT 10`
        )
        .all()
    }
  });
});
