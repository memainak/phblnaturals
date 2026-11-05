/**
 * Accounts and sessions.
 *
 * Uniqueness of email addresses and mobile numbers is enforced with claim
 * documents in userEmails/ and userPhones/, written in the same transaction as
 * the account itself — see the comment in db.js.
 */
import {
  docsOf,
  serverTimestamp,
  sessions,
  toIso,
  transaction,
  userEmails,
  userPhones,
  users,
  withId
} from './db.js';
import { HttpError } from './util.js';

/* ------------------------------------------------------------------ lookup */

const first = snapshot =>
  snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };

export async function findUserByEmail(email) {
  if (!email) return null;
  return first(await users().where('email', '==', email).limit(1).get());
}

export async function findUserByPhone(phone) {
  if (!phone) return null;
  return first(await users().where('phone', '==', phone).limit(1).get());
}

export async function findUserById(id) {
  if (!id) return null;
  return withId(await users().doc(String(id)).get());
}

/* ---------------------------------------------------------------- creation */

export async function createUser({ name, email, phone, passwordHash }) {
  const ref = users().doc();

  await transaction(async tx => {
    const emailRef = email ? userEmails().doc(email) : null;
    const phoneRef = phone ? userPhones().doc(phone) : null;

    const [emailClaim, phoneClaim] = await Promise.all([
      emailRef ? tx.get(emailRef) : null,
      phoneRef ? tx.get(phoneRef) : null
    ]);

    if (emailClaim?.exists) {
      throw new HttpError(409, 'An account already exists with that email address. Please sign in.');
    }
    if (phoneClaim?.exists) {
      throw new HttpError(409, 'An account already exists with that mobile number. Please sign in.');
    }

    tx.set(ref, {
      name,
      email: email || null,
      phone: phone || null,
      passwordHash,
      role: 'customer',
      createdAt: serverTimestamp(),
      lastLoginAt: null
    });

    if (emailRef) tx.set(emailRef, { userId: ref.id });
    if (phoneRef) tx.set(phoneRef, { userId: ref.id });
  });

  return findUserById(ref.id);
}

/**
 * Changes name, email and phone together, moving the uniqueness claims so a
 * released address becomes available to someone else.
 */
export async function updateUserContact(userId, { name, email, phone }) {
  const ref = users().doc(String(userId));

  await transaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpError(404, 'Account not found.');

    const current = snapshot.data();
    const emailChanged = (current.email || null) !== (email || null);
    const phoneChanged = (current.phone || null) !== (phone || null);

    const claims = [];
    if (emailChanged && email) claims.push(['email', userEmails().doc(email)]);
    if (phoneChanged && phone) claims.push(['phone', userPhones().doc(phone)]);

    const taken = await Promise.all(claims.map(([, claimRef]) => tx.get(claimRef)));

    for (const [index, snap] of taken.entries()) {
      if (snap.exists && snap.data().userId !== ref.id) {
        throw new HttpError(
          409,
          claims[index][0] === 'email'
            ? 'That email address is already used by another account.'
            : 'That mobile number is already used by another account.'
        );
      }
    }

    tx.update(ref, { name, email: email || null, phone: phone || null });

    if (emailChanged) {
      if (current.email) tx.delete(userEmails().doc(current.email));
      if (email) tx.set(userEmails().doc(email), { userId: ref.id });
    }
    if (phoneChanged) {
      if (current.phone) tx.delete(userPhones().doc(current.phone));
      if (phone) tx.set(userPhones().doc(phone), { userId: ref.id });
    }
  });

  return findUserById(userId);
}

export const setPassword = (userId, passwordHash) =>
  users().doc(String(userId)).update({ passwordHash });

export const touchLastLogin = userId =>
  users().doc(String(userId)).update({ lastLoginAt: serverTimestamp() });

/* ---------------------------------------------------------------- sessions */

export const createSession = (userId, tokenHash, expiresAt, userAgent) =>
  sessions().doc(tokenHash).set({
    userId: String(userId),
    createdAt: serverTimestamp(),
    expiresAt,
    userAgent: String(userAgent || '').slice(0, 200)
  });

export const deleteSession = tokenHash => sessions().doc(tokenHash).delete();

export async function deleteSessionsForUser(userId) {
  const snapshot = await sessions().where('userId', '==', String(userId)).get();
  if (snapshot.empty) return 0;

  const batch = sessions().firestore.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  return snapshot.size;
}

/**
 * The session plus its account, for attachUser. Returns null for an unknown or
 * expired token, and deletes the expired document on the way out.
 */
export async function findSessionUser(tokenHash) {
  const ref = sessions().doc(tokenHash);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;

  const session = snapshot.data();
  const expiresAt = session.expiresAt?.toDate?.() ?? new Date(session.expiresAt);

  if (!(expiresAt > new Date())) {
    await ref.delete().catch(() => {});
    return null;
  }

  const user = await findUserById(session.userId);
  if (!user) {
    // The account is gone; the session is worthless.
    await ref.delete().catch(() => {});
    return null;
  }

  return { tokenHash, user };
}

/* ------------------------------------------------------------------- admin */

export const countUsers = async () => (await users().count().get()).data().count;

/**
 * Customers with their order counts and lifetime value. Firestore cannot join,
 * so the orders are read once and totalled per customer in memory. Fine at
 * shop scale; if the order collection ever runs to six figures this should
 * become a counter maintained on each order write.
 */
export async function listCustomersWithOrderStats(limit, orderRows) {
  const snapshot = await users().orderBy('createdAt', 'desc').limit(limit).get();

  const stats = new Map();
  for (const order of orderRows) {
    if (!order.userId) continue;
    const entry = stats.get(order.userId) ?? { orderCount: 0, lifetimeValue: 0 };
    entry.orderCount += 1;
    if (order.status !== 'cancelled') entry.lifetimeValue += order.total ?? 0;
    stats.set(order.userId, entry);
  }

  return docsOf(snapshot).map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    createdAt: toIso(user.createdAt),
    lastLoginAt: toIso(user.lastLoginAt),
    orderCount: stats.get(user.id)?.orderCount ?? 0,
    lifetimeValue: stats.get(user.id)?.lifetimeValue ?? 0
  }));
}
