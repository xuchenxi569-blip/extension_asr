# Extension ASR Backend

转写网关：接收扩展发来的音频，转成文字再传回去。

**语音识别（ASR）**是什么：把声音变成文字的服务。作用是替你听写。和麦克风、字幕相关。常见场景：会议纪要、课程笔记。

## 职责

- 接收音频小段（WebSocket）
- API Key 放在服务器，不写进浏览器插件
- 鉴权、限流、用量统计（后期）
- 识别服务可切换：默认 mock（假识别），可改为兼容 OpenAI 的真识别

## 快速开始

```bash
cp .env.example .env
npm install
npm run dev
```

默认监听 `ws://localhost:8787/ws/transcribe`。

打开 http://localhost:8787 应看到 `{"status":"ok","provider":"mock"}`。

## 假识别 vs 真识别

`.env` 里：

- `ASR_PROVIDER=mock`：不管你说什么，都返回写好的演示句子。用来确认「声音有没有传到后台、字幕有没有刷出来」。
- `ASR_PROVIDER=openai-compatible`：把每约 5 秒的声音发给兼容 Whisper 的接口，返回真实文字。

真识别需要密钥，例如：

```
ASR_PROVIDER=openai-compatible
ASR_API_KEY=你的密钥
ASR_BASE_URL=https://api.openai.com
ASR_MODEL=whisper-1
ASR_LANGUAGE=zh
```

国内可用硅基流动等兼容同一路径 `/v1/audio/transcriptions` 的服务，把 `ASR_BASE_URL` 和 `ASR_MODEL` 改成对方文档里的值。

## 协议（草案）

### 客户端 → 服务端

- 二进制帧：16kHz 单声道 Int16 PCM 块（约 0.8s）
- 文本帧（JSON）：`{ "type": "session.start", "sampleRate": 16000 }`

### 服务端 → 客户端

```json
{
  "type": "partial",
  "text": "正在识别的临时文本",
  "audioOffsetMs": 1200
}
```

```json
{
  "type": "final",
  "text": "定稿句子。",
  "audioOffsetMs": 2400,
  "confidence": 0.92
}
```
