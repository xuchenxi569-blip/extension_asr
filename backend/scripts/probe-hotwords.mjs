/**
 * 测「AI 术语」的识别准确率，以及能不能靠提示词/热词纠正。
 * 用法：node scripts/probe-hotwords.mjs
 *
 * 只打印识别结果。绝不打印 API Key。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ASR_MODELS } from '../src/asr/models.js';

function loadEnv() {
  const out = {};
  for (const line of readFileSync(resolve('.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = loadEnv();
const apiKey = env.ASR_API_KEY;
const base = (env.ASR_BASE_URL || 'https://api.siliconflow.cn').replace(/\/$/, '');
const url = `${base}/v1/audio/transcriptions`;
const auth = { Authorization: `Bearer ${apiKey}` };

const samplePath = resolve('scripts/jargon-test.wav');
if (!existsSync(samplePath)) throw new Error('缺少 scripts/jargon-test.wav');
const wav = readFileSync(samplePath);

const TRUTH = '我们用RAG做检索增强生成，微调了一个LoRA适配器，上下文长度控制在四千个token以内，底座是Transformer架构，推理时用vLLM加速。';
const TERMS = ['RAG', '检索增强生成', 'LoRA', '适配器', 'token', 'Transformer', 'vLLM'];

/** 只看关键术语命中了几个，比整句字错率更贴近我们关心的问题。 */
function scoreTerms(text) {
  const lower = String(text).toLowerCase();
  const hit = TERMS.filter((t) => lower.includes(t.toLowerCase()));
  return { hit, miss: TERMS.filter((t) => !hit.includes(t)) };
}

async function transcribe(model, extraFields = {}) {
  const t0 = Date.now();
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'chunk.wav');
    form.append('model', model);
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
    const res = await fetch(url, { method: 'POST', headers: auth, body: form, signal: AbortSignal.timeout(30000) });
    const raw = await res.text();
    let text = '';
    try { text = JSON.parse(raw).text || ''; } catch { text = ''; }
    return { ms: Date.now() - t0, status: res.status, text: text.trim(), raw: raw.slice(0, 140) };
  } catch (err) {
    return { ms: Date.now() - t0, status: '失败', text: '', raw: String(err?.name) };
  }
}

console.log(`原文：${TRUTH}`);
console.log(`关注术语：${TERMS.join(' / ')}\n`);

const hotwordText = TERMS.join('、');
// 各家「给模型看的提示」字段名不统一，全试一遍看哪个被接受。
const variants = [
  ['裸识别', {}],
  ['prompt 提示词', { prompt: `本段是 AI 技术讨论，可能出现这些词：${hotwordText}。` }],
  ['hotwords 热词', { hotwords: hotwordText }],
  ['context 上下文', { context: hotwordText }],
];

for (const { id } of ASR_MODELS) {
  console.log(`\n=== ${id} ===`);
  for (const [label, fields] of variants) {
    const r = await transcribe(id, fields);
    if (!r.text) {
      console.log(`  ${label.padEnd(14)} ${String(r.status).padEnd(6)} ${r.raw.replace(/\s+/g, ' ')}`);
      continue;
    }
    const { hit, miss } = scoreTerms(r.text);
    console.log(`  ${label.padEnd(14)} ${String(r.ms).padStart(5)}ms  命中 ${hit.length}/${TERMS.length}  缺:${miss.join(',') || '无'}`);
    console.log(`    ${r.text}`);
  }
}
