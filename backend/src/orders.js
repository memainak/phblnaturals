import { cartOf, docsOf, orders, serverTimestamp, toIso, transaction, withId } from './db.js';
import {
  getCartRows,
  isOnlineMethod,
  priceBasket,
  releaseStock,
  reserveStock
} from './store.js';
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

const normaliseId = value => String(value ?? '').trim().toUpperCase();

/**
 * Order documents hold their line items in an `items` array, so shaping an
 * order needs no further reads. The signature keeps its options object for the
 * call sites that pass `{ includeContact: false }`.
 */
export function shapeOrder(row, { includeContact = true } = {}) {
  if (!row) return null;

  const order = {
    id: row.id,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    subtotal: row.subtotal,
    shipping: row.shipping,
    codFee: row.codFee,
    total: row.total,
    currency: 'INR',
    placedAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    items: (row.items ?? []).map(item => ({
      productId: item.productId,
      name: item.name,
      size: item.size ?? '',
      image: item.image ?? '',
      unitPrice: item.unitPrice,
      qty: item.qty,
      lineTotal: item.lineTotal
    }))
  };

  if (includeContact) {
    order.customer = {
      name: row.customerName,
      email: row.email,
      phone: row.phone,
      address: row.address
    };
    order.notes = row.notes ?? '';
  }
  if (row.razorpayOrderId) order.razorpayOrderId = row.razorpayOrderId;

  return order;
}

export async function findOrder(id) {
  const key = normaliseId(id);
  if (!key) return null;
  return withId(await orders().doc(key).get());
}

export async function findOrderByRazorpayId(razorpayOrderId) {
  const snapshot = await orders()
    .where('razorpayOrderId', '==', String(razorpayOrderId ?? '').trim())
    .limit(1)
    .get();

  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

/**
 * Validates the checkout form, re-prices the basket, then reserves stock and
 * writes the order in one Firestore transaction. Prices from the client are
 * ignored.
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
        ? await getCartRows(user.id)
        : [];

  const quote = await priceBasket(items, body?.payment ?? body?.paymentMethod ?? 'upi');

  const id = orderId();
  const online = isOnlineMethod(quote.paymentMethod);
  const ref = orders().doc(id);

  await transaction(async tx => {
    // Reads first: the cart, then every product reserveStock touches.
    const cartDocs = user ? (await tx.get(cartOf(user.id))).docs : [];

    await reserveStock(tx, quote.items);

    tx.set(ref, {
      userId: user?.id ?? null,
      customerName: name,
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
      paymentStatus: 'unpaid',
      razorpayOrderId: null,
      razorpayPaymentId: null,
      items: quote.items,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    for (const doc of cartDocs) tx.delete(doc.ref);
  });

  // serverTimestamp() resolves on the server, so the order is read back to get
  // the real placedAt rather than guessing it here.
  const stored = await findOrder(id);
  if (!stored) throw new HttpError(500, 'The order was written but could not be read back.');

  return { order: shapeOrder(stored), requiresPayment: online };
}

export const attachRazorpayOrder = (id, razorpayOrderId) =>
  orders().doc(normaliseId(id)).update({ razorpayOrderId, updatedAt: serverTimestamp() });

export async function markPaid(id, paymentId) {
  const row = await findOrder(id);
  if (!row) throw new HttpError(404, 'Order not found.');
  if (row.paymentStatus === 'paid') return shapeOrder(row);

  const patch = {
    paymentStatus: 'paid',
    updatedAt: serverTimestamp()
  };
  if (row.status === 'pending') patch.status = 'confirmed';
  if (paymentId) patch.razorpayPaymentId = paymentId;

  await orders().doc(row.id).update(patch);
  return shapeOrder(await findOrder(row.id));
}

export async function markPaymentFailed(id, paymentId) {
  const row = await findOrder(id);
  if (!row || row.paymentStatus === 'paid') return shapeOrder(row);

  const patch = { paymentStatus: 'failed', updatedAt: serverTimestamp() };
  if (paymentId) patch.razorpayPaymentId = paymentId;

  await orders().doc(row.id).update(patch);
  return shapeOrder(await findOrder(row.id));
}

/**
 * Cancelling returns the reserved stock to the catalogue exactly once. The
 * order document is read inside the transaction, so a second cancel arriving
 * at the same moment is aborted and retried, then sees `cancelled` and stops.
 */
export async function cancelOrder(id) {
  const key = normaliseId(id);
  const ref = orders().doc(key);

  await transaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpError(404, 'Order not found.');

    const row = snapshot.data();
    if (row.status === 'cancelled') return;
    if (row.status === 'delivered') {
      throw new HttpError(409, 'A delivered order cannot be cancelled.');
    }

    await releaseStock(tx, row.items ?? []);
    tx.update(ref, { status: 'cancelled', updatedAt: serverTimestamp() });
  });

  return shapeOrder(await findOrder(key));
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

  await orders().doc(row.id).update({ status, updatedAt: serverTimestamp() });
  return shapeOrder(await findOrder(row.id));
}

export async function updatePaymentStatus(id, paymentStatus) {
  if (!PAYMENT_STATUSES.includes(paymentStatus)) {
    throw new HttpError(400, `Payment status must be one of: ${PAYMENT_STATUSES.join(', ')}.`);
  }
  if (paymentStatus === 'paid') return markPaid(id, null);

  const row = await findOrder(id);
  if (!row) throw new HttpError(404, 'Order not found.');

  await orders().doc(row.id).update({ paymentStatus, updatedAt: serverTimestamp() });
  return shapeOrder(await findOrder(row.id));
}

export async function listOrdersForUser(userId, limit = 50) {
  const snapshot = await orders()
    .where('userId', '==', String(userId))
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return docsOf(snapshot).map(row => shapeOrder(row));
}
