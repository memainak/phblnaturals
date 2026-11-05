/**
 * Concurrency check for the Firestore stock reservation: the one piece whose
 * mechanism changed completely in the port. Sets a product to exactly 1 unit,
 * fires N simultaneous checkouts for it, and asserts that exactly one wins.
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 4988;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_KEY = 'race-admin-key';
const EMULATOR = '127.0.0.1:8080';
const PROJECT = 'phbl-naturals-local';
const ATTEMPTS = 8;

await fetch(
  `http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
  { method: 'DELETE' }
);

const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    ADMIN_KEY,
    SESSION_SECRET: 'race-session-secret',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    FIRESTORE_EMULATOR_HOST: EMULATOR,
    FIREBASE_PROJECT_ID: PROJECT,
    GOOGLE_APPLICATION_CREDENTIALS: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
const log = [];
child.stdout.on('data', d => log.push(d.toString()));
child.stderr.on('data', d => log.push(d.toString()));

const json = async (path, init) => {
  const response = await fetch(`${BASE}${path}`, init);
  return { status: response.status, data: await response.json().catch(() => ({})) };
};

try {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }

  const admin = { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'application/json' };

  // Exactly one unit of product 1 left in the shop.
  await json('/api/admin/products/1', {
    method: 'PATCH',
    headers: admin,
    body: JSON.stringify({ stock: 1 })
  });

  const before = (await json('/api/products/1')).data.product.stock;
  assert.equal(before, 1, 'setup: stock should be 1');
  console.log(`  stock before: ${before}`);

  // ATTEMPTS shoppers hit checkout for that unit at the same instant.
  const results = await Promise.all(
    Array.from({ length: ATTEMPTS }, (_, n) =>
      json('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Racer ${n}`,
          email: `racer${n}@example.com`,
          phone: '9876543210',
          address: '12 Race Street, Test City, 700001',
          payment: 'cod',
          items: [{ productId: 1, qty: 1 }]
        })
      })
    )
  );

  const created = results.filter(r => r.status === 201);
  const rejected = results.filter(r => r.status === 409);
  const other = results.filter(r => r.status !== 201 && r.status !== 409);

  console.log(`  ${ATTEMPTS} simultaneous checkouts → ${created.length} created, ${rejected.length} rejected as out of stock, ${other.length} other`);
  if (other.length) console.log('  unexpected:', other.map(o => `${o.status} ${o.data.error}`));

  const after = (await json('/api/products/1')).data.product.stock;
  console.log(`  stock after: ${after}`);

  assert.equal(created.length, 1, `exactly one order should succeed, got ${created.length}`);
  assert.equal(other.length, 0, 'no request should fail for any other reason');
  assert.equal(after, 0, `stock must land on 0, got ${after}`);

  const admins = await json('/api/admin/orders', { headers: admin });
  assert.equal(admins.data.orders.length, 1, 'only one order should exist');
  console.log('\n  the last unit was sold exactly once — no oversell, no lost stock');
} catch (error) {
  console.error('\nFAILED:', error.message);
  if (log.length) console.error(log.join(''));
  process.exitCode = 1;
} finally {
  child.kill('SIGKILL');
}
