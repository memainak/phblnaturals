/* Checkout: address form, coupon, payment method, Razorpay or COD.
   The server recomputes every amount from products.json, so nothing here is trusted. */
PHBL.ready.then(({ site }) => {
  const { escapeHtml: esc, money } = PHBL;
  const c = site.commerce;
  const API = window.PHBL_API || '/api';

  const draft = PHBL.store.get('phbl_checkout_draft', {});
  let coupon = '';
  let payment = c.codEnabled ? 'prepaid' : 'prepaid';

  if (!PHBL.cart.items.length) {
    document.getElementById('checkout-root').innerHTML = `<div class="empty-state">${PHBL.icon('cart')}
      <h1 style="font-size:20px">Your cart is empty</h1>
      <a class="btn" href="shop.html">Start shopping</a></div>`;
    return;
  }

  /* ---------------- markup ---------------- */
  document.getElementById('checkout-root').innerHTML = `
    <div class="checkout">
      <div>
        <h1>Checkout</h1>
        <div class="step-dots"><b>1. Details</b> → <span>2. Payment</span> → <span>3. Done</span></div>

        <form id="checkout-form" novalidate>
          <div class="panel">
            <h2 style="font-size:16px">Contact</h2>
            <div class="two-col">
              <div class="field">
                <label for="name">Full name *</label>
                <input id="name" name="name" autocomplete="name" required value="${esc(draft.name || '')}">
                <span class="field__error" data-error="name"></span>
              </div>
              <div class="field">
                <label for="phone">Phone (10 digits) *</label>
                <input id="phone" name="phone" inputmode="numeric" autocomplete="tel" maxlength="10" required value="${esc(draft.phone || '')}">
                <span class="field__error" data-error="phone"></span>
              </div>
            </div>
            <div class="field">
              <label for="email">Email *</label>
              <input id="email" name="email" type="email" autocomplete="email" required value="${esc(draft.email || '')}">
              <span class="field__error" data-error="email"></span>
            </div>
          </div>

          <div class="panel">
            <h2 style="font-size:16px">Delivery address</h2>
            <div class="field">
              <label for="address1">House no., building, street *</label>
              <input id="address1" name="address1" autocomplete="address-line1" required value="${esc(draft.address1 || '')}">
              <span class="field__error" data-error="address1"></span>
            </div>
            <div class="field">
              <label for="address2">Area, landmark (optional)</label>
              <input id="address2" name="address2" autocomplete="address-line2" value="${esc(draft.address2 || '')}">
            </div>
            <div class="two-col">
              <div class="field">
                <label for="pincode">Pincode *</label>
                <input id="pincode" name="pincode" inputmode="numeric" maxlength="6" autocomplete="postal-code" required value="${esc(draft.pincode || '')}">
                <span class="field__error" data-error="pincode"></span>
              </div>
              <div class="field">
                <label for="city">City *</label>
                <input id="city" name="city" autocomplete="address-level2" required value="${esc(draft.city || '')}">
                <span class="field__error" data-error="city"></span>
              </div>
            </div>
            <div class="field">
              <label for="state">State *</label>
              <input id="state" name="state" autocomplete="address-level1" required value="${esc(draft.state || '')}">
              <span class="field__error" data-error="state"></span>
            </div>
            <div class="field">
              <label for="notes">Delivery notes (optional)</label>
              <textarea id="notes" name="notes" style="min-height:70px">${esc(draft.notes || '')}</textarea>
            </div>
          </div>

          <div class="panel">
            <h2 style="font-size:16px">Payment method</h2>
            <label class="radio-card">
              <input type="radio" name="payment" value="prepaid" checked>
              <span>
                <span class="radio-card__title">Pay online · save ${c.prepaidDiscountPercent}%</span>
                <span class="muted" style="display:block;font-size:13px">UPI, cards, net banking and wallets via Razorpay. Secure and instant.</span>
              </span>
            </label>
            ${
              c.codEnabled
                ? `<label class="radio-card">
                    <input type="radio" name="payment" value="cod">
                    <span>
                      <span class="radio-card__title">Cash on Delivery${c.codFee ? ` · +${money(c.codFee)}` : ''}</span>
                      <span class="muted" style="display:block;font-size:13px">Pay the courier when your parcel arrives. We confirm COD orders on WhatsApp.</span>
                    </span>
                  </label>`
                : ''
            }
          </div>

          <button class="btn btn--lg btn--block" type="submit" id="place-order">Place order</button>
          <p class="muted" style="font-size:12px;text-align:center;margin-top:10px">
            By placing this order you agree to our <a href="pages/terms.html">Terms</a> and <a href="pages/privacy.html">Privacy Policy</a>.
          </p>
          <div id="checkout-message" style="margin-top:12px"></div>
        </form>
      </div>

      <aside class="summary">
        <h2 style="font-size:17px">Order summary</h2>
        <div id="summary-lines"></div>
        <form id="coupon-form" style="display:flex;gap:8px;margin:14px 0">
          <input type="text" id="coupon-input" placeholder="Coupon code" aria-label="Coupon code" style="text-transform:uppercase">
          <button class="btn btn--outline btn--sm" type="submit">Apply</button>
        </form>
        <div id="coupon-note"></div>
        <div id="summary-totals"></div>
        <p class="muted" style="font-size:12px;margin-top:12px">${esc(c.gstNote)}. Delivery in ${esc(c.deliveryEta)}.</p>
      </aside>
    </div>`;

  /* ---------------- summary ---------------- */
  function renderSummary() {
    const t = PHBL.cart.totals({ coupon, payment });

    document.getElementById('summary-lines').innerHTML = t.lines
      .map(
        (l) => `<div style="display:grid;grid-template-columns:48px 1fr auto;gap:10px;align-items:center;padding:8px 0">
          <span style="position:relative;width:48px;height:48px;border-radius:8px;overflow:hidden;background:#fff;display:block">${PHBL.media(l.product, 0)}</span>
          <span><strong style="font-size:13px;display:block">${esc(l.product.title)}</strong>
            <span class="muted" style="font-size:12px">${esc(l.variant.size)} × ${l.qty}</span></span>
          <strong style="font-size:13px">${money(l.lineTotal)}</strong>
        </div>`
      )
      .join('');

    document.getElementById('summary-totals').innerHTML = `
      <div class="totals" style="border-top:1px solid var(--line);padding-top:10px">
        <div class="totals__row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        ${t.discount ? `<div class="totals__row savings"><span>Coupon ${esc(t.couponLabel)}</span><span>−${money(t.discount)}</span></div>` : ''}
        ${t.prepaid ? `<div class="totals__row savings"><span>Prepaid discount (${c.prepaidDiscountPercent}%)</span><span>−${money(t.prepaid)}</span></div>` : ''}
        <div class="totals__row"><span>Delivery</span><span>${t.shipping ? money(t.shipping) : 'FREE'}</span></div>
        ${t.codFee ? `<div class="totals__row"><span>COD handling</span><span>${money(t.codFee)}</span></div>` : ''}
        <div class="totals__row totals__row--big"><span>To pay</span><span>${money(t.total)}</span></div>
      </div>
      ${t.totalSavings ? `<p class="savings" style="margin-top:10px">You're saving ${money(t.totalSavings)}</p>` : ''}
      ${t.freeGift ? `<p class="note note--ok" style="margin-top:10px">🎁 ${esc(c.freeGiftLabel)} included</p>` : ''}`;

    document.getElementById('place-order').textContent =
      payment === 'cod' ? `Place COD order · ${money(t.total)}` : `Pay ${money(t.total)} securely`;
    return t;
  }
  renderSummary();

  /* ---------------- coupon ---------------- */
  document.getElementById('coupon-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = document.getElementById('coupon-input').value.trim().toUpperCase();
    const note = document.getElementById('coupon-note');
    const found = PHBL.findCoupon(code);
    const subtotal = PHBL.cart.totals().subtotal;

    if (!found) {
      coupon = '';
      note.innerHTML = `<p class="note note--err">“${esc(code)}” is not a valid code.</p>`;
    } else if (subtotal < (found.minCart || 0)) {
      coupon = '';
      note.innerHTML = `<p class="note note--warn">${esc(found.code)} needs a minimum cart of ${money(found.minCart)}.</p>`;
    } else {
      coupon = found.code;
      note.innerHTML = `<p class="note note--ok">${esc(found.code)} applied · ${esc(found.label)}</p>`;
    }
    renderSummary();
  });

  /* ---------------- payment switch ---------------- */
  document.getElementById('checkout-form').addEventListener('change', (e) => {
    if (e.target.name === 'payment') {
      payment = e.target.value;
      renderSummary();
    }
  });

  /* ---------------- validation ---------------- */
  const RULES = {
    name: (v) => (v.trim().length >= 2 ? '' : 'Please enter your full name.'),
    phone: (v) => (/^[6-9]\d{9}$/.test(v.trim()) ? '' : 'Enter a 10-digit Indian mobile number.'),
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Enter a valid email address.'),
    address1: (v) => (v.trim().length >= 5 ? '' : 'Please enter your street address.'),
    pincode: (v) => (/^[1-9]\d{5}$/.test(v.trim()) ? '' : 'Enter a valid 6-digit pincode.'),
    city: (v) => (v.trim().length >= 2 ? '' : 'Please enter your city.'),
    state: (v) => (v.trim().length >= 2 ? '' : 'Please enter your state.'),
  };

  function validate(form) {
    let ok = true;
    Object.entries(RULES).forEach(([field, rule]) => {
      const input = form.elements[field];
      const msg = rule(input.value);
      input.setAttribute('aria-invalid', String(!!msg));
      form.querySelector(`[data-error="${field}"]`).textContent = msg;
      if (msg && ok) {
        input.focus();
        ok = false;
      }
    });
    return ok;
  }

  document.getElementById('checkout-form').addEventListener('blur', (e) => {
    const field = e.target.name;
    if (RULES[field]) {
      const msg = RULES[field](e.target.value);
      e.target.setAttribute('aria-invalid', String(!!msg));
      const slot = document.querySelector(`[data-error="${field}"]`);
      if (slot) slot.textContent = msg;
    }
  }, true);

  /* ---------------- submit ---------------- */
  const loadRazorpay = () =>
    new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the payment window.'));
      document.head.appendChild(s);
    });

  document.getElementById('checkout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = document.getElementById('place-order');
    const msgBox = document.getElementById('checkout-message');
    msgBox.innerHTML = '';

    if (!validate(form)) return;

    const customer = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      address1: form.address1.value.trim(),
      address2: form.address2.value.trim(),
      city: form.city.value.trim(),
      state: form.state.value.trim(),
      pincode: form.pincode.value.trim(),
      notes: form.notes.value.trim(),
    };
    PHBL.store.set('phbl_checkout_draft', customer);

    const payload = {
      items: PHBL.cart.items.map((i) => ({ handle: i.handle, sku: i.sku, qty: i.qty })),
      coupon,
      payment,
      customer,
    };

    btn.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not place the order.');

      if (payment === 'cod') {
        PHBL.cart.clear();
        location.href = `order-confirmation.html?id=${encodeURIComponent(data.orderId)}&t=${encodeURIComponent(data.token)}`;
        return;
      }

      /* prepaid: open the Razorpay window */
      await loadRazorpay();
      const rzp = new window.Razorpay({
        key: data.razorpayKeyId,
        order_id: data.razorpayOrderId,
        amount: data.amountPaise,
        currency: 'INR',
        name: site.brand.name,
        description: `Order ${data.orderId}`,
        prefill: { name: customer.name, email: customer.email, contact: customer.phone },
        notes: { orderId: data.orderId },
        theme: { color: '#2F5D3A' },
        modal: {
          ondismiss() {
            btn.removeAttribute('aria-busy');
            msgBox.innerHTML = `<p class="note note--warn">Payment window closed. Your order is saved as pending, you can pay again.</p>`;
          },
        },
        handler: async (response) => {
          try {
            const vr = await fetch(`${API}/payments/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: data.orderId, ...response }),
            });
            const vd = await vr.json();
            if (!vr.ok || !vd.verified) throw new Error(vd.error || 'We could not verify that payment.');
            PHBL.cart.clear();
            location.href = `order-confirmation.html?id=${encodeURIComponent(data.orderId)}&t=${encodeURIComponent(data.token)}`;
          } catch (err) {
            btn.removeAttribute('aria-busy');
            msgBox.innerHTML = `<p class="note note--err">${esc(err.message)} Please contact us on WhatsApp with order ${esc(data.orderId)} before paying again.</p>`;
          }
        },
      });
      rzp.on('payment.failed', (resp) => {
        btn.removeAttribute('aria-busy');
        msgBox.innerHTML = `<p class="note note--err">Payment failed: ${esc(resp.error?.description || 'please try another method.')}</p>`;
      });
      rzp.open();
    } catch (err) {
      btn.removeAttribute('aria-busy');
      msgBox.innerHTML = `<p class="note note--err">${esc(err.message)}</p>`;
    }
  });
});
