import crypto from 'node:crypto';

/** An error with an HTTP status attached, so route handlers can just throw. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

export const bad = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);

/* ------------------------------------------------------------------ input */

export const str = (value, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export function requireStr(value, field, { min = 1, max = 500 } = {}) {
  const out = str(value, max);
  if (out.length < min) throw bad(`${field} is required.`);
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function normaliseEmail(value) {
  const email = str(value, 254).toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

export function requireEmail(value, field = 'Email address') {
  const email = normaliseEmail(value);
  if (!email) throw bad(`${field} does not look like a valid email address.`);
  return email;
}

/** Indian mobile numbers: 10 digits starting 6-9, with +91/0 prefixes tolerated. */
export function normalisePhone(value) {
  const digits = str(value, 24).replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : '';
}

export function requirePhone(value, field = 'Phone number') {
  const phone = normalisePhone(value);
  if (!phone) throw bad(`${field} must be a valid 10-digit Indian mobile number.`);
  return phone;
}

/** "email or mobile" — the storefront's single login field. */
export function parseIdentifier(value) {
  const raw = str(value, 254);
  if (!raw) throw bad('Enter your email address or mobile number.');
  const email = normaliseEmail(raw);
  if (email) return { email, phone: null };
  const phone = normalisePhone(raw);
  if (phone) return { email: null, phone };
  throw bad('Enter a valid email address or 10-digit mobile number.');
}

export function requirePassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 8) throw bad('Password must be at least 8 characters long.');
  if (password.length > 200) throw bad('Password must be 200 characters or fewer.');
  return password;
}

export function posInt(value, { field = 'Value', min = 1, max = 1_000_000 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw bad(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

export function slugify(value) {
  return str(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

/* --------------------------------------------------------------- passwords */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, keyHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p)
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ tokens */

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ------------------------------------------------------------------ orders */

/** PHBL-7K3QF2 — short, uppercase, no ambiguous characters. */
export function orderId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (const byte of crypto.randomBytes(8)) tail += alphabet[byte % alphabet.length];
  return `PHBL-${tail}`;
}

export const nowIso = () => new Date().toISOString();

/** A Date `days` from now — stored as a Firestore timestamp. */
export const addDays = days => new Date(Date.now() + days * 86_400_000);
