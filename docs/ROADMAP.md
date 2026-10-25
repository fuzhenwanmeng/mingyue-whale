# Roadmap：从整体版到可组合插件

> 先留一个能跑的整体版当参考，再把人格、平台、记忆拆成可组合插件；不为了“纯插件”把能跑的东西先拆坏。

## v0.1 · 整体参考版

- 当前仓库：桥接 + B站/QQ 工具 + 人格/记忆/注意力设计记录；
- 用途：证明整体形态能跑，给别人看完整链路；
- 不包含私人配置、state、账号、聊天记录。

## v0.2 · persona-seed

目标包：`@mingyue/persona-seed`

- 人格种子、称呼、红线、记忆约定、成长规则；
- 不依赖 QQ/B站；
- 可单独挂到任何 DSH preset；
- 不包含个人 growth/diary。

验收：只装它，也能得到一个有边界、有说话方式的人格提示层。

## v0.3 · bilibili

目标包：`@mingyue/bilibili`

- B站 MCP 工具：搜索、看视频、笔记、评论、私信、关注；
- 自动看视频/笔记作为可选策略；
- Cookie 仍由用户自己填；
- 不依赖 QQ。

验收：只装它 + Cookie，就能在 DSH 里让 Agent 看 B站、写笔记。

## v0.4 · QQ 拆分

目标包：

- `@mingyue/qq-bridge`：长驻桥接服务；
- `@mingyue/dsh-qq-tools`：QQ 工具面（MCP）。

QQ 不能完全“下载即用”：仍需要 SnowLuma、QQ 登录、OneBot 配置。  
插件负责把服务、工具、权限边界打包好，账号那步由用户完成。

## v0.5 · memory-core（可选）

目标包：`@mingyue/memory-core`

- 事件日志、记忆检索、注意力调度；
- 跨平台但可选；不装也能聊天，只是连续性弱；
- 先保持文件型存储，数据量大了再考虑 SQLite/向量检索。

## 组合 preset

- `mingyue-qq`：persona + QQ；
- `mingyue-bili`：persona + B站；
- `mingyue-full`：persona + QQ + B站 + memory。

## 边界

- 不把个人账号、Cookie、聊天记录打进任何包；
- 不把“人格卡”当插件本体；人格卡是 growth 的投影；
- 插件之间通过 DSH 工具/事件协作，不互相 import 私有实现；
- 先 monorepo/workspaces，稳定后再考虑拆仓库。
