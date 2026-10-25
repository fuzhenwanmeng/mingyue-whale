#!/usr/bin/env node
// B 站工具（桥接侧 CLI）：把 dsh-bili-pod 的 bili.mjs 包一层，隔离 home、默认 dry、写操作显式 --go。
//
// 用法：
//   node tools/bili.mjs status
//   node tools/bili.mjs popular --ps 5 [--json]
//   node tools/bili.mjs search --kw "DeepSeek" [--json]
//   node tools/bili.mjs watch BV1... [--frames]
//   node tools/bili.mjs comments BV1... [--json]
//   node tools/bili.mjs comment BV1... --message "..." [--dry|--go]
//   node tools/bili.mjs dynamic post --text "..." [--dry|--go]
//   node tools/bili.mjs dynamic list
//   node tools/bili.mjs dm --status
//   node tools/bili.mjs run <command> [...args]   # 白名单原生命令
import { runBili, parseJsonOutput, READ_COMMANDS, WRITE_COMMANDS } from './lib/bili-cli.mjs';

function parseArgs(argv) {
  const out = { _: [], flags: {}, values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !String(next).startsWith('--')) { out.values[key] = String(next); i += 1; }
    else out.flags[key] = true;
  }
  return out;
}

function print(result) {
  if (result.stdout) process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  if (!result.ok) process.exitCode = result.code || 1;
}

async function aidOf(bvid) {
  const res = await runBili(['comments', bvid, '--ps', '1', '--json']);
  const j = parseJsonOutput(res.stdout);
  const aid = j?.aid ? String(j.aid) : '';
  if (!aid) throw new Error(`拿不到 ${bvid} 的 aid：${res.stderr || res.stdout.slice(0, 200)}`);
  return aid;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = String(args._[0] || '').trim();
  const rest = args._.slice(1);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`B 站工具
  status                                看当前登录账号
  popular [--ps N] [--json]             热门视频
  search --kw <词> [--json]             搜索
  watch <BV> [--frames]                 看一条视频（默认 --no-frames）
  comments <BV> [--json]                热评/评论
  comment <BV> --message <文本> [--dry|--go] [--root <rpid> --parent <rpid>]
  dynamic post --text <文本> [--dry|--go]
  dynamic list
  dm --status
  run <command> [...args]               白名单原生命令`);
    return;
  }

  if (cmd === 'run') {
    const name = String(rest[0] || '');
    if (!READ_COMMANDS.has(name) && !WRITE_COMMANDS.has(name)) throw new Error(`命令不在白名单：${name || '(空)'}`);
    const scope = WRITE_COMMANDS.has(name) && rest.includes('--go');
    print(await runBili(rest, { scope }));
    return;
  }

  if (cmd === 'status') { print(await runBili(['session'])); return; }

  if (cmd === 'popular') {
    const ps = args.values.ps || '5';
    print(await runBili(['popular', '--ps', ps, ...(args.flags.json ? ['--json'] : [])]));
    return;
  }

  if (cmd === 'search') {
    const kw = args.values.kw || rest[0];
    if (!kw) throw new Error('search 需要关键词');
    const page = args.values.page || '1';
    print(await runBili(['search', kw, page]));
    return;
  }

  if (cmd === 'watch') {
    const bv = rest[0];
    if (!bv) throw new Error('watch 需要 BV 号');
    print(await runBili(['debrief', bv, ...(args.flags.frames ? [] : ['--no-frames'])]));
    return;
  }

  if (cmd === 'comments') {
    const bv = rest[0];
    if (!bv) throw new Error('comments 需要 BV 号');
    print(await runBili(['comments', bv, ...(args.flags.json ? ['--json'] : [])]));
    return;
  }

  if (cmd === 'comment') {
    const bv = rest[0];
    const message = args.values.message;
    if (!bv || !message) throw new Error('comment 需要 <BV> --message <文本>');
    const aid = await aidOf(bv);
    const mode = args.flags.go ? '--go' : '--dry';
    const extra = [];
    if (args.values.root) extra.push('--root', args.values.root);
    if (args.values.parent) extra.push('--parent', args.values.parent);
    print(await runBili(['comment', '--oid', aid, '--bvid', bv, '--message', message, ...extra, mode], { scope: mode === '--go' }));
    return;
  }

  if (cmd === 'dynamic') {
    const sub = rest[0] || 'list';
    if (sub === 'post') {
      const text = args.values.text;
      if (!text) throw new Error('dynamic post 需要 --text');
      const mode = args.flags.go ? '--go' : '--dry';
      print(await runBili(['dynamic', 'post', '--text', text, mode], { scope: mode === '--go' }));
      return;
    }
    if (sub === 'list') { print(await runBili(['dynamic', 'list'])); return; }
    throw new Error(`unknown dynamic subcommand: ${sub}`);
  }

  if (cmd === 'dm') {
    if (args.flags.status || !args.values.msg) { print(await runBili(['dm', '--status'])); return; }
    const mode = args.flags.go ? '--go' : '--dry';
    print(await runBili(['dm', '--msg', args.values.msg, mode], { scope: mode === '--go' }));
    return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

main().catch((error) => {
  console.error(`❌ ${error?.message ?? error}`);
  process.exitCode = 1;
});
