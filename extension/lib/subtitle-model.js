/**
 * 字幕行模型与 partial/final 合并
 */

/**
 * @typedef {Object} SubtitleLine
 * @property {string} id
 * @property {string} text
 * @property {'partial'|'final'} status
 * @property {number|null} videoTimeMs
 * @property {number} audioOffsetMs
 */

let lineId = 0;

/**
 * @param {SubtitleLine[]} lines
 * @param {{ type: 'partial'|'final', text: string, audioOffsetMs: number }} event
 * @param {(audioOffsetMs: number) => number|null} mapTime
 * @returns {SubtitleLine[]}
 */
export function applyTranscriptEvent(lines, event, mapTime) {
  const videoTimeMs = mapTime(event.audioOffsetMs);
  const next = [...lines];

  if (event.type === 'partial') {
    const last = next[next.length - 1];
    if (last?.status === 'partial') {
      last.text = event.text;
      last.audioOffsetMs = event.audioOffsetMs;
      last.videoTimeMs = videoTimeMs;
      return next;
    }
    next.push({
      id: `line-${++lineId}`,
      text: event.text,
      status: 'partial',
      videoTimeMs,
      audioOffsetMs: event.audioOffsetMs,
    });
    return next;
  }

  const last = next[next.length - 1];
  if (last?.status === 'partial') {
    last.text = event.text;
    last.status = 'final';
    last.videoTimeMs = videoTimeMs;
    last.audioOffsetMs = event.audioOffsetMs;
    return next;
  }

  next.push({
    id: `line-${++lineId}`,
    text: event.text,
    status: 'final',
    videoTimeMs,
    audioOffsetMs: event.audioOffsetMs,
  });
  return next;
}

export function formatTime(ms) {
  if (ms == null) return '--:--';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 只拼接已经定稿的句子，供复制全文 */
export function toPlainText(lines) {
  return lines
    .filter((line) => line.status === 'final' && line.text?.trim())
    .map((line) => line.text.trim())
    .join('\n');
}

/** 导出为 Markdown 笔记：标题、来源、带时间轴的定稿句子 */
export function toMarkdown(lines, meta = {}) {
  const finals = lines.filter((line) => line.status === 'final' && line.text?.trim());
  const title = String(meta.title || '转写笔记').replace(/\s+/g, ' ').trim();
  const url = meta.url || '';
  const exportedAt = meta.exportedAt || new Date().toLocaleString('zh-CN', { hour12: false });
  const body = finals.length === 0
    ? '_暂无定稿字幕。_'
    : finals.map((line) => `- **${formatTime(line.videoTimeMs)}** ${line.text.trim()}`).join('\n');

  const head = [
    `# ${title}`,
    '',
    url ? `- 来源：${url}` : '',
    `- 导出时间：${exportedAt}`,
    '',
    '## 逐句笔记',
    '',
    body,
    '',
  ].filter((line, i, arr) => line !== '' || arr[i - 1] !== '');

  return `${head.join('\n')}\n`;
}

export function markdownFilename(title) {
  const base = String(title || '转写笔记')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || '转写笔记';
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  return `${base}_${stamp}.md`;
}
