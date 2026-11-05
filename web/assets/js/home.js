/* Home page: fills every section from site.json + products.json */
PHBL.ready.then(({ site, products }) => {
  const { escapeHtml: esc, icon, money } = PHBL;
  const byTag = (tag) => products.filter((p) => (p.tags || []).includes(tag));
  const byCategory = (c) => products.filter((p) => p.category === c);
  const set = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  /* ---- Hero ---- */
  const slides = [
    {
      eyebrow: site.brand.parent,
      title: site.brand.tagline,
      text: 'Natural skin, hair and body care formulated and made in our own homeopathic lab in West Bengal.',
      cta: 'Shop the range',
      link: 'shop.html',
    },
    {
      eyebrow: 'Launch offer',
      title: 'Free gift on orders above ₹999',
      text: 'Plus free delivery over ₹499 and an extra 5% off when you pay online.',
      cta: 'Shop bestsellers',
      link: 'shop.html?tag=bestseller',
    },
    {
      eyebrow: 'Routines, not just products',
      title: 'Combos that cost less than the parts',
      text: 'Curated 2 and 3-step routines for clear skin, strong hair and a natural glow.',
      cta: 'See combos',
      link: 'shop.html?c=combos',
    },
  ];
  set(
    'hero-track',
    slides
      .map(
        (s) => `<div class="hero__slide"><div class="hero__inner"><div class="hero__copy">
          <p class="eyebrow">${esc(s.eyebrow)}</p>
          <h1>${esc(s.title)}</h1>
          <p>${esc(s.text)}</p>
          <a class="btn btn--lg" href="${s.link}">${esc(s.cta)}</a>
        </div></div></div>`
      )
      .join('')
  );
  set('hero-dots', slides.map((_, i) => `<button class="hero__dot" type="button" aria-label="Slide ${i + 1}" aria-current="${i === 0}"></button>`).join(''));

  const track = document.getElementById('hero-track');
  const dots = [...document.querySelectorAll('.hero__dot')];
  if (track && dots.length) {
    const go = (i) => track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
    dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
    track.addEventListener(
      'scroll',
      () => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        dots.forEach((d, j) => d.setAttribute('aria-current', String(i === j)));
      },
      { passive: true }
    );
    let paused = false;
    track.addEventListener('pointerenter', () => (paused = true));
    track.addEventListener('pointerleave', () => (paused = false));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInterval(() => {
        if (paused || document.hidden) return;
        go((Math.round(track.scrollLeft / track.clientWidth) + 1) % slides.length);
      }, 6000);
    }
  }

  /* ---- Category icons ---- */
  set(
    'category-row',
    site.categories
      .map(
        (c) => `<a class="tile" href="shop.html?c=${c.handle}">
          <span class="tile__img">${icon('leaf')}</span>
          <span class="tile__label">${esc(c.title)}</span>
        </a>`
      )
      .join('')
  );

  /* ---- Bestsellers, tabbed ---- */
  const tabs = [
    { label: 'All', items: byTag('bestseller') },
    { label: 'Face', items: byCategory('face-care') },
    { label: 'Hair', items: byCategory('hair-care') },
    { label: 'Body', items: byCategory('body-care') },
  ].filter((t) => t.items.length);
  set('bestseller-tabs', tabs.map((t, i) => `<button class="chip${i === 0 ? ' is-active' : ''}" role="tab" type="button" aria-selected="${i === 0}" aria-controls="bs-panel-${i}" id="bs-tab-${i}">${esc(t.label)}</button>`).join(''));
  set(
    'bestseller-panels',
    tabs
      .map(
        (t, i) => `<div class="scroller" role="tabpanel" id="bs-panel-${i}" aria-labelledby="bs-tab-${i}" ${i ? 'hidden' : ''}>
          ${t.items.map(PHBL.card).join('')}
        </div>`
      )
      .join('')
  );
  document.getElementById('bestseller-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    document.querySelectorAll('#bestseller-tabs [role="tab"]').forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.classList.toggle('is-active', on);
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  });

  /* ---- Promo banners ---- */
  set(
    'promo-grid',
    [
      { title: 'Clear Skin Combo', text: 'Face wash + aloe gel. Save ₹149.', link: 'product.html?p=clear-skin-combo', bg: 'var(--secondary)' },
      { title: 'New: Hibiscus Conditioner', text: 'Soft, detangled, frizz-free hair.', link: 'product.html?p=hibiscus-conditioner', bg: 'var(--cream)' },
      { title: 'Hair Care Combo', text: 'Oil + shampoo routine. Save ₹169.', link: 'product.html?p=hair-care-combo', bg: '#f3e8df' },
    ]
      .map(
        (b) => `<a href="${b.link}" style="display:flex;flex-direction:column;justify-content:flex-end;min-height:200px;padding:20px;border-radius:var(--radius);background:${b.bg};text-decoration:none;color:inherit">
          <h3 style="margin:0 0 4px">${esc(b.title)}</h3>
          <p class="muted" style="margin:0 0 10px">${esc(b.text)}</p>
          <span style="font-weight:600;color:var(--primary)">Shop now →</span>
        </a>`
      )
      .join('')
  );

  /* ---- Concerns ---- */
  set(
    'concern-tiles',
    site.concerns
      .map(
        (c) => `<a class="tile tile--card" href="shop.html?concern=${c.handle}">
          <span class="tile__img">${icon('sparkle')}</span>
          <span class="tile__label">${esc(c.title)}</span>
          <span class="tile__blurb">${esc(c.blurb)}</span>
        </a>`
      )
      .join('')
  );

  /* ---- New launches + combos ---- */
  set('new-launches', byTag('new-launch').concat(byCategory('face-care').slice(0, 2)).slice(0, 8).map(PHBL.card).join(''));
  set('combo-row', byCategory('combos').map(PHBL.card).join(''));

  /* ---- Ingredients ---- */
  set(
    'ingredient-tiles',
    site.ingredients
      .map(
        (c) => `<a class="tile" href="shop.html?ing=${c.handle}">
          <span class="tile__img">${icon('leaf')}</span>
          <span class="tile__label">${esc(c.title)}</span>
        </a>`
      )
      .join('')
  );

  /* ---- Reels (placeholders until real videos are added) ---- */
  set(
    'reel-row',
    products
      .filter((p) => (p.tags || []).includes('bestseller'))
      .slice(0, 4)
      .map((p) => {
        const v = p.variants[0];
        return `<div class="reel">
          <span class="ph"><span>Video</span><strong>Add ${esc(p.title)} reel</strong></span>
          <div class="reel__card">
            <span style="position:relative;width:40px;height:40px;display:block;border-radius:6px;overflow:hidden">${PHBL.media(p, 0)}</span>
            <div><strong style="display:block;font-size:12px;line-height:1.3">${esc(p.title)}</strong>${money(v.price)}</div>
            <button class="btn btn--sm" type="button" data-add="${p.handle}" data-sku="${v.sku}">Add to cart</button>
          </div>
        </div>`;
      })
      .join('')
  );

  /* ---- Trust badges ---- */
  set(
    'trust-row',
    site.trustBadges.map((b) => `<div class="icon-item">${icon(b.icon)}<span>${esc(b.text)}</span></div>`).join('')
  );

  /* ---- Heritage ---- */
  const h = site.heritage;
  set(
    'heritage',
    `<div style="display:grid;gap:28px;align-items:center;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      <div style="position:relative;aspect-ratio:4/3;border-radius:var(--radius);overflow:hidden;background:var(--secondary)">
        <span class="ph"><span>Photo</span><strong>Add a lab or founder photo</strong></span>
      </div>
      <div>
        <p class="eyebrow">${esc(h.eyebrow)}</p>
        <h2>${esc(h.heading)}</h2>
        <p class="muted">${esc(h.body)}</p>
        <div style="display:flex;gap:28px;flex-wrap:wrap;margin:20px 0">
          ${h.stats.map((s) => `<div><strong style="display:block;font-size:24px;color:var(--primary)">${esc(s.number)}</strong><span class="muted">${esc(s.label)}</span></div>`).join('')}
        </div>
        <a class="btn" href="about.html">Our story</a>
      </div>
    </div>`
  );

  /* ---- Testimonials ---- */
  set(
    'testimonials',
    site.testimonials
      .map((t) => {
        const p = PHBL.byHandle(t.product);
        return `<figure class="quote">
          <div class="quote__who">
            <span class="quote__avatar">${esc((t.name || '?').trim().charAt(0))}</span>
            <figcaption><strong>${esc(t.name)}</strong><br><span class="muted">${esc(t.city)}</span></figcaption>
          </div>
          <p class="rating"><span class="rating__star">${'★'.repeat(t.rating)}</span></p>
          <blockquote>“${esc(t.quote)}”</blockquote>
          ${p ? `<a href="product.html?p=${p.handle}" class="muted" style="margin-top:auto">Recommends <strong>${esc(p.title)}</strong> →</a>` : ''}
        </figure>`;
      })
      .join('')
  );

  /* ---- SEO text ---- */
  set('seo-text', `<details class="acc"><summary><h2 style="margin:0;font-size:17px">${esc(site.seoText.heading)}</h2></summary><div class="acc__body muted">${esc(site.seoText.body)}</div></details>`);

  /* ---- Organization JSON-LD ---- */
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.brand.name,
    url: site.brand.domain,
    description: site.brand.tagline,
    email: site.contact.email,
    telephone: site.contact.phone,
    address: { '@type': 'PostalAddress', addressRegion: 'West Bengal', addressCountry: 'IN' },
    sameAs: Object.values(site.social).filter(Boolean),
  });
  document.head.appendChild(ld);
});
