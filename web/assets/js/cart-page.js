/* Full cart page */
PHBL.ready.then(({ site }) => {
  const { escapeHtml: esc, money } = PHBL;
  const c = site.commerce;

  function render() {
    const t = PHBL.cart.totals();
    const root = document.getElementById('cart-page');

    if (!t.lines.length) {
      root.innerHTML = `<div class="empty-state">${PHBL.icon('cart')}
        <h1 style="font-size:20px">Your cart is empty</h1>
        <p>Add a product and it will show up here.</p>
        <a class="btn" href="shop.html">Start shopping</a></div>`;
      return;
    }

    root.innerHTML = `
      <div class="checkout">
        <div>
          <h1>Your cart (${PHBL.cart.count()})</h1>
          ${t.lines
            .map(
              (l) => `<div class="line-item">
                <a class="line-item__media" href="product.html?p=${l.handle}">${PHBL.media(l.product, 0)}</a>
                <div>
                  <p class="line-item__title"><a href="product.html?p=${l.handle}">${esc(l.product.title)}</a></p>
                  <p class="muted" style="margin:0">${esc(l.variant.size)} · ${esc(l.product.netQuantity)}</p>
                  ${l.variant.stock <= 10 ? `<p class="muted" style="margin:2px 0 0;font-size:12px">Only ${l.variant.stock} left</p>` : ''}
                  <div class="line-item__row">
                    <div class="qty">
                      <button type="button" data-qty="${l.sku}" data-delta="-1" aria-label="Decrease quantity">−</button>
                      <span>${l.qty}</span>
                      <button type="button" data-qty="${l.sku}" data-delta="1" aria-label="Increase quantity">+</button>
                    </div>
                    <div style="text-align:right">
                      <strong>${money(l.lineTotal)}</strong>
                      ${l.lineMrp > l.lineTotal ? `<br><s class="price__mrp">${money(l.lineMrp)}</s>` : ''}
                    </div>
                  </div>
                  <button class="link-btn" type="button" data-remove="${l.sku}" style="margin-top:6px">Remove</button>
                </div>
              </div>`
            )
            .join('')}
          <a class="btn btn--ghost btn--sm" href="shop.html" style="margin-top:18px">← Continue shopping</a>
        </div>

        <aside class="summary">
          <h2 style="font-size:17px">Order summary</h2>
          <div class="totals">
            <div class="totals__row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
            ${t.mrpSavings ? `<div class="totals__row savings"><span>MRP savings</span><span>−${money(t.mrpSavings)}</span></div>` : ''}
            <div class="totals__row"><span>Delivery</span><span>${t.shipping ? money(t.shipping) : 'FREE'}</span></div>
            <div class="totals__row totals__row--big"><span>Total</span><span>${money(t.total)}</span></div>
          </div>
          <p class="muted" style="font-size:12px;margin:10px 0">${esc(c.gstNote)}. Coupon codes and the ${c.prepaidDiscountPercent}% prepaid discount are applied at checkout.</p>
          ${t.freeGift ? `<p class="note note--ok">🎁 ${esc(c.freeGiftLabel)} included</p>` : `<p class="note note--warn">Add ${money(c.freeGiftThreshold - t.subtotal)} more to get a ${esc(c.freeGiftLabel)}</p>`}
          <a class="btn btn--block btn--lg" href="checkout.html" style="margin-top:12px">Proceed to checkout</a>
        </aside>
      </div>`;
  }

  render();
  document.addEventListener('cart:change', render);
});
