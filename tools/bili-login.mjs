#!/usr/bin/env node
// B 站扫码登录 CLI（passport 接口 + 本地渲染二维码，不用浏览器）。
//
// 用法：
//   node tools/bili-login.mjs                 # 生成二维码、等扫码、保存凭据
//   node tools/bili-login.mjs --timeout 240   # 自定义等待秒数
//   node tools/bili-login.mjs --status        # 只看当前保存的登录态（不回显 Cookie）
//
// 产物：
//   state/bili-login.png        二维码（可删）
//   state/bili-credentials.json 凭据（只写本机，不进 git）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginStart, loginPoll, fetchSelf, saveCredential, credentialState } from './lib/bili-login.mjs';
import { writeQrPng } from './lib/qr-png.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, 'state');
const QR_FILE = path.join(STATE, 'bili-login.png');
const CRED_FILE = path.join(STATE, 'bili-credentials.json');
const LOG_FILE = path.join(STATE, 'bili-login.log');

function parseArgs(argv) {
  const out = { timeout: 180, status: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--timeout') { out.timeout = Math.max(30, Math.min(600, Number(argv[++i]) || 180)); }
    else if (argv[i] === '--status') out.status = true;
  }
  return out;
}

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  console.log(text);
  try { fs.appendFileSync(LOG_FILE, text + '\n'); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.status) {
    const st = credentialState(CRED_FILE);
    console.log(JSON.stringify({ ...st, file: path.relative(ROOT, CRED_FILE) }, null, 2));
    return;
  }

  fs.mkdirSync(STATE, { recursive: true });
  log('请求二维码…');
  const qr = await loginStart();
  const wrote = writeQrPng(QR_FILE, qr.url, { scale: 9, margin: 4 });
  log(`二维码已生成：${path.relative(ROOT, QR_FILE)}（${wrote.width}x${wrote.height}）`);
  log('用 B 站 App 扫码，并在手机上确认；等待最长 ' + args.timeout + ' 秒…');

  const deadline = Date.now() + args.timeout * 1000;
  let last = '';
  let sawScanned = false;
  while (Date.now() < deadline) {
    const st = await loginPoll(qr.key);
    if (st.state !== last) {
      last = st.state;
      if (st.state === 'waiting') log('还没扫…');
      else if (st.state === 'scanned') { sawScanned = true; log('已扫码，等手机确认…'); }
      else if (st.state === 'expired') { log('二维码过期，请重新运行'); process.exitCode = 2; return; }
      else if (st.state === 'unknown') log(`状态未知：${st.message || st.code}`);
    }
    if (st.state === 'ok') {
      const self = await fetchSelf(st.credential).catch(() => null);
      const saved = saveCredential({ ...st.credential, mid: self?.mid, name: self?.name }, CRED_FILE);
      log(`登录成功：${self?.name || '（名字未取到）'}${self?.mid ? `（mid ${self.mid}）` : ''}`);
      log(`凭据已保存：${path.relative(ROOT, CRED_FILE)}（${saved.present.join(', ')}）`);
      try { fs.unlinkSync(QR_FILE); } catch {}
      return;
    }
    await sleep(2000);
  }
  log(sawScanned ? '超时：扫了码但没确认' : '超时：没等到扫码');
  process.exitCode = 3;
}

main().catch((error) => {
  log(`失败：${error?.message ?? error}`);
  process.exitCode = 1;
});
