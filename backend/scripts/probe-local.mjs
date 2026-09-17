/**
 * 测本机新加的 /models 和「指定模型开会话」是否生效。
 * 用法：node scripts/probe-local.mjs
 */

const BASE = 'http://127.0.0.1:8787';

async function j(path, init) {
  const res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  return { status: res.status, sessionId: res.headers.get('x-session-id') || '', text };
}

const models = await j('/models');
const list = JSON.parse(models.text);
console.log(`GET /models  ${models.status}  当前默认=${list.current}`);
for (const m of list.models) console.log(`  ${m.id.padEnd(38)} ${m.label}`);

const cases = [
  ['指定 Qwen/Qwen3-ASR-1.7B', 'Qwen/Qwen3-ASR-1.7B'],
  ['指定挂死的 SenseVoiceSmall', 'FunAudioLLM/SenseVoiceSmall'],
  ['不指定（跟随 .env）', ''],
];

for (const [label, model] of cases) {
  const r = await j('/session/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(model ? { 'x-asr-model': model } : {}),
    },
    body: '{}',
  });
  console.log(`\n${label}\n  status=${r.status} sessionId=${r.sessionId ? '有' : '无'}`);
  if (r.sessionId) {
    await j('/session/stop', { method: 'POST', headers: { 'x-session-id': r.sessionId } }).catch(() => {});
  }
}
