/* PHBL Naturals: small vanilla Web Components. Loaded with defer. */
(() => {
  const strings = window.phblStrings || {};

  // Click-to-copy discount codes: <button class="phbl-code" data-code="X">
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-code]');
    if (!btn) return;
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(btn.dataset.code);
    } catch (_) {
      return;
    }
    btn.dataset.copied = strings.copied || 'Copied!';
    btn.classList.add('is-copied');
    setTimeout(() => btn.classList.remove('is-copied'), 2000);
  });

  // Tabs: <phbl-tabs> with [role=tab][aria-controls] and [role=tabpanel]
  class PhblTabs extends HTMLElement {
    connectedCallback() {
      this.tabs = [...this.querySelectorAll('[role="tab"]')];
      this.tabs.forEach((tab) => tab.addEventListener('click', () => this.select(tab)));
    }
    select(tab) {
      this.tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        t.classList.toggle('is-active', on);
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
    }
  }
  customElements.define('phbl-tabs', PhblTabs);

  // Scroller prev/next buttons: <phbl-scroller-nav data-target="id">
  class PhblScrollerNav extends HTMLElement {
    connectedCallback() {
      const track = document.getElementById(this.dataset.target);
      if (!track) return;
      this.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () =>
          track.scrollBy({ left: (b.dataset.dir === 'prev' ? -1 : 1) * track.clientWidth * 0.8, behavior: 'smooth' })
        )
      );
    }
  }
  customElements.define('phbl-scroller-nav', PhblScrollerNav);

  // Add to cart without reload, re-rendering Dawn's cart drawer via the Section Rendering API.
  async function addToCart(items, button) {
    const cart = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
    button?.setAttribute('aria-busy', 'true');
    if (button) button.disabled = true;
    try {
      const body = { items };
      if (cart) {
        body.sections = cart.getSectionsToRender().map((s) => s.id);
        body.sections_url = window.location.pathname;
      }
      const res = await fetch(`${window.routes.cart_add_url}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.status) throw new Error(data.description || data.message);
      if (cart) {
        // Dawn's renderContents expects an item-shaped response carrying `sections`
        cart.classList.remove('is-empty');
        cart.renderContents({ ...data.items?.[0], sections: data.sections, id: items[0].id });
        syncCount();
        setTimeout(loadComplementary, 50);
      } else {
        window.location = window.routes.cart_url;
      }
    } catch (err) {
      alert(err.message || window.cartStrings?.error);
    } finally {
      button?.removeAttribute('aria-busy');
      if (button) button.disabled = false;
    }
  }
  window.phblAddToCart = addToCart;

  // Keep the bottom-nav cart count in sync with any cart change
  async function syncCount() {
    try {
      const { item_count } = await (await fetch(`${window.routes.cart_url}.js`)).json();
      document.querySelectorAll('[data-cart-count]').forEach((el) => {
        el.textContent = item_count;
        el.hidden = !item_count;
      });
    } catch (_) {}
  }
  if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') subscribe(PUB_SUB_EVENTS.cartUpdate, syncCount);

  // Cart drawer upsell: upgrade to Search & Discovery complementary recommendations
  async function loadComplementary() {
    const box = document.querySelector('cart-drawer [data-upsell-for]');
    if (!box || !box.dataset.upsellFor) return;
    try {
      const url = `${window.routes.product_recommendations_url}?product_id=${box.dataset.upsellFor}&intent=complementary&limit=6&section_id=phbl-upsell-recs`;
      const doc = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/html');
      const exclude = box.dataset.exclude || '';
      const cards = [...doc.querySelectorAll('.phbl-mini')].filter((c) => !exclude.includes(`,${c.dataset.productId},`));
      if (!cards.length) return;
      box.querySelector('[data-upsell-list]').replaceChildren(...cards);
      box.hidden = false;
    } catch (_) {}
  }
  document.addEventListener('DOMContentLoaded', loadComplementary);
  if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') subscribe(PUB_SUB_EVENTS.cartUpdate, () => setTimeout(loadComplementary, 50));

  // Quick add on product cards: <button data-quick-add data-variant-id>
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quick-add]');
    if (!btn) return;
    e.preventDefault();
    const ids = (btn.dataset.variantIds || btn.dataset.variantId).split(',').filter(Boolean);
    addToCart(ids.map((id) => ({ id: Number(id), quantity: 1 })), btn);
  });

  // Variant size chips on cards: swap price + quick-add variant
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-card-variant]');
    if (!chip) return;
    e.preventDefault();
    const card = chip.closest('.phbl-card');
    card.querySelectorAll('[data-card-variant]').forEach((c) => c.setAttribute('aria-pressed', c === chip));
    const v = JSON.parse(chip.dataset.cardVariant);
    const add = card.querySelector('[data-quick-add]');
    if (add) {
      add.dataset.variantId = v.id;
      add.disabled = !v.available;
    }
    const set = (sel, html) => { const el = card.querySelector(sel); if (el) { el.innerHTML = html || ''; el.hidden = !html; } };
    set('.phbl-price__sale', v.price);
    set('.phbl-price__mrp', v.mrp);
    set('.phbl-price__off', v.off);
    set('.phbl-get-at', v.get_at);
  });

  // Buy now: add the current PDP selection, then go straight to checkout (checkout app takes over)
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-buy-now]');
    if (!btn) return;
    const form = document.getElementById(btn.dataset.buyNow);
    if (!form) return;
    btn.disabled = true;
    try {
      const res = await fetch(`${window.routes.cart_add_url}.js`, { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) });
      const data = await res.json();
      if (data.status) throw new Error(data.description);
      window.location.href = '/checkout';
    } catch (err) {
      alert(err.message || window.cartStrings?.error);
      btn.disabled = false;
    }
  });

  // Sticky mobile ATC: shows when the main buy button scrolls out of view
  class PhblStickyAtc extends HTMLElement {
    connectedCallback() {
      const target = document.querySelector(this.dataset.watch);
      if (!target) return;
      new IntersectionObserver(([entry]) => {
        this.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
      }).observe(target);
      this.querySelector('button')?.addEventListener('click', () => {
        const form = document.querySelector(this.dataset.form);
        form?.querySelector('[type="submit"]')?.click();
      });
    }
  }
  customElements.define('phbl-sticky-atc', PhblStickyAtc);

  // Recently viewed (localStorage). Record on PDP, render via Section Rendering API.
  const RV_KEY = 'phbl_recently_viewed';
  const readRv = () => { try { return JSON.parse(localStorage.getItem(RV_KEY)) || []; } catch (_) { return []; } };
  class PhblRecentlyViewed extends HTMLElement {
    async connectedCallback() {
      const current = this.dataset.current;
      let list = readRv().filter((h) => h !== current);
      if (current) {
        try { localStorage.setItem(RV_KEY, JSON.stringify([current, ...list].slice(0, 12))); } catch (_) {}
      }
      list = list.slice(0, 8);
      if (!list.length) return;
      const q = list.map((h) => `handle:${h}`).join(' OR ');
      const url = `${window.routes.search_url}?q=${encodeURIComponent(q)}&type=product&section_id=${this.dataset.sectionId}`;
      try {
        const html = await (await fetch(url)).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const inner = doc.querySelector('[data-rv-results]');
        if (inner && inner.children.length) {
          this.querySelector('[data-rv-results]').replaceWith(inner);
          this.hidden = false;
        }
      } catch (_) {}
    }
  }
  customElements.define('phbl-recently-viewed', PhblRecentlyViewed);

  // Pincode checker fallback (replaced by the Shiprocket app block when installed)
  class PhblPincode extends HTMLElement {
    connectedCallback() {
      const form = this.querySelector('form');
      const out = this.querySelector('[data-result]');
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pin = form.pincode.value.trim();
        if (!/^[1-9][0-9]{5}$/.test(pin)) {
          out.textContent = strings.pincodeInvalid;
          return;
        }
        const endpoint = this.dataset.endpoint;
        if (!endpoint) {
          out.textContent = this.dataset.fallback;
          return;
        }
        out.textContent = '…';
        try {
          const r = await (await fetch(endpoint.replace('{pincode}', pin))).json();
          out.textContent = r.serviceable
            ? `${strings.pincodeEta.replace('[days]', r.eta_days)}${r.cod ? ' · ' + strings.pincodeCod : ''}`
            : strings.pincodeUnserviceable;
        } catch (_) {
          out.textContent = this.dataset.fallback;
        }
      });
    }
  }
  customElements.define('phbl-pincode', PhblPincode);

  // "See more" on home-page product grids: reveals the rows held back on first paint
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-see-more]');
    if (!btn) return;
    btn.closest('phbl-see-more').querySelectorAll('[data-extra]').forEach((el) => (el.hidden = false));
    btn.remove();
  });

  // Collection "Load more": fetch next page, append grid items, keep URL shareable
  class PhblLoadMore extends HTMLElement {
    connectedCallback() {
      this.querySelector('button').addEventListener('click', () => this.load());
      if (this.dataset.auto === 'true') {
        this.observer = new IntersectionObserver(([en]) => en.isIntersecting && this.load(), { rootMargin: '600px' });
        this.observer.observe(this);
      }
    }
    async load() {
      const btn = this.querySelector('button');
      btn.disabled = true;
      try {
        const html = await (await fetch(this.dataset.next)).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const grid = document.getElementById('product-grid');
        doc.querySelectorAll('#product-grid > li').forEach((li) => grid.appendChild(li));
        const next = doc.querySelector('phbl-load-more');
        history.replaceState({}, '', this.dataset.next);
        if (next) {
          this.dataset.next = next.dataset.next;
          btn.disabled = false;
        } else {
          this.remove();
        }
      } catch (_) {
        btn.disabled = false;
      }
    }
  }
  customElements.define('phbl-load-more', PhblLoadMore);

  // Lightweight autoplay for the hero slideshow
  class PhblSlider extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('.phbl-hero__track');
      this.dots = [...this.querySelectorAll('.phbl-hero__dot')];
      this.dots.forEach((d, i) => d.addEventListener('click', () => this.go(i)));
      this.track.addEventListener('scroll', () => {
        const i = Math.round(this.track.scrollLeft / this.track.clientWidth);
        this.dots.forEach((d, j) => d.setAttribute('aria-current', i === j));
      }, { passive: true });
      const speed = Number(this.dataset.autoplay);
      if (speed && this.dots.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        let paused = false;
        this.addEventListener('pointerenter', () => (paused = true));
        this.addEventListener('pointerleave', () => (paused = false));
        setInterval(() => {
          if (paused || document.hidden) return;
          const i = Math.round(this.track.scrollLeft / this.track.clientWidth);
          this.go((i + 1) % this.dots.length);
        }, speed * 1000);
      }
    }
    go(i) { this.track.scrollTo({ left: i * this.track.clientWidth, behavior: 'smooth' }); }
  }
  customElements.define('phbl-slider', PhblSlider);
})();
