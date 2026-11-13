'use strict';
const db = require('../config/db');
const env = require('../config/env');

function robots(req, res) {
  res.removeHeader('Content-Security-Policy'); // plain text, not a page: let browsers display it normally
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send([
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /account',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /order/',
    'Disallow: /search',
    'Disallow: /track-order',
    'Disallow: /email/',
    'Disallow: /cron',
    'Disallow: /webhooks',
    '',
    `Sitemap: ${env.appUrl}/sitemap.xml`,
    '',
  ].join('\n'));
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sitemap(req, res) {
  const [categories, products, pages] = await Promise.all([
    db('categories').where({ is_active: true }).select('slug', 'updated_at'),
    db('products').where({ is_active: true }).select('slug', 'updated_at').orderBy('id').limit(20000),
    db('pages').where({ is_published: true }).select('slug', 'updated_at'),
  ]);
  const urls = [
    { loc: '/', priority: '1.0' },
    { loc: '/shop', priority: '0.8' },
    { loc: '/faq', priority: '0.4' },
    ...categories.map((c) => ({ loc: `/c/${c.slug}`, lastmod: c.updated_at, priority: '0.8' })),
    ...products.map((p) => ({ loc: `/p/${p.slug}`, lastmod: p.updated_at, priority: '0.7' })),
    ...pages.map((p) => ({ loc: `/${p.slug}`, lastmod: p.updated_at, priority: '0.4' })),
  ];
  const body = urls.map((u) => `  <url><loc>${xmlEscape(env.appUrl + u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n');
  res.removeHeader('Content-Security-Policy'); // lets a browser's XML viewer style the file
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
}

module.exports = { robots, sitemap };
