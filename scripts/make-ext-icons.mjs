// Generate the extension's PNG icons (16/48/128) from the REAL Aemulus mark
// (public/aemulus-mark.png) composited onto the dark brand tile — so the
// extension icon matches the site exactly. No image deps: hand-rolled PNG
// decode (for the mark) + encode (for the icons). Run: node scripts/make-ext-icons.mjs
import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// ---------- PNG decode (RGBA) ----------
function decodePng(path) {
  const buf = readFileSync(path);
  let p = 8, width = 0, height = 0, colorType = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const rb = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let v;
      if (ft === 0) v = rb; else if (ft === 1) v = rb + a; else if (ft === 2) v = rb + b; else if (ft === 3) v = rb + ((a + b) >> 1); else v = rb + paeth(a, b, c);
      out[y * stride + x] = v & 0xff;
    }
  }
  // normalize to RGBA
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (ch === 4) { rgba[i * 4] = out[i * 4]; rgba[i * 4 + 1] = out[i * 4 + 1]; rgba[i * 4 + 2] = out[i * 4 + 2]; rgba[i * 4 + 3] = out[i * 4 + 3]; }
    else if (ch === 3) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i]; rgba[i * 4 + 3] = 255; }
  }
  return { width, height, rgba };
}

// Box-filter downscale of an RGBA image (premultiplied alpha for clean edges).
function downscale(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor(dy * sh / dh), sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) * sh / dh));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor(dx * sw / dw), sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) * sw / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) {
        const i = (y * sw + x) * 4, al = src[i + 3] / 255;
        r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += src[i + 3]; n++;
      }
      const di = (dy * dw + dx) * 4, aa = a / n;
      const inv = aa > 0 ? 255 / a : 0;
      dst[di] = Math.round(r * inv); dst[di + 1] = Math.round(g * inv); dst[di + 2] = Math.round(b * inv); dst[di + 3] = Math.round(aa);
    }
  }
  return dst;
}

// ---------- PNG encode ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- compose: dark rounded tile + centered white mark ----------
const mark = decodePng("public/aemulus-mark.png");

function iconFor(size) {
  const bg = [13, 14, 17]; // #0d0e11
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const inx = Math.max(radius - x, x - (size - 1 - radius), 0);
    const iny = Math.max(radius - y, y - (size - 1 - radius), 0);
    const outside = (x < radius || x > size - 1 - radius) && (y < radius || y > size - 1 - radius) && Math.hypot(inx, iny) > radius;
    if (outside) { rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0; }
    else { rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = 255; }
  }
  // scale mark to ~62% width, keep aspect, center
  const tw = Math.round(size * 0.62);
  const th = Math.max(1, Math.round(tw * mark.height / mark.width));
  const scaled = downscale(mark.rgba, mark.width, mark.height, tw, th);
  const ox = Math.round((size - tw) / 2), oy = Math.round((size - th) / 2);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const px = ox + x, py = oy + y;
    if (px < 0 || py < 0 || px >= size || py >= size) continue;
    const s = (y * tw + x) * 4, d = (py * size + px) * 4;
    const a = scaled[s + 3] / 255;
    if (a <= 0) continue;
    rgba[d] = Math.round(scaled[s] * a + rgba[d] * (1 - a));
    rgba[d + 1] = Math.round(scaled[s + 1] * a + rgba[d + 1] * (1 - a));
    rgba[d + 2] = Math.round(scaled[s + 2] * a + rgba[d + 2] * (1 - a));
    rgba[d + 3] = 255;
  }
  return rgba;
}

mkdirSync("extension/icons", { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`extension/icons/icon${size}.png`, encodePng(size, iconFor(size)));
  console.log(`wrote extension/icons/icon${size}.png`);
}
