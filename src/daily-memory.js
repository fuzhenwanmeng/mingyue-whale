// daily-memory.js — 当日记忆库采集端（只写元数据与摘要，不存聊天原文）
//
// 目录结构（与《记忆协议 v0.1》一致）：
//   <dailyDir>/YYYY-MM/YYYY-MM-DD/qq.jsonl
//
// 事件行（bridge 自动）：{ ts, platform:'qq', kind:'chat', with:'private:xxx', direction:'in|out', length, source:'bridge' }
// 摘要行（QQ 侧 AI 调 qq_daily_note）：{ ts, platform:'qq', kind:'note|learn|decision|promise', with:'private:xxx', summary:'≤200字', source:'agent' }
//
// 默认关闭，config.json 的 memory.enabled=true 才写；任何异常都吞掉，不影响消息链路。

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = path.resolve(process.cwd(), 'state', 'daily');

function pad(n) {
  return String(n).padStart(2, '0');
}

export function createDailyMemory(cfg = {}) {
  const mem = cfg.memory ?? {};
  const enabled = mem.enabled === true;
  const dir = String(mem.dailyDir || DEFAULT_DIR);
  const errors = [];

  function dayDir(at = new Date()) {
    const y = at.getFullYear();
    const m = pad(at.getMonth() + 1);
    const d = pad(at.getDate());
    return path.join(dir, `${y}-${m}`, `${y}-${m}-${d}`);
  }

  function append(file, obj, at = new Date()) {
    if (!enabled) return null;
    try {
      const d = dayDir(at);
      fs.mkdirSync(d, { recursive: true });
      const target = path.join(d, file);
      fs.appendFileSync(target, `${JSON.stringify(obj)}\n`, 'utf8');
      return target;
    } catch (error) {
      errors.push(String(error?.message ?? error));
      if (errors.length > 20) errors.shift();
      return null;
    }
  }

  /** 桥接自动记录的一条消息事件（不含正文）。 */
  function event({ platform = 'qq', kind = 'chat', withId = '', direction = '', length = 0, media = '', at = new Date() } = {}) {
    if (!enabled || !withId) return null;
    return append('qq.jsonl', {
      ts: new Date(at).toISOString(),
      platform,
      kind,
      with: withId,
      direction,
      length: Number(length) || 0,
      ...(media ? { media } : {}),
      source: 'bridge'
    }, at);
  }

  /** QQ 侧 AI 写的一条摘要（不抄原话，≤200 字）。 */
  function note({ key = '', text = '', kind = 'note', at = new Date() } = {}) {
    const clean = String(text ?? '').trim().slice(0, 200);
    if (!enabled || !key || !clean) return null;
    return append('qq.jsonl', {
      ts: new Date(at).toISOString(),
      platform: 'qq',
      kind: ['note', 'learn', 'decision', 'promise', 'mood'].includes(kind) ? kind : 'note',
      with: key,
      summary: clean,
      source: 'agent'
    }, at);
  }

  return { enabled, dir, dayDir, event, note, errors };
}
