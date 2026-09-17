/**
 * Content Script：video 事件监听、原生字幕探测、点击字幕跳转
 */

import { getAdapterForUrl } from '../adapters/registry.js';

let activeVideo = null;
let tickTimer = null;

function findPrimaryVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;
  return videos.find((v) => !v.paused && v.currentTime > 0) || videos[0];
}

function emit(event, video = activeVideo) {
  if (!video) return;
  chrome.runtime.sendMessage({
    type: 'VIDEO_TIME_EVENT',
    event,
    videoTimeMs: Math.round(video.currentTime * 1000),
    wallClockMs: Date.now(),
    playbackRate: video.playbackRate || 1,
    paused: video.paused,
  }).catch(() => {});
}

function bindVideoEvents(video) {
  if (!video || video.dataset.asrBound) return;
  video.dataset.asrBound = '1';
  activeVideo = video;

  ['play', 'pause', 'seeked', 'ratechange'].forEach((ev) => {
    video.addEventListener(ev, () => {
      activeVideo = video;
      emit(ev, video);
    });
  });
}

function observeVideos() {
  bindVideoEvents(findPrimaryVideo());
  const observer = new MutationObserver(() => bindVideoEvents(findPrimaryVideo()));
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function startClock() {
  stopClock();
  tickTimer = setInterval(() => {
    const video = findPrimaryVideo();
    if (!video) return;
    bindVideoEvents(video);
    emit(video.paused ? 'pause' : 'tick', video);
  }, 1000);
}

function stopClock() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

async function fetchNativeSubtitles() {
  const adapter = getAdapterForUrl(location.href);
  if (!adapter) return { ok: false, subtitles: null, reason: 'NO_ADAPTER' };

  try {
    const video = findPrimaryVideo();
    const subtitles = await adapter.fetchSubtitles({ url: location.href, video, document });
    return { ok: Boolean(subtitles?.length), subtitles, adapterId: adapter.id };
  } catch (err) {
    return { ok: false, subtitles: null, adapterId: adapter.id, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_NATIVE_SUBTITLES') {
    fetchNativeSubtitles().then(sendResponse);
    return true;
  }

  if (message.type === 'GET_ACTIVE_VIDEO_TIME' || message.type === 'SYNC_VIDEO_CLOCK') {
    const video = findPrimaryVideo();
    bindVideoEvents(video);
    if (video) emit(message.type === 'SYNC_VIDEO_CLOCK' ? 'sync' : 'tick', video);
    if (message.type === 'SYNC_VIDEO_CLOCK') startClock();
    sendResponse({
      videoTimeMs: video ? Math.round(video.currentTime * 1000) : 0,
      hasVideo: !!video,
      playbackRate: video?.playbackRate || 1,
      paused: Boolean(video?.paused),
    });
    return false;
  }

  if (message.type === 'STOP_VIDEO_CLOCK') {
    stopClock();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'SEEK_VIDEO') {
    const video = findPrimaryVideo();
    if (video && Number.isFinite(message.videoTimeMs)) {
      video.currentTime = message.videoTimeMs / 1000;
      video.play().catch(() => {});
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'NO_VIDEO' });
    }
    return false;
  }

  return false;
});

if (document.body) observeVideos();
else document.addEventListener('DOMContentLoaded', observeVideos, { once: true });
