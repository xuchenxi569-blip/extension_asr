/**
 * 通用课程站占位适配器
 * 各站点需单独实现 fetchSubtitles
 */

import { defineAdapter } from './base.js';

const COURSE_PATTERNS = [
  /coursera\.org/i,
  /udemy\.com/i,
  /edx\.org/i,
  /bilibili\.com\/video/i,
];

export const genericCourseAdapter = defineAdapter({
  id: 'generic-course',
  match: (url) => COURSE_PATTERNS.some((re) => re.test(url)),

  async fetchSubtitles({ url }) {
    console.info('[extension-asr] 课程站适配待实现:', url);
    return null;
  },
});
