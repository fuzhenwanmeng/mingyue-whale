# 表情包「觅食」（sticker forage）

> 一句话：鲸鱼娘会自己出门逛表情包图库，挑像自己的、真的会用的收进 QQ 收藏夹；
> 收不收、什么时候收，由她自己判断，不设「每天必须收几张」的配额。

## 它怎么工作

```
定时器（随机 90 分钟 ~ 4 小时，安静时段不逛）
  → 桥接从梗鲸（aigengtu.com/DeepSeek娘）随机抽候选
  → 安全下载 + 格式/尺寸/宽高比/标题过滤
  → 候选进 state/sticker-inbox（24h 有效）
  → 独立的「觅食会话」看标题/台词判断（不打扰 QQ 聊天）
  → 选中的走 add_custom_face 收藏 + modify_custom_face 写备注
  → 本地 stickers.json 记 note/tags/usage
  → state/forage-journal.jsonl 写觅食日记
```

## 为什么分两条链路

| 链路 | 谁在用 | 说明 |
|---|---|---|
| 自主觅食 | 桥接定时器 | 不依赖 MCP 进程，桥接自己找图、自己调模型判断 |
| 手动/聊天中找图 | `qq_sticker_hunt` / `qq_sticker_import` | 给 QQ 里的 AI 用；需要 DSH 重启后才会出现新工具 |

> ⚠️ 新增 MCP 工具后，DSH 里已有的 MCP 进程还是旧代码；**重启一次桌面端/DSH** 后
> `qq_sticker_hunt` / `qq_sticker_import` 才会出现在工具清单里。
> 不想重启整个桌面端时，可以用 `plugin_manager` 把 `include:mcp-snowluma` 关掉再打开，
> 效果一样（会重新 spawn 一个带新代码的 MCP 进程）。
> 自主觅食不受这个影响（它走桥接内部链路）。

## 来源

- **梗鲸**（主）：`https://aigengtu.com/DeepSeek%E5%A8%98`
  - 单页 SSR，2309 张卡片；原图直链 `https://img.aigengtu.com/meme/<id>.webp`
  - 二创图，个人聊天用；本地记录来源，不公开转载、不商用
- **Bing 图片**（辅）：按关键词搜，适合「猫猫无语」这类通用梗

## 过滤（宁可少几张，也别让收藏夹变味）

- 只收 PNG/JPEG/GIF/WebP；边长 ≥96、≤4096；宽高比 **0.8~1.4**（表情包要接近方形）
- 单张默认 ≤4MB（GIF ≤2MB）
- 标题黑名单：擦边/极端脏话/纯编号/泛化「表情包」标题
- 与已收藏表情 md5 去重
- 觅食时模型只能看到**标题/台词**，看不到图；所以标题泛泛的一律不收，也不许编造画面细节

## 技术熔断（不是喜好配额）

- 两次搜索至少隔 15 秒
- 收藏最多 2 次/分钟、6 次/小时（防批量刷收藏夹）
- 两次觅食之间至少 90 分钟；安静时段 23:00–08:00 不逛
- 候选 24 小时过期自动清理

## 手动触发

```bash
# 看一次觅食（会真的按模型判断收藏，谨慎）
curl -X POST http://127.0.0.1:3100/api/socialV2/forage-now \
  -H "x-console-token: <state/console-token>" \
  -H "content-type: application/json" -d "{}"
```

CLI（不经过模型，手动找图/收藏）：

```bash
node tools/sticker-hunt.mjs search --source aigengtu --count 3
node tools/sticker-hunt.mjs list
node tools/sticker-hunt.mjs import <candidateId> --remark "备注"
```

## 自己收、自己删、后悔了还能捞回来

`qq_sticker_delete` 可以删**任何**收藏表情（自己收的、老大手动收藏的都行——这个号老大交给本鱼了）。
删之前会先把图片字节 + 备注/笔记/标签备份进本地回收站 `state/sticker-trash/`，**30 天内**可以用
`qq_sticker_restore` 恢复；删除必须写 `reason`，并受 2 次/分钟、6 次/小时的技术限频。

```bash
# 删
curl -X POST http://127.0.0.1:3100/api/socialV2/delete-sticker \
  -H "x-console-token: <state/console-token>" \
  -H "content-type: application/json" \
  -d '{"stickerId":"<id>","reason":"收错了/重复/糊"}'

# 恢复（trashId 用删除结果里的 emojiId）
curl -X POST http://127.0.0.1:3100/api/socialV2/restore-sticker \
  -H "x-console-token: <state/console-token>" \
  -H "content-type: application/json" \
  -d '{"trashId":"<emojiId>"}'

# 看回收站
curl http://127.0.0.1:3100/api/socialV2/sticker-trash \
  -H "x-console-token: <state/console-token>"
```

## 配置（config.json → socialV2.sticker）

```jsonc
{
  "hunt": {
    "enabled": true,
    "maxCandidates": 3,
    "maxImageBytes": 4194304,
    "minIntervalMs": 15000,
    "importMaxPerMinute": 2,
    "importMaxPerHour": 6,
    "deleteMaxPerMinute": 2,
    "deleteMaxPerHour": 6,
    "trashTtlMs": 2592000000,
    "trashMaxEntries": 100,
    "candidateTtlMs": 86400000
  },
  "forage": {
    "enabled": true,
    "minIntervalMs": 5400000,   // 90 分钟
    "maxIntervalMs": 14400000,  // 4 小时
    "probability": 0.4,         // 到点也只掷骰子
    "idleMs": 900000,           // QQ 安静 15 分钟才考虑
    "quietStartHour": 23,
    "quietEndHour": 8
  }
}
```

## 账本与日记

- `state/token-usage.jsonl`：觅食会话的 token 记账归属 `internal:觅食`
- `state/forage-journal.jsonl`：每次 hunt / import / 觅食会话的判断与日记
- 花费量级：一次「找 3 张 + 判断 + 收 1 张」约 6~10k token，空闲价约 ¥0.01
