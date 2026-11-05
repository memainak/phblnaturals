import { all, one, query, transaction } from './db.js';
import { clearCart, isOnlineMethod, priceBasket, releaseStock, reserveStock } from './store.js';
import { HttpError, orderId, requireEmail, requirePhone, requireStr, str } from './util.js';

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'cancelled'
];

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'failed', 'refunded'];

const ITEM_COLUMNS = `
  product_id AS "productId", name, size, image,
  unit_price AS "unitPrice", qty, line_total AS "lineTotal"
`;

const selectItems = (orderId_, client = null) => {
  const sql = `SELECT ${ITEM_COLUMNS} FROM order_items WHERE order_id = $1 ORDER BY id`;
  return client ? client.query(sql, [orderId_]).then(r => r.rows) : all(sql, [orderId_]);
};

const iso = value => (value instanceof Date ? value.toISOString() : value);

export async function shapeOrder(row, { includeContact = true, client = null } = {}) {
  if (!row) return null;

  const order = {
    id: row.id,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    subtotal: row.subtotal,
    shipping: row.shipping,
    codFee: row.cod_fee,
    total: row.total,
    currency: 'INR',
    placedAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    items: await selectItems(row.id, client)
  };

  if (includeContact) {
    order.customer = {
      name: row.customer_name,
      email: row.email,
      phone: row.phone,
      address: row.address
    };
    order.notes = row.notes;
  }
  if (row.razorpay_order_id) order.razorpayOrderId = row.razorpay_order_id;

  return order;
}

export const findOrder = id =>
  one('SELECT * FROM orders WHERE id = $1', [String(id || '').trim().toUpperCase()]);

/**
 * Validates the checkout form, re-prices the basket from the database,
 * reserves stock and writes the order — all in one transaction. Prices from
 * the client are ignored.
 */
export async function createOrder({ body, user }) {
  const name = requireStr(body?.name ?? body?.fullName ?? user?.name, 'Full name', {
    min: 2,
    max: 120
  });
  const email = requireEmail(body?.email ?? user?.email);
  const phone = requirePhone(body?.phone ?? user?.phone);
  const address = requireStr(body?.address, 'Delivery address', { min: 10, max: 600 });
  const notes = str(body?.notes, 400);

  const items =
    Array.isArray(body?.items) && body.items.length
      ? body.items
      : user
        ? await all('SELECT product_id AS "productId", qty FROM carts WHERE user_id = $1', [user.id])
        : [];

  const quote = await priceBasket(items, body?.payment ?? body?.paymentMethod ?? 'upi');

  const id = orderId();
  const online = isOnlineMethod(quote.paymentMethod);

  return transaction(async client => {
    await reserveStock(client, quote.items);

    await client.query(
      `INSERT INTO orders (
         id, user_id, customer_name, email, phone, address, notes, payment_method,
         subtotal, shipping, cod_fee, total, status, payment_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        user?.id ?? null,
        name,
        email,
        phone,
        address,
        notes,
        quote.paymentMethod,
        quote.subtotal,
        quote.shipping,
        quote.codFee,
        quote.total,
        // An online order is only confirmed once payment is verified.
        online ? 'pending' : 'confirmed',
        'unpaid'
      ]
    );

    for (const item of quote.items) {
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, name, size, image, unit_price, qty, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, item.productId, item.name, item.size, item.image, item.unitPrice, item.qty, item.lineTotal]
      );
    }

    if (user) await client.query('DELETE FROM carts WHERE user_id = $1', [user.id]);

    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    return { order: await shapeOrder(rows[0], { client }), requiresPayment: online };
  });
}

export const attachRazorpayOrder = (id, razorpayOrderId) =>
  query(`UPDATE orders SET razorpay_order_id = $1, updated_at = now() WHERE id = $2`, [
    razorpayOrderId,
    id
  ]);

export async function markPaid(id, paymentId) {
  const row = await findOrder(id);
  if (!row) throw new HttpError(404, 'Order not found.');
  if (row.payment_status === 'paid') return shapeOrder(row);

  await query(
    `UPDATE orders
     SET payment_status = 'paid',
         status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
         razorpay_payment_id = COALESCE($1, razorpay_payment_id),
         updated_at = now()
     WHERE id = $2`,
    [paymentId ?? null, id]
  );

  return shapeOrder(await findOrder(id));
}

export async function markPaymentFailed(id, paymentId) {
  const row = await findOrder(id);
  if (!row || row.payment_status === 'paid') return shapeOrder(row);

  await query(
    `UPDATE orders
     SET payment_status = 'failed',
         razorpay_payment_id = COALESCE($1, razorpay_payment_id),
         updated_at = now()
     WHERE id = $2`,
    [paymentId ?? null, id]
  );

  return shapeOrder(await findOrder(id));
}

/** Cancelling returns the reserved stock to the catalogue exactly once. */
export function cancelOrder(id) {
  return transaction(async client => {
    // FOR UPDATE keeps a second cancel from double-crediting the stock.
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
    const row = rows[0];

    if (!row) throw new HttpError(404, 'Order not found.');
    if (row.status === 'cancelled') return shapeOrder(row, { client });
    if (row.status === 'delivered') {
      throw new HttpError(409, 'A delivered order cannot be cancelled.');
    }

    await releaseStock(client, await selectItems(id, client));
    await client.query(
      `UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [id]
    );

    const updated = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
    return shapeOrder(updated.rows[0], { client });
  });
}

export async function updateOrderStatus(id, status) {
  if (!ORDER_STATUSES.includes(status)) {
    throw new HttpError(400, `Status must be one of: ${ORDER_STATUSES.join(', ')}.`);
  }
  if (status === 'cancelled') return cancelOrder(id);

  const row = await findOrder(id);
  if (!row) throw new HttpError(404, 'Order not found.');
  if (row.status === 'cancelled') {
    throw new HttpError(409, 'A cancelled order cannot be moved to another status.');
  }

  await query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
  return shapeOrder(await findOrder(id));
}

export async function updatePaymentStatus(id, paymentStatus) {
  if (!PAYMENT_STATUSES.includes(paymentStatus)) {
    throw new HttpError(400, `Payment status must be one of: ${PAYMENT_STATUSES.join(', ')}.`);
  }
  if (paymentStatus === 'paid') return markPaid(id, null);

  const row = await findOrder(id);
  if (!row) throw new HttpError(404, 'Order not found.');

  await query('UPDATE orders SET payment_status = $1, updated_at = now() WHERE id = $2', [
    paymentStatus,
    id
  ]);
  return shapeOrder(await findOrder(id));
}

export async function listOrdersForUser(userId, limit = 50) {
  const rows = await all(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return Promise.all(rows.map(row => shapeOrder(row)));
}
