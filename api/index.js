/**
 * Vercel serverless entry point.
 *
 * Only /api/* reaches this function — the storefront itself is served as
 * static files from dist/, built by scripts/build-static.mjs. The same Express
 * app runs here and under `node backend/server.js`.
 */
import { createApp } from '../backend/src/app.js';

// serveFrontend: false — static assets are Vercel's job, not the function's.
const app = createApp({ serveFrontend: false });

export default app;
