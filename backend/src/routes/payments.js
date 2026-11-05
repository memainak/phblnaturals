import crypto from 'node:crypto';
import express from 'express';
import Razorpay from 'razorpay';
import { config, razorpayEnabled } from '../config.js';
import { rateLimit } from '../middleware.js';
import {
  attachRazorpayOrder,
  findOrder,
  findOrderByRazorpayId,
  markPaid,
  markPaymentFailed,
  shapeOrder
} from '../orders.js';
import { HttpError, bad, notFound, str } from '../util.js';

export const paymentsRouter = express.Router();

const razorpay = razorpayEnabled
  ? new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret })
  : null;

function requireRazorpay() {
  if (!razorpay) {
    throw new HttpError(
      503,
      'Online payment is not configured on this server. Cash on delivery is available.'
    );
  }
}

paymentsRouter.get('/config', (_req, res) => {
  res.json({
    ok: true,
    razorpay: { enabled: razorpayEnabled, keyId: razorpayEnabled ? config.razorpay.keyId : null },
    codEnabled: true
  });
});

/**
 * POST /api/payments/razorpay/order { orderId }
 * Creates (or re-uses) the Razorpay order for one of our orders. The amount
 * always comes from our own stored total, never from the request.
 */
paymentsRouter.post('/razorpay/order', rateLimit(20, 60_000), async (req, res) => {
  requireRazorpay();

  const row = await findOrder(req.body?.orderId);
  if (!row) throw notFound('No order was found with that id.');
  if (row.paymentStatus === 'paid') throw bad('That order has already been paid.');
  if (row.status === 'cancelled') throw bad('That order was cancelled.');
  if (row.paymentMethod === 'cod') throw bad('That order is set to cash on delivery.');

  const rzpOrder = await razorpay.orders.create({
    amount: row.total * 100, // paise
    currency: 'INR',
    receipt: row.id,
    notes: { orderId: row.id, customer: row.customerName }
  });

  await attachRazorpayOrder(row.id, rzpOrder.id);

  res.json({
    ok: true,
    keyId: config.razorpay.keyId,
    razorpayOrderId: rzpOrder.id,
    amount: rzpOrder.amount,
    currency: rzpOrder.currency,
    orderId: row.id,
    prefill: { name: row.customerName, email: row.email, contact: row.phone }
  });
});

/**
 * POST /api/payments/razorpay/verify
 * Called from the browser after Razorpay Checkout succeeds. The signature is
 * the proof; the webhook is the backstop if the browser never comes back.
 */
paymentsRouter.post('/razorpay/verify', rateLimit(20, 60_000), async (req, res) => {
  requireRazorpay();

  const razorpayOrderId = str(req.body?.razorpay_order_id ?? req.body?.razorpayOrderId, 64);
  const razorpayPaymentId = str(req.body?.razorpay_payment_id ?? req.body?.razorpayPaymentId, 64);
  const signature = str(req.body?.razorpay_signature ?? req.body?.signature, 256);

  if (!razorpayOrderId || !razorpayPaymentId || !signature) {
    throw bad('razorpay_order_id, razorpay_payment_id and razorpay_signature are all required.');
  }

  const expected = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  const valid =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  const row = await findOrderByRazorpayId(razorpayOrderId);
  if (!row) throw notFound('That payment does not match a known order.');

  if (!valid) {
    await markPaymentFailed(row.id, razorpayPaymentId);
    throw new HttpError(400, 'Payment signature verification failed. The order was not marked as paid.');
  }

  res.json({ ok: true, order: await markPaid(row.id, razorpayPaymentId) });
});

/**
 * POST /api/payments/razorpay/webhook
 * Mounted with a raw body parser in server.js so the signature can be checked
 * against the exact bytes Razorpay sent.
 */
export async function razorpayWebhook(req, res) {
  const secret = config.razorpay.webhookSecret;
  if (!secret) return res.status(503).json({ ok: false, error: 'Webhook secret is not configured.' });

  const signature = req.get('x-razorpay-signature') || '';
  const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');

  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return res.status(400).json({ ok: false, error: 'Invalid webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ ok: false, error: 'Webhook body was not valid JSON.' });
  }

  const payment = event?.payload?.payment?.entity;
  const ourOrderId = payment?.notes?.orderId;
  const row = ourOrderId
    ? await findOrder(ourOrderId)
    : payment?.order_id
      ? await findOrderByRazorpayId(payment.order_id)
      : null;

  if (row) {
    try {
      if (event.event === 'payment.captured') await markPaid(row.id, payment.id);
      else if (event.event === 'payment.failed') await markPaymentFailed(row.id, payment.id);
    } catch (error) {
      console.error('[webhook] could not apply event', event.event, error);
    }
  } else {
    console.warn('[webhook] no matching order for event', event.event, payment?.order_id);
  }

  // Always 200 once the signature is good, so Razorpay stops retrying.
  return res.json({ ok: true, received: event.event });
}

/** Lets the browser poll after a redirect-based payment. */
paymentsRouter.get('/status/:orderId', rateLimit(60, 60_000), async (req, res) => {
  const row = await findOrder(req.params.orderId);
  if (!row) throw notFound('No order was found with that id.');

  res.json({
    ok: true,
    orderId: row.id,
    status: row.status,
    paymentStatus: row.paymentStatus,
    order:
      row.paymentStatus === 'paid'
        ? await shapeOrder(row, { includeContact: false })
        : undefined
  });
});
