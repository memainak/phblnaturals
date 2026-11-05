import express from 'express';
import { messages, newsletter, nextId, serverTimestamp } from '../db.js';
import { rateLimit } from '../middleware.js';
import { normalisePhone, requireEmail, requireStr, str } from '../util.js';

export const contentRouter = express.Router();

/** The email address is the document id, so subscribing twice is idempotent. */
async function subscribe(email) {
  const ref = newsletter().doc(email);
  const existing = await ref.get();

  if (existing.exists) {
    await ref.update({ active: true });
    return;
  }

  await ref.set({ email, active: true, createdAt: serverTimestamp() });
}

const unsubscribe = async email => {
  const ref = newsletter().doc(email);
  if ((await ref.get()).exists) await ref.update({ active: false });
};

/** POST /api/newsletter { email } — the footer subscribe form. */
contentRouter.post('/newsletter', rateLimit(10, 60 * 60_000), async (req, res) => {
  const email = requireEmail(req.body?.email);
  await subscribe(email);

  res.status(201).json({
    ok: true,
    message: 'Thank you for subscribing. You will hear from PHBL Naturals soon.'
  });
});

contentRouter.post('/newsletter/unsubscribe', rateLimit(10, 60 * 60_000), async (req, res) => {
  await unsubscribe(requireEmail(req.body?.email));
  res.json({ ok: true, message: 'You have been unsubscribed.' });
});

/** POST /api/contact — contact / enquiry form. */
contentRouter.post('/contact', rateLimit(5, 60 * 60_000), async (req, res) => {
  const name = requireStr(req.body?.name, 'Name', { min: 2, max: 120 });
  const email = requireEmail(req.body?.email);
  const message = requireStr(req.body?.message, 'Message', { min: 10, max: 4000 });
  const subject = str(req.body?.subject, 160);
  const phone = normalisePhone(req.body?.phone);

  // Messages keep sequential numeric ids: the API has always returned a number
  // here, and the admin dashboard addresses them by it.
  const id = await nextId('messages');

  await messages().doc(String(id)).set({
    id,
    name,
    email,
    phone,
    subject,
    message,
    handled: false,
    createdAt: serverTimestamp()
  });

  res.status(201).json({
    ok: true,
    id,
    message: 'Thank you for writing in. We will get back to you shortly.'
  });
});
