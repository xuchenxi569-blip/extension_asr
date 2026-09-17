import { youtubeAdapter } from './youtube.js';
import { zhihuAdapter } from './zhihu.js';
import { genericCourseAdapter } from './generic-course.js';

/** @type {import('./base.js').SubtitleAdapter[]} */
const adapters = [
  zhihuAdapter,
  youtubeAdapter,
  genericCourseAdapter,
];

/**
 * @param {string} url
 * @returns {import('./base.js').SubtitleAdapter | null}
 */
export function getAdapterForUrl(url) {
  return adapters.find((a) => a.match(url)) ?? null;
}

export function listAdapters() {
  return adapters.map((a) => ({ id: a.id }));
}
