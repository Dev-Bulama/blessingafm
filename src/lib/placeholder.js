'use strict';

const PALETTES = {
  food: { bg: '#FFD400', panel: '#FFFFFF', accent: '#D81E1E', text: '#111111' },
  beauty: { bg: '#D81E1E', panel: '#FFFFFF', accent: '#111111', text: '#111111' },
  green: { bg: '#1E8A3C', panel: '#FFFFFF', accent: '#FFD400', text: '#111111' },
  black: { bg: '#111111', panel: '#FFD400', accent: '#D81E1E', text: '#111111' },
};

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((`${line} ${w}`).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = `${line} ${w}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/**
 * Neutral, locally generated placeholder artwork: a coloured tile with the product name.
 * No brand photography is copied or hot-linked.
 */
function placeholderSvg(name, { palette = 'food', caption = '', width = 800, height = 800 } = {}) {
  const p = PALETTES[palette] || PALETTES.food;
  const lines = wrap(name.toUpperCase(), 14);
  const fontSize = lines.some((l) => l.length > 11) ? 64 : 76;
  const lineH = fontSize * 1.12;
  const startY = height / 2 - ((lines.length - 1) * lineH) / 2 + fontSize * 0.35 - (caption ? 20 : 0);
  const tspans = lines
    .map((l, i) => `<text x="${width / 2}" y="${Math.round(startY + i * lineH)}" text-anchor="middle" font-family="Impact, 'Arial Narrow', Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${p.text}">${esc(l)}</text>`)
    .join('');
  const cap = caption
    ? `<text x="${width / 2}" y="${Math.round(startY + lines.length * lineH + 6)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="${p.accent === '#FFD400' ? '#111111' : p.accent}">${esc(caption.toUpperCase())}</text>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(name)}">
<rect width="${width}" height="${height}" fill="${p.bg}"/>
<circle cx="${width - 90}" cy="90" r="150" fill="${p.accent}" opacity="0.9"/>
<circle cx="70" cy="${height - 60}" r="110" fill="${p.accent}" opacity="0.35"/>
<rect x="70" y="${height / 2 - 220}" width="${width - 140}" height="440" rx="28" fill="${p.panel}" stroke="#111111" stroke-width="8"/>
${tspans}${cap}
</svg>
`;
}

module.exports = { placeholderSvg };
