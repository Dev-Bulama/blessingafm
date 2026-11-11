'use strict';
const db = require('../config/db');

const activeBanners = () => db('banners').where({ is_active: true }).orderBy([{ column: 'sort_order' }, { column: 'id' }]);
const activeFaqs = () => db('faqs').where({ is_active: true }).orderBy([{ column: 'sort_order' }, { column: 'id' }]);
const pageBySlug = (slug) => db('pages').where({ slug, is_published: true }).first();
const publishedPages = () => db('pages').where({ is_published: true }).select('slug', 'title', 'updated_at').orderBy('title');

module.exports = { activeBanners, activeFaqs, pageBySlug, publishedPages };
