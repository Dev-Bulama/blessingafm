'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const rfs = require('rotating-file-stream');
const env = require('./env');

/**
 * File logging with daily rotation. Logging must never stop the app from starting: if the
 * configured folder cannot be used we fall back to ./logs, then the system temp folder, and
 * finally to console output only.
 */
function usableDir() {
  for (const dir of [env.logDir, path.join(env.root, 'logs'), path.join(os.tmpdir(), 'blessing-logs')]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (err) { /* try the next one */ }
  }
  return null;
}

const dir = usableDir();
const sink = { write() {} };
function stream(name) {
  if (!dir) return sink;
  try {
    const s = rfs.createStream(name, { interval: '1d', maxFiles: 14, size: '10M', path: dir });
    s.on('error', () => {}); // a full disk or permission change must not crash the process
    return s;
  } catch (err) {
    return sink;
  }
}
const accessStream = stream('access.log');
const appStream = stream('app.log');

function write(level, msg, err) {
  const detail = err ? ` ${err.stack || err.message || JSON.stringify(err)}` : '';
  const line = `${new Date().toISOString()} [${level}] ${msg}${detail}\n`;
  try { appStream.write(line); } catch (e) { /* ignore */ }
  if (level === 'info') process.stdout.write(line); // also visible in the host's runtime log
  else process.stderr.write(line);
}

if (dir !== env.logDir) write('warn', `LOG_DIR "${env.logDir}" is not writable; logging to ${dir || 'the console only'}`);

module.exports = {
  dir,
  accessStream,
  info: (msg) => write('info', msg),
  warn: (msg, err) => write('warn', msg, err),
  error: (msg, err) => write('error', msg, err),
};
