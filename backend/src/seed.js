import { catalogue } from './catalogue.js';
import { db, transaction } from './db.js';
import { slugify } from './util.js';

const insertProduct = db.prepare(`
  INSERT INTO products (
    id, slug, name, category, price, old_price, badge, size, image,
    description, ingredients, benefits, usage, stock, active, sort_order
  ) VALUES (
    $id, $slug, $name, $category, $price, $oldPrice, $badge, $size, $image,
    $description, $ingredients, $benefits, $usage, $stock, 1, $sortOrder
  )
  ON CONFLICT (id) DO UPDATE SET
    name        = excluded.name,
    category    = excluded.category,
    price       = excluded.price,
    old_price   = excluded.old_price,
    badge       = excluded.badge,
    size        = excluded.size,
    image       = excluded.image,
    description = excluded.description,
    ingredients = excluded.ingredients,
    benefits    = excluded.benefits,
    usage       = excluded.usage,
    sort_order  = excluded.sort_order,
    updated_at  = datetime('now')
`);

/**
 * Seeds the catalogue. Product copy and prices are refreshed on every run;
 * stock is only set when the row is new, so admin stock edits survive a reseed.
 */
export function seedProducts({ log = false } = {}) {
  const existing = new Set(db.prepare('SELECT id FROM products').all().map(r => r.id));
  const seen = new Set();
  let inserted = 0;
  let updated = 0;

  transaction(() => {
    catalogue.forEach((product, index) => {
      // Two seed items share a name ("Herbal Hair Oil"); keep slugs unique.
      let slug = slugify(`${product.name}-${product.size}`);
      while (seen.has(slug)) slug = `${slug}-${product.id}`;
      seen.add(slug);

      insertProduct.run({
        id: product.id,
        slug,
        name: product.name,
        category: product.category,
        price: product.price,
        oldPrice: product.oldPrice ?? null,
        badge: product.badge || '',
        size: product.size || '',
        image: product.image || '',
        description: product.desc || '',
        ingredients: product.ingredients || '',
        benefits: product.benefits || '',
        usage: product.usage || '',
        stock: product.stock ?? 0,
        sortOrder: index
      });

      if (existing.has(product.id)) updated += 1;
      else inserted += 1;
    });
  });

  if (log) {
    console.log(`[seed] products: ${inserted} inserted, ${updated} refreshed.`);
  }
  return { inserted, updated };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  seedProducts({ log: true });
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  console.log(`[seed] catalogue now holds ${count} products.`);
}
