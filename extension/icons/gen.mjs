import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

// ── PNG helpers ──────────────────────────────────────────────────────────────

function u32be(n) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function crc32(buf) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBuf, data]);
  const crc = u32be(crc32(combined));
  return Buffer.concat([u32be(data.length), typeBuf, data, crc]);
}

// ── Icon drawing ─────────────────────────────────────────────────────────────

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);

  // Fill background #161b22
  for (let i = 0; i < size * size; i++) {
    px[i * 4]     = 0x16;
    px[i * 4 + 1] = 0x1b;
    px[i * 4 + 2] = 0x22;
    px[i * 4 + 3] = 0xFF;
  }

  // Draw rounded square background (slightly lighter) ─ optional inner card
  const pad = Math.max(1, Math.round(size * 0.06));
  for (let y = pad; y < size - pad; y++) {
    for (let x = pad; x < size - pad; x++) {
      const i = (y * size + x) * 4;
      px[i]     = 0x21;
      px[i + 1] = 0x26;
      px[i + 2] = 0x2d;
      px[i + 3] = 0xFF;
    }
  }

  // Draw lightning bolt ⚡ as filled polygon
  // Normalised vertices of a simple zig-zag:
  //  Top triangle:    (0.62,0.08) → (0.30,0.55) → (0.58,0.55)
  //  Bottom triangle: (0.42,0.45) → (0.70,0.45) → (0.38,0.92)
  // Rasterise with scanlines

  const set = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    px[i]     = 0x58;   // accent blue #58a6ff
    px[i + 1] = 0xa6;
    px[i + 2] = 0xff;
    px[i + 3] = 0xFF;
  };

  // ── upper part of bolt (parallelogram tilted left) ──
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    if (t > 0.58) break;
    // left edge: from (0.60,0.08)→(0.28,0.58)
    const xl = size * (0.60 - t * 0.55);
    // right edge: from (0.78,0.08)→(0.58,0.58)
    const xr = size * (0.78 - t * 0.35);
    for (let x = xl; x <= xr; x++) set(x, y);
  }

  // ── lower part of bolt ──
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    if (t < 0.42) continue;
    // left edge: from (0.22,0.42)→(0.40,0.92)
    const xl = size * (0.22 + (t - 0.42) * 0.36);
    // right edge: from (0.52,0.42)→(0.70,0.92)
    const xr = size * (0.52 + (t - 0.42) * 0.36);
    for (let x = xl; x <= xr; x++) set(x, y);
  }

  // ── Build PNG image data (filter byte 0 per row) ──
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // None filter
    px.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // RGBA colour type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG magic
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Generate all sizes ────────────────────────────────────────────────────────

for (const size of [16, 48, 128]) {
  const png = makeIcon(size);
  writeFileSync(`icon${size}.png`, png);
  console.log(`icon${size}.png  (${png.length} bytes)`);
}
console.log('Done.');
