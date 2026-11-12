/* Checkout page: show the right sections and keep the totals in sync with the server. */
(function () {
  'use strict';
  var form = document.querySelector('[data-checkout]');
  if (!form) return;

  var csrf = document.body.getAttribute('data-csrf') || '';
  var $ = function (sel) { return form.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(form.querySelectorAll(sel)); };
  var placeBtn = $('[data-place-order]');
  var placeLabel = $('[data-place-label]');
  var postal = $('[data-postal]');
  var quoteError = $('[data-quote-error]');
  var blockers = $('[data-blockers]');
  var freeDelivery = $('[data-free-delivery]');
  var quoteOk = !placeBtn.disabled;
  var seq = 0;

  function fulfilment() {
    var r = $('[data-fulfilment]:checked');
    return r ? r.value : null;
  }
  function payment() {
    var r = $('[data-payment]:checked');
    return r ? r.value : null;
  }

  function syncSections() {
    var f = fulfilment();
    $('[data-section="pickup"]').hidden = f !== 'pickup';
    $('[data-section="address"]').hidden = !f || f === 'pickup';
    var inStore = $('[data-instore-option]');
    if (inStore) {
      inStore.hidden = f !== 'pickup';
      var radio = inStore.querySelector('input');
      if (f !== 'pickup' && radio.checked) {
        radio.checked = false;
        var first = $$('[data-payment]').filter(function (p) { return p !== radio; })[0];
        if (first) first.checked = true;
      }
    }
    syncButton();
  }

  function syncButton() {
    placeLabel.textContent = payment() === 'stripe' ? 'Continue to secure payment' : 'Place order';
    placeBtn.disabled = !quoteOk;
  }

  function setText(key, value) {
    $$('[data-t="' + key + '"]').forEach(function (el) { el.textContent = value; });
  }

  function applyQuote(q) {
    quoteOk = Boolean(q.ok);
    setText('subtotal', q.subtotal);
    setText('tax', q.tax);
    setText('tax_label', q.tax_label);
    setText('total', q.total);
    setText('shipping_label', q.shipping_label || 'Delivery');
    setText('shipping', q.ok ? q.shipping : '-');
    var discountRow = $('[data-row="discount"]');
    if (discountRow) {
      discountRow.classList.toggle('hidden', !q.discount);
      if (q.discount) setText('discount', q.discount);
    }
    freeDelivery.hidden = !q.free_delivery;

    var hasBlockers = q.blockers && q.blockers.length > 0;
    blockers.hidden = !hasBlockers;
    if (hasBlockers) {
      $('[data-blockers-title]').textContent = q.errors[0] || '';
      var list = $('[data-blockers-list]');
      list.innerHTML = '';
      q.blockers.forEach(function (b) {
        var li = document.createElement('li');
        var strong = document.createElement('strong');
        strong.textContent = b.name;
        li.appendChild(strong);
        li.appendChild(document.createTextNode(' - ' + b.reasons.join(', ')));
        list.appendChild(li);
      });
    }
    var showError = !q.ok && !hasBlockers && q.errors && q.errors.length;
    quoteError.hidden = !showError;
    quoteError.textContent = showError ? q.errors[0] : '';
    syncButton();
  }

  function requestQuote() {
    var f = fulfilment();
    if (!f) return;
    var mine = ++seq;
    fetch('/checkout/quote', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf, Accept: 'application/json' },
      body: JSON.stringify({ fulfilment: f, postal_code: postal ? postal.value : '' }),
    }).then(function (r) { return r.json(); }).then(function (q) {
      if (mine !== seq) return; // a newer request superseded this one
      if (q.message && q.errors === undefined) { location.href = '/cart'; return; }
      applyQuote(q);
    }).catch(function () { /* totals are re-checked on the server when the order is placed */ });
  }

  $$('[data-fulfilment]').forEach(function (r) {
    r.addEventListener('change', function () { syncSections(); requestQuote(); });
  });
  $$('[data-payment]').forEach(function (r) { r.addEventListener('change', syncButton); });
  if (postal) {
    var timer = null;
    postal.addEventListener('input', function () {
      clearTimeout(timer);
      if (postal.value.replace(/[^a-z0-9]/gi, '').length >= 6) timer = setTimeout(requestQuote, 350);
    });
    postal.addEventListener('change', requestQuote);
  }

  // Saved address picker fills the address fields.
  var saved = $('[data-saved-address]');
  if (saved) {
    saved.addEventListener('change', function () {
      var o = saved.options[saved.selectedIndex];
      var set = function (name, v) { var el = form.elements[name]; if (el) el.value = v || ''; };
      set('ship_name', o.getAttribute('data-name'));
      set('line1', o.getAttribute('data-line1'));
      set('line2', o.getAttribute('data-line2'));
      set('city', o.getAttribute('data-city'));
      set('province', o.getAttribute('data-province'));
      set('postal_code', o.getAttribute('data-postal'));
      requestQuote();
    });
  }

  // Guard against double submission.
  form.addEventListener('submit', function (e) {
    if (form.getAttribute('data-submitting')) { e.preventDefault(); return; }
    form.setAttribute('data-submitting', '1');
    placeBtn.disabled = true;
    placeLabel.textContent = 'Placing your order...';
    setTimeout(function () { form.removeAttribute('data-submitting'); syncButton(); }, 15000);
  });

  syncSections();
})();
