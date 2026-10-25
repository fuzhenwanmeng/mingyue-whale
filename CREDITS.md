# Credits / 借鉴与依赖

这个项目不是从零发明所有轮子。下面这些项目、插件和素材提供了基础或参考；保留它们的版权与许可证。

## 核心依赖 / 基础

- **qq-bridge**  
  上游：https://github.com/Derpyu520/qq-bridge  
  License: MIT，Copyright (c) 2026 Derpyu520 and qq-bridge / QSH contributors。  
  本仓库是个人化整合版，不是上游官方发布。

- **DeepSeek Harness（DSH）**  
  Agent、会话、工具链与 preset 机制的基础。  
  本仓库不包含 DSH 本体。

- **SnowLuma**  
  QQ 协议端，Licensor: SnowLumaDevs；使用受其 EULA 约束。  
  本仓库不包含 SnowLuma 二进制、账号凭据或 Cookie。

## 插件 / 工具 / 参考

- **qq-agent-presets**  
  属于 qq-bridge 生态，MIT；本仓库保留其 preset bundle 结构。

- **dsh-bili-pod / dsh-bili-whale**  
  B站 CLI 与工具层，MIT。  
  上游：https://github.com/Alterssss/dsh-bili-whale  
  版权：Copyright (c) 2026 ALTERSSSS；fork 维护：nullifyi。  
  本仓库不打包其完整插件，只通过文档/接口引用。

- **qrcode-generator**  
  MIT，Copyright (c) Kazuhiko Arase；`vendor/qrcode.cjs` 为 vendored 代码，许可证见 `vendor/qrcode-generator.LICENSE.txt`。

- **Tesseract `chi_sim.traineddata`**  
  OCR 语言数据，Apache License 2.0；来源为 Tesseract tessdata。  
  仅用于本地 OCR，不包含训练代码。

- **Bilibili API / bilibili-API-collect**  
  B站接口行为参考社区文档；接口调用仍需遵守 B站用户协议与风控。

## 素材

- `assets/deepseek娘.png`：DeepSeek 娘形象素材，来源为社区/网络，原作者信息未能完整确认。  
  仅作示例形象；如原作者或权利方不希望被使用，请提出，我们会替换或移除。  
  想换成自己的鲸鱼娘，直接替换这个文件即可。

## 本项目新增部分

- 事件日志、记忆检索、注意力调度、主动性灰度、权限边界、设计文档等新增代码与文字；
- 除特别注明外，沿用上游 MIT License；
- 不包含任何私人聊天记录、账号、Cookie、token、真实人格卡或 growth 档案。

## 说明

如果你发现遗漏了应署名的项目/作者，请开 issue 或联系维护者；我们会补上，不冒用别人的创意。

## 项目署名

- **浮枕**：理念、方向、养鱼人
- **溟月**：实现、文档、测试、踩坑；以及被养的那条鱼

一起踩坑，一起完善。
