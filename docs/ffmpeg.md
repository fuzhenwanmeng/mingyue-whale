# FFmpeg（抽帧用）

## 安装位置

- 本项目不附带 FFmpeg，按你的系统安装到任意目录；
- 可执行文件：`ffmpeg`、`ffprobe`（Windows 下为 `.exe`）；
- 建议把 FFmpeg 的 `bin` 目录加入用户 PATH，或设置环境变量 `FFMPEG`。

> 当前已经运行的 DSH / 桥接进程不会自动刷新 PATH；B 站模块解析 ffmpeg 时按下面顺序：
> 1. 环境变量 `FFMPEG`
> 2. 配置里的 `bili.ffmpegPath`
> 3. 系统 PATH 里的 `ffmpeg`
> 4. 不装也能跑：字幕、弹幕、热评、简介都是纯文字路径

## 验证

```powershell
ffmpeg -version
ffprobe -version
```

## 用途

- 视频抽帧给多模态模型看画面
- 读视频时长/分辨率/编码信息
