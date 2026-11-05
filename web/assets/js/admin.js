/* Simple order dashboard. The admin key is kept in sessionStorage only. */
PHBL.ready.then(() => {
  const esc = PHBL.escapeHtml;
  const money = PHBL.money;
  const API = window.PHBL_API || '/api';
  const root = document.getElementById('admin-root');
  const STATUSES = ['paid', 'cod_confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];

  const key = () => sessionStorage.getItem('phbl_admin_key') || '';
  const api = (path, options = {}) =>
    fetch(API + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key(), ...(options.headers || {}) },
    });

  function loginView(message) {
    root.innerHTML = `
      <div class="panel narrow">
        <h1>Orders</h1>
        ${message ? `<p class="note note--err">${esc(message)}</p>` : ''}
        <form id="admin-login">
          <div class="field">
            <label for="k">Admin key</label>
            <input id="k" type="password" autocomplete="current-password" required>
            <span class="muted" style="font-size:12px">The ADMIN_KEY value from server/.env</span>
          </div>
          <button class="btn btn--block" type="submit">Sign in</button>
        </form>
      </div>`;
    document.getElementById('admin-login').addEventListener('submit', (e) => {
      e.preventDefault();
      sessionStorage.setItem('phbl_admin_key', document.getElementById('k').value);
      load();
    });
  }

  async function load() {
    root.innerHTML = '<p class="muted">Loading orders…</p>';
    try {
      const res = await api('/admin/orders');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load orders.');
      render(data);
    } catch (err) {
      sessionStorage.removeItem('phbl_admin_key');
      loginView(err.message);
    }
  }

  function render({ count, revenue, orders }) {
    const pending = orders.filter((o) => o.status === 'pending_payment').length;
    const toShip = orders.filter((o) => ['paid', 'cod_confirmed', 'packed'].includes(o.status)).length;

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <h1 style="margin:0">Orders</h1>
        <div style="display:flex;gap:8px">
          <button class="btn btn--ghost btn--sm" type="button" id="refresh">Refresh</button>
          <button class="btn btn--ghost btn--sm" type="button" id="logout">Sign out</button>
        </div>
      </div>

      <div class="grid" style="--cols-m:2;--cols-d:4;margin:20px 0">
        <div class="panel"><p class="muted" style="margin:0;font-size:13px">Orders</p><strong style="font-size:24px">${count}</strong></div>
        <div class="panel"><p class="muted" style="margin:0;font-size:13px">Revenue</p><strong style="font-size:24px">${money(revenue)}</strong></div>
        <div class="panel"><p class="muted" style="margin:0;font-size:13px">To pack / ship</p><strong style="font-size:24px">${toShip}</strong></div>
        <div class="panel"><p class="muted" style="margin:0;font-size:13px">Unpaid</p><strong style="font-size:24px">${pending}</strong></div>
      </div>

      ${
        orders.length
          ? orders
              .map(
                (o) => `<details class="panel" style="margin-bottom:10px">
            <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;list-style:none">
              <span><strong>${esc(o.orderId)}</strong> · ${esc(o.customer.name)} · ${esc(o.customer.city)}
                <span class="muted">${new Date(o.createdAt).toLocaleString('en-IN')}</span></span>
              <span><span class="badge ${o.status === 'cancelled' ? 'badge--sold-out' : o.status === 'pending_payment' ? 'badge--new' : ''}">${esc(o.status.replace(/_/g, ' '))}</span>
                <strong style="margin-left:8px">${money(o.totals.total)}</strong></span>
            </summary>
            <div style="margin-top:14px">
              <p style="margin:0"><strong>${esc(o.customer.phone)}</strong> · ${esc(o.customer.email)}</p>
              <p class="muted" style="white-space:pre-line;margin:4px 0 12px">${esc(o.customer.address1)}${o.customer.address2 ? '\n' + esc(o.customer.address2) : ''}
${esc(o.customer.city)}, ${esc(o.customer.state)} ${esc(o.customer.pincode)}</p>
              ${o.customer.notes ? `<p class="note note--warn">Note: ${esc(o.customer.notes)}</p>` : ''}
              ${o.items.map((i) => `<div class="totals__row"><span>${esc(i.title)} (${esc(i.size)}) × ${i.qty}</span><span>${money(i.lineTotal)}</span></div>`).join('')}
              <div class="totals__row" style="margin-top:8px"><span>Payment</span><span>${esc(o.payment)}${o.razorpayPaymentId ? ' · ' + esc(o.razorpayPaymentId) : ''}</span></div>
              ${o.totals.freeGift ? `<p class="note note--ok">Include free gift: ${esc(o.totals.freeGiftLabel)}</p>` : ''}
              <form class="two-col" data-order="${esc(o.orderId)}" style="margin-top:14px;align-items:end">
                <div class="field"><label>Status</label>
                  <select name="status">${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
                </div>
                <div class="field"><label>Tracking number</label><input name="tracking" value="${esc(o.tracking || '')}"></div>
                <button class="btn btn--sm" type="submit" style="margin-bottom:14px">Save</button>
              </form>
              <details><summary class="muted" style="font-size:12px;cursor:pointer">History</summary>
                <ul class="muted" style="font-size:12px">${o.history.map((h) => `<li>${new Date(h.at).toLocaleString('en-IN')} — ${esc(h.note)}</li>`).join('')}</ul>
              </details>
            </div>
          </details>`
              )
              .join('')
          : '<p class="muted">No orders yet.</p>'
      }`;

    document.getElementById('refresh').addEventListener('click', load);
    document.getElementById('logout').addEventListener('click', () => {
      sessionStorage.removeItem('phbl_admin_key');
      loginView();
    });
    root.querySelectorAll('[data-order]').forEach((form) =>
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await api(`/admin/orders/${form.dataset.order}`, {
          method: 'POST',
          body: JSON.stringify({ status: form.status.value, tracking: form.tracking.value }),
        });
        const data = await res.json();
        PHBL.toast(res.ok ? 'Order updated' : data.error || 'Update failed', res.ok ? '' : 'error');
        if (res.ok) load();
      })
    );
  }

  if (key()) load();
  else loginView();
});
