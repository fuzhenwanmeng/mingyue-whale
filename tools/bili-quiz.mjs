#!/usr/bin/env node
// B 站转正答题：取题 → OCR → 桥接会话选答案 → 按人类节奏提交。
// 不追求全对，过 60 就提前交卷；错了就继续，遇到 41014 就停，不硬闯。
//
// 用法：node tools/bili-quiz.mjs [--max 90] [--min-delay 4000] [--max-delay 8000]
import fs from 'node:fs';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { safeFetchBuffer } from '../packages/safe-fetch/src/index.js';
import { readCredential } from './lib/bili-login.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE = path.join(ROOT, 'state');
const QDIR = path.join(STATE, 'bili-quiz');
fs.mkdirSync(QDIR, { recursive: true });
const consoleToken = (() => { try { return fs.readFileSync(path.join(STATE, 'console-token'), 'utf8').trim(); } catch { return ''; } })();
const cred = readCredential(path.join(STATE, 'bili-credentials.json'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COOKIE = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`;
const H = { 'User-Agent': UA, referer: 'https://www.bilibili.com/h5/newbie/entry?navhide=1', cookie: COOKIE };
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] ?? true);
}
const MAX = Math.max(1, Math.min(100, Number(args.get('max')) || 90));
const MIN_DELAY = Math.max(1500, Number(args.get('min-delay')) || 4000);
const MAX_DELAY = Math.max(MIN_DELAY, Number(args.get('max-delay')) || 8000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms))
  ]);
}

async function biliGet(p) {
  const r = await withTimeout(fetch(`https://api.bilibili.com${p}`, { headers: H, signal: AbortSignal.timeout(30000) }), 35000, `GET ${p}`);
  return withTimeout(r.json(), 15000, `GET ${p} json`).catch(() => ({}));
}
async function biliPost(p, params, referer) {
  console.log(`    POST ${p} …`);
  const r = await withTimeout(fetch(`https://api.bilibili.com${p}`, {
    method: 'POST',
    headers: { ...H, ...(referer ? { referer } : {}), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30000)
  }), 35000, `POST ${p}`);
  const j = await withTimeout(r.json(), 15000, `POST ${p} json`).catch(() => ({}));
  console.log(`    POST ${p} → HTTP ${r.status} code=${j.code ?? '?'} ${j.message ?? ''}`);
  return j;
}
async function bridgeAnswer(text) {
  if (!consoleToken) throw new Error('缺少 state/console-token，桥接控制台未启动？');
  const r = await fetch('http://127.0.0.1:3100/api/socialV2/bili/quiz-answer', {
    method: 'POST',
    headers: { 'x-console-token': consoleToken, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(120000)
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok || !j.answer) throw new Error(j.error || '答题接口没有返回选项');
  return String(j.answer).toUpperCase();
}

const worker = await createWorker('chi_sim', 1, {
  langPath: path.join(ROOT, 'node_modules', '@tesseract.js-data', 'chi_sim', '4.0.0_best_int'),
  gzip: true
});

function stagePath(stage) {
  return stage === 'extra' ? '/x/answer/v4/extra' : stage === 'pro' ? '/x/answer/v4/pro' : '/x/answer/v4/base';
}
async function fetchQuestion(stage) {
  const j = await biliGet(stagePath(stage));
  if (j.code !== 0 || !j.data?.question) return { none: true, code: j.code, message: j.message };
  const q = j.data.question;
  const file = path.join(QDIR, `q-${q.id}.png`);
  const img = await safeFetchBuffer(q.image, 4 * 1024 * 1024);
  fs.writeFileSync(file, img.buffer);
  const out = await worker.recognize(file);
  return { q, text: String(out.data.text || '').trim(), file };
}
async function status() {
  const j = await biliGet('/x/answer/v4/status');
  if (j.code !== 0) throw new Error(`status ${j.code}: ${j.message}`);
  return j.data;
}
async function chooseProTypes() {
  const j = await biliGet('/x/answer/v4/pro/type');
  if (j.code !== 0 || !Array.isArray(j.data)) throw new Error(`pro/type ${j.code}: ${j.message}`);
  const ids = [];
  for (const parent of j.data) {
    for (const f of parent.fields || []) {
      if (!ids.includes(f.id)) ids.push(f.id);
      if (ids.length >= 4) break;
    }
    if (ids.length >= 4) break;
  }
  if (!ids.length) throw new Error('没有可选的自选题分类');
  const r = await biliPost('/x/answer/v4/pro/type/check', { types: ids.join(','), csrf: cred.bili_jct });
  if (r.code !== 0) throw new Error(`pro/type/check ${r.code}: ${r.message}`);
  console.log(`  自选题分类已选：${ids.join(',')}`);
}
async function submitEarly() {
  const r = await biliPost('/x/answer/v4/submit', { csrf: cred.bili_jct }, 'https://www.bilibili.com/h5/newbie/entry?navhide=1');
  console.log('  提前交卷：', r.code, r.message, JSON.stringify(r.data || {}).slice(0, 200));
  return r;
}

console.log(`B 站转正答题 | 目标 ${MAX} 题 | 间隔 ${MIN_DELAY}-${MAX_DELAY}ms`);
let answered = 0;
let wrong = 0;
let last = null;
try {
  for (let i = 0; i < MAX; i += 1) {
    const st = await status();
    console.log(`\n[${answered + 1}] stage=${st.stage} score=${st.score} number=${st.number} err=${st.base_err_num}`);
    if (st.status === 3 || st.stage === 'complete') {
      console.log('✅ 已经通过/完成');
      break;
    }
    if (st.score >= 60) {
      const r = await submitEarly();
      if (r.code === 0) { console.log('🎉 分数已够，交卷完成'); break; }
    }
    if (st.stage === 'pro_type') { await chooseProTypes(); continue; }
    const stage = st.stage === 'extra' ? 'extra' : st.stage === 'pro' ? 'pro' : 'base';
    const item = await fetchQuestion(stage);
    if (item.none) {
      console.log(`  取题结束：${item.code} ${item.message}`);
      if (st.score >= 60) { await submitEarly(); break; }
      continue;
    }
    const { q, text } = item;
    if (!text) { console.log('  OCR 空文本，跳过'); continue; }
    console.log(`  题目 ${q.id}：${text.replace(/\s+/g, ' ').slice(0, 120)}…`);
    const letter = await bridgeAnswer(text);
    const idx = 'ABCD'.indexOf(letter);
    const option = q.options[Math.min(Math.max(idx, 0), q.options.length - 1)];
    const delay = rand(MIN_DELAY, MAX_DELAY);
    console.log(`  选 ${letter} → ${option.hash.slice(0, 8)}…，等 ${delay}ms`);
    await sleep(delay);
    console.log('  提交中…');
    let r;
    try {
      r = await biliPost(stage === 'pro' ? '/x/answer/v4/pro/check' : '/x/answer/v4/base/check', {
        question_id: String(q.id),
        ans_hash: option.hash,
        csrf: cred.bili_jct
      });
    } catch (error) {
      console.log(`  ❌ 提交请求失败：${error?.message ?? error}`);
      continue;
    }
    answered += 1;
    if (r.code !== 0) {
      console.log(`  ❌ 提交返回 ${r.code}: ${r.message}`);
      if (r.code === 41014) { console.log('⛔ 答题过快/错误太多，停手'); break; }
      if (r.code === 41012) { console.log('⛔ 题目 id 不合法，停手'); break; }
      continue;
    }
    const passed = r.data?.passed === true;
    if (!passed) wrong += 1;
    last = { id: q.id, passed, score: st.score, at: new Date().toISOString() };
    fs.appendFileSync(path.join(QDIR, 'log.jsonl'), `${JSON.stringify({ ...last, letter, text: text.slice(0, 500) })}\n`, 'utf8');
    console.log(`  ${passed ? '✅' : '❌'} 正确=${passed} 累计答题=${answered} 错=${wrong}`);
  }
  const st = await status();
  console.log('\n最终状态：', JSON.stringify(st));
  if (st.score >= 60 && st.status !== 3) await submitEarly();
} finally {
  await worker.terminate();
}
