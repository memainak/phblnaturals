import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT, checkConfig, config, razorpayEnabled } from './src/config.js';
import { cleanupExpiredSessions } from './src/db.js';
import {
  attachUser,
  cors,
  errorHandler,
  notFoundHandler,
  parseCookies,
  securityHeaders
} from './src/middleware.js';
import { adminRouter } from './src/routes/admin.js';
import { authRouter } from './src/routes/auth.js';
import { cartRouter } from './src/routes/cart.js';
import { contentRouter } from './src/routes/content.js';
import { ordersRouter } from './src/routes/orders.js';
import { paymentsRouter, razorpayWebhook } from './src/routes/payments.js';
import { productsRouter } from './src/routes/products.js';
import { seedProducts } from './src/seed.js';

const warnings = checkConfig();
seedProducts();
cleanupExpiredSessions();
setInterval(cleanupExpiredSessions, 6 * 60 * 60_000).unref();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(cors);

// The webhook must see the exact bytes Razorpay signed, so it is mounted with
// a raw body parser ahead of express.json().
app.post(
  '/api/payments/razorpay/webhook',
  express.raw({ type: '*/*', limit: '256kb' }),
  razorpayWebhook
);

app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '128kb' }));
app.use(parseCookies);
app.use(attachUser);

/* ------------------------------------------------------------------- api */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'phbl-naturals-backend',
    env: config.env,
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

/* -------------------------------------------------------------- frontend */

const BRIDGE = '/storefront-api.js';
const publicDir = path.join(ROOT, 'public');

app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h' }));

const frontendExists = fs.existsSync(path.join(config.frontendDir, 'index.html'));

if (frontendExists) {
  /**
   * The storefront folder is read-only, so instead of editing index.html we
   * serve it with one extra script tag that wires the page up to this API.
   */
  const indexPath = path.join(config.frontendDir, 'index.html');
  let cached = { mtimeMs: 0, html: '' };

  const renderIndex = () => {
    const { mtimeMs } = fs.statSync(indexPath);
    if (mtimeMs !== cached.mtimeMs) {
      const raw = fs.readFileSync(indexPath, 'utf8');
      const tag = `<script src="${BRIDGE}" defer></script>`;
      cached = {
        mtimeMs,
        html: raw.includes(BRIDGE)
          ? raw
          : raw.replace(/<\/body>/i, `  ${tag}\n</body>`)
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
  app.get(/^\/(?!api\/).*/, sendIndex); // single-page storefront: everything else is the page
} else {
  app.get('/', (_req, res) => {
    res.type('html').send(
      `<h1>PHBL Naturals API</h1>
       <p>The API is running. The storefront was not found at
       <code>${config.frontendDir}</code> — set <code>FRONTEND_DIR</code> in .env.</p>
       <p><a href="/api/health">/api/health</a> · <a href="/api/products">/api/products</a></p>`
    );
  });
}

app.use(errorHandler);

/* ----------------------------------------------------------------- boot */

const server = app.listen(config.port, () => {
  console.log(`\n  PHBL Naturals backend — ${config.env}`);
  console.log(`  API         http://localhost:${config.port}/api/health`);
  console.log(
    `  Storefront  ${frontendExists ? `http://localhost:${config.port}/` : 'not found (set FRONTEND_DIR)'}`
  );
  console.log(
    `  Admin       ${config.adminKey ? `http://localhost:${config.port}/admin.html` : 'disabled (set ADMIN_KEY)'}`
  );
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
