// B 站 CLI 适配层：把 dsh-bili-pod 的 tools/bili.mjs 当成后端命令跑。
//
// 为什么先包 CLI，而不是重写一遍：
// - 它已经把 WBI、字幕、弹幕、评论、私信、动态、风控刹车都跑通了（MIT）；
// - 我们现在要的是「能用的手」，不是再写一份一样的 API 客户端；
// - 所有命令都在桥接的白名单/限频/审计下执行，写操作默认 dry，`--go` 必须显式确认。
//
// 隔离：USERPROFILE / DSH_HOME / BILI_POD_WORK 都指到 state/bili-home，
// 不碰用户主目录里的 ~/.bili-ai，也不碰日常 DSH 配置。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const STATE = path.join(ROOT, 'state');
const HOME = path.join(STATE, 'bili-home');
const CRED_SRC = path.join(STATE, 'bili-credentials.json');
const CRED_DST = path.join(HOME, '.bili-ai', 'credentials.json');
const CFG = path.join(HOME, '.dsh', 'pod.config.json');
const CLI = process.env.BILI_CLI || path.resolve(ROOT, '..', 'plugins', 'dsh-bili-pod', 'tools', 'bili.mjs');

export const READ_COMMANDS = new Set(['session', 'popular', 'rank', 'weekly', 'search', 'comments', 'subtitles', 'debrief', 'video', 'feed', 'quota', 'diary', 'records', 'ledger', 'likes', 'messages', 'tide', 'taste', 'user-info', 'user-videos', 'fav-remote', 'covers', 'whois']);
export const WRITE_COMMANDS = new Set(['comment', 'dynamic', 'dm', 'fav', 'comment-del', 'dynamic-image', 'danmaku']);

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

/** 把登录凭据同步到隔离 home；不打印内容。 */
export function syncCredentials() {
  ensureDir(path.dirname(CRED_DST));
  if (!fs.existsSync(CRED_SRC)) return false;
  let copy = true;
  try {
    const a = fs.statSync(CRED_SRC);
    const b = fs.existsSync(CRED_DST) ? fs.statSync(CRED_DST) : null;
    copy = !b || a.mtimeMs > b.mtimeMs;
  } catch { copy = true; }
  if (copy) fs.copyFileSync(CRED_SRC, CRED_DST);
  return true;
}

/** 最小配置：owner 留空时私信不可用，其它命令照常。 */
export function ensureBiliHome() {
  ensureDir(HOME);
  syncCredentials();
  if (!fs.existsSync(CFG)) {
    ensureDir(path.dirname(CFG));
    const ownerMid = process.env.BILI_OWNER_MID || '';
    const ownerName = process.env.BILI_OWNER_NAME || '';
    const cfg = {
      owner: { mid: ownerMid, name: ownerName },
      persona: { name: process.env.BILI_PERSONA_NAME || '鲸鱼娘', ownerTitle: '老大', selfClaim: '我' },
      reportLevel: 'brief'
    };
    fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  }
  return { home: HOME, config: CFG, cli: CLI };
}

function cleanStderr(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => !line.includes('BILI_POD_SCOPE=off'))
    .join('\n')
    .trim();
}

/**
 * 跑一条 bili CLI。
 * @param {string[]} args 例如 ['popular','--ps','5','--json']
 * @param {{timeoutMs?:number, scope?:boolean, maxBuffer?:number}} [options]
 * @returns {Promise<{ok:boolean, code:number, stdout:string, stderr:string, truncated:boolean}>}
 */
export function runBili(args, options = {}) {
  ensureBiliHome();
  const argv = Array.isArray(args) ? args.map(String) : [String(args)];
  const cli = String(options.cliPath || CLI);
  const timeoutMs = Math.max(10000, Math.min(300000, Number(options.timeoutMs) || 180000));
  const maxBuffer = Math.max(64 * 1024, Number(options.maxBuffer) || 4 * 1024 * 1024);
  const env = {
    ...process.env,
    USERPROFILE: HOME,
    HOME,
    DSH_HOME: path.join(HOME, '.dsh'),
    BILI_POD_WORK: path.join(HOME, 'pod-work'),
    BILI_POD_DIARY: path.join(HOME, 'pod-diary'),
    BILI_POD_CONFIG: CFG,
    ...(options.scope ? { BILI_POD_SCOPE: 'off' } : {})
  };
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...argv], {
      cwd: ROOT,
      env,
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      const code = error?.code ?? 0;
      const truncated = /maxBuffer/i.test(String(error?.message || ''));
      resolve({
        ok: !error,
        code: typeof code === 'number' ? code : 1,
        stdout: String(stdout || ''),
        stderr: cleanStderr(stderr),
        truncated
      });
    });
  });
}

/** 从 bili.mjs 的 --json 输出里取 JSON（容忍前面有提示行）。 */
export function parseJsonOutput(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

export const BILI_PATHS = { ROOT, STATE, HOME, CRED_SRC, CRED_DST, CFG, CLI };
