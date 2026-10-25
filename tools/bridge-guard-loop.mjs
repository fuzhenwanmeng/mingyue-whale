#!/usr/bin/env node
// bridge-guard-loop.mjs — 常驻守护循环：每 10 分钟跑一次 bridge-guard（掉线自动拉起）。
// 由登录启动项（Startup 快捷方式）启动，不需要管理员权限的计划任务。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'tools', 'bridge-guard.mjs');
const INTERVAL_MS = 10 * 60 * 1000;

let running = false;

function runGuard() {
  if (running) return;
  running = true;
  const child = spawn(process.execPath, [GUARD], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
  });
  child.on('exit', () => { running = false; });
  child.on('error', () => { running = false; });
}

runGuard();
setInterval(runGuard, INTERVAL_MS);
