# PHBL Naturals: store setup, apps and launch runbook

Placeholders in `[brackets]` need your input. Work through the sections in order.

## 1. Store basics
- [ ] Plan: Basic or higher. Store currency **INR**. Store address = registered address (West Bengal). Timezone **IST**.
- [ ] Domain: connect `phblnaturals.com` + `www`, set it as primary, and check SSL is active.
- [ ] Markets: primary market **India**. Turn off other markets until you ship internationally.
- [ ] Taxes: India, **prices include tax**, enter the GSTIN, set up the HSN-based GST rates your CA confirms (cosmetics are usually 18%).
- [ ] Shipping zones: India. Free delivery rule = order ≥ ₹`free_shipping_threshold` (keep it identical to the theme setting). Flat rate below that.
- [ ] Policies (Settings > Policies): Refund, Privacy (DPDP Act 2023: purpose, retention, consent withdrawal, Grievance/DPO contact), Terms, Shipping, Contact.
- [ ] Customer accounts: Settings > Customer accounts > **New customer accounts** (email one-time code). Phone OTP comes from the checkout app.
- [ ] Cookie banner: Settings > Customer privacy > turn on the **Shopify cookie banner** (uses the Customer Privacy API, so no theme code is needed).
- [ ] Pages: create `about` (template page.about), `faq` (page.faq), `contact` (page.contact), `track-order` (page.track-order), `grievance-officer` (page.grievance).
- [ ] Menus: `main-menu` (mega menu) and `footer-help` (About, FAQ, Blog, Contact, Track Order, Returns, Shipping, Privacy, Terms, Grievance Officer).
- [ ] Theme settings > PHBL groups: colours, thresholds, prepaid %, WhatsApp, care phone and email, GSTIN, address, Grievance Officer, marketplace links, trust badges (**only claims you can prove**).

## 2. Data model
1. Run `node scripts/setup-store-data.mjs` (see the file header for the token scopes). It creates:
   - metaobjects `benefit`, `faq`, `concern`, `ingredient`, `testimonial` (storefront-readable)
   - product metafields `custom.*` (listed in the spec, plus `combo_items`) and article metafield `custom.products`
   - automated tag-based collections (Bestsellers, New Launches, Combos, Offers, categories, concerns, ingredients)
2. Publish the new collections to the Online Store channel. Create **All** if it's missing (Dawn uses `/collections/all`).
3. Add metaobject entries: 5–8 concerns, 8–12 ingredients, benefits, FAQs, testimonials (real customers, with consent).
4. Import products: fill in `data/products-sample.csv` (rows start with `SAMPLE`, status `draft`), then Admin > Products > Import.
   The metafield columns only import after step 1 has run. Reference-type metafields (benefits, ingredients, FAQs, FBT)
   have to be set in the product editor or through the API after import.
5. **Search & Discovery app**: Filters = Availability, Price, Product type, `custom.concerns`, `custom.key_ingredients`,
   `custom.suitable_for`. Product recommendations: add *related* and *complementary* products for every SKU.
   Complementary products feed the cart-drawer upsell and Dawn's "Pairs well with" block.

### Launch catalogue (fill in)
For each product: title | product type | concerns | key ingredients | variants (size, SKU, MRP = compare-at, sale price, weight) |
suitable for | 3 key benefits | how to use | full INCI ingredient list | badge | tags.

| # | Product | Notes |
|---|---|---|
| 1–12 | [your products] | Replace the SAMPLE rows in the CSV |
| C1–C3 | Combos | Build them in **Shopify Bundles**, tag `combo`, template `product.combo`, set `custom.combo_items` |

## 3. Apps (keep the list lean, blocks and embeds only)

| Need | Recommendation | Why / notes |
|---|---|---|
| Filters & recommendations | **Shopify Search & Discovery** | Free, native, no storefront JS |
| 1-click checkout, COD, prepaid discount | **GoKwik** (alt: Shopflo, Razorpay Magic Checkout) | Phone OTP, address prefill, UPI-first, COD RTO risk scoring. Set the prepaid discount to [5]%, the same value as the theme setting `prepaid_discount_percent`. Optional COD fee. Show the coupon list. Theme **Buy now** sends people to `/checkout`, which the app intercepts. |
| Payment gateway | **Razorpay** + COD | UPI, cards, netbanking, wallets. Turn off the wallets you don't use. |
| Shipping, pincode check, tracking | **Shiprocket** | Add its pincode app block on the PDP and remove the PHBL fallback block. Put its tracking block on `/pages/track-order`. |
| Reviews | **Judge.me** | Put the reviews widget app block in the PDP "Apps" section. Turn on rating metafield sync so cards and JSON-LD show ratings. |
| WhatsApp | **AiSensy** (alt: Interakt, WATI) | Flows below |
| Bundles | **Shopify Bundles** | Inventory-linked combos |
| Free gift | **BOGOS** | Auto add/remove the gift at ₹`free_gift_threshold`. Use the same number as the cart progress bar. |
| Back in stock | [shortlist: Appikon Notify Me!, Klaviyo if adopted] | Must hook the "Notify me" button (`[data-notify-me]`) or add its own PDP block |
| Wishlist | [shortlist: Swym Wishlist Plus] | Optional at launch. Skip it if speed suffers. |
| GST invoices | [shortlist an India GST invoice app, confirm HSN + GSTIN fields with your CA] | |
| Instagram feed | [shortlist: Instafeed] | Add it as an app block in the Home "Apps" section |
| Translation (later) | **Translate & Adapt** | All theme strings live in `locales/en.default.json`, so add Bengali here |

After each install, run Lighthouse mobile again. Remove any app that costs more than about 5 points without clear ROI.

## 4. Offers
- Native discounts: `WELCOME10` (first order, one use per customer), % and flat codes, **automatic** combo discount,
  Buy X Get Y, minimum-cart thresholds, usage limits. Put the codes customers see into the Announcement bar and the PDP "Available offers" blocks.
- Prepaid discount: set it inside the checkout app, not as a Shopify discount (avoids stacking issues).
- Keep these three numbers identical everywhere: free-delivery threshold, free-gift threshold, prepaid %.

## 5. Marketing & tracking
- [ ] **Google & YouTube** channel: GA4 + Merchant Center feed (needs GTIN/brand/MPN and correct GST-inclusive prices).
- [ ] **Facebook & Instagram** channel: Pixel + Conversions API at "Maximum" data sharing.
- [ ] Any extra tags go in Settings > Customer events > Custom pixel. **Never hard-code pixels into the theme.**
- [ ] First-visit popup: **Shopify Forms** (phone + email, first-order code). Set it to show after 8 s or 40% scroll, never on the first paint.
- [ ] WhatsApp flows (with opt-in collected at checkout):
  | Trigger | Message |
  |---|---|
  | Order placed | Confirmation + order summary |
  | COD order | "Confirm your COD order" with Yes/No buttons (cancels unconfirmed orders, cuts RTO) |
  | Shipped | Tracking link |
  | Delivered | How-to-use tips |
  | Abandoned cart | 1 h reminder, 24 h reminder + coupon |
  | 7 days after delivery | Review request (Judge.me link) |

## 6. SEO
- Unique meta title and description for every product, collection, page and article (Admin > each item > Search engine listing).
- Social sharing image: Theme settings > Social media. Clean handles, and add URL redirects whenever a handle changes.
- Schema: Organization (home), Product + AggregateRating + Offers + BreadcrumbList (PDP), FAQPage (FAQ page), Article (blog).
  Check with Google's Rich Results Test.
- Write the home *PHBL SEO text* block (200–400 words, cosmetic claims only). Collection pages have an optional SEO block too.

## 7. Compliance checklist (homeopathic-lab parent)
- [ ] All copy uses **cosmetic** claims only: cleanse, nourish, moisturise, "reduces the appearance of". No cure/treat/heal/disease
  words (Drugs & Magic Remedies (Objectionable Advertisements) Act; Cosmetics Rules 2020). The sample CSV copy follows this rule.
- [ ] If any SKU is an **AYUSH/homeopathic medicine**: tag it `ayush`, fill `custom.licence_no`, keep promotional
  drug claims out, and have regulatory/legal sign off before listing it.
- [ ] Every product has: MRP (compare-at price, "inclusive of all taxes" shows automatically), net quantity, manufacturer + marketer
  with address, country of origin, customer care contact (Legal Metrology (Packaged Commodities) Rules). All of these appear in the PDP legal accordion.
- [ ] Grievance Officer name, email and phone in Theme settings, shown on `/pages/grievance-officer` and linked in the footer (Consumer Protection (E-Commerce) Rules 2020).
- [ ] Trust badges: only list "Dermatologically tested", "Cruelty free" or "GMP certified" if you hold the test report or certificate.
- [ ] Have a lawyer review the privacy policy against the DPDP Act 2023.

## 8. QA before launch
- [ ] 360 px mobile (Chrome DevTools) on every template: no horizontal scroll, bottom nav and WhatsApp button don't overlap the sticky ATC or cookie banner.
- [ ] Cart drawer: add, qty ±, remove. Progress bar and savings update without a reload. Upsell adds. Bottom-nav count updates.
- [ ] Test orders: 1 prepaid (UPI) with the prepaid discount, 1 COD with the WhatsApp confirmation, 1 with a coupon, 1 over the gift threshold (gift auto-added).
- [ ] Filters and sort on a collection, Load more, predictive search with thumbnails.
- [ ] Lighthouse mobile ≥ 90 on Home, a collection and a PDP. Record LCP (< 2.5 s) and CLS (< 0.1) in `docs/lighthouse.md`.
- [ ] `shopify theme check` reports 0 errors.
- [ ] Rich Results Test passes for a PDP and the FAQ page.
