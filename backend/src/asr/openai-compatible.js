/**
 * 兼容 OpenAI /v1/audio/transcriptions 的识别：
 * 每几秒把音频打包成 WAV 发一次，得到定稿句子。
 * 适用于 OpenAI、Groq、硅基流动等同一套接口。
 *
 * 云端请求不阻塞本机 /transcribe：插件只等本机，不等硅基流动。
 */

import { pcm16ToWavBuffer } from '../pcm-to-wav.js';
import { createTermFixer } from './terms.js';

export function createOpenaiCompatibleSession({
  apiKey,
  baseUrl,
  model,
  language = 'zh',
  chunkMs = 5000,
  timeoutMs = 60000,
}) {
  const transcribeUrl = `${baseUrl.replace(/\/$/, '')}/v1/audio/transcriptions`;
  const fixTerms = createTermFixer();
  const chunks = [];
  const pending = [];
  let bufferedMs = 0;
  let lastOffsetMs = 0;
  let inFlight = false;
  let flushPromise = Promise.resolve();
  const supportsLanguage = !/siliconflow\.cn/i.test(baseUrl);

  async function flush() {
    if (chunks.length === 0 || inFlight) return flushPromise;
    inFlight = true;
    flushPromise = runFlush();
    return flushPromise;
  }

  async function runFlush() {
    const wav = pcm16ToWavBuffer(chunks.splice(0, chunks.length));
    const offset = lastOffsetMs;
    bufferedMs = 0;
    const started = Date.now();
    console.log(`[asr] 开始识别 model=${model} bytes=${wav.length}`);

    try {
      const form = new FormData();
      const bytes = new Uint8Array(wav);
      form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'chunk.wav');
      form.append('model', model);
      if (supportsLanguage && language) form.append('language', language);

      const res = await fetch(transcribeUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const body = await res.text();
      console.log(`[asr] 识别结束 ${Date.now() - started}ms status=${res.status}`);
      if (!res.ok) {
        pending.push({
          type: 'error',
          text: `识别接口失败 ${res.status}: ${body.slice(0, 180)}`,
          audioOffsetMs: offset,
        });
        return;
      }

      let text = '';
      try {
        const json = JSON.parse(body);
        text = json.text || json.result || '';
      } catch {
        text = body;
      }
      text = fixTerms(String(text).trim());
      if (!text) return;

      pending.push({
        type: 'final',
        text,
        audioOffsetMs: offset,
        confidence: 0.8,
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || /timed out|aborted/i.test(String(err?.message || ''));
      console.log(`[asr] 识别失败 ${Date.now() - started}ms ${err?.name || ''} ${err?.message || err}`);
      pending.push({
        type: 'error',
        text: timedOut
          ? `模型 ${model} 超过 ${Math.round(timeoutMs / 1000)} 秒没回。换成 TeleAI/TeleSpeechASR（实测 2 秒内出字），改 backend/.env 的 ASR_MODEL 后重开 start.bat。`
          : (err?.message || String(err)),
        audioOffsetMs: offset,
      });
    } finally {
      inFlight = false;
    }
  }

  return {
    async processChunk(pcm, audioOffsetMs) {
      lastOffsetMs = audioOffsetMs;
      chunks.push(Buffer.from(pcm));
      bufferedMs += 800;

      if (bufferedMs >= chunkMs && !inFlight) {
        flush();
      }

      const events = pending.splice(0, pending.length);
      if (events.length > 0) return events;
      return [{
        type: 'partial',
        text: inFlight ? '正在识别…' : '正在听…',
        audioOffsetMs,
      }];
    },

    async close() {
      await flushPromise;
      await flush();
      return pending.splice(0, pending.length);
    },
  };
}
