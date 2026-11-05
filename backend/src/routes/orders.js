import express from 'express';
import { rateLimit, requireAuth } from '../middleware.js';
import {
  cancelOrder,
  createOrder,
  findOrder,
  listOrdersForUser,
  shapeOrder
} from '../orders.js';
import { HttpError, normalisePhone, notFound, str } from '../util.js';

export const ordersRouter = express.Router();

/** POST /api/orders — place an order. Works for guests and signed-in customers. */
ordersRouter.post('/', rateLimit(12, 60_000), async (req, res) => {
  const { order, requiresPayment } = await createOrder({ body: req.body, user: req.user });

  res.status(201).json({
    ok: true,
    order,
    requiresPayment,
    next: requiresPayment
      ? 'Create a Razorpay order at POST /api/payments/razorpay/order to collect payment.'
      : 'Cash on delivery order confirmed.'
  });
});

/** GET /api/orders — the signed-in customer's own order history. */
ordersRouter.get('/', requireAuth, async (req, res) => {
  res.json({ ok: true, orders: await listOrdersForUser(req.user.id) });
});

/**
 * GET /api/orders/lookup?id=PHBL-XXXX&phone=9876543210
 * Guest order tracking. The phone number on the order acts as the shared
 * secret, so an order id alone is not enough to read someone's address.
 */
ordersRouter.get('/lookup', rateLimit(30, 60_000), async (req, res) => {
  const id = str(req.query.id ?? req.query.orderId, 32);
  if (!id) throw new HttpError(400, 'Provide the order id you were given at checkout.');

  const row = await findOrder(id);
  if (!row) throw notFound('No order was found with that id.');

  const isOwner = req.user && row.userId === req.user.id;

  if (!isOwner) {
    const phone = normalisePhone(req.query.phone);
    if (!phone || phone !== row.phone) {
      throw new HttpError(403, 'The mobile number does not match this order.');
    }
  }

  res.json({ ok: true, order: await shapeOrder(row) });
});

ordersRouter.get('/:id', requireAuth, async (req, res) => {
  const row = await findOrder(req.params.id);
  if (!row || row.userId !== req.user.id) throw notFound('No order was found with that id.');
  res.json({ ok: true, order: await shapeOrder(row) });
});

/** A customer may cancel their own order until it ships. */
ordersRouter.post('/:id/cancel', requireAuth, rateLimit(10, 60_000), async (req, res) => {
  const row = await findOrder(req.params.id);
  if (!row || row.userId !== req.user.id) throw notFound('No order was found with that id.');

  if (!['pending', 'confirmed', 'packed'].includes(row.status)) {
    throw new HttpError(
      409,
      `An order that is already ${row.status} cannot be cancelled here. Please contact us.`
    );
  }

  res.json({ ok: true, order: await cancelOrder(row.id) });
});
