import { config } from './config.js';
import { db } from './db.js';
import { HttpError, bad, posInt } from './util.js';

/* --------------------------------------------------------------- products */

const PRODUCT_COLUMNS = `
  id, slug, name, category, price, old_price AS oldPrice, badge, size, image,
  description AS desc, ingredients, benefits, usage, stock, active, sort_order AS sortOrder
`;

const selectActiveProducts = db.prepare(`
  SELECT ${PRODUCT_COLUMNS} FROM products
  WHERE active = 1
  ORDER BY sort_order, id
`);

const selectAllProducts = db.prepare(`
  SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY sort_order, id
`);

const selectProductById = db.prepare(`
  SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?
`);

const selectProductBySlug = db.prepare(`
  SELECT ${PRODUCT_COLUMNS} FROM products WHERE slug = ?
`);

const shape = row =>
  row && {
    ...row,
    active: Boolean(row.active),
    inStock: row.stock > 0,
    oldPrice: row.oldPrice ?? null
  };

export const listProducts = ({ includeInactive = false } = {}) =>
  (includeInactive ? selectAllProducts : selectActiveProducts).all().map(shape);

export const getProduct = id => shape(selectProductById.get(id));

export const getProductBySlug = slug => shape(selectProductBySlug.get(slug));

export function listCategories() {
  return db
    .prepare(
      `SELECT category AS name, COUNT(*) AS count
       FROM products WHERE active = 1
       GROUP BY category ORDER BY category`
    )
    .all();
}

/* ------------------------------------------------------------------- cart */

const selectCart = db.prepare(
  `SELECT product_id AS productId, qty FROM carts WHERE user_id = ? ORDER BY updated_at`
);
const upsertCartItem = db.prepare(`
  INSERT INTO carts (user_id, product_id, qty, updated_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT (user_id, product_id)
  DO UPDATE SET qty = excluded.qty, updated_at = datetime('now')
`);
const deleteCartItem = db.prepare(`DELETE FROM carts WHERE user_id = ? AND product_id = ?`);
const clearCartRows = db.prepare(`DELETE FROM carts WHERE user_id = ?`);

export const getCartRows = userId => selectCart.all(userId);

export function setCartItem(userId, productId, qty) {
  const product = getProduct(productId);
  if (!product || !product.active) throw bad(`Product ${productId} is not available.`);

  if (qty <= 0) {
    deleteCartItem.run(userId, productId);
    return;
  }
  upsertCartItem.run(userId, productId, Math.min(qty, 99));
}

export function replaceCart(userId, items) {
  clearCartRows.run(userId);
  for (const { productId, qty } of items) {
    if (qty > 0) setCartItem(userId, productId, qty);
  }
}

export const clearCart = userId => clearCartRows.run(userId);

/* ---------------------------------------------------------------- pricing */

/**
 * Re-prices a basket from the database. The client's prices are never trusted:
 * only product ids and quantities are read from the request.
 */
export function priceBasket(rawItems, paymentMethod = 'upi') {
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
    const product = getProduct(productId);

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

const decrementStock = db.prepare(
  `UPDATE products SET stock = stock - ?, updated_at = datetime('now')
   WHERE id = ? AND stock >= ?`
);
const incrementStock = db.prepare(
  `UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?`
);

export function reserveStock(items) {
  for (const item of items) {
    const { changes } = decrementStock.run(item.qty, item.productId, item.qty);
    if (!changes) {
      throw new HttpError(409, `${item.name} just went out of stock. Please adjust your cart.`);
    }
  }
}

export function releaseStock(items) {
  for (const item of items) incrementStock.run(item.qty, item.productId);
}
