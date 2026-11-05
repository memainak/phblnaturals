/* PHBL Naturals — shared app layer: data, cart, chrome (header/footer/nav), UI helpers. */
(() => {
  'use strict';

  const BASE = (() => {
    // Works at the site root and inside /pages/
    const p = location.pathname;
    return p.includes('/pages/') ? '../' : './';
  })();

  const PHBL = (window.PHBL = {
    base: BASE,
    site: null,
    products: null,
    CART_KEY: 'phbl_cart_v1',
    WISH_KEY: 'phbl_wishlist_v1',
    RECENT_KEY: 'phbl_recent_v1',
  });

  /* ---------------- storage helpers (safe in private mode) ---------------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {
        /* quota or blocked: cart still works for this page view */
      }
    },
  };
  PHBL.store = store;

  /* ---------------- data ---------------- */
  let dataPromise = null;
  PHBL.load = function load() {
    if (!dataPromise) {
      dataPromise = Promise.all([
        fetch(BASE + 'data/site.json').then((r) => r.json()),
        fetch(BASE + 'data/products.json').then((r) => r.json()),
      ]).then(([site, products]) => {
        PHBL.site = site;
        PHBL.products = products;
        return { site, products };
      });
    }
    return dataPromise;
  };

  PHBL.byHandle = (handle) => (PHBL.products || []).find((p) => p.handle === handle);

  /* ---------------- money + pricing ---------------- */
  const money = (PHBL.money = (n) =>
    '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }));

  PHBL.percentOff = (mrp, price) => (mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);

  PHBL.prepaidPrice = (price) => {
    const pct = PHBL.site?.commerce?.prepaidDiscountPercent || 0;
    return Math.round(price - (price * pct) / 100);
  };

  /* ---------------- images ---------------- */
  // Photo filenames live in each product's "images" array in products.json, relative to
  // assets/img/products/. While that list is empty we draw a branded placeholder and make
  // no image request at all, so there are no 404s before the real photography arrives.
  PHBL.imageList = (product) =>
    (product.images || []).map((name) => (/^https?:|^\//.test(name) ? name : `${BASE}assets/img/products/${name}`));

  PHBL.media = function media(product, index = 0, cls = '') {
    const src = PHBL.imageList(product)[index] || PHBL.imageList(product)[0];
    const alt = escapeHtml(product.title);
    if (!src) return `<span class="ph"><span>PHBL</span><strong>${alt}</strong></span>`;
    return `<img class="${cls}" src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
  };

  /** How many gallery slots to show on the product page. */
  PHBL.imageCount = (product) => Math.max(1, PHBL.imageList(product).length);

  /* ---------------- escaping ---------------- */
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  PHBL.escapeHtml = escapeHtml;

  /* ---------------- icons ---------------- */
  const ICONS = {
    search: '<path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.3-4.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    cart: '<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    heart: '<path d="M12 20s-7-4.6-7-9.6A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 3.4c0 5-7 9.6-7 9.6z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    leaf: '<path d="M4 20c0-8 6-14 16-15 1 10-5 16-13 16H4z"/><path d="M4 20c4-4 8-6 12-7"/>',
    flask: '<path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3"/>',
    rabbit: '<path d="M8 13a4 4 0 0 1 8 0v7H8z"/><path d="M9 9 7 3M15 9l2-6"/>',
    truck: '<path d="M2 7h11v10H2zM13 10h4l4 4v3h-8z"/><circle cx="6" cy="19" r="2"/><circle cx="17" cy="19" r="2"/>',
    drop: '<path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3z"/>',
    feather: '<path d="M20 4a6 6 0 0 0-8 0l-8 8 4 4 8-8a6 6 0 0 0 4-4zM4 20l6-6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>',
    sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    whatsapp: '<path d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Z" transform="scale(.75)"/>',
  };
  PHBL.icon = (name, cls = '') => {
    const d = ICONS[name] || ICONS.sparkle;
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  };

  /* ---------------- logo ---------------- */
  // Uses the real logo file when brand.logo points at one; falls back to the text mark so the
  // header never breaks if the image is missing. `variant: "footer"` prefers the white version.
  PHBL.logoInner = function logoInner(variant) {
    const b = PHBL.site.brand;
    const isFooter = variant === 'footer';
    const file = isFooter ? b.logoFooter || b.logo : b.logo;
    const textMark = `<span class="logo__text"><span class="logo__mark">${escapeHtml(b.logoText)}</span><span class="logo__sub">${escapeHtml(b.logoSub)}</span></span>`;
    if (!file) return textMark;
    // The supplied logo is a JPEG with a near-white background, so `multiply` blends that
    // background into the page instead of showing a grey box. On the dark footer that would
    // turn the artwork black, so there it sits on a white chip instead.
    const chip = isFooter && b.logoFooterOnChip ? ' logo__img--chip' : ' logo__img--blend';
    const img = `<img class="logo__img${chip}" src="${BASE}${file}" alt="${escapeHtml(b.logoAlt || b.name)}"
      style="--logo-h:${b.logoHeight || 44}px"
      onerror="this.insertAdjacentHTML('afterend', ${JSON.stringify(textMark).replace(/"/g, '&quot;')}); this.remove();">`;
    // brand.logoShowText keeps the wordmark beside the logo; the image then carries no alt
    // text of its own, so a screen reader does not hear the brand name twice.
    return b.logoShowText ? img.replace(/alt="[^"]*"/, 'alt=""') + textMark : img;
  };

  /* ---------------- toast ---------------- */
  PHBL.toast = function toast(message, type) {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast--err' : '');
    el.setAttribute('role', 'status');
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  };

  /* ---------------- cart ---------------- */
  const Cart = (PHBL.cart = {
    items: store.get(PHBL.CART_KEY, []),

    save() {
      store.set(PHBL.CART_KEY, this.items);
      document.dispatchEvent(new CustomEvent('cart:change'));
    },

    count() {
      return this.items.reduce((n, i) => n + i.qty, 0);
    },

    /** Resolve stored {handle, sku, qty} against products.json. */
    detailed() {
      return this.items
        .map((item) => {
          const product = PHBL.byHandle(item.handle);
          if (!product) return null;
          const variant = product.variants.find((v) => v.sku === item.sku) || product.variants[0];
          const qty = Math.max(1, Math.min(item.qty, variant.stock || 99));
          return {
            ...item,
            qty,
            product,
            variant,
            lineTotal: variant.price * qty,
            lineMrp: (variant.mrp || variant.price) * qty,
          };
        })
        .filter(Boolean);
    },

    add(handle, sku, qty = 1) {
      const product = PHBL.byHandle(handle);
      if (!product) return;
      const variant = product.variants.find((v) => v.sku === sku) || product.variants[0];
      if (!variant || variant.stock <= 0) {
        PHBL.toast('Sorry, that size is out of stock.', 'error');
        return;
      }
      const existing = this.items.find((i) => i.sku === variant.sku);
      const nextQty = (existing ? existing.qty : 0) + qty;
      if (nextQty > variant.stock) {
        PHBL.toast(`Only ${variant.stock} left in stock.`, 'error');
        return;
      }
      if (existing) existing.qty = nextQty;
      else this.items.push({ handle, sku: variant.sku, qty });
      this.save();
      PHBL.toast(`${product.title} added to cart`);
      PHBL.openCart();
    },

    setQty(sku, qty) {
      const item = this.items.find((i) => i.sku === sku);
      if (!item) return;
      if (qty <= 0) return this.remove(sku);
      const product = PHBL.byHandle(item.handle);
      const variant = product?.variants.find((v) => v.sku === sku);
      if (variant && qty > variant.stock) {
        PHBL.toast(`Only ${variant.stock} left in stock.`, 'error');
        return;
      }
      item.qty = qty;
      this.save();
    },

    remove(sku) {
      this.items = this.items.filter((i) => i.sku !== sku);
      this.save();
    },

    clear() {
      this.items = [];
      this.save();
    },

    /** Single source of truth for pricing. The server recomputes the same way. */
    totals(opts = {}) {
      const c = PHBL.site.commerce;
      const lines = this.detailed();
      const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
      const mrpTotal = lines.reduce((n, l) => n + l.lineMrp, 0);
      let discount = 0;
      let couponLabel = '';

      const coupon = opts.coupon ? PHBL.findCoupon(opts.coupon) : null;
      if (coupon && subtotal >= (coupon.minCart || 0)) {
        const base = coupon.appliesToTag
          ? lines.filter((l) => (l.product.tags || []).includes(coupon.appliesToTag)).reduce((n, l) => n + l.lineTotal, 0)
          : subtotal;
        discount = coupon.type === 'percent' ? Math.round((base * coupon.value) / 100) : Math.min(coupon.value, base);
        couponLabel = coupon.code;
      }

      const afterDiscount = Math.max(0, subtotal - discount);
      const prepaid = opts.payment === 'prepaid' && afterDiscount > 0
        ? Math.round((afterDiscount * c.prepaidDiscountPercent) / 100)
        : 0;
      const shipping = afterDiscount >= c.freeShippingThreshold || afterDiscount === 0 ? 0 : c.shippingFee;
      const codFee = opts.payment === 'cod' ? c.codFee || 0 : 0;
      const total = Math.max(0, afterDiscount - prepaid + shipping + codFee);

      return {
        lines, subtotal, mrpTotal, discount, couponLabel, prepaid, shipping, codFee, total,
        mrpSavings: Math.max(0, mrpTotal - subtotal),
        totalSavings: Math.max(0, mrpTotal - subtotal) + discount + prepaid,
        freeGift: afterDiscount >= c.freeGiftThreshold,
      };
    },
  });

  PHBL.findCoupon = (code) =>
    (PHBL.site?.coupons || []).find((c) => c.code.toUpperCase() === String(code || '').trim().toUpperCase());

  /* ---------------- wishlist ---------------- */
  PHBL.wishlist = {
    all: () => store.get(PHBL.WISH_KEY, []),
    has: (handle) => PHBL.wishlist.all().includes(handle),
    toggle(handle) {
      const list = PHBL.wishlist.all();
      const next = list.includes(handle) ? list.filter((h) => h !== handle) : [...list, handle];
      store.set(PHBL.WISH_KEY, next);
      document.dispatchEvent(new CustomEvent('wishlist:change'));
      return next.includes(handle);
    },
  };

  /* ---------------- recently viewed ---------------- */
  PHBL.recordRecent = (handle) => {
    const list = store.get(PHBL.RECENT_KEY, []).filter((h) => h !== handle);
    store.set(PHBL.RECENT_KEY, [handle, ...list].slice(0, 12));
  };
  PHBL.recentlyViewed = (exclude) =>
    store.get(PHBL.RECENT_KEY, []).filter((h) => h !== exclude).map(PHBL.byHandle).filter(Boolean);

  /* ---------------- product card ---------------- */
  PHBL.card = function card(product) {
    const v = product.variants[0];
    const off = PHBL.percentOff(v.mrp, v.price);
    const inStock = product.variants.some((x) => x.stock > 0);
    const c = PHBL.site.commerce;
    const sizes = product.variants.length > 1
      ? `<div class="card__sizes" role="group" aria-label="Size">${product.variants
          .map(
            (x, i) =>
              `<button type="button" class="chip" data-card-size="${x.sku}" aria-pressed="${i === 0}" ${
                x.stock <= 0 ? 'disabled' : ''
              }>${escapeHtml(x.size)}</button>`
          )
          .join('')}</div>`
      : '';

    return `
    <article class="card" data-handle="${product.handle}">
      <a class="card__media" href="${BASE}product.html?p=${product.handle}" tabindex="-1" aria-hidden="true">
        ${product.badge ? `<span class="card__badge badge badge--${product.badge.toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(product.badge)}</span>` : ''}
        ${!inStock ? '<span class="card__badge badge badge--sold-out">Sold out</span>' : ''}
        ${PHBL.media(product, 0)}
      </a>
      <button class="card__wish" type="button" data-wish="${product.handle}"
        aria-pressed="${PHBL.wishlist.has(product.handle)}" aria-label="Save ${escapeHtml(product.title)}">
        ${PHBL.icon('heart')}
      </button>
      <div class="card__body">
        ${product.suitableFor ? `<span class="card__suitable">${escapeHtml(product.suitableFor)}</span>` : ''}
        <h3 class="card__title"><a href="${BASE}product.html?p=${product.handle}">${escapeHtml(product.title)}</a></h3>
        ${product.tagline ? `<p class="card__tagline">${escapeHtml(product.tagline)}</p>` : ''}
        ${product.rating ? `<p class="rating"><span class="rating__star">★</span><strong>${product.rating}</strong>${product.reviewCount ? `<span class="muted">(${product.reviewCount})</span>` : ''}</p>` : ''}
        ${sizes}
        <div class="card__foot">
          <div class="price">
            <span class="price__now">${money(v.price)}</span>
            ${off ? `<s class="price__mrp">${money(v.mrp)}</s><span class="price__off">${off}% off</span>` : ''}
          </div>
          ${c.showGetAtPrice && c.prepaidDiscountPercent ? `<span class="get-at">Get at ${money(PHBL.prepaidPrice(v.price))} on prepaid</span>` : ''}
          ${
            inStock
              ? `<button class="btn btn--sm btn--block" type="button" data-add="${product.handle}" data-sku="${v.sku}">Add to cart</button>`
              : `<a class="btn btn--sm btn--outline btn--block" href="${BASE}contact.html?notify=${product.handle}">Notify me</a>`
          }
        </div>
      </div>
    </article>`;
  };

  PHBL.renderCards = (el, products) => {
    if (!el) return;
    el.innerHTML = products.length
      ? products.map(PHBL.card).join('')
      : '<p class="muted">No products match these filters yet.</p>';
  };

  /* ---------------- chrome: header, nav, footer ---------------- */
  function renderChrome() {
    const s = PHBL.site;
    const path = location.pathname.split('/').pop() || 'index.html';
    const cur = (file) => (path === file ? 'aria-current="page"' : '');
    const waHref = `https://wa.me/${String(s.contact.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(s.contact.whatsappMessage)}`;

    /* announcement */
    const ann = document.getElementById('announce');
    if (ann && s.offers.length) {
      ann.className = 'announce' + (s.offers.length === 1 ? ' announce--static' : '');
      ann.innerHTML = s.offers
        .map(
          (o, i) => `<p class="announce__item" style="animation-delay:${i * 4}s">
            <a href="${BASE}${String(o.link || 'shop.html').replace(/^\//, '')}">${escapeHtml(o.text)}</a>
            ${o.code ? `<button class="code-chip" type="button" data-copy="${escapeHtml(o.code)}">${escapeHtml(o.code)}</button>` : ''}
          </p>`
        )
        .join('');
      if (s.offers.length > 1) startAnnounceRotation(ann, s.offers.length);
    }

    /* header */
    const header = document.getElementById('site-header');
    if (header) {
      const catLinks = s.categories
        .filter((c) => c.handle !== 'all')
        .map(
          (c) => `<a class="mega__link" href="${BASE}shop.html?c=${c.handle}">
            <span class="mega__thumb">${PHBL.icon('leaf')}</span>
            <span class="mega__label">${escapeHtml(c.title)}</span>
          </a>`
        )
        .join('');
      const concernLinks = s.concerns
        .map(
          (c) => `<a class="mega__link" href="${BASE}shop.html?concern=${c.handle}">
            <span class="mega__thumb">${PHBL.icon('sparkle')}</span>
            <span class="mega__label">${escapeHtml(c.title)}</span>
            <span class="mega__blurb">${escapeHtml(c.blurb)}</span>
          </a>`
        )
        .join('');
      const ingLinks = s.ingredients
        .map(
          (c) => `<a class="mega__link" href="${BASE}shop.html?ing=${c.handle}">
            <span class="mega__thumb">${PHBL.icon('leaf')}</span>
            <span class="mega__label">${escapeHtml(c.title)}</span>
          </a>`
        )
        .join('');

      header.innerHTML = `
      <div class="wrap header__bar">
        <button class="icon-btn nav-toggle" type="button" id="nav-toggle" aria-label="Open menu" aria-expanded="false">${PHBL.icon('menu')}</button>
        <a class="logo" href="${BASE}index.html" aria-label="${escapeHtml(s.brand.name)} home">${PHBL.logoInner()}</a>
        <nav class="nav" aria-label="Main">
          <div class="nav__item"><button class="nav__link" aria-expanded="false">Categories ${PHBL.icon('chevron')}</button>
            <div class="mega"><div class="mega__grid">${catLinks}</div></div></div>
          <div class="nav__item"><button class="nav__link" aria-expanded="false">Shop by Concern ${PHBL.icon('chevron')}</button>
            <div class="mega"><div class="mega__grid">${concernLinks}</div></div></div>
          <div class="nav__item"><button class="nav__link" aria-expanded="false">Ingredients ${PHBL.icon('chevron')}</button>
            <div class="mega"><div class="mega__grid">${ingLinks}</div></div></div>
          <div class="nav__item"><a class="nav__link" href="${BASE}shop.html?tag=bestseller">Bestsellers</a></div>
          <div class="nav__item"><a class="nav__link" href="${BASE}shop.html?c=combos">Combos</a></div>
          <div class="nav__item"><a class="nav__link" href="${BASE}about.html">Our Story</a></div>
        </nav>
        <div class="header__actions">
          <button class="icon-btn" type="button" id="search-toggle" aria-label="Search" aria-expanded="false">${PHBL.icon('search')}</button>
          <a class="icon-btn" href="${BASE}track-order.html" aria-label="Track order">${PHBL.icon('user')}</a>
          <button class="icon-btn" type="button" id="cart-toggle" aria-label="Open cart">
            ${PHBL.icon('cart')}<span class="count-bubble" data-cart-count hidden>0</span>
          </button>
        </div>
      </div>
      <div class="wrap search-panel" id="search-panel">
        <form class="search-row" role="search" id="search-form">
          <input type="search" id="search-input" placeholder="Search products, concerns, ingredients…" aria-label="Search products" autocomplete="off">
          <button class="btn" type="submit">Search</button>
        </form>
        <div class="search-results" id="search-results"></div>
      </div>`;
    }

    /* mobile drawer */
    if (!document.querySelector('.drawer-nav')) {
      const drawer = document.createElement('nav');
      drawer.className = 'drawer-nav';
      drawer.setAttribute('aria-label', 'Mobile menu');
      drawer.innerHTML = `
        <div class="drawer-nav__head">
          <span class="logo">${PHBL.logoInner()}</span>
          <button class="icon-btn" type="button" data-close-nav aria-label="Close menu">${PHBL.icon('close')}</button>
        </div>
        <details open><summary>Categories</summary><div class="drawer-nav__sub">
          ${s.categories.map((c) => `<a href="${BASE}shop.html?c=${c.handle}">${escapeHtml(c.title)}</a>`).join('')}
        </div></details>
        <details><summary>Shop by Concern</summary><div class="drawer-nav__sub">
          ${s.concerns.map((c) => `<a href="${BASE}shop.html?concern=${c.handle}">${escapeHtml(c.title)}</a>`).join('')}
        </div></details>
        <details><summary>Shop by Ingredient</summary><div class="drawer-nav__sub">
          ${s.ingredients.map((c) => `<a href="${BASE}shop.html?ing=${c.handle}">${escapeHtml(c.title)}</a>`).join('')}
        </div></details>
        <a class="drawer-nav__flat" href="${BASE}shop.html?tag=bestseller">Bestsellers</a>
        <a class="drawer-nav__flat" href="${BASE}shop.html?tag=new-launch">New Launches</a>
        <a class="drawer-nav__flat" href="${BASE}shop.html?c=combos">Combos</a>
        <a class="drawer-nav__flat" href="${BASE}about.html">Our Story</a>
        <a class="drawer-nav__flat" href="${BASE}faq.html">FAQ</a>
        <a class="drawer-nav__flat" href="${BASE}track-order.html">Track Order</a>
        <a class="drawer-nav__flat" href="${BASE}contact.html">Contact</a>`;
      document.body.appendChild(drawer);
    }

    /* footer */
    const footer = document.getElementById('site-footer');
    if (footer) {
      const mk = s.marketplaces;
      footer.className = 'footer';
      footer.innerHTML = `
      <div class="wrap footer__grid">
        <div>
          <span class="logo">${PHBL.logoInner('footer')}</span>
          <p style="margin-top:12px;font-size:14px">${escapeHtml(s.brand.tagline)}</p>
          <p style="font-size:13px;opacity:.8">${escapeHtml(s.brand.parent)}</p>
          <form class="newsletter" id="newsletter-form">
            <input type="email" name="email" placeholder="Your email" aria-label="Email for newsletter" required>
            <button class="btn btn--accent btn--sm" type="submit">Join</button>
          </form>
        </div>
        <div>
          <h3>Shop</h3>
          <ul>
            ${s.categories.map((c) => `<li><a href="${BASE}shop.html?c=${c.handle}">${escapeHtml(c.title)}</a></li>`).join('')}
            <li><a href="${BASE}shop.html?tag=bestseller">Bestsellers</a></li>
          </ul>
        </div>
        <div>
          <h3>Help</h3>
          <ul>
            <li><a href="${BASE}about.html">About us</a></li>
            <li><a href="${BASE}faq.html">FAQ</a></li>
            <li><a href="${BASE}contact.html">Contact</a></li>
            <li><a href="${BASE}track-order.html">Track order</a></li>
            <li><a href="${BASE}pages/shipping.html">Shipping</a></li>
            <li><a href="${BASE}pages/returns.html">Returns & refunds</a></li>
            <li><a href="${BASE}pages/privacy.html">Privacy policy</a></li>
            <li><a href="${BASE}pages/terms.html">Terms</a></li>
            <li><a href="${BASE}pages/grievance.html">Grievance officer</a></li>
          </ul>
        </div>
        <div>
          <h3>Customer care</h3>
          <ul>
            <li><a href="${waHref}" target="_blank" rel="noopener">WhatsApp us</a></li>
            <li><a href="tel:${escapeHtml(s.contact.phone).replace(/\s/g, '')}">${escapeHtml(s.contact.phone)}</a></li>
            <li><a href="mailto:${escapeHtml(s.contact.email)}">${escapeHtml(s.contact.email)}</a></li>
            <li style="opacity:.8">${escapeHtml(s.contact.hours)}</li>
          </ul>
          ${
            mk.amazon || mk.flipkart || mk.nykaa
              ? `<h3 style="margin-top:16px">Also available on</h3><div class="market-pills">
                ${mk.amazon ? `<a href="${escapeHtml(mk.amazon)}" target="_blank" rel="noopener">Amazon</a>` : ''}
                ${mk.flipkart ? `<a href="${escapeHtml(mk.flipkart)}" target="_blank" rel="noopener">Flipkart</a>` : ''}
                ${mk.nykaa ? `<a href="${escapeHtml(mk.nykaa)}" target="_blank" rel="noopener">Nykaa</a>` : ''}
              </div>`
              : ''
          }
        </div>
      </div>
      <div class="wrap footer__bottom">
        <div>
          <div>© ${new Date().getFullYear()} ${escapeHtml(s.brand.legalName || s.brand.name)}. All rights reserved.</div>
          <div style="opacity:.75;white-space:pre-line;margin-top:4px">${escapeHtml(s.contact.address)}</div>
          <div style="opacity:.75">GSTIN: ${escapeHtml(s.contact.gstin)}</div>
        </div>
        <div class="pay-icons" aria-label="Payment methods">
          <span>UPI</span><span>Visa</span><span>Mastercard</span><span>RuPay</span><span>Net banking</span><span>COD</span>
        </div>
      </div>`;
    }

    /* bottom nav + whatsapp float */
    if (!document.querySelector('.bottom-nav')) {
      const nav = document.createElement('nav');
      nav.className = 'bottom-nav';
      nav.setAttribute('aria-label', 'Quick navigation');
      nav.innerHTML = `
        <a href="${BASE}index.html" ${cur('index.html')}>${PHBL.icon('home')}Home</a>
        <a href="${BASE}shop.html" ${cur('shop.html')}>${PHBL.icon('grid')}Shop</a>
        <a href="${BASE}shop.html?c=combos">${PHBL.icon('tag')}Offers</a>
        <a href="${BASE}track-order.html" ${cur('track-order.html')}>${PHBL.icon('user')}Orders</a>
        <button type="button" id="cart-toggle-mobile">${PHBL.icon('cart')}<span class="count-bubble" data-cart-count hidden>0</span>Cart</button>`;
      document.body.appendChild(nav);
    }
    if (!document.querySelector('.wa-float')) {
      const wa = document.createElement('a');
      wa.className = 'wa-float';
      wa.href = waHref;
      wa.target = '_blank';
      wa.rel = 'noopener';
      wa.setAttribute('aria-label', 'Chat with us on WhatsApp');
      wa.innerHTML = `<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7Zm5.9-8c-.3-.2-1.9-1-2.2-1-.3-.1-.5-.2-.7.1l-1 1.3c-.2.2-.4.3-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.2 1.4 3.5c.2.2 2.4 3.6 5.8 5 2.1.9 3 1 4 .8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5l-.6-.3Z"/></svg>`;
      document.body.appendChild(wa);
    }

    /* cart drawer shell */
    if (!document.querySelector('.cart-drawer')) {
      const drawer = document.createElement('aside');
      drawer.className = 'cart-drawer';
      drawer.id = 'cart-drawer';
      drawer.setAttribute('aria-label', 'Cart');
      drawer.setAttribute('aria-hidden', 'true');
      drawer.innerHTML = `
        <div class="cart-drawer__head">
          <h2>Your cart</h2>
          <button class="icon-btn" type="button" data-close-cart aria-label="Close cart">${PHBL.icon('close')}</button>
        </div>
        <div class="cart-drawer__body" id="cart-drawer-body"></div>
        <div class="cart-drawer__foot" id="cart-drawer-foot"></div>`;
      document.body.appendChild(drawer);
    }
    if (!document.querySelector('.overlay')) {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.id = 'overlay';
      document.body.appendChild(ov);
    }
  }

  function startAnnounceRotation(el, count) {
    const items = [...el.querySelectorAll('.announce__item')];
    let i = 0;
    items[0].style.opacity = 1;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setInterval(() => {
      items[i].style.opacity = 0;
      i = (i + 1) % count;
      items[i].style.opacity = 1;
    }, 4000);
  }

  /* ---------------- drawers ---------------- */
  function setOpen(el, open) {
    el.classList.toggle('is-open', open);
    document.getElementById('overlay').classList.toggle('is-open', open);
    document.body.classList.toggle('no-scroll', open);
    el.setAttribute('aria-hidden', String(!open));
  }
  PHBL.openCart = () => {
    renderCartDrawer();
    setOpen(document.getElementById('cart-drawer'), true);
  };
  PHBL.closeAll = () => {
    document.querySelectorAll('.cart-drawer, .drawer-nav, .filters-panel').forEach((el) => el.classList.remove('is-open'));
    document.getElementById('overlay')?.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
  };

  /* ---------------- cart drawer render ---------------- */
  function renderCartDrawer() {
    const body = document.getElementById('cart-drawer-body');
    const foot = document.getElementById('cart-drawer-foot');
    if (!body) return;
    const t = Cart.totals();
    const c = PHBL.site.commerce;

    if (!t.lines.length) {
      body.innerHTML = `<div class="empty-state">${PHBL.icon('cart')}<p>Your cart is empty.</p>
        <a class="btn btn--outline" href="${BASE}shop.html">Start shopping</a></div>`;
      foot.innerHTML = '';
      return;
    }

    /* free delivery / gift progress */
    const target = Math.max(c.freeShippingThreshold, c.freeGiftThreshold);
    const pct = Math.min(100, Math.round((t.subtotal / target) * 100));
    let msg;
    if (t.subtotal < c.freeShippingThreshold) {
      msg = `Add <strong>${money(c.freeShippingThreshold - t.subtotal)}</strong> more for <strong>FREE delivery</strong>`;
    } else if (t.subtotal < c.freeGiftThreshold) {
      msg = `Free delivery unlocked. Add <strong>${money(c.freeGiftThreshold - t.subtotal)}</strong> more for a <strong>${escapeHtml(c.freeGiftLabel)}</strong>`;
    } else {
      msg = `You've unlocked <strong>FREE delivery</strong> + <strong>${escapeHtml(c.freeGiftLabel)}</strong> 🎉`;
    }

    /* upsell: frequently-bought-together of cart items, then anything else */
    const inCart = new Set(t.lines.map((l) => l.handle));
    const upsell = [];
    t.lines.forEach((l) => {
      (l.product.frequentlyBoughtTogether || []).forEach((h) => {
        const p = PHBL.byHandle(h);
        if (p && !inCart.has(h) && !upsell.find((u) => u.handle === h) && p.variants.some((v) => v.stock > 0)) upsell.push(p);
      });
    });

    body.innerHTML = `
      <div class="progress" role="status"><div>${msg}</div>
        <div class="progress__bar" aria-hidden="true">
          <div class="progress__fill" style="width:${pct}%"></div>
          <span class="progress__mark ${t.subtotal >= c.freeShippingThreshold ? 'is-done' : ''}" style="left:${Math.round((c.freeShippingThreshold / target) * 100)}%"></span>
          <span class="progress__mark ${t.subtotal >= target ? 'is-done' : ''}" style="left:100%"></span>
        </div>
      </div>
      ${t.lines
        .map(
          (l) => `<div class="line-item">
            <a class="line-item__media" href="${BASE}product.html?p=${l.handle}">${PHBL.media(l.product, 0)}</a>
            <div>
              <p class="line-item__title"><a href="${BASE}product.html?p=${l.handle}">${escapeHtml(l.product.title)}</a></p>
              <p class="muted" style="margin:0">${escapeHtml(l.variant.size)}</p>
              <div class="line-item__row">
                <div class="qty">
                  <button type="button" data-qty="${l.sku}" data-delta="-1" aria-label="Decrease quantity">−</button>
                  <span>${l.qty}</span>
                  <button type="button" data-qty="${l.sku}" data-delta="1" aria-label="Increase quantity">+</button>
                </div>
                <div><strong>${money(l.lineTotal)}</strong></div>
              </div>
              <button class="link-btn" type="button" data-remove="${l.sku}" style="margin-top:6px">Remove</button>
            </div>
          </div>`
        )
        .join('')}
      ${t.freeGift ? `<p class="note note--ok" style="margin-top:12px">🎁 ${escapeHtml(c.freeGiftLabel)} will be added to your parcel.</p>` : ''}
      ${
        upsell.length
          ? `<div style="margin-top:18px"><h3 style="font-size:14px">Complete your routine</h3>
             <div class="scroller" style="grid-auto-columns:88%">
               ${upsell
                 .slice(0, 4)
                 .map((p) => {
                   const v = p.variants[0];
                   return `<div class="mini">
                     <a class="mini__media" href="${BASE}product.html?p=${p.handle}">${PHBL.media(p, 0)}</a>
                     <div><p class="mini__title">${escapeHtml(p.title)}</p><div class="price"><span class="price__now" style="font-size:13px">${money(v.price)}</span></div></div>
                     <button class="btn btn--sm" type="button" data-add="${p.handle}" data-sku="${v.sku}" aria-label="Add ${escapeHtml(p.title)}">+</button>
                   </div>`;
                 })
                 .join('')}
             </div></div>`
          : ''
      }`;

    foot.innerHTML = `
      ${t.totalSavings ? `<p class="savings" style="margin:0">You're saving ${money(t.totalSavings)} on this order</p>` : ''}
      <div class="totals">
        <div class="totals__row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        <div class="totals__row"><span>Delivery</span><span>${t.shipping ? money(t.shipping) : 'FREE'}</span></div>
        <div class="totals__row totals__row--big"><span>Total</span><span>${money(t.total)}</span></div>
      </div>
      <p class="muted" style="margin:0;font-size:12px">${escapeHtml(c.gstNote)}. Coupons and the prepaid discount are applied at checkout.</p>
      <a class="btn btn--block btn--lg" href="${BASE}checkout.html">Checkout · ${money(t.total)}</a>
      <a class="btn btn--ghost btn--block btn--sm" href="${BASE}cart.html">View cart</a>`;
  }
  PHBL.renderCartDrawer = renderCartDrawer;

  /* ---------------- cart count badge ---------------- */
  function syncCount() {
    const n = Cart.count();
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  /* ---------------- search ---------------- */
  function runSearch(query) {
    const q = query.trim().toLowerCase();
    const out = document.getElementById('search-results');
    if (!out) return;
    if (q.length < 2) {
      out.innerHTML = '';
      return;
    }
    const hits = PHBL.products
      .filter((p) =>
        [p.title, p.type, p.tagline, p.suitableFor, ...(p.concerns || []), ...(p.ingredients || [])]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 6);
    out.innerHTML = hits.length
      ? hits
          .map(
            (p) => `<a class="search-hit" href="${BASE}product.html?p=${p.handle}">
              <span style="position:relative;width:52px;height:52px;display:block;border-radius:8px;overflow:hidden;background:var(--cream)">${PHBL.media(p, 0)}</span>
              <span><strong style="display:block;font-size:14px">${escapeHtml(p.title)}</strong>
                <span class="muted">${escapeHtml(p.type)}</span></span>
              <strong>${money(p.variants[0].price)}</strong>
            </a>`
          )
          .join('')
      : `<p class="muted">No matches for “${escapeHtml(query)}”.</p>`;
  }

  /* ---------------- global event delegation ---------------- */
  function wireEvents() {
    document.addEventListener('click', async (e) => {
      const t = e.target;

      const add = t.closest('[data-add]');
      if (add) {
        e.preventDefault();
        Cart.add(add.dataset.add, add.dataset.sku, Number(add.dataset.qty || 1));
        return;
      }

      const sizeBtn = t.closest('[data-card-size]');
      if (sizeBtn) {
        e.preventDefault();
        const card = sizeBtn.closest('.card');
        const product = PHBL.byHandle(card.dataset.handle);
        const variant = product.variants.find((v) => v.sku === sizeBtn.dataset.cardSize);
        card.querySelectorAll('[data-card-size]').forEach((b) => b.setAttribute('aria-pressed', b === sizeBtn));
        card.querySelector('.price__now').textContent = money(variant.price);
        const off = PHBL.percentOff(variant.mrp, variant.price);
        const mrpEl = card.querySelector('.price__mrp');
        const offEl = card.querySelector('.price__off');
        if (mrpEl) mrpEl.textContent = off ? money(variant.mrp) : '';
        if (offEl) offEl.textContent = off ? `${off}% off` : '';
        const getAt = card.querySelector('.get-at');
        if (getAt) getAt.textContent = `Get at ${money(PHBL.prepaidPrice(variant.price))} on prepaid`;
        const addBtn = card.querySelector('[data-add]');
        if (addBtn) addBtn.dataset.sku = variant.sku;
        return;
      }

      const qty = t.closest('[data-qty]');
      if (qty) {
        const item = Cart.items.find((i) => i.sku === qty.dataset.qty);
        if (item) Cart.setQty(item.sku, item.qty + Number(qty.dataset.delta));
        return;
      }

      const rm = t.closest('[data-remove]');
      if (rm) {
        Cart.remove(rm.dataset.remove);
        return;
      }

      const wish = t.closest('[data-wish]');
      if (wish) {
        e.preventDefault();
        const on = PHBL.wishlist.toggle(wish.dataset.wish);
        wish.setAttribute('aria-pressed', String(on));
        PHBL.toast(on ? 'Saved to your wishlist' : 'Removed from wishlist');
        return;
      }

      const copy = t.closest('[data-copy]');
      if (copy) {
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(copy.dataset.copy);
          copy.classList.add('is-copied');
          setTimeout(() => copy.classList.remove('is-copied'), 2000);
        } catch (_) {
          PHBL.toast('Copy the code manually: ' + copy.dataset.copy);
        }
        return;
      }

      if (t.closest('#cart-toggle, #cart-toggle-mobile')) {
        PHBL.openCart();
        return;
      }
      if (t.closest('#nav-toggle')) {
        setOpen(document.querySelector('.drawer-nav'), true);
        return;
      }
      if (t.closest('[data-close-cart], [data-close-nav], #overlay')) {
        PHBL.closeAll();
        return;
      }
      if (t.closest('#search-toggle')) {
        const panel = document.getElementById('search-panel');
        const open = panel.classList.toggle('is-open');
        document.getElementById('search-toggle').setAttribute('aria-expanded', String(open));
        if (open) document.getElementById('search-input').focus();
        return;
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.id === 'search-input') runSearch(e.target.value);
    });

    document.addEventListener('submit', (e) => {
      if (e.target.id === 'search-form') {
        e.preventDefault();
        const q = document.getElementById('search-input').value.trim();
        if (q) location.href = `${BASE}shop.html?q=${encodeURIComponent(q)}`;
      }
      if (e.target.id === 'newsletter-form') {
        e.preventDefault();
        PHBL.toast('Thanks! Connect this form to your email tool to start collecting signups.');
        e.target.reset();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') PHBL.closeAll();
    });

    document.addEventListener('cart:change', () => {
      syncCount();
      if (document.getElementById('cart-drawer')?.classList.contains('is-open')) renderCartDrawer();
    });
  }

  /* ---------------- boot ---------------- */
  PHBL.ready = PHBL.load().then((data) => {
    renderChrome();
    wireEvents();
    syncCount();
    document.documentElement.dataset.phblReady = '1';
    return data;
  });

  PHBL.ready.catch((err) => {
    console.error('PHBL: could not load site data', err);
    const main = document.querySelector('main');
    if (main) {
      main.insertAdjacentHTML(
        'afterbegin',
        `<div class="wrap section"><p class="note note--err">This page needs to be served over http://, not opened as a file.
        Run <code>npm start</code> in the <code>server</code> folder, or <code>npx serve web</code>, then open the address it prints.</p></div>`
      );
    }
  });
})();
