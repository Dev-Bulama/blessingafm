/* Blessing African Market - admin panel behaviour (vanilla JS). */
(function () {
  'use strict';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- Mobile navigation ---------- */
  var navToggle = $('[data-admin-nav-toggle]');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var nav = $('[data-admin-nav]');
      var hidden = nav.classList.toggle('hidden');
      navToggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    });
  }

  /* ---------- Confirm destructive actions ---------- */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var msg = form.getAttribute && form.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) { e.preventDefault(); return; }
    if (form.hasAttribute && form.hasAttribute('data-confirm-select')) {
      var select = form.querySelector('select[name="status"]');
      if (select && (select.value === 'cancelled' || select.value === 'refunded')
        && !window.confirm('Mark this order as ' + select.value + '?' + (select.value === 'cancelled' ? ' Its items will be returned to stock.' : ''))) {
        e.preventDefault();
      }
    }
  }, true);

  /* ---------- Rich text editor (progressive enhancement of a textarea) ---------- */
  $$('[data-rte]').forEach(function (root) {
    var toolbar = $('.rte-toolbar', root);
    var area = $('.rte-area', root);
    var textarea = $('textarea', root);
    var sourceBtn = $('[data-source]', toolbar);
    var sourceMode = false;

    area.innerHTML = textarea.value; // admin-authored HTML; it is sanitised again on the server when saved
    toolbar.hidden = false;
    area.hidden = false;
    textarea.hidden = true;
    try { document.execCommand('styleWithCSS', false, false); document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (err) { /* older browsers */ }

    var sync = function () { if (!sourceMode) textarea.value = area.innerHTML; };
    area.addEventListener('input', sync);
    area.addEventListener('blur', sync);
    // Paste as plain text so foreign styling never enters the content.
    area.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn === sourceBtn) {
        sourceMode = !sourceMode;
        if (sourceMode) { textarea.value = area.innerHTML; } else { area.innerHTML = textarea.value; }
        textarea.hidden = !sourceMode;
        area.hidden = sourceMode;
        sourceBtn.setAttribute('aria-pressed', sourceMode ? 'true' : 'false');
        return;
      }
      if (sourceMode) return;
      area.focus();
      if (btn.hasAttribute('data-cmd')) document.execCommand(btn.getAttribute('data-cmd'), false, null);
      else if (btn.hasAttribute('data-block')) document.execCommand('formatBlock', false, '<' + btn.getAttribute('data-block') + '>');
      else if (btn.hasAttribute('data-link')) {
        var url = window.prompt('Link address (https://... or /page-on-this-site)');
        if (url && /^(https?:\/\/|\/|mailto:|tel:)/i.test(url)) document.execCommand('createLink', false, url);
        else if (url) window.alert('Links must start with https://, /, mailto: or tel:');
      }
      sync();
    });
    if (textarea.form) textarea.form.addEventListener('submit', sync);
  });

  /* ---------- Product form: variant rows ---------- */
  var addVariant = $('[data-add-variant]');
  if (addVariant) {
    var rows = $('[data-variant-rows]');
    var template = $('[data-variant-template]');
    var note = $('[data-variant-note]');
    var simple = $('[data-simple-fields]');
    var syncMode = function () {
      var has = $$('[data-variant-row]', rows).length > 0;
      if (note) note.hidden = !has;
      if (simple) $$('input', simple).forEach(function (i) { i.disabled = has; });
    };
    addVariant.addEventListener('click', function () {
      var i = Number(addVariant.getAttribute('data-next-index'));
      addVariant.setAttribute('data-next-index', String(i + 1));
      var holder = document.createElement('tbody');
      holder.innerHTML = template.innerHTML.replace(/__i__/g, String(i));
      var row = holder.firstElementChild;
      rows.appendChild(row);
      syncMode();
      row.querySelector('input:not([type="hidden"])').focus();
    });
    rows.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove-row]');
      if (!btn) return;
      btn.closest('[data-variant-row]').remove();
      syncMode();
    });
    syncMode();
  }

  /* ---------- Product form: drag (or button) reorder of images ---------- */
  var list = $('[data-image-list]');
  if (list) {
    var orderInput = $('[data-image-order]');
    var dragged = null;
    var saveOrder = function () {
      orderInput.value = $$('[data-image-id]', list).map(function (li) { return li.getAttribute('data-image-id'); }).join(',');
    };
    list.addEventListener('dragstart', function (e) {
      dragged = e.target.closest('[data-image-id]');
      if (!dragged) return;
      dragged.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragged.getAttribute('data-image-id'));
    });
    list.addEventListener('dragover', function (e) {
      var over = e.target.closest('[data-image-id]');
      if (!dragged || !over || over === dragged) return;
      e.preventDefault();
      var rect = over.getBoundingClientRect();
      var after = (e.clientX - rect.left) > rect.width / 2;
      list.insertBefore(dragged, after ? over.nextSibling : over);
    });
    list.addEventListener('drop', function (e) { e.preventDefault(); });
    list.addEventListener('dragend', function () {
      if (dragged) dragged.classList.remove('dragging');
      dragged = null;
      saveOrder();
    });
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-image-move]');
      if (!btn) return;
      var li = btn.closest('[data-image-id]');
      if (btn.getAttribute('data-image-move') === '-1' && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
      else if (btn.getAttribute('data-image-move') === '1' && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      saveOrder();
      btn.focus();
    });
  }
})();
