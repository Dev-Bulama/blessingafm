'use strict';
const db = require('../config/db');
const logger = require('../config/logger');

/** Record an admin action. Never throws: auditing must not break the action itself. */
async function log(req, action, entity = null, entityId = null, details = null) {
  try {
    await db('audit_logs').insert({
      user_id: req.user ? req.user.id : null,
      action,
      entity,
      entity_id: entityId === null || entityId === undefined ? null : String(entityId),
      details: details ? JSON.stringify(details).slice(0, 60000) : null,
      ip: req.ip,
    });
  } catch (err) {
    logger.error('audit log failed', err);
  }
}

module.exports = { log };
