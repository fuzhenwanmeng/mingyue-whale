# B 站选择记录与频率调节

> 目标：把“今天为什么出门/为什么没出门/看了什么/后不后悔”留下来，让主会话据此判断下一天给我多少选择机会。

## 1. 选择记录（桥接写）

文件：`state/bili-choices.jsonl`

每行一条，类型：

- `plan`：这次自己定的计划。
  - `mode`（quick/normal/deep）、`count`、`picks`、`reason`、`mood`
  - 条数是溟月自己定的 0~3，不是固定任务
- `choose`：到了出门时间，选中了哪条。
  - `bvid/title/source/candidates/matchedKeyword/reason/chooser/mode/mood/alternatives`
  - `chooser` 是 `model`（自己判断）或 `fallback`（模型失败时的兜底）
  - `mode`: `quick`（短/浅看）、`normal`、`deep`（长/深看）；`skip` 时不选视频
  - `reason` 是模型给的理由，或 `keyword:AI` / `random/no-keyword`
- `decline`：到了时间但没出门。
  - `reason`: `quiet`（安静时段）、`idle`（QQ 刚有活动）、`model-skip`（自己决定今天不看）、`no_candidates`（没候选）、`paused`（主会话暂停）
- `outcome`：看完后的结果。
  - `score/tags/followed/mode/comment/summary/learned`
  - `comment` 是这次留下的评论（可能为空）；留不留是看视频的一部分，不是任务。

## 2. 频率调节（主会话写）

文件：`state/bili-tuning.json`

```json
{
  "probability": 1,
  "minIntervalMs": 5400000,
  "maxIntervalMs": 14400000,
  "note": "主会话根据日记调整：今天好奇多一点/想安静一点",
  "updatedAt": "2026-10-24T23:30:00+08:00"
}
```

- 桥接下一轮 `biliAutoCfg()` 会读取，不需要重启。
- `probability` 只当开关：**1=开启机会，0=暂停**；不再用它随机决定看不看。
- `min/maxIntervalMs` 是两次“机会窗口”之间的间隔，主会话根据日记调这个。
- 技术熔断在 `config.json` 的 `bili.auto`：
  - `maxSessionsPerDay`（默认 6）：一天最多几次计划；
  - `maxVideosPerDay`（默认 8）：一天最多看几条；
  - `deepCooldownMs`（默认 60 分钟）：`deep` 之后额外冷却；
  - `multiCooldownMs`（默认 30 分钟）：一次看 ≥2 条后额外冷却。
  这是防跑飞，不是喜好配额；计划仍可为 0。
- 到了机会窗口，由溟月自己看候选、决定看哪条/几条或今天不看；这是判断，不是抽签。

## 3. 主会话的每日/隔日流程

1. 读 `state/bili-choices.jsonl` 最近一天/两天的记录（`choose/decline/outcome` 里有 `chooser/mood/reason`）。
2. 写日记：今天看了什么、为什么选它、放弃了什么、看完什么感觉（开心/无聊/后悔/想继续）。
3. 判断下一天的选择机会：
   - 好奇、想探索 → 缩短间隔，多给几个机会窗口；
   - 疲惫、想安静、选择质量差 → 拉长间隔，少给机会；
   - 连续 `decline` 不一定坏，可能只是不想看，不要硬拉。
4. 写 `state/bili-tuning.json`；桥接自然生效。
5. 不做硬性“每天必须看几条”的 KPI。

## 4. 边界

- 选择记录是桥接的临时行为日志，不是长期人格记忆；长期日记/成长由主会话写。
- 选择记录里不存 Cookie、私信正文等敏感内容。
- 主会话只调频率，不替代“我”做具体选择；具体看哪条仍由桥接的选题逻辑决定。
