import express from 'express';
import { all, one, query } from '../db.js';
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

adminRouter.get('/orders', async (req, res) => {
  const status = str(req.query.status, 20);
  const paymentStatus = str(req.query.paymentStatus, 20);
  const q = str(req.query.q, 80);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  const where = [];
  const params = [];

  if (status) {
    if (!ORDER_STATUSES.includes(status)) throw bad(`Unknown status "${status}".`);
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (paymentStatus) {
    if (!PAYMENT_STATUSES.includes(paymentStatus)) {
      throw bad(`Unknown payment status "${paymentStatus}".`);
    }
    params.push(paymentStatus);
    where.push(`payment_status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(
      `(id ILIKE $${i} OR customer_name ILIKE $${i} OR email ILIKE $${i} OR phone ILIKE $${i})`
    );
  }

  params.push(limit);

  const rows = await all(
    `SELECT * FROM orders
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );

  const orders = await Promise.all(rows.map(row => shapeOrder(row)));
  res.json({ ok: true, count: orders.length, orders });
});

adminRouter.get('/orders/:id', async (req, res) => {
  const row = await findOrder(req.params.id);
  if (!row) throw notFound('Order not found.');
  res.json({ ok: true, order: await shapeOrder(row) });
});

adminRouter.patch('/orders/:id', async (req, res) => {
  const row = await findOrder(req.params.id);
  if (!row) throw notFound('Order not found.');

  let order = await shapeOrder(row);
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
  if (await one('SELECT 1 FROM products WHERE slug = $1', [slug])) {
    throw bad(`A product with slug "${slug}" already exists.`);
  }

  // Seeded ids are fixed, so a new product takes the next free id.
  const { next } = await one('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM products');

  const created = await one(
    `INSERT INTO products (
       id, slug, name, category, price, old_price, badge, size, image,
       description, ingredients, benefits, usage_text, stock, active, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      next,
      slug,
      name,
      category,
      posInt(req.body?.price, { field: 'Price', min: 0 }),
      req.body?.oldPrice == null ? null : posInt(req.body.oldPrice, { field: 'Old price', min: 0 }),
      str(req.body?.badge, 40),
      str(req.body?.size, 40),
      str(req.body?.image, 300),
      str(req.body?.description ?? req.body?.desc, 600),
      str(req.body?.ingredients, 2000),
      str(req.body?.benefits, 2000),
      str(req.body?.usage, 2000),
      req.body?.stock == null ? 0 : posInt(req.body.stock, { field: 'Stock', min: 0 }),
      req.body?.active !== false,
      req.body?.sortOrder == null ? 999 : posInt(req.body.sortOrder, { field: 'Sort order', min: 0 })
    ]
  );

  res.status(201).json({ ok: true, product: await getProduct(created.id) });
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
  usage_text: v => str(v, 2000),
  stock: v => posInt(v, { field: 'Stock', min: 0 }),
  active: v => Boolean(v),
  sort_order: v => posInt(v, { field: 'Sort order', min: 0 })
};

const ALIASES = {
  oldPrice: 'old_price',
  desc: 'description',
  sortOrder: 'sort_order',
  usage: 'usage_text'
};

adminRouter.patch('/products/:id', async (req, res) => {
  const id = posInt(req.params.id, { field: 'Product id' });
  if (!(await getProduct(id))) throw notFound('Product not found.');

  const sets = [];
  const values = [];

  for (const [key, raw] of Object.entries(req.body ?? {})) {
    const column = ALIASES[key] ?? key;
    const parse = PATCHABLE[column];
    if (!parse) continue;
    values.push(parse(raw));
    sets.push(`${column} = $${values.length}`);
  }

  if (!sets.length) throw bad('Nothing to update. Send at least one editable field.');

  values.push(id);
  await query(
    `UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
    values
  );

  res.json({ ok: true, product: await getProduct(id) });
});

/** Products are deactivated rather than deleted, so past orders stay readable. */
adminRouter.delete('/products/:id', async (req, res) => {
  const id = posInt(req.params.id, { field: 'Product id' });
  if (!(await getProduct(id))) throw notFound('Product not found.');

  await query('UPDATE products SET active = FALSE, updated_at = now() WHERE id = $1', [id]);
  res.json({ ok: true, product: await getProduct(id) });
});

/* ------------------------------------------------- customers and messages */

adminRouter.get('/customers', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

  const customers = await all(
    `SELECT u.id, u.name, u.email, u.phone,
            u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
            COUNT(o.id)::int AS "orderCount",
            COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)::int AS "lifetimeValue"
     FROM users u
     LEFT JOIN orders o ON o.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT $1`,
    [limit]
  );

  res.json({ ok: true, count: customers.length, customers });
});

adminRouter.get('/messages', async (req, res) => {
  const messages = await all('SELECT * FROM messages ORDER BY created_at DESC LIMIT $1', [
    Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
  ]);
  res.json({ ok: true, count: messages.length, messages });
});

adminRouter.patch('/messages/:id', async (req, res) => {
  const id = posInt(req.params.id, { field: 'Message id' });
  const handled = req.body?.handled !== false;

  const { rowCount } = await query('UPDATE messages SET handled = $1 WHERE id = $2', [handled, id]);
  if (!rowCount) throw notFound('Message not found.');

  res.json({ ok: true, id, handled });
});

adminRouter.get('/newsletter', async (_req, res) => {
  const subscribers = await all(
    'SELECT email, created_at AS "createdAt", active FROM newsletter ORDER BY created_at DESC'
  );
  res.json({ ok: true, count: subscribers.length, subscribers });
});

/* ------------------------------------------------------------------ stats */

adminRouter.get('/stats', async (_req, res) => {
  const [orders, revenue, customers, newsletter, messages, lowStock, topProducts] =
    await Promise.all([
      one(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
               COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
               COUNT(*) FILTER (WHERE status = 'shipped')::int   AS shipped,
               COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
               COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
        FROM orders
      `),
      one(`
        SELECT COALESCE(SUM(total), 0)::int AS "paidTotal",
               COALESCE(SUM(total) FILTER (WHERE created_at >= now() - interval '30 days'), 0)::int
                 AS "last30Days"
        FROM orders WHERE payment_status = 'paid' AND status <> 'cancelled'
      `),
      one('SELECT COUNT(*)::int AS total FROM users'),
      one('SELECT COUNT(*)::int AS total FROM newsletter WHERE active = TRUE'),
      one(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE handled = FALSE)::int AS open
        FROM messages
      `),
      all(`
        SELECT id, name, stock FROM products
        WHERE active = TRUE AND stock <= 5 ORDER BY stock, name
      `),
      all(`
        SELECT oi.product_id AS "productId", oi.name,
               SUM(oi.qty)::int AS "unitsSold",
               SUM(oi.line_total)::int AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status <> 'cancelled'
        GROUP BY oi.product_id, oi.name
        ORDER BY "unitsSold" DESC
        LIMIT 10
      `)
    ]);

  res.json({
    ok: true,
    stats: { orders, revenue, customers, newsletter, messages, lowStock, topProducts }
  });
});
