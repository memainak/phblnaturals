import dotenv from 'dotenv';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

/**
 * Local configuration lives in `.env.local`, not `.env`.
 *
 * This folder is the Cloud Functions source directory, and firebase-functions
 * treats a `.env` here as the deployed environment: it would ship local values
 * — NODE_ENV=development, a dev SESSION_SECRET, a FIRESTORE_EMULATOR_HOST
 * pointing at a machine that does not exist — straight to production, where
 * they would override Secret Manager. `.env.local` is only ever applied to the
 * emulators, so it cannot leak that way.
 *
 * `.env` is still read if one exists, for anyone who made it by hand, but
 * `.env.local` wins and `firebase deploy` will refuse while a `.env` is here.
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

  // Firestore. On Cloud Functions and Cloud Run the project id and the
  // credentials are both ambient, so none of these need to be set in
  // production. Locally, either point FIRESTORE_EMULATOR_HOST at the emulator
  // or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key.
  firebaseProjectId: (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
  ).trim(),
  firestoreDatabaseId: (process.env.FIRESTORE_DATABASE_ID || '').trim(),
  firestoreEmulatorHost: (process.env.FIRESTORE_EMULATOR_HOST || '').trim(),

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

/** True when Firestore calls go to the local emulator rather than Google. */
export const usingEmulator = Boolean(config.firestoreEmulatorHost);

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
  if (usingEmulator) {
    warnings.push(
      `Firestore calls go to the emulator at ${config.firestoreEmulatorHost}. Nothing is written to the real database.`
    );
  } else if (!config.firebaseProjectId && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    warnings.push(
      'No Firebase project id and no GOOGLE_APPLICATION_CREDENTIALS. Firestore will fail unless this process runs on Google infrastructure.'
    );
  }

  if (config.env === 'production') {
    const fatal = [];
    if (!process.env.SESSION_SECRET) fatal.push('SESSION_SECRET');
    if (!config.adminKey) fatal.push('ADMIN_KEY');
    // Without a project id the Admin SDK cannot find a database at all, and
    // every order would fail at write time rather than at boot.
    if (!config.firebaseProjectId && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      fatal.push('FIREBASE_PROJECT_ID');
    }
    if (usingEmulator) fatal.push('FIRESTORE_EMULATOR_HOST must not be set in production');
    if (fatal.length) {
      throw new Error(`Refusing to start in production without: ${fatal.join(', ')}`);
    }
  }

  return warnings;
}
