'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmbed, renderEmbed, scriptsFor, widgetCsp } = require('../src/lib/embed');

test('external script tag keeps safe attributes and data-* settings', () => {
  const { scripts, problems } = parseEmbed('<script src="https://cdn.example.com/widget.js" data-widget-id="abc123" async onload="evil()" nonce="x"></script>');
  assert.deepEqual(problems, []);
  assert.deepEqual(scripts, [{ attrs: [['src', 'https://cdn.example.com/widget.js'], ['data-widget-id', 'abc123'], ['async', null]], inline: '' }]);
  const html = renderEmbed(scripts, 'N0nce');
  assert.equal(html, '<script nonce="N0nce" src="https://cdn.example.com/widget.js" data-widget-id="abc123" async></script>');
  assert.ok(!html.includes('onload'));
});

test('inline loader snippets (Tawk/Crisp style) are kept', () => {
  const code = `<!--Start of Chat Script-->
<script type="text/javascript">
var Chat_API=Chat_API||{};(function(){var s1=document.createElement("script");s1.async=true;s1.src='https://embed.example.to/abc/default';document.head.appendChild(s1);})();
</script>
<!--End of Chat Script-->`;
  const { scripts, problems } = parseEmbed(code);
  assert.deepEqual(problems, []);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].inline, /^var Chat_API/);
  assert.match(renderEmbed(scripts, 'abc'), /^<script nonce="abc" type="text\/javascript">var Chat_API/);
});

test('protocol-relative addresses become https; http and javascript: are refused', () => {
  assert.equal(parseEmbed('<script src="//cdn.example.com/w.js"></script>').scripts[0].attrs[0][1], 'https://cdn.example.com/w.js');
  for (const bad of ['http://cdn.example.com/w.js', 'javascript:alert(1)', '/local.js', 'https://x.com/a.js" onerror="x']) {
    const r = parseEmbed(`<script src='${bad}'></script>`);
    assert.equal(r.scripts.length, 0, bad);
    assert.equal(r.problems.length, 1, bad);
  }
});

test('non-script markup and non-executable script types are ignored', () => {
  const { scripts } = parseEmbed('<div onclick="x()">hi</div><img src=x onerror=alert(1)><script type="application/json">{"a":1}</script><noscript><img src="https://t.example.com/p"></noscript>');
  assert.deepEqual(scripts, []);
});

test('attribute values are escaped when rendered', () => {
  const { scripts } = parseEmbed(`<script src="https://cdn.example.com/w.js" data-title='Say "hi" & <more'></script>`);
  assert.match(renderEmbed(scripts, 'n'), /data-title="Say &quot;hi&quot; &amp; &lt;more"/);
});

test('limits', () => {
  assert.ok(parseEmbed('<script>1</script>'.repeat(11)).problems.length);
  assert.ok(parseEmbed(`<script>${'a'.repeat(20001)}</script>`).problems.length);
});

test('scripts are never loaded on admin, account, checkout or order pages', () => {
  const settings = { custom_scripts_enabled: '1', custom_scripts_code: '<script src="https://cdn.example.com/w.js"></script>' };
  for (const path of ['/', '/p/garri', '/c/food-market', '/cart', '/contact']) assert.equal(scriptsFor(settings, path).length, 1, path);
  for (const path of ['/admin', '/admin/settings', '/account/login', '/account', '/checkout', '/checkout/quote', '/order/BAM-100001']) assert.equal(scriptsFor(settings, path).length, 0, path);
  assert.equal(scriptsFor({ ...settings, custom_scripts_enabled: '0' }, '/').length, 0);
  assert.equal(scriptsFor({}, '/').length, 0);
});

test('widget CSP still requires the nonce and blocks plugins', () => {
  const csp = widgetCsp('abc', { formAction: ["'self'"], upgradeInsecure: true });
  assert.match(csp, /script-src 'nonce-abc' 'strict-dynamic'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
});
