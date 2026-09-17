/**
 * 字幕适配器基类约定
 *
 * @typedef {Object} SubtitleSegment
 * @property {number} startMs
 * @property {number} endMs
 * @property {string} text
 *
 * @typedef {Object} SubtitleAdapter
 * @property {string} id
 * @property {(url: string) => boolean} match
 * @property {(ctx: { url: string, video: HTMLVideoElement|null, document: Document }) => Promise<SubtitleSegment[]|null>} fetchSubtitles
 */

export const AdapterStatus = {
  OK: 'ok',
  NOT_AVAILABLE: 'not_available',
  DRM_BLOCKED: 'drm_blocked',
};

/**
 * @param {Partial<SubtitleAdapter>} adapter
 * @returns {SubtitleAdapter}
 */
export function defineAdapter(adapter) {
  if (!adapter.id || !adapter.match || !adapter.fetchSubtitles) {
    throw new Error('SubtitleAdapter requires id, match, fetchSubtitles');
  }
  return /** @type {SubtitleAdapter} */ (adapter);
}
