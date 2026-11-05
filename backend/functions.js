/**
 * Firebase Functions entry point.
 *
 * Hosting serves the static storefront from dist/ and rewrites /api/** to this
 * one function, which is the same Express app that `node server.js` runs
 * locally. Firestore is reached through the ambient service account, so no
 * credentials are configured here.
 *
 * The sensitive values live in Secret Manager, not in this file and not in the
 * repository. Create them once per project:
 *
 *   firebase functions:secrets:set SESSION_SECRET
 *   firebase functions:secrets:set ADMIN_KEY
 *   firebase functions:secrets:set RAZORPAY_KEY_ID
 *   firebase functions:secrets:set RAZORPAY_KEY_SECRET
 *   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
 *
 * Declaring them below is what mounts them as environment variables on the
 * instance, which is where config.js reads them from.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { createApp } from './src/app.js';

const SESSION_SECRET = defineSecret('SESSION_SECRET');
const ADMIN_KEY = defineSecret('ADMIN_KEY');
const RAZORPAY_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');
const RAZORPAY_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET');

setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

// serveFrontend: false — Hosting serves the static files from its CDN, so the
// function only answers /api/*.
const app = createApp({ serveFrontend: false });

export const api = onRequest(
  {
    secrets: [
      SESSION_SECRET,
      ADMIN_KEY,
      RAZORPAY_KEY_ID,
      RAZORPAY_KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET
    ],
    // One instance stays warm so a shopper does not wait for a cold start at
    // checkout. Set to 0 to pay nothing while the shop is idle.
    minInstances: 0,
    concurrency: 40,
    timeoutSeconds: 60,
    memory: '512MiB'
  },
  app
);
