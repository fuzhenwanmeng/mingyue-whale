#!/usr/bin/env node
// list-session-tools.mjs — 建一个挂指定 preset 的会话，打出它这一回合拿到的工具名清单。
//
// 为什么需要：MCP 工具是全局注册的，但「某个 preset 的会话到底看不看得到某个工具」
// 取决于 preset 的 restrict/guard 与 DSH 装配时的工具面。只看 MCP server 的 tools/list
// 证明不了这件事 —— 必须看会话真正的 request/header.tools。
//
// 用法：node tools/list-session-tools.mjs [preset] [过滤词]
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeCookie, probeRpc, probeMuxSocket, probeWorkspaceDir } from '../scripts/probe-auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PRESET = process.argv[2] || 'qq-chat-v2';
const FILTER = process.argv[3] || '';

const rpc = probeRpc(probeCookie());
const dir = probeWorkspaceDir('tools-list');
const ws = await rpc('workspace/create', { request: { path: dir } });
const sc = await rpc('session/create', { request: { workspaceId: ws.value.workspace.workspaceId, agentPreset: PRESET } });
if (!sc.ok) { console.error('挂载失败:', JSON.stringify(sc.error)); process.exit(2); }
const sessionId = sc.value.sessionId;

await rpc('session/selectModel', {
  request: {
    sessionId,
    provider: process.env.DSH_PROVIDER || cfg.dsh.provider,
    model: process.env.DSH_MODEL || cfg.dsh.model,
    reasoningEffort: process.env.DSH_REASONING || cfg.dsh.reasoningEffort || 'high',
  },
});

const socket = probeMuxSocket(probeCookie());
const streamId = randomUUID();
const eventStreamId = randomUUID();
let tools = null;

const done = new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), 60000);
  globalThis.__finish = (why) => { clearTimeout(timer); resolve(why); };
});
socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId } } } } }));
  socket.send(JSON.stringify({ type: 'open', streamId: eventStreamId, endpoint: '$events', payload: { args: {} } }));
  setTimeout(() => {
    void rpc('session/prompt', { request: { sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'ok' }] } });
  }, 600);
});
socket.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.type !== 'item' || m.streamId === eventStreamId) return;
  const e = m.value?.event;
  if (!e) return;
  if (e.type === 'request/header' && Array.isArray(e.data?.header?.tools)) {
    tools = e.data.header.tools.map((t) => t.name);
    globalThis.__finish('done');
  }
  if (e.type === 'turn/end') globalThis.__finish('end');
});

await done;
try { socket.close(); } catch {}
await rpc('workspace/archiveSession', { request: { sessionId } });

if (!tools) { console.log('没拿到 request/header.tools'); process.exit(1); }
const picked = FILTER ? tools.filter((n) => n.includes(FILTER)) : tools;
console.log(`preset=${PRESET} 工具总数=${tools.length}`);
console.log(`匹配 "${FILTER}" 的 ${picked.length} 个:`);
for (const n of picked) console.log('  -', n);
