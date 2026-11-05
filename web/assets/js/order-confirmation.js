/* Order confirmation + order lookup (also powers track-order.html) */
PHBL.ready.then(({ site }) => {
  const { escapeHtml: esc, money } = PHBL;
  const API = window.PHBL_API || '/api';
  const root = document.getElementById('order-root');
  const qp = new URLSearchParams(location.search);
  const id = qp.get('id');
  const token = qp.get('t');
  const wa = `https://wa.me/${String(site.contact.whatsapp).replace(/\D/g, '')}`;

  const statusLabel = {
    pending_payment: 'Awaiting payment',
    paid: 'Payment received',
    cod_confirmed: 'Confirmed (Cash on Delivery)',
    packed: 'Packed',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };

  async function show(orderId, phone, tok) {
    root.innerHTML = '<p class="muted">Looking up your order…</p>';
    try {
      const qs = new URLSearchParams({ id: orderId });
      if (phone) qs.set('phone', phone);
      if (tok) qs.set('t', tok);
      const res = await fetch(`${API}/orders/lookup?${qs}`);
      const o = await res.json();
      if (!res.ok) throw new Error(o.error || 'Order not found.');

      root.innerHTML = `
        <div class="panel">
          <p class="eyebrow">${o.status === 'paid' || o.status === 'cod_confirmed' ? 'Thank you' : 'Order received'}</p>
          <h1 style="margin-bottom:4px">Order ${esc(o.orderId)}</h1>
          <p class="muted">${esc(new Date(o.createdAt).toLocaleString('en-IN'))}</p>
          <p class="note ${o.status === 'cancelled' ? 'note--err' : o.status === 'pending_payment' ? 'note--warn' : 'note--ok'}">
            ${esc(statusLabel[o.status] || o.status)}${o.tracking ? ` · Tracking: ${esc(o.tracking)}` : ''}
          </p>

          <h2 style="font-size:16px;margin-top:20px">Items</h2>
          ${o.items
            .map(
              (i) => `<div class="totals__row" style="padding:6px 0">
                <span>${esc(i.title)} <span class="muted">(${esc(i.size)}) × ${i.qty}</span></span>
                <span>${money(i.lineTotal)}</span></div>`
            )
            .join('')}

          <div class="totals" style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px">
            <div class="totals__row"><span>Subtotal</span><span>${money(o.totals.subtotal)}</span></div>
            ${o.totals.discount ? `<div class="totals__row savings"><span>Coupon ${esc(o.totals.couponLabel || '')}</span><span>−${money(o.totals.discount)}</span></div>` : ''}
            ${o.totals.prepaid ? `<div class="totals__row savings"><span>Prepaid discount</span><span>−${money(o.totals.prepaid)}</span></div>` : ''}
            <div class="totals__row"><span>Delivery</span><span>${o.totals.shipping ? money(o.totals.shipping) : 'FREE'}</span></div>
            ${o.totals.codFee ? `<div class="totals__row"><span>COD handling</span><span>${money(o.totals.codFee)}</span></div>` : ''}
            <div class="totals__row totals__row--big"><span>Total</span><span>${money(o.totals.total)}</span></div>
          </div>

          <h2 style="font-size:16px;margin-top:20px">Delivering to</h2>
          <p class="muted" style="white-space:pre-line">${esc(o.customer.name)}
${esc(o.customer.address1)}${o.customer.address2 ? '\n' + esc(o.customer.address2) : ''}
${esc(o.customer.city)}, ${esc(o.customer.state)} ${esc(o.customer.pincode)}
${esc(o.customer.phone)}</p>

          <p class="muted" style="font-size:13px">Estimated delivery: ${esc(site.commerce.deliveryEta)} from dispatch. We will send tracking updates on WhatsApp and email.</p>

          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
            <a class="btn btn--outline" href="${wa}?text=${encodeURIComponent('Hi, I need help with order ' + o.orderId)}" target="_blank" rel="noopener">Ask about this order</a>
            <a class="btn btn--ghost" href="shop.html">Continue shopping</a>
          </div>
        </div>`;
    } catch (err) {
      root.innerHTML = `<div class="panel"><p class="note note--err">${esc(err.message)}</p>
        <p class="muted">Check the order number, or message us on WhatsApp and we will find it for you.</p>
        <a class="btn btn--outline" href="${wa}" target="_blank" rel="noopener">WhatsApp us</a></div>`;
    }
  }

  if (id) {
    show(id, '', token);
  } else {
    root.innerHTML = `
      <div class="panel narrow">
        <h1>Track your order</h1>
        <p class="muted">Enter the order number from your confirmation email or WhatsApp message, plus the phone number you ordered with.</p>
        <form id="lookup-form" novalidate>
          <div class="field">
            <label for="oid">Order number</label>
            <input id="oid" name="oid" placeholder="PHBL-XXXXXX" required>
          </div>
          <div class="field">
            <label for="ophone">Phone number</label>
            <input id="ophone" name="ophone" inputmode="numeric" maxlength="10" placeholder="10-digit mobile" required>
          </div>
          <button class="btn btn--block" type="submit">Find my order</button>
        </form>
      </div>`;
    document.getElementById('lookup-form').addEventListener('submit', (e) => {
      e.preventDefault();
      show(e.target.oid.value.trim().toUpperCase(), e.target.ophone.value.trim());
    });
  }
});
