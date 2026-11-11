'use strict';
const db = require('../config/db');

const TTL_MS = 60 * 1000;
let cache = null;
let cachedAt = 0;

function build(rows) {
  const byId = new Map();
  const bySlug = new Map();
  for (const r of rows) {
    const node = { ...r, children: [] };
    byId.set(r.id, node);
    bySlug.set(r.slug, node);
  }
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else if (!node.parent_id) roots.push(node);
  }
  const sorter = (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  roots.sort(sorter);
  for (const node of byId.values()) node.children.sort(sorter);
  return { roots, byId, bySlug };
}

/** Active category tree: departments -> categories -> subcategories. Cached in memory. */
async function tree() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const rows = await db('categories').where({ is_active: true }).select('*');
  cache = build(rows);
  cachedAt = Date.now();
  return cache;
}

/** Tree including inactive categories (admin). */
async function fullTree() {
  return build(await db('categories').select('*'));
}

function invalidate() {
  cache = null;
}

/** The id of a category plus all of its descendants. */
function descendantIds(node) {
  const ids = [node.id];
  for (const child of node.children) ids.push(...descendantIds(child));
  return ids;
}

/** Breadcrumb trail from the department down to `node`. */
function trail(t, node) {
  const out = [];
  let cur = node;
  while (cur) {
    out.unshift(cur);
    cur = cur.parent_id ? t.byId.get(cur.parent_id) : null;
  }
  return out;
}

/** Flat list for <select> menus with indentation depth. */
function flatten(t) {
  const out = [];
  const walk = (nodes, depth, prefix) => {
    for (const n of nodes) {
      const label = prefix ? `${prefix} › ${n.name}` : n.name;
      out.push({ id: n.id, name: n.name, slug: n.slug, depth, label });
      walk(n.children, depth + 1, label);
    }
  };
  walk(t.roots, 0, '');
  return out;
}

module.exports = { tree, fullTree, invalidate, descendantIds, trail, flatten };
