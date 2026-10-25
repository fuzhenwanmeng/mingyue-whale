// 表情包觅食核心（无 QQ 依赖）。
//
// 这里只做「上网找图 → 安全下载 → 过滤 → 候选收件箱」；
// QQ 收藏夹的增删改查在 qq-bridge 的适配层里，核心包不 import 任何 QQ/OneBot 代码。
export * from './hunt.js';
export * from './sources.js';
