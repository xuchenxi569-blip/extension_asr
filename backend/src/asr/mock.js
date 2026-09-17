/**
 * Mock ASR：开发阶段用于验证管道与界面，不识别真实语音。
 */

const MOCK_PHRASES = [
  '这是 Extension ASR 的模拟转写结果。',
  '优先读取网站原生字幕。',
  '无字幕时使用标签页音频流式识别。',
  'partial 文本为灰色，final 为黑色定稿。',
];

export function createMockAsrSession() {
  let phraseIndex = 0;
  let partialStep = 0;

  return {
    async processChunk(_pcm, audioOffsetMs) {
      const events = [];
      partialStep += 1;

      const phrase = MOCK_PHRASES[phraseIndex % MOCK_PHRASES.length];
      const partialLen = Math.min(phrase.length, Math.max(1, partialStep * 4));
      events.push({
        type: 'partial',
        text: phrase.slice(0, partialLen),
        audioOffsetMs,
      });

      if (partialStep >= 3) {
        events.push({
          type: 'final',
          text: phrase,
          audioOffsetMs,
          confidence: 0.9,
        });
        phraseIndex += 1;
        partialStep = 0;
      }

      return events;
    },

    async close() {
      return [];
    },
  };
}
