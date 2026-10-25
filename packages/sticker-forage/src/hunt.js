// 表情包「觅食」：上网找图 → 安全下载 → 候选收件箱。
//
// 职责边界：
// - 这个模块只负责「找到并拿回一张合法的图片」，**不碰 QQ 账号**。
//   真正调用 add_custom_face / modify_custom_face 的是调用方（bridge.js / CLI），
//   这样收藏动作始终经过同一道限频与审计，不会因为多一个入口就绕开。
//
// 为什么不用浏览器自动化：B 站的教训（见 CDN/博客）同样适用于图站——
// 加载页面、截图、点按钮又慢又脆；Bing 图片搜索页里已经带了直链（murl），
// 拿直链 + 安全下载 + 本地校验，三步就够。
//
// 安全设计（与 safe-fetch.js 同一套口径）：
// - 只允许 http/https 公网地址；safeFetchBuffer 会做 DNS/私网/重定向逐跳校验。
// - 只接受 PNG/JPEG/GIF/WebP 四种格式，且必须能从文件头解出宽高。
// - 体积、边长、宽高比都有上下限：表情包不是壁纸，太大的图既占收藏空间也吃流量。
// - 标题会单行化、截断；Bing 的标题是外部内容，不是指令。
//
// 设计原则：候选收件箱是**临时**的（默认 24 小时），收藏进 QQ 之后它就没用了；
// 真正长期保存的是 state/stickers.json 里那条带备注/笔记的表情记录。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeFetch, safeFetchBuffer } from '../../safe-fetch/src/index.js';

export const INBOX_VERSION = 1;
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_GIF_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MIN_SIDE = 96;
export const DEFAULT_MAX_SIDE = 4096;
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_CANDIDATES = 3;
export const DEFAULT_SEARCH_LIMIT = 20;

// 标题黑名单：极少数查询会把奇怪的东西带进来，宁可少几张也不要收藏夹变味。
const TITLE_BLOCKLIST = /(色情|裸|约炮|成人|sex|porn|nude)/i;

/** 构造 Bing 图片搜索页地址（不需要 API key，解析页内 murl 直链）。 */
export function buildBingImageUrl(query, { first = 1 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('搜索词为空');
  const url = new URL('https://cn.bing.com/images/search');
  url.searchParams.set('q', q);
  url.searchParams.set('form', 'HDRSC2');
  url.searchParams.set('first', String(Math.max(1, Number(first) || 1)));
  url.searchParams.set('setlang', 'zh-hans');
  url.searchParams.set('cc', 'CN');
  // Bing 的成人数码过滤：严格模式。loc=zh-CN 让结果更贴近中文表情包。
  url.searchParams.set('adlt', 'strict');
  url.searchParams.set('loc', 'zh-CN');
  return url.toString();
}

/** 解码 HTML 实体（只覆盖 Bing 页面里实际会出现的几种，够用且不引入依赖）。 */
export function decodeHtmlEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 单行化外部标题：压平空白、去掉控制字符、限长。 */
export function sanitizeTitle(value, max = 80) {
  const cleaned = String(value ?? '')
    .replace(/[\s\u00a0\u3000]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .trim();
  return Array.from(cleaned).slice(0, Math.max(1, Number(max) || 80)).join('');
}

function hostOf(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    if (u.username || u.password) return '';
    return u.host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 从 Bing 图片搜索页里解析直链。
 *
 * 页面结构：每个结果是一个 `<a class="iusc" m="{...}">`，m 里是 HTML 实体编码的 JSON，
 * 关键字段 murl（原图）、turl（缩略图）、t（标题）、purl（来源页）。
 * 解析失败时退回「只抓 murl」的正则，保证页面小改版时不至于全灭。
 */
export function parseBingImages(html, { limit = DEFAULT_SEARCH_LIMIT } = {}) {
  const max = Math.max(1, Math.min(50, Number(limit) || DEFAULT_SEARCH_LIMIT));
  const out = [];
  const seen = new Set();
  const push = (item) => {
    const imageUrl = String(item?.murl ?? '').trim();
    if (!imageUrl || seen.has(imageUrl)) return;
    const host = hostOf(imageUrl);
    if (!host) return;
    const title = sanitizeTitle(item?.t);
    if (TITLE_BLOCKLIST.test(title)) return;
    const pageUrl = hostOf(item?.purl) ? String(item.purl).trim() : '';
    seen.add(imageUrl);
    out.push({ imageUrl, pageUrl, title, host });
  };
  for (const match of String(html ?? '').matchAll(/m="([^"]+)"/g)) {
    try {
      const json = JSON.parse(decodeHtmlEntities(match[1]));
      if (json && typeof json === 'object') push(json);
    } catch {
      // 单个结果解析失败不影响其它结果
    }
    if (out.length >= max) return out;
  }
  if (out.length) return out;
  for (const match of String(html ?? '').matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+)/g)) {
    push({ murl: decodeHtmlEntities(match[1]) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 从文件头解析图片宽高。只支持 PNG/JPEG/GIF/WebP —— 与 DSH 支持的图片格式一致，
 * 也正好是 QQ 收藏表情能接受的格式。
 * @returns {{format:'png'|'jpeg'|'gif'|'webp', width:number, height:number}|null}
 */
export function detectImageInfo(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : null;
  if (!buf || buf.length < 16) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A，IHDR 的宽高在 16..24
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return width > 0 && height > 0 ? { format: 'png', width, height } : null;
  }
  // GIF: GIF87a / GIF89a，宽高为小端 16 位
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    return width > 0 && height > 0 ? { format: 'gif', width, height } : null;
  }
  // JPEG: 扫描 SOF0/1/2 等帧头
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset += 1; continue; }
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const size = buf.readUInt16BE(offset + 2);
      if (size < 2) return null;
      const isSof = (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 9 <= buf.length) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return width > 0 && height > 0 ? { format: 'jpeg', width, height } : null;
      }
      offset += 2 + size;
    }
    return null;
  }
  // WebP: RIFF....WEBP，再按 VP8 / VP8L / VP8X 三种块解析
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buf.length >= 30) {
      const width = 1 + buf.readUIntLE(24, 3);
      const height = 1 + buf.readUIntLE(27, 3);
      return width > 0 && height > 0 ? { format: 'webp', width, height } : null;
    }
    if (chunk === 'VP8 ' && buf.length >= 30) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return width > 0 && height > 0 ? { format: 'webp', width, height } : null;
    }
    if (chunk === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return width > 0 && height > 0 ? { format: 'webp', width, height } : null;
    }
  }
  return null;
}

/**
 * 判断一张图是否适合当表情包。
 *
 * 经验值：表情包通常接近正方形（0.4~2.5），边长 96 起；太小是图标，太大是壁纸。
 * GIF 单独限制得更小，因为动图在收藏/发送链路上更重。
 */
export function judgeStickerCandidate(info, { bytes = 0, minSide = DEFAULT_MIN_SIDE, maxSide = DEFAULT_MAX_SIDE, maxBytes = DEFAULT_MAX_BYTES, maxGifBytes = DEFAULT_MAX_GIF_BYTES } = {}) {
  if (!info) return { ok: false, reason: '不是有效图片（PNG/JPEG/GIF/WebP）' };
  const { width, height, format } = info;
  if (width < minSide || height < minSide) return { ok: false, reason: `尺寸太小（${width}x${height}）` };
  if (width > maxSide || height > maxSide) return { ok: false, reason: `尺寸太大（${width}x${height}）` };
  const aspect = width / height;
  // 表情包要接近方形；0.8~1.4 之外的基本是立绘、长条漫画、海报或截图，
  // 既不适合 QQ 气泡，也更容易混进「好看但不像表情」的图。
  if (aspect < 0.8 || aspect > 1.4) return { ok: false, reason: `宽高比不适合表情（${aspect.toFixed(2)}）` };
  const limit = format === 'gif' ? Math.min(maxBytes, maxGifBytes) : maxBytes;
  if (Number(bytes) > limit) return { ok: false, reason: `文件太大（${(Number(bytes) / 1024 / 1024).toFixed(1)}MB）` };
  if (Number(bytes) < 4096) return { ok: false, reason: '文件太小，可能是占位图' };
  return { ok: true };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** 生成候选 id（短、稳定、可当文件名）。 */
export function newCandidateId() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * 搜索并下载候选表情图。
 *
 * 只负责「找到合法的字节」，不落盘、不进 QQ。调用方拿到 buffer 后决定：
 * - 走 MCP 直接给模型看（base64）
 * - 存进收件箱等模型挑（saveInboxCandidate）
 *
 * @param {string} query 搜索词（如「猫咪 表情包」）
 * @param {object} options
 * @param {number} [options.limit] 最多返回几张（默认 3，上限 6 —— 再多上下文和流量都吃不消）
 * @param {Set<string>} [options.excludeMd5] 已收藏表情的 md5，避免重复下载
 * @param {number} [options.maxBytes] 单张体积上限
 * @param {number} [options.timeoutMs] 总预算（默认 45 秒）
 * @returns {Promise<{query:string, candidates:Array, skipped:number, reason?:string}>}
 */
export async function searchStickerImages(query, options = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('搜索词为空');
  const limit = Math.max(1, Math.min(6, Number(options.limit) || DEFAULT_MAX_CANDIDATES));
  const maxBytes = Math.max(64 * 1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
  const deadline = Date.now() + Math.max(5000, Number(options.timeoutMs) || 45000);
  const excludeMd5 = options.excludeMd5 instanceof Set ? options.excludeMd5 : new Set();
  const excludeSha = options.excludeSha256 instanceof Set ? options.excludeSha256 : new Set();

  const page = await safeFetch(buildBingImageUrl(q), 900000);
  if (page.statusCode < 200 || page.statusCode >= 300) {
    throw new Error(`Bing 图片搜索 HTTP ${page.statusCode}`);
  }
  const parsed = parseBingImages(page.body, { limit: Math.max(limit * 4, 12) });
  if (!parsed.length) return { query: q, candidates: [], skipped: 0, reason: '没有解析到图片结果（可能触发了验证或页面改版）' };

  const candidates = [];
  let skipped = 0;
  for (const item of parsed) {
    if (candidates.length >= limit) break;
    if (Date.now() > deadline) { skipped += 1; break; }
    let fetched;
    try {
      fetched = await safeFetchBuffer(item.imageUrl, maxBytes);
    } catch {
      skipped += 1;
      continue;
    }
    const info = detectImageInfo(fetched.buffer);
    const verdict = judgeStickerCandidate(info, { bytes: fetched.buffer.length, maxBytes });
    if (!verdict.ok) { skipped += 1; continue; }
    const digest = sha256(fetched.buffer);
    if (excludeSha.has(digest)) { skipped += 1; continue; }
    // QQ 收藏表情的 md5 与原始文件 md5 通常一致；对不上也没关系，只是少一道去重。
    const md5 = crypto.createHash('md5').update(fetched.buffer).digest('hex').toUpperCase();
    if (excludeMd5.has(md5)) { skipped += 1; continue; }
    excludeSha.add(digest);
    candidates.push({
      id: newCandidateId(),
      query: q,
      title: item.title || '',
      imageUrl: fetched.url,
      pageUrl: item.pageUrl || '',
      host: item.host,
      format: info.format,
      width: info.width,
      height: info.height,
      bytes: fetched.buffer.length,
      md5,
      sha256: digest,
      buffer: fetched.buffer
    });
  }
  return { query: q, candidates, skipped };
}

// ── 候选收件箱 ─────────────────────────────────────────────────────────────

function readJson(file, fallback) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

/** 读收件箱索引；损坏时当作空箱（候选是临时物，丢了不心痛）。 */
export function readInbox(indexFile) {
  const parsed = readJson(indexFile, null);
  const items = parsed && typeof parsed === 'object' && parsed.candidates && typeof parsed.candidates === 'object'
    ? parsed.candidates
    : {};
  const candidates = {};
  for (const [id, entry] of Object.entries(items)) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entry.file || !entry.createdAt) continue;
    candidates[id] = {
      id,
      query: String(entry.query ?? '').slice(0, 80),
      title: sanitizeTitle(entry.title),
      imageUrl: String(entry.imageUrl ?? ''),
      pageUrl: String(entry.pageUrl ?? ''),
      host: String(entry.host ?? ''),
      format: String(entry.format ?? ''),
      width: Number(entry.width) || 0,
      height: Number(entry.height) || 0,
      bytes: Number(entry.bytes) || 0,
      md5: String(entry.md5 ?? '').toUpperCase(),
      sha256: String(entry.sha256 ?? ''),
      file: String(entry.file),
      previewFile: String(entry.previewFile ?? ''),
      createdAt: Number(entry.createdAt) || 0,
      importedAt: Number(entry.importedAt) || 0
    };
  }
  return { version: INBOX_VERSION, candidates };
}

export function writeInbox(indexFile, inbox) {
  atomicWrite(indexFile, JSON.stringify({ version: INBOX_VERSION, candidates: inbox?.candidates ?? {} }, null, 2));
}

/**
 * 把候选写进收件箱（图片文件 + 索引）。
 * @returns {object} 去掉 buffer 后的候选元数据
 */
export function saveInboxCandidate({ dir, indexFile, candidate, maxEntries = 60 }) {
  if (!candidate?.buffer || !candidate?.id) throw new Error('候选缺少图片字节或 id');
  fs.mkdirSync(dir, { recursive: true });
  const ext = candidate.format === 'jpeg' ? 'jpg' : candidate.format || 'bin';
  const file = path.join(dir, `${candidate.id}.${ext}`);
  fs.writeFileSync(file, candidate.buffer, { mode: 0o600 });
  // 预览图是给模型「看图把关」用的缩略版；收藏时仍然用原图。
  let previewFile = '';
  if (candidate.previewBuffer) {
    previewFile = path.join(dir, `${candidate.id}.preview.webp`);
    fs.writeFileSync(previewFile, candidate.previewBuffer, { mode: 0o600 });
  }
  const inbox = readInbox(indexFile);
  const entry = {
    id: candidate.id,
    query: candidate.query,
    title: candidate.title,
    imageUrl: candidate.imageUrl,
    pageUrl: candidate.pageUrl,
    host: candidate.host,
    format: candidate.format,
    width: candidate.width,
    height: candidate.height,
    bytes: candidate.bytes,
    md5: candidate.md5,
    sha256: candidate.sha256,
    file,
    previewFile,
    createdAt: Date.now(),
    importedAt: 0
  };
  inbox.candidates[entry.id] = entry;
  const entries = Object.values(inbox.candidates).sort((a, b) => b.createdAt - a.createdAt);
  if (entries.length > maxEntries) {
    for (const stale of entries.slice(maxEntries)) {
      delete inbox.candidates[stale.id];
      try { fs.unlinkSync(stale.file); } catch {}
    }
  }
  writeInbox(indexFile, inbox);
  return { ...entry, file: undefined };
}

/** 取一个候选；超过 TTL 视为过期（返回 null，并顺手删文件）。 */
export function takeInboxCandidate(indexFile, id, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const inbox = readInbox(indexFile);
  const entry = inbox.candidates[String(id ?? '')];
  if (!entry) return null;
  const removeFiles = () => {
    try { fs.unlinkSync(entry.file); } catch {}
    if (entry.previewFile) { try { fs.unlinkSync(entry.previewFile); } catch {} }
  };
  if (ttlMs > 0 && entry.createdAt && Date.now() - entry.createdAt > ttlMs) {
    delete inbox.candidates[entry.id];
    removeFiles();
    writeInbox(indexFile, inbox);
    return null;
  }
  if (!fs.existsSync(entry.file)) {
    delete inbox.candidates[entry.id];
    writeInbox(indexFile, inbox);
    return null;
  }
  return { ...entry, buffer: fs.readFileSync(entry.file) };
}

/** 标记候选已收藏（保留记录一段时间，便于排查“为什么收藏夹里多了这张”）。 */
export function markInboxImported(indexFile, id) {
  const inbox = readInbox(indexFile);
  if (inbox.candidates[String(id ?? '')]) {
    inbox.candidates[String(id)].importedAt = Date.now();
    writeInbox(indexFile, inbox);
  }
}

/** 清理过期候选，返回删除条数。 */
export function cleanupInbox({ indexFile, ttlMs = DEFAULT_TTL_MS }) {
  const inbox = readInbox(indexFile);
  const now = Date.now();
  let removed = 0;
  for (const [id, entry] of Object.entries(inbox.candidates)) {
    if (ttlMs > 0 && entry.createdAt && now - entry.createdAt > ttlMs) {
      delete inbox.candidates[id];
      try { fs.unlinkSync(entry.file); } catch {}
      if (entry.previewFile) { try { fs.unlinkSync(entry.previewFile); } catch {} }
      removed += 1;
    } else if (!fs.existsSync(entry.file)) {
      delete inbox.candidates[id];
      removed += 1;
    }
  }
  if (removed) writeInbox(indexFile, inbox);
  return removed;
}

/** 给模型看的候选摘要（不含本地文件路径）。 */
export function formatCandidateForModel(entry, index) {
  const size = entry.width && entry.height ? `${entry.width}x${entry.height}` : '尺寸未知';
  const kb = Math.round((Number(entry.bytes) || 0) / 1024);
  return `${index + 1}. [${entry.id}] ${entry.title || '（无标题）'}（${size}, ${kb}KB, 来源 ${entry.host || entry.imageUrl}）`;
}
