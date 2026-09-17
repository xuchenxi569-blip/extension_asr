/**
 * 探针：直接测「上传音频 → 拿文字」这条接口，看是哪一步卡住。
 * 用法：node scripts/probe-asr.mjs
 *
 * 只打印耗时、状态码和响应片段。绝不打印 API Key。
 */

import { existsSync, readFileSync } from 'node:fs';
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
console.log(`base=${base} keyLength=${apiKey.length}`);

/** 1 秒静音的 WAV（16kHz 单声道 16bit）。 */
function silentWav(seconds = 1, sampleRate = 16000) {
  const data = Buffer.alloc(sampleRate * seconds * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** 手工拼 multipart，带 Content-Length，绕开 undici 的流式上传。 */
function buildMultipart(fields, file) {
  const boundary = `----probe${Date.now().toString(16)}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
    `Content-Type: audio/wav\r\n\r\n`
  ));
  parts.push(file.buffer, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

function preview(text) {
  return String(text).replace(apiKey, '<key>').slice(0, 240).replace(/\s+/g, ' ');
}

async function run(label, fn, timeoutMs = 25000) {
  const t0 = Date.now();
  try {
    const { status, text } = await fn(AbortSignal.timeout(timeoutMs));
    console.log(`${label.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  ${status}  ${preview(text)}`);
  } catch (err) {
    console.log(`${label.padEnd(34)} ${String(Date.now() - t0).padStart(6)}ms  失败  ${err?.name}: ${preview(err?.message || err)}`);
  }
}

const auth = { Authorization: `Bearer ${apiKey}` };

// 1. Key 能不能用
await run('GET /v1/models', async (signal) => {
  const res = await fetch(`${base}/v1/models`, { headers: auth, signal });
  return { status: res.status, text: await res.text() };
}, 15000);

const samplePath = resolve('scripts/speech-test.wav');
const wav = existsSync(samplePath) ? readFileSync(samplePath) : silentWav(1);
console.log(`音频=${existsSync(samplePath) ? 'speech-test.wav（真人语音）' : '1 秒静音'} bytes=${wav.length}`);

const models = ['TeleAI/TeleSpeechASR', 'FunAudioLLM/SenseVoiceSmall'];

// 2. undici FormData（backend 现在用的方式）
for (const model of models) {
  await run(`FormData ${model}`, async (signal) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'chunk.wav');
    form.append('model', model);
    const res = await fetch(`${base}/v1/audio/transcriptions`, {
      method: 'POST', headers: auth, body: form, signal,
    });
    return { status: res.status, text: await res.text() };
  });
}

// 3. 手工 multipart + Content-Length
for (const model of models) {
  await run(`手工multipart ${model}`, async (signal) => {
    const { boundary, body } = buildMultipart({ model }, { name: 'chunk.wav', buffer: wav });
    const res = await fetch(`${base}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
      signal,
    });
    return { status: res.status, text: await res.text() };
  });
}
