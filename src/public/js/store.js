/* Blessing African Market - storefront behaviour (vanilla JS, no dependencies). */
(function () {
  'use strict';

  var csrf = document.body.getAttribute('data-csrf') || '';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function postForm(form) {
    var body = new URLSearchParams(new FormData(form));
    return fetch(form.getAttribute('action'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf, Accept: 'application/json' },
      body: body,
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, message: 'Something went wrong. Please try again.' }; })
        .then(function (data) { data.status = res.status; return data; });
    });
  }

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  /* ---------- Accessible slide-in panels (cart drawer, mobile menu) ---------- */
  function Panel(panel, backdrop) {
    var lastFocus = null;
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var items = $$(FOCUSABLE, panel).filter(function (el) { return el.offsetParent !== null; });
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function open() {
      lastFocus = document.activeElement;
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      backdrop.hidden = false;
      document.body.classList.add('no-scroll');
      document.addEventListener('keydown', onKey);
      panel.focus();
    }
    function close() {
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.hidden = true;
      document.body.classList.remove('no-scroll');
      document.removeEventListener('keydown', onKey);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    backdrop.addEventListener('click', close);
    return { open: open, close: close, isOpen: function () { return panel.classList.contains('is-open'); } };
  }

  /* ---------- Mobile menu ---------- */
  var menuEl = $('#mobile-menu');
  if (menuEl) {
    var menu = Panel(menuEl, $('[data-menu-backdrop]'));
    var menuBtn = $('[data-menu-open]');
    menuBtn.addEventListener('click', function () { menu.open(); menuBtn.setAttribute('aria-expanded', 'true'); });
    $('[data-menu-close]').addEventListener('click', function () { menu.close(); menuBtn.setAttribute('aria-expanded', 'false'); });
  }

  /* ---------- Desktop mega menu: keyboard + touch support (hover/focus handled in CSS) ---------- */
  $$('[data-mega]').forEach(function (item) {
    var trigger = $('[data-mega-trigger]', item);
    var setExpanded = function (v) { trigger.setAttribute('aria-expanded', v ? 'true' : 'false'); if (!v) item.classList.remove('is-open'); };
    item.addEventListener('mouseenter', function () { setExpanded(true); });
    item.addEventListener('mouseleave', function () { setExpanded(false); });
    item.addEventListener('focusin', function () { setExpanded(true); });
    item.addEventListener('focusout', function (e) { if (!item.contains(e.relatedTarget)) setExpanded(false); });
    item.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { trigger.focus(); item.classList.remove('is-open'); document.activeElement.blur(); trigger.focus(); setExpanded(false); }
      if (e.key === 'ArrowDown' && document.activeElement === trigger) {
        var firstLink = $('[data-mega-panel] a', item);
        if (firstLink) { e.preventDefault(); firstLink.focus(); }
      }
    });
    // Touch screens have no hover: first tap opens the panel, second tap follows the link.
    trigger.addEventListener('click', function (e) {
      if (window.matchMedia('(hover: none)').matches && !item.classList.contains('is-open')) {
        e.preventDefault();
        $$('[data-mega].is-open').forEach(function (o) { o.classList.remove('is-open'); });
        item.classList.add('is-open');
        setExpanded(true);
      }
    });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-mega]')) $$('[data-mega].is-open').forEach(function (o) { o.classList.remove('is-open'); });
  });

  /* ---------- Cart drawer ---------- */
  var drawerEl = $('#cart-drawer');
  var drawer = drawerEl ? Panel(drawerEl, $('[data-drawer-backdrop]')) : null;
  var drawerBody = drawerEl ? $('[data-drawer-body]', drawerEl) : null;
  var drawerMsg = drawerEl ? $('[data-drawer-message]', drawerEl) : null;

  function setCount(n) {
    $$('[data-cart-count]').forEach(function (el) { el.textContent = n; });
    $$('[data-cart-count-label]').forEach(function (el) { el.textContent = n + (n === 1 ? ' item' : ' items') + ' in cart'; });
  }
  function showDrawerMessage(text, isError) {
    if (!drawerMsg) return;
    drawerMsg.textContent = text || '';
    drawerMsg.classList.toggle('hidden', !text);
    drawerMsg.classList.toggle('bg-brand-red', Boolean(isError));
    drawerMsg.classList.toggle('bg-brand-black', !isError);
  }
  function applyCartResponse(data) {
    if (typeof data.html === 'string') drawerBody.innerHTML = data.html; // server-rendered, escaped markup
    if (typeof data.count === 'number') setCount(data.count);
    showDrawerMessage(data.message, !data.ok);
  }
  function loadDrawer() {
    return fetch('/cart/drawer', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.text(); })
      .then(function (html) { drawerBody.innerHTML = html; });
  }
  if (drawer) {
    $$('[data-cart-open]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (location.pathname === '/cart' || location.pathname === '/checkout') return; // just follow the link
        e.preventDefault();
        showDrawerMessage('');
        drawer.open();
        loadDrawer().catch(function () { location.href = '/cart'; });
      });
    });
    $('[data-drawer-close]', drawerEl).addEventListener('click', drawer.close);
  }

  // Add-to-cart buttons and the forms inside the drawer submit in the background.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!drawer || !form.matches || !form.matches('[data-add-to-cart], [data-cart-form]')) return;
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    postForm(form).then(function (data) {
      if (data.status === 403 || data.status === 422 && !data.html) { showToast(data.message || 'Please refresh the page and try again.', true); return; }
      applyCartResponse(data);
      if (!drawer.isOpen()) drawer.open();
    }).catch(function () { form.submit(); }).then(function () { if (btn) btn.disabled = false; });
  });

  /* ---------- Small toast for background actions ---------- */
  var toastTimer = null;
  function showToast(text, isError) {
    var el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.className = 'fixed bottom-4 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border-2 border-brand-black px-4 py-3 text-center text-sm font-bold shadow-hard-sm';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('bg-brand-red', Boolean(isError));
    el.classList.toggle('text-white', Boolean(isError));
    el.classList.toggle('bg-brand-yellow', !isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 4000);
  }

  /* ---------- Quantity steppers and auto-submitting controls ---------- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-step]');
    if (!btn) return;
    var input = btn.closest('[data-stepper]').querySelector('input[type="number"]');
    var min = input.min === '' ? 0 : Number(input.min);
    var max = input.max === '' ? 99 : Number(input.max);
    var next = Math.max(min, Math.min(max, (Number(input.value) || 0) + Number(btn.getAttribute('data-step'))));
    if (next === Number(input.value)) return;
    input.value = next;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.matches || !el.matches('[data-auto-submit]')) return;
    var form = el.form;
    if (!form) return;
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  });

  /* ---------- Confirm before destructive form posts ---------- */
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  /* ---------- Live search suggestions ---------- */
  $$('[data-search]').forEach(function (form) {
    var input = $('[data-search-input]', form);
    var list = $('[data-search-results]', form);
    var timer = null;
    var active = -1;
    var lastQuery = '';

    function close() { list.classList.add('hidden'); list.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
    function highlight(i) {
      var opts = $$('[role="option"]', list);
      opts.forEach(function (o, n) { o.classList.toggle('bg-brand-yellow', n === i); o.setAttribute('aria-selected', n === i ? 'true' : 'false'); });
      active = i;
      if (opts[i]) input.setAttribute('aria-activedescendant', opts[i].id); else input.removeAttribute('aria-activedescendant');
    }
    function render(items, q) {
      list.innerHTML = '';
      items.forEach(function (item, i) {
        var li = document.createElement('li');
        li.id = list.id + '-opt-' + i;
        li.setAttribute('role', 'option');
        li.className = 'border-b border-neutral-200';
        var a = document.createElement('a');
        a.href = item.url;
        a.tabIndex = -1;
        a.className = 'flex items-center gap-3 px-3 py-2 no-underline';
        var img = document.createElement('img');
        img.src = item.image; img.alt = ''; img.width = 44; img.height = 44; img.className = 'h-11 w-11 rounded border border-neutral-300 object-cover';
        var text = document.createElement('span');
        text.className = 'min-w-0 flex-1';
        var name = document.createElement('span');
        name.className = 'block truncate text-sm font-bold';
        name.textContent = item.name;
        var meta = document.createElement('span');
        meta.className = 'block text-xs text-neutral-700';
        meta.textContent = (item.brand ? item.brand + ' · ' : '') + (item.from ? 'From ' : '') + item.price;
        text.appendChild(name); text.appendChild(meta);
        a.appendChild(img); a.appendChild(text);
        li.appendChild(a);
        list.appendChild(li);
      });
      var all = document.createElement('li');
      all.id = list.id + '-opt-all';
      all.setAttribute('role', 'option');
      var link = document.createElement('a');
      link.href = '/search?q=' + encodeURIComponent(q);
      link.tabIndex = -1;
      link.className = 'block px-3 py-2 text-sm font-bold text-brand-red';
      link.textContent = items.length ? 'See all results for "' + q + '"' : 'No quick matches - search for "' + q + '"';
      all.appendChild(link);
      list.appendChild(all);
      list.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }
    input.addEventListener('input', function () {
      var q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 2) { close(); return; }
      timer = setTimeout(function () {
        lastQuery = q;
        fetch('/search/suggest?q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
          .then(function (r) { return r.ok ? r.json() : { items: [] }; })
          .then(function (data) { if (lastQuery === q && document.activeElement === input) render(data.items || [], q); })
          .catch(close);
      }, 220);
    });
    input.addEventListener('keydown', function (e) {
      var opts = $$('[role="option"]', list);
      if (e.key === 'Escape') { close(); return; }
      if (!opts.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % opts.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active <= 0 ? opts.length - 1 : active - 1); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); location.href = opts[active].querySelector('a').href; }
    });
    document.addEventListener('click', function (e) { if (!form.contains(e.target)) close(); });
    input.addEventListener('blur', function () { setTimeout(function () { if (!form.contains(document.activeElement)) close(); }, 150); });
  });

  /* ---------- Hero slider ---------- */
  var hero = $('[data-hero]');
  if (hero) {
    var slides = $$('[data-hero-slide]', hero);
    var dots = $$('[data-hero-dot]', hero);
    var idx = 0;
    var paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hovering = false;
    var show = function (n) {
      idx = (n + slides.length) % slides.length;
      slides.forEach(function (s, i) { s.classList.toggle('is-active', i === idx); });
      dots.forEach(function (d, i) { d.classList.toggle('bg-brand-black', i === idx); d.classList.toggle('bg-white', i !== idx); d.setAttribute('aria-current', i === idx ? 'true' : 'false'); });
    };
    if (slides.length > 1) {
      $('[data-hero-next]', hero).addEventListener('click', function () { show(idx + 1); });
      $('[data-hero-prev]', hero).addEventListener('click', function () { show(idx - 1); });
      dots.forEach(function (d) { d.addEventListener('click', function () { show(Number(d.getAttribute('data-hero-dot'))); }); });
      var pauseBtn = $('[data-hero-pause]', hero);
      var syncPause = function () { pauseBtn.textContent = paused ? 'Play' : 'Pause'; pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false'); };
      pauseBtn.addEventListener('click', function () { paused = !paused; syncPause(); });
      syncPause();
      hero.addEventListener('mouseenter', function () { hovering = true; });
      hero.addEventListener('mouseleave', function () { hovering = false; });
      hero.addEventListener('focusin', function () { hovering = true; });
      hero.addEventListener('focusout', function () { hovering = false; });
      setInterval(function () { if (!paused && !hovering && !document.hidden) show(idx + 1); }, 6000);
    }
  }

  /* ---------- Product gallery: thumbnails, hover zoom, full-size dialog ---------- */
  var gallery = $('[data-gallery]');
  if (gallery) {
    var main = $('[data-gallery-main]', gallery);
    var frame = $('[data-zoom]', gallery);
    $$('[data-gallery-thumb]', gallery).forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        main.src = thumb.getAttribute('data-full');
        main.alt = thumb.getAttribute('data-alt');
        $$('[data-gallery-thumb]', gallery).forEach(function (t) {
          var on = t === thumb;
          t.classList.toggle('border-brand-red', on); t.classList.toggle('border-neutral-300', !on); t.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });
    if (window.matchMedia('(hover: hover)').matches) {
      frame.addEventListener('mouseenter', function () { frame.classList.add('is-zoomed'); });
      frame.addEventListener('mouseleave', function () { frame.classList.remove('is-zoomed'); main.style.transformOrigin = 'center center'; });
      frame.addEventListener('mousemove', function (e) {
        var r = frame.getBoundingClientRect();
        main.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%';
      });
    }
    var lightbox = $('[data-lightbox]');
    if (lightbox && lightbox.showModal) {
      frame.addEventListener('click', function () {
        var img = $('[data-lightbox-img]', lightbox);
        img.src = main.src; img.alt = main.alt;
        lightbox.showModal();
      });
      lightbox.addEventListener('click', function (e) { if (e.target === lightbox) lightbox.close(); });
    }
  }

  /* ---------- Product variants ---------- */
  var productForm = $('[data-product-form]');
  if (productForm) {
    var qty = $('[data-qty]', productForm);
    var addBtn = $('[data-add-button]', productForm);
    var status = $('[data-stock-status]', productForm);
    var applyVariant = function (radio) {
      var stock = Number(radio.getAttribute('data-stock'));
      $('[data-price]').textContent = radio.getAttribute('data-price');
      var compare = radio.getAttribute('data-compare');
      $('[data-compare]').classList.toggle('hidden', !compare);
      $('[data-compare-value]').textContent = compare;
      var save = Number(radio.getAttribute('data-save'));
      $('[data-save]').classList.toggle('hidden', !(save > 0));
      $('[data-save-value]').textContent = save;
      $('[data-sku]').textContent = radio.getAttribute('data-sku');
      qty.max = Math.max(1, Math.min(99, stock));
      if (Number(qty.value) > Number(qty.max)) qty.value = qty.max;
      addBtn.disabled = stock <= 0;
      addBtn.textContent = stock <= 0 ? 'Sold out' : 'Add to cart';
      status.innerHTML = '';
      var span = document.createElement('span');
      span.className = stock <= 0 || stock <= 5 ? 'text-brand-red-dark' : 'text-brand-green-dark';
      span.textContent = stock <= 0 ? 'Sold out' : stock <= 5 ? 'Only ' + stock + ' left in stock' : 'In stock';
      status.appendChild(span);
    };
    $$('[data-variant]', productForm).forEach(function (radio) {
      radio.addEventListener('change', function () { if (radio.checked) applyVariant(radio); });
    });
  }

  /* ---------- Tabs (WAI-ARIA pattern) ---------- */
  $$('[data-tabs]').forEach(function (root) {
    var tabs = $$('[role="tab"]', root);
    var select = function (tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        t.classList.toggle('bg-brand-black', on); t.classList.toggle('text-white', on); t.classList.toggle('bg-white', !on);
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    };
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') select(tabs[(i + 1) % tabs.length], true);
        else if (e.key === 'ArrowLeft') select(tabs[(i - 1 + tabs.length) % tabs.length], true);
        else if (e.key === 'Home') select(tabs[0], true);
        else if (e.key === 'End') select(tabs[tabs.length - 1], true);
      });
    });
    var openFromHash = function () {
      if (location.hash === '#reviews') { var t = document.getElementById('tab-reviews'); if (t) { select(t, false); t.scrollIntoView({ block: 'start' }); } }
    };
    window.addEventListener('hashchange', openFromHash);
    openFromHash();
  });

  /* ---------- Wishlist toggle ---------- */
  $$('[data-wishlist]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      postForm(form).then(function (data) {
        if (data.status === 401) { location.href = '/account/login?next=' + encodeURIComponent(location.pathname); return; }
        if (!data.ok) { showToast(data.message, true); return; }
        $('[data-wishlist-label]', form).textContent = data.saved ? 'Saved to wishlist' : 'Add to wishlist';
        form.querySelector('button').setAttribute('aria-pressed', data.saved ? 'true' : 'false');
        showToast(data.message);
      }).catch(function () { form.submit(); });
    });
  });

  /* ---------- Newsletter ---------- */
  $$('[data-newsletter]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = form.parentNode.querySelector('[data-newsletter-status]');
      postForm(form).then(function (data) {
        status.textContent = data.message || (data.ok ? 'Subscribed!' : 'Please enter a valid email address.');
        if (data.ok) form.reset();
      }).catch(function () { form.submit(); });
    });
  });

  /* ---------- Listing filters: collapsed by default on small screens ---------- */
  var filterDetails = $('[data-filter-details]');
  if (filterDetails && window.matchMedia('(max-width: 1023px)').matches && filterDetails.getAttribute('data-active') === '0') {
    filterDetails.open = false;
  }

  /* ---------- Order page: wait for the payment webhook, then refresh ---------- */
  if ($('[data-refresh-until-paid]')) {
    var tries = Number(sessionStorage.getItem('bam-pay-tries') || 0);
    if (tries < 8) {
      sessionStorage.setItem('bam-pay-tries', String(tries + 1));
      setTimeout(function () { location.reload(); }, 3000 + tries * 1500);
    }
  } else {
    try { sessionStorage.removeItem('bam-pay-tries'); } catch (err) { /* storage unavailable */ }
  }
})();
