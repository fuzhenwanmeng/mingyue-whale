// 表情包「觅食」自检：纯函数 + 接线存在性（不联网、不改 QQ）。
// 运行：node scripts/test-sticker-hunt.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBingImages,
  detectImageInfo,
  judgeStickerCandidate,
  parseAigengtuListing,
  isAigengtuItemUsable
} from '../packages/sticker-forage/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.error(`  ❌ ${name}`); }
}

function pngBuffer(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

console.log('## Bing 图片解析');
{
  const html = [
    '<a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.com/a.jpg&quot;,&quot;t&quot;:&quot;猫猫无语&quot;,&quot;purl&quot;:&quot;https://example.com/p/1&quot;}"></a>',
    '<a class="iusc" m="{&quot;murl&quot;:&quot;https://img.example.com/b.png&quot;,&quot;t&quot;:&quot;第二张&quot;}"></a>'
  ].join('');
  const items = parseBingImages(html, { limit: 5 });
  ok(items.length === 2, '解析出两条结果');
  ok(items[0].title === '猫猫无语' && items[0].host === 'img.example.com', '标题与域名正确');
  ok(items[0].pageUrl === 'https://example.com/p/1', '来源页正确');
}

console.log('## 图片头解析与筛选');
{
  const png = detectImageInfo(pngBuffer(512, 512));
  ok(png?.format === 'png' && png.width === 512 && png.height === 512, 'PNG 宽高解析');
  ok(detectImageInfo(Buffer.from('not an image')) === null, '非图片返回 null');
  ok(judgeStickerCandidate(png, { bytes: 100 * 1024 }).ok === true, '512x512 通过');
  ok(judgeStickerCandidate(png, { bytes: 100 }).ok === false, '过小文件被拒');
  const tall = detectImageInfo(pngBuffer(400, 1600));
  ok(judgeStickerCandidate(tall, { bytes: 100 * 1024 }).ok === false, '长条图被拒');
  const wide = detectImageInfo(pngBuffer(2000, 400));
  ok(judgeStickerCandidate(wide, { bytes: 100 * 1024 }).ok === false, '超宽图被拒');
}

console.log('## 梗鲸列表解析与过滤');
{
  const html = [
    '<a class="card" href="/zh/meme/001" title="DeepSeek娘『真当我是便宜货啊』气鼓鼓表情包"><img src="https://img.aigengtu.com/0_preview/meme/001.webp" alt=""></a>',
    '<a class="card" href="/zh/meme/002" title="DeepSeek娘『1000382674』表情包"><img src="https://img.aigengtu.com/0_preview/meme/002.webp" alt=""></a>',
    '<a class="card" href="/zh/meme/003" title="DeepSeek娘『你愿意和我发生性关系吗』表情包"><img src="https://img.aigengtu.com/0_preview/meme/003.webp" alt=""></a>'
  ].join('');
  const items = parseAigengtuListing(html);
  ok(items.length === 3, '解析出三张卡片');
  ok(items[0].fullUrl === 'https://img.aigengtu.com/meme/001.webp', '原图直链规律正确');
  ok(isAigengtuItemUsable(items[0]) === true, '正常标题可用');
  ok(isAigengtuItemUsable(items[1]) === false, '纯编号标题被过滤');
  ok(isAigengtuItemUsable(items[2]) === false, '擦边标题被过滤');
  ok(parseAigengtuListing(html).length === 3, 'sources 模块复用同一解析口径');
}

console.log('## 接线存在性');
{
  const bridge = fs.readFileSync(path.join(ROOT, 'src', 'bridge.js'), 'utf8');
  for (const s of ['/api/socialV2/hunt-sticker', '/api/socialV2/import-sticker', '/api/socialV2/delete-sticker', '/api/socialV2/restore-sticker', '/api/socialV2/sticker-trash', 'huntStickerV2', 'importHuntedStickerV2', 'deleteStickerV2', 'restoreStickerV2', 'STICKER_TRASH_DIR', 'startForageScheduler', 'FORAGE_JOURNAL_FILE']) {
    ok(bridge.includes(s), `bridge 包含 ${s}`);
  }
  const mcp = fs.readFileSync(path.join(ROOT, 'src', 'mcp-snowluma-safe.js'), 'utf8');
  for (const name of ['qq_sticker_hunt', 'qq_sticker_import', 'qq_sticker_delete', 'qq_sticker_restore']) {
    ok(mcp.includes(`'${name}'`), `MCP 工具 ${name} 已注册`);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  ok(cfg.socialV2?.tools?.huntSticker === true, 'config huntSticker=true');
  ok(cfg.socialV2?.tools?.importSticker === true, 'config importSticker=true');
  ok(cfg.socialV2?.tools?.deleteSticker === true, 'config deleteSticker=true');
  ok(cfg.socialV2?.tools?.restoreSticker === true, 'config restoreSticker=true');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
