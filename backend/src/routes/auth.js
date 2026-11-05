import express from 'express';
import {
  createSession,
  createUser,
  deleteSession,
  deleteSessionsForUser,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  setPassword,
  touchLastLogin,
  updateUserContact
} from '../accounts.js';
import { config } from '../config.js';
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

const publicUser = user => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role
});

async function startSession(res, user, userAgent) {
  const token = randomToken(32);
  const expiresAt = addDays(config.sessionDays);

  await createSession(user.id, sha256(token), expiresAt, userAgent);
  await touchLastLogin(user.id);

  setSessionCookie(res, token, expiresAt);
}

/** Folds a guest's local cart into the account cart on sign-in/sign-up. */
async function mergeGuestCart(userId, rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) return;

  const merged = new Map((await getCartRows(userId)).map(r => [r.productId, r.qty]));

  for (const raw of rawItems.slice(0, 50)) {
    try {
      const productId = posInt(raw?.productId ?? raw?.id, { field: 'Product id' });
      const qty = posInt(raw?.qty ?? raw?.quantity ?? 1, { field: 'Quantity', max: 99 });
      merged.set(productId, Math.min(Math.max(merged.get(productId) || 0, qty), 99));
    } catch {
      /* skip malformed guest rows rather than failing the sign-in */
    }
  }

  await replaceCart(
    userId,
    [...merged].map(([productId, qty]) => ({ productId, qty }))
  );
}

/* ----------------------------------------------------------------- signup */

authRouter.post('/signup', rateLimit(10, 60 * 60_000), async (req, res) => {
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

  // Checked up front for a clear message; createUser repeats the check inside
  // a transaction, which is what actually prevents a duplicate.
  if (email && (await findUserByEmail(email))) {
    throw new HttpError(409, 'An account already exists with that email address. Please sign in.');
  }
  if (phone && (await findUserByPhone(phone))) {
    throw new HttpError(409, 'An account already exists with that mobile number. Please sign in.');
  }

  const user = await createUser({
    name,
    email,
    phone,
    passwordHash: hashPassword(password)
  });

  await mergeGuestCart(user.id, req.body?.cart);
  await startSession(res, user, req.get('user-agent'));

  res.status(201).json({ ok: true, user: publicUser(user) });
});

/* ------------------------------------------------------------------ login */

authRouter.post('/login', rateLimit(20, 15 * 60_000), async (req, res) => {
  const { email, phone } = parseIdentifier(
    req.body?.emailMobile ?? req.body?.identifier ?? req.body?.email
  );
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const user = email ? await findUserByEmail(email) : await findUserByPhone(phone);

  // One message for both cases, so the endpoint does not reveal who has an account.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new HttpError(401, 'Those sign-in details did not match an account.');
  }

  await mergeGuestCart(user.id, req.body?.cart);
  await startSession(res, user, req.get('user-agent'));

  res.json({ ok: true, user: publicUser(user) });
});

/* ----------------------------------------------------------------- logout */

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await deleteSession(sha256(token));
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await deleteSessionsForUser(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* -------------------------------------------------------------- the user */

authRouter.get('/me', (req, res) => {
  res.json({ ok: true, user: req.user ?? null });
});

authRouter.patch('/me', requireAuth, rateLimit(20, 60_000), async (req, res) => {
  const current = await findUserById(req.user.id);

  const name =
    req.body?.name === undefined
      ? current.name
      : requireStr(req.body.name, 'Full name', { min: 2, max: 120 });

  let email = current.email;
  if (req.body?.email !== undefined) {
    email = normaliseEmail(req.body.email) || null;
    if (req.body.email && !email) throw bad('That email address does not look valid.');
  }

  let phone = current.phone;
  if (req.body?.phone !== undefined) {
    phone = normalisePhone(req.body.phone) || null;
    if (req.body.phone && !phone) throw bad('That mobile number does not look valid.');
  }

  if (!email && !phone) {
    throw bad('Keep at least an email address or a mobile number on the account.');
  }

  // updateUserContact rejects an address already claimed by another account.
  const updated = await updateUserContact(current.id, { name, email, phone });

  res.json({ ok: true, user: publicUser(updated) });
});

authRouter.post('/change-password', requireAuth, rateLimit(10, 60 * 60_000), async (req, res) => {
  const current = await findUserById(req.user.id);

  if (!verifyPassword(String(req.body?.currentPassword ?? ''), current.passwordHash)) {
    throw new HttpError(401, 'Your current password is not correct.');
  }

  const next = requirePassword(req.body?.newPassword);
  await setPassword(current.id, hashPassword(next));

  // Every other session is invalidated; this one is re-issued.
  await deleteSessionsForUser(current.id);
  await startSession(res, current, req.get('user-agent'));

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
