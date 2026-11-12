(function () {
  'use strict';
  var printBtn = document.querySelector('[data-print]');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
  var back = document.querySelector('[data-back]');
  if (back) back.addEventListener('click', function () { if (history.length > 1) history.back(); else window.close(); });
})();
