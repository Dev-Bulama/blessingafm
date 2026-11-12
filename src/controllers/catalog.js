'use strict';
const db = require('../config/db');
const env = require('../config/env');
const Product = require('../models/product');
const Category = require('../models/category');
const Review = require('../models/review');
const { parseMoney } = require('../lib/money');
const { stripTags, truncate } = require('../lib/html');
const { z } = require('../middleware/validation');

const PER_PAGE = 24;
const SORT_OPTIONS = [['newest', 'Newest'], ['popular', 'Most popular'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']];

const toArray = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);
const toIds = (v) => toArray(v).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);

/** Read listing filters from the query string, ignoring anything malformed. */
function parseListQuery(query) {
  const min = parseMoney(query.min);
  const max = parseMoney(query.max);
  const page = Number.parseInt(query.page, 10);
  return {
    brandIds: toIds(query.brand),
    catIds: toIds(query.cat),
    minPrice: min === null ? undefined : min,
    maxPrice: max === null ? undefined : max,
    inStock: query.stock === '1',
    onSale: query.sale === '1',
    deal: query.deal === '1',
    sort: Product.SORTS[query.sort] ? query.sort : null,
    page: Number.isInteger(page) && page > 0 && page < 10000 ? page : 1,
  };
}

/** Shared renderer for category, shop-all and search listings. */
async function renderListing(req, res, { baseFilters = {}, heading, intro = null, breadcrumbs = [], subcategories = [], tree = null,
  defaultSort = 'newest', title, metaDescription = null, searchQuery = null, noindex = false }) {
  const f = parseListQuery(req.query);
  const filters = { ...baseFilters, brandIds: f.brandIds, minPrice: f.minPrice, maxPrice: f.maxPrice, inStock: f.inStock, onSale: f.onSale };
  if (f.deal) filters.deal = true;

  // Subcategory filter: only ids that really are children of the current category are honoured.
  const chosen = subcategories.filter((s) => f.catIds.includes(s.id));
  if (chosen.length) filters.categoryIds = chosen.flatMap((s) => Category.descendantIds(s));

  const sort = f.sort || defaultSort;
  const [result, brands] = await Promise.all([
    Product.list(filters, { sort, page: f.page, perPage: PER_PAGE }),
    Product.brandFacets({ ...baseFilters, categoryIds: filters.categoryIds }),
  ]);

  const activeFilterCount = f.brandIds.length + chosen.length + (f.inStock ? 1 : 0) + (f.onSale ? 1 : 0)
    + (f.minPrice !== undefined ? 1 : 0) + (f.maxPrice !== undefined ? 1 : 0);
  res.render('store/listing', {
    title: f.page > 1 ? `${title} - Page ${f.page}` : title,
    metaDescription,
    noindex: noindex || activeFilterCount > 0 || Boolean(f.sort),
    heading, intro, breadcrumbs, subcategories, brands, result, sort, searchQuery, tree,
    sortOptions: SORT_OPTIONS, filter: f, activeFilterCount,
  });
}

/** GET /c/:slug - department, category or subcategory */
async function category(req, res, next) {
  const tree = res.locals.nav;
  const node = tree.bySlug.get(req.params.slug);
  if (!node) return next();
  const trail = Category.trail(tree, node);
  return renderListing(req, res, {
    baseFilters: { categoryIds: Category.descendantIds(node) },
    heading: node.name,
    intro: node.description,
    breadcrumbs: trail.map((c) => ({ label: c.name, url: `/c/${c.slug}` })),
    subcategories: node.children,
    title: trail.length > 1 ? `${node.name} - ${trail[0].name}` : node.name,
    metaDescription: node.description || `Shop ${node.name} at ${res.locals.settings.store_name}, Newmarket, Ontario. Pickup, local delivery and Canada-wide shipping.`,
  });
}

/** GET /shop - every product, with optional deal/sale/sort presets */
async function shop(req, res) {
  const heading = req.query.deal === '1' ? 'Deals of the Week' : req.query.sale === '1' ? 'On Sale'
    : req.query.sort === 'popular' ? 'Best Sellers' : req.query.sort === 'newest' ? 'New Arrivals' : 'All Products';
  return renderListing(req, res, {
    heading,
    breadcrumbs: [{ label: heading, url: '/shop' }],
    subcategories: res.locals.nav.roots,
    title: heading,
    metaDescription: `Browse ${heading.toLowerCase()} at ${res.locals.settings.store_name}.`,
  });
}

/** GET /search?q= */
async function search(req, res) {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (!q) {
    return res.render('store/listing', {
      title: 'Search', noindex: true, heading: 'Search', intro: 'Type a product name, brand or SKU in the search box above.',
      breadcrumbs: [{ label: 'Search', url: '/search' }], subcategories: [], brands: [], sort: 'popular', searchQuery: '',
      result: { rows: [], total: 0, page: 1, pages: 1 }, sortOptions: SORT_OPTIONS, filter: parseListQuery({}), activeFilterCount: 0,
    });
  }
  return renderListing(req, res, {
    baseFilters: { q },
    heading: `Results for "${q}"`,
    breadcrumbs: [{ label: 'Search', url: '/search' }],
    defaultSort: 'popular',
    title: `Search: ${q}`,
    searchQuery: q,
    noindex: true,
  });
}

/** GET /search/suggest?q= - JSON for the live search dropdown */
async function suggest(req, res) {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return res.json({ items: [] });
  const rows = await Product.suggestions(q, 6);
  res.set('Cache-Control', 'private, max-age=30');
  return res.json({
    items: rows.map((p) => ({
      name: p.name, brand: p.brand_name, url: `/p/${p.slug}`, price: res.locals.money(p.price_cents), from: Boolean(p.has_variants),
      image: res.locals.upload(p.thumb),
    })),
  });
}

/** GET /p/:slug */
async function product(req, res, next) {
  const p = await Product.findBySlug(req.params.slug);
  if (!p) return next();
  const tree = res.locals.nav;
  const node = tree.byId.get(p.category_id);
  const trail = node ? Category.trail(tree, node) : [];
  p.variants = p.variants.filter((v) => v.is_active);

  const [related, reviews, mine, purchased, wish] = await Promise.all([
    Product.related(p, 4),
    Review.approvedForProduct(p.id),
    req.user ? Review.findByUser(p.id, req.user.id) : null,
    req.user ? Review.hasPurchased(req.user.id, p.id) : false,
    req.user ? db('wishlists').where({ user_id: req.user.id, product_id: p.id }).first('id') : null,
  ]);

  const description = p.meta_description || p.short_description || truncate(stripTags(p.description), 160);
  const offerBase = { '@type': 'Offer', priceCurrency: 'CAD', url: `${env.appUrl}/p/${p.slug}`, itemCondition: 'https://schema.org/NewCondition' };
  const offers = p.variants.length
    ? p.variants.map((v) => ({ ...offerBase, name: v.name, sku: v.sku, price: (v.price_cents / 100).toFixed(2), availability: `https://schema.org/${v.stock_qty > 0 ? 'InStock' : 'OutOfStock'}` }))
    : { ...offerBase, price: (p.price_cents / 100).toFixed(2), availability: `https://schema.org/${p.stock_qty > 0 ? 'InStock' : 'OutOfStock'}` };
  res.locals.jsonLdBlocks.push({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: p.sku,
    description,
    image: p.images.map((i) => `${env.appUrl}${res.locals.upload(i.path)}`),
    brand: p.brand_name ? { '@type': 'Brand', name: p.brand_name } : undefined,
    category: trail.map((c) => c.name).join(' > ') || undefined,
    offers,
    aggregateRating: p.rating_count > 0
      ? { '@type': 'AggregateRating', ratingValue: Number(p.rating_avg).toFixed(1), reviewCount: p.rating_count } : undefined,
  });
  res.locals.jsonLdBlocks.push({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [...trail.map((c) => ({ name: c.name, item: `${env.appUrl}/c/${c.slug}` })), { name: p.name, item: `${env.appUrl}/p/${p.slug}` }]
      .map((e, i) => ({ '@type': 'ListItem', position: i + 1, ...e })),
  });

  return res.render('store/product', {
    title: p.meta_title || (p.brand_name ? `${p.name} - ${p.brand_name}` : p.name),
    metaDescription: description,
    ogImage: p.image ? `${env.appUrl}${res.locals.upload(p.image)}` : null,
    ogType: 'product',
    product: p,
    breadcrumbs: trail.map((c) => ({ label: c.name, url: `/c/${c.slug}` })),
    related, reviews,
    myReview: mine,
    canReview: Boolean(req.user && purchased && !mine),
    purchased,
    inWishlist: Boolean(wish),
  });
}

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Choose a star rating').max(5),
  title: z.string().trim().max(120).optional().transform((v) => v || null),
  body: z.string().trim().min(5, 'Please write a few words about the product').max(2000),
});

/** POST /p/:slug/reviews - verified buyers only; goes to moderation */
async function createReview(req, res, next) {
  const p = await db('products').where({ slug: req.params.slug, is_active: true }).first('id', 'slug');
  if (!p) return next();
  if (!(await Review.hasPurchased(req.user.id, p.id))) {
    req.flash('error', 'Only customers who have bought this product can review it.');
    return res.redirect(`/p/${p.slug}#reviews`);
  }
  if (await Review.findByUser(p.id, req.user.id)) {
    req.flash('error', 'You have already reviewed this product.');
    return res.redirect(`/p/${p.slug}#reviews`);
  }
  await db('reviews').insert({ product_id: p.id, user_id: req.user.id, ...req.valid, status: 'pending' });
  req.flash('success', 'Thank you! Your review has been submitted and will appear once approved.');
  return res.redirect(`/p/${p.slug}#reviews`);
}

/** POST /wishlist/toggle/:productId */
async function toggleWishlist(req, res) {
  const productId = Number(req.params.productId);
  const p = Number.isInteger(productId) ? await db('products').where({ id: productId, is_active: true }).first('id', 'slug') : null;
  if (!p) return res.status(404).json({ ok: false, message: 'Product not found' });
  const removed = await db('wishlists').where({ user_id: req.user.id, product_id: p.id }).del();
  if (!removed) await db('wishlists').insert({ user_id: req.user.id, product_id: p.id }).onConflict(['user_id', 'product_id']).ignore();
  const message = removed ? 'Removed from your wishlist.' : 'Saved to your wishlist.';
  if (req.xhr) return res.json({ ok: true, saved: !removed, message });
  req.flash('success', message);
  return res.redirect(req.body.back === 'wishlist' ? '/account/wishlist' : `/p/${p.slug}`);
}

const stockAlertSchema = z.object({
  email: z.string({ error: 'Email is required' }).trim().toLowerCase().max(190).email('Enter a valid email address'),
  variant_id: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().positive().nullable()),
});

/** POST /p/:slug/notify - "email me when this is back in stock" */
async function stockAlert(req, res, next) {
  const p = await db('products').where({ slug: req.params.slug, is_active: true }).first('id', 'slug', 'has_variants');
  if (!p) return next();
  let variantId = null;
  if (p.has_variants) {
    const v = req.valid.variant_id ? await db('product_variants').where({ id: req.valid.variant_id, product_id: p.id }).first('id') : null;
    if (!v) return res.status(422).json({ ok: false, message: 'Please choose an option first.' });
    variantId = v.id;
  }
  const existing = await db('stock_alerts').where({ product_id: p.id, email: req.valid.email }).whereNull('notified_at')
    .where((w) => (variantId ? w.where('variant_id', variantId) : w.whereNull('variant_id'))).first('id');
  if (!existing) await db('stock_alerts').insert({ product_id: p.id, variant_id: variantId, email: req.valid.email });
  const message = 'Thank you. We will email you once, as soon as it is back in stock.';
  if (req.xhr) return res.json({ ok: true, message });
  req.flash('success', message);
  return res.redirect(`/p/${p.slug}`);
}

module.exports = { stockAlertSchema, stockAlert, category, shop, search, suggest, product, createReview, reviewSchema, toggleWishlist, parseListQuery };
