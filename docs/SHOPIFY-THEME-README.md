# PHBL Naturals: Shopify theme

Custom Online Store 2.0 theme for **phblnaturals.com**, built on **Dawn 16.0.0** (MIT, see `LICENSE.md`).
Dawn's accessibility, performance, predictive search, facets and cart drawer are kept. PHBL adds its own
design system and D2C sections on top of it.

- Store setup, apps, checkout, discounts, WhatsApp, tracking, compliance and QA: [`docs/STORE-SETUP.md`](docs/STORE-SETUP.md)
- Metafield, metaobject and collection setup: [`scripts/setup-store-data.mjs`](scripts/setup-store-data.mjs)
- Sample catalogue CSV (replace with the real 12 products): [`data/products-sample.csv`](data/products-sample.csv)

## Local development

```bash
npm i -g @shopify/cli
shopify theme dev --store phbl-naturals.myshopify.com
shopify theme check
```

GitHub: connect this repo in **Online Store > Themes > Add theme > Connect from GitHub**.
`main` is the live theme. `dev` is a second connected theme used for previews. Merge `dev` into `main` to ship.

## What's PHBL-specific

Everything PHBL adds is prefixed `phbl`, so upstream Dawn updates can be merged with few conflicts.

| Area | Files |
|---|---|
| Design tokens (colours, radius from Theme settings) | `snippets/phbl-tokens.liquid`, `assets/phbl.css` |
| JS (copy code, tabs, quick add, sticky ATC, Buy now, load more, recently viewed, pincode, hero autoplay, complementary upsell) | `assets/phbl.js` (one deferred file, about 8 KB) |
| Theme settings groups `PHBL: Brand / Commerce / Contact & WhatsApp / Marketplaces / Trust badges` | `config/settings_schema.json` |
| Announcement bar (rotating, click-to-copy codes, CSS-only) | `sections/phbl-announcement.liquid` |
| Mobile bottom nav, floating WhatsApp | `snippets/phbl-bottom-nav.liquid`, `snippets/phbl-whatsapp.liquid` |
| Product card, used on home, collection, search, recommendations and blog | `snippets/phbl-card.liquid` |
| Cart drawer: free delivery and gift progress, savings, upsell | `snippets/phbl-cart-progress.liquid`, `phbl-cart-savings.liquid`, `phbl-cart-upsell.liquid`, `sections/phbl-upsell-recs.liquid` |
| Home sections | `phbl-hero`, `phbl-category-icons`, `phbl-product-tabs`, `phbl-promo-grid`, `phbl-metaobject-tiles`, `phbl-reels`, `phbl-trust`, `phbl-heritage`, `phbl-testimonials`, `phbl-featured-in`, `phbl-seo-text` (Instagram uses the Dawn `apps` section) |
| PDP blocks inside Dawn `main-product` | `snippets/phbl-product-block.liquid`: tagline, tax note + best price, offers, pincode, Buy now, benefit icons, info accordions (incl. legal) |
| PDP sections | `phbl-fbt`, `phbl-combo-items`, `phbl-recently-viewed`, Dawn `related-products`, `apps` for reviews |
| Pages | `page.about.json` (+ `phbl-timeline`), `page.faq.json` (`phbl-faq` + FAQPage schema), `page.grievance.json`, `page.track-order.json`, `page.contact.json` (+ `phbl-contact-info`) |
| Blog | `phbl-article-products` (article metafield `custom.products`) |
| Footer | `phbl-footer-extras`: help & legal menu, marketplaces, contact, GSTIN, trust badges |
| JSON-LD | Organization (home), Product + aggregateRating + BreadcrumbList (PDP), FAQPage, Article (Dawn) |
| Strings | `locales/en.default.json` under `phbl.*`, ready for Translate & Adapt (Bengali) |

Dawn files changed (search for `phbl` to see each change): `layout/theme.liquid`, `snippets/cart-drawer.liquid`,
`snippets/header-mega-menu.liquid`, `sections/header.liquid` (menu-images toggle), `sections/main-product.liquid`
(PHBL blocks, sticky ATC, JSON-LD), `sections/main-collection-product-grid.liquid` (Load more), and the card render
in `featured-collection`, `main-search` and `related-products`.

## How to…

**Add a product.** Admin > Products. Fill in the `custom.*` metafields (tagline, suitable for, benefits, ingredients,
how to use, full ingredients, FAQs, badge, legal). Add **tags** so the product sorts into collections automatically:

| Tag | Collection |
|---|---|
| `bestseller` | Bestsellers |
| `new-launch` | New Launches |
| `combo` | Combos (also assign template **product.combo**) |
| `offer` | Offers (bottom-nav "Offers") |
| `cat-face` / `cat-hair` / `cat-body` / `cat-lip` | Categories |
| `concern-<name>` | Concern collections |
| `ing-<name>` | Ingredient collections |
| `ayush` | Shows the AYUSH disclaimer in the legal accordion |

Size variants must use an option named **Size**. The product card then shows size chips.
Ratings appear on their own once Judge.me syncs the `reviews.rating` metafields.

**Add a category, concern or ingredient.** Create an automated collection (condition: tag = `cat-x`, `concern-x` or `ing-x`).
For concerns and ingredients, also add an entry in Admin > Content > Metaobjects and link its collection. The home tiles and
PDP ingredient accordion pick it up with no code change.

**Add a combo.** Create it in the **Shopify Bundles** app (this links inventory), tag it `combo`, set template `product.combo`,
and fill `custom.combo_items` so "What's inside" and "You save ₹X" render.

**Change banners and offers.** Theme editor > Home > *PHBL Hero slideshow* (desktop 2880×900 + mobile 1080×1350) and
*PHBL Promo banners*. Offer messages: *PHBL Announcement bar* blocks (header). Product-page offers: *PHBL: Available offers*
block. Thresholds, prepaid % and WhatsApp number: Theme settings > PHBL groups.

**Menus.** Create `main-menu` with Categories / Shop by Concern / Shop by Ingredient / Bestsellers / New Launches / Combos /
Blog, each with collection sub-links. The mega menu shows each linked collection's image. Create `footer-help` for the
footer help & legal list.

## Performance notes

- One extra CSS file (`phbl.css`, render-blocking but small) and one deferred JS file. No jQuery, no frameworks.
- Hero: first slide `loading=eager fetchpriority=high`, separate `<source>` art for desktop and mobile. Everything else is lazy.
- Carousels use native CSS scroll-snap (no slider library). The announcement bar rotates with CSS only.
- Reels use `preload="none"` and play only while on screen.
- Apps must use app blocks and embeds only. Never paste scripts into theme files.
