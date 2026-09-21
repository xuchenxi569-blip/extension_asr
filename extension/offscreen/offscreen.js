/**
 * Offscreen Document：抓标签页声音、回放（避免静音）、切成 PCM 小段并发给转写服务
 */

import {
  pingAsr,
  sendPcmChunk,
  startAsrSession,
  stopAsrSession,
} from '../lib/loopback-fetch.js';

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 800;

let audioContext = null;
let mediaStream = null;
let workletNode = null;
let playbackAudio = null;
let captureTabId = null;
let chunkCount = 0;
let chunkWatchdog = null;
let asrHttp = null;
let pcmChain = Promise.resolve();
let stopped = false;

function notify(type, extra = {}) {
  chrome.runtime.sendMessage({
    target: 'background',
    ...extra,
    type,
  }).catch(() => {});
}

function emitAsrEvents(events) {
  for (const event of events || []) {
    if (event.type === 'error') {
      notify('ASR_ERROR', {
        error: 'ASR_PROVIDER',
        message: event.text || event.message || '识别服务报错',
      });
    } else {
      notify('TRANSCRIPT_EVENT', { event });
    }
  }
}

async function postPcm(buffer) {
  if (!asrHttp || stopped) return;
  const payload = buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer;
  const { ok, data } = await sendPcmChunk(asrHttp, payload);
  if (!ok && data?.error === 'NO_SESSION') {
    asrHttp = await startAsrSession(asrHttp.baseUrl, asrHttp.model);
    return postPcm(payload);
  }
  if (!ok) {
    throw new Error(data?.error || '发送音频失败');
  }
  emitAsrEvents(data?.events);
}

async function startCapture(streamId, tabId, asrBaseUrl, asrModel) {
  captureTabId = tabId;
  chunkCount = 0;
  pcmChain = Promise.resolve();
  stopped = false;

  const reachable = await pingAsr(asrBaseUrl);
  if (!reachable) {
    throw new Error('本机转写服务没开着。请双击项目里的 start.bat，看到「服务已开好」后再点「开始转写」。');
  }
  asrHttp = await startAsrSession(reachable, asrModel);

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  mediaStream.getAudioTracks().forEach((track) => {
    track.enabled = true;
  });

  // 标签页捕获会让原页面静音。用 Audio 元素把声音播出来。
  playbackAudio = new Audio();
  playbackAudio.srcObject = mediaStream;
  playbackAudio.autoplay = true;
  playbackAudio.muted = false;
  playbackAudio.volume = 1;
  await playbackAudio.play().catch(() => {});

  audioContext = new AudioContext();
  await audioContext.resume().catch(() => {});
  await audioContext.audioWorklet.addModule(
    chrome.runtime.getURL('offscreen/pcm-processor.js')
  );

  const source = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, 'pcm-processor', {
    processorOptions: {
      targetSampleRate: TARGET_SAMPLE_RATE,
      chunkDurationMs: CHUNK_DURATION_MS,
    },
  });

  workletNode.port.onmessage = (event) => {
    if (event.data.type !== 'pcm-chunk') return;
    chunkCount += 1;
    if (chunkCount === 1) {
      notify('CAPTURE_HINT', {
        message: '已经听到声音，文字会在几秒内出现。当前默认是演示句子。',
      });
    }
    pcmChain = pcmChain
      .then(() => postPcm(event.data.buffer))
      .catch((err) => {
        notify('ASR_ERROR', { message: err?.message || '发送音频失败' });
      });
  };

  const mute = audioContext.createGain();
  mute.gain.value = 0;
  source.connect(workletNode);
  workletNode.connect(mute);
  mute.connect(audioContext.destination);

  clearTimeout(chunkWatchdog);
  chunkWatchdog = setTimeout(() => {
    if (chunkCount === 0) {
      notify('ASR_ERROR', {
        message: '已经开始转写，但还没收到声音。请确认视频正在播放，然后停止后再点一次插件图标。',
      });
    }
  }, 3000);
}

/** 立刻切断声音。不等云端，所以点「停止」马上生效。 */
function stopAudio() {
  stopped = true;
  clearTimeout(chunkWatchdog);
  chunkWatchdog = null;
  workletNode?.disconnect();
  if (workletNode) workletNode.port.onmessage = null;
  mediaStream?.getTracks().forEach((t) => t.stop());
  if (playbackAudio) {
    playbackAudio.pause();
    playbackAudio.srcObject = null;
  }
  audioContext?.close().catch(() => {});

  workletNode = null;
  mediaStream = null;
  audioContext = null;
  playbackAudio = null;
  captureTabId = null;
}

/** 收尾：让云端认完最后一段，可能要几十秒，在后台跑。 */
async function finishSession() {
  const session = asrHttp;
  asrHttp = null;
  if (!session) return;
  try {
    const events = await stopAsrSession(session);
    emitAsrEvents(events);
  } catch { /* 收尾失败就算了，声音已经停了 */ }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  if (message.type === 'START_CAPTURE') {
    startCapture(message.streamId, message.tabId, message.asrBaseUrl, message.asrModel)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({
        ok: false,
        error: 'CAPTURE_FAILED',
        message: err?.message || String(err),
      }));
    return true;
  }

  if (message.type === 'STOP_CAPTURE') {
    // 先停声音并立刻回话，收尾放到后台，结束后再通知可以关闭本文档。
    stopAudio();
    sendResponse({ ok: true });
    finishSession().finally(() => notify('CAPTURE_FLUSHED'));
    return false;
  }

  if (message.type === 'ASR_WARMUP') {
    pingAsr(message.url).then((origin) => sendResponse({ ok: Boolean(origin) })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
