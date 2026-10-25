# 桥接更新记录

## 2026-10-25 · 内测版

- 新增 P1 事件层：`state/events/<date>.jsonl` + `state/presence.json`；QQ 入站/B站活动/桥接启动先记录。
- 新增 P2 任务权限：只有老大 QQ 私聊能创建/改期/取消任务；其他平台 403；`qq_task_schedule`。
- 新增 P3 注意力：统一 60 秒 tick；任务 > B站/觅食（取最早）> 主动消息 > idle；04:15–09:00 不再启动长活动。
- 新增 P4 记忆合并：`consolidate-events.mjs`、`state/consolidated/<date>.md`；每天 03:20 后自动合并昨天，错过开机会补跑。
- 新增 P5 人格一致性：个人实例脚本会检查角色卡/growth/digest/公开投影；本仓库只保留设计说明，不附带私人档案。
- 新增 P6 情绪/主动：`state/mood.json`、`state/proactive.json`；白天 15 分钟检查、夜间低频；支持“去睡/醒来”的意图信号，不只看“晚安/早安”字面。
- 新增 P7 live：主动消息可发；到点任务可发 QQ 提醒；B站分享默认 `dm_owner`，特殊内容 `notify_qq` 才额外 QQ 提醒。
- 新增 P8 记忆检索：`qq_memory_search` / `GET /api/socialV2/memory/search`，支持关键词和引用 id；QQ 发出消息也写入事件日志。
- 角色卡升到 1.0.1：主名「溟月」，旧昵称保留为熟人外号。
- 新增 `docs/MEMORY-MAP.md`、`docs/DESIGN-JOURNEY.md`；内测问题记录在私人白板，未随仓库发布。

## 2026-10-24

- B站时间、选择循环、评论/@、关注、表情觅食、QQ/B站会话拆分等基础能力。
- 详见 `docs/bili-module.md`、`docs/bili-choice-loop.md`。
