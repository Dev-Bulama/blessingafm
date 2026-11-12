'use strict';
const db = require('../config/db');

const LIST_COLUMNS = [
  'p.id', 'p.name', 'p.slug', 'p.sku', 'p.price_cents', 'p.compare_at_cents', 'p.stock_qty', 'p.has_variants',
  'p.is_taxable', 'p.is_perishable', 'p.is_frozen', 'p.pickup_only', 'p.rating_avg', 'p.rating_count',
  'p.short_description', 'p.category_id', 'p.brand_id', 'p.created_at', 'b.name as brand_name',
];

const SORTS = {
  newest: [['p.created_at', 'desc'], ['p.id', 'desc']],
  price_asc: [['p.price_cents', 'asc'], ['p.id', 'asc']],
  price_desc: [['p.price_cents', 'desc'], ['p.id', 'desc']],
  popular: [['p.sales_count', 'desc'], ['p.id', 'desc']],
  name: [['p.name', 'asc']],
};

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Apply the search condition: FULLTEXT (prefix, boolean mode) with a LIKE fallback for short terms. */
function applySearch(qb, q) {
  const text = String(q || '').trim().slice(0, 80);
  const terms = text.split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 6);
  if (!terms.length) return qb.whereRaw('1 = 0');
  const boolean = terms.filter((t) => t.length >= 3).map((t) => `+${t}*`).join(' ');
  const like = escapeLike(text);
  return qb.where(function searchWhere() {
    if (boolean) this.whereRaw('MATCH (p.name, p.sku, p.search_keywords) AGAINST (? IN BOOLEAN MODE)', [boolean]);
    this.orWhere('p.name', 'like', `%${like}%`)
      .orWhere('p.sku', 'like', `${like}%`)
      .orWhere('p.search_keywords', 'like', `%${like}%`);
  });
}

function applyFilters(qb, f) {
  if (!f.includeInactive) qb.where('p.is_active', true);
  if (f.categoryIds && f.categoryIds.length) qb.whereIn('p.category_id', f.categoryIds);
  if (f.brandIds && f.brandIds.length) qb.whereIn('p.brand_id', f.brandIds);
  if (Number.isInteger(f.minPrice)) qb.where('p.price_cents', '>=', f.minPrice);
  if (Number.isInteger(f.maxPrice)) qb.where('p.price_cents', '<=', f.maxPrice);
  if (f.inStock) qb.where('p.stock_qty', '>', 0);
  if (f.onSale) qb.whereNotNull('p.compare_at_cents').whereRaw('p.compare_at_cents > p.price_cents');
  if (f.featured) qb.where('p.is_featured', true);
  if (f.deal) qb.where('p.is_deal', true);
  if (f.lowStock) qb.whereRaw('p.stock_qty <= p.low_stock_threshold');
  if (f.q) applySearch(qb, f.q);
  return qb;
}

/** Attach the primary image (two queries total, never one per product). */
async function attachImages(products) {
  if (!products.length) return products;
  const ids = products.map((p) => p.id);
  const images = await db('product_images').whereIn('product_id', ids).orderBy([{ column: 'sort_order' }, { column: 'id' }])
    .select('product_id', 'path', 'thumb_path', 'alt');
  const first = new Map();
  for (const img of images) if (!first.has(img.product_id)) first.set(img.product_id, img);
  for (const p of products) {
    const img = first.get(p.id);
    p.image = img ? img.path : null;
    p.thumb = img ? img.thumb_path : null;
  }
  return products;
}

/** Paginated product listing. */
async function list(filters = {}, { sort = 'newest', page = 1, perPage = 24 } = {}) {
  const base = () => applyFilters(db('products as p').leftJoin('brands as b', 'b.id', 'p.brand_id'), filters);
  const [{ total }] = await base().count({ total: 'p.id' });
  const order = (SORTS[sort] || SORTS.newest).map(([column, o]) => ({ column, order: o }));
  const rows = await base().select(LIST_COLUMNS).orderBy(order).limit(perPage).offset((page - 1) * perPage);
  await attachImages(rows);
  return { rows, total: Number(total), page, perPage, pages: Math.max(1, Math.ceil(Number(total) / perPage)) };
}

/** A short unpaginated strip of products (home page rows): no COUNT query. */
async function top(filters = {}, sort = 'newest', limit = 8) {
  const order = (SORTS[sort] || SORTS.newest).map(([column, o]) => ({ column, order: o }));
  const rows = await applyFilters(db('products as p').leftJoin('brands as b', 'b.id', 'p.brand_id'), filters)
    .select(LIST_COLUMNS).orderBy(order).limit(limit);
  return attachImages(rows);
}

/** Brands that have products matching the filters (for the filter sidebar). */
async function brandFacets(filters) {
  const f = { ...filters, brandIds: null };
  return applyFilters(db('products as p').join('brands as b', 'b.id', 'p.brand_id'), f)
    .groupBy('b.id', 'b.name').select('b.id', 'b.name').count({ count: 'p.id' }).orderBy('b.name');
}

async function suggestions(q, limit = 6) {
  const rows = await applySearch(
    db('products as p').leftJoin('brands as b', 'b.id', 'p.brand_id').where('p.is_active', true), q,
  ).select(LIST_COLUMNS).orderBy('p.sales_count', 'desc').limit(limit);
  return attachImages(rows);
}

/** Full product with images, variants, tags, brand and category. */
async function findFull(where) {
  const product = await db('products as p').leftJoin('brands as b', 'b.id', 'p.brand_id')
    .where(where).first('p.*', 'b.name as brand_name', 'b.slug as brand_slug');
  if (!product) return null;
  const [images, variants, tags] = await Promise.all([
    db('product_images').where({ product_id: product.id }).orderBy([{ column: 'sort_order' }, { column: 'id' }]),
    db('product_variants').where({ product_id: product.id }).orderBy([{ column: 'sort_order' }, { column: 'id' }]),
    db('product_tags').where({ product_id: product.id }).orderBy('tag').pluck('tag'),
  ]);
  product.images = images;
  product.variants = variants;
  product.tags = tags;
  product.image = images[0] ? images[0].path : null;
  product.thumb = images[0] ? images[0].thumb_path : null;
  return product;
}

const findBySlug = (slug) => findFull({ 'p.slug': slug, 'p.is_active': true });
const findById = (id) => findFull({ 'p.id': id });

async function related(product, limit = 4) {
  const rows = await db('products as p').leftJoin('brands as b', 'b.id', 'p.brand_id')
    .where('p.is_active', true).where('p.category_id', product.category_id).whereNot('p.id', product.id)
    .select(LIST_COLUMNS).orderBy('p.sales_count', 'desc').limit(limit);
  return attachImages(rows);
}

/**
 * For products with variants, mirror the cheapest active variant price and the summed stock
 * onto the product row so listing, filtering and sorting stay single-table.
 */
async function syncVariantAggregates(productId, trx = db) {
  const product = await trx('products').where({ id: productId }).first('id', 'has_variants');
  if (!product || !product.has_variants) return;
  const variants = await trx('product_variants').where({ product_id: productId, is_active: true })
    .orderBy([{ column: 'price_cents' }, { column: 'id' }]);
  if (!variants.length) return;
  const stock = variants.reduce((sum, v) => sum + Math.max(0, v.stock_qty), 0);
  await trx('products').where({ id: productId }).update({
    price_cents: variants[0].price_cents,
    compare_at_cents: variants[0].compare_at_cents,
    stock_qty: stock,
    weight_grams: variants[0].weight_grams,
  });
}

/** Rebuild the denormalised FULLTEXT keywords column (brand, tags, variant names and SKUs). */
async function rebuildSearchKeywords(productId, trx = db) {
  const product = await trx('products as p').leftJoin('brands as b', 'b.id', 'p.brand_id')
    .where('p.id', productId).first('p.id', 'b.name as brand_name');
  if (!product) return;
  const [tags, variants] = await Promise.all([
    trx('product_tags').where({ product_id: productId }).pluck('tag'),
    trx('product_variants').where({ product_id: productId }).select('name', 'sku'),
  ]);
  const words = [product.brand_name, ...tags, ...variants.flatMap((v) => [v.sku, v.name])].filter(Boolean);
  await trx('products').where({ id: productId }).update({ search_keywords: words.join(' ').slice(0, 1000) });
}

async function setTags(productId, tags, trx = db) {
  const clean = [...new Set(tags.map((t) => String(t).trim().toLowerCase().slice(0, 60)).filter(Boolean))];
  await trx('product_tags').where({ product_id: productId }).del();
  if (clean.length) await trx('product_tags').insert(clean.map((tag) => ({ product_id: productId, tag })));
}

/** Recalculate the cached rating average/count from approved reviews. */
async function refreshRating(productId, trx = db) {
  const row = await trx('reviews').where({ product_id: productId, status: 'approved' })
    .first(trx.raw('COUNT(*) as c'), trx.raw('COALESCE(AVG(rating), 0) as a'));
  await trx('products').where({ id: productId }).update({ rating_count: row.c, rating_avg: Number(row.a).toFixed(2) });
}

module.exports = {
  SORTS, list, top, brandFacets, suggestions, findBySlug, findById, related, attachImages, syncVariantAggregates,
  rebuildSearchKeywords, setTags, refreshRating, applyFilters, LIST_COLUMNS,
};
