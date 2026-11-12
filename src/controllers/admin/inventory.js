'use strict';
const db = require('../../config/db');
const Audit = require('../../models/audit');
const Inventory = require('../../services/inventory');
const { unitsQuery, applyUnitSearch } = require('./products');
const { z } = require('../../middleware/validation');

const PER_PAGE = 50;

/** GET /admin/inventory */
async function list(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const q = String(req.query.q || '').trim().slice(0, 80);
  const low = req.query.low === '1';
  let query = applyUnitSearch(unitsQuery(), q);
  if (low) query = query.whereRaw('COALESCE(v.stock_qty, p.stock_qty) <= p.low_stock_threshold');
  const rows = await query.limit(PER_PAGE + 1).offset((page - 1) * PER_PAGE);
  res.render('admin/inventory', { title: 'Inventory', rows: rows.slice(0, PER_PAGE), hasMore: rows.length > PER_PAGE, page, q, low });
}

const adjustSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  variant_id: z.any().optional().transform((v) => (v ? Number(v) || null : null)),
  mode: z.enum(['set', 'add', 'remove']),
  qty: z.coerce.number({ error: 'Enter a quantity' }).int('Enter a whole number').min(0).max(1000000),
  note: z.string().trim().max(255).optional(),
  return_to: z.string().max(300).optional(),
});

/** POST /admin/inventory/adjust - every change is written to inventory_logs */
async function adjust(req, res) {
  const d = req.valid;
  const back = d.return_to && /^\/admin\/inventory[?\w=&%-]*$/.test(d.return_to) ? d.return_to : '/admin/inventory';
  try {
    const after = await db.transaction(async (trx) => {
      const table = d.variant_id ? 'product_variants' : 'products';
      const where = d.variant_id ? { id: d.variant_id, product_id: d.product_id } : { id: d.product_id, has_variants: false };
      const row = await trx(table).where(where).forUpdate().first('stock_qty');
      if (!row) throw Object.assign(new Error('That item no longer exists.'), { expose: true });
      const target = d.mode === 'set' ? d.qty : d.mode === 'add' ? row.stock_qty + d.qty : row.stock_qty - d.qty;
      if (target < 0) throw Object.assign(new Error(`Cannot remove ${d.qty}: only ${row.stock_qty} in stock.`), { expose: true });
      await Inventory.setStock({ productId: d.product_id, variantId: d.variant_id, newQty: target, reason: 'adjustment', note: d.note || null, userId: req.user.id }, trx);
      return target;
    });
    await Audit.log(req, 'stock_adjust', 'products', d.product_id, { variant_id: d.variant_id, mode: d.mode, qty: d.qty, after, note: d.note });
    req.flash('success', `Stock updated. New quantity: ${after}.`);
  } catch (err) {
    if (!err.expose) throw err;
    req.flash('error', err.message);
  }
  res.redirect(back);
}

/** GET /admin/inventory/logs */
async function logs(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const productId = Number(req.query.product) || null;
  const rows = await db('inventory_logs as l').join('products as p', 'p.id', 'l.product_id')
    .leftJoin('product_variants as v', 'v.id', 'l.variant_id').leftJoin('users as u', 'u.id', 'l.user_id')
    .modify((qb) => { if (productId) qb.where('l.product_id', productId); })
    .select('l.*', 'p.name', 'v.name as variant_name', 'u.first_name', 'u.last_name')
    .orderBy('l.id', 'desc').limit(PER_PAGE + 1).offset((page - 1) * PER_PAGE);
  const product = productId ? await db('products').where({ id: productId }).first('id', 'name') : null;
  res.render('admin/inventory-logs', { title: 'Stock history', rows: rows.slice(0, PER_PAGE), hasMore: rows.length > PER_PAGE, page, product });
}

module.exports = { list, adjust, adjustSchema, logs };
