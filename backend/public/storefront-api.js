/*
 * PHBL Naturals — storefront ↔ API bridge
 *
 * The storefront folder is read-only, so this file is injected into index.html
 * by the backend instead of editing script.js. It:
 *
 *   - replaces the hard-coded product list with the live catalogue
 *   - makes sign in / sign up real (POST /api/auth/*)
 *   - turns the demo checkout into a real order (+ Razorpay when configured)
 *   - stores the newsletter subscription
 *   - keeps a signed-in customer's cart on the server
 *
 * It never edits script.js: the page's own demo handlers are intercepted in the
 * capture phase on `document`, which runs before listeners bound to the form.
 */
(() => {
  'use strict';

  const API = window.PHBL_API_BASE || '';
  const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');

  let siteConfig = null;
  let currentUser = null;

  /* ----------------------------------------------------------- transport */

  async function api(path, { method = 'GET', body, headers } = {}) {
    const response = await fetch(`${API}/api${path}`, {
      method,
      credentials: 'include',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 200) };
    }

    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.details = data.details;
      throw error;
    }
    return data;
  }

  const byId = id => document.getElementById(id);

  const toast = message => {
    if (typeof window.showToast === 'function') window.showToast(message);
  };

  const setMessage = (id, text, tone = 'error') => {
    const el = byId(id);
    if (!el) return;
    el.style.color = tone === 'ok' ? '#426c3d' : '#a13d32';
    el.textContent = text;
  };

  /** The page keeps its cart as { productId: qty }. */
  const cartItems = () => {
    try {
      const raw = typeof cart === 'object' && cart ? cart : {};
      return Object.entries(raw)
        .map(([id, qty]) => ({ productId: Number(id), qty: Number(qty) }))
        .filter(item => Number.isInteger(item.productId) && item.qty > 0);
    } catch {
      return [];
    }
  };

  function setCart(next) {
    try {
      cart = next;
    } catch {
      /* the page's binding is unavailable; fall back to storage only */
    }
    localStorage.setItem('phblCart', JSON.stringify(next));
    if (typeof window.renderCart === 'function') window.renderCart();
  }

  /* ------------------------------------------------------------ catalogue */

  async function loadCatalogue() {
    try {
      const { products: live } = await api('/products?limit=200');
      if (!Array.isArray(live) || !live.length) return;
      if (typeof products === 'undefined' || !Array.isArray(products)) return;

      // Mutate in place: `products` is a top-level const in the page's script.
      products.length = 0;
      products.push(
        ...live.map(p => ({
          id: p.id,
          name: p.name,
          category: p.category,
          price: p.price,
          oldPrice: p.oldPrice ?? p.price,
          badge: p.inStock ? p.badge || '' : 'Out of stock',
          size: p.size,
          image: p.image,
          desc: p.desc,
          ingredients: p.ingredients,
          benefits: p.benefits,
          usage: p.usage,
          stock: p.stock,
          inStock: p.inStock
        }))
      );

      // Drop cart lines for products the catalogue no longer carries.
      const ids = new Set(products.map(p => p.id));
      const pruned = Object.fromEntries(cartItems().filter(i => ids.has(i.productId)).map(i => [i.productId, i.qty]));

      if (typeof window.renderProducts === 'function') window.renderProducts();
      setCart(pruned);
    } catch (error) {
      console.warn('[phbl] catalogue not loaded, page defaults kept:', error.message);
    }
  }

  /* ----------------------------------------------------------- cart sync */

  let syncTimer;

  function syncCart() {
    if (!currentUser) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      api('/cart', { method: 'PUT', body: { items: cartItems() } }).catch(() => {});
    }, 600);
  }

  function hookCartSync() {
    const original = window.saveCart;
    if (typeof original !== 'function') return;

    window.saveCart = function patchedSaveCart(...args) {
      const result = original.apply(this, args);
      syncCart();
      return result;
    };
  }

  async function pullServerCart() {
    if (!currentUser) return;
    try {
      const { cart: server } = await api('/cart');
      if (server?.items?.length) {
        setCart(Object.fromEntries(server.items.map(i => [i.productId, i.qty])));
      }
    } catch {
      /* keep the local cart */
    }
  }

  /* ----------------------------------------------------------------- auth */

  function reflectUser() {
    const link = document.querySelector('.account-link');
    if (link) {
      link.setAttribute(
        'title',
        currentUser ? `Signed in as ${currentUser.name}` : 'Sign in to your account'
      );
      link.classList.toggle('is-signed-in', Boolean(currentUser));
    }
    document.body.dataset.phblAuth = currentUser ? 'signed-in' : 'guest';
  }

  function closeLogin() {
    byId('loginOverlay')?.classList.remove('show');
    document.body.style.overflow = '';
  }

  async function handleAuthSubmit(form) {
    const data = new FormData(form);
    const isSignup = byId('signupTab')?.classList.contains('active');

    const payload = {
      emailMobile: String(data.get('emailMobile') || '').trim(),
      password: String(data.get('password') || ''),
      cart: cartItems()
    };
    if (isSignup) payload.fullName = String(data.get('fullName') || '').trim();

    setMessage('loginMessage', isSignup ? 'Creating your account…' : 'Signing you in…', 'ok');

    try {
      const { user } = await api(isSignup ? '/auth/signup' : '/auth/login', {
        method: 'POST',
        body: payload
      });

      currentUser = user;
      reflectUser();
      setMessage('loginMessage', `Welcome, ${user.name}.`, 'ok');
      await pullServerCart();

      toast(isSignup ? 'Your account is ready.' : `Signed in as ${user.name}.`);
      setTimeout(closeLogin, 700);
      form.reset();
    } catch (error) {
      setMessage('loginMessage', error.message);
    }
  }

  /* ------------------------------------------------------------- checkout */

  const loadScript = src =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error('Could not load the payment library.'));
      document.head.appendChild(el);
    });

  function orderSummary(order) {
    const lines = order.items.map(i => `${i.qty} × ${i.name}`).join(', ');
    const shipping = order.shipping ? money(order.shipping) : 'Free';
    return (
      `Order ${order.id} placed. ${lines}. ` +
      `Subtotal ${money(order.subtotal)}, shipping ${shipping}` +
      (order.codFee ? `, cash-on-delivery fee ${money(order.codFee)}` : '') +
      `. Total ${money(order.total)}. Keep the order id to track it.`
    );
  }

  async function payWithRazorpay(order) {
    const session = await api('/payments/razorpay/order', {
      method: 'POST',
      body: { orderId: order.id }
    });

    await loadScript('https://checkout.razorpay.com/v1/checkout.js');

    return new Promise(resolve => {
      const checkout = new window.Razorpay({
        key: session.keyId,
        order_id: session.razorpayOrderId,
        amount: session.amount,
        currency: session.currency,
        name: 'PHBL Naturals',
        description: `Order ${order.id}`,
        prefill: session.prefill,
        notes: { orderId: order.id },
        theme: { color: '#426c3d' },
        handler: async response => {
          try {
            await api('/payments/razorpay/verify', { method: 'POST', body: response });
            resolve({ paid: true });
          } catch (error) {
            resolve({ paid: false, message: error.message });
          }
        },
        modal: {
          ondismiss: () =>
            resolve({
              paid: false,
              message: `Payment was not completed. Order ${order.id} is saved as pending — you can pay from the order link or choose cash on delivery.`
            })
        }
      });

      checkout.on('payment.failed', res =>
        resolve({ paid: false, message: res?.error?.description || 'The payment failed.' })
      );
      checkout.open();
    });
  }

  async function handleCheckoutSubmit(form) {
    const data = new FormData(form);
    const items = cartItems();

    if (!items.length) {
      setMessage('checkoutMessage', 'Your cart is empty.');
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    const label = submit?.textContent;
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Placing your order…';
    }
    setMessage('checkoutMessage', 'Placing your order…', 'ok');

    try {
      const { order, requiresPayment } = await api('/orders', {
        method: 'POST',
        body: {
          name: data.get('name'),
          email: data.get('email'),
          phone: data.get('phone'),
          address: data.get('address'),
          payment: data.get('payment'),
          items
        }
      });

      setCart({});

      if (requiresPayment && siteConfig?.payments?.razorpay) {
        const result = await payWithRazorpay(order);
        setMessage(
          'checkoutMessage',
          result.paid ? `Payment received. ${orderSummary(order)}` : result.message,
          result.paid ? 'ok' : 'error'
        );
        if (result.paid) toast(`Order ${order.id} confirmed.`);
      } else if (requiresPayment) {
        setMessage(
          'checkoutMessage',
          `${orderSummary(order)} Online payment is not enabled on this server yet, so the order is saved as pending — we will contact you to collect payment.`,
          'ok'
        );
        toast(`Order ${order.id} saved.`);
      } else {
        setMessage('checkoutMessage', orderSummary(order), 'ok');
        toast(`Order ${order.id} confirmed.`);
      }

      form.reset();
    } catch (error) {
      const detail = Array.isArray(error.details)
        ? ' ' + error.details.map(d => `${d.name || `Product ${d.productId}`}: ${d.reason === 'insufficient_stock' ? `only ${d.available} left` : 'unavailable'}`).join('; ')
        : '';
      setMessage('checkoutMessage', error.message + detail);
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = label;
      }
    }
  }

  /* ----------------------------------------------------------- newsletter */

  async function handleNewsletterSubmit(form) {
    const email = byId('newsletterEmail')?.value?.trim();
    if (!email) return;

    setMessage('newsletterMessage', 'Subscribing…', 'ok');
    try {
      const { message } = await api('/newsletter', { method: 'POST', body: { email } });
      setMessage('newsletterMessage', message, 'ok');
      form.reset();
    } catch (error) {
      setMessage('newsletterMessage', error.message);
    }
  }

  /* -------------------------------------------------------- interception */

  // Capture phase on `document` runs before the page's own form listeners,
  // and stopImmediatePropagation keeps the demo handlers from firing.
  document.addEventListener(
    'submit',
    event => {
      const form = event.target;
      const handlers = {
        checkoutForm: handleCheckoutSubmit,
        newsletterForm: handleNewsletterSubmit,
        loginForm: handleAuthSubmit
      };
      const handler = handlers[form?.id];
      if (!handler) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      handler(form);
    },
    true
  );

  /* --------------------------------------------------------------- start */

  async function init() {
    try {
      siteConfig = await api('/config');
      currentUser = siteConfig.user ?? null;
    } catch (error) {
      console.warn('[phbl] API unreachable, the page stays in demo mode:', error.message);
      return;
    }

    reflectUser();
    hookCartSync();
    await loadCatalogue();
    await pullServerCart();

    window.PHBL = {
      api,
      get user() {
        return currentUser;
      },
      get config() {
        return siteConfig;
      },
      signOut: async () => {
        await api('/auth/logout', { method: 'POST' });
        currentUser = null;
        reflectUser();
        toast('Signed out.');
      },
      trackOrder: (id, phone) =>
        api(`/orders/lookup?id=${encodeURIComponent(id)}&phone=${encodeURIComponent(phone || '')}`),
      myOrders: () => api('/orders')
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
