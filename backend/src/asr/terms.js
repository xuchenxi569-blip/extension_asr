/**
 * AI 术语纠正表。
 *
 * 为什么需要它：识别模型的第二步是「从发音猜文字」，依据是词频。
 * 像 RAG / LoRA 这种词，在通用语料里远不如 rec / laura 常见，所以会被写错。
 * 实测这类错误是稳定的 —— 同一个词几乎总错成同一个样子，所以一张对照表就能修掉。
 *
 * 想改词表不用动代码：编辑 backend/terms.json，重开 start.bat 生效。
 * terms.json 的格式：[{ "term": "正确写法", "variants": ["可能被写成的样子", ...] }]
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 注意「取舍型」词条：下面这些的错误写法本身也是正常中文词。
 * 一旦加入，就意味着你放弃了那个词的原意，换取常用词不再被认错。
 * 例：一人公司 ← 艺人公司。加了之后你没法再正常说出「艺人公司」。
 * 不接受这个取舍就把对应 variants 删掉。
 */
export const DEFAULT_TERMS = [
  { term: '一人公司', variants: ['艺人公司', '以人公司', '议人公司'] },
  { term: 'RAG', variants: ['rec', 'rag', '瑞格', 'r a g'] },
  { term: 'LoRA', variants: ['laura', 'lora', '劳拉'] },
  { term: 'vLLM', variants: ['vllm', 'v l l m'] },
  { term: 'Transformer', variants: ['transformer', 'трансформер'] },
  { term: 'token', variants: ['Token', '透肯'] },
  { term: 'prompt', variants: ['Prompt', '普罗姆特'] },
  { term: 'embedding', variants: ['Embedding', '嵌入向量'] },
  { term: 'GPU', variants: ['gpu', 'g p u'] },
  { term: 'CPU', variants: ['cpu', 'c p u'] },
  { term: 'API', variants: ['api', 'a p i'] },
  { term: 'LLM', variants: ['llm', 'l l m'] },
  { term: 'MCP', variants: ['mcp', 'm c p'] },
  { term: 'SFT', variants: ['sft', 's f t'] },
  { term: 'RLHF', variants: ['rlhf', 'r l h f'] },
  { term: 'MoE', variants: ['moe', 'mo e'] },
  { term: 'Agent', variants: ['agent', '艾真特'] },
  { term: 'ChatGPT', variants: ['chatgpt', 'chat gpt', 'Chat GPT'] },
  { term: 'GPT-4', variants: ['gpt4', 'gpt 4', 'GPT4'] },
  { term: 'Claude', variants: ['claude', '克劳德'] },
  { term: 'Gemini', variants: ['gemini', '双子星'] },
  { term: 'DeepSeek', variants: ['deepseek', 'deep seek', 'Deep Seek'] },
  { term: 'Qwen', variants: ['qwen', 'q wen'] },
  { term: 'Llama', variants: ['llama', '拉马'] },
  { term: 'PyTorch', variants: ['pytorch', 'py torch'] },
  { term: 'CUDA', variants: ['cuda', '库达'] },
  { term: 'Hugging Face', variants: ['huggingface', 'hugging face'] },
  { term: 'fine-tune', variants: ['finetune', 'fine tune'] },
  { term: 'few-shot', variants: ['fewshot', 'few shot'] },
  { term: 'zero-shot', variants: ['zeroshot', 'zero shot'] },
  { term: 'benchmark', variants: ['Benchmark', '本奇马克'] },
];

/** 纯拉丁字母/数字的词要卡词边界，否则 rec 会把 record 也改掉。 */
const LATIN_ONLY = /^[A-Za-z0-9][A-Za-z0-9 .+-]*$/;

function toPattern(variant) {
  const escaped = variant
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s*');
  return LATIN_ONLY.test(variant)
    ? new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi')
    : new RegExp(escaped, 'g');
}

/** 读 backend/terms.json；没有或读坏了就用内置词表。 */
export function loadTerms() {
  const path = resolve(process.cwd(), 'terms.json');
  if (!existsSync(path)) return DEFAULT_TERMS;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TERMS;
    return parsed.filter((item) => item && typeof item.term === 'string' && item.term.trim());
  } catch (err) {
    console.warn(`[terms] terms.json 读不出来，改用内置词表：${err.message}`);
    return DEFAULT_TERMS;
  }
}

/**
 * 生成一个纠正函数。
 * 长的写法先替换，避免「gpt 4」被「gpt」先吃掉半截。
 */
export function createTermFixer(terms = loadTerms()) {
  const rules = [];
  for (const { term, variants = [] } of terms) {
    const all = [...new Set([term, ...variants])]
      .filter((v) => typeof v === 'string' && v.trim())
      .sort((a, b) => b.length - a.length);
    for (const variant of all) {
      rules.push({ re: toPattern(variant), term });
    }
  }

  return function fixTerms(text) {
    if (!text) return text;
    return rules.reduce((acc, rule) => acc.replace(rule.re, rule.term), text);
  };
}
