'use strict';
const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const seo = require('../controllers/seo');

const router = express.Router();
router.get('/robots.txt', seo.robots);
router.get('/sitemap.xml', asyncHandler(seo.sitemap));

module.exports = router;
