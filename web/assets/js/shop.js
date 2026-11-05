/* Shop page: facet filters, sort, search, shareable URLs */
PHBL.ready.then(({ site, products }) => {
  const esc = PHBL.escapeHtml;
  const params = new URLSearchParams(location.search);

  const state = {
    categories: params.getAll('c').filter((v) => v && v !== 'all'),
    concerns: params.getAll('concern'),
    ingredients: params.getAll('ing'),
    tags: params.getAll('tag'),
    q: params.get('q') || '',
    sort: params.get('sort') || 'featured',
    maxPrice: Number(params.get('max') || 0),
  };

  const priceOf = (p) => p.variants[0].price;
  const maxCatalogPrice = Math.max(...products.map(priceOf));

  function matches(p) {
    if (state.categories.length && !state.categories.includes(p.category)) return false;
    if (state.concerns.length && !state.concerns.some((c) => (p.concerns || []).includes(c))) return false;
    if (state.ingredients.length && !state.ingredients.some((i) => (p.ingredients || []).includes(i))) return false;
    if (state.tags.length && !state.tags.some((t) => (p.tags || []).includes(t))) return false;
    if (state.maxPrice && priceOf(p) > state.maxPrice) return false;
    if (state.q) {
      const hay = [p.title, p.type, p.tagline, p.suitableFor, ...(p.concerns || []), ...(p.ingredients || [])].join(' ').toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  }

  const sorters = {
    featured: (a, b) => (b.tags?.includes('bestseller') ? 1 : 0) - (a.tags?.includes('bestseller') ? 1 : 0),
    'price-asc': (a, b) => priceOf(a) - priceOf(b),
    'price-desc': (a, b) => priceOf(b) - priceOf(a),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    newest: (a, b) => (b.tags?.includes('new-launch') ? 1 : 0) - (a.tags?.includes('new-launch') ? 1 : 0),
    title: (a, b) => a.title.localeCompare(b.title),
  };

  const countFor = (key, value) => {
    const probe = { ...state, [key]: [value] };
    const saved = state[key];
    state[key] = [value];
    const n = products.filter(matches).length;
    state[key] = saved;
    void probe;
    return n;
  };

  function renderFilters() {
    const group = (title, key, options, open) => `
      <details class="filters__group" ${open ? 'open' : ''}>
        <summary class="acc" style="list-style:none;cursor:pointer;padding:14px 0;font-weight:600;display:flex;justify-content:space-between">
          ${esc(title)}<span aria-hidden="true">+</span>
        </summary>
        <div class="filters__list">
          ${options
            .map(
              (o) => `<label class="check">
                <input type="checkbox" data-facet="${key}" value="${o.handle}" ${state[key].includes(o.handle) ? 'checked' : ''}>
                <span>${esc(o.title)}</span><span class="count">${countFor(key, o.handle)}</span>
              </label>`
            )
            .join('')}
        </div>
      </details>`;

    document.getElementById('filters').innerHTML = `
      <h2 style="font-size:16px">Filters</h2>
      ${group('Category', 'categories', site.categories.filter((c) => c.handle !== 'all'), true)}
      ${group('Concern', 'concerns', site.concerns, true)}
      ${group('Ingredient', 'ingredients', site.ingredients, false)}
      ${group('Collection', 'tags', [
        { handle: 'bestseller', title: 'Bestsellers' },
        { handle: 'new-launch', title: 'New launches' },
        { handle: 'combo', title: 'Combos' },
        { handle: 'offer', title: 'On offer' },
      ], false)}
      <details class="filters__group" open>
        <summary style="list-style:none;cursor:pointer;padding:14px 0;font-weight:600">Max price</summary>
        <div class="filters__list">
          <input type="range" id="price-range" min="99" max="${maxCatalogPrice}" step="50"
            value="${state.maxPrice || maxCatalogPrice}" style="width:100%;min-height:0">
          <output id="price-out" class="muted">Up to ${PHBL.money(state.maxPrice || maxCatalogPrice)}</output>
        </div>
      </details>
      <button class="btn btn--ghost btn--sm btn--block" type="button" id="clear-filters" style="margin-top:14px">Clear all</button>`;
  }

  function activeChips() {
    const chips = [];
    const push = (key, handle, label) => chips.push(`<button class="chip is-active" type="button" data-unset="${key}:${handle}">${esc(label)} ✕</button>`);
    state.categories.forEach((h) => push('categories', h, site.categories.find((c) => c.handle === h)?.title || h));
    state.concerns.forEach((h) => push('concerns', h, site.concerns.find((c) => c.handle === h)?.title || h));
    state.ingredients.forEach((h) => push('ingredients', h, site.ingredients.find((c) => c.handle === h)?.title || h));
    state.tags.forEach((h) => push('tags', h, h.replace('-', ' ')));
    if (state.q) push('q', state.q, `“${state.q}”`);
    if (state.maxPrice && state.maxPrice < maxCatalogPrice) push('maxPrice', state.maxPrice, `Under ${PHBL.money(state.maxPrice)}`);
    document.getElementById('active-filters').innerHTML = chips.join('');
  }

  function syncUrl() {
    const sp = new URLSearchParams();
    state.categories.forEach((v) => sp.append('c', v));
    state.concerns.forEach((v) => sp.append('concern', v));
    state.ingredients.forEach((v) => sp.append('ing', v));
    state.tags.forEach((v) => sp.append('tag', v));
    if (state.q) sp.set('q', state.q);
    if (state.sort !== 'featured') sp.set('sort', state.sort);
    if (state.maxPrice && state.maxPrice < maxCatalogPrice) sp.set('max', state.maxPrice);
    history.replaceState({}, '', sp.toString() ? `?${sp}` : location.pathname);
  }

  function render() {
    const list = products.filter(matches).sort(sorters[state.sort] || sorters.featured);
    PHBL.renderCards(document.getElementById('product-grid'), list);
    document.getElementById('result-count').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;

    /* page title reflects the active filter, for shareable links */
    const first =
      site.categories.find((c) => c.handle === state.categories[0]) ||
      site.concerns.find((c) => c.handle === state.concerns[0]) ||
      site.ingredients.find((c) => c.handle === state.ingredients[0]);
    const heading = state.q ? `Search: “${state.q}”` : first ? first.title : 'All products';
    document.getElementById('shop-title').textContent = heading;
    document.title = `${heading} | ${site.brand.name}`;
    activeChips();
    syncUrl();
  }

  renderFilters();
  document.getElementById('sort').value = state.sort;
  render();

  /* events */
  document.addEventListener('change', (e) => {
    const facet = e.target.closest('[data-facet]');
    if (facet) {
      const key = facet.dataset.facet;
      state[key] = e.target.checked ? [...state[key], facet.value] : state[key].filter((v) => v !== facet.value);
      render();
      renderFilters();
      return;
    }
    if (e.target.id === 'sort') {
      state.sort = e.target.value;
      render();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'price-range') {
      state.maxPrice = Number(e.target.value);
      document.getElementById('price-out').textContent = `Up to ${PHBL.money(state.maxPrice)}`;
      render();
    }
  });

  document.addEventListener('click', (e) => {
    const unset = e.target.closest('[data-unset]');
    if (unset) {
      const [key, value] = unset.dataset.unset.split(':');
      if (key === 'q') state.q = '';
      else if (key === 'maxPrice') state.maxPrice = 0;
      else state[key] = state[key].filter((v) => v !== value);
      render();
      renderFilters();
      return;
    }
    if (e.target.closest('#clear-filters')) {
      Object.assign(state, { categories: [], concerns: [], ingredients: [], tags: [], q: '', maxPrice: 0 });
      render();
      renderFilters();
      return;
    }
    if (e.target.closest('#filter-toggle')) {
      const panel = document.getElementById('filters-panel');
      panel.classList.add('is-open');
      document.getElementById('overlay').classList.add('is-open');
      document.body.classList.add('no-scroll');
    }
    if (e.target.closest('#filters-done')) PHBL.closeAll();
  });
});
