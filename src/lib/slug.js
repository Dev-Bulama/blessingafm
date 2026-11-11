'use strict';

function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Returns a slug that is unique in `table`, appending -2, -3... when needed. */
async function uniqueSlug(db, table, text, ignoreId) {
  const baseSlug = slugify(text) || 'item';
  let slug = baseSlug;
  for (let i = 2; i < 500; i += 1) {
    const q = db(table).where({ slug });
    if (ignoreId) q.whereNot({ id: ignoreId });
    const hit = await q.first('id');
    if (!hit) return slug;
    slug = `${baseSlug}-${i}`;
  }
  return `${baseSlug}-${Date.now()}`;
}

module.exports = { slugify, uniqueSlug };
