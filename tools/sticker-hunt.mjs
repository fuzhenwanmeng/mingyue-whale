#!/usr/bin/env node
// 表情包「觅食」命令行：上网找图 → 本地预览 → 收藏进 QQ。
//
// 为什么要有 CLI：桥接里的 MCP 工具是给 QQ 里的 AI 用的；这个是给
// 「人」（以及主会话里的我）调试/手动补货用的。两条入口共用 src/sticker-hunt.js，
// 收藏动作各自限频，互不绕过。
//
// 用法：
//   node tools/sticker-hunt.mjs search "猫猫 表情包" [--count 3] [--json]
//   node tools/sticker-hunt.mjs list
//   node tools/sticker-hunt.mjs import <候选id> [--remark "猫猫无语"] [--note "……"] [--tags 猫,无语] [--keep]
//   node tools/sticker-hunt.mjs import-url <图片URL> [--remark "..."] [--note "..."]
//   node tools/sticker-hunt.mjs clean
//
// 注意：import 会真的往 QQ 收藏表情里加一张图（可撤销，但不是无副作用）；
// 加之前建议先 search 看一眼候选标题/尺寸，或让桥接把图发给模型看。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  saveInboxCandidate,
  readInbox,
  takeInboxCandidate,
  cleanupInbox,
  markInboxImported,
  formatCandidateForModel,
  huntStickers,
  DEFAULT_TTL_MS
} from '../packages/sticker-forage/src/index.js';
import { safeFetchBuffer } from '../packages/safe-fetch/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INBOX_DIR = path.join(ROOT, 'state', 'sticker-inbox');
const INBOX_INDEX = path.join(INBOX_DIR, 'index.json');
const LOG_FILE = path.join(ROOT, 'state', 'sticker-hunt-log.jsonl');
const AIGENGTU_CACHE = path.join(ROOT, 'state', 'sticker-sources', 'aigengtu-index.json');
const AIGENGTU_SEEN = path.join(ROOT, 'state', 'sticker-sources', 'aigengtu-seen.json');

function loadConfig() {
  try {
    let text = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const key = arg.slice(2);
    const eq = key.indexOf('=');
    if (eq >= 0) { out[key.slice(0, eq)] = key.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function onebot(action, params = {}, timeoutMs = 60000) {
  const cfg = loadConfig();
  const base = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const token = cfg.snowluma?.accessToken || '';
  return fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs)
  }).then(async (res) => {
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.status !== 'ok' || body.retcode !== 0) {
      throw new Error(`${action} 失败: HTTP ${res.status} retcode=${body?.retcode ?? '?'} ${body?.wording ?? ''}`);
    }
    return body.data;
  });
}

function appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

function printCandidate(entry, index) {
  console.log(formatCandidateForModel(entry, index));
  if (entry.pageUrl) console.log(`     来源页：${entry.pageUrl.slice(0, 120)}`);
}

async function cmdSearch(args) {
  const query = args._.slice(1).join(' ').trim();
  const source = String(args.source ?? (query ? 'bing' : 'aigengtu')).toLowerCase();
  if (source === 'bing' && !query) throw new Error('用法：search "搜索词" [--count 3]；逛梗鲸可以不带词：search --source aigengtu');
  const count = Math.max(1, Math.min(6, Number(args.count) || 3));
  console.log(source === 'aigengtu' ? `去梗鲸随便逛逛（要 ${count} 张）…` : `在 Bing 图片里找「${query}」…`);
  const res = await huntStickers({
    source,
    query,
    count,
    cacheFile: AIGENGTU_CACHE,
    seenFile: AIGENGTU_SEEN
  });
  if (!res.candidates.length) {
    console.log(`没找到可用候选（跳过 ${res.skipped} 张）${res.note ? '：' + res.note : ''}`);
    return;
  }
  const saved = [];
  for (const candidate of res.candidates) {
    saved.push(saveInboxCandidate({ dir: INBOX_DIR, indexFile: INBOX_INDEX, candidate }));
  }
  console.log(`\n候选（已存进收件箱，24 小时内有效）：`);
  saved.forEach((entry, index) => printCandidate(entry, index));
  console.log(`\n满意就：node tools/sticker-hunt.mjs import <候选id> --remark "备注"`);
  if (args.json) console.log(`\n${JSON.stringify(saved.map((e) => ({ ...e, _: undefined })), null, 2)}`);
}

function cmdList() {
  const inbox = readInbox(INBOX_INDEX);
  const entries = Object.values(inbox.candidates).sort((a, b) => b.createdAt - a.createdAt);
  if (!entries.length) { console.log('收件箱是空的。'); return; }
  entries.forEach((entry, index) => {
    printCandidate(entry, index);
    console.log(`     ${entry.importedAt ? '已收藏' : '未收藏'} · ${new Date(entry.createdAt).toLocaleString('zh-CN')}`);
  });
}

async function addToQq(buffer, { remark }) {
  const data = await onebot('add_custom_face', { file: `base64://${buffer.toString('base64')}` }, 120000);
  const emojiId = String(data?.emoji_id ?? '');
  if (!emojiId) throw new Error('add_custom_face 没有返回 emoji_id');
  const cleanRemark = String(remark ?? '').trim().slice(0, 20);
  if (cleanRemark) {
    try {
      await onebot('modify_custom_face', { emoji_id: emojiId, desc: cleanRemark }, 30000);
    } catch (error) {
      console.warn(`⚠️ 收藏成功但备注失败：${error.message}`);
    }
  }
  return { emojiId, remark: cleanRemark };
}

async function cmdImport(args) {
  const id = String(args._[1] ?? '').trim();
  if (!id) throw new Error('用法：import <候选id> [--remark "..."] [--note "..."] [--tags a,b] [--keep]');
  const candidate = takeInboxCandidate(INBOX_INDEX, id, { ttlMs: DEFAULT_TTL_MS });
  if (!candidate) throw new Error(`候选 ${id} 不存在或已过期，先 search 一次`);
  if (args.dry) { console.log(`[dry] 会收藏 ${candidate.file}（${candidate.width}x${candidate.height}）`); return; }
  const result = await addToQq(candidate.buffer, { remark: args.remark ?? candidate.title });
  markInboxImported(INBOX_INDEX, id);
  if (!args.keep) { try { fs.unlinkSync(candidate.file); } catch {} }
  appendLog({ action: 'import', candidate: { id, title: candidate.title, imageUrl: candidate.imageUrl, pageUrl: candidate.pageUrl }, emojiId: result.emojiId, remark: result.remark });
  console.log(`✅ 已收藏：${result.emojiId}${result.remark ? `（备注：${result.remark}）` : ''}`);
  if (args.note || args.tags) {
    console.log(`本地认知：note=${args.note ?? ''} tags=${args.tags ?? ''}`);
    console.log('（CLI 不直接改桥接的表情库；下次桥接同步时会以 QQ 备注为准，本地笔记用 qq_sticker_note 写最稳。）');
  }
}

async function cmdImportUrl(args) {
  const url = String(args._[1] ?? '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('用法：import-url <http(s) 图片地址> [--remark "..."]');
  const fetched = await safeFetchBuffer(url, 4 * 1024 * 1024);
  const result = await addToQq(fetched.buffer, { remark: args.remark ?? '' });
  appendLog({ action: 'import-url', url: fetched.url, emojiId: result.emojiId, remark: result.remark, bytes: fetched.buffer.length });
  console.log(`✅ 已收藏：${result.emojiId}${result.remark ? `（备注：${result.remark}）` : ''}`);
}

function usage() {
  console.log(`表情包觅食工具
  search "搜索词" [--count 3]   按词找（Bing）
  search --source aigengtu     去梗鲸随机逛逛（可带 --count）
  list                         看收件箱
  import <候选id> [--remark] [--dry] [--keep]
                               把候选收藏进 QQ（--dry 只预演）
  import-url <URL> [--remark]  直接收藏一个图片地址
  clean                        清理过期候选`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = String(args._[0] ?? '').trim();
  switch (command) {
    case 'search': await cmdSearch(args); break;
    case 'list': cmdList(); break;
    case 'import': await cmdImport(args); break;
    case 'import-url': await cmdImportUrl(args); break;
    case 'clean': console.log(`清理了 ${cleanupInbox({ indexFile: INBOX_INDEX })} 个过期候选`); break;
    case 'help':
    case '--help':
    case '-h':
    case '': usage(); break;
    default: usage(); process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`❌ ${error?.message ?? error}`);
  process.exitCode = 1;
});
