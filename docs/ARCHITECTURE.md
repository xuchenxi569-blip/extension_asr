# 架构设计

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| 字幕优先 | 有原生字幕则直接读取，零成本、最高准确率 |
| tabCapture 为主 | 通用捕获路径；`captureStream()` 仅同域 video 优化 |
| 后端网关 | API Key 不落地客户端；统一鉴权、计量、限流 |
| 增量字幕 | 区分 partial（临时）与 final（定稿），避免 UI 跳变 |
| 时间轴对齐 | 维护录音时间 ↔ 视频播放时间的映射表 |

## 2. 模块职责

### 2.1 Background (Service Worker)

- 响应用户点击扩展图标（`action.onClicked`）
- 创建/关闭 Offscreen Document
- 调用 `chrome.tabCapture.getMediaStreamId` 获取流 ID
- 编排会话状态：`idle` → `capturing` → `transcribing` → `stopped`
- 在 Content Script、Offscreen、Side Panel 之间转发消息

### 2.2 Offscreen Document

MV3 下 Service Worker 无法持有 `MediaStream`，音频管道必须在此运行：

```
tabCapture MediaStream
    → MediaStreamSource
    → AudioWorkletNode (pcm-processor)
        ├── 重采样至 16kHz 单声道
        ├── VAD 静音检测（可选，减少 ASR 费用）
        └── 0.5–1s PCM 块输出
    → WebSocket → 后端网关
    → 音频回放至 destination（避免标签页静音）
```

### 2.3 Content Script

- 探测页面 `<video>` 元素
- 监听 `play` / `pause` / `seeked` / `ratechange`
- 向 Background 上报视频时间戳，用于时间轴映射
- 调用站点字幕适配器（若匹配）

### 2.4 Side Panel

- 展示 partial（灰色）与 final（黑色）字幕流
- 点击字幕行 seek 到对应视频时间（依赖时间轴映射）
- 导出、设置入口（后续里程碑）

### 2.5 站点字幕适配器 (`adapters/`)

插件化设计，每个站点一个适配模块：

```js
// 接口约定
{
  id: 'youtube',
  match: (url) => boolean,
  fetchSubtitles: async (ctx) => SubtitleSegment[],
}
```

- YouTube：`timedtext` / 播放器内部 track（需持续维护）
- 课程站：各站 API 或 DOM 解析
- 失败时返回 `null`，自动降级 ASR

### 2.6 后端网关 (`backend/`)

```
WebSocket /ws/transcribe
    ├── 鉴权（JWT / API Key）
    ├── 限流与用量统计
    ├── 音频流转发至 ASR 服务商
    └── 将 partial/final 结果回传客户端
```

推荐 ASR：火山引擎、讯飞、阿里云、Deepgram 等原生流式接口。  
自托管 Whisper Streaming 可作为成本优化选项，需单独评估延迟与幻觉。

## 3. 字幕与时间轴

### 3.1 消息模型

```ts
interface TranscriptEvent {
  type: 'partial' | 'final';
  text: string;
  audioOffsetMs: number;   // 相对录音开始
  confidence?: number;
}
```

### 3.2 时间轴映射

Content Script 持续上报：

```ts
{ videoTimeMs, wallClockMs, event: 'play'|'pause'|'seeked' }
```

Side Panel / `lib/timeline-mapper.js` 将 `audioOffsetMs` 转换为 `videoTimeMs`，支持：

- 用户暂停后继续
- 拖动进度条后重新对齐
- 点击字幕跳转视频

## 4. 音频参数

| 参数 | 值 |
|------|-----|
| 采样率（ASR 输入） | 16000 Hz |
| 声道 | 单声道 |
| 位深 | 16-bit PCM |
| 块大小 | 500–1000 ms |
| 编码（传输） | 二进制 WebSocket 或 base64 |

## 5. 安全与合规

- `manifest.json` 权限最小化，敏感权限附用途说明（Chrome Web Store）
- 隐私政策：说明音频是否上传云端、保留时长
- 国内用户：注意数据出境，优先国内 ASR 节点
- DRM 内容：明确不可捕获，UI 提示而非静默失败

## 6. 后续扩展（P4）

在 **final** 字幕段落上异步调用 LLM：

- 翻译：按段落增量
- 总结：滑动窗口或章节边界触发
- 问答：RAG over 当前会话 transcript
- 关键词：NER 或 LLM 提取

与实时转写管道解耦，避免阻塞主链路。

## 7. 已知限制

- Netflix、腾讯视频会员 DRM 等 EME 内容无法捕获
- YouTube 字幕接口可能变更，适配器需持续维护
- 流式 ASR 通常有 1–3 秒延迟，不适合作为零延迟直播字幕
