'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../config/logger');

// sharp is an optional dependency: on hosts where its native binary cannot install we simply
// store the original file and use it as its own thumbnail.
let sharp = null;
try {
  // eslint-disable-next-line global-require
  sharp = require('sharp');
  sharp.cache(false);
  sharp.concurrency(1);
} catch (err) {
  logger.warn('sharp is not available - images will be stored without WebP conversion');
}

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Detect the real image type from the file's magic bytes (never trust the client MIME alone). */
function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  return null;
}

/**
 * Validate and store an uploaded image under UPLOAD_DIR/<folder>/ with a random filename.
 * Returns paths relative to the uploads root: { path, thumb_path }.
 */
async function saveImage(file, folder, { maxWidth = 1400, thumbWidth = 480 } = {}) {
  const mime = sniff(file.buffer);
  if (!mime || !MIME_EXT[mime]) {
    const err = new Error('Unsupported image. Please upload a JPG, PNG, WebP or GIF file.');
    err.status = 400;
    err.expose = true;
    throw err;
  }
  const dir = path.join(env.uploadDir, folder);
  await fs.promises.mkdir(dir, { recursive: true });
  const id = crypto.randomBytes(12).toString('hex');

  if (sharp) {
    try {
      const main = `${folder}/${id}.webp`;
      const thumb = `${folder}/${id}-thumb.webp`;
      await sharp(file.buffer).rotate().resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).toFile(path.join(env.uploadDir, main));
      await sharp(file.buffer).rotate().resize({ width: thumbWidth, height: thumbWidth, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 }).toFile(path.join(env.uploadDir, thumb));
      return { path: main, thumb_path: thumb };
    } catch (err) {
      logger.warn('sharp failed to process an upload, storing the original instead', err);
    }
  }
  const rel = `${folder}/${id}.${MIME_EXT[mime]}`;
  await fs.promises.writeFile(path.join(env.uploadDir, rel), file.buffer);
  return { path: rel, thumb_path: rel };
}

/** Delete a stored file. Paths are confined to the uploads directory. */
async function removeFile(relPath) {
  if (!relPath) return;
  const full = path.resolve(env.uploadDir, relPath);
  if (!full.startsWith(path.resolve(env.uploadDir) + path.sep)) return;
  await fs.promises.unlink(full).catch(() => {});
}

module.exports = { saveImage, removeFile, sniff, hasSharp: () => Boolean(sharp) };
