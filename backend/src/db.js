import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(config.dbFile);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY,
  slug          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  category      TEXT    NOT NULL,
  price         INTEGER NOT NULL CHECK (price >= 0),
  old_price     INTEGER,
  badge         TEXT    NOT NULL DEFAULT '',
  size          TEXT    NOT NULL DEFAULT '',
  image         TEXT    NOT NULL DEFAULT '',
  description   TEXT    NOT NULL DEFAULT '',
  ingredients   TEXT    NOT NULL DEFAULT '',
  benefits      TEXT    NOT NULL DEFAULT '',
  usage         TEXT    NOT NULL DEFAULT '',
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category, active);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    UNIQUE,
  phone         TEXT    UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'customer',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT    NOT NULL,
  user_agent  TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS carts (
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT    PRIMARY KEY,
  user_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  customer_name   TEXT    NOT NULL,
  email           TEXT    NOT NULL,
  phone           TEXT    NOT NULL,
  address         TEXT    NOT NULL,
  notes           TEXT    NOT NULL DEFAULT '',
  payment_method  TEXT    NOT NULL,
  subtotal        INTEGER NOT NULL,
  shipping        INTEGER NOT NULL DEFAULT 0,
  cod_fee         INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',
  payment_status  TEXT    NOT NULL DEFAULT 'unpaid',
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders (phone);
CREATE INDEX IF NOT EXISTS idx_orders_rzp ON orders (razorpay_order_id);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
  email       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL,
  handled     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** Run fn inside a transaction, rolling back on any throw. */
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* the transaction was already closed */
    }
    throw error;
  }
}

export function cleanupExpiredSessions() {
  return db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run().changes;
}
