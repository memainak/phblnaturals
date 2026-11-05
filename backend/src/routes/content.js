import express from 'express';
import { db } from '../db.js';
import { rateLimit } from '../middleware.js';
import { normalisePhone, requireEmail, requireStr, str } from '../util.js';

export const contentRouter = express.Router();

const subscribe = db.prepare(`
  INSERT INTO newsletter (email) VALUES (?)
  ON CONFLICT (email) DO UPDATE SET active = 1
`);
const unsubscribe = db.prepare('UPDATE newsletter SET active = 0 WHERE email = ?');

const insertMessage = db.prepare(`
  INSERT INTO messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)
`);

/** POST /api/newsletter { email } — the footer subscribe form. */
contentRouter.post('/newsletter', rateLimit(10, 60 * 60_000), (req, res) => {
  const email = requireEmail(req.body?.email);
  subscribe.run(email);

  res.status(201).json({
    ok: true,
    message: 'Thank you for subscribing. You will hear from PHBL Naturals soon.'
  });
});

contentRouter.post('/newsletter/unsubscribe', rateLimit(10, 60 * 60_000), (req, res) => {
  unsubscribe.run(requireEmail(req.body?.email));
  res.json({ ok: true, message: 'You have been unsubscribed.' });
});

/** POST /api/contact — contact / enquiry form. */
contentRouter.post('/contact', rateLimit(5, 60 * 60_000), (req, res) => {
  const name = requireStr(req.body?.name, 'Name', { min: 2, max: 120 });
  const email = requireEmail(req.body?.email);
  const message = requireStr(req.body?.message, 'Message', { min: 10, max: 4000 });
  const subject = str(req.body?.subject, 160);
  const phone = normalisePhone(req.body?.phone);

  const { lastInsertRowid } = insertMessage.run(name, email, phone, subject, message);

  res.status(201).json({
    ok: true,
    id: Number(lastInsertRowid),
    message: 'Thank you for writing in. We will get back to you shortly.'
  });
});
