'use strict';
const Product = require('../models/product');
const Content = require('../models/content');
const env = require('../config/env');

/** GET / */
async function index(req, res) {
  const [banners, bestSellers, newArrivals, deals] = await Promise.all([
    Content.activeBanners(),
    Product.top({ inStock: true }, 'popular', 8),
    Product.top({}, 'newest', 8),
    Product.top({ deal: true }, 'popular', 8),
  ]);
  const featuredCategories = res.locals.nav.roots.flatMap((d) => d.children.filter((c) => c.is_featured)).slice(0, 8);
  const s = res.locals.settings;

  res.locals.jsonLdBlocks.push({
    '@context': 'https://schema.org',
    '@type': 'GroceryStore',
    name: s.store_name,
    url: env.appUrl,
    image: `${env.appUrl}/assets/img/og-default.png`,
    telephone: s.store_phone && !s.store_phone.includes('PLACEHOLDER') ? s.store_phone : undefined,
    email: s.store_email && !s.store_email.startsWith('placeholder') ? s.store_email : undefined,
    priceRange: '$',
    currenciesAccepted: 'CAD',
    address: {
      '@type': 'PostalAddress',
      streetAddress: s.store_address_line1,
      addressLocality: s.store_city,
      addressRegion: s.store_province,
      postalCode: s.store_postal_code && !s.store_postal_code.includes('PLACEHOLDER') ? s.store_postal_code : undefined,
      addressCountry: 'CA',
    },
    sameAs: [s.social_facebook, s.social_instagram, s.social_tiktok].filter(Boolean),
  });

  res.render('store/home', {
    title: `${s.store_name} | African Groceries & Beauty in Newmarket, Ontario`,
    fullTitle: true,
    metaDescription: s.meta_description,
    banners, bestSellers, newArrivals, deals, featuredCategories,
  });
}

module.exports = { index };
