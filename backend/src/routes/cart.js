import express from 'express';
import { rateLimit, requireAuth } from '../middleware.js';
import {
  clearCart,
  getCartRows,
  getProduct,
  priceBasket,
  replaceCart,
  setCartItem
} from '../store.js';
import { bad, posInt } from '../util.js';

export const cartRouter = express.Router();

// The cart lives in localStorage for guests; these routes keep a signed-in
// customer's cart on the server so it follows them between devices.
cartRouter.use(requireAuth);

function cartPayload(userId) {
  const rows = getCartRows(userId);
  const items = rows
    .map(row => {
      const product = getProduct(row.productId);
      if (!product || !product.active) return null;
      return {
        productId: product.id,
        name: product.name,
        size: product.size,
        image: product.image,
        price: product.price,
        qty: row.qty,
        lineTotal: product.price * row.qty,
        inStock: product.stock >= row.qty
      };
    })
    .filter(Boolean);

  const count = items.reduce((n, item) => n + item.qty, 0);
  const subtotal = items.reduce((n, item) => n + item.lineTotal, 0);

  return { items, count, subtotal };
}

cartRouter.get('/', (req, res) => {
  res.json({ ok: true, cart: cartPayload(req.user.id) });
});

/** PUT replaces the whole cart — the shape the storefront already keeps. */
cartRouter.put('/', rateLimit(60, 60_000), (req, res) => {
  const raw = req.body?.items;
  if (!Array.isArray(raw)) throw bad('Send an "items" array.');
  if (raw.length > 50) throw bad('A cart can hold at most 50 different products.');

  replaceCart(
    req.user.id,
    raw.map(item => ({
      productId: posInt(item?.productId ?? item?.id, { field: 'Product id' }),
      qty: posInt(item?.qty ?? item?.quantity ?? 1, { field: 'Quantity', max: 99 })
    }))
  );

  res.json({ ok: true, cart: cartPayload(req.user.id) });
});

cartRouter.post('/items', rateLimit(120, 60_000), (req, res) => {
  const productId = posInt(req.body?.productId ?? req.body?.id, { field: 'Product id' });
  const delta = Number(req.body?.delta);
  const existing = getCartRows(req.user.id).find(row => row.productId === productId);

  const qty = Number.isInteger(delta)
    ? (existing?.qty ?? 0) + delta
    : posInt(req.body?.qty ?? 1, { field: 'Quantity', max: 99 });

  setCartItem(req.user.id, productId, qty);
  res.json({ ok: true, cart: cartPayload(req.user.id) });
});

cartRouter.delete('/items/:productId', (req, res) => {
  setCartItem(req.user.id, posInt(req.params.productId, { field: 'Product id' }), 0);
  res.json({ ok: true, cart: cartPayload(req.user.id) });
});

cartRouter.delete('/', (req, res) => {
  clearCart(req.user.id);
  res.json({ ok: true, cart: cartPayload(req.user.id) });
});

/** Totals for the signed-in cart, including shipping and any COD fee. */
cartRouter.get('/quote', (req, res) => {
  const rows = getCartRows(req.user.id);
  if (!rows.length) throw bad('Your cart is empty.');
  res.json({ ok: true, quote: priceBasket(rows, req.query.paymentMethod ?? 'upi') });
});
