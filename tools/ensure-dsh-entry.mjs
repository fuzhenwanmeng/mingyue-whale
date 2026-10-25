#!/usr/bin/env node
// ensure-dsh-entry.mjs — 桥接启动前置：确保 DSH 固定入口（127.0.0.1:6100）可用，
// 并把 config.json 的 dsh.baseUrl 固定指向它；固定入口不可用时回退到 detect-dsh-port。
//
// 这样 DSH 桌面端重启换端口，桥接和配置都不用跟着改；转发器会自己追目标。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config.json');
const STATE_DIR = path.join(ROOT, 'state');
const LOG_FILE = path.join(STATE_DIR, 'ensure-entry.log');
const FIXED_PORT = 6100;
const FIXED_URL = `http://127.0.0.1:${FIXED_PORT}`;

function log(message) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
    if (fs.statSync(LOG_FILE).size > 500_000) fs.writeFileSync(LOG_FILE, '', 'utf8');
  } catch { /* ignore */ }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

function waitPort(port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await checkPort(port)) return resolve(true);
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 500);
    };
    tick();
  });
}

function startForwarder() {
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'dsh-fixed-entry.mjs')], {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
}

function writeBaseUrl(url) {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  cfg.dsh = { ...(cfg.dsh ?? {}), baseUrl: url };
  fs.writeFileSync(CONFIG, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

async function main() {
  if (!(await checkPort(FIXED_PORT))) {
    log(`固定入口未监听，启动转发器（${FIXED_PORT}）`);
    startForwarder();
    await waitPort(FIXED_PORT, 12_000);
  }
  if (await checkPort(FIXED_PORT)) {
    writeBaseUrl(FIXED_URL);
    log(`固定入口就绪，dsh.baseUrl -> ${FIXED_URL}`);
    return;
  }
  // 兜底：固定入口没起来（转发器异常），仍保证桥接能连上 DSH。
  log('固定入口不可用，回退 detect-dsh-port.mjs');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'detect-dsh-port.mjs')], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  });
  log(`detect 退出码 ${result.status}：${String(result.stdout ?? '').trim()}`);
}

main().catch((error) => {
  log(`ensure 异常：${error?.message ?? error}`);
  // 不让前置脚本拦住桥接；桥接仍会按现有配置启动。
  process.exit(0);
});
