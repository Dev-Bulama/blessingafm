'use strict';
const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { validate } = require('../middleware/validation');
const { requireStaff, requireAdmin } = require('../middleware/roles');
const upload = require('../middleware/upload');
const dashboard = require('../controllers/admin/dashboard');
const products = require('../controllers/admin/products');
const inventory = require('../controllers/admin/inventory');
const orders = require('../controllers/admin/orders');
const customers = require('../controllers/admin/customers');
const misc = require('../controllers/admin/misc');
const resource = require('../controllers/admin/resource');

const router = express.Router();

// Everything under /admin needs a staff or admin account, uses the admin layout and is never cached.
router.use(requireStaff);
router.use((req, res, next) => {
  res.locals.layout = 'layouts/admin';
  res.locals.noindex = true;
  res.set('Cache-Control', 'no-store');
  next();
});

// ---------- Staff + admin: dashboard, orders, products, inventory ----------
router.get('/', asyncHandler(dashboard.index));

router.get('/orders', asyncHandler(orders.list));
router.get('/orders/export.csv', asyncHandler(orders.exportCsv));
router.get('/orders/:id', asyncHandler(orders.detail));
router.get('/orders/:id/invoice', asyncHandler(orders.print('invoice')));
router.get('/orders/:id/packing-slip', asyncHandler(orders.print('packing')));
router.post('/orders/:id/status', validate(orders.statusSchema, { back: (req) => `/admin/orders/${Number(req.params.id) || 0}` }), asyncHandler(orders.changeStatus));
router.post('/orders/:id/details', validate(orders.detailsSchema, { back: (req) => `/admin/orders/${Number(req.params.id) || 0}` }), asyncHandler(orders.saveDetails));

router.get('/products', asyncHandler(products.list));
router.get('/products/export.csv', asyncHandler(products.exportCsv));
router.get('/products/import', products.importForm);
router.post('/products/import', upload.csv.single('file'), asyncHandler(products.importCsv));
router.get('/products/bulk', asyncHandler(products.bulkForm));
router.post('/products/bulk', asyncHandler(products.bulkSave));
router.get('/products/new', asyncHandler(products.form));
router.post('/products', upload.images.array('images', 8), asyncHandler(products.save));
router.get('/products/:id/edit', asyncHandler(products.form));
router.post('/products/:id', upload.images.array('images', 8), asyncHandler(products.save));
router.post('/products/:id/delete', asyncHandler(products.remove));

router.get('/inventory', asyncHandler(inventory.list));
router.get('/inventory/logs', asyncHandler(inventory.logs));
router.post('/inventory/adjust', validate(inventory.adjustSchema, { back: '/admin/inventory' }), asyncHandler(inventory.adjust));

// Generic CRUD screens. Each resource declares which roles may use it (categories and brands: staff too).
router.get('/r/:resource', asyncHandler(resource.list));
router.get('/r/:resource/new', asyncHandler(resource.form));
router.post('/r/:resource', upload.images.single('image'), asyncHandler(resource.save));
router.get('/r/:resource/:id/edit', asyncHandler(resource.form));
router.post('/r/:resource/:id', upload.images.single('image'), asyncHandler(resource.save));
router.post('/r/:resource/:id/delete', asyncHandler(resource.remove));

// ---------- Admin only ----------
router.use(requireAdmin);

router.get('/customers', asyncHandler(customers.list));
router.get('/customers/:id', asyncHandler(customers.detail));
router.post('/customers/:id/toggle', asyncHandler(customers.toggle));

router.get('/staff', asyncHandler(customers.staff));
router.post('/staff', validate(customers.staffSchema, { back: '/admin/staff' }), asyncHandler(customers.createStaff));
router.post('/staff/:id', validate(customers.staffUpdateSchema, { back: '/admin/staff' }), asyncHandler(customers.updateStaff));

router.get('/reviews', asyncHandler(misc.reviews));
router.post('/reviews/:id', validate(misc.reviewActionSchema, { back: '/admin/reviews' }), asyncHandler(misc.moderateReview));

router.get('/subscribers', asyncHandler(misc.subscribers));
router.get('/subscribers/export.csv', asyncHandler(misc.exportSubscribers));

router.get('/messages', asyncHandler(misc.messages));
router.post('/messages/:id', validate(misc.messageActionSchema, { back: '/admin/messages' }), asyncHandler(misc.updateMessage));

router.get('/settings', misc.settings);
router.post('/settings', upload.images.single('logo'), validate(misc.settingsSchema, { back: '/admin/settings' }), asyncHandler(misc.saveSettings));
router.post('/settings/test-email', validate(misc.testEmailSchema, { back: '/admin/settings' }), asyncHandler(misc.testEmail));

router.get('/audit', asyncHandler(misc.audit));

module.exports = router;
