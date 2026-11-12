'use strict';
const db = require('../../config/db');
const Product = require('../../models/product');
const Category = require('../../models/category');
const Audit = require('../../models/audit');
const Inventory = require('../../services/inventory');
const Image = require('../../services/image');
const Csv = require('../../services/csv');
const { z, fieldErrors, checkbox } = require('../../middleware/validation');
const { parseMoney } = require('../../lib/money');
const { sanitizeRich } = require('../../lib/html');
const { uniqueSlug, slugify } = require('../../lib/slug');

const PER_PAGE = 30;

const money = (label, { nullable = false } = {}) => z.any().optional().transform((v, ctx) => {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (nullable) return null;
    ctx.addIssue({ code: 'custom', message: `${label} is required` });
    return z.NEVER;
  }
  const cents = parseMoney(v);
  if (cents === null || cents > 100000000) { ctx.addIssue({ code: 'custom', message: `${label}: enter an amount such as 12.99` }); return z.NEVER; }
  return cents;
});
const int = (label, min, max, fallback) => z.any().optional().transform((v, ctx) => {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) { ctx.addIssue({ code: 'custom', message: `${label} must be a whole number between ${min} and ${max}` }); return z.NEVER; }
  return n;
});
const text = (max) => z.any().optional().transform((v) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max)));
const sku = z.string({ error: 'SKU is required' }).trim().min(1, 'SKU is required').max(64).regex(/^[A-Za-z0-9._-]+$/, 'SKU can only contain letters, numbers, dots, dashes and underscores');

const variantSchema = z.object({
  id: z.any().optional().transform((v) => (v ? Number(v) || null : null)),
  name: z.string().trim().min(1, 'Each variant needs a name').max(120),
  sku,
  price: money('Variant price'),
  compare_at: money('Variant compare-at price', { nullable: true }),
  stock: int('Variant stock', 0, 1000000, 0),
  weight_grams: int('Variant weight', 0, 1000000, 0),
  is_active: checkbox,
  remove: checkbox,
});

const productSchema = z.object({
  name: z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(190),
  slug: text(200),
  sku,
  category_id: z.coerce.number({ error: 'Choose a category' }).int().positive('Choose a category'),
  brand_id: z.any().optional().transform((v) => (v ? Number(v) || null : null)),
  short_description: text(300),
  description: z.any().optional().transform((v) => sanitizeRich(String(v || '').slice(0, 100000))),
  details: z.any().optional().transform((v) => sanitizeRich(String(v || '').slice(0, 100000))),
  price: money('Price', { nullable: true }),
  compare_at: money('Compare-at price', { nullable: true }),
  stock: int('Stock', 0, 1000000, 0),
  low_stock_threshold: int('Low-stock threshold', 0, 100000, 5),
  weight_grams: int('Weight', 0, 1000000, 0),
  variant_label: text(40),
  tags: text(1000),
  meta_title: text(190),
  meta_description: text(300),
  is_taxable: checkbox, is_perishable: checkbox, is_frozen: checkbox, pickup_only: checkbox,
  is_featured: checkbox, is_deal: checkbox, is_active: checkbox,
  variants: z.preprocess((v) => (v && typeof v === 'object' ? Object.values(v) : []), z.array(variantSchema).max(60)),
  image_order: text(2000),
  image_delete: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.number().int()).max(100)),
  image_alt: z.preprocess((v) => (v && typeof v === 'object' ? v : {}), z.record(z.string(), z.string().max(190))),
});

/** GET /admin/products */
async function list(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const q = String(req.query.q || '').trim().slice(0, 80);
  const filters = { includeInactive: true };
  if (q) filters.q = q;
  if (req.query.category) {
    const tree = await Category.fullTree();
    const node = tree.byId.get(Number(req.query.category));
    if (node) filters.categoryIds = Category.descendantIds(node);
  }
  if (req.query.low === '1') filters.lowStock = true;
  const result = await Product.list(filters, { sort: Product.SORTS[req.query.sort] ? req.query.sort : 'newest', page, perPage: PER_PAGE });
  const ids = result.rows.map((r) => r.id);
  const extra = ids.length ? await db('products').whereIn('id', ids).select('id', 'is_active', 'is_featured', 'is_deal', 'low_stock_threshold') : [];
  const extraById = new Map(extra.map((e) => [e.id, e]));
  result.rows.forEach((r) => Object.assign(r, extraById.get(r.id)));
  res.render('admin/products', {
    title: 'Products', result, q, categories: Category.flatten(await Category.fullTree()),
  });
}

/** GET /admin/products/new and /admin/products/:id/edit */
async function form(req, res, next) {
  let product = null;
  if (req.params.id) {
    product = await Product.findById(Number(req.params.id) || 0);
    if (!product) return next();
  }
  const [tree, brands] = await Promise.all([Category.fullTree(), db('brands').orderBy('name').select('id', 'name')]);
  return res.render('admin/product-form', {
    title: product ? `Edit: ${product.name}` : 'New product', product, brands, hasSharp: Image.hasSharp(),
    categories: Category.flatten(tree),
  });
}

/** POST /admin/products and /admin/products/:id */
async function save(req, res, next) {
  const id = req.params.id ? Number(req.params.id) || 0 : null;
  const existing = id ? await db('products').where({ id }).first() : null;
  if (id && !existing) return next();
  const back = id ? `/admin/products/${id}/edit` : '/admin/products/new';
  const fail = (errors) => {
    const { _csrf, ...old } = req.body;
    req.session.form = { old, errors };
    req.flash('error', Object.values(errors)[0] || 'Please check the form and try again.');
    return res.redirect(back);
  };

  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return fail(fieldErrors(parsed.error));
  const d = parsed.data;
  const variants = d.variants.filter((v) => !v.remove);
  const removedVariantIds = d.variants.filter((v) => v.remove && v.id).map((v) => v.id);
  if (!variants.length && d.price === null) return fail({ price: 'Price is required' });
  if (d.compare_at !== null && d.price !== null && d.compare_at <= d.price) return fail({ compare_at: 'The compare-at price must be higher than the price' });

  // SKU uniqueness across products and variants.
  const skus = [d.sku, ...variants.map((v) => v.sku)].map((s) => s.toUpperCase());
  if (new Set(skus).size !== skus.length) return fail({ sku: 'Each SKU (product and variants) must be different' });
  const productClash = await db('products').whereIn('sku', skus).modify((qb) => { if (id) qb.whereNot({ id }); }).first('sku');
  const variantClash = await db('product_variants').whereIn('sku', skus).modify((qb) => { if (id) qb.whereNot({ product_id: id }); }).first('sku');
  if (productClash || variantClash) return fail({ sku: `SKU ${(productClash || variantClash).sku} is already used by another product` });
  if (!(await db('categories').where({ id: d.category_id }).first('id'))) return fail({ category_id: 'Choose a category' });

  const slug = await uniqueSlug(db, 'products', d.slug || d.name, id);
  const row = {
    category_id: d.category_id,
    brand_id: d.brand_id,
    name: d.name,
    slug,
    sku: d.sku,
    short_description: d.short_description || null,
    description: d.description,
    details: d.details,
    low_stock_threshold: d.low_stock_threshold,
    has_variants: variants.length > 0,
    variant_label: d.variant_label || null,
    is_taxable: d.is_taxable, is_perishable: d.is_perishable, is_frozen: d.is_frozen, pickup_only: d.pickup_only,
    is_featured: d.is_featured, is_deal: d.is_deal, is_active: d.is_active,
    meta_title: d.meta_title || null,
    meta_description: d.meta_description || null,
  };
  if (!variants.length) Object.assign(row, { price_cents: d.price, compare_at_cents: d.compare_at, weight_grams: d.weight_grams });
  else if (!existing) Object.assign(row, { price_cents: variants[0].price, stock_qty: 0 });

  const productId = await db.transaction(async (trx) => {
    let pid = id;
    if (id) await trx('products').where({ id }).update(row);
    else [pid] = await trx('products').insert({ ...row, stock_qty: 0, price_cents: row.price_cents ?? 0 });

    if (removedVariantIds.length) await trx('product_variants').where({ product_id: pid }).whereIn('id', removedVariantIds).del();
    if (variants.length) {
      const known = new Set((await trx('product_variants').where({ product_id: pid }).pluck('id')));
      let order = 0;
      for (const v of variants) {
        const vRow = { name: v.name, sku: v.sku, price_cents: v.price, compare_at_cents: v.compare_at, weight_grams: v.weight_grams, is_active: v.is_active, sort_order: (order += 1) };
        let vid = v.id && known.has(v.id) ? v.id : null;
        if (vid) await trx('product_variants').where({ id: vid }).update(vRow);
        else [vid] = await trx('product_variants').insert({ ...vRow, product_id: pid, stock_qty: 0 });
        await Inventory.setStock({ productId: pid, variantId: vid, newQty: v.stock, reason: existing ? 'adjustment' : 'initial', note: 'Edited in product form', userId: req.user.id }, trx);
      }
      await Product.syncVariantAggregates(pid, trx);
    } else {
      // Simple product: any leftover variants are removed, stock set directly (and logged).
      await trx('product_variants').where({ product_id: pid }).del();
      await Inventory.setStock({ productId: pid, newQty: d.stock, reason: existing ? 'adjustment' : 'initial', note: 'Edited in product form', userId: req.user.id }, trx);
    }
    await Product.setTags(pid, d.tags.split(','), trx);
    await Product.rebuildSearchKeywords(pid, trx);
    return pid;
  });

  // ----- Images (outside the transaction: files are written to disk) -----
  const current = await db('product_images').where({ product_id: productId });
  const toDelete = current.filter((img) => d.image_delete.includes(img.id));
  if (toDelete.length) {
    await db('product_images').whereIn('id', toDelete.map((i) => i.id)).del();
    for (const img of toDelete) {
      if (!img.path.startsWith('seed/')) { await Image.removeFile(img.path); if (img.thumb_path !== img.path) await Image.removeFile(img.thumb_path); }
    }
  }
  const orderIds = d.image_order.split(',').map(Number).filter(Boolean);
  let position = 0;
  for (const img of current.filter((i) => !d.image_delete.includes(i.id)).sort((a, b) => {
    const ai = orderIds.indexOf(a.id); const bi = orderIds.indexOf(b.id);
    return (ai === -1 ? 1e6 + a.sort_order : ai) - (bi === -1 ? 1e6 + b.sort_order : bi);
  })) {
    await db('product_images').where({ id: img.id }).update({ sort_order: (position += 1), alt: (d.image_alt[String(img.id)] || '').trim() || null });
  }
  const uploadErrors = [];
  for (const file of req.files || []) {
    try {
      const saved = await Image.saveImage(file, 'products');
      await db('product_images').insert({ product_id: productId, ...saved, alt: d.name, sort_order: (position += 1) });
    } catch (err) {
      if (!err.expose) throw err;
      uploadErrors.push(`${file.originalname}: ${err.message}`);
    }
  }

  await Audit.log(req, id ? 'update' : 'create', 'products', productId, { name: d.name, sku: d.sku });
  req.flash('success', `Product "${d.name}" saved.`);
  if (uploadErrors.length) req.flash('error', `Some images were not uploaded - ${uploadErrors.join('; ')}`);
  return res.redirect(`/admin/products/${productId}/edit`);
}

/** POST /admin/products/:id/delete */
async function remove(req, res, next) {
  const product = await Product.findById(Number(req.params.id) || 0);
  if (!product) return next();
  await db('products').where({ id: product.id }).del(); // order_items keep their snapshots (product_id -> NULL)
  for (const img of product.images) {
    if (!img.path.startsWith('seed/')) { await Image.removeFile(img.path); if (img.thumb_path !== img.path) await Image.removeFile(img.thumb_path); }
  }
  await Audit.log(req, 'delete', 'products', product.id, { name: product.name, sku: product.sku });
  req.flash('success', `Product "${product.name}" deleted. Past orders are not affected.`);
  return res.redirect('/admin/products');
}

/** Sellable units (simple products and variants) for bulk edit, inventory and CSV export. */
function unitsQuery() {
  return db('products as p').leftJoin('product_variants as v', 'v.product_id', 'p.id')
    .leftJoin('brands as b', 'b.id', 'p.brand_id').join('categories as c', 'c.id', 'p.category_id')
    .select(
      'p.id as product_id', 'v.id as variant_id', 'p.name', 'v.name as variant_name', 'p.is_active', 'p.low_stock_threshold',
      db.raw('COALESCE(v.sku, p.sku) as sku'), db.raw('COALESCE(v.price_cents, p.price_cents) as price_cents'),
      db.raw('IF(v.id IS NULL, p.compare_at_cents, v.compare_at_cents) as compare_at_cents'),
      db.raw('COALESCE(v.stock_qty, p.stock_qty) as stock_qty'), db.raw('COALESCE(v.weight_grams, p.weight_grams) as weight_grams'),
      'b.name as brand', 'c.slug as category_slug', 'p.is_taxable', 'p.is_perishable', 'p.is_frozen', 'p.pickup_only', 'p.short_description',
    )
    .where((w) => w.where('p.has_variants', false).orWhereNotNull('v.id'))
    .orderBy([{ column: 'p.name' }, { column: 'v.sort_order' }, { column: 'v.id' }]);
}

function applyUnitSearch(query, q) {
  if (!q) return query;
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return query.where((w) => w.where('p.name', 'like', like).orWhere('p.sku', 'like', like).orWhere('v.sku', 'like', like).orWhere('v.name', 'like', like));
}

/** GET /admin/products/bulk - spreadsheet-style price and stock editing */
async function bulkForm(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const q = String(req.query.q || '').trim().slice(0, 80);
  const perPage = 60;
  const rows = await applyUnitSearch(unitsQuery(), q).limit(perPage + 1).offset((page - 1) * perPage);
  res.render('admin/products-bulk', { title: 'Bulk price & stock edit', rows: rows.slice(0, perPage), hasMore: rows.length > perPage, page, q });
}

const bulkSchema = z.object({
  items: z.record(z.string(), z.object({ price: z.string().max(20), compare_at: z.string().max(20).optional(), stock: z.string().max(10) })).default({}),
});

/** POST /admin/products/bulk */
async function bulkSave(req, res) {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) { req.flash('error', 'The form could not be read. Please try again.'); return res.redirect('/admin/products/bulk'); }
  let changed = 0;
  const problems = [];
  await db.transaction(async (trx) => {
    const touchedProducts = new Set();
    for (const [key, item] of Object.entries(parsed.data.items).slice(0, 500)) {
      const m = /^(p|v)-(\d+)$/.exec(key);
      if (!m) continue;
      const isVariant = m[1] === 'v';
      const table = isVariant ? 'product_variants' : 'products';
      const row = await trx(table).where({ id: Number(m[2]) }).first();
      if (!row) continue;
      const price = parseMoney(item.price);
      const compare = item.compare_at === undefined || item.compare_at.trim() === '' ? null : parseMoney(item.compare_at);
      const stock = Number(item.stock);
      if (price === null || !Number.isInteger(stock) || stock < 0 || (item.compare_at && item.compare_at.trim() && compare === null)) {
        problems.push(row.sku);
        continue;
      }
      const productId = isVariant ? row.product_id : row.id;
      if (price !== row.price_cents || compare !== row.compare_at_cents) {
        await trx(table).where({ id: row.id }).update({ price_cents: price, compare_at_cents: compare && compare > price ? compare : null });
        changed += 1;
        touchedProducts.add(productId);
      }
      if (stock !== row.stock_qty) {
        await Inventory.setStock({ productId, variantId: isVariant ? row.id : null, newQty: stock, note: 'Bulk edit', userId: req.user.id }, trx);
        changed += 1;
      }
    }
    for (const pid of touchedProducts) await Product.syncVariantAggregates(pid, trx);
  });
  await Audit.log(req, 'bulk_edit', 'products', null, { changed });
  req.flash('success', `${changed} change${changed === 1 ? '' : 's'} saved.`);
  if (problems.length) req.flash('error', `Not saved (invalid price or stock): ${problems.slice(0, 10).join(', ')}`);
  return res.redirect(req.body.return_to && /^\/admin\/products\/bulk[?\w=&%-]*$/.test(req.body.return_to) ? req.body.return_to : '/admin/products/bulk');
}

/** GET /admin/products/export.csv */
async function exportCsv(req, res) {
  const rows = await unitsQuery().limit(50000);
  const ids = [...new Set(rows.map((r) => r.product_id))];
  const tags = ids.length ? await db('product_tags').whereIn('product_id', ids).select('product_id', 'tag') : [];
  const tagMap = new Map();
  for (const t of tags) tagMap.set(t.product_id, [...(tagMap.get(t.product_id) || []), t.tag]);
  const out = rows.map((r) => ({
    sku: r.sku, name: r.name, variant: r.variant_name || '', category_slug: r.category_slug, brand: r.brand || '',
    price: (r.price_cents / 100).toFixed(2), compare_at_price: r.compare_at_cents ? (r.compare_at_cents / 100).toFixed(2) : '',
    stock: r.stock_qty, low_stock_threshold: r.low_stock_threshold, weight_grams: r.weight_grams,
    is_taxable: r.is_taxable ? 1 : 0, is_perishable: r.is_perishable ? 1 : 0, is_frozen: r.is_frozen ? 1 : 0, pickup_only: r.pickup_only ? 1 : 0,
    is_active: r.is_active ? 1 : 0, tags: (tagMap.get(r.product_id) || []).join('|'), short_description: r.short_description || '',
  }));
  await Audit.log(req, 'export', 'products', null, { rows: out.length });
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send(`﻿${Csv.toCsv(IMPORT_COLUMNS, out)}`);
}

const IMPORT_COLUMNS = ['sku', 'name', 'variant', 'category_slug', 'brand', 'price', 'compare_at_price', 'stock', 'low_stock_threshold',
  'weight_grams', 'is_taxable', 'is_perishable', 'is_frozen', 'pickup_only', 'is_active', 'tags', 'short_description'];

/** GET /admin/products/import */
function importForm(req, res) {
  res.render('admin/products-import', { title: 'Import products (CSV)', columns: IMPORT_COLUMNS, report: null });
}

/**
 * POST /admin/products/import
 * Upserts by SKU. A SKU that matches an existing variant updates that variant's price/stock/weight;
 * a SKU that matches a product updates it; an unknown SKU creates a new simple product.
 */
async function importCsv(req, res) {
  if (!req.file) { req.flash('error', 'Choose a CSV file to import.'); return res.redirect('/admin/products/import'); }
  let records;
  try {
    records = Csv.parseCsv(req.file.buffer);
  } catch (err) {
    req.flash('error', `The file could not be read as CSV: ${err.message}`);
    return res.redirect('/admin/products/import');
  }
  if (records.length > 2000) { req.flash('error', 'Import up to 2,000 rows at a time.'); return res.redirect('/admin/products/import'); }

  const [categories, brands] = await Promise.all([db('categories').select('id', 'slug'), db('brands').select('id', 'name')]);
  const catBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));
  const report = { created: 0, updated: 0, errors: [] };
  const has = (r, k) => r[k] !== undefined && String(r[k]).trim() !== '';

  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    const line = i + 2;
    const skuValue = String(r.sku || '').trim();
    try {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(skuValue)) throw new Error('missing or invalid sku');
      const price = has(r, 'price') ? parseMoney(r.price) : undefined;
      if (price === null) throw new Error('invalid price');
      const compare = has(r, 'compare_at_price') ? parseMoney(r.compare_at_price) : null;
      const stock = has(r, 'stock') ? Number(r.stock) : undefined;
      if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) throw new Error('invalid stock');
      const weight = has(r, 'weight_grams') ? Number(r.weight_grams) : undefined;
      if (weight !== undefined && (!Number.isInteger(weight) || weight < 0)) throw new Error('invalid weight_grams');

      await db.transaction(async (trx) => {
        const variant = await trx('product_variants').where({ sku: skuValue }).first();
        if (variant) {
          const upd = {};
          if (price !== undefined) { upd.price_cents = price; upd.compare_at_cents = compare && compare > price ? compare : null; }
          if (weight !== undefined) upd.weight_grams = weight;
          if (Object.keys(upd).length) await trx('product_variants').where({ id: variant.id }).update(upd);
          if (stock !== undefined) await Inventory.setStock({ productId: variant.product_id, variantId: variant.id, newQty: stock, reason: 'import', note: 'CSV import', userId: req.user.id }, trx);
          await Product.syncVariantAggregates(variant.product_id, trx);
          report.updated += 1;
          return;
        }
        const fields = {};
        if (has(r, 'name')) fields.name = String(r.name).trim().slice(0, 190);
        if (has(r, 'category_slug')) {
          const cid = catBySlug.get(String(r.category_slug).trim());
          if (!cid) throw new Error(`unknown category_slug "${r.category_slug}"`);
          fields.category_id = cid;
        }
        if (has(r, 'brand')) {
          const name = String(r.brand).trim().slice(0, 120);
          let bid = brandByName.get(name.toLowerCase());
          if (!bid) {
            [bid] = await trx('brands').insert({ name, slug: await uniqueSlug(trx, 'brands', name) });
            brandByName.set(name.toLowerCase(), bid);
          }
          fields.brand_id = bid;
        }
        if (has(r, 'low_stock_threshold') && Number.isInteger(Number(r.low_stock_threshold))) fields.low_stock_threshold = Math.max(0, Number(r.low_stock_threshold));
        if (has(r, 'short_description')) fields.short_description = String(r.short_description).trim().slice(0, 300);
        for (const flag of ['is_taxable', 'is_perishable', 'is_frozen', 'pickup_only', 'is_active']) {
          if (has(r, flag)) fields[flag] = Csv.parseBool(r[flag], false);
        }

        const product = await trx('products').where({ sku: skuValue }).first();
        let pid;
        if (product) {
          pid = product.id;
          if (!product.has_variants) {
            if (price !== undefined) { fields.price_cents = price; fields.compare_at_cents = compare && compare > price ? compare : null; }
            if (weight !== undefined) fields.weight_grams = weight;
          }
          if (Object.keys(fields).length) await trx('products').where({ id: pid }).update(fields);
          if (stock !== undefined && !product.has_variants) await Inventory.setStock({ productId: pid, newQty: stock, reason: 'import', note: 'CSV import', userId: req.user.id }, trx);
          report.updated += 1;
        } else {
          if (!fields.name) throw new Error('name is required for a new product');
          if (!fields.category_id) throw new Error('category_slug is required for a new product');
          if (price === undefined) throw new Error('price is required for a new product');
          [pid] = await trx('products').insert({
            is_taxable: true, ...fields, sku: skuValue, slug: await uniqueSlug(trx, 'products', fields.name), price_cents: price,
            compare_at_cents: compare && compare > price ? compare : null, weight_grams: weight || 0, stock_qty: 0,
            description: fields.short_description ? `<p>${slugify(fields.short_description) ? require('../../lib/html').stripTags(fields.short_description) : ''}</p>` : null,
          });
          if (stock) await Inventory.setStock({ productId: pid, newQty: stock, reason: 'import', note: 'CSV import (new product)', userId: req.user.id }, trx);
          report.created += 1;
        }
        if (has(r, 'tags')) await Product.setTags(pid, String(r.tags).split(/[|;]/), trx);
        await Product.rebuildSearchKeywords(pid, trx);
      });
    } catch (err) {
      report.errors.push(`Line ${line}${skuValue ? ` (${skuValue})` : ''}: ${err.code ? 'database error' : err.message}`);
    }
  }
  await Audit.log(req, 'import', 'products', null, { created: report.created, updated: report.updated, errors: report.errors.length });
  return res.render('admin/products-import', { title: 'Import products (CSV)', columns: IMPORT_COLUMNS, report });
}

module.exports = { list, form, save, remove, bulkForm, bulkSave, exportCsv, importForm, importCsv, unitsQuery, applyUnitSearch };
