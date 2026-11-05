import { catalogue } from './catalogue.js';
import {
  closeDb,
  ensureCounterAtLeast,
  firestore,
  initDb,
  products,
  serverTimestamp
} from './db.js';
import { slugify } from './util.js';

/**
 * Seeds the catalogue. Product copy and prices are refreshed on every run;
 * stock is only set when the document is new, so admin stock edits survive a
 * reseed.
 */
export async function seedProducts({ log = false } = {}) {
  const existing = new Set((await products().select().get()).docs.map(doc => doc.id));
  const seen = new Set();

  const batch = firestore().batch();
  let inserted = 0;
  let updated = 0;
  let highestId = 0;

  for (const [index, product] of catalogue.entries()) {
    // Two seed items share a name ("Herbal Hair Oil"); keep slugs unique.
    let slug = slugify(`${product.name}-${product.size}`);
    while (seen.has(slug)) slug = `${slug}-${product.id}`;
    seen.add(slug);

    const key = String(product.id);
    const isNew = !existing.has(key);
    highestId = Math.max(highestId, Number(product.id) || 0);

    const fields = {
      id: Number(product.id),
      slug,
      name: product.name,
      category: product.category,
      price: product.price,
      oldPrice: product.oldPrice ?? null,
      badge: product.badge || '',
      size: product.size || '',
      image: product.image || '',
      desc: product.desc || '',
      ingredients: product.ingredients || '',
      benefits: product.benefits || '',
      usage: product.usage || '',
      sortOrder: index,
      updatedAt: serverTimestamp()
    };

    if (isNew) {
      // Stock and the active flag belong to the shop, not to the seed file, so
      // they are written once and never touched again.
      Object.assign(fields, {
        stock: product.stock ?? 0,
        active: true,
        createdAt: serverTimestamp()
      });
      inserted += 1;
    } else {
      updated += 1;
    }

    batch.set(products().doc(key), fields, { merge: true });
  }

  await batch.commit();

  // New products added from the admin dashboard take the next id after these.
  await ensureCounterAtLeast('products', highestId);

  if (log) console.log(`[seed] products: ${inserted} inserted, ${updated} refreshed.`);
  return { inserted, updated };
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());

if (invokedDirectly) {
  await initDb();
  await seedProducts({ log: true });
  const { count } = (await products().count().get()).data();
  console.log(`[seed] catalogue now holds ${count} products.`);
  await closeDb();
}
