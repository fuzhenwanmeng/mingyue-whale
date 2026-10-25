# 记忆分层与写入规则

> 记忆不是越多越好，是“谁写、写哪里、谁读、何时合并”要清楚。  
> 原则：一个来源，一个权威；前台只读/检索，后台统一整理。

## 核心保护区（不删、不覆盖）

- `growth.md`：稳定人格与关系，唯一本体来源；
- `qq-memory-digest.md`：当前短期自我；
- 当前人格卡：growth 的投影，不是独立本体；
- `state/events/`：原始经历，只追加；
- 日记/关系记忆：不因整理被清空。

## 分层

| 层 | 位置 | 谁写 | 谁读 | 作用 |
| --- | --- | --- | --- | --- |
| 原始经历 | `state/events/<date>.jsonl` | 桥接（只追加） | 后台/检索 | 消息、活动、任务、注意力 |
| 每日合并 | `state/consolidated/<date>.md` | 合并脚本 | 主会话 | 当天局部记录合并稿 |
| 短期自我 | `whale-roles/qq-memory-digest.md` | 主会话 | QQ/B站/后台 | 当前需要记住的摘要 |
| 稳定人格 | `whale-roles/growth.md` | 主会话 | 全部 | 稳定变化、关系、价值观 |
| 人格投影 | `roles/<角色>.md` | 主会话/编译 | QQ | growth 的对外投影 |
| 关系记忆 | `state/relations/`、per-chat memory | 桥接/QQ | QQ | 具体人/群的约定与印象 |
| B站领域 | `state/bili-watch/`、`bili-choices.jsonl` | note worker/桥接 | B站/检索 | 看过的内容、评论、活动 |
| 状态 | `presence/mood/proactive/attention/tasks` | 桥接 | 后台 | 当下状态，不是长期记忆 |

## 写入规则

1. 只有主会话能写 growth / digest / 人格卡；
2. 桥接/worker 只写事件、B站笔记、关系缓存、状态；
3. 子智能体不写长期记忆，只返回结果；
4. 一次错误/一次情绪不写 growth，先进事件/日记；
5. 稳定重复的模式才进 growth；
6. 人格卡是投影，growth 变了才重编。

## 读取优先级

1. 当前会话上下文；
2. per-chat 关系记忆；
3. digest；
4. 需要细节时：`qq_memory_search` 查事件/B站笔记/最近消息；
5. 仍不够才翻原始会话日志。

## 优化原则

优化只动重复层、过时层、未启用层；先归档/停用，不删除核心。  
任何清理前先备份，核心层由主会话确认。
