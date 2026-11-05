# PHBL Naturals

The website for PHBL Naturals, the natural personal-care brand of Purusottam Homeo Bikash Lab
(Bonded), West Bengal.

## The website (current)

A normal website: plain HTML, CSS and vanilla JavaScript, with a small Node server for orders
and Razorpay payments. No Shopify, no subscription, no platform fees.

```bash
cd server && npm install && npm start     # then open http://localhost:3000
```

- [`web/README.md`](web/README.md) — how to add products, photos, prices, offers and pages
- [`server/README.md`](server/README.md) — payments, environment variables, hosting, going live

```
web/      the website: HTML pages, CSS, JS, and the catalogue in web/data/*.json
server/   order + payment API, which also serves web/
```

## The Shopify theme (previous)

The earlier Shopify (Dawn-based) theme is still in this repo: `assets/`, `config/`, `layout/`,
`locales/`, `sections/`, `snippets/`, `templates/`, `scripts/` and `data/`, documented in
[`docs/SHOPIFY-THEME-README.md`](docs/SHOPIFY-THEME-README.md). It is unused by the standalone
site and can be deleted once you are sure you are not going back to Shopify.
