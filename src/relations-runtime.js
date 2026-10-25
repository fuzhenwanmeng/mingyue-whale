// relations-runtime.js — 关系档案的运行时封装（供 bridge.js 调用）
//
// 只做三件事：
//   1. 收到好友私聊 → 记一笔（回复速度/长度/是否他先开口）
//   2. 发出私聊 → 区分「回复」与「主动」，主动才计入我的发起
//   3. 提供 canProactive() 给闸门用（本版只备着，默认不启用主动）
//
// 默认关闭：config.json 的 relations.enabled 不是 true 时，所有方法直接返回 null，
// 不写任何文件、不改变桥接现状。出错一律吞掉并记到 errors，绝不影响消息主链路。

import path from 'node:path';
import {
  RelationStore,
  newCard,
  onTheirMessage,
  onMyProactive,
  budget,
} from './relations.js';

const REPLY_WINDOW_MS = 10 * 60 * 1000; // 10 分钟内发出 = 回复；更久 = 主动开口

export function createRelationsRuntime(cfg = {}) {
  const rc = cfg.relations ?? {};
  const enabled = rc.enabled === true;
  const proactiveEnabled = rc.proactiveEnabled === true;
  const dir = rc.dir ? String(rc.dir) : path.join(process.cwd(), 'state', 'relations');
  const store = new RelationStore(dir);
  const lastInbound = new Map();  // uin -> ts（他最近一次说话）
  const lastOutbound = new Map(); // uin -> ts（我最近一次发消息）
  const errors = [];              // 最近 20 条错误（排障用）

  function safe(fn) {
    try {
      return fn();
    } catch (error) {
      errors.push(String(error?.message ?? error));
      if (errors.length > 20) errors.shift();
      return null;
    }
  }

  /** 收到好友私聊。返回更新后的卡片；关闭/出错时返回 null。 */
  function onInbound({ uin, nickname = '', length = 0, at = Date.now() } = {}) {
    if (!enabled || !uin) return null;
    return safe(() => {
      const now = new Date(at);
      let card = store.load(uin) ?? newCard(uin, { nickname, source: 'qq', now });
      if (!card.nickname && nickname) card.nickname = nickname;
      const prevOut = lastOutbound.get(uin);
      const latencyMs = prevOut ? Math.max(0, at - prevOut) : undefined;
      const initiatedByThem = !prevOut || at - prevOut > REPLY_WINDOW_MS;
      card = onTheirMessage(card, { at, latencyMs, length, initiatedByThem });
      store.save(card);
      lastInbound.set(uin, at);
      return card;
    });
  }

  /** 我发出了一条好友私聊。只有「主动」才写进卡片（回复不重复记）。 */
  function onOutbound({ uin, at = Date.now() } = {}) {
    if (!enabled || !uin) return null;
    return safe(() => {
      const now = new Date(at);
      const prevIn = lastInbound.get(uin);
      const isReply = prevIn !== undefined && at - prevIn <= REPLY_WINDOW_MS;
      lastOutbound.set(uin, at);
      if (!proactiveEnabled || isReply) return null;
      let card = store.load(uin) ?? newCard(uin, { now });
      card = onMyProactive(card, { at });
      store.save(card);
      return card;
    });
  }

  function cardOf(uin) {
    if (!enabled || !uin) return null;
    return safe(() => store.load(uin));
  }

  /** 非文字互动（如拍一拍）：只更新「对方最近来过」的时间，不加分不建卡。 */
  function touchInbound(uin, at = Date.now()) {
    if (!enabled || !uin) return null;
    return safe(() => {
      const card = store.load(uin);
      if (card) {
        card.lastInteraction = new Date(at).toISOString();
        card.ignoredStreak = 0;
        store.save(card);
      }
      lastInbound.set(uin, at);
      return card;
    });
  }

  /** 兜底判定：距对方最后一条消息超过 10 分钟（或没有记录）= 按主动处理。 */
  function isProactiveNow(uin, at = Date.now()) {
    if (!enabled || !uin) return false;
    const card = safe(() => store.load(uin));
    const last = lastInbound.get(uin) ?? (card?.lastInteraction ? Date.parse(card.lastInteraction) : null);
    if (!last || !Number.isFinite(last)) return true;
    return at - last > REPLY_WINDOW_MS;
  }

  /** 给好友卡片追加一条摘要（不存原文；最多 20 条，每条 200 字内）。 */
  function note(uin, text, at = Date.now()) {
    if (!enabled || !uin) return null;
    const clean = String(text ?? '').trim().slice(0, 200);
    if (!clean) return null;
    return safe(() => {
      const card = store.load(uin) ?? newCard(uin, { now: new Date(at) });
      card.notes = Array.isArray(card.notes) ? card.notes : [];
      card.notes.push({ date: new Date(at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), text: clean });
      if (card.notes.length > 20) card.notes = card.notes.slice(-20);
      store.save(card);
      return card;
    });
  }

  /** 发送前检查：proactive=true 时才可能被拦；回复永远放行，只给提示。 */
  function precheck(uin, { proactive = false, at = Date.now() } = {}) {
    if (!enabled) return { allowed: true, warnings: [] };
    const card = safe(() => store.load(uin));
    if (!card) {
      return proactive
        ? { allowed: false, warnings: ['没有关系档案：新朋友先被动，等对方来消息再建卡'] }
        : { allowed: true, warnings: [] };
    }
    if (card.optOut && proactive) {
      return { allowed: false, warnings: ['对方已明确表示不想被打扰'] };
    }
    if (!proactive) return { allowed: true, warnings: [] };
    const b = budget(card, { at });
    return {
      allowed: b.allowed,
      warnings: b.allowed ? [] : [`主动开口被拦：${b.reason}（下次 ${b.nextAllowedAt ?? '未知'}）`],
      budget: b,
    };
  }

  /** 现在能不能主动找这个人？返回 budget() 结构；没有档案 = 不允许。 */
  function canProactive(uin, at = Date.now()) {
    if (!enabled) return { allowed: false, level: 'disabled', intervalDays: null, nextAllowedAt: null, reason: '关系档案未启用' };
    const card = safe(() => store.load(uin));
    if (!card) return { allowed: false, level: 'unknown', intervalDays: null, nextAllowedAt: null, reason: '没有关系档案' };
    return safe(() => budget(card, { at })) ?? { allowed: false, level: 'error', intervalDays: null, nextAllowedAt: null, reason: '计算失败' };
  }

  return { enabled, proactiveEnabled, dir, store, onInbound, onOutbound, cardOf, canProactive, isProactiveNow, touchInbound, note, precheck, errors };
}
