// Playwright·Chromium 불러오기와 페이지 감시.
//
// playwright 는 저장소 의존이 아니다(package-lock 을 건드리지 않는다) — 전역/임시 설치를 쓴다:
//   NODE_PATH=$(npm root -g) npm run e2e       또는   PLAYWRIGHT_MODULE=/경로/node_modules/playwright
// Chromium 은 미리 깔린 것을 쓴다(기본 /opt/pw-browsers/chromium, CHROMIUM_PATH 로 바꾼다). `playwright install` 은 쓰지 않는다.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean);
  const errors = [];
  for (const name of tries) {
    try {
      return require(name);
    } catch (cause) {
      errors.push(`${name}: ${cause.code ?? cause.message}`);
    }
  }
  // NODE_PATH 가 없어도 전역 설치를 찾아 본다.
  for (const root of [process.env.NODE_PATH, '/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules'].filter(Boolean)) {
    try {
      return require(`${root.split(':')[0]}/playwright`);
    } catch {
      /* 다음 후보 */
    }
  }
  throw new Error(`playwright 를 찾지 못했다 (${errors.join('; ')}). NODE_PATH=$(npm root -g) 로 전역 설치를 가리키거나 PLAYWRIGHT_MODULE 을 지정한다. playwright install 은 쓰지 않는다.`);
}

export async function launchChromium() {
  const { chromium } = loadPlaywright();
  const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  return chromium.launch({ headless: true, executablePath });
}

const CSP_TEXT = /content security policy|refused to (execute|load|connect|apply|frame)/i;
const IGNORED_URL = /\/favicon\.ico(\?|$)/;

/**
 * 불러오기 점검의 재료 — 콘솔 오류·페이지 오류·실패한 요청·4xx/5xx 응답을 모든 프레임에서 모은다.
 * (plan §5.3 "불러오기: 콘솔 오류·페이지 오류·실패한 요청·4xx가 없다")
 */
export function watchProblems(page) {
  const problems = { console: [], pageErrors: [], requestFailed: [], badResponses: [] };
  page.on('console', (message) => {
    if (message.type() === 'error' || CSP_TEXT.test(message.text())) problems.console.push({ type: message.type(), text: message.text(), url: message.location().url });
  });
  page.on('pageerror', (error) => problems.pageErrors.push(String(error?.message ?? error)));
  page.on('requestfailed', (request) => {
    if (IGNORED_URL.test(request.url())) return;
    problems.requestFailed.push({ url: request.url(), error: request.failure()?.errorText });
  });
  page.on('response', (response) => {
    if (IGNORED_URL.test(response.url())) return;
    if (response.status() >= 400) problems.badResponses.push({ url: response.url(), status: response.status() });
  });
  return {
    ...problems,
    get cspViolations() {
      return problems.console.filter((c) => CSP_TEXT.test(c.text));
    },
    all() {
      return [
        ...problems.console.map((c) => `console.${c.type}: ${c.text}`),
        ...problems.pageErrors.map((e) => `pageerror: ${e}`),
        ...problems.requestFailed.map((r) => `requestfailed: ${r.url} (${r.error})`),
        ...problems.badResponses.map((r) => `HTTP ${r.status}: ${r.url}`),
      ];
    },
    clear() {
      for (const list of Object.values(problems)) list.length = 0;
    },
  };
}
