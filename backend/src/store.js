import { config } from './config.js';
import { all, one, query } from './db.js';
import { HttpError, bad, posInt } from './util.js';

/* --------------------------------------------------------------- products */

const PRODUCT_COLUMNS = `
  id, slug, name, category, price, old_price AS "oldPrice", badge, size, image,
  description AS "desc", ingredients, benefits, usage_text AS usage, stock,
  active, sort_order AS "sortOrder"
`;

const shape = row =>
  row && {
    ...row,
    active: Boolean(row.active),
    inStock: row.stock > 0,
    oldPrice: row.oldPrice ?? null
  };

export async function listProducts({ includeInactive = false } = {}) {
  const rows = await all(
    `SELECT ${PRODUCT_COLUMNS} FROM products
     ${includeInactive ? '' : 'WHERE active = TRUE'}
     ORDER BY sort_order, id`
  );
  return rows.map(shape);
}

export const getProduct = async id =>
  shape(await one(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`, [id]));

export const getProductBySlug = async slug =>
  shape(await one(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE slug = $1`, [slug]));

export const listCategories = () =>
  all(
    `SELECT category AS name, COUNT(*)::int AS count
     FROM products WHERE active = TRUE
     GROUP BY category ORDER BY category`
  );

/* ------------------------------------------------------------------- cart */

export const getCartRows = userId =>
  all(
    `SELECT product_id AS "productId", qty FROM carts
     WHERE user_id = $1 ORDER BY updated_at, product_id`,
    [userId]
  );

export async function setCartItem(userId, productId, qty) {
  const product = await getProduct(productId);
  if (!product || !product.active) throw bad(`Product ${productId} is not available.`);

  if (qty <= 0) {
    await query('DELETE FROM carts WHERE user_id = $1 AND product_id = $2', [userId, productId]);
    return;
  }

  await query(
    `INSERT INTO carts (user_id, product_id, qty, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, product_id)
     DO UPDATE SET qty = EXCLUDED.qty, updated_at = now()`,
    [userId, productId, Math.min(qty, 99)]
  );
}

export async function replaceCart(userId, items) {
  await query('DELETE FROM carts WHERE user_id = $1', [userId]);
  for (const { productId, qty } of items) {
    if (qty > 0) await setCartItem(userId, productId, qty);
  }
}

export const clearCart = userId => query('DELETE FROM carts WHERE user_id = $1', [userId]);

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
 * Decrements stock for each line. The `stock >= $1` guard makes the check and
 * the write one atomic statement, so two shoppers cannot take the last unit.
 * `client` is the transaction handle from transaction().
 */
export async function reserveStock(client, items) {
  for (const item of items) {
    const { rowCount } = await client.query(
      `UPDATE products SET stock = stock - $1, updated_at = now()
       WHERE id = $2 AND stock >= $1`,
      [item.qty, item.productId]
    );
    if (!rowCount) {
      throw new HttpError(409, `${item.name} just went out of stock. Please adjust your cart.`);
    }
  }
}

export async function releaseStock(client, items) {
  for (const item of items) {
    await client.query(
      'UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2',
      [item.qty, item.productId]
    );
  }
}
