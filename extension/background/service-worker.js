/**
 * MV3 Service Worker：会话编排与消息路由
 *
 * 申请录标签页声音必须在「用户点击」的同一拍完成，中间不能 await。
 * 工具栏图标和侧边栏「开始转写」都会先同步拿到 streamId，再交给这里启动。
 */

import { captureBlockedMessage, explainCaptureError, isCapturableUrl } from '../lib/capture-tab.js';
import { pingAsr, trimBase } from '../lib/loopback-fetch.js';

const OFFSCREEN_URL = 'offscreen/offscreen.html';
const SESSION_STATE = {
  idle: 'idle',
  capturing: 'capturing',
  transcribing: 'transcribing',
  stopped: 'stopped',
};

let session = {
  state: SESSION_STATE.idle,
  tabId: null,
  streamId: null,
};

async function saveSession() {
  await chrome.storage.session.set({ session });
}

async function restoreSession() {
  const data = await chrome.storage.session.get('session');
  if (data.session) session = data.session;
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: '捕获标签页音频、回放以免静音，并发送给转写服务',
  });
}

async function closeOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existing.length === 0) return;
  await chrome.offscreen.closeDocument();
}

async function hasOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return existing.length > 0;
}

function forwardToUi(message) {
  if (message.type !== 'TRANSCRIPT_EVENT') {
    chrome.storage.session.set({ uiNotice: message }).catch(() => {});
  }
  chrome.runtime.sendMessage({ ...message, target: 'ui' }).catch(() => {});
}

async function pingTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    return null;
  }
}

const DEFAULT_ASR_URL = 'http://127.0.0.1:8787';

function toHttpBase(rawUrl) {
  const fallback = DEFAULT_ASR_URL;
  try {
    const normalized = String(rawUrl || fallback)
      .replace(/^wss:/, 'https:')
      .replace(/^ws:/, 'http:');
    const u = new URL(normalized);
    return `${u.protocol}//${u.host}`;
  } catch {
    return fallback;
  }
}

async function getAsrBaseUrl() {
  const data = await chrome.storage.local.get('wsUrl');
  let migrated = toHttpBase(data.wsUrl || DEFAULT_ASR_URL);
  try {
    const host = new URL(migrated).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      migrated = DEFAULT_ASR_URL;
    }
  } catch {
    migrated = DEFAULT_ASR_URL;
  }
  if (data.wsUrl !== migrated) {
    await chrome.storage.local.set({ wsUrl: migrated });
  }
  return migrated;
}

async function warmupAsr(baseUrl) {
  for (let i = 0; i < 12; i += 1) {
    try {
      const ui = await chrome.runtime.sendMessage({ type: 'ASR_WARMUP', url: baseUrl });
      if (ui?.ok) return true;
    } catch { /* 侧边栏还没起来 */ }
    try {
      const off = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'ASR_WARMUP',
        url: baseUrl,
      });
      if (off?.ok) return true;
    } catch { /* offscreen 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return pingAsr(baseUrl);
}

async function resetSession(state = SESSION_STATE.idle) {
  session = { state, tabId: null, streamId: null };
  await saveSession();
}

async function startCaptureWithStream(tabId, streamId, httpReady) {
  clearTimeout(closeAfterFlush);
  await restoreSession();
  const offscreenAlive = await hasOffscreenDocument();
  if (!offscreenAlive && (session.state === SESSION_STATE.transcribing || session.state === SESSION_STATE.capturing)) {
    await resetSession(SESSION_STATE.idle);
  }

  if (session.state === SESSION_STATE.transcribing || session.state === SESSION_STATE.capturing) {
    await stopCapture({ silent: true });
  }

  let asrBaseUrl = DEFAULT_ASR_URL;
  try {
    const ready = await httpReady;
    if (ready instanceof Error) throw ready;
    asrBaseUrl = trimBase(ready || await getAsrBaseUrl());
  } catch (err) {
    return {
      ok: false,
      error: 'ASR_UNREACHABLE',
      message: err?.message || String(err),
    };
  }

  await ensureOffscreenDocument();

  session = { state: SESSION_STATE.capturing, tabId, streamId };
  await saveSession();

  const { asrModel = '' } = await chrome.storage.local.get('asrModel');

  const result = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'START_CAPTURE',
    streamId,
    tabId,
    asrBaseUrl,
    asrModel,
  });

  if (!result?.ok) {
    await resetSession(SESSION_STATE.stopped);
    await closeOffscreenDocument();
    return {
      ok: false,
      error: result?.error || 'CAPTURE_FAILED',
      message: result?.message || '启动转写失败',
    };
  }

  session.state = SESSION_STATE.transcribing;
  await saveSession();
  await chrome.action.setBadgeText({ text: '' });
  // 这次启动成功了，把上次失败留下的提示丢掉，免得面板重开时又弹出来。
  await chrome.storage.session.remove('uiNotice').catch(() => {});
  await pingTab(tabId, { type: 'SYNC_VIDEO_CLOCK' });
  forwardToUi({ type: 'CAPTURE_STARTED', tabId });
  return { ok: true, streamId };
}

let closeAfterFlush = null;

/** 收尾结束（或超时）后再关掉 offscreen，否则最后一段字会丢。 */
function scheduleOffscreenClose() {
  clearTimeout(closeAfterFlush);
  closeAfterFlush = setTimeout(() => {
    closeOffscreenDocument().catch(() => {});
  }, 95000);
}

async function stopCapture({ silent = false } = {}) {
  await restoreSession();
  const tabId = session.tabId;

  // 只等「声音已切断」，不等云端收尾，所以点「停止」立刻有反应。
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' });
  } catch { /* offscreen 可能已关闭 */ }

  await resetSession(SESSION_STATE.stopped);
  await chrome.action.setBadgeText({ text: '' });
  if (!silent) forwardToUi({ type: 'CAPTURE_STOPPED' });

  if (tabId) pingTab(tabId, { type: 'STOP_VIDEO_CLOCK' });
  scheduleOffscreenClose();
  return { ok: true };
}

/**
 * 把一切推回干净状态：切断录音、立刻关掉 offscreen、清空会话和残留提示。
 * 用来从「上一次没释放干净」这种卡死里恢复，会丢掉最后一句字，这是刻意的取舍。
 */
async function forceReset() {
  clearTimeout(closeAfterFlush);
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_CAPTURE' });
  } catch { /* offscreen 可能已关闭 */ }
  await closeOffscreenDocument().catch(() => {});
  await resetSession(SESSION_STATE.idle);
  await chrome.storage.session.remove('uiNotice').catch(() => {});
  await chrome.action.setBadgeText({ text: '' });
  return { ok: true };
}

function prepareHttp() {
  return getAsrBaseUrl().then(async (url) => {
    const origin = await pingAsr(url);
    if (!origin) {
      throw new Error('本机转写服务没开着。请双击项目里的 start.bat，看到 8787 后再点「开始转写」。');
    }
    await warmupAsr(origin);
    return origin;
  }).catch((err) => err);
}

function beginCapture(tabId, streamId) {
  startCaptureWithStream(tabId, streamId, prepareHttp()).then((result) => {
    if (!result.ok) {
      forwardToUi({ type: 'ASR_ERROR', message: result.message });
    }
  });
}

function isAlreadyCapturingError(raw) {
  const text = String(raw || '');
  return text.includes('active stream') || text.includes('already');
}

function requestStreamAndStart(tab) {
  // 图标点在 Chrome 自己的页面上时，不报错：面板已经打开，
  // 用户可以在面板里直接选一个能录的标签页。
  if (!tab?.id || !isCapturableUrl(tab.url)) {
    forwardToUi({
      type: 'CAPTURE_HINT',
      message: '这个页面不能录音。在下面「录哪个标签页」里选一个视频网页，然后点「开始转写」。',
    });
    return;
  }

  if (session.state === SESSION_STATE.transcribing || session.state === SESSION_STATE.capturing) {
    return;
  }

  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
    const err = chrome.runtime.lastError;
    if (err) {
      if (isAlreadyCapturingError(err.message)) return;
      forwardToUi({
        type: 'ASR_ERROR',
        message: explainCaptureError(err.message, tab),
      });
      return;
    }
    beginCapture(tab.id, streamId);
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  requestStreamAndStart(tab);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});

restoreSession();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  if (type === 'GET_SESSION') {
    restoreSession().then(() => sendResponse({ session }));
    return true;
  }

  if (type === 'START_WITH_STREAM') {
    const { tabId, streamId } = message;
    if (!tabId || !streamId) {
      sendResponse({ ok: false, message: '没有拿到要录的标签页。请先打开视频网页，再点「开始转写」。' });
      return false;
    }
    startCaptureWithStream(tabId, streamId, prepareHttp()).then(sendResponse);
    return true;
  }

  if (type === 'STOP_TRANSCRIPTION') {
    stopCapture().then(sendResponse);
    return true;
  }

  if (type === 'FORCE_RESET') {
    forceReset().then(sendResponse);
    return true;
  }

  if (type === 'CAPTURE_FLUSHED') {
    clearTimeout(closeAfterFlush);
    restoreSession().then(() => {
      if (session.state !== SESSION_STATE.transcribing && session.state !== SESSION_STATE.capturing) {
        closeOffscreenDocument().catch(() => {});
      }
    });
    return false;
  }

  if (type === 'TRANSCRIPT_EVENT' || type === 'partial' || type === 'final' || type === 'ASR_ERROR' || type === 'CAPTURE_STATUS' || type === 'CAPTURE_HINT') {
    if (message.target === 'background' || !message.target) {
      const payload = (type === 'partial' || type === 'final')
        ? { type: 'TRANSCRIPT_EVENT', event: { type, text: message.text, audioOffsetMs: message.audioOffsetMs } }
        : message;
      forwardToUi(payload);
    }
    return false;
  }

  if (type === 'VIDEO_TIME_EVENT') {
    forwardToUi(message);
    return false;
  }

  if (type === 'TRY_NATIVE_SUBTITLES') {
    chrome.tabs.sendMessage(message.tabId, { type: 'FETCH_NATIVE_SUBTITLES' })
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, subtitles: null, reason: 'NO_CONTENT_SCRIPT' }));
    return true;
  }

  return false;
});

export { SESSION_STATE };
