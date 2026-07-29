// Generate the extension's PNG icons (16/48/128) from code — a near-white
// Aemulus chevron on the dark brand ground. No image deps: a tiny hand-rolled
// PNG encoder (RGBA, one IDAT). Run: node scripts/make-ext-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// Draw a rounded dark tile with a light upward chevron (the Aemulus mark).
function draw(size) {
  const bg = [13, 14, 17, 255]; // #0d0e11
  const fg = [233, 235, 238, 255]; // #e9ebee
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const stroke = Math.max(1.4, size * 0.11);
  const cx = size / 2;
  const top = size * 0.26;
  const bottom = size * 0.76;
  const halfW = size * 0.26; // horizontal spread of the chevron feet

  const distToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-rect mask (transparent outside the tile)
      const inx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const iny = Math.max(radius - y, y - (size - 1 - radius), 0);
      const outside = Math.hypot(inx, iny) > radius;
      if (outside && (x < radius || x > size - 1 - radius) && (y < radius || y > size - 1 - radius)) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
        continue;
      }
      // base tile
      rgba[i] = bg[0]; rgba[i + 1] = bg[1]; rgba[i + 2] = bg[2]; rgba[i + 3] = bg[3];
      // chevron: two strokes from the feet up to the apex
      const dLeft = distToSeg(x, y, cx - halfW, bottom, cx, top);
      const dRight = distToSeg(x, y, cx + halfW, bottom, cx, top);
      const d = Math.min(dLeft, dRight);
      if (d <= stroke / 2) {
        rgba[i] = fg[0]; rgba[i + 1] = fg[1]; rgba[i + 2] = fg[2]; rgba[i + 3] = 255;
      } else if (d <= stroke / 2 + 1) {
        // 1px feather for smoother edges at small sizes
        const a = 1 - (d - stroke / 2);
        rgba[i] = Math.round(bg[0] * (1 - a) + fg[0] * a);
        rgba[i + 1] = Math.round(bg[1] * (1 - a) + fg[1] * a);
        rgba[i + 2] = Math.round(bg[2] * (1 - a) + fg[2] * a);
      }
    }
  }
  return rgba;
}

mkdirSync("extension/icons", { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`extension/icons/icon${size}.png`, encodePng(size, draw(size)));
  console.log(`wrote extension/icons/icon${size}.png`);
}
