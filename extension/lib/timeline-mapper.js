/**
 * 录音时间 ↔ 视频播放时间 映射
 *
 * 录音按真实世界的秒走；视频可能暂停、倍速、拖动进度条。
 * 用一串锚点（播放/暂停/跳转/心跳）把「录音第几毫秒」换算成「视频第几毫秒」。
 */

export class TimelineMapper {
  constructor() {
    /** @type {Array<{event: string, videoTimeMs: number, wallClockMs: number, playbackRate: number}>} */
    this.events = [];
    this.recordingStartWallMs = null;
  }

  markRecordingStart() {
    this.recordingStartWallMs = Date.now();
    this.events = [];
  }

  /**
   * @param {{ event: string, videoTimeMs: number, wallClockMs: number, playbackRate?: number }} payload
   */
  record(payload) {
    const playbackRate = Number(payload.playbackRate) > 0 ? Number(payload.playbackRate) : 1;
    if (this.recordingStartWallMs === null && (payload.event === 'play' || payload.event === 'sync')) {
      this.recordingStartWallMs = payload.wallClockMs;
    }
    this.events.push({
      event: payload.event,
      videoTimeMs: payload.videoTimeMs,
      wallClockMs: payload.wallClockMs,
      playbackRate,
    });
  }

  /**
   * 将 ASR 返回的 audioOffsetMs 映射为视频内时间
   * @param {number} audioOffsetMs
   * @returns {number|null}
   */
  audioToVideoTime(audioOffsetMs) {
    if (this.recordingStartWallMs === null) return null;

    const targetWall = this.recordingStartWallMs + audioOffsetMs;
    let anchor = this.events[0];
    for (const ev of this.events) {
      if (ev.wallClockMs <= targetWall) anchor = ev;
      else break;
    }
    if (!anchor) return null;

    if (anchor.event === 'pause') return Math.round(anchor.videoTimeMs);

    const rate = anchor.playbackRate > 0 ? anchor.playbackRate : 1;
    const delta = (targetWall - anchor.wallClockMs) * rate;
    return Math.round(anchor.videoTimeMs + delta);
  }
}
