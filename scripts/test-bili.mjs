// B 站模块自检：文件/白名单/接线存在性；live 模式才真的调 B 站。
// 运行：node scripts/test-bili.mjs
// live：BILI_TEST_LIVE=1 node scripts/test-bili.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBili, ensureBiliHome, BILI_PATHS, READ_COMMANDS, WRITE_COMMANDS, parseJsonOutput } from '../tools/lib/bili-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.error(`  ❌ ${name}`); }
}

console.log('## 路径与隔离 home');
{
  const paths = ensureBiliHome();
  ok(fs.existsSync(paths.cli), 'bili CLI 存在');
  ok(fs.existsSync(paths.config), '隔离配置已生成');
  ok(fs.existsSync(paths.home), '隔离 home 存在');
  ok(paths.home === BILI_PATHS.HOME, 'home 指向 state/bili-home');
}

console.log('## 命令白名单');
{
  for (const c of ['session', 'popular', 'search', 'debrief', 'comments', 'subtitles']) ok(READ_COMMANDS.has(c), `读命令 ${c}`);
  for (const c of ['comment', 'dynamic', 'dm']) ok(WRITE_COMMANDS.has(c), `写命令 ${c}`);
  ok(!WRITE_COMMANDS.has('bundle'), 'bundle 不在写白名单');
  ok(parseJsonOutput('foo\n{"a":1}\nbar')?.a === 1, 'JSON 提取容忍前后文本');
}

console.log('## 接线存在性');
{
  const bridge = fs.readFileSync(path.join(ROOT, 'src', 'bridge.js'), 'utf8');
  for (const s of ['/api/socialV2/bili/run', '/api/socialV2/bili/watch-now', '/api/socialV2/bili/notes', 'biliRunV2', 'biliRunTimes', 'bili-journal.jsonl', 'runBiliAutoOnce', 'startBiliScheduler', 'internal:B站', 'listBiliNotes', 'startBiliMessageWatcher', 'checkOwnerBiliMessages', 'ownerBiliMessages', 'bili-owner-seen.json', 'fetchBiliHomeCandidates', 'fetchBiliFeedCandidates', 'followBiliUser', 'bili-followed.json', 'bili-choices.jsonl', 'bili-tuning.json', 'appendBiliChoice', 'logBiliDecline', 'chooseBiliVideo', 'model-skip', 'sessionDayKey', 'sessionDays', 'sessionDailyReset', 'ensureBiliChatSession', 'bili-chat-session.json', 'biliDailyStats', 'maxSessionsPerDay', 'postBiliOwnerDm', 'shareOwner', 'biliDelegate', 'bili-worker', 'bili_delegate', 'appendEvent', 'PRESENCE_FILE', 'events', 'ATTENTION_FILE', 'attentionTick', 'startAttentionScheduler', 'CONSOLIDATE_SCRIPT', 'memory/consolidate', 'MOOD_FILE', 'proactiveTick', 'startProactiveScheduler', 'isNightMode', 'classifyOwnerDayNightIntent', 'shadow-night', 'proactive/tick', 'executeLive', 'notify_qq', 'searchMemory', 'memory/search', 'MEMORY_COORDINATOR_FILE', 'startMemoryCoordinator', 'outgoing: true', 'inPreSleepWindow', 'pre-sleep']) ok(bridge.includes(s), `bridge 包含 ${s}`);
  const mcp = fs.readFileSync(path.join(ROOT, 'src', 'mcp-snowluma-safe.js'), 'utf8');
  ok(mcp.includes("'bili_run'"), 'MCP 工具 bili_run 已注册');
  ok(mcp.includes("'bili_delegate'"), 'MCP 工具 bili_delegate 已注册');
  ok(mcp.includes("'qq_memory_search'"), 'MCP 工具 qq_memory_search 已注册');
  ok(fs.existsSync(path.join(ROOT, 'bili-worker-preset', 'cordis.patch.yml')), 'bili-worker preset 文件存在');
  ok(mcp.includes("'bili_notes'"), 'MCP 工具 bili_notes 已注册');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  ok(cfg.socialV2?.tools?.biliRun === true, 'config biliRun=true');
}

if (process.env.BILI_TEST_LIVE === '1') {
  console.log('## live：B 站登录态');
  const res = await runBili(['session']);
  ok(res.ok && /账号/.test(res.stdout), 'bili session 能读到登录态');
  ok(!/SESSDATA=[^;]{10,}/.test(res.stdout), '会话输出不包含完整 Cookie');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
