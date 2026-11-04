// e2e 러너 — 스택(셸 호스트 + 가짜 Gateway/모듈) 기동 → Chromium → tests/*.e2e.mjs 를 차례로 돌린다.
//
//   npm run e2e                       점검용 앱(probe)으로 스모크
//   npm run e2e -- --app ui           빌드한 실제 앱(../ui)으로 — `npm run build` 먼저
//   npm run e2e -- --grep 승인        이름에 '승인' 이 든 점검만
//   npm run e2e -- --list             점검 목록만
//
// playwright 는 의존이 아니다: NODE_PATH=$(npm root -g) 로 전역 설치를 가리킨다(lib/browser.mjs). 종료 코드: 실패가 있으면 1, 환경 문제면 2.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChromium } from './lib/browser.mjs';
import { registry } from './lib/harness.mjs';
import { resolveAppDir, startStack } from './stack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);

const appArg = value('--app', 'probe');
const appLabel = appArg === 'probe' ? 'probe' : 'ui';
const grep = value('--grep');
const appDir = resolveAppDir(appArg);

const testFiles = fs.readdirSync(path.join(HERE, 'tests')).filter((f) => f.endsWith('.e2e.mjs')).sort();
for (const file of testFiles) await import(pathToFileURL(path.join(HERE, 'tests', file)).href);

const selected = registry.filter((c) => c.apps.includes(appLabel) && (!grep || c.name.includes(grep)));
if (flag('--list')) {
  for (const c of registry) console.log(`${c.apps.includes(appLabel) ? ' ' : '-'} [${c.apps.join(',')}] ${c.name}`);
  process.exit(0);
}
if (selected.length === 0) {
  // 조용히 0개를 돌고 초록이라 말하지 않는다.
  console.error(`앱 '${appLabel}' 에 해당하는 점검이 없다${grep ? ` (--grep ${grep})` : ''} — 목록: --list`);
  process.exit(1);
}
if (!fs.existsSync(path.join(appDir, 'index.html'))) {
  console.error(`앱 ${appDir}/index.html 이 없다 — ${appArg === 'ui' ? '먼저 `npm run build`' : '--app 경로를 확인한다'}.`);
  process.exit(2);
}

let browser;
try {
  browser = await launchChromium();
} catch (cause) {
  console.error(`Chromium 을 띄우지 못했다: ${cause.message}`);
  process.exit(2);
}
const stack = await startStack({ appDir });
console.log(`e2e — 앱 ${appArg} (${appDir})`);
console.log(`  셸 ${stack.shellOrigin} · Gateway ${stack.gatewayOrigin} · Chromium ${browser.version()}`);

const artifactsDir = path.join(HERE, '.artifacts');
const results = [];
for (const item of selected) {
  await stack.control.reset(item.preset);
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const pages = [];
  const t = {
    stack,
    control: stack.control,
    browser,
    context,
    newPage: async () => {
      const page = await context.newPage();
      pages.push(page);
      return page;
    },
  };
  const started = Date.now();
  let timer;
  try {
    await Promise.race([
      item.fn(t),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`시간 초과 ${item.timeoutMs}ms`)), item.timeoutMs);
      }),
    ]);
    results.push({ name: item.name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${item.name} (${Date.now() - started}ms)`);
  } catch (cause) {
    results.push({ name: item.name, ok: false, ms: Date.now() - started, error: cause });
    console.log(`  ✗ ${item.name}\n      ${String(cause?.message ?? cause).split('\n').join('\n      ')}`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    for (const [index, page] of pages.entries()) {
      const file = path.join(artifactsDir, `${item.name.replace(/[^\p{L}\p{N}]+/gu, '_')}-${index}.png`);
      await page.screenshot({ path: file }).catch(() => {});
    }
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => {});
  }
}

await browser.close().catch(() => {});
await stack.close();
const failed = results.filter((r) => !r.ok);
const skipped = registry.length - selected.length;
console.log(`\n${results.length - failed.length}/${results.length} 통과${failed.length ? `, ${failed.length} 실패` : ''}${skipped ? ` (앱 '${appLabel}' 에 해당하지 않아 ${skipped}개 건너뜀 — 목록: --list)` : ''}`);
process.exit(failed.length ? 1 : 0);
