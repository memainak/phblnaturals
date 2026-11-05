/* Product detail page */
PHBL.ready.then(({ site, products }) => {
  const { escapeHtml: esc, icon, money } = PHBL;
  const handle = new URLSearchParams(location.search).get('p');
  const product = PHBL.byHandle(handle);
  const root = document.getElementById('pdp');
  const c = site.commerce;

  if (!product) {
    root.innerHTML = `<div class="section" style="text-align:center">
      <h1>Product not found</h1>
      <p class="muted">That link may be out of date.</p>
      <a class="btn" href="shop.html">Browse all products</a></div>`;
    return;
  }

  PHBL.recordRecent(handle);
  document.title = `${product.title} | ${site.brand.name}`;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', `${product.tagline}. ${product.description}`.slice(0, 160));

  let variant = product.variants.find((v) => v.stock > 0) || product.variants[0];
  const images = PHBL.imageList(product);
  const slots = images.length ? images : [null];
  const inStock = () => variant.stock > 0;

  /* ---------- breadcrumbs ---------- */
  const cat = site.categories.find((x) => x.handle === product.category);
  document.getElementById('breadcrumbs').innerHTML = `
    <a href="index.html">Home</a> / <a href="shop.html">Shop</a>
    ${cat ? ` / <a href="shop.html?c=${cat.handle}">${esc(cat.title)}</a>` : ''}
    / <span>${esc(product.title)}</span>`;

  /* ---------- layout ---------- */
  root.innerHTML = `
    <div class="gallery">
      <div class="gallery__main" id="gallery-main">${PHBL.media(product, 0)}</div>
      <div class="gallery__thumbs" id="gallery-thumbs" ${images.length < 2 ? 'hidden' : ''}>
        ${slots
          .map(
            (_, i) => `<button class="gallery__thumb" type="button" data-img="${i}" aria-current="${i === 0}" aria-label="Image ${i + 1}">${PHBL.media(product, i)}</button>`
          )
          .join('')}
      </div>
    </div>

    <div>
      ${product.badge ? `<span class="badge badge--${product.badge.toLowerCase().replace(/\s+/g, '-')}">${esc(product.badge)}</span>` : ''}
      <h1 style="margin-top:8px">${esc(product.title)}</h1>
      <p class="muted" style="font-size:15px">${esc(product.tagline)}</p>
      ${
        product.rating
          ? `<p class="rating"><span class="rating__star">★</span><strong>${product.rating}</strong>
             <span class="muted">· ${product.reviewCount || 0} reviews</span></p>`
          : ''
      }
      ${product.suitableFor ? `<p class="card__suitable">Suitable for: ${esc(product.suitableFor)}</p>` : ''}

      <div class="pdp__price" id="pdp-price"></div>
      <p class="muted" style="font-size:12px;margin:0">${esc(c.gstNote)}</p>
      <p class="get-at" id="pdp-prepaid" style="margin-top:10px"></p>

      ${
        product.variants.length > 1
          ? `<div style="margin-top:18px">
              <p style="font-size:13px;font-weight:600;margin-bottom:6px">Size</p>
              <div style="display:flex;gap:8px;flex-wrap:wrap" id="variant-chips">
                ${product.variants
                  .map(
                    (v) => `<button class="chip" type="button" data-sku="${v.sku}" aria-pressed="${v.sku === variant.sku}" ${v.stock <= 0 ? 'disabled' : ''}>${esc(v.size)}</button>`
                  )
                  .join('')}
              </div>
            </div>`
          : ''
      }

      <div class="pdp__actions">
        <div class="qty" id="pdp-qty">
          <button type="button" data-pdp-qty="-1" aria-label="Decrease quantity">−</button>
          <span id="pdp-qty-value">1</span>
          <button type="button" data-pdp-qty="1" aria-label="Increase quantity">+</button>
        </div>
        <button class="btn btn--outline" type="button" id="pdp-add">Add to cart</button>
        <button class="btn btn--accent" type="button" id="pdp-buy">Buy now</button>
      </div>
      <p id="stock-note" class="muted" style="font-size:13px"></p>

      ${
        site.offers.length
          ? `<div style="display:grid;gap:8px;margin:18px 0">
              <p style="font-weight:600;margin:0">Available offers</p>
              ${site.offers
                .map(
                  (o) => `<div class="offer"><span>${esc(o.text)}</span>
                    ${o.code ? `<button class="code-chip" type="button" data-copy="${esc(o.code)}">${esc(o.code)}</button>` : ''}</div>`
                )
                .join('')}
            </div>`
          : ''
      }

      <div style="margin:18px 0">
        <p style="font-weight:600;margin-bottom:6px">Check delivery</p>
        <form class="pincode-row" id="pincode-form" novalidate>
          <input type="text" inputmode="numeric" maxlength="6" name="pincode" placeholder="6-digit pincode" aria-label="Pincode">
          <button class="btn btn--outline" type="submit">Check</button>
        </form>
        <p class="muted" id="pincode-result" role="status" style="font-size:13px;margin-top:6px"></p>
      </div>

      ${
        product.benefits?.length
          ? `<div class="icons" style="--cols-m:3;--cols-d:3;margin:22px 0">
              ${product.benefits.map((b) => `<div class="icon-item">${icon(b.icon)}<span>${esc(b.title)}</span></div>`).join('')}
            </div>`
          : ''
      }

      <div id="pdp-accordions"></div>
    </div>`;

  /* ---------- accordions ---------- */
  const ingredientMeta = (h) => site.ingredients.find((i) => i.handle === h);
  const acc = (title, body, open) =>
    `<details class="acc" ${open ? 'open' : ''}><summary>${esc(title)}</summary><div class="acc__body">${body}</div></details>`;

  document.getElementById('pdp-accordions').innerHTML = [
    acc('Description', `<p>${esc(product.description)}</p>`, true),
    product.ingredients?.length
      ? acc(
          'Key ingredients',
          product.ingredients
            .map((h) => {
              const m = ingredientMeta(h);
              return `<div class="ingredient-row">
                <span class="ingredient-row__img">${icon('leaf')}</span>
                <div><a href="shop.html?ing=${h}"><strong>${esc(m?.title || h)}</strong></a>
                  <p class="muted" style="margin:2px 0 0">${esc(m?.blurb || '')}</p></div>
              </div>`;
            })
            .join('')
        )
      : '',
    product.howToUse ? acc('How to use', `<p>${esc(product.howToUse)}</p>`) : '',
    product.fullIngredients ? acc('Full ingredient list', `<p class="muted" style="font-size:13px">${esc(product.fullIngredients)}</p>`) : '',
    product.faqs?.length
      ? acc(
          'FAQs',
          product.faqs.map((f) => `<p style="margin-bottom:4px"><strong>${esc(f.q)}</strong></p><p class="muted">${esc(f.a)}</p>`).join('')
        )
      : '',
    acc(
      'Manufacturer & legal info',
      `<dl class="legal">
        <dt>Net quantity</dt><dd>${esc(product.netQuantity)}</dd>
        <dt>MRP</dt><dd>${money(variant.mrp || variant.price)} (inclusive of all taxes)</dd>
        <dt>Manufactured by</dt><dd style="white-space:pre-line">${esc(site.brand.parent)}\n${esc(site.contact.address)}</dd>
        <dt>Marketed by</dt><dd>${esc(site.brand.name)}</dd>
        <dt>Country of origin</dt><dd>India</dd>
        <dt>Customer care</dt><dd>${esc(site.contact.phone)} · ${esc(site.contact.email)}</dd>
        <dt>GSTIN</dt><dd>${esc(site.contact.gstin)}</dd>
      </dl>
      <p class="muted" style="font-size:12px">Cosmetic product. For external use only. Patch-test before first use and discontinue if irritation occurs.</p>`
    ),
  ]
    .filter(Boolean)
    .join('');

  /* ---------- price + state ---------- */
  let qty = 1;
  function paint() {
    const off = PHBL.percentOff(variant.mrp, variant.price);
    document.getElementById('pdp-price').innerHTML = `
      <span class="price__now">${money(variant.price)}</span>
      ${off ? `<s class="price__mrp">${money(variant.mrp)}</s><span class="price__off">${off}% off</span>` : ''}`;
    document.getElementById('pdp-prepaid').textContent =
      c.showGetAtPrice && c.prepaidDiscountPercent
        ? `Get at ${money(PHBL.prepaidPrice(variant.price))} with ${c.prepaidDiscountPercent}% prepaid discount`
        : '';
    document.getElementById('pdp-qty-value').textContent = qty;
    const note = document.getElementById('stock-note');
    note.textContent = !inStock()
      ? 'Out of stock'
      : variant.stock <= 10
      ? `Only ${variant.stock} left in stock`
      : `In stock · delivery in ${c.deliveryEta}`;
    ['pdp-add', 'pdp-buy'].forEach((id) => {
      document.getElementById(id).disabled = !inStock();
    });
    document.getElementById('sticky-price').innerHTML = `<strong>${money(variant.price)}</strong>${
      off ? `<br><s class="price__mrp">${money(variant.mrp)}</s>` : ''
    }`;
  }

  document.getElementById('pdp').addEventListener('click', (e) => {
    const chip = e.target.closest('#variant-chips [data-sku]');
    if (chip) {
      variant = product.variants.find((v) => v.sku === chip.dataset.sku);
      document.querySelectorAll('#variant-chips [data-sku]').forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
      qty = 1;
      paint();
      return;
    }
    const q = e.target.closest('[data-pdp-qty]');
    if (q) {
      qty = Math.max(1, Math.min(qty + Number(q.dataset.pdpQty), variant.stock || 1));
      paint();
      return;
    }
    const thumb = e.target.closest('[data-img]');
    if (thumb) {
      const i = Number(thumb.dataset.img);
      document.getElementById('gallery-main').innerHTML = PHBL.media(product, i);
      document.querySelectorAll('[data-img]').forEach((b) => b.setAttribute('aria-current', String(b === thumb)));
    }
  });

  document.getElementById('pdp-add').addEventListener('click', () => PHBL.cart.add(product.handle, variant.sku, qty));
  document.getElementById('pdp-buy').addEventListener('click', () => {
    PHBL.cart.add(product.handle, variant.sku, qty);
    setTimeout(() => (location.href = 'checkout.html'), 350);
  });

  /* ---------- pincode check ---------- */
  document.getElementById('pincode-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = e.target.pincode.value.trim();
    const out = document.getElementById('pincode-result');
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      out.textContent = 'Please enter a valid 6-digit pincode.';
      return;
    }
    // Static answer until a courier API (Shiprocket/Delhivery) is connected: see server/README.md
    out.innerHTML = `Delivers to <strong>${esc(pin)}</strong> in ${esc(c.deliveryEta)}${c.codEnabled ? ' · COD available' : ''}`;
  });

  /* ---------- sticky add to cart ---------- */
  const sticky = document.getElementById('sticky-atc');
  const addBtn = document.getElementById('pdp-add');
  new IntersectionObserver(([entry]) => {
    sticky.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 0 && inStock());
  }).observe(addBtn);
  document.getElementById('sticky-add').addEventListener('click', () => PHBL.cart.add(product.handle, variant.sku, qty));

  /* ---------- combo contents ---------- */
  if (product.comboItems?.length) {
    const items = product.comboItems.map(PHBL.byHandle).filter(Boolean);
    const separate = items.reduce((n, p) => n + p.variants[0].price, 0);
    document.getElementById('combo-section').innerHTML = `
      <div class="wrap">
        <div class="section-head"><h2>What's inside this combo</h2></div>
        <div class="grid" style="--cols-m:2;--cols-d:4">
          ${items
            .map(
              (p) => `<a class="tile tile--card" href="product.html?p=${p.handle}">
                <span class="tile__img">${PHBL.media(p, 0)}</span>
                <span class="tile__label">${esc(p.title)}</span>
                <span class="tile__blurb">${esc(p.netQuantity)} · ${money(p.variants[0].price)}</span>
              </a>`
            )
            .join('')}
        </div>
        ${separate > variant.price ? `<p class="savings" style="text-align:center;margin-top:16px">You save ${money(separate - variant.price)} versus buying these separately</p>` : ''}
      </div>`;
  }

  /* ---------- frequently bought together ---------- */
  const fbt = (product.frequentlyBoughtTogether || []).map(PHBL.byHandle).filter((p) => p && p.variants.some((v) => v.stock > 0));
  if (fbt.length) {
    const bundle = [product, ...fbt];
    const total = bundle.reduce((n, p) => n + p.variants[0].price, 0);
    const mrp = bundle.reduce((n, p) => n + (p.variants[0].mrp || p.variants[0].price), 0);
    document.getElementById('fbt-section').innerHTML = `
      <div class="wrap">
        <div class="section-head"><h2>Frequently bought together</h2></div>
        <div class="scroller">${bundle.map(PHBL.card).join('')}</div>
        <div class="fbt">
          <div class="price">
            <span>Total for ${bundle.length} items:</span>
            <span class="price__now">${money(total)}</span>
            ${mrp > total ? `<s class="price__mrp">${money(mrp)}</s>` : ''}
          </div>
          <button class="btn btn--accent" type="button" id="add-bundle">Add all ${bundle.length} to cart</button>
        </div>
      </div>`;
    document.getElementById('add-bundle').addEventListener('click', () => {
      bundle.forEach((p) => PHBL.cart.add(p.handle, p.variants[0].sku, 1));
    });
  }

  /* ---------- related + recently viewed ---------- */
  const related = (product.related || []).map(PHBL.byHandle).filter(Boolean);
  if (related.length) {
    document.getElementById('related-section').innerHTML = `
      <div class="wrap"><div class="section-head"><h2>You may also like</h2></div>
      <div class="scroller">${related.map(PHBL.card).join('')}</div></div>`;
  }
  const recent = PHBL.recentlyViewed(handle).slice(0, 8);
  if (recent.length) {
    document.getElementById('recent-section').innerHTML = `
      <div class="wrap"><div class="section-head"><h2>Recently viewed</h2></div>
      <div class="scroller">${recent.map(PHBL.card).join('')}</div></div>`;
  }

  /* ---------- JSON-LD ---------- */
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      description: product.description,
      brand: { '@type': 'Brand', name: site.brand.name },
      category: product.type,
      ...(product.rating && product.reviewCount
        ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.reviewCount } }
        : {}),
      offers: product.variants.map((v) => ({
        '@type': 'Offer',
        name: v.size,
        sku: v.sku,
        price: v.price,
        priceCurrency: 'INR',
        availability: v.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${site.brand.domain}/product.html?p=${product.handle}`,
        itemCondition: 'https://schema.org/NewCondition',
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: site.brand.domain },
        { '@type': 'ListItem', position: 2, name: cat?.title || 'Shop', item: `${site.brand.domain}/shop.html?c=${product.category}` },
        { '@type': 'ListItem', position: 3, name: product.title },
      ],
    },
  ]);
  document.head.appendChild(ld);

  paint();
});
