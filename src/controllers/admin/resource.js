'use strict';
const db = require('../../config/db');
const resources = require('../../config/adminResources');
const Audit = require('../../models/audit');
const Image = require('../../services/image');
const { z, fieldErrors } = require('../../middleware/validation');
const { parseMoney, centsToInput } = require('../../lib/money');
const { sanitizeRich } = require('../../lib/html');
const { uniqueSlug, slugify } = require('../../lib/slug');
const dates = require('../../lib/dates');

/** Build a zod schema from a resource's field definitions. */
function buildSchema(fields) {
  const shape = {};
  for (const f of fields) {
    const label = f.label.replace(/\s*\(.*\)$/, '');
    const empty = (v) => v === undefined || v === null || String(v).trim() === '';
    const requiredCheck = (schema) => (f.required
      ? z.any().optional().refine((v) => !empty(v), `${label} is required`).pipe(schema)
      : z.any().optional().transform((v) => (empty(v) ? undefined : v)).pipe(schema.optional()));
    switch (f.type) {
      case 'text':
      case 'textarea':
        shape[f.name] = requiredCheck(z.coerce.string().trim().max(f.max || 255, `${label} is too long`)).transform((v) => v ?? null);
        break;
      case 'slug':
        shape[f.name] = z.any().optional().transform((v) => (empty(v) ? '' : slugify(v)));
        break;
      case 'richtext':
        shape[f.name] = z.any().optional().transform((v) => sanitizeRich(empty(v) ? '' : String(v).slice(0, 200000)));
        break;
      case 'number':
        shape[f.name] = requiredCheck(z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`)
          .min(f.min ?? 0, `${label} is too small`).max(f.max ?? 1000000000, `${label} is too large`))
          .transform((v) => (v === undefined ? (f.nullable ? null : f.default ?? 0) : v));
        break;
      case 'money':
        shape[f.name] = requiredCheck(z.coerce.string().transform((v, ctx) => {
          const cents = parseMoney(v);
          if (cents === null || cents > 100000000) { ctx.addIssue({ code: 'custom', message: `${label}: enter an amount such as 12.99` }); return z.NEVER; }
          return cents;
        })).transform((v) => (v === undefined ? (f.nullable ? null : f.default ?? 0) : v));
        break;
      case 'bool':
        shape[f.name] = z.any().optional().transform((v) => v === '1' || v === 'on' || v === true || v === 'true');
        break;
      case 'select':
        shape[f.name] = requiredCheck(z.coerce.string().max(100)).transform((v) => (v === undefined ? null : f.numeric ? Number(v) : v));
        break;
      case 'date':
        shape[f.name] = requiredCheck(z.coerce.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: choose a date`))
          .transform((v) => (v === undefined ? null : dates.zonedToUtc(v, f.endOfDay ? '23:59:59' : '00:00:00')));
        break;
      case 'time':
        shape[f.name] = requiredCheck(z.coerce.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, `${label}: enter a time such as 14:00`))
          .transform((v) => (v === undefined ? null : `${v.slice(0, 5)}:00`));
        break;
      default: // image fields are handled from req.file
        break;
    }
  }
  return z.object(shape);
}

function getResource(req) {
  const key = req.params.resource;
  const resource = Object.prototype.hasOwnProperty.call(resources, key) ? resources[key] : null;
  if (!resource || !resource.roles.includes(req.user.role)) return null;
  return { key, ...resource };
}

/** Database row -> values for the form inputs. */
function formValues(resource, row) {
  const base = resource.toForm ? resource.toForm(row) : { ...row };
  for (const f of resource.fields) {
    const v = base[f.name];
    if (v === null || v === undefined) continue;
    if (f.type === 'money') base[f.name] = centsToInput(v);
    if (f.type === 'date') base[f.name] = dates.storeDate(v);
    if (f.type === 'bool') base[f.name] = Boolean(v);
  }
  return base;
}

async function resolveOptions(resource) {
  const out = {};
  for (const f of resource.fields) {
    if (f.type === 'select') out[f.name] = typeof f.options === 'function' ? await f.options() : f.options;
  }
  return out;
}

/** GET /admin/r/:resource */
async function list(req, res, next) {
  const resource = getResource(req);
  if (!resource) return next();
  const perPage = resource.perPage || 50;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const q = String(req.query.q || '').trim().slice(0, 80);
  const t = resource.table;
  const base = () => {
    const query = db(t);
    if (q && resource.search) {
      query.where((w) => resource.search.forEach((col) => w.orWhere(`${t}.${col}`, 'like', `%${q.replace(/[\\%_]/g, '\\$&')}%`)));
    }
    return query;
  };
  const [{ n }] = await base().count({ n: `${t}.id` });
  let query = base().orderBy(resource.orderBy.map((o) => ({ ...o, column: `${t}.${o.column}` }))).limit(perPage).offset((page - 1) * perPage);
  query = resource.listQuery ? resource.listQuery(query) : query.select(`${t}.*`);
  const rows = await query;
  return res.render('admin/resource-list', {
    title: resource.title, resource, rows, q, page, pages: Math.max(1, Math.ceil(Number(n) / perPage)), total: Number(n),
  });
}

/** GET /admin/r/:resource/new and /admin/r/:resource/:id/edit */
async function form(req, res, next) {
  const resource = getResource(req);
  if (!resource) return next();
  let row = null;
  if (req.params.id) {
    row = await db(resource.table).where({ id: Number(req.params.id) || 0 }).first();
    if (!row) return next();
  }
  const defaults = {};
  for (const f of resource.fields) if (f.default !== undefined) defaults[f.name] = f.type === 'money' ? centsToInput(f.default) : f.default;
  return res.render('admin/resource-form', {
    title: `${row ? 'Edit' : 'New'} ${resource.singular.toLowerCase()}`, resource, row,
    values: row ? formValues(resource, row) : defaults, options: await resolveOptions(resource),
  });
}

/** POST /admin/r/:resource and /admin/r/:resource/:id */
async function save(req, res, next) {
  const resource = getResource(req);
  if (!resource) return next();
  const id = req.params.id ? Number(req.params.id) || 0 : null;
  const existing = id ? await db(resource.table).where({ id }).first() : null;
  if (id && !existing) return next();
  const back = id ? `/admin/r/${resource.key}/${id}/edit` : `/admin/r/${resource.key}/new`;
  const fail = (errors) => {
    const { _csrf, ...old } = req.body;
    req.session.form = { old, errors };
    req.flash('error', Object.values(errors)[0] || 'Please check the form and try again.');
    return res.redirect(back);
  };

  const parsed = buildSchema(resource.fields).safeParse(req.body);
  if (!parsed.success) return fail(fieldErrors(parsed.error));
  let data = parsed.data;

  try {
    for (const f of resource.fields) {
      if (f.type === 'slug') {
        if (existing && f.lockOnEdit) data[f.name] = existing[f.name];
        else data[f.name] = await uniqueSlug(db, resource.table, data[f.name] || data[f.from], id);
      }
      if (f.unique && data[f.name]) {
        const clash = await db(resource.table).where({ [f.name]: data[f.name] }).modify((qb) => { if (id) qb.whereNot({ id }); }).first('id');
        if (clash) return fail({ [f.name]: `Another ${resource.singular.toLowerCase()} already uses this ${f.label.toLowerCase()}` });
      }
    }
    if (resource.beforeSave) data = await resource.beforeSave(data, { id, existing });
  } catch (err) {
    if (err.fieldErrors) return fail(err.fieldErrors);
    throw err;
  }

  // Image field: new upload replaces the old file; "remove" clears it.
  const imageField = resource.fields.find((f) => f.type === 'image');
  let oldImage = null;
  if (imageField) {
    if (req.file) {
      const saved = await Image.saveImage(req.file, resource.table);
      data[imageField.name] = saved.path;
      oldImage = existing ? existing[imageField.name] : null;
    } else if (req.body[`${imageField.name}_remove`] === '1' && existing) {
      data[imageField.name] = null;
      oldImage = existing[imageField.name];
    }
  }

  let savedId = id;
  if (id) await db(resource.table).where({ id }).update({ ...data, updated_at: new Date() });
  else [savedId] = await db(resource.table).insert(data);
  if (oldImage && !oldImage.startsWith('seed/')) await Image.removeFile(oldImage);
  if (resource.afterChange) await resource.afterChange();
  await Audit.log(req, id ? 'update' : 'create', resource.table, savedId, { name: data.name || data.title || data.code || data.question || null });
  req.flash('success', `${resource.singular} saved.`);
  return res.redirect(`/admin/r/${resource.key}`);
}

/** POST /admin/r/:resource/:id/delete */
async function remove(req, res, next) {
  const resource = getResource(req);
  if (!resource) return next();
  const row = await db(resource.table).where({ id: Number(req.params.id) || 0 }).first();
  if (!row) return next();
  const blocked = resource.canDelete ? await resource.canDelete(row) : null;
  if (blocked) {
    req.flash('error', blocked);
    return res.redirect(`/admin/r/${resource.key}`);
  }
  try {
    await db(resource.table).where({ id: row.id }).del();
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      req.flash('error', resource.deleteBlockedMessage || `This ${resource.singular.toLowerCase()} is in use and cannot be deleted. Deactivate it instead.`);
      return res.redirect(`/admin/r/${resource.key}`);
    }
    throw err;
  }
  const imageField = resource.fields.find((f) => f.type === 'image');
  if (imageField && row[imageField.name] && !row[imageField.name].startsWith('seed/')) await Image.removeFile(row[imageField.name]);
  if (resource.afterChange) await resource.afterChange();
  await Audit.log(req, 'delete', resource.table, row.id, { name: row.name || row.title || row.code || row.question || null });
  req.flash('success', `${resource.singular} deleted.`);
  return res.redirect(`/admin/r/${resource.key}`);
}

module.exports = { list, form, save, remove, buildSchema };
