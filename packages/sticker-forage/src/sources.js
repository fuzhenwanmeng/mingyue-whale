// 表情包来源适配器：梗鲸（aigengtu.com）为主，Bing 图片为补充。
//
// 为什么单独一层：
// - 「去哪找」和「怎么收」是两件事。sticker-hunt.js 负责安全下载/校验/收件箱；
//   这里只负责「把来源变成候选列表」，以后加新图库不用动收藏链路。
// - 梗鲸是 SSR 页面：一次 456KB 就带 2309 张卡片的 id/标题/预览，比逐页搜索省得多；
//   原图直链规律 `img.aigengtu.com/meme/<id>.webp`（1254×1254 webp）。
// - 标题是外部内容：单行化、黑名单、长度截断，绝不当作指令。
//
// 版权口径：这些是 DeepSeek 娘二创图，个人聊天收藏用；本地记录来源，不公开转载、不商用。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeFetch, safeFetchBuffer } from '../../safe-fetch/src/index.js';
import {
  searchStickerImages,
  detectImageInfo,
  judgeStickerCandidate,
  sanitizeTitle,
  newCandidateId
} from './hunt.js';

export const AIGENGTU_LIST_URL = 'https://aigengtu.com/DeepSeek%E5%A8%98';
export const AIGENGTU_IMAGE_BASE = 'https://img.aigengtu.com/meme';
export const AIGENGTU_PREVIEW_BASE = 'https://img.aigengtu.com/0_preview/meme';
export const AIGENGTU_CACHE_MS = 12 * 60 * 60 * 1000;
export const AIGENGTU_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// 标题黑名单：擦边、极端脏话、纯编号 —— 宁可少几张，也别让收藏夹变味。
// 注意这是「意图判断」不是「内容审核」：最终还要模型看图把关。
const TITLE_BLOCKLIST = [
  /性关系|性行为|涩图|色情|裸|约炮|成人|强奸|做爱|内射|乳|娇喘/i,
  /傻逼|操你|你妈|妈的|滚蛋|去死|杀了你/i,
  /喵你妈/i,
  // 立绘/写真类：标题看着正常，但图往往是全身/泳装，不适合当表情包。
  /泳装|比基尼|内衣|裙底|走光|浴室|湿身/i
];
const NUMERIC_TITLE = /『\s*\d{6,}\s*』/;
// 只有「DeepSeek鲸娘表情包」这类泛化标题的卡片，信息量太低，自动觅食时跳过。
const GENERIC_TITLE = /^(DeepSeek(娘|鲸娘)?|鲸娘)?[『「]?表情包[』」]?$/i;

/** 解码 HTML 实体（复用 sticker-hunt 的口径，但这里只处理标题场景）。 */
function decodeEntities(text) {
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

/**
 * 解析梗鲸列表页。
 * 结构：`<a class="card" href="/zh/meme/009" title="..."><img src="https://img.aigengtu.com/0_preview/meme/009.webp" ...></a>`
 * @returns {{id:string,title:string,previewUrl:string,fullUrl:string,pageUrl:string}[]}
 */
export function parseAigengtuListing(html) {
  const out = [];
  const seen = new Set();
  for (const match of String(html ?? '').matchAll(/<a class="card" href="([^"]+)" title="([^"]*)"[^>]*>\s*<img[^>]+src="([^"]+)"/g)) {
    const href = match[1];
    const idMatch = /\/(?:zh\/)?meme\/(\d+)/.exec(href);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    const title = sanitizeTitle(decodeEntities(match[2]));
    if (!title) continue;
    seen.add(id);
    out.push({
      id,
      title,
      previewUrl: `${AIGENGTU_PREVIEW_BASE}/${id}.webp`,
      fullUrl: `${AIGENGTU_IMAGE_BASE}/${id}.webp`,
      pageUrl: `https://aigengtu.com/zh/meme/${id}`
    });
  }
  return out;
}

/** 标题是否值得进入候选池（编号图、擦边图、无信息标题直接跳过）。 */
export function isAigengtuItemUsable(item) {
  const title = String(item?.title ?? '');
  if (!title) return false;
  if (GENERIC_TITLE.test(title)) return false;
  // 太短的标题没有判断依据（自动觅食看不到图，只能靠标题）。
  if (Array.from(title).length < 6) return false;
  if (NUMERIC_TITLE.test(title)) return false;
  // 纯数字标题的另一种写法：去掉「表情包」和标点后只剩数字
  const compact = title.replace(/表情包|DeepSeek(娘|鲸娘)?|鲸娘|《|》|『|』|「|」|[^\d]/g, '');
  if (compact.length >= 6 && /^\d+$/.test(compact)) return false;
  if (TITLE_BLOCKLIST.some((re) => re.test(title))) return false;
  return true;
}

function readJson(file, fallback) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

/**
 * 读取梗鲸索引：优先用未过期的缓存；过期后尝试刷新，失败则继续用旧缓存。
 * @param {{cacheFile:string, maxAgeMs?:number, force?:boolean}} options
 */
export async function loadAigengtuIndex({ cacheFile, maxAgeMs = AIGENGTU_CACHE_MS, force = false } = {}) {
  const cached = readJson(cacheFile, null);
  const fresh = cached && Array.isArray(cached.items) && cached.items.length && Date.now() - Number(cached.fetchedAt || 0) < maxAgeMs;
  if (fresh && !force) return { fetchedAt: cached.fetchedAt, items: cached.items, fromCache: true };
  try {
    const page = await safeFetch(AIGENGTU_LIST_URL, 900000);
    if (page.statusCode < 200 || page.statusCode >= 300) throw new Error(`HTTP ${page.statusCode}`);
    const items = parseAigengtuListing(page.body).filter(isAigengtuItemUsable);
    if (!items.length) throw new Error('没有解析到可用卡片（页面可能改版）');
    const fetchedAt = Date.now();
    if (cacheFile) atomicWriteJson(cacheFile, { fetchedAt, items });
    return { fetchedAt, items, fromCache: false };
  } catch (error) {
    if (cached && Array.isArray(cached.items) && cached.items.length && Date.now() - Number(cached.fetchedAt || 0) < AIGENGTU_MAX_AGE_MS) {
      return { fetchedAt: cached.fetchedAt, items: cached.items, fromCache: true, stale: true, note: `刷新失败，使用旧索引：${error?.message ?? error}` };
    }
    throw new Error(`梗鲸索引获取失败：${error?.message ?? error}`);
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex').toUpperCase();
}

function shuffle(items, rng = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 从梗鲸挑候选：随机抽「没用过」的卡片，下载原图 + 预览图并校验。
 *
 * 为什么随机而不是按 id 顺序：按顺序会永远只收前几十张；随机 + seen 记录
 * 才能慢慢把 2309 张逛成一个分布。
 *
 * @param {object} options
 * @param {number} [options.count] 要几张（默认 3）
 * @param {Set<string>} [options.excludeMd5] 已收藏表情的 md5
 * @param {string} [options.cacheFile] 索引缓存路径
 * @param {string} [options.seenFile] 已看过的卡片 id 记录
 * @param {number} [options.maxBytes] 单张上限
 * @returns {Promise<{source:'aigengtu', candidates:Array, skipped:number, note?:string}>}
 */
export async function huntAigengtu({ count = 3, excludeMd5 = new Set(), cacheFile, seenFile, maxBytes = 4 * 1024 * 1024, rng = Math.random } = {}) {
  const want = Math.max(1, Math.min(6, Number(count) || 3));
  const index = await loadAigengtuIndex({ cacheFile });
  const seen = seenFile ? new Set(readJson(seenFile, []) || []) : new Set();
  const pool = index.items.filter((item) => !seen.has(item.id));
  // 全都看过了就重新洗一轮：收藏夹是长期资产，重复看旧图不算错，只是不再新鲜。
  const candidatesPool = pool.length >= want ? pool : index.items;
  const picked = shuffle(candidatesPool, rng);
  const candidates = [];
  let skipped = 0;
  for (const item of picked) {
    if (candidates.length >= want) break;
    let full;
    try {
      full = await safeFetchBuffer(item.fullUrl, maxBytes);
    } catch {
      skipped += 1;
      continue;
    }
    const info = detectImageInfo(full.buffer);
    const verdict = judgeStickerCandidate(info, { bytes: full.buffer.length, maxBytes });
    if (!verdict.ok) { skipped += 1; continue; }
    const digest = sha256(full.buffer);
    const hash = md5(full.buffer);
    if (excludeMd5.has(hash)) { skipped += 1; continue; }
    let previewBuffer = null;
    try {
      const preview = await safeFetchBuffer(item.previewUrl, 512 * 1024);
      if (preview.buffer.length > 0) previewBuffer = preview.buffer;
    } catch {
      // 预览拿不到就用原图给模型看；不阻断收藏
    }
    candidates.push({
      id: newCandidateId(),
      source: 'aigengtu',
      sourceId: item.id,
      query: item.title,
      title: item.title,
      imageUrl: full.url,
      pageUrl: item.pageUrl,
      host: 'img.aigengtu.com',
      format: info.format,
      width: info.width,
      height: info.height,
      bytes: full.buffer.length,
      md5: hash,
      sha256: digest,
      buffer: full.buffer,
      previewBuffer
    });
  }
  if (seenFile && candidates.length) {
    const nextSeen = [...seen, ...candidates.map((c) => c.sourceId)].slice(-400);
    atomicWriteJson(seenFile, nextSeen);
  }
  return { source: 'aigengtu', candidates, skipped, note: index.note };
}

/**
 * 统一入口。
 * - source=aigengtu：随机逛梗鲸（不需要 query）
 * - source=bing：按 query 搜图
 * - source=auto：有 query 走 Bing，没 query 走梗鲸
 */
export async function huntStickers({ source = 'auto', query = '', count = 3, excludeMd5 = new Set(), cacheFile, seenFile, maxBytes, rng } = {}) {
  const q = String(query ?? '').trim();
  const choice = source === 'auto' ? (q ? 'bing' : 'aigengtu') : source;
  if (choice === 'aigengtu') {
    return huntAigengtu({ count, excludeMd5, cacheFile, seenFile, maxBytes, rng });
  }
  if (choice === 'bing') {
    if (!q) throw new Error('Bing 来源需要 query');
    const res = await searchStickerImages(q, { limit: count, excludeMd5, maxBytes });
    return {
      source: 'bing',
      candidates: res.candidates.map((c) => ({ ...c, source: 'bing', sourceId: '' })),
      skipped: res.skipped,
      note: res.reason
    };
  }
  throw new Error(`未知来源：${source}`);
}
