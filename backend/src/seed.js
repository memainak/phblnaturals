import { catalogue } from './catalogue.js';
import { all, closeDb, initDb, query, transaction } from './db.js';
import { slugify } from './util.js';

/**
 * Seeds the catalogue. Product copy and prices are refreshed on every run;
 * stock is only set when the row is new, so admin stock edits survive a reseed.
 */
export async function seedProducts({ log = false } = {}) {
  const existing = new Set((await all('SELECT id FROM products')).map(r => r.id));
  const seen = new Set();
  let inserted = 0;
  let updated = 0;

  await transaction(async client => {
    for (const [index, product] of catalogue.entries()) {
      // Two seed items share a name ("Herbal Hair Oil"); keep slugs unique.
      let slug = slugify(`${product.name}-${product.size}`);
      while (seen.has(slug)) slug = `${slug}-${product.id}`;
      seen.add(slug);

      await client.query(
        `INSERT INTO products (
           id, slug, name, category, price, old_price, badge, size, image,
           description, ingredients, benefits, usage_text, stock, active, sort_order
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15)
         ON CONFLICT (id) DO UPDATE SET
           name        = EXCLUDED.name,
           category    = EXCLUDED.category,
           price       = EXCLUDED.price,
           old_price   = EXCLUDED.old_price,
           badge       = EXCLUDED.badge,
           size        = EXCLUDED.size,
           image       = EXCLUDED.image,
           description = EXCLUDED.description,
           ingredients = EXCLUDED.ingredients,
           benefits    = EXCLUDED.benefits,
           usage_text  = EXCLUDED.usage_text,
           sort_order  = EXCLUDED.sort_order,
           updated_at  = now()`,
        [
          product.id,
          slug,
          product.name,
          product.category,
          product.price,
          product.oldPrice ?? null,
          product.badge || '',
          product.size || '',
          product.image || '',
          product.desc || '',
          product.ingredients || '',
          product.benefits || '',
          product.usage || '',
          product.stock ?? 0,
          index
        ]
      );

      if (existing.has(product.id)) updated += 1;
      else inserted += 1;
    }
  });

  if (log) console.log(`[seed] products: ${inserted} inserted, ${updated} refreshed.`);
  return { inserted, updated };
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());

if (invokedDirectly) {
  await initDb();
  await seedProducts({ log: true });
  const [{ count }] = await all('SELECT COUNT(*)::int AS count FROM products');
  console.log(`[seed] catalogue now holds ${count} products.`);
  await closeDb();
}
