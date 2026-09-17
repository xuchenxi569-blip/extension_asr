/**
 * YouTube 字幕适配器（骨架）
 * 实际 timedtext 接口需持续维护，此处为占位实现
 */

import { defineAdapter } from './base.js';

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'www.youtube.com', 'm.youtube.com'];

function isYouTube(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return YOUTUBE_HOSTS.some((h) => host === h.replace(/^www\./, '') || host.endsWith('youtube.com'));
  } catch {
    return false;
  }
}

function getVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

export const youtubeAdapter = defineAdapter({
  id: 'youtube',
  match: isYouTube,

  async fetchSubtitles({ url, video }) {
    const videoId = getVideoId(url);
    if (!videoId) return null;

    // TODO: 实现 timedtext / player response 解析
    // 参考：监听 ytplayer config、captionTracks
    if (video?.textTracks?.length) {
      const track = Array.from(video.textTracks).find((t) => t.kind === 'subtitles' || t.kind === 'captions');
      if (track) {
        track.mode = 'hidden';
        // DOM cue 解析需在 track load 后读取
      }
    }

    console.info('[extension-asr] YouTube adapter: timedtext 解析待实现', videoId);
    return null;
  },
});
