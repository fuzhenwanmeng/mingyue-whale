// relations.mjs — QQ 关系档案 + 分寸值（离线原型，不联网、不发消息）
//
// 设计原则（2026-10-23 与老大定）：
//   1. 分寸值只用于「少打扰」，不是讨好开关，也绝不给对方看
//   2. 硬规则优先：对方明确说「别烦」= 永久 opt-out
//   3. 只存摘要与统计，不存聊天原文
//   4. 好友是流水：90 天无互动降为 fading，再久归档
//
// 纯函数 + 一个本地 JSON 存储；没有网络、没有计时器，方便单测。

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  initialAffinity: 45,
  minAffinity: 0,
  maxAffinity: 100,
  dailyGainCap: 6,
  quietStartHour: 23,
  quietEndHour: 8,
  decayDays: 30,
  decayPoints: 1,
  fadeDays: 30,
  archiveDays: 90,
  ignoredCooldownDays: 30,
  ignoredStreakLimit: 2,
  levels: [
    { min: 70, name: 'warm', intervalDays: 3 },
    { min: 55, name: 'usual', intervalDays: 7 },
    { min: 40, name: 'cool', intervalDays: 14 },
    { min: 20, name: 'cold', intervalDays: 30 },
  ],
});

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────── 卡片 ───────────────────────────

export function newCard(uin, { nickname = '', source = '', now = new Date() } = {}) {
  const ts = toIso(now);
  return {
    uin: String(uin),
    nickname,
    alias: '',
    source,
    firstSeen: ts,
    affinity: DEFAULTS.initialAffinity,
    affinityVersion: 2,
    gainDate: null,
    gainToday: 0,
    stats: { replies: 0, myInitiations: 0, theirInitiations: 0, ignoredProactives: 0 },
    ignoredStreak: 0,
    lastInteraction: null,
    lastProactive: null,
    optOut: false,
    optOutReason: null,
    notes: [],
    lifecycle: 'new',
  };
}

function toIso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function parse(iso) {
  return iso ? new Date(iso).getTime() : NaN;
}

function clamp(n) {
  return Math.max(DEFAULTS.minAffinity, Math.min(DEFAULTS.maxAffinity, Math.round(n)));
}

// ─────────────────────────── 事件打分 ───────────────────────────

/**
 * 对方回了消息。
 * @param {object} card
 * @param {{at: Date|string, latencyMs?: number, length?: number, initiatedByThem?: boolean}} ev
 */
export function onTheirMessage(card, { at = new Date(), latencyMs, length = 0, initiatedByThem = false } = {}) {
  const c = structuredClone(card);
  c.stats.replies += 1;
  let delta = 1;
  if (initiatedByThem) {
    c.stats.theirInitiations += 1;
    delta += 2;
  }
  if (Number.isFinite(latencyMs) && latencyMs <= 5 * 60 * 1000) delta += 1;
  if (length >= 20) delta += 1;
  // 当天涨幅封顶：聊得久 ≠ 关系好，避免一场长聊把分数刷满
  const day = new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  if (c.gainDate !== day) { c.gainDate = day; c.gainToday = 0; }
  const room = Math.max(0, DEFAULTS.dailyGainCap - (Number(c.gainToday) || 0));
  const applied = Math.min(delta, room);
  c.affinity = clamp(c.affinity + applied);
  c.gainToday = (Number(c.gainToday) || 0) + applied;
  c.ignoredStreak = 0;
  c.lastInteraction = toIso(at);
  c.lifecycle = 'active';
  return c;
}

/** 我发起了一次主动私聊（还没回）。 */
export function onMyProactive(card, { at = new Date() } = {}) {
  const c = structuredClone(card);
  c.stats.myInitiations += 1;
  c.lastProactive = toIso(at);
  return c;
}

/** 那次主动私聊被无视了（超过观察窗口没回）。 */
export function onProactiveIgnored(card, { at = new Date() } = {}) {
  const c = structuredClone(card);
  c.stats.ignoredProactives += 1;
  c.ignoredStreak += 1;
  c.affinity = clamp(c.affinity - 10);
  return c;
}

/** 对方明确表示不想被打扰：永久 opt-out，直到他自己再来找我。 */
export function onExplicitOptOut(card, { at = new Date(), reason = '对方明确表示不想被打扰' } = {}) {
  const c = structuredClone(card);
  c.optOut = true;
  c.optOutReason = reason;
  c.affinity = 0;
  c.lastInteraction = toIso(at);
  return c;
}

/** 时间衰减：每 30 天不互动 -1，最低 20；opt-out 不衰减。 */
export function decay(card, { at = new Date() } = {}) {
  const c = structuredClone(card);
  if (c.optOut) return c;
  const base = parse(c.lastInteraction ?? c.firstSeen);
  const days = Math.floor((new Date(at).getTime() - base) / DAY_MS);
  if (!Number.isFinite(days) || days < DEFAULTS.decayDays) return c;
  const steps = Math.floor(days / DEFAULTS.decayDays);
  c.affinity = Math.max(20, c.affinity - steps * DEFAULTS.decayPoints);
  return c;
}

// ─────────────────────────── 额度与分寸 ───────────────────────────

export function levelOf(affinity) {
  for (const l of DEFAULTS.levels) if (affinity >= l.min) return l;
  return { min: 0, name: 'silent', intervalDays: Infinity };
}

/**
 * 现在能不能主动开口？
 * @returns {{allowed: boolean, level: string, intervalDays: number, nextAllowedAt: string|null, reason: string}}
 */
export function budget(card, { at = new Date() } = {}) {
  const now = new Date(at);
  const lv = levelOf(card.affinity);

  if (card.optOut) {
    return { allowed: false, level: 'optout', intervalDays: Infinity, nextAllowedAt: null, reason: '对方已明确不想被打扰' };
  }
  if (card.ignoredStreak >= DEFAULTS.ignoredStreakLimit) {
    const base = parse(card.lastProactive ?? card.lastInteraction ?? card.firstSeen);
    const next = new Date(base + DEFAULTS.ignoredCooldownDays * DAY_MS);
    return {
      allowed: now.getTime() >= next.getTime(),
      level: 'cooldown',
      intervalDays: DEFAULTS.ignoredCooldownDays,
      nextAllowedAt: next.toISOString(),
      reason: `连续 ${card.ignoredStreak} 次没回，冷静一下`,
    };
  }
  if (!Number.isFinite(lv.intervalDays)) {
    return { allowed: false, level: lv.name, intervalDays: Infinity, nextAllowedAt: null, reason: '分寸值太低，只做被动回复' };
  }
  const base = parse(card.lastProactive ?? card.firstSeen);
  let next = new Date(base + lv.intervalDays * DAY_MS);
  // 免打扰时段：23:00–08:00 顺延到次日 08:00
  const hour = now.getHours();
  const quiet = hour >= DEFAULTS.quietStartHour || hour < DEFAULTS.quietEndHour;
  if (quiet) {
    const wake = new Date(now);
    if (hour >= DEFAULTS.quietStartHour) wake.setDate(wake.getDate() + 1);
    wake.setHours(DEFAULTS.quietEndHour, 0, 0, 0);
    if (wake > next) next = wake;
    return {
      allowed: false,
      level: lv.name,
      intervalDays: lv.intervalDays,
      nextAllowedAt: next.toISOString(),
      reason: '免打扰时段',
    };
  }
  return {
    allowed: now.getTime() >= next.getTime(),
    level: lv.name,
    intervalDays: lv.intervalDays,
    nextAllowedAt: next.toISOString(),
    reason: now.getTime() >= next.getTime() ? '可以开口' : '还没到间隔',
  };
}

/** 关系阶段：active / fading / archived。 */
export function lifecycleOf(card, { at = new Date() } = {}) {
  const base = parse(card.lastInteraction ?? card.firstSeen);
  const days = Math.floor((new Date(at).getTime() - base) / DAY_MS);
  if (days >= DEFAULTS.archiveDays) return 'archived';
  if (days >= DEFAULTS.fadeDays) return 'fading';
  return card.lifecycle === 'new' ? 'new' : 'active';
}

// ─────────────────────────── 本地存储 ───────────────────────────

// v1 卡片分涨得太快：读入时把旧分数压一半（45 为基准），并标记 v2。
function migrateCard(card) {
  if (!card || typeof card !== 'object') return card;
  if (card.affinityVersion === 2) return card;
  const a = Number(card.affinity);
  if (Number.isFinite(a)) card.affinity = clamp(45 + Math.round((a - 45) * 0.5));
  card.affinityVersion = 2;
  card.gainDate = null;
  card.gainToday = 0;
  return card;
}

export class RelationStore {
  constructor(dir) {
    this.dir = dir;
  }

  fileOf(uin) {
    return path.join(this.dir, `${String(uin).replace(/[^\d]/g, '')}.json`);
  }

  load(uin) {
    try {
      return migrateCard(JSON.parse(fs.readFileSync(this.fileOf(uin), 'utf8')));
    } catch {
      return null;
    }
  }

  save(card) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.fileOf(card.uin);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(card, null, 2), 'utf8');
    fs.renameSync(tmp, file); // 原子替换
    return file;
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => migrateCard(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'))));
  }

  remove(uin) {
    const file = this.fileOf(uin);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
