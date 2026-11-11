'use strict';
const fs = require('fs');
const rfs = require('rotating-file-stream');
const env = require('./env');

fs.mkdirSync(env.logDir, { recursive: true });

const rotate = { interval: '1d', maxFiles: 14, size: '10M', path: env.logDir };
const accessStream = rfs.createStream('access.log', rotate);
const appStream = rfs.createStream('app.log', rotate);

function write(level, msg, err) {
  const detail = err ? ` ${err.stack || err.message || JSON.stringify(err)}` : '';
  const line = `${new Date().toISOString()} [${level}] ${msg}${detail}\n`;
  appStream.write(line);
  if (!env.isProd || level !== 'info') process.stderr.write(line);
  else process.stdout.write(line);
}

module.exports = {
  accessStream,
  info: (msg) => write('info', msg),
  warn: (msg, err) => write('warn', msg, err),
  error: (msg, err) => write('error', msg, err),
};
