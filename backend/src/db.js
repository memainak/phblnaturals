/**
 * Postgres data layer.
 *
 * Two drivers behind one async interface:
 *   - DATABASE_URL set  → node-postgres pool (Neon, Vercel Postgres, Supabase…)
 *   - DATABASE_URL unset → PGlite, real Postgres compiled to WASM, kept in
 *     data/pg, so local development and `npm run smoke` need no server.
 *
 * Both speak the same SQL; only the connection differs.
 */
import fs from 'node:fs';
import { config, usingManagedPostgres } from './config.js';

let driver = null;

/* ----------------------------------------------------------------- driver */

async function createManagedDriver() {
  const { default: pg } = await import('pg');

  // Hosted Postgres (Neon and friends) requires TLS; a local server usually
  // does not offer it.
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(config.databaseUrl);

  // On Cloud Functions every instance gets its own pool, so the ceiling is
  // (instances x max), not max. K_SERVICE is set by the Cloud Run environment
  // the function runs on; a small pool there keeps a burst of cold starts from
  // exhausting Postgres. A long-running server has one pool and can hold more.
  const serverless = Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET);

  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: local ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX) || (serverless ? 2 : 5),
    // Idle connections are released quickly on serverless: an instance that is
    // about to be frozen should not sit holding a Postgres connection.
    idleTimeoutMillis: serverless ? 5_000 : 30_000,
    connectionTimeoutMillis: 15_000
  });

  pool.on('error', error => console.error('[db] idle client error', error));

  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params),
    // Multi-statement scripts: the simple protocol allows them, prepared
    // statements do not.
    exec: text => pool.query(text),
    async withTransaction(run) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run({ query: (t, p) => client.query(t, p) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* the connection is already gone */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}

async function createEmbeddedDriver() {
  // The specifier is held in a variable so bundlers and Vercel's file tracer
  // do not try to pull PGlite into a serverless build, where it is never used.
  const pgliteModule = '@electric-sql/pglite';
  const { PGlite } = await import(pgliteModule);

  fs.mkdirSync(config.dataDir, { recursive: true });
  const pglite = await PGlite.create({ dataDir: config.pgliteDir });

  // PGlite runs one connection, so transactions are serialised with a queue:
  // without it two overlapping BEGINs would share a single session.
  let queue = Promise.resolve();

  return {
    kind: 'pglite',
    query: (text, params) => pglite.query(text, params),
    exec: text => pglite.exec(text),
    withTransaction(run) {
      const attempt = queue.then(async () => {
        await pglite.exec('BEGIN');
        try {
          const result = await run({ query: (t, p) => pglite.query(t, p) });
          await pglite.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            await pglite.exec('ROLLBACK');
          } catch {
            /* already rolled back */
          }
          throw error;
        }
      });

      // Keep the chain alive even when this transaction rejects.
      queue = attempt.then(
        () => undefined,
        () => undefined
      );
      return attempt;
    },
    close: () => pglite.close()
  };
}

/* ------------------------------------------------------------------- api */

export async function connect() {
  if (!driver) {
    driver = usingManagedPostgres ? await createManagedDriver() : await createEmbeddedDriver();
  }
  return driver;
}

const active = () => {
  if (!driver) throw new Error('The database is not connected yet. Call initDb() first.');
  return driver;
};

export const dbKind = () => (driver ? driver.kind : null);

/** Run a statement. Params are positional: $1, $2 … */
export const query = (text, params = []) => active().query(text, params);

/** Run a multi-statement script (no parameters). */
export const exec = text => active().exec(text);

/** First row, or null. */
export const one = async (text, params = []) => (await query(text, params)).rows[0] ?? null;

/** All rows. */
export const all = async (text, params = []) => (await query(text, params)).rows;

/** Run fn inside BEGIN/COMMIT, rolling back on any throw. */
export const transaction = run => active().withTransaction(run);

export const closeDb = async () => {
  if (driver) {
    await driver.close();
    driver = null;
  }
};

/* ---------------------------------------------------------------- schema */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY,
  slug          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  category      TEXT        NOT NULL,
  price         INTEGER     NOT NULL CHECK (price >= 0),
  old_price     INTEGER,
  badge         TEXT        NOT NULL DEFAULT '',
  size          TEXT        NOT NULL DEFAULT '',
  image         TEXT        NOT NULL DEFAULT '',
  description   TEXT        NOT NULL DEFAULT '',
  ingredients   TEXT        NOT NULL DEFAULT '',
  benefits      TEXT        NOT NULL DEFAULT '',
  usage_text    TEXT        NOT NULL DEFAULT '',
  stock         INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category, active);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER     GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        UNIQUE,
  phone         TEXT        UNIQUE,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'customer',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT        PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  user_agent  TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS carts (
  user_id     INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id  INTEGER     NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  qty         INTEGER     NOT NULL CHECK (qty > 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT        PRIMARY KEY,
  user_id         INTEGER     REFERENCES users (id) ON DELETE SET NULL,
  customer_name   TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  phone           TEXT        NOT NULL,
  address         TEXT        NOT NULL,
  notes           TEXT        NOT NULL DEFAULT '',
  payment_method  TEXT        NOT NULL,
  subtotal        INTEGER     NOT NULL,
  shipping        INTEGER     NOT NULL DEFAULT 0,
  cod_fee         INTEGER     NOT NULL DEFAULT 0,
  total           INTEGER     NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  payment_status  TEXT        NOT NULL DEFAULT 'unpaid',
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders (phone);
CREATE INDEX IF NOT EXISTS idx_orders_rzp ON orders (razorpay_order_id);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  order_id    TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  size        TEXT    NOT NULL DEFAULT '',
  image       TEXT    NOT NULL DEFAULT '',
  unit_price  INTEGER NOT NULL,
  qty         INTEGER NOT NULL,
  line_total  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS newsletter (
  email       TEXT        PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  active      BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER     GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name        TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  phone       TEXT        NOT NULL DEFAULT '',
  subject     TEXT        NOT NULL DEFAULT '',
  message     TEXT        NOT NULL,
  handled     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function initDb() {
  await connect();
  await exec(SCHEMA);
  return driver.kind;
}

export async function cleanupExpiredSessions() {
  const { rowCount } = await query('DELETE FROM sessions WHERE expires_at <= now()');
  return rowCount ?? 0;
}

/** Drops every table. Used by the test harness only. */
export async function dropAll() {
  await exec(`
    DROP TABLE IF EXISTS order_items, orders, carts, sessions, users,
                         products, newsletter, messages CASCADE
  `);
}
