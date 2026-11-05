import { db, transaction } from './db.js';
import { clearCart, isOnlineMethod, priceBasket, releaseStock, reserveStock } from './store.js';
import { HttpError, orderId, requireEmail, requirePhone, requireStr, str } from './util.js';

const insertOrder = db.prepare(`
  INSERT INTO orders (
    id, user_id, customer_name, email, phone, address, notes, payment_method,
    subtotal, shipping, cod_fee, total, status, payment_status
  ) VALUES (
    $id, $userId, $name, $email, $phone, $address, $notes, $paymentMethod,
    $subtotal, $shipping, $codFee, $total, $status, $paymentStatus
  )
`);

const insertItem = db.prepare(`
  INSERT INTO order_items (order_id, product_id, name, size, image, unit_price, qty, line_total)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
const selectItems = db.prepare(
  `SELECT product_id AS productId, name, size, image, unit_price AS unitPrice, qty,
          line_total AS lineTotal
   FROM order_items WHERE order_id = ? ORDER BY id`
);

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'cancelled'
];

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'failed', 'refunded'];

export function shapeOrder(row, { includeContact = true } = {}) {
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
    placedAt: row.created_at,
    updatedAt: row.updated_at,
    items: selectItems.all(row.id)
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

export const findOrder = id => selectOrder.get(String(id || '').trim().toUpperCase());

/**
 * Validates the checkout form, re-prices the basket from the database,
 * reserves stock and writes the order. Prices from the client are ignored.
 */
export function createOrder({ body, user }) {
  const name = requireStr(body?.name ?? body?.fullName ?? user?.name, 'Full name', {
    min: 2,
    max: 120
  });
  const email = requireEmail(body?.email ?? user?.email);
  const phone = requirePhone(body?.phone ?? user?.phone);
  const address = requireStr(body?.address, 'Delivery address', { min: 10, max: 600 });
  const notes = str(body?.notes, 400);

  const items = Array.isArray(body?.items) && body.items.length
    ? body.items
    : user
      ? db
          .prepare('SELECT product_id AS productId, qty FROM carts WHERE user_id = ?')
          .all(user.id)
      : [];

  const quote = priceBasket(items, body?.payment ?? body?.paymentMethod ?? 'upi');

  const id = orderId();
  const online = isOnlineMethod(quote.paymentMethod);

  return transaction(() => {
    reserveStock(quote.items);

    insertOrder.run({
      id,
      userId: user?.id ?? null,
      name,
      email,
      phone,
      address,
      notes,
      paymentMethod: quote.paymentMethod,
      subtotal: quote.subtotal,
      shipping: quote.shipping,
      codFee: quote.codFee,
      total: quote.total,
      // An online order is only confirmed once payment is verified.
      status: online ? 'pending' : 'confirmed',
      paymentStatus: 'unpaid'
    });

    for (const item of quote.items) {
      insertItem.run(
        id,
        item.productId,
        item.name,
        item.size,
        item.image,
        item.unitPrice,
        item.qty,
        item.lineTotal
      );
    }

    if (user) clearCart(user.id);

    return { order: shapeOrder(selectOrder.get(id)), requiresPayment: online };
  });
}

const setStatus = db.prepare(
  `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
);
const setPayment = db.prepare(`
  UPDATE orders
  SET payment_status = ?, status = ?, razorpay_payment_id = COALESCE(?, razorpay_payment_id),
      updated_at = datetime('now')
  WHERE id = ?
`);
const setRazorpayOrder = db.prepare(
  `UPDATE orders SET razorpay_order_id = ?, updated_at = datetime('now') WHERE id = ?`
);

export function attachRazorpayOrder(id, razorpayOrderId) {
  setRazorpayOrder.run(razorpayOrderId, id);
}

export function markPaid(id, paymentId) {
  const row = selectOrder.get(id);
  if (!row) throw new HttpError(404, 'Order not found.');
  if (row.payment_status === 'paid') return shapeOrder(row);

  const status = row.status === 'pending' ? 'confirmed' : row.status;
  setPayment.run('paid', status, paymentId ?? null, id);
  return shapeOrder(selectOrder.get(id));
}

export function markPaymentFailed(id, paymentId) {
  const row = selectOrder.get(id);
  if (!row || row.payment_status === 'paid') return shapeOrder(row);

  setPayment.run('failed', row.status, paymentId ?? null, id);
  return shapeOrder(selectOrder.get(id));
}

/** Cancelling returns the reserved stock to the catalogue exactly once. */
export function cancelOrder(id) {
  return transaction(() => {
    const row = selectOrder.get(id);
    if (!row) throw new HttpError(404, 'Order not found.');
    if (row.status === 'cancelled') return shapeOrder(row);
    if (row.status === 'delivered') {
      throw new HttpError(409, 'A delivered order cannot be cancelled.');
    }

    releaseStock(selectItems.all(id));
    setStatus.run('cancelled', id);
    return shapeOrder(selectOrder.get(id));
  });
}

export function updateOrderStatus(id, status) {
  if (!ORDER_STATUSES.includes(status)) {
    throw new HttpError(400, `Status must be one of: ${ORDER_STATUSES.join(', ')}.`);
  }
  if (status === 'cancelled') return cancelOrder(id);

  const row = selectOrder.get(id);
  if (!row) throw new HttpError(404, 'Order not found.');
  if (row.status === 'cancelled') {
    throw new HttpError(409, 'A cancelled order cannot be moved to another status.');
  }

  setStatus.run(status, id);
  return shapeOrder(selectOrder.get(id));
}

export function updatePaymentStatus(id, paymentStatus) {
  if (!PAYMENT_STATUSES.includes(paymentStatus)) {
    throw new HttpError(400, `Payment status must be one of: ${PAYMENT_STATUSES.join(', ')}.`);
  }
  if (paymentStatus === 'paid') return markPaid(id, null);

  const row = selectOrder.get(id);
  if (!row) throw new HttpError(404, 'Order not found.');

  setPayment.run(paymentStatus, row.status, null, id);
  return shapeOrder(selectOrder.get(id));
}

export function listOrdersForUser(userId, limit = 50) {
  return db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit)
    .map(row => shapeOrder(row));
}
