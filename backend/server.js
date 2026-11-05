/**
 * Long-running entry point (local development, Render, Railway, Fly, a VM).
 * On Vercel the same app is served by api/index.js instead.
 */
import { bootstrap, createApp } from './src/app.js';
import { checkConfig, config } from './src/config.js';
import { cleanupExpiredSessions, closeDb } from './src/db.js';

const warnings = checkConfig();
const app = createApp();

const database = await bootstrap();

setInterval(() => {
  cleanupExpiredSessions().catch(error => console.error('[sessions] cleanup failed', error));
}, 6 * 60 * 60_000).unref();

const server = app.listen(config.port, () => {
  console.log(`\n  PHBL Naturals backend — ${config.env}`);
  console.log(`  Database    ${database}`);
  console.log(`  API         http://localhost:${config.port}/api/health`);
  console.log(`  Storefront  http://localhost:${config.port}/`);
  console.log(
    `  Admin       ${config.adminKey ? `http://localhost:${config.port}/admin.html` : 'disabled (set ADMIN_KEY)'}`
  );
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(async () => {
      await closeDb().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
