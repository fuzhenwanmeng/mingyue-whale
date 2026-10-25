#!/usr/bin/env node
// dsh-fixed-entry.mjs — 给 DSH 桌面端一个固定入口（127.0.0.1:6100），
// DSH 每次启动随机换端口时，由这个常驻转发器在后面追着切目标，桥接不再改配置。
//
// 为什么不用 netsh portproxy：需要管理员权限，而 DSH 进程是普通用户起的；
// 这里是一个普通 TCP 转发器（支持 WebSocket 升级，字节级透传），随登录任务启动。
//
// 目标端口发现方式与 tools/detect-dsh-port.mjs 一致：找命令行带 dsh-desktop-host 的
// DeepSeek Harness 进程 → 取它监听的环回端口 → 用 /api/agentPresets/list 探测确认是 DSH。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, 'state');
const LOG_FILE = path.join(STATE_DIR, 'fixed-entry.log');
const HEALTH_FILE = path.join(STATE_DIR, 'fixed-entry.json');
const LISTEN_PORT = Number(process.env.DSH_FIXED_PORT || 6100);
const REFRESH_MS = 30_000;

const PS = [
  '$p = Get-CimInstance Win32_Process -Filter "Name=\'DeepSeek Harness.exe\'" |',
  "  Where-Object { $_.CommandLine -like '*dsh-desktop-host*' } | Select-Object -First 1;",
  'if ($p) {',
  '  Get-NetTCPConnection -State Listen -OwningProcess $p.ProcessId -ErrorAction SilentlyContinue |',
  "    Where-Object { $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::','::1') } |",
  '    Sort-Object LocalPort | Select-Object -First 1 -ExpandProperty LocalPort',
  '}',
].join('\n');

function log(message) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 1_000_000) fs.writeFileSync(LOG_FILE, '', 'utf8');
  } catch { /* 日志失败不影响转发 */ }
}

function writeHealth() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(HEALTH_FILE, JSON.stringify({
      listenPort: LISTEN_PORT,
      targetPort: targetPort || null,
      updatedAt: new Date().toISOString(),
      pid: process.pid
    }, null, 2), 'utf8');
  } catch { /* ignore */ }
}

function detectPort(cb) {
  execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS], {
    encoding: 'utf8', timeout: 20000, windowsHide: true
  }, (error, stdout) => {
    if (error) return cb(null);
    const port = Number.parseInt(String(stdout).trim(), 10);
    cb(Number.isInteger(port) && port > 0 && port < 65536 ? port : null);
  });
}

function isDshApi(port, cb) {
  const req = http.request({
    host: '127.0.0.1', port, path: '/api/agentPresets/list', method: 'POST', timeout: 4000,
    headers: { 'content-type': 'application/json', 'content-length': 2 }
  }, (res) => {
    res.resume();
    cb(res.statusCode === 200 || res.statusCode === 401);
  });
  req.on('timeout', () => { req.destroy(); cb(false); });
  req.on('error', () => cb(false));
  req.end('{}');
}

let targetPort = 0;

function refresh() {
  detectPort((port) => {
    if (!port) return;
    isDshApi(port, (ok) => {
      if (!ok) return;
      if (port !== targetPort) {
        targetPort = port;
        log(`DSH 目标端口 -> ${port}`);
        writeHealth();
      }
    });
  });
}

const server = net.createServer((client) => {
  if (!targetPort) {
    client.destroy();
    refresh();
    return;
  }
  const upstream = net.connect(targetPort, '127.0.0.1');
  const close = () => { client.destroy(); upstream.destroy(); };
  client.on('error', close);
  upstream.on('error', close);
  client.pipe(upstream);
  upstream.pipe(client);
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log(`固定入口 ${LISTEN_PORT} 已在监听，本实例退出`);
    process.exit(0);
  }
  log(`固定入口错误：${error.message}`);
  process.exit(1);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  log(`固定入口监听 127.0.0.1:${LISTEN_PORT}`);
  refresh();
  setInterval(refresh, REFRESH_MS);
  writeHealth();
});

process.on('SIGINT', () => { log('收到 SIGINT，退出'); process.exit(0); });
process.on('SIGTERM', () => { log('收到 SIGTERM，退出'); process.exit(0); });
