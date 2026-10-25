# B 站登录（Cookie）

> 目标：登录一次，之后直接用 Cookie 调 B 站接口。不走密码登录，不在聊天里反复扫码。

## 结论

- B 站 Web API 用三个 Cookie：`SESSDATA`、`bili_jct`、`buvid3`（有些写操作还需要 `DedeUserID`）。
- `SESSDATA` 是 HttpOnly，`document.cookie` 读不到；只能从浏览器 DevTools 或登录响应的 `Set-Cookie` 里拿。
- Cookie 等于账号密码，只放本机 `state/bili-credentials.json`，不进 git、不进日记、不进日志。

## 方式一：从已登录浏览器导出（推荐，一次就够）

1. 浏览器登录 `https://www.bilibili.com`
2. F12 → Application → Cookies → `https://www.bilibili.com`
3. 复制 `SESSDATA`、`bili_jct`、`buvid3`
4. 写进项目目录下的 `bili-cookie.txt`（或直接给 `tools/bili-login.mjs` 的导入逻辑）
5. 校验：

```bash
node tools/bili-login.mjs --status
```

> Cookie 一般能顶几个月；过期/退出登录后再导一次即可，不需要每次登录都扫。

## 方式二：扫码登录（异步聊天里不推荐）

`node tools/bili-login.mjs` 会生成 `state/bili-login.png`，轮询 passport 接口直到扫码成功。
二维码约 3 分钟过期，聊天消息一来一回很容易错过；只适合你人就在电脑前、能立刻扫的场景。

## 方式三：从 Edge Cookie 库解密（需要先关浏览器）

Edge 运行时 `Cookies` SQLite 文件被锁住，读不了。关掉 Edge 后可以复制并用 Windows 当前用户密钥解密；
不做成默认流程，因为要短暂关闭浏览器。

## 文件

| 文件 | 作用 |
|---|---|
| `state/bili-credentials.json` | 登录凭据（`sessdata` / `bili_jct` / `buvid3` / `mid` / `name` / `savedAt`），0600 |
| `tools/bili-login.mjs` | 扫码登录 CLI / `--status` 检查 |
| `tools/lib/bili-login.mjs` | passport 接口、轮询、保存/读取凭据 |
| `tools/lib/qr-png.mjs` | 二维码 → PNG（本地渲染，零第三方依赖） |
| `vendor/qrcode.cjs` | qrcode-generator 1.4.4（MIT，Kazuhiko Arase） |

## 安全

- 凭据文件只写本机；日志只打印字段名/长度，不打印值。
- 不要提交 `state/`、`config.json`、`bili-credentials.json`。
- Cookie 在聊天里出现过一次就当作已暴露：介意的话退出 B 站登录/改密码后重新导一次。
