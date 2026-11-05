import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

/**
 * Local configuration lives in `.env.local`, not `.env`.
 *
 * Keeping local values in `.env.local` rather than `.env` means a tool that
 * bundles a folder's `.env` (some deploy CLIs do) can never ship development
 * settings to production. Both are gitignored, and `.env.local` wins if both
 * exist.
 */
dotenv.config({
  path: [path.join(ROOT, '.env.local'), path.join(ROOT, '.env')],
  quiet: true
});

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const resolveFromRoot = (value, fallback) =>
  path.resolve(ROOT, value && value.trim() ? value.trim() : fallback);

/**
 * A value that is allowed to be absent.
 *
 * Secret Manager cannot hold an empty string, and Cloud Functions refuses to
 * deploy while a secret that `functions.js` declares does not exist. So the
 * Razorpay secrets can be created as the literal `unset` to get the shop
 * deployed on cash on delivery, and that placeholder reads back here as "not
 * configured" rather than switching online payment on with a junk key.
 */
const optional = value => {
  const trimmed = String(value ?? '').trim();
  return trimmed.toLowerCase() === 'unset' ? '' : trimmed;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),

  frontendDir: resolveFromRoot(
    process.env.FRONTEND_DIR,
    '../frontend/phbl_naturals_website'
  ),
  // PHBL_DATA_DIR lets the test harness point at a scratch directory.
  dataDir: resolveFromRoot(process.env.PHBL_DATA_DIR, 'data'),

  // Postgres connection string. Supabase in production; when it is absent the
  // server falls back to PGlite — real Postgres compiled to WASM, stored in
  // data/pg — so local development and the test suite need no database server
  // and no Docker.
  //
  // On Vercel, use Supabase's **connection pooler** URI (port 6543),
  // not the direct one (5432). Each function instance opens its own pool, and
  // Postgres has a hard connection limit that a handful of cold starts would
  // otherwise exhaust. See DEPLOY.md.
  databaseUrl: (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim(),
  pgliteDir: path.join(resolveFromRoot(process.env.PHBL_DATA_DIR, 'data'), 'pg'),

  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  sessionSecret: process.env.SESSION_SECRET || '',
  adminKey: process.env.ADMIN_KEY || '',

  razorpay: {
    keyId: optional(process.env.RAZORPAY_KEY_ID),
    keySecret: optional(process.env.RAZORPAY_KEY_SECRET),
    webhookSecret: optional(process.env.RAZORPAY_WEBHOOK_SECRET)
  },

  pricing: {
    freeShippingOver: num(process.env.FREE_SHIPPING_OVER, 699),
    shippingFlat: num(process.env.SHIPPING_FLAT, 59),
    codFee: num(process.env.COD_FEE, 29)
  },

  sessionDays: 30
};

export const razorpayEnabled = Boolean(
  config.razorpay.keyId && config.razorpay.keySecret
);

export const usingManagedPostgres = Boolean(config.databaseUrl);

/** Warnings worth printing at boot, and hard stops in production. */
export function checkConfig() {
  const warnings = [];

  if (!config.sessionSecret) {
    warnings.push(
      'SESSION_SECRET is not set. A random one is used for this process, so every restart signs existing visitors out.'
    );
    config.sessionSecret = crypto.randomBytes(48).toString('hex');
  }
  if (!config.adminKey) {
    warnings.push('ADMIN_KEY is not set. The admin dashboard and /api/admin/* are disabled.');
  }
  if (!razorpayEnabled) {
    warnings.push('Razorpay keys are not set. Online payment is disabled; Cash on Delivery still works.');
  } else if (!config.razorpay.webhookSecret) {
    warnings.push('RAZORPAY_WEBHOOK_SECRET is not set. Payment webhooks will be rejected.');
  }
  if (!usingManagedPostgres) {
    warnings.push(
      'DATABASE_URL is not set. Using the local PGlite database in data/pg — fine for development, not for production.'
    );
  } else if (/\.supabase\.(com|co)/.test(config.databaseUrl) && !/:6543\b/.test(config.databaseUrl)) {
    warnings.push(
      'DATABASE_URL points at Supabase but not at the pooler port (6543). On a serverless host this will exhaust the connection limit; use the Connection Pooling URI.'
    );
  }

  if (config.env === 'production') {
    const fatal = [];
    if (!process.env.SESSION_SECRET) fatal.push('SESSION_SECRET');
    if (!config.adminKey) fatal.push('ADMIN_KEY');
    // On a serverless host the filesystem is ephemeral, so a local database
    // would silently lose every order. Managed Postgres is required.
    if (!usingManagedPostgres) fatal.push('DATABASE_URL');
    if (fatal.length) {
      throw new Error(`Refusing to start in production without: ${fatal.join(', ')}`);
    }
  }

  return warnings;
}
