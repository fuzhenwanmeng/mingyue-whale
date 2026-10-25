// 二维码 → PNG（零第三方依赖）。
//
// 为什么自己写 PNG：扫码登录的二维码要在本机直接看到，不能把登录 URL 发给第三方
// 二维码服务；也不想为了一个登录页引 canvas。矩阵来自 vendor/qrcode.cjs
// （qrcode-generator 1.4.4 · MIT · Kazuhiko Arase），这里只负责把矩阵画成灰度 PNG。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qrcode = require('../../vendor/qrcode.cjs');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

export function qrMatrix(text, { ec = 'M' } = {}) {
  const code = qrcode(0, ec);
  code.addData(String(text));
  code.make();
  const n = code.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r += 1) {
    const row = [];
    for (let c = 0; c < n; c += 1) row.push(code.isDark(r, c) === true);
    rows.push(row);
  }
  return rows;
}

/**
 * 生成灰度 PNG。
 * @param {string} text 二维码内容
 * @param {{scale?: number, margin?: number, ec?: 'L'|'M'|'Q'|'H'}} [options]
 * @returns {Buffer}
 */
export function qrPngBuffer(text, options = {}) {
  const scale = Math.max(2, Math.min(20, Number(options.scale) || 8));
  const margin = Math.max(0, Math.min(10, Number(options.margin ?? 3)));
  const matrix = qrMatrix(text, options);
  const n = matrix.length;
  const width = (n + margin * 2) * scale;
  const height = width;
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * (width + 1)] = 0; // filter: none
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!matrix[r][c]) continue;
      const x0 = (c + margin) * scale;
      const y0 = (r + margin) * scale;
      for (let dy = 0; dy < scale; dy += 1) {
        const rowStart = (y0 + dy) * (width + 1) + 1;
        raw.fill(0, rowStart + x0, rowStart + x0 + scale);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export function writeQrPng(file, text, options = {}) {
  const buf = qrPngBuffer(text, options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf, { mode: 0o600 });
  return { file, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}
