/**
 * 检查侧边栏按钮接线，以及那个「停止后把开始按灰」的问题是否已消除。
 * 用法（在 backend 目录）：node scripts/check-ui.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('..');
const js = readFileSync(resolve(root, 'extension/sidepanel/sidepanel.js'), 'utf8');
const html = readFileSync(resolve(root, 'extension/sidepanel/sidepanel.html'), 'utf8');
const sw = readFileSync(resolve(root, 'extension/background/service-worker.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));

const checks = [
  ['HTML 里有「重新转写」按钮', html.includes('id="btn-restart"')],
  ['JS 里绑了「重新转写」点击', /btnRestart\.addEventListener/.test(js)],
  ['「重新转写」不会被置灰', !/btnRestart\.disabled/.test(js)],
  ['转写事件不再改运行状态', !/status--error[\s\S]{0,240}setRunning\(true\)/.test(js)],
  ['运行状态以后台为准', /setRunning\(live\)/.test(js)],
  ['过期的「已开始」不再生效', /notice\.type === 'CAPTURE_STARTED'/.test(js)],
  ['卡住时会自动清理重试', /recoverAndRetry/.test(js)],
  ['后台支持强制重置', /FORCE_RESET/.test(sw) && /async function forceReset/.test(sw)],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? '通过' : '失败'}  ${label}`);
}
console.log(`\n插件版本 ${manifest.version}`);
process.exit(failed === 0 ? 0 : 1);
