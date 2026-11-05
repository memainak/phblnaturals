import express from 'express';
import { one, query } from '../db.js';
import { rateLimit } from '../middleware.js';
import { normalisePhone, requireEmail, requireStr, str } from '../util.js';

export const contentRouter = express.Router();

const subscribe = email =>
  query(
    `INSERT INTO newsletter (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET active = TRUE`,
    [email]
  );

const unsubscribe = email =>
  query('UPDATE newsletter SET active = FALSE WHERE email = $1', [email]);

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

  const row = await one(
    `INSERT INTO messages (name, email, phone, subject, message)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [name, email, phone, subject, message]
  );

  res.status(201).json({
    ok: true,
    id: row.id,
    message: 'Thank you for writing in. We will get back to you shortly.'
  });
});
