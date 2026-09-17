/**
 * 用刚才实测到的真实识别结果，验证术语表能修掉多少。
 * 用法：node scripts/probe-terms.mjs
 */

import { createTermFixer, loadTerms } from '../src/asr/terms.js';

const fix = createTermFixer(loadTerms());

const TERMS = ['RAG', '检索增强生成', 'LoRA', '适配器', 'token', 'Transformer', 'vLLM'];

/** 大小写也要算错：Rag 不等于 RAG。 */
function hits(text) {
  return TERMS.filter((t) => text.includes(t)).length;
}

// 这四条是 probe-hotwords.mjs 跑出来的原始输出，一字未改。
const SAMPLES = [
  ['Qwen3-ASR-1.7B', '我们用 Rag 做检索增强生成，微调了一个 Lora 适配器，上下文长度控制在 4000 个 token 以内，底座是 Transformer 架构，推理时用 VLLM 加速。'],
  ['TeleSpeech ASR', '我们用rec做检索增强生成，微调了一个laura适配器，上下文长度控制在4000个token以内，底座是transformer架构，推理时用vllm加速。'],
  ['星辰 V3.2', '我们用rec做检索增强生成，微调了一个laura适配器，上下文长度控制在4000个token以内，底座是transformer架构，推理时用vllm加速。'],
  ['星辰 V3.2-Ultra', '我们用rec做检索增强生成，微调了一个laura适配器，上下文长度控制在4000个token以内，底座是transformer架构，推理时用v l l m加速。'],
];

console.log(`关注术语（区分大小写）：${TERMS.join(' / ')}\n`);

for (const [name, raw] of SAMPLES) {
  const fixed = fix(raw);
  console.log(`=== ${name} ===`);
  console.log(`  修正前 ${hits(raw)}/${TERMS.length}  ${raw}`);
  console.log(`  修正后 ${hits(fixed)}/${TERMS.length}  ${fixed}\n`);
}

// 取舍型词条：错误写法本身也是正常中文词，加了就等于放弃原意。
const TRADEOFFS = [
  ['艺人公司也要转型做AI了。', '一人公司也要转型做AI了。'],
];

console.log('=== 取舍型词条（按预期会被改写）===');
for (const [before, expected] of TRADEOFFS) {
  const fixed = fix(before);
  console.log(`  ${fixed === expected ? '符合预期' : '不符预期'}  ${before}  ->  ${fixed}`);
}
console.log('');

// 防误伤：这些词里含 rec / lora / 艺人 等片段，但不该被改。
const SAFETY = [
  '请录制这段视频并保存记录。',
  'We need to record the recommendation before recovery.',
  '她的名字叫 Laurance，不是模型。',
  '这个 API 的 apis 列表很长。',
  '这位艺人签了新的经纪合约。',
  '公司里只有一个人。',
];

console.log('=== 误伤检查（下面每行修正前后应完全一致）===');
for (const text of SAFETY) {
  const fixed = fix(text);
  console.log(`  ${fixed === text ? '安全' : '被误改'}  ${text}`);
  if (fixed !== text) console.log(`        改成了：${fixed}`);
}
