'use strict';
const multer = require('multer');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const CSV_TYPES = new Set(['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain']);

function badFile(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

/** Image uploads: held in memory (max 5 MB each), type-checked, then written by the image service. */
const images = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 8, fields: 2000, fieldSize: 512 * 1024 },
  fileFilter(req, file, cb) {
    if (IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(badFile('Only JPG, PNG, WebP or GIF images can be uploaded.'));
  },
});

const csv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (CSV_TYPES.has(file.mimetype) || /\.csv$/i.test(file.originalname)) cb(null, true);
    else cb(badFile('Please upload a .csv file.'));
  },
});

module.exports = { images, csv };
