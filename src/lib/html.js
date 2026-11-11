'use strict';
const sanitizeHtml = require('sanitize-html');

/** Sanitise admin-authored rich text (pages, product descriptions). */
function sanitizeRich(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: ['h2', 'h3', 'h4', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'blockquote', 'hr',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: /^https?:/i.test(attribs.href || '') ? { ...attribs, rel: 'noopener noreferrer' } : attribs,
      }),
      b: 'strong',
      i: 'em',
      div: 'p',
    },
  }).trim();
}

/** Remove all markup (for meta descriptions, plain-text emails). */
function stripTags(html) {
  return sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

function truncate(text, max = 160) {
  const s = String(text || '');
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Serialise an object for a <script type="application/ld+json"> block without allowing tag break-out. */
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

module.exports = { sanitizeRich, stripTags, truncate, jsonLd };
