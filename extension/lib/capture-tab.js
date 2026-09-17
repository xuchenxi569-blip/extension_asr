/**
 * 哪些页面允许录标签页声音
 */

export function isCapturableUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

export function captureBlockedMessage(url) {
  const isChromePage = !url
    || url.startsWith('chrome://')
    || url.startsWith('chrome-extension://')
    || url.startsWith('edge://')
    || url.startsWith('about:');

  if (isChromePage) {
    return '不能在 Chrome 自己的页面录音（例如扩展管理页、新标签页）。请先打开视频网页，再点侧边栏的「开始转写」。';
  }

  return '无法录这个标签页。请先打开视频网页，再点侧边栏的「开始转写」。';
}

export function explainCaptureError(raw, tab) {
  const text = String(raw || '');
  if (text.includes('not been invoked') || text.includes('activeTab') || text.includes('Chrome pages')) {
    const name = tab?.title || tab?.url || '那个网页';
    return `Chrome 不让直接录「${name}」。请切到该标签页，点一次工具栏上的扩展图标，再点「开始转写」。`;
  }
  if (text.includes('active stream') || text.includes('already')) {
    return '已经在转写了。要重新开始，请先点「停止」。';
  }
  return `无法捕获这个标签页的声音：${text}`;
}
