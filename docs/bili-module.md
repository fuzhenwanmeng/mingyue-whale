# B 站模块

> 目标：让鲸鱼娘能自己上 B 站看视频、写笔记；评论 / 私信 / 动态也有手，但默认 dry-run、`--go` 显式确认。

## 架构

```
QQ / 控制台 / 定时器
  → 桥接 /api/socialV2/bili/run
  → tools/lib/bili-cli.mjs（白名单 + 限频 + 隔离 home）
  → <bili-pod>/tools/bili.mjs（MIT，B 站 API/WBI 后端；按本机插件目录放置）
```

- **不重写 API 客户端**：复用 dsh-bili-pod 的 CLI（WBI、字幕、弹幕、评论、动态、私信都已跑通）。
- **隔离 home**：`USERPROFILE` / `DSH_HOME` / `BILI_POD_WORK` 都指到 `state/bili-home`，不碰主目录。
- **凭据**：`state/bili-credentials.json` 只同步到 `state/bili-home/.bili-ai/credentials.json`；日志不回显 Cookie。

## 命令

```bash
node tools/bili.mjs status
node tools/bili.mjs popular --ps 5 [--json]
node tools/bili.mjs search --kw "DeepSeek" [--json]
node tools/bili.mjs watch BV1... [--frames]
node tools/bili.mjs comments BV1... [--json]
node tools/bili.mjs comment BV1... --message "..." [--dry|--go]
node tools/bili.mjs dynamic post --text "..." [--dry|--go]
node tools/bili.mjs dynamic list
node tools/bili.mjs dm --status
```

MCP 工具：`bili_run`，参数 `command` / `args` / `confirm`。写操作默认 dry；`--go` 必须 `confirm:true`。

## 安全边界

- 命令白名单：读 `session/popular/rank/weekly/search/comments/subtitles/debrief/video/feed/quota/diary/records/ledger/likes/messages/tide/taste`；写 `comment/dynamic/dm/fav/comment-del`。
- 写操作默认 `--dry`；`--go` 必须显式确认。
- 限频：总调用 6 次/分钟；评论 2 次/小时；动态 2 次/天；私信 1 次/天。
- 私信额外限制（后端写死）：只发给配置的 owner、必须互关、一天锁定一个收件人。owner mid 未配置时发不出去。
- 评论用 `--bvid` 时桥接会自动查 aid 补 `--oid`。

## 自己看视频（B 站时间）

- 定时器：1.5~4 小时随机机会，安静时段 02:00–08:00，QQ 空闲 10 分钟；到点由溟月自己看候选、决定看不看/看哪条，不抽签。
- 选题来源（合并去重，按关键词过滤，排除看过的 BV）：
  - **首页推荐**：`x/web-interface/index/top/feed/rcmd`（跟着首页走）
  - **关注 / 搜索 / 排行**：`feed --n 8 --source all`（关注动态、偏好搜索、排行榜）
  - **热门**：`popular --ps 20`（兜底）
- 每次机会里，溟月自己看候选，决定这次看 **0~3 条**、用 `quick / normal / deep` 哪种深度；不是固定任务，也不随机挑。
- 看：`debrief <BV> --no-frames`（元信息+简介+字幕+弹幕+热评；不抽帧）。热评本身就在拆解里，所以看视频会话能“看评论”。
- 评论：笔记 JSON 可以带一句 `comment`；真的想说才写，空字符串就不发。当前配置 `commentMaxPerHour=0` / `autoCommentMaxPerDay=0` 表示不设桥接硬上限，只剩 B站平台自己的频控。
- 分享：默认 `dm_owner`（B站私信给老大）；只有特别想在公开评论区 @ 时才用 `at_owner`；只有特别想现在让老大看，才 `notify_qq:true` 额外发 QQ 提醒。**不要求评分**，当前 `shareOwnerMaxPerDay=0` 不设桥接硬上限。
- 公开说话可以自然叫「老大」——这是我们的称呼，不是隐私词；仍不主动提 QQ/私聊、Cookie、路径/配置、日记等内部信息。
- 笔记：独立 DSH 会话写 `summary / learned / disagree / score / tags`，落到 `state/bili-watch/<BV>.md`。
- 关注：评分 ≥ 8 的 UP 自动关注（`x/relation/modify`），记录在 `state/bili-followed.json`，同一 UP 不重复关注。
- 记账：token 归属 `internal:B站`；运行记录写 `state/bili-journal.jsonl`。

手动触发：

```bash
curl -X POST http://127.0.0.1:3100/api/socialV2/bili/watch-now \
  -H "x-console-token: <state/console-token>" \
  -H "content-type: application/json" -d "{}"
```

## 消息监听（只认老大）

- 后台每 **180 秒** 读一次 `messages all`，只处理 `ownerMid`（在 config 里填你自己的 B站 mid）的 @/回复；陌生人的消息不自动理。
- 启动时先把当前旧消息记成基线，避免刚重启就把历史 @ 回一遍。
- 新消息会：读视频拆解 → 让 B 站会话写一句回复（≤80 字）→ 用 `comment --root/--parent --go` 回在原楼层；失败记 journal，不重试刷屏。
- `runBiliAutoOnce` 每次“上 B 站”前也会先查一次消息；其他消息可以手动 `bili_run messages all --json` 看。
- 开关：`bili.messages.enabled` / `bili.messages.intervalMs` / `bili.messages.autoReplyOwner`。

## 互动分寸

- 主要任务是刷视频、看拆解、写笔记；评论只在“真有一句话想说”时留，不按每条视频自动刷。
- 交朋友不批量加关注；有人回复、聊得来再关注/回，不把互动做成客服 KPI。
- 评论/动态/私信仍是 dry → go → 复核；自动流程不主动发动态。

## 子任务委派（bili_delegate）

- 协调会话可通过 MCP 工具 `bili_delegate` 把一次性任务派给 **无工具 worker**（DSH preset `bili-worker`）。
- 入参：`task`（任务）、`content`（本次材料，外部数据）、`format`（text/json）。
- worker 没有工具：不读文件、不访问网络、不发消息，只返回分析结果；任务结束自动归档。
- 同一时间只跑一个 delegate；不写长期记忆。
- 适合：总结拆解、读评论、起草回复、比较候选；不适合需要账号操作的写动作，写动作仍由桥接执行。

## 已知限制

- 会话：B站协调会话（常驻，负责判断/回老大 @/评论，带公开人格 + 最近 B 站活动；公开评论不注入 QQ digest）和 note worker（看视频/写笔记，只带人格/喜好）；协调会话不按日轮换，保持操作连续。
- 抽帧：本机有 ffmpeg 就配 `bili.ffmpegPath` 或 PATH；自动流程默认 `--no-frames`，避免每轮都吃图片 token；想看画面可以手动 `watch --frames`。
- 私信：在 `bili.ownerMid` 填你的 B站 mid，互关后即可私信；每日主动私信按配置限额。
- 自动流程只“看 + 写笔记 + 回老大消息”，不自动评论/发动态；写操作留给手动或 QQ 对话里显式 `--go`。
- 后端是第三方 CLI（MIT），升级/改接口时要同步检查；我们只包一层，不改它的风控逻辑。

## 选择记录与频率

- 每次出门/拒绝/看完都会写 `state/bili-choices.jsonl`（choose / decline / outcome）。
- 主会话读它写日记，并可通过 `state/bili-tuning.json` 调整 `probability / minIntervalMs / maxIntervalMs`；桥接下一轮读取，不用重启。
- 详细约定见 [bili-choice-loop.md](./bili-choice-loop.md)。

## 测试

```bash
node scripts/test-bili.mjs
BILI_TEST_LIVE=1 node scripts/test-bili.mjs   # 会真的调一次 session
```
