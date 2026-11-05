import express from 'express';
import {
  getProduct,
  getProductBySlug,
  listCategories,
  listProducts,
  priceBasket
} from '../store.js';
import { notFound, str } from '../util.js';

export const productsRouter = express.Router();

const SORTS = {
  featured: (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
  low: (a, b) => a.price - b.price,
  high: (a, b) => b.price - a.price,
  name: (a, b) => a.name.localeCompare(b.name)
};

/** GET /api/products?category=Hair Care&q=oil&sort=low&limit=50 */
productsRouter.get('/', async (req, res) => {
  const category = str(req.query.category, 60);
  const q = str(req.query.q ?? req.query.search, 80).toLowerCase();
  const sort = SORTS[str(req.query.sort, 20)] ? str(req.query.sort, 20) : 'featured';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);

  let items = await listProducts();

  if (category && category.toLowerCase() !== 'all') {
    items = items.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }
  if (q) {
    items = items.filter(p =>
      `${p.name} ${p.category} ${p.desc}`.toLowerCase().includes(q)
    );
  }

  const total = items.length;
  items.sort(SORTS[sort]);

  res.json({
    ok: true,
    total,
    count: Math.min(total, limit),
    categories: await listCategories(),
    products: items.slice(0, limit)
  });
});

productsRouter.get('/categories', async (_req, res) => {
  res.json({ ok: true, categories: await listCategories() });
});

/** Re-prices a basket so the storefront can show live totals before checkout. */
productsRouter.post('/quote', async (req, res) => {
  const quote = await priceBasket(req.body?.items, req.body?.paymentMethod ?? 'upi');
  res.json({ ok: true, quote });
});

productsRouter.get('/:idOrSlug', async (req, res) => {
  const key = str(req.params.idOrSlug, 120);
  const product = /^\d+$/.test(key) ? await getProduct(Number(key)) : await getProductBySlug(key);

  if (!product || !product.active) throw notFound('That product could not be found.');
  res.json({ ok: true, product });
});
