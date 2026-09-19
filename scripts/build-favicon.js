// ══════════════════════════════════════════════════════════════
//  Favicon builder — the Qnlys "Q" mark as the site favicon.
//
//  Composes the official Q artwork (extracted from public/Q.svg)
//  over a charcoal rounded tile (the app's dark identity), then
//  emits a multi-size ICO (256/64/48/32/16 — PNG-compressed entries,
//  supported by every modern browser). Run: node scripts/build-favicon.js
// ══════════════════════════════════════════════════════════════

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const MASTER = 512;          // composition canvas (supersampled)
const TILE_RADIUS = 108;     // rounded-tile corner radius @512
const Q_RATIO = 0.74;        // Q size relative to the tile
const CHARCOAL = '#0b0d11';  // the app canvas charcoal (globals.css)

/** Extract the official Q artwork (PNG payload embedded in public/Q.svg). */
function extractQArtwork() {
  const svg = fs.readFileSync('public/Q.svg', 'utf8');
  const m = svg.match(/href="data:image\/png;base64,([^"]+)"/);
  if (!m) throw new Error('No embedded PNG found in public/Q.svg');
  return Buffer.from(m[1], 'base64');
}

async function composeTile(size, qArtwork) {
  // Trim the artwork's transparent margins, then fit inside the tile.
  const trimmed = await sharp(qArtwork)
    .trim({ threshold: 8 })
    .toBuffer();

  const qSize = Math.round(size * Q_RATIO);
  const q = await sharp(trimmed)
    .resize(qSize, qSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const qMeta = await sharp(q).metadata();
  const pad = Math.round((size - qSize) / 2);

  const tile = Buffer.from(
    `<svg width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${Math.round((TILE_RADIUS * size) / MASTER)}" fill="${CHARCOAL}"/>` +
    `</svg>`
  );

  return sharp(tile)
    .composite([{ input: q, left: pad, top: pad + Math.round((size - pad * 2 - qMeta.height) / 2) }])
    .png()
    .toBuffer();
}

/** Minimal ICO container over PNG-compressed entries (Vista+ standard). */
function buildIco(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);        // reserved
  header.writeUInt16LE(1, 2);        // type: icon
  header.writeUInt16LE(count, 4);    // image count

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  pngEntries.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o + 0); // width (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    dir.writeUInt8(0, o + 2);       // palette
    dir.writeUInt8(0, o + 3);       // reserved
    dir.writeUInt16LE(1, o + 4);    // color planes
    dir.writeUInt16LE(32, o + 6);   // bits per pixel
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
    blobs.push(data);
  });

  return Buffer.concat([header, dir, ...blobs]);
}

(async () => {
  const qArtwork = extractQArtwork();
  const master = await composeTile(MASTER, qArtwork);
  fs.writeFileSync(path.join('scripts', 'favicon-preview.png'), master);

  const sizes = [256, 64, 48, 32, 16];
  const entries = [];
  for (const size of sizes) {
    const data = await sharp(master)
      .resize(size, size, { kernel: size <= 32 ? 'lanczos3' : 'cubic' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    entries.push({ size, data });
  }

  fs.writeFileSync('public/favicon.ico', buildIco(entries));

  // Modern-browser convenience copies (crisp SVG-free raster fallbacks).
  await sharp(master).resize(32, 32).png().toFile('public/favicon-32.png');
  await sharp(master).resize(16, 16).png().toFile('public/favicon-16.png');
  await sharp(master).resize(180, 180).png().toFile('public/apple-touch-icon.png');

  console.log('favicon.ico written:', fs.statSync('public/favicon.ico').size, 'bytes —', sizes.join('/'));
})();
