import { applyTranscriptEvent, formatTime, markdownFilename, toMarkdown, toPlainText } from '../lib/subtitle-model.js';
import { TimelineMapper } from '../lib/timeline-mapper.js';
import { captureBlockedMessage, explainCaptureError, isCapturableUrl } from '../lib/capture-tab.js';
import { fetchAsrModels, pingAsr } from '../lib/loopback-fetch.js';

const DEFAULT_WS = 'http://127.0.0.1:8787';

const statusEl = document.getElementById('status');
const listEl = document.getElementById('subtitle-list');
const hintEl = document.getElementById('hint');
const targetEl = document.getElementById('target-tab');
const targetSelect = document.getElementById('target-select');
const modelSelect = document.getElementById('model-select');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnRestart = document.getElementById('btn-restart');
const btnCopy = document.getElementById('btn-copy');
const btnExportMd = document.getElementById('btn-export-md');
const wsInput = document.getElementById('ws-url');

const timeline = new TimelineMapper();
/** @type {import('../lib/subtitle-model.js').SubtitleLine[]} */
let lines = [];
let running = false;
let cachedTab = null;
/** @type {chrome.tabs.Tab[]} */
let capturableTabs = [];
/** 用户在下拉框里手动选的标签页；'auto' 表示自动挑。 */
let pinnedTabId = 'auto';

function setStatus(text, variant = 'idle') {
  statusEl.textContent = text;
  statusEl.className = `status status--${variant}`;
}

function setRunning(value) {
  running = value;
  btnStart.disabled = value;
  btnStop.disabled = !value;
  targetSelect.disabled = value;
  modelSelect.disabled = value;
  if (!value) scheduleRefresh();
}

/**
 * 模型清单由本机服务提供（只放实测能出字的）。
 * 换模型要在下次「开始转写」时才生效，所以这里只存不动当前会话。
 */
async function loadModels(baseUrl) {
  const [{ models, current }, stored] = await Promise.all([
    fetchAsrModels(baseUrl),
    chrome.storage.local.get('asrModel'),
  ]);

  const followLabel = current ? `跟随服务端设置（${current}）` : '跟随服务端设置';
  const options = [`<option value="">${escapeHtml(followLabel)}</option>`];
  for (const model of models) {
    options.push(`<option value="${escapeHtml(model.id)}">${escapeHtml(model.label || model.id)}</option>`);
  }
  modelSelect.innerHTML = options.join('');

  const saved = stored.asrModel || '';
  modelSelect.value = models.some((m) => m.id === saved) ? saved : '';
  if (modelSelect.value !== saved) {
    await chrome.storage.local.set({ asrModel: modelSelect.value });
  }
}

function render() {
  const isEmpty = toPlainText(lines).length === 0;
  btnCopy.disabled = isEmpty;
  btnExportMd.disabled = isEmpty;

  if (lines.length === 0) {
    listEl.innerHTML = '<p class="subtitle-empty">暂无字幕。打开视频网页后，点「开始转写」。</p>';
    return;
  }

  listEl.innerHTML = lines.map((line) => `
    <article class="subtitle-line" data-time="${line.videoTimeMs ?? ''}">
      <div class="subtitle-line__time">${formatTime(line.videoTimeMs)}</div>
      <div class="subtitle-line__text subtitle-line__text--${line.status}">${escapeHtml(line.text)}</div>
    </article>
  `).join('');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tabLabel(tab) {
  const name = tab.title || tab.url || `标签 ${tab.id}`;
  return tab.audible ? `🔊 ${name}` : name;
}

/**
 * 列出所有能录的标签页，并按「最可能是你想录的」排序：
 * 正在出声的 → 当前选中的 → 最近看过的。
 */
async function listCapturableTabs() {
  const all = await chrome.tabs.query({}).catch(() => []);
  const usable = all.filter((tab) => tab.id != null && isCapturableUrl(tab.url));
  const focusedWindowId = usable.find((tab) => tab.active)?.windowId;

  return usable.sort((a, b) => {
    if (Boolean(b.audible) !== Boolean(a.audible)) return b.audible ? 1 : -1;
    if (b.active !== a.active) return b.active ? 1 : -1;
    const aHere = a.windowId === focusedWindowId ? 1 : 0;
    const bHere = b.windowId === focusedWindowId ? 1 : 0;
    if (aHere !== bHere) return bHere - aHere;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
}

/** 当前选中的标签页；可能是 Chrome 自己的页面。 */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function refreshTarget() {
  capturableTabs = await listCapturableTabs();

  if (pinnedTabId !== 'auto' && !capturableTabs.some((tab) => tab.id === pinnedTabId)) {
    pinnedTabId = 'auto';
  }

  cachedTab = pinnedTabId === 'auto'
    ? capturableTabs[0] || null
    : capturableTabs.find((tab) => tab.id === pinnedTabId) || null;

  renderTargetOptions();
  showTarget(cachedTab);
  return cachedTab;
}

function renderTargetOptions() {
  if (running) return;
  const options = ['<option value="auto">自动（正在播声音的网页）</option>'];
  for (const tab of capturableTabs.slice(0, 20)) {
    options.push(`<option value="${tab.id}">${escapeHtml(tabLabel(tab).slice(0, 70))}</option>`);
  }
  targetSelect.innerHTML = options.join('');
  targetSelect.value = String(pinnedTabId);
}

function showTarget(tab) {
  if (!tab) {
    targetEl.textContent = '没找到能录的网页。请在浏览器里打开一个视频网页（http 或 https），再点「开始转写」。';
    return;
  }
  targetEl.textContent = `将录制：${tabLabel(tab)}`;
}

function applyNativeSubtitles(res) {
  lines = (res.subtitles || []).map((seg, i) => ({
    id: `native-${i}`,
    text: seg.text,
    status: 'final',
    videoTimeMs: seg.startMs,
    audioOffsetMs: seg.startMs,
  }));
  setStatus(`网站字幕（${res.adapterId}）`, 'active');
  hintEl.textContent = '这是网站自己的字幕，打开就能看完全文。点击一行可跳到对应时间。';
  render();
}

function applyNotice(message) {
  if (!message) return;

  if (message.type === 'CAPTURE_STARTED') {
    lines = [];
    timeline.markRecordingStart();
    setRunning(true);
    setStatus('转写中…', 'active');
    hintEl.textContent = '正在听这个标签页的声音。播放到哪，字就出到哪。点「停止」结束。';
    render();
  }

  if (message.type === 'CAPTURE_STOPPED') {
    setRunning(false);
    setStatus('已停止', 'idle');
  }

  if (message.type === 'NATIVE_SUBTITLES') {
    applyNativeSubtitles(message);
  }

  if (message.type === 'CAPTURE_HINT' && message.message) {
    hintEl.textContent = message.message;
  }

  if (message.type === 'ASR_ERROR') {
    setRunning(false);
    setStatus(message.message || message.error || '识别出错', 'error');
  }

  if (message.type === 'TRANSCRIPT_EVENT' || message.type === 'partial' || message.type === 'final') {
    const event = message.event && typeof message.event === 'object'
      ? message.event
      : message;
    const kind = event.type === 'partial' || event.type === 'final' ? event.type : 'final';
    if (!event.text) return;

    // 有字出来说明链路是通的，清掉可能已经过期的报错。
    // 注意：这里绝不能改 running。停止后收尾的最后一句也会走到这儿，
    // 一旦在这里置为「正在转写」，「开始转写」就会被永久按灰。
    if (statusEl.classList.contains('status--error')) {
      chrome.storage.session.remove('uiNotice').catch(() => {});
      setStatus(running ? '转写中…' : '已停止', running ? 'active' : 'idle');
    }

    lines = applyTranscriptEvent(
      lines,
      {
        type: kind,
        text: event.text,
        audioOffsetMs: event.audioOffsetMs,
      },
      (ms) => timeline.audioToVideoTime(ms)
    );
    render();
  }

  if (message.type === 'VIDEO_TIME_EVENT') {
    timeline.record(message);
  }
}

async function loadWsUrl() {
  const data = await chrome.storage.local.get('wsUrl');
  let url = data.wsUrl || DEFAULT_WS;
  url = url
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/ws\/transcribe.*$/, '');
  if (url.includes('localhost')) url = url.replace('localhost', '127.0.0.1');
  try {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      url = DEFAULT_WS;
    }
  } catch {
    url = DEFAULT_WS;
  }
  if (url !== data.wsUrl) {
    await chrome.storage.local.set({ wsUrl: url });
  }
  wsInput.value = url;
}

wsInput.addEventListener('change', () => {
  chrome.storage.local.set({ wsUrl: wsInput.value.trim() || DEFAULT_WS });
});

/** 上一次的录音还没释放时，Chrome 会拒发新的录音许可。 */
function isBusyError(raw) {
  return /active stream|already/i.test(String(raw || ''));
}

function sendStart(tab, streamId) {
  chrome.runtime.sendMessage({
    type: 'START_WITH_STREAM',
    tabId: tab.id,
    streamId,
  }).then((res) => {
    if (res && !res.ok) {
      setRunning(false);
      setStatus(res.message || '启动失败', 'error');
    }
  }).catch((e) => {
    setRunning(false);
    setStatus(e?.message || '启动失败', 'error');
  });
}

/** 彻底清理后再要一次录音许可。清理完还不行就让用户再点一下。 */
async function recoverAndRetry(tab) {
  setStatus('上一次的录音还没释放，正在清理…', 'active');
  await chrome.runtime.sendMessage({ type: 'FORCE_RESET' }).catch(() => {});
  await new Promise((done) => setTimeout(done, 400));

  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
    if (chrome.runtime.lastError) {
      setRunning(false);
      setStatus('已清理干净。请再点一次「重新转写」。', 'idle');
      return;
    }
    sendStart(tab, streamId);
  });
}

/**
 * 申请录音必须和这次点击在同一拍完成，中间不能 await，
 * 所以「录哪个标签页」是提前算好的（cachedTab）。
 */
function requestStart(label) {
  const tab = cachedTab;
  if (!tab?.id) {
    setStatus('没找到能录的网页。请先打开一个视频网页，再点「开始转写」。', 'error');
    refreshTarget();
    return;
  }
  if (!isCapturableUrl(tab.url)) {
    setStatus(captureBlockedMessage(tab.url), 'error');
    refreshTarget();
    return;
  }

  setStatus(label, 'active');
  chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
    const err = chrome.runtime.lastError;
    if (err) {
      if (isBusyError(err.message)) {
        recoverAndRetry(tab);
        return;
      }
      setRunning(false);
      setStatus(explainCaptureError(err.message, tab), 'error');
      refreshTarget();
      return;
    }
    sendStart(tab, streamId);
  });
}

btnStart.addEventListener('click', () => requestStart('正在开始…'));

// 「重新转写」永远可点，专门用来从卡住的状态里恢复。
btnRestart.addEventListener('click', () => requestStart('正在重新开始…'));

btnStop.addEventListener('click', () => {
  // 先改界面再发消息：不等后台，点了就有反应。
  setRunning(false);
  setStatus('已停止', 'idle');
  hintEl.textContent = '已停止。最后一句可能还要几秒才出来。要再转写，点「开始转写」即可。';
  chrome.runtime.sendMessage({ type: 'STOP_TRANSCRIPTION' }).catch(() => {});
});

btnCopy.addEventListener('click', async () => {
  const text = toPlainText(lines);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('已复制全文', running ? 'active' : 'idle');
  } catch {
    setStatus('复制失败', 'error');
  }
});

/** 下载完成（或失败/取消）后才能回收 blob 地址，否则文件会写不全。 */
function revokeWhenDone(downloadId, href) {
  const onChanged = (delta) => {
    if (delta.id !== downloadId || !delta.state) return;
    if (delta.state.current === 'in_progress') return;
    chrome.downloads.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(href);
  };
  chrome.downloads.onChanged.addListener(onChanged);
  // 兜底：万一没收到完成事件，5 分钟后也要回收。
  setTimeout(() => {
    chrome.downloads.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(href);
  }, 300000);
}

btnExportMd.addEventListener('click', async () => {
  const text = toPlainText(lines);
  if (!text) return;

  const markdown = toMarkdown(lines, {
    title: cachedTab?.title || '转写笔记',
    url: cachedTab?.url || '',
  });
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const href = URL.createObjectURL(blob);

  try {
    // saveAs: true 会弹出系统的「另存为」窗口，由你选目录和文件名。
    const downloadId = await chrome.downloads.download({
      url: href,
      filename: markdownFilename(cachedTab?.title),
      saveAs: true,
    });
    revokeWhenDone(downloadId, href);
    setStatus('已保存 Markdown', running ? 'active' : 'idle');
  } catch (err) {
    URL.revokeObjectURL(href);
    const reason = String(err?.message || err);
    if (/canceled|cancelled/i.test(reason)) {
      setStatus('已取消保存', running ? 'active' : 'idle');
      return;
    }
    setStatus(`保存失败：${reason}`, 'error');
  }
});

listEl.addEventListener('click', async (event) => {
  const article = event.target.closest('.subtitle-line');
  if (!article) return;
  const videoTimeMs = Number(article.dataset.time);
  if (!Number.isFinite(videoTimeMs)) return;

  const tab = cachedTab || await getActiveTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'SEEK_VIDEO', videoTimeMs }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ASR_WARMUP') {
    pingAsr(message.url || wsInput.value || DEFAULT_WS)
      .then((origin) => sendResponse({ ok: Boolean(origin) }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.target && message.target !== 'ui') return;
  applyNotice(message);
});

async function init() {
  await loadWsUrl();
  pingAsr(wsInput.value || DEFAULT_WS).catch(() => {});
  loadModels(wsInput.value || DEFAULT_WS).catch(() => {});
  await refreshTarget();
  const [noticeData, sessionData] = await Promise.all([
    chrome.storage.session.get('uiNotice'),
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }).catch(() => null),
  ]);
  const live = sessionData?.session?.state === 'transcribing';
  const notice = noticeData.uiNotice;

  // 只有后台说「还在转写」才算在转写。存下来的旧提示不能决定按钮状态，
  // 否则面板重开时会拿一条过期的「已开始」把「开始转写」按灰。
  const stale = notice && !live
    && (notice.type === 'ASR_ERROR' || notice.type === 'CAPTURE_STARTED');
  if (notice && !stale) {
    applyNotice(notice);
  }

  setRunning(live);
  setStatus(live ? '转写中…' : '空闲', live ? 'active' : 'idle');
  render();
}

/** 面板重新显示时，跟后台核对一次状态，避免按钮和实际情况不一致。 */
async function reconcileRunning() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SESSION' }).catch(() => null);
  const live = res?.session?.state === 'transcribing';
  if (live === running) return;
  setRunning(live);
  if (!live) setStatus('已停止', 'idle');
}

modelSelect.addEventListener('change', () => {
  chrome.storage.local.set({ asrModel: modelSelect.value });
  hintEl.textContent = running
    ? '换模型要下次「开始转写」才生效。'
    : `已选：${modelSelect.selectedOptions[0]?.textContent || '跟随服务端设置'}。点「开始转写」即可使用。`;
});

targetSelect.addEventListener('change', () => {
  const value = targetSelect.value;
  pinnedTabId = value === 'auto' ? 'auto' : Number(value);
  refreshTarget();
});

// 侧边栏一直开着，切标签页时它不会重新加载，所以要主动跟着浏览器更新。
let refreshTimer = null;
function scheduleRefresh() {
  if (running) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshTarget().catch(() => {}), 150);
}

chrome.tabs.onActivated.addListener(scheduleRefresh);
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if ('audible' in changeInfo || 'url' in changeInfo || 'title' in changeInfo) scheduleRefresh();
});
chrome.windows.onFocusChanged.addListener(scheduleRefresh);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  scheduleRefresh();
  reconcileRunning().catch(() => {});
});

init();
