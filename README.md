# Extension ASR

Chrome 浏览器扩展：识别网页视频内容，优先读取原生字幕，无字幕时通过标签页音频流式转写，并支持字幕增量展示与时间轴对齐。

## 功能概览

| 阶段 | 能力 | 状态 |
|------|------|------|
| MVP | 标签页音频捕获 → 转写 → 侧边栏字幕、复制全文 | 可本地试跑（默认假识别） |
| P1 | 站点原生字幕适配（YouTube、课程站等） | 计划中；知学堂无字幕，走 ASR |
| P2 | 本地存储 / 导出（TXT、SRT、Markdown） | 计划中（已支持复制全文） |
| P3 | 云端同步 | 计划中 |
| P4 | 翻译、总结、AI 问答、关键词提取 | 计划中 |

## 架构要点

```
用户点击扩展图标
    │
    ├─► [优先] 站点字幕适配器 → 直接拉取 timedtext / API
    │
    └─► [兜底] chrome.tabCapture → Offscreen Document
              → AudioWorklet (16kHz 单声道 PCM + VAD)
              → WebSocket → 后端网关 → 流式 ASR
              → partial / final 字幕增量渲染 + 视频时间轴映射
```

- **音频捕获**：以 `chrome.tabCapture` 为主路径；`video.captureStream()` 仅作同域优化
- **MV3 约束**：Service Worker 不持有媒体流，音频管道在 Offscreen Document 中运行
- **安全**：插件不直连 ASR API，密钥与计量由后端网关托管
- **限制**：DRM (EME) 保护内容无法捕获，需在 UI 中明确提示

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

```
extension_asr/
├── extension/          # Chrome MV3 扩展
│   ├── manifest.json
│   ├── background/       # Service Worker：会话编排、消息路由
│   ├── offscreen/        # 音频捕获、重采样、VAD、WebSocket 客户端
│   ├── content/          # 页面注入：video 事件、字幕 DOM
│   ├── sidepanel/        # 侧边栏：增量字幕 UI
│   ├── popup/            # 工具栏弹窗：开始/停止
│   ├── adapters/         # 站点字幕适配器（插件化）
│   └── lib/              # 共享工具（时间轴映射、字幕模型）
├── backend/              # ASR 网关后端（鉴权、限流、WebSocket 代理）
├── docs/
└── .github/workflows/    # CI
```

## 快速开始

### 环境要求

- Chrome 116+（支持 Side Panel API）
- Node.js 20+（后端与构建脚本）

### 加载扩展（开发模式）

1. 克隆仓库：`git clone <repo-url> && cd extension_asr`
2. 打开 Chrome → `chrome://extensions` → 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `extension/` 目录
4. 先启动后端（见下），再打开带视频的网页（不要停在 chrome://extensions）
5. 在视频网页上点工具栏图标打开侧边栏，再点「开始转写」。点图标也会直接开始。

录标签页声音必须发生在你点按钮的那一下（工具栏图标或侧边栏「开始转写」都可以）。不要停在 `chrome://extensions` 这种 Chrome 内部页。

没有网站字幕时（例如知乎知学堂），会听标签页声音转成文字。默认是**假识别**（固定演示句子），用来确认通路。要听懂真实语音，需在 backend `.env` 里换成带密钥的识别接口。

### 后端（可选，流式 ASR 必需）

Windows：双击项目根目录的 `start.bat`。脚本会自动安装依赖、启动服务，并等到 `8787` 通了再提示你去点插件图标。窗口不要关。

或手动启动：

```bash
cd backend
cp .env.example .env   # 配置 ASR 服务商密钥
npm install
npm run dev
```

## 开发路线

1. **Milestone 1**：`tabCapture` → Offscreen → 流式转写 → 侧边栏 partial/final 字幕
2. **Milestone 2**：YouTube 等站点字幕适配器
3. **Milestone 3**：录音时间 ↔ 视频时间映射、seek/pause 对齐
4. **Milestone 4**：存储导出与云端同步
5. **Milestone 5**：翻译 / 总结 / AI 问答

## 贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
