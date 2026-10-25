// 兼容壳：安全抓取已抽到 packages/safe-fetch/src/index.js。
//
// 保留这个路径，是为了让旧的 scripts/ 与外部调用方不必立刻全改；
// 新代码请直接 import '@whale/safe-fetch'（或在仓库内用相对路径）。
export * from '../packages/safe-fetch/src/index.js';
