#!/usr/bin/env node
// P4：把 state/events/<date>.jsonl 整理成一份可读的每日合并稿。
// 只写 state/consolidated/，不碰 growth/人格卡/日记最终稿；主会话再决定哪些进 digest/growth。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVENTS_DIR = path.join(ROOT, 'state', 'events');
const OUT_DIR = path.join(ROOT, 'state', 'consolidated');

function localDay(now = new Date()) {
  return new Date(now).toLocaleDateString('sv-SE');
}
function clip(text, max = 300) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function readEvents(date) {
  const file = path.join(EVENTS_DIR, `${date}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}
function mdList(items, render) {
  return items.length ? items.map(render).join('\n') : '- （无）';
}

const argDate = process.argv.find((x) => x.startsWith('--date='))?.slice('--date='.length);
const date = argDate || localDay();
const events = readEvents(date);
if (!events.length) {
  console.log(`[consolidate] ${date} 没有事件`);
  process.exit(0);
}

const ownerQq = events.filter((e) => e.source === 'qq' && e.actor?.owner);
const otherQq = events.filter((e) => e.source === 'qq' && !e.actor?.owner);
const bili = events.filter((e) => e.source === 'bili');
const tasks = events.filter((e) => e.source === 'task');
const attention = events.filter((e) => e.source === 'attention');
const system = events.filter((e) => e.source === 'system');

const byThread = new Map();
for (const e of otherQq) {
  const key = e.thread?.key || 'unknown';
  if (!byThread.has(key)) byThread.set(key, []);
  byThread.get(key).push(e);
}

const lines = [
  `# ${date} 事件合并稿`,
  '',
  `> 生成于 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
  '> 这是局部记录的合并，不是最终日记；主会话再决定哪些进 digest/growth。',
  '',
  '## 统计',
  '',
  `- 事件总数：${events.length}`,
  `- 老大 QQ：${ownerQq.length}`,
  `- 其他人 QQ：${otherQq.length}`,
  `- B站：${bili.length}`,
  `- 任务：${tasks.length}`,
  `- 注意力：${attention.length}`,
  `- 系统：${system.length}`,
  '',
  '## 老大 QQ',
  '',
  mdList(ownerQq, (e) => `- [${String(e.ts || '').slice(11, 16)}] ${clip(e.text, 500)}${e.thread?.key ? `（${e.thread.key}）` : ''}`),
  '',
  '## 其他人 QQ（按会话聚合）',
  '',
];
for (const [key, list] of byThread.entries()) {
  lines.push(`### ${key}（${list.length} 条）`);
  lines.push('');
  lines.push(mdList(list.slice(-12), (e) => `- [${String(e.ts || '').slice(11, 16)}] ${clip(e.actor?.name || e.actor?.id || '?')}：${clip(e.text, 180)}`));
  lines.push('');
}

lines.push('## B站', '', mdList(bili, (e) => {
  const extra = [e.title, e.bvid].filter(Boolean).join(' · ');
  return `- [${e.kind}] ${clip(extra || e.text || '', 180)}${e.text && extra ? `：${clip(e.text, 180)}` : ''}`;
}), '');
lines.push('## 任务', '', mdList(tasks, (e) => `- [${e.kind}] ${clip(e.text || e.data?.text, 240)}`), '');
lines.push('## 注意力', '', mdList(attention, (e) => `- [${e.kind}] ${clip(e.text, 200)}`), '');
lines.push('## 系统', '', mdList(system, (e) => `- [${e.kind}] ${clip(e.text, 120)}`), '');

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `${date}.md`);
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`[consolidate] 写入 ${out}（${events.length} 事件）`);
