import { findSessionUser } from './accounts.js';
import { config } from './config.js';
import { HttpError, safeEqual, sha256 } from './util.js';

export const SESSION_COOKIE = 'phbl_session';

/* ------------------------------------------------------------------- cors */

export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin ? 204 : 403);
  return next();
}

/* --------------------------------------------------------------- security */

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

/* ------------------------------------------------------------ rate limits */

const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of buckets) {
    const live = hits.filter(t => t > now);
    if (live.length) buckets.set(key, live);
    else buckets.delete(key);
  }
}, 60_000).unref();

/** Sliding-window limiter, keyed by route + client IP. */
export function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.method} ${req.baseUrl}${req.path}|${req.ip}`;
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter(t => t > now);

    if (hits.length >= max) {
      res.setHeader('Retry-After', Math.ceil((hits[0] - now) / 1000));
      return next(new HttpError(429, 'Too many requests. Please wait a moment and try again.'));
    }

    hits.push(now + windowMs);
    buckets.set(key, hits);
    return next();
  };
}

/* ---------------------------------------------------------- cookie parser */

/** Minimal replacement for cookie-parser: fills req.cookies. */
export function parseCookies(req, _res, next) {
  const header = req.headers.cookie;
  const jar = {};

  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 1) continue;
      const name = part.slice(0, eq).trim();
      if (!name || name in jar) continue;
      try {
        jar[name] = decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        jar[name] = part.slice(eq + 1).trim();
      }
    }
  }

  req.cookies = jar;
  next();
}

/* ------------------------------------------------------------------- auth */

/** Populates req.user when a valid session cookie is present. Never rejects. */
export async function attachUser(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();

  try {
    const found = await findSessionUser(sha256(token));
    if (found) {
      req.user = {
        id: found.user.id,
        name: found.user.name,
        email: found.user.email,
        phone: found.user.phone,
        role: found.user.role
      };
      req.sessionTokenHash = found.tokenHash;
    }
  } catch (error) {
    return next(error);
  }
  return next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  return next();
}

export function requireAdmin(req, _res, next) {
  if (!config.adminKey) {
    return next(new HttpError(503, 'Admin access is not configured. Set ADMIN_KEY in the environment.'));
  }

  const supplied =
    req.get('x-admin-key') ||
    (req.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
    req.query.key;

  if (!supplied || !safeEqual(supplied, config.adminKey)) {
    if (req.user?.role === 'admin') return next();
    return next(new HttpError(401, 'Invalid admin key.'));
  }
  return next();
}

/* ---------------------------------------------------------------- cookies */

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    path: '/',
    expires: expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/* ----------------------------------------------------------------- errors */

export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: `No API route for ${req.method} ${req.path}` });
  }
  return next();
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  if (res.headersSent) return;

  const body = {
    ok: false,
    error:
      status >= 500 && config.env === 'production'
        ? 'Something went wrong on our side. Please try again.'
        : err.message || 'Request failed.'
  };
  if (err.details) body.details = err.details;

  res.status(status).json(body);
}
