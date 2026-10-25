#!/usr/bin/env node
// detect-dsh-port.mjs — 让 config.json 的 dsh.baseUrl 跟上 DSH 桌面端每次启动随机分配的端口。
//
// 背景：DSH 桌面端（Electron）启动时会起一个本机 web 服务并把随机端口交给界面，
// 端口不落盘、每次重启都可能变（当前这次是 58029）。而 qq-bridge 的 config.json
// 只认死一个 baseUrl，端口一变桥接就会 401/ECONNREFUSED。
//
// 做法：找到命令行里带 dsh-desktop-host 的那个 DeepSeek Harness 进程，
// 取它正在监听的环回端口，探测一下确实是 DSH API，再写回 config.json。
// 探测失败就保持原样退出 0 —— 让桥接照旧用现有配置启动，不要因为这个小脚本拦住用户。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config.json');

const PS = [
  '$p = Get-CimInstance Win32_Process -Filter "Name=\'DeepSeek Harness.exe\'" |',
  "  Where-Object { $_.CommandLine -like '*dsh-desktop-host*' } | Select-Object -First 1;",
  'if ($p) {',
  '  Get-NetTCPConnection -State Listen -OwningProcess $p.ProcessId -ErrorAction SilentlyContinue |',
  "    Where-Object { $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::','::1') } |",
  '    Sort-Object LocalPort | Select-Object -First 1 -ExpandProperty LocalPort',
  '}',
].join('\n');

function detectPort() {
  try {
    const out = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS], {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
    });
    const port = Number.parseInt(String(out).trim(), 10);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/** 这个端口后面真的是 DSH 吗？401 说明是 DSH 但缺 Cookie，200 说明带 Cookie 也通 —— 两者都算命中。 */
function isDshApi(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/agentPresets/list', method: 'POST', timeout: 4000,
        headers: { 'content-type': 'application/json', 'content-length': 2 } },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200 || res.statusCode === 401);
      },
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end('{}');
  });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch (error) {
    console.error(`[detect-dsh-port] 读不到 ${CONFIG}: ${error.message}；跳过，配置保持不变`);
    process.exit(0);
  }
}

const port = detectPort();
if (!port) {
  console.log('[detect-dsh-port] 没找到运行中的 DSH 桌面端（dsh-desktop-host）；沿用 config.json 现有地址');
  process.exit(0);
}

if (!(await isDshApi(port))) {
  console.log(`[detect-dsh-port] 端口 ${port} 上没有响应 DSH API；沿用 config.json 现有地址`);
  process.exit(0);
}

const cfg = readConfig();
const wanted = `http://127.0.0.1:${port}`;
const current = cfg?.dsh?.baseUrl ?? '';
if (current === wanted) {
  console.log(`[detect-dsh-port] DSH 地址已是最新: ${wanted}`);
  process.exit(0);
}

cfg.dsh = { ...(cfg.dsh ?? {}), baseUrl: wanted };
fs.writeFileSync(CONFIG, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
console.log(`[detect-dsh-port] config.json 的 dsh.baseUrl: ${current || '(空)'} -> ${wanted}`);
