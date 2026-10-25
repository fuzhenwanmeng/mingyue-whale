#!/usr/bin/env node
// inspect-turn.mjs — 诊断用：建会话挂指定 preset，注入一句话，把这一回合的**所有**事件打出来。
//
// 为什么需要它：scripts/probe-tools.mjs 只汇总「文本 + tool/call」，一旦回合异常收尾
// （例如模型报错、guard 拒绝、preset 插件挂载失败），那边只会显示空字符串，看不出原因。
//
// 用法：node tools/inspect-turn.mjs [preset] [prompt]
//   环境变量沿用 probe-auth.mjs 的约定（DSH_HOME / DSH_BASE_URL）以及
//   DSH_PROVIDER / DSH_MODEL / DSH_REASONING（默认取 config.json 的 dsh 段）。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { probeCookie, probeRpc, probeMuxSocket, probeWorkspaceDir } from '../scripts/probe-auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { return {}; }
})();

const PRESET = process.argv[2] || 'qq-chat-v2';
const PROMPT = process.argv[3] || '调用 mcp__snowluma-host__snowluma_status 工具一次，然后只回复：完成';
const provider = process.env.DSH_PROVIDER || cfg?.dsh?.provider || 'deepseek-official';
const model = process.env.DSH_MODEL || cfg?.dsh?.model || 'deepseek-flash';
const effort = process.env.DSH_REASONING || cfg?.dsh?.reasoningEffort || 'high';

const cookie = probeCookie();
const rpc = probeRpc(cookie);
const dir = probeWorkspaceDir('inspect');
const ws = await rpc('workspace/create', { request: { path: dir } });
const wsId = ws.value.workspace.workspaceId;
const sc = await rpc('session/create', { request: { workspaceId: wsId, agentPreset: PRESET } });
if (!sc.ok) {
  console.error(`❌ preset ${PRESET} 挂载失败: ${sc.error.code}: ${sc.error.message}`);
  process.exit(2);
}
const sessionId = sc.value.sessionId;
console.log(`session ${sessionId} preset=${PRESET}`);

const sm = await rpc('session/selectModel', { request: { sessionId, provider, model, reasoningEffort: effort } });
console.log('selectModel ->', sm.ok ? JSON.stringify(sm.value.selected) : `FAIL ${sm.error.code}: ${sm.error.message}`);

const socket = probeMuxSocket(cookie);
const streamId = randomUUID();
const eventStreamId = randomUUID();
const seen = new Map();
let ended = false;

const done = new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), 120_000);
  globalThis.__finish = (why) => { clearTimeout(timer); resolve(why); };
});
socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId } } } } }));
  socket.send(JSON.stringify({ type: 'open', streamId: eventStreamId, endpoint: '$events', payload: { args: {} } }));
  setTimeout(async () => {
    const p = await rpc('session/prompt', {
      request: { sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: PROMPT }] },
    });
    console.log('prompt ->', p.ok ? JSON.stringify(p.value).slice(0, 120) : `FAIL ${p.error.code}: ${p.error.message}`);
  }, 700);
});
socket.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.type === 'item' && m.streamId !== eventStreamId) {
    const v = m.value;
    if (v?.type === 'event') {
      const e = v.event;
      seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
      const name = e.data?.name ?? e.data?.toolName ?? e.data?.message?.content?.map?.((b) => b.type).join('+');
      console.log(`  ${e.type}${name ? ` · ${name}` : ''} ${JSON.stringify(e.data ?? {}).slice(0, 220)}`);
      if (e.type === 'turn/end') { ended = true; globalThis.__finish('done'); }
    } else if (v?.type === 'error' || m.type === 'error') {
      console.log('  !! stream error', JSON.stringify(m).slice(0, 300));
    }
  }
});
socket.addEventListener('close', () => { if (!ended) globalThis.__finish('closed'); });
socket.addEventListener('error', () => { if (!ended) globalThis.__finish('error'); });

const why = await done;
console.log('\n结果:', why);
console.log('事件类型统计:', JSON.stringify(Object.fromEntries(seen), null, 0));
try { socket.close(); } catch {}
await rpc('workspace/archiveSession', { request: { sessionId } });
console.log('[cleanup] archived');
