/* Shared behaviour for About, FAQ and Contact */
PHBL.ready.then(({ site }) => {
  const { escapeHtml: esc, icon } = PHBL;
  const API = window.PHBL_API || '/api';
  const wa = `https://wa.me/${String(site.contact.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(site.contact.whatsappMessage)}`;

  /* ---------- FAQ ---------- */
  const faqList = document.getElementById('faq-list');
  if (faqList) {
    const groups = [...new Set(site.faqs.map((f) => f.category))];
    faqList.innerHTML = groups
      .map(
        (g) => `<h2 style="font-size:18px;margin-top:28px">${esc(g)}</h2>
          ${site.faqs
            .filter((f) => f.category === g)
            .map((f) => `<details class="acc"><summary>${esc(f.q)}</summary><div class="acc__body muted">${esc(f.a)}</div></details>`)
            .join('')}`
      )
      .join('');

    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: site.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
    document.head.appendChild(ld);
  }

  /* ---------- About: stats + timeline ---------- */
  const stats = document.getElementById('about-stats');
  if (stats) {
    stats.innerHTML = site.heritage.stats
      .map(
        (s) => `<div><strong style="display:block;font-size:28px;color:var(--primary)">${esc(s.number)}</strong>
          <span class="muted">${esc(s.label)}</span></div>`
      )
      .join('');
  }

  /* ---------- Contact details ---------- */
  const info = document.getElementById('contact-info');
  if (info) {
    info.innerHTML = `
      <a class="offer" href="${wa}" target="_blank" rel="noopener">
        <span><strong>WhatsApp</strong><br><span class="muted">Fastest reply</span></span>${icon('whatsapp')}</a>
      <a class="offer" href="tel:${esc(site.contact.phone).replace(/\s/g, '')}">
        <span><strong>Call us</strong><br><span class="muted">${esc(site.contact.phone)}</span></span></a>
      <a class="offer" href="mailto:${esc(site.contact.email)}">
        <span><strong>Email</strong><br><span class="muted">${esc(site.contact.email)}</span></span></a>`;
    const addr = document.getElementById('contact-address');
    if (addr) addr.textContent = site.contact.address;
    const hours = document.getElementById('contact-hours');
    if (hours) hours.textContent = site.contact.hours;
  }

  /* ---------- Contact form ---------- */
  const form = document.getElementById('contact-form');
  if (form) {
    const notify = new URLSearchParams(location.search).get('notify');
    if (notify) {
      const p = PHBL.byHandle(notify);
      if (p) {
        form.subject.value = `Notify me when ${p.title} is back in stock`;
        form.message.value = `Please let me know when ${p.title} is available again.`;
      }
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      const box = document.getElementById('contact-message');
      btn.setAttribute('aria-busy', 'true');
      try {
        const res = await fetch(`${API}/contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.value.trim(),
            email: form.email.value.trim(),
            phone: form.phone.value.trim(),
            subject: form.subject.value.trim(),
            message: form.message.value.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not send the message.');
        box.innerHTML = `<p class="note note--ok">Thanks, we have your message. We reply within one working day.</p>`;
        form.reset();
      } catch (err) {
        box.innerHTML = `<p class="note note--err">${esc(err.message)} You can also reach us on
          <a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>.</p>`;
      } finally {
        btn.removeAttribute('aria-busy');
      }
    });
  }

  /* ---------- Policy pages: fill in brand details ---------- */
  document.querySelectorAll('[data-field]').forEach((el) => {
    const path = el.dataset.field.split('.');
    const value = path.reduce((o, k) => (o || {})[k], site);
    if (value) el.textContent = value;
  });
});
