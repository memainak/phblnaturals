/**
 * Firestore data layer.
 *
 * One Firestore database behind a small set of collection handles. Credentials
 * are resolved by the Admin SDK in this order:
 *
 *   1. FIRESTORE_EMULATOR_HOST set  → the local emulator, no credentials
 *   2. GOOGLE_APPLICATION_CREDENTIALS → a service-account key file
 *   3. otherwise                     → the ambient service account, which is
 *      what Cloud Functions and Cloud Run provide
 *
 * Shape of the data:
 *
 *   products/{id}                 id is the numeric product id as a string
 *   users/{userId}                auto-id
 *   users/{userId}/cart/{productId}
 *   sessions/{tokenHash}
 *   orders/{PHBL-XXXXXX}          line items live in an `items` array
 *   newsletter/{email}
 *   messages/{n}                  n from counters/messages
 *   counters/{name}               { value: number }
 *
 * Two deliberate choices:
 *
 *   - Order items are an array field, not a subcollection. They are bounded
 *     (50 lines max, enforced in priceBasket) and always read together with
 *     their order, so a subcollection would cost an extra round trip per order
 *     and buy nothing.
 *   - Documents use camelCase field names, matching the JSON the API returns,
 *     so there is no column-to-field translation layer.
 */
import { config } from './config.js';

let db = null;
let kind = null;
let FieldValueRef = null;
let TimestampRef = null;

/* -------------------------------------------------------------- connection */

export async function connect() {
  if (db) return db;

  const [{ initializeApp, applicationDefault, getApps }, firestore] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore')
  ]);

  const { getFirestore, FieldValue, Timestamp } = firestore;
  FieldValueRef = FieldValue;
  TimestampRef = Timestamp;

  if (!getApps().length) {
    // Against the emulator any project id works, and no credential is read.
    initializeApp(
      config.firestoreEmulatorHost
        ? { projectId: config.firebaseProjectId || 'phbl-naturals-local' }
        : {
            credential: applicationDefault(),
            ...(config.firebaseProjectId ? { projectId: config.firebaseProjectId } : {})
          }
    );
  }

  db = getFirestore(config.firestoreDatabaseId || '(default)');

  // Writing `undefined` throws by default; treating it as "leave the field out"
  // matches how the route handlers build patch objects.
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* settings() throws if the instance has already been used */
  }

  kind = config.firestoreEmulatorHost ? 'firestore-emulator' : 'firestore';
  return db;
}

const active = () => {
  if (!db) throw new Error('Firestore is not connected yet. Call initDb() first.');
  return db;
};

export const dbKind = () => kind;
export const firestore = () => active();
export const FieldValue = () => FieldValueRef;
export const Timestamp = () => TimestampRef;

/* ------------------------------------------------------------- collections */

export const products = () => active().collection('products');
export const users = () => active().collection('users');

/**
 * Firestore has no unique constraint, so an email or mobile number is claimed
 * by writing a document whose id *is* that value, inside the same transaction
 * that creates or updates the account. A second signup for the same address
 * finds the claim already taken and is rejected.
 */
export const userEmails = () => active().collection('userEmails');
export const userPhones = () => active().collection('userPhones');
export const sessions = () => active().collection('sessions');
export const orders = () => active().collection('orders');
export const newsletter = () => active().collection('newsletter');
export const messages = () => active().collection('messages');
export const counters = () => active().collection('counters');
export const cartOf = userId => users().doc(String(userId)).collection('cart');

/* ------------------------------------------------------------------ helpers */

/** Run fn inside a Firestore transaction. All reads must precede all writes. */
export const transaction = run => active().runTransaction(run);

export const serverTimestamp = () => FieldValueRef.serverTimestamp();

/** Firestore Timestamp | Date | string → ISO string, or null. */
export function toIso(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return null;
}

/** Firestore Timestamp | Date | string → Date, or null. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A document's data with its id attached, or null when it does not exist. */
export const withId = snapshot =>
  snapshot?.exists ? { id: snapshot.id, ...snapshot.data() } : null;

export const docsOf = query => query.docs.map(doc => ({ id: doc.id, ...doc.data() }));

/**
 * Next value of a named counter. Sequential ids are needed where the API
 * contract promises a number (message ids) or where the catalogue uses fixed
 * numeric ids (products).
 */
export async function nextId(name, startFrom = 1) {
  const ref = counters().doc(name);

  return transaction(async tx => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? Number(snapshot.data().value) || 0 : 0;
    const next = Math.max(current + 1, startFrom);
    tx.set(ref, { value: next }, { merge: true });
    return next;
  });
}

/** Raises a counter's floor without ever lowering it. Used after seeding. */
export async function ensureCounterAtLeast(name, value) {
  const ref = counters().doc(name);

  await transaction(async tx => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? Number(snapshot.data().value) || 0 : 0;
    if (value > current) tx.set(ref, { value }, { merge: true });
  });
}

/* ---------------------------------------------------------------- lifecycle */

/**
 * Firestore is schemaless, so there is nothing to create — this only opens the
 * connection. Composite indexes live in firestore.indexes.json and are
 * deployed with the project.
 */
export async function initDb() {
  await connect();
  return kind;
}

export async function cleanupExpiredSessions() {
  const expired = await sessions().where('expiresAt', '<=', new Date()).limit(500).get();
  if (expired.empty) return 0;

  const batch = active().batch();
  expired.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  return expired.size;
}

export async function closeDb() {
  if (db) {
    await db.terminate();
    db = null;
    kind = null;
  }
}

/** Deletes every document. Test harness only — it refuses to run otherwise. */
export async function dropAll() {
  if (!config.firestoreEmulatorHost && config.env === 'production') {
    throw new Error('dropAll() refuses to run against a production database.');
  }

  const root = active();
  for (const name of [
    'products',
    'users',
    'userEmails',
    'userPhones',
    'sessions',
    'orders',
    'newsletter',
    'messages',
    'counters'
  ]) {
    await root.recursiveDelete(root.collection(name));
  }
}
