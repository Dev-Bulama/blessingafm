'use strict';
/**
 * Third-party embed code (chat widgets, analytics) pasted by an admin in Settings.
 *
 * Only <script> tags are used. Each one is re-built from a whitelist of attributes and given a
 * per-request CSP nonce, so the store keeps a Content-Security-Policy even with a widget installed.
 * Pages that handle passwords, checkout details or admin data never load these scripts.
 */
const MAX_LENGTH = 20000;
const MAX_SCRIPTS = 10;
const ALLOWED_ATTRS = new Set(['src', 'async', 'defer', 'id', 'type', 'crossorigin', 'charset', 'referrerpolicy', 'integrity', 'nomodule']);
const ALLOWED_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
const EXCLUDED_PATHS = ['/admin', '/account', '/checkout', '/order', '/cron', '/webhooks'];

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Parse pasted embed code.
 * @returns {{scripts: Array<{attrs: Array<[string, string|null]>, inline: string}>, problems: string[]}}
 */
function parseEmbed(code) {
  const text = String(code || '');
  const scripts = [];
  const problems = [];
  if (text.length > MAX_LENGTH) problems.push(`The code is too long (maximum ${MAX_LENGTH} characters).`);
  const tagRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const attrs = [];
    let src = null;
    let type = '';
    const attrRe = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[1])) !== null) {
      const name = a[1].toLowerCase();
      const value = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : null;
      if (name === 'nonce') continue; // we add our own
      if (!ALLOWED_ATTRS.has(name) && !/^data-[a-z0-9-]+$/.test(name)) continue;
      if (name === 'src') {
        src = String(value || '').trim();
        if (src.startsWith('//')) src = `https:${src}`;
        attrs.push(['src', src]);
      } else {
        if (name === 'type') type = String(value || '').trim().toLowerCase();
        attrs.push([name, value]);
      }
    }
    const inline = m[2].trim();
    if (src !== null && !/^https:\/\/[^\s"'<>]+$/.test(src)) {
      problems.push('Every script address must start with https://');
      continue;
    }
    if (!ALLOWED_TYPES.has(type)) continue; // templates, JSON blocks etc. are not executable: ignore
    if (src === null && !inline) continue;
    scripts.push({ attrs, inline: src === null ? inline.replace(/<!--/g, '<\\!--') : '' });
  }
  if (scripts.length > MAX_SCRIPTS) problems.push(`Too many script tags (maximum ${MAX_SCRIPTS}).`);
  return { scripts: scripts.slice(0, MAX_SCRIPTS), problems };
}

/** Build the final HTML for the scripts, each carrying the request's CSP nonce. */
function renderEmbed(scripts, nonce) {
  return scripts.map((s) => {
    const attrs = s.attrs.map(([k, v]) => (v === null ? k : `${k}="${escAttr(v)}"`)).join(' ');
    return `<script nonce="${escAttr(nonce)}"${attrs ? ` ${attrs}` : ''}>${s.inline}</script>`;
  }).join('\n');
}

let cacheKey = null;
let cacheValue = [];

/** Scripts to load for this request path, or an empty list. */
function scriptsFor(settings, path) {
  if (!settings || settings.custom_scripts_enabled !== '1' || !settings.custom_scripts_code) return [];
  if (EXCLUDED_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return [];
  if (cacheKey !== settings.custom_scripts_code) {
    cacheKey = settings.custom_scripts_code;
    cacheValue = parseEmbed(cacheKey).scripts;
  }
  return cacheValue;
}

/**
 * Content-Security-Policy for pages that load third-party widgets. Scripts still need our nonce
 * ('strict-dynamic' lets a trusted widget load its own helpers); the widget may use HTTPS
 * resources, inline styles and websockets, which chat tools need.
 */
function widgetCsp(nonce, { formAction, upgradeInsecure }) {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https:`,
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: wss:",
    'frame-src https:',
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    `form-action ${formAction.join(' ')}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    ...(upgradeInsecure ? ['upgrade-insecure-requests'] : []),
  ].join(';');
}

module.exports = { parseEmbed, renderEmbed, scriptsFor, widgetCsp, EXCLUDED_PATHS, MAX_LENGTH };
