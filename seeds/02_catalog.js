'use strict';
const fs = require('fs');
const path = require('path');
const { slugify } = require('../src/lib/slug');
const { placeholderSvg } = require('../src/lib/placeholder');
const categories = require('./data/categories');
const products = require('./data/products');

const uploadDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '..', 'uploads');
const cents = (dollars) => Math.round(dollars * 100);

function writeSvg(rel, svg) {
  const full = path.join(uploadDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, svg);
  return rel;
}

/** Category tree, brands and sample products. Skipped when the catalogue already has products. */
exports.seed = async function seed(knex) {
  const existing = await knex('products').count({ n: 'id' }).first();
  if (Number(existing.n) > 0) {
    console.log('  Catalogue already has products - skipping sample catalogue');
    return;
  }

  // ----- Categories -----
  const subcatId = new Map(); // subcategory name -> { id, palette }
  let deptOrder = 0;
  for (const dept of categories) {
    const palette = dept.slug === 'beauty-store' ? 'beauty' : 'food';
    const [deptId] = await knex('categories').insert({
      name: dept.name, slug: dept.slug, description: dept.description, sort_order: (deptOrder += 1),
      image: writeSvg(`seed/categories/${dept.slug}.svg`, placeholderSvg(dept.name, { palette, width: 1200, height: 800 })),
    });
    let order = 0;
    for (const [name, subs, featured] of dept.children) {
      const slug = slugify(name);
      const [catId] = await knex('categories').insert({
        parent_id: deptId, name, slug, sort_order: (order += 1), is_featured: Boolean(featured),
        image: writeSvg(`seed/categories/${slug}.svg`, placeholderSvg(name, { palette: palette === 'food' ? 'green' : 'black' })),
      });
      let subOrder = 0;
      for (const sub of subs) {
        const [subId] = await knex('categories').insert({ parent_id: catId, name: sub, slug: slugify(sub), sort_order: (subOrder += 1) });
        subcatId.set(sub, { id: subId, palette });
      }
    }
  }

  // ----- Brands -----
  const brandNames = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort();
  const brandId = new Map();
  for (const name of brandNames) {
    const [id] = await knex('brands').insert({ name, slug: slugify(name) });
    brandId.set(name, id);
  }

  // ----- Products -----
  let n = 0;
  for (const p of products) {
    n += 1;
    const cat = subcatId.get(p.cat);
    if (!cat) throw new Error(`Unknown category "${p.cat}" for product "${p.name}"`);
    const slug = slugify(p.name);
    const sku = `${p.beauty ? 'BTY' : 'FOD'}-${String(1000 + n)}`;
    const variants = p.v || [];
    const first = variants[0];
    const taxable = p.beauty ? true : Boolean(p.tax);
    const [id] = await knex('products').insert({
      category_id: cat.id,
      brand_id: p.brand ? brandId.get(p.brand) : null,
      name: p.name,
      slug,
      sku,
      short_description: p.short,
      description: `<p>${p.short}</p>`,
      details: `<p>${p.details}</p>`,
      price_cents: cents(first ? Math.min(...variants.map((v) => v[1])) : p.price),
      compare_at_cents: first ? (first[4] ? cents(first[4]) : null) : (p.compare ? cents(p.compare) : null),
      stock_qty: first ? variants.reduce((s, v) => s + v[2], 0) : p.stock,
      weight_grams: first ? first[3] : p.w,
      has_variants: variants.length > 0,
      variant_label: p.label || null,
      is_taxable: taxable,
      is_perishable: Boolean(p.perishable),
      is_frozen: Boolean(p.frozen),
      pickup_only: Boolean(p.pickupOnly),
      is_featured: Boolean(p.featured),
      is_deal: Boolean(p.deal),
      sales_count: (n * 37) % 90, // varied so "best sellers" has an order on day one
      search_keywords: [p.brand, ...(p.tags || []), ...variants.map((v) => v[0])].filter(Boolean).join(' '),
      meta_description: p.short,
      created_at: new Date(Date.now() - (products.length - n) * 3600 * 1000),
    });

    if (variants.length) {
      await knex('product_variants').insert(variants.map((v, i) => ({
        product_id: id, name: v[0], sku: `${sku}-${i + 1}`, price_cents: cents(v[1]), stock_qty: v[2], weight_grams: v[3],
        compare_at_cents: v[4] ? cents(v[4]) : null, sort_order: i,
      })));
      // Product row mirrors the cheapest variant.
      const cheapest = [...variants].sort((a, b) => a[1] - b[1])[0];
      await knex('products').where({ id }).update({
        compare_at_cents: cheapest[4] ? cents(cheapest[4]) : null, weight_grams: cheapest[3],
      });
    }
    if (p.tags && p.tags.length) {
      await knex('product_tags').insert([...new Set(p.tags)].map((tag) => ({ product_id: id, tag })));
    }
    const img = writeSvg(`seed/products/${slug}.svg`, placeholderSvg(p.name, { palette: cat.palette, caption: p.brand || p.cat }));
    await knex('product_images').insert({ product_id: id, path: img, thumb_path: img, alt: p.name, sort_order: 0 });
    await knex('inventory_logs').insert({
      product_id: id, change_qty: first ? variants.reduce((s, v) => s + v[2], 0) : p.stock,
      qty_after: first ? variants.reduce((s, v) => s + v[2], 0) : p.stock, reason: 'initial', note: 'Opening stock (seed)',
    });
  }
  console.log(`  Seeded ${products.length} products, ${brandNames.length} brands and the category tree`);
};
