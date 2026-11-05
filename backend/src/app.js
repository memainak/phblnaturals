import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT, config, razorpayEnabled, usingEmulator } from './config.js';
import { cleanupExpiredSessions, dbKind, initDb } from './db.js';
import {
  attachUser,
  cors,
  errorHandler,
  notFoundHandler,
  parseCookies,
  securityHeaders
} from './middleware.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { cartRouter } from './routes/cart.js';
import { contentRouter } from './routes/content.js';
import { ordersRouter } from './routes/orders.js';
import { paymentsRouter, razorpayWebhook } from './routes/payments.js';
import { productsRouter } from './routes/products.js';
import { seedProducts } from './seed.js';

const BRIDGE = '/storefront-api.js';

/**
 * One-time startup: connect, create the schema, seed the catalogue. On a
 * serverless host this runs once per cold start, so it is memoised.
 */
let ready = null;

export function bootstrap() {
  ready ??= (async () => {
    await initDb();
    await seedProducts();
    await cleanupExpiredSessions();
    return dbKind();
  })();
  return ready;
}

export function createApp({ serveFrontend = true } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(cors);

  // The webhook must see the exact bytes Razorpay signed, so it is mounted
  // with a raw body parser ahead of express.json().
  app.post(
    '/api/payments/razorpay/webhook',
    express.raw({ type: '*/*', limit: '256kb' }),
    razorpayWebhook
  );

  app.use(express.json({ limit: '128kb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));
  app.use(parseCookies);

  // Every request waits for the schema to exist before touching the database.
  app.use(async (_req, _res, next) => {
    try {
      await bootstrap();
      next();
    } catch (error) {
      next(error);
    }
  });

  app.use(attachUser);

  /* ----------------------------------------------------------------- api */

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'phbl-naturals-backend',
      env: config.env,
      database: dbKind(),
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString()
    });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      ok: true,
      currency: 'INR',
      pricing: config.pricing,
      payments: {
        cod: true,
        razorpay: razorpayEnabled,
        razorpayKeyId: razorpayEnabled ? config.razorpay.keyId : null
      },
      auth: { passwordLogin: true, google: false, otp: false },
      user: req.user ?? null
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api', contentRouter); // /api/newsletter, /api/contact
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);

  /* ------------------------------------------------------------ frontend */

  const publicDir = path.join(ROOT, 'public');
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));

  const indexPath = path.join(config.frontendDir, 'index.html');
  const frontendExists = serveFrontend && fs.existsSync(indexPath);

  if (frontendExists) {
    /**
     * The storefront folder is read-only, so instead of editing index.html we
     * serve it with one extra script tag that wires the page up to this API.
     */
    let cached = { mtimeMs: 0, html: '' };

    const renderIndex = () => {
      const { mtimeMs } = fs.statSync(indexPath);
      if (mtimeMs !== cached.mtimeMs) {
        const raw = fs.readFileSync(indexPath, 'utf8');
        cached = {
          mtimeMs,
          html: raw.includes(BRIDGE)
            ? raw
            : raw.replace(/<\/body>/i, `  <script src="${BRIDGE}" defer></script>\n</body>`)
        };
      }
      return cached.html;
    };

    const sendIndex = (_req, res) => {
      res.set('Cache-Control', 'no-cache').type('html').send(renderIndex());
    };

    app.get('/', sendIndex);
    app.get('/index.html', sendIndex);
    app.use(express.static(config.frontendDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, sendIndex);
  } else if (serveFrontend) {
    app.get('/', (_req, res) => {
      res.type('html').send(
        `<h1>PHBL Naturals API</h1>
         <p>The API is running on ${dbKind() ?? 'an unconnected database'}. The storefront was not
         found at <code>${config.frontendDir}</code> — set <code>FRONTEND_DIR</code>.</p>
         <p><a href="/api/health">/api/health</a> · <a href="/api/products">/api/products</a></p>`
      );
    });
  }

  app.use(errorHandler);
  return app;
}

export { usingEmulator };
