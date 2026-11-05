# PHBL Naturals — standalone website

A normal website, not a Shopify theme: plain HTML, CSS and vanilla JavaScript, with a small
Node server for orders and Razorpay payments. It runs on any host that can run Node, and the
front end alone works on any static host.

```
web/      the website (HTML, CSS, JS, data)
server/   order + payment API, and it also serves web/
```

## Run it

```bash
cd server && npm install && npm start
```

Then open <http://localhost:3000>. The site must be served over `http://`, not opened as a
file, because it loads its catalogue from `web/data/*.json`.

## Everything is driven by two files

No code changes are needed for day-to-day work:

| File | Controls |
|---|---|
| `web/data/site.json` | Brand, logo, contact details, GSTIN, grievance officer, delivery and gift thresholds, prepaid discount, coupons, trust badges, categories, concerns, ingredients, testimonials, FAQs, homepage story and SEO text |
| `web/data/products.json` | Every product: title, type, category, concerns, ingredients, badge, tagline, description, benefits, how to use, full ingredient list, net quantity, FAQs, related products, combo contents, and the variants with SKU, price, MRP, weight and stock |

Save either file and the running server picks it up within two seconds. No restart, no build.

### Add a product

Copy an existing block in `products.json` and change the fields. The `handle` must be unique
and becomes its URL (`/product.html?p=your-handle`).

```jsonc
{
  "handle": "rose-face-mist",
  "title": "Rose Face Mist",
  "type": "Face Mist",
  "category": "face-care",          // must match a handle in site.json > categories
  "badge": "NEW",                   // BESTSELLER | NEW | TRENDING | TOP PICK | ""
  "tagline": "Refreshes and hydrates through the day",
  "suitableFor": "All Skin Types",
  "concerns": ["dryness"],          // handles from site.json > concerns
  "ingredients": ["aloe-vera"],     // handles from site.json > ingredients
  "tags": ["new-launch"],           // bestseller | new-launch | combo | offer
  "images": ["rose-face-mist-1.jpg"],
  "variants": [
    { "size": "100 ml", "sku": "PHBL-FM-RS-100", "price": 299, "mrp": 349, "grams": 120, "stock": 40 }
  ]
}
```

Prices are whole rupees. `stock` is enforced by the server, so an order can never exceed it.

### Add product photos

Put the files in `web/assets/img/products/` and list the filenames in that product's
`images` array. Square images, 1000×1000 or larger. Until you add them the site draws a
branded placeholder and makes no image request at all, so nothing looks broken.

### Add the logo

Either drop the file in as `web/assets/img/logo.png`, or run the installer from the `server`
folder, which copies it and updates `site.json` for you:

```bash
npm run logo -- ~/Downloads/phbl-logo.png
npm run logo -- ~/Downloads/phbl-logo.png --height 64          # bigger in the header
npm run logo -- ~/Downloads/logo.png --footer ~/Downloads/logo-white.png
```

PNG with a transparent background or SVG, around 600px wide. Reload the page; no restart
needed.

The dark green footer needs a light version of a dark logo. If you do not supply one with
`--footer`, the colour logo is shown on a white rounded chip so it stays readable.

If the file is missing the header falls back to the `PHBL NATURALS` text mark, so the site
never breaks.

### Change prices, offers or thresholds

All in `site.json > commerce` and `site.json > coupons`. The free-delivery bar in the cart,
the "Get at ₹X" prepaid price on every card, and the checkout maths all read the same values,
so they can never disagree.

### Edit the pages

Policy and story pages are ordinary HTML in `web/` and `web/pages/`. The bracketed
`[placeholders]` need your real details before launch.

## After editing CSS or JS

Bump the version in the asset links so visitors' browsers fetch the new file:

```bash
cd web && grep -rl '?v=1.0.2' . | xargs sed -i '' 's/?v=1.0.2/?v=1.0.3/g'
```

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Home: hero, categories, bestsellers, promos, concerns, new launches, combos, ingredients, reels, trust, story, testimonials, SEO text |
| `shop.html` | Catalogue with filters (category, concern, ingredient, collection, price), sort and search. Filters are shareable URLs |
| `product.html?p=handle` | Gallery, variants, offers, pincode check, benefits, accordions, combo contents, frequently bought together, related, recently viewed, sticky add-to-cart |
| `cart.html` | Full cart |
| `checkout.html` | Address, coupon, prepaid or COD, Razorpay payment |
| `order-confirmation.html` | Receipt after ordering |
| `track-order.html` | Order lookup by order number + phone |
| `about.html`, `faq.html`, `contact.html` | Story, FAQs (with FAQ schema), contact form |
| `pages/*.html` | Shipping, returns, privacy, terms, grievance officer |
| `admin.html` | Order dashboard. Not linked from the site and blocked in robots.txt |

## What is built in

- Cart in `localStorage`, cart drawer, free-delivery and free-gift progress, savings total, upsells
- Wishlist, recently viewed, predictive search
- Mobile bottom nav, floating WhatsApp button, mobile filter drawer, sticky add-to-cart
- Coupons, prepaid discount, COD, stock limits, India phone and pincode validation
- SEO: per-page titles and descriptions, canonical URLs, Open Graph, `sitemap.xml`, `robots.txt`,
  and JSON-LD for Organization, Product (with offers and ratings), BreadcrumbList and FAQPage
- Accessibility: skip link, keyboard-operable drawers and tabs, visible focus, ARIA labels,
  `prefers-reduced-motion` support

## Compliance

Because the parent company is a homeopathic lab, product copy stays **cosmetic**: cleanse,
nourish, moisturise, "reduces the appearance of". No cure, treat or disease claims. Every
product page shows net quantity, MRP inclusive of taxes, manufacturer and marketer, country
of origin, customer care and GSTIN, and the footer links the Grievance Officer page.
