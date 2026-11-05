import { config } from './config.js';
import { cartOf, products, serverTimestamp } from './db.js';
import { HttpError, bad, posInt } from './util.js';

/* --------------------------------------------------------------- products */

/**
 * Product documents already use the field names the API returns, so shaping is
 * only about derived values and defaults.
 */
const shape = row =>
  row && {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    category: row.category,
    price: row.price,
    oldPrice: row.oldPrice ?? null,
    badge: row.badge ?? '',
    size: row.size ?? '',
    image: row.image ?? '',
    desc: row.desc ?? '',
    ingredients: row.ingredients ?? '',
    benefits: row.benefits ?? '',
    usage: row.usage ?? '',
    stock: row.stock ?? 0,
    active: Boolean(row.active),
    sortOrder: row.sortOrder ?? 0,
    inStock: (row.stock ?? 0) > 0
  };

const bySortOrder = (a, b) => a.sortOrder - b.sortOrder || a.id - b.id;

/**
 * Reads the whole catalogue and sorts in memory. The storefront already
 * filters and sorts client-side over the full list, and the catalogue is tens
 * of products, so one collection read per request is cheaper than maintaining
 * composite indexes for every filter combination. Revisit if the catalogue
 * ever runs to thousands of items.
 */
export async function listProducts({ includeInactive = false } = {}) {
  const snapshot = await products().get();

  return snapshot.docs
    .map(doc => shape({ id: doc.id, ...doc.data() }))
    .filter(product => includeInactive || product.active)
    .sort(bySortOrder);
}

export async function getProduct(id) {
  const key = String(id ?? '').trim();
  if (!key) return null;

  const snapshot = await products().doc(key).get();
  return snapshot.exists ? shape({ id: snapshot.id, ...snapshot.data() }) : null;
}

export async function getProductBySlug(slug) {
  const snapshot = await products()
    .where('slug', '==', String(slug ?? '').trim())
    .limit(1)
    .get();

  return snapshot.empty ? null : shape({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() });
}

export async function listCategories() {
  const counts = new Map();

  for (const product of await listProducts()) {
    counts.set(product.category, (counts.get(product.category) || 0) + 1);
  }

  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------- cart */

export async function getCartRows(userId) {
  const snapshot = await cartOf(userId).get();

  return snapshot.docs
    .map(doc => ({
      productId: Number(doc.id),
      qty: doc.data().qty,
      updatedAt: doc.data().updatedAt
    }))
    .sort((a, b) => a.productId - b.productId)
    .map(({ productId, qty }) => ({ productId, qty }));
}

export async function setCartItem(userId, productId, qty) {
  const product = await getProduct(productId);
  if (!product || !product.active) throw bad(`Product ${productId} is not available.`);

  const ref = cartOf(userId).doc(String(productId));

  if (qty <= 0) {
    await ref.delete();
    return;
  }

  await ref.set({ qty: Math.min(qty, 99), updatedAt: serverTimestamp() });
}

export async function replaceCart(userId, items) {
  await clearCart(userId);
  for (const { productId, qty } of items) {
    if (qty > 0) await setCartItem(userId, productId, qty);
  }
}

export async function clearCart(userId) {
  const snapshot = await cartOf(userId).get();
  if (snapshot.empty) return;

  const batch = cartOf(userId).firestore.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

/* ---------------------------------------------------------------- pricing */

/**
 * Re-prices a basket from the database. The client's prices are never trusted:
 * only product ids and quantities are read from the request.
 */
export async function priceBasket(rawItems, paymentMethod = 'upi') {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw bad('Your cart is empty.');
  }
  if (rawItems.length > 50) {
    throw bad('A single order can contain at most 50 different products.');
  }

  const merged = new Map();

  for (const raw of rawItems) {
    const productId = posInt(raw?.productId ?? raw?.id, { field: 'Product id' });
    const qty = posInt(raw?.qty ?? raw?.quantity ?? 1, { field: 'Quantity', max: 99 });
    merged.set(productId, Math.min((merged.get(productId) || 0) + qty, 99));
  }

  const items = [];
  const problems = [];
  let subtotal = 0;

  for (const [productId, qty] of merged) {
    const product = await getProduct(productId);

    if (!product || !product.active) {
      problems.push({ productId, reason: 'unavailable' });
      continue;
    }
    if (product.stock < qty) {
      problems.push({
        productId,
        name: product.name,
        reason: 'insufficient_stock',
        available: product.stock
      });
      continue;
    }

    const lineTotal = product.price * qty;
    subtotal += lineTotal;

    items.push({
      productId,
      name: product.name,
      size: product.size,
      image: product.image,
      unitPrice: product.price,
      qty,
      lineTotal
    });
  }

  if (problems.length) {
    throw new HttpError(409, 'Some items in your cart are no longer available.', problems);
  }

  const method = normalisePaymentMethod(paymentMethod);
  const { freeShippingOver, shippingFlat, codFee } = config.pricing;

  const shipping = subtotal >= freeShippingOver ? 0 : shippingFlat;
  const cod = method === 'cod' ? codFee : 0;

  return {
    items,
    subtotal,
    shipping,
    codFee: cod,
    total: subtotal + shipping + cod,
    paymentMethod: method,
    currency: 'INR'
  };
}

const PAYMENT_METHODS = new Map([
  ['upi', 'upi'],
  ['card', 'card'],
  ['card / net banking', 'card'],
  ['netbanking', 'card'],
  ['net banking', 'card'],
  ['online', 'upi'],
  ['razorpay', 'upi'],
  ['cod', 'cod'],
  ['cash on delivery', 'cod']
]);

export function normalisePaymentMethod(value) {
  const key = String(value ?? '').trim().toLowerCase();
  const method = PAYMENT_METHODS.get(key);
  if (!method) throw bad('Choose a valid payment method: UPI, card, or cash on delivery.');
  return method;
}

export const isOnlineMethod = method => method !== 'cod';

/* ------------------------------------------------------------------ stock */

/**
 * Decrements stock for each line inside a Firestore transaction.
 *
 * A Firestore transaction must do all of its reads before any of its writes,
 * so every product is fetched in one getAll() and only then written. If any
 * other client changes one of those documents before the commit, Firestore
 * aborts and re-runs the whole transaction, which is what makes the
 * check-then-decrement safe: two shoppers cannot both take the last unit.
 *
 * Because the transaction body can run more than once, it must stay free of
 * side effects outside Firestore.
 */
export async function reserveStock(tx, items) {
  const refs = items.map(item => products().doc(String(item.productId)));
  const snapshots = await tx.getAll(...refs);

  const writes = [];

  for (const [index, item] of items.entries()) {
    const snapshot = snapshots[index];

    if (!snapshot.exists) {
      throw new HttpError(409, `${item.name} is no longer in the catalogue.`);
    }

    const data = snapshot.data();
    const stock = data.stock ?? 0;

    if (!data.active) {
      throw new HttpError(409, `${item.name} is no longer available.`);
    }
    if (stock < item.qty) {
      throw new HttpError(409, `${item.name} just went out of stock. Please adjust your cart.`);
    }

    writes.push([snapshot.ref, stock - item.qty]);
  }

  for (const [ref, stock] of writes) {
    tx.update(ref, { stock, updatedAt: serverTimestamp() });
  }
}

/** Returns reserved stock to the catalogue. Reads first, then writes. */
export async function releaseStock(tx, items) {
  if (!items.length) return;

  const refs = items.map(item => products().doc(String(item.productId)));
  const snapshots = await tx.getAll(...refs);

  const writes = [];

  for (const [index, item] of items.entries()) {
    const snapshot = snapshots[index];
    if (!snapshot.exists) continue;
    writes.push([snapshot.ref, (snapshot.data().stock ?? 0) + item.qty]);
  }

  for (const [ref, stock] of writes) {
    tx.update(ref, { stock, updatedAt: serverTimestamp() });
  }
}
