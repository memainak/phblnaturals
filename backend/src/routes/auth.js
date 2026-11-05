import express from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  rateLimit,
  requireAuth,
  setSessionCookie
} from '../middleware.js';
import { getCartRows, replaceCart } from '../store.js';
import {
  HttpError,
  addDays,
  bad,
  hashPassword,
  normaliseEmail,
  normalisePhone,
  parseIdentifier,
  posInt,
  randomToken,
  requirePassword,
  requireStr,
  sha256,
  verifyPassword
} from '../util.js';

export const authRouter = express.Router();

const insertUser = db.prepare(`
  INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)
`);
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const findByPhone = db.prepare('SELECT * FROM users WHERE phone = ?');
const insertSession = db.prepare(`
  INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)
`);
const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const deleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const touchLogin = db.prepare(
  "UPDATE users SET last_login_at = datetime('now') WHERE id = ?"
);
const updateProfile = db.prepare(
  'UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?'
);
const updatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

const publicUser = user => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role
});

function startSession(res, user, userAgent) {
  const token = randomToken(32);
  const expiresAt = addDays(config.sessionDays);
  insertSession.run(sha256(token), user.id, expiresAt, String(userAgent || '').slice(0, 200));
  touchLogin.run(user.id);
  setSessionCookie(res, token, expiresAt);
}

/** Folds a guest's local cart into the account cart on sign-in/sign-up. */
function mergeGuestCart(userId, rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) return;

  const merged = new Map(getCartRows(userId).map(r => [r.productId, r.qty]));

  for (const raw of rawItems.slice(0, 50)) {
    try {
      const productId = posInt(raw?.productId ?? raw?.id, { field: 'Product id' });
      const qty = posInt(raw?.qty ?? raw?.quantity ?? 1, { field: 'Quantity', max: 99 });
      merged.set(productId, Math.min(Math.max(merged.get(productId) || 0, qty), 99));
    } catch {
      /* skip malformed guest rows rather than failing the sign-in */
    }
  }

  replaceCart(
    userId,
    [...merged].map(([productId, qty]) => ({ productId, qty }))
  );
}

/* ----------------------------------------------------------------- signup */

authRouter.post('/signup', rateLimit(10, 60 * 60_000), (req, res) => {
  const name = requireStr(req.body?.fullName ?? req.body?.name, 'Full name', { min: 2, max: 120 });
  const password = requirePassword(req.body?.password);

  // The storefront has one "email or mobile" field; both are accepted.
  const identifier = req.body?.emailMobile ?? req.body?.identifier;
  let email = normaliseEmail(req.body?.email);
  let phone = normalisePhone(req.body?.phone);

  if (identifier) {
    const parsed = parseIdentifier(identifier);
    email = parsed.email || email;
    phone = parsed.phone || phone;
  }

  if (!email && !phone) {
    throw bad('Enter an email address or a 10-digit mobile number.');
  }
  if (email && findByEmail.get(email)) {
    throw new HttpError(409, 'An account already exists with that email address. Please sign in.');
  }
  if (phone && findByPhone.get(phone)) {
    throw new HttpError(409, 'An account already exists with that mobile number. Please sign in.');
  }

  const { lastInsertRowid } = insertUser.run(name, email || null, phone || null, hashPassword(password));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(lastInsertRowid));

  mergeGuestCart(user.id, req.body?.cart);
  startSession(res, user, req.get('user-agent'));

  res.status(201).json({ ok: true, user: publicUser(user) });
});

/* ------------------------------------------------------------------ login */

authRouter.post('/login', rateLimit(20, 15 * 60_000), (req, res) => {
  const { email, phone } = parseIdentifier(req.body?.emailMobile ?? req.body?.identifier ?? req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const user = email ? findByEmail.get(email) : findByPhone.get(phone);

  // One message for both cases, so the endpoint does not reveal who has an account.
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Those sign-in details did not match an account.');
  }

  mergeGuestCart(user.id, req.body?.cart);
  startSession(res, user, req.get('user-agent'));

  res.json({ ok: true, user: publicUser(user) });
});

/* ----------------------------------------------------------------- logout */

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) deleteSession.run(sha256(token));
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/logout-all', requireAuth, (req, res) => {
  deleteUserSessions.run(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* -------------------------------------------------------------- the user */

authRouter.get('/me', (req, res) => {
  res.json({ ok: true, user: req.user ?? null });
});

authRouter.patch('/me', requireAuth, rateLimit(20, 60_000), (req, res) => {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  const name = req.body?.name === undefined
    ? current.name
    : requireStr(req.body.name, 'Full name', { min: 2, max: 120 });

  let email = current.email;
  if (req.body?.email !== undefined) {
    email = normaliseEmail(req.body.email) || null;
    if (req.body.email && !email) throw bad('That email address does not look valid.');
    const clash = email && findByEmail.get(email);
    if (clash && clash.id !== current.id) {
      throw new HttpError(409, 'That email address is already used by another account.');
    }
  }

  let phone = current.phone;
  if (req.body?.phone !== undefined) {
    phone = normalisePhone(req.body.phone) || null;
    if (req.body.phone && !phone) throw bad('That mobile number does not look valid.');
    const clash = phone && findByPhone.get(phone);
    if (clash && clash.id !== current.id) {
      throw new HttpError(409, 'That mobile number is already used by another account.');
    }
  }

  if (!email && !phone) throw bad('Keep at least an email address or a mobile number on the account.');

  updateProfile.run(name, email, phone, current.id);
  res.json({ ok: true, user: publicUser({ ...current, name, email, phone }) });
});

authRouter.post('/change-password', requireAuth, rateLimit(10, 60 * 60_000), (req, res) => {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!verifyPassword(String(req.body?.currentPassword ?? ''), current.password_hash)) {
    throw new HttpError(401, 'Your current password is not correct.');
  }

  const next = requirePassword(req.body?.newPassword);
  updatePassword.run(hashPassword(next), current.id);

  // Every other session is invalidated; this one is re-issued.
  deleteUserSessions.run(current.id);
  startSession(res, current, req.get('user-agent'));

  res.json({ ok: true, message: 'Password updated. Other devices have been signed out.' });
});

/* -------------------------------------------------- not wired up (yet) */

const notConfigured = label => (_req, _res, next) =>
  next(
    new HttpError(
      501,
      `${label} is not configured on this server yet. Email or mobile sign-in with a password works today.`
    )
  );

authRouter.post('/google', notConfigured('Google sign-in'));
authRouter.post('/otp/request', notConfigured('OTP sign-in'));
authRouter.post('/otp/verify', notConfigured('OTP sign-in'));
authRouter.post('/forgot-password', notConfigured('Password reset by email'));
