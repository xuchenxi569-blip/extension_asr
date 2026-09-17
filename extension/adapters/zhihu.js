/**
 * 知乎知学堂：课程视频一般没有可拉取的字幕文件，快速返回空并走 ASR。
 */

import { defineAdapter } from './base.js';

const PATHS = [
  /\/xen\/market\/training\/training-video\//i,
  /\/education\/training\//i,
  /\/education\/video-course\//i,
];

function isZhihuTraining(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'zhihu.com') return false;
    return PATHS.some((re) => re.test(u.pathname));
  } catch {
    return false;
  }
}

export const zhihuAdapter = defineAdapter({
  id: 'zhihu-zhixuetang',
  match: isZhihuTraining,

  async fetchSubtitles() {
    return null;
  },
});
