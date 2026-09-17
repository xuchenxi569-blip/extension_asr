/**
 * 列出硅基流动上「上传音频拿文字」这条接口能用的模型，并逐个实测。
 * 用法：node scripts/probe-models.mjs
 *
 * 只打印模型名、耗时、状态和识别结果。绝不打印 API Key。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) throw new Error('找不到 backend/.env');
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = loadEnv();
const apiKey = env.ASR_API_KEY;
const base = (env.ASR_BASE_URL || 'https://api.siliconflow.cn').replace(/\/$/, '');
if (!apiKey) throw new Error('.env 里没有 ASR_API_KEY');

const auth = { Authorization: `Bearer ${apiKey}` };
const TIMEOUT_MS = 15000;

/** 官方列表里筛出像语音识别的模型，再补上文档提到过的。 */
async function discoverModels() {
  const names = new Set([
    'TeleAI/TeleSpeechASR',
    'FunAudioLLM/SenseVoiceSmall',
    'iic/SenseVoiceSmall',
    'Qwen/Qwen3-ASR-1.7B',
    'Qwen/Qwen3-ASR-Flash',
    'XingChenAGI/XingChenASR-V3.2-Ultra',
    'openai/whisper-large-v3',
  ]);

  for (const query of ['?sub_type=speech-to-text', '?type=audio', '']) {
    try {
      const res = await fetch(`${base}/v1/models${query}`, {
        headers: auth,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      for (const item of json.data || []) {
        const id = item.id || '';
        if (/asr|speech|whisper|audio|voice/i.test(id)) names.add(id);
      }
    } catch { /* 换下一种查法 */ }
  }
  return [...names];
}

function silentWav(seconds = 1, sampleRate = 16000) {
  const data = Buffer.alloc(sampleRate * seconds * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const samplePath = resolve('scripts/speech-test.wav');
const wav = existsSync(samplePath) ? readFileSync(samplePath) : silentWav(1);
console.log(`音频=${existsSync(samplePath) ? 'speech-test.wav（真人中文语音）' : '1 秒静音'} bytes=${wav.length}\n`);

async function tryModel(model) {
  const t0 = Date.now();
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'chunk.wav');
    form.append('model', model);
    const res = await fetch(`${base}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: auth,
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.text();
    const ms = Date.now() - t0;
    let text = '';
    try { text = JSON.parse(raw).text || ''; } catch { text = ''; }
    return { model, ms, status: res.status, ok: res.ok && Boolean(text.trim()), text: text.trim(), raw: raw.slice(0, 120) };
  } catch (err) {
    return { model, ms: Date.now() - t0, status: '超时/失败', ok: false, text: '', raw: `${err?.name}` };
  }
}

const models = await discoverModels();
console.log(`待测 ${models.length} 个模型\n`);

const results = [];
for (const model of models) {
  const r = await tryModel(model);
  results.push(r);
  const flag = r.ok ? '可用' : '不可用';
  console.log(`${flag}  ${String(r.ms).padStart(6)}ms  ${String(r.status).padEnd(10)} ${r.model}`);
  if (r.text) console.log(`        → ${r.text.slice(0, 60)}`);
  else if (r.raw) console.log(`        → ${r.raw.replace(/\s+/g, ' ')}`);
}

const usable = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
console.log(`\n可用模型 ${usable.length} 个（按快到慢）：`);
for (const r of usable) console.log(`  ${r.model}  ${r.ms}ms`);

writeFileSync(
  resolve('scripts/models-report.json'),
  JSON.stringify(usable.map(({ model, ms, text }) => ({ model, ms, text })), null, 2),
  'utf8'
);
console.log('\n已写入 scripts/models-report.json');
