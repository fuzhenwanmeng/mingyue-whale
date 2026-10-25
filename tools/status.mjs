#!/usr/bin/env node
// status.mjs — 一条命令还原「QQ 桥接现在是什么状态」，用来在新会话里快速接上上下文。
//
// 它只读：config.json、state/*、以及本机端口/HTTP 探测，不改任何东西。
// 用法：node tools/status.mjs
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel, fallback = null) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return fallback; }
};
const readJson = (rel, fallback = {}) => {
  try { return JSON.parse(read(rel, 'null') ?? 'null') ?? fallback; } catch { return fallback; }
};

function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function consoleStatus(cfg) {
  const token = (read('state/console-token') ?? '').trim();
  if (!token) return { error: 'state/console-token 不存在（桥接没启动过？）' };
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.consolePort ?? 3100}/api/status`, {
      headers: { 'x-console-token': token },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
}

const cfg = readJson('config.json');
const sessions = readJson('state/sessions.json', { sessions: {}, sessionPolicies: {} });
const role = readJson('state/current-role.json', { role: null, mode: 'active' });
const mode = readJson('state/mode.json', { mode: null });

const [p3000, p3001, p3100, p5099, p5100] = await Promise.all([
  portOpen(3000), portOpen(3001), portOpen(cfg.consolePort ?? 3100), portOpen(5099), portOpen(5100),
]);
const status = await consoleStatus(cfg);

const dshPort = (() => {
  try { return new URL(cfg?.dsh?.baseUrl ?? '').port; } catch { return ''; }
})();

const line = (k, v) => console.log(`${String(k).padEnd(14)} ${v}`);

console.log('=== 端口 ===');
line('OneBot HTTP', `${p3000 ? '✅ 3000 在听' : '❌ 3000 未监听'}`);
line('OneBot WS', `${p3001 ? '✅ 3001 在听' : '❌ 3001 未监听'}`);
line('桥接控制台', `${p3100 ? '✅ 3100 在听' : '❌ 3100 未监听'}`);
line('SnowLuma', `${p5099 ? '✅ 5099 在听' : p5100 ? '✅ 5100 在听（5099 被占，SnowLuma 退让）' : '❌ 5099/5100 未监听'}`);
line('DSH 地址', `${cfg?.dsh?.baseUrl ?? '(未配置)'}${dshPort ? '' : ' ⚠️ 端口解析失败'}`);

console.log('\n=== 桥接运行时 ===');
if (status.error) {
  line('状态', `❌ 取不到：${status.error}`);
} else {
  line('mode', status.mode);
  line('dshReady', status.dshReady);
  line('role', `${status.role ?? '(无)'} / ${status.roleMode ?? '?'}`);
  line('ownerQQ', status.ownerQQ ?? '(未设置)');
  line('allowPrivate', (status.allowPrivate ?? []).join(',') || '(空 = 按好友列表放行)');
  line('allowGroups', (status.allowGroups ?? []).join(',') || '(空 = 不接群)');
  const s = status.snowluma ?? {};
  line('SnowLuma', `connected=${s.connected} online=${s.accountOnline} good=${s.good} 心跳=${s.lastPacketAgoMs}ms`);
  const acts = String(status.activity ?? '').trim().split('\n').filter(Boolean).slice(-5);
  if (acts.length) {
    console.log('\n=== 最近活动 ===');
    for (const a of acts) console.log(`  ${a}`);
  }
}

console.log('\n=== 结论性事实 ===');
line('当前人格卡', role.role ?? '(无)');
line('mode.json', mode.mode ?? '(无)');
line('会话映射', Object.entries(sessions.sessions ?? {}).map(([k, v]) => `${k}→${v}`).join('; ') || '(空)');
line('会话策略', Object.entries(sessions.sessionPolicies ?? {}).map(([k, v]) => `${k}:${v}`).join('; ') || '(空)');
line('ownerWorkPreset', JSON.stringify(cfg.ownerWorkPreset ?? ''));
line('allowFriendsFromList', String(cfg.allowFriendsFromList === true));

const notes = [];
if (!p3000) notes.push('OneBot 3000 未监听：先启动 SnowLuma（D:\\AIagent\\snowluma\\launcher.bat），确认它 hook 上了 QQ');
if (!p3100) notes.push('桥接未运行：node src\\bridge.js（或双击 start-qq-bridge.cmd）');
if (status?.error && p3100) notes.push('3100 在听但 /api/status 取不到：可能 token 过期，删 state/console-token 后重启桥接');
if (notes.length) {
  console.log('\n=== 需要处理 ===');
  for (const n of notes) console.log(`  · ${n}`);
}
