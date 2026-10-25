// B 站扫码登录（passport 接口，零第三方依赖）。
//
// 流程：
//   ① GET passport .../qrcode/generate → { url, qrcode_key }
//   ② 把 url 画成二维码给用户扫
//   ③ 轮询 .../qrcode/poll?qrcode_key=…：
//        86101 未扫 / 86090 已扫待确认 / 0 成功 / 86038 过期
//   ④ 登录凭证在轮询响应的 Set-Cookie 里（不是 data.url）
//   ⑤ 写 state/bili-credentials.json（只给本机，不回显）
//
// 这套是看完 dsh-bili-pod（MIT，fork 自 dsh-bili-whale）的 lib/login.mjs 后
// 按同样接口重写的，没有直接 import 它的代码。
import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GEN = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header';
const POLL = (key) => `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}&source=main-fe-header`;
const SPI = 'https://api.bilibili.com/x/frontend/finger/spi';

const WANT = { SESSDATA: 'sessdata', bili_jct: 'bili_jct', DedeUserID: 'dedeuserid', buvid3: 'buvid3' };

function setCookiesOf(res) {
  const h = res.headers;
  if (typeof h.getSetCookie === 'function') {
    const list = h.getSetCookie();
    if (Array.isArray(list) && list.length) return list;
  }
  const merged = h.get('set-cookie') || '';
  if (!merged) return [];
  return merged.split(/,(?=\s*[A-Za-z0-9_-]+=)/).map((s) => s.trim());
}

export function pickCookies(list) {
  const jar = {};
  for (const raw of list ?? []) {
    const first = String(raw).split(';')[0] || '';
    const i = first.indexOf('=');
    if (i <= 0) continue;
    const name = first.slice(0, i).trim();
    const value = first.slice(i + 1).trim();
    if (WANT[name]) jar[WANT[name]] = value;
  }
  return jar;
}

async function ensureBuvid3(jar) {
  if (jar.buvid3) return jar;
  try {
    const r = await fetch(SPI, { headers: { 'User-Agent': UA } });
    const j = await r.json();
    const v = j?.data?.b_3;
    if (v) jar.buvid3 = String(v);
  } catch { /* buvid3 不是写操作必需 */ }
  return jar;
}

/** ① 生成二维码内容。 */
export async function loginStart() {
  const r = await fetch(GEN, { headers: { 'User-Agent': UA, referer: 'https://www.bilibili.com/' } });
  if (!r.ok) throw new Error(`生成二维码失败：HTTP ${r.status}`);
  const j = await r.json();
  const data = j?.data;
  if (!data?.qrcode_key || !data?.url) throw new Error(`生成二维码失败：${j?.message || '返回里没有 qrcode_key'}`);
  return { key: data.qrcode_key, url: data.url, created: Date.now() };
}

/** ② 轮询一次。 */
export async function loginPoll(key) {
  const res = await fetch(POLL(key), {
    headers: { 'User-Agent': UA, referer: 'https://www.bilibili.com/' },
    redirect: 'manual'
  });
  const list = setCookiesOf(res);
  let body = {};
  try { body = await res.json(); } catch { /* 有时空体 */ }
  const code = Number(body?.data?.code ?? -1);
  if (code === 0) {
    const jar = await ensureBuvid3(pickCookies(list));
    if (!jar.sessdata) return { state: 'unknown', code, message: '登录成功但响应里没有 SESSDATA' };
    return { state: 'ok', code, credential: jar };
  }
  const map = { 86101: 'waiting', 86090: 'scanned', 86038: 'expired' };
  return { state: map[code] ?? 'unknown', code, message: body?.message || '' };
}

/** 用凭据查自己是谁（nav 只读）。 */
export async function fetchSelf(cred) {
  const cookie = [
    `SESSDATA=${cred.sessdata}`,
    `bili_jct=${cred.bili_jct}`,
    cred.buvid3 ? `buvid3=${cred.buvid3}` : ''
  ].filter(Boolean).join('; ');
  const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': UA, referer: 'https://www.bilibili.com/', cookie }
  });
  const j = await r.json().catch(() => ({}));
  if (j?.code !== 0 || !j?.data?.isLogin) return null;
  return { mid: String(j.data.mid), name: j.data.uname };
}

/**
 * 写凭据文件。只写本机 state，不回显内容；已有字段合并。
 * @returns {{file:string, present:string[]}}
 */
export function saveCredential(cred, file) {
  const clean = (v) => String(v ?? '').replace(/^["'\s]+|["'\s]+$/g, '');
  const next = {
    sessdata: clean(cred.sessdata),
    bili_jct: clean(cred.bili_jct),
    buvid3: clean(cred.buvid3),
    dedeuserid: clean(cred.dedeuserid)
  };
  if (!next.sessdata) throw new Error('SESSDATA 为空');
  if (!/^[0-9a-fA-F]{32}$/.test(next.bili_jct)) throw new Error('bili_jct 格式不对（应为 32 位十六进制）');
  let old = {};
  try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { old = {}; }
  const payload = { ...old };
  for (const [k, v] of Object.entries(next)) if (v) payload[k] = v;
  if (cred.mid) payload.mid = String(cred.mid);
  if (cred.name) payload.name = String(cred.name);
  payload.savedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows 上多半无效 */ }
  return { file, present: Object.keys(payload).filter((k) => !['savedAt', 'mid', 'name'].includes(k)) };
}

export function readCredential(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return {
      sessdata: String(j.sessdata ?? '').trim(),
      bili_jct: String(j.bili_jct ?? '').trim(),
      buvid3: String(j.buvid3 ?? '').trim(),
      dedeuserid: String(j.dedeuserid ?? '').trim(),
      mid: String(j.mid ?? '').trim(),
      name: String(j.name ?? '').trim()
    };
  } catch { return null; }
}

export function credentialState(file) {
  const c = readCredential(file);
  return { present: !!c, hasSess: !!c?.sessdata, hasJct: !!c?.bili_jct, hasBuvid: !!c?.buvid3 };
}
