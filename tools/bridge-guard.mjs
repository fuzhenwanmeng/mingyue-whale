#!/usr/bin/env node
// bridge-guard.mjs — 稳定线守护：固定入口 / 桥接进程掉线时自动拉起。
// 由计划任务 QQBridgeGuard 每 10 分钟 + 登录时跑一次；退出码 0=在线（或已拉起），1=仍离线。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config.json');
const STATE_DIR = path.join(ROOT, 'state');
const LOG_FILE = path.join(STATE_DIR, 'bridge-guard.log');
const FIXED_PORT = 6100;
const BRIDGE_PORT = 3100;
const FIXED_URL = `http://127.0.0.1:${FIXED_PORT}`;
const SNOWLUMA_DIR = 'D:\\AIagent\\snowluma';
const SNOWLUMA_NODE = path.join(SNOWLUMA_DIR, 'node.exe');

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

function spawnHidden(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, ...options,
  });
  child.unref();
}

function ensureBaseUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (cfg?.dsh?.baseUrl !== FIXED_URL) {
      cfg.dsh = { ...(cfg.dsh ?? {}), baseUrl: FIXED_URL };
      fs.writeFileSync(CONFIG, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
      log(`config dsh.baseUrl 校正为 ${FIXED_URL}`);
    }
  } catch (error) {
    log(`config 读取/校正失败：${error?.message ?? error}`);
  }
}

async function ensureSnowluma() {
  // 登录自启项和本守护可能同时启动 SnowLuma（曾出现 5099/5100 两个实例抢端口）；
  // 先给自启项 8 秒，再检查 5099/5100（SnowLuma 端口被占时会退到 5100），都不可用才自己拉。
  const up = async () => (await checkPort(5099)) || (await checkPort(5100));
  if (await up()) return true;
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  if (await up()) return true;
  log('SnowLuma 离线，启动');
  spawnHidden(SNOWLUMA_NODE, ['.\\index.mjs'], { cwd: SNOWLUMA_DIR });
  const ok = (await waitPort(5099, 25_000)) || (await waitPort(5100, 5_000));
  log(ok ? 'SnowLuma 已启动（等 QQ hook 连接）' : 'SnowLuma 启动失败（下一轮再试）');
  return ok;
}

async function main() {
  await ensureSnowluma();

  if (!(await checkPort(FIXED_PORT))) {
    log('固定入口离线，启动转发器');
    spawnHidden(process.execPath, [path.join(ROOT, 'tools', 'dsh-fixed-entry.mjs')]);
    await waitPort(FIXED_PORT, 10_000);
  }
  ensureBaseUrl();

  if (!(await checkPort(BRIDGE_PORT))) {
    log('桥接离线，启动 start-qq-bridge.cmd');
    spawnHidden('cmd.exe', ['/c', path.join(ROOT, 'start-qq-bridge.cmd')]);
    await waitPort(BRIDGE_PORT, 20_000);
  }

  const online = await checkPort(BRIDGE_PORT);
  log(online ? '桥接在线' : '桥接仍离线（守护会下轮再试）');
  process.exit(online ? 0 : 1);
}

main().catch((error) => {
  log(`守护异常：${error?.message ?? error}`);
  process.exit(1);
});
