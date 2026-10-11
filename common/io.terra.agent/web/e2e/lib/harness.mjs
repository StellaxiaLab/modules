// 아주 작은 e2e 하네스 — @playwright/test 없이 playwright 라이브러리만 쓴다(의존을 늘리지 않는다).
//
//   import { check, until, openShell } from '../lib/harness.mjs';
//   check('이름', async (t) => { const { page, problems } = await openShell(t, { principal: 'alice' }); … });
//
// check 는 파일을 불러올 때 등록되고, run.mjs 가 차례로 돌린다. 각 점검은 새 브라우저 컨텍스트와 초기화된 서버(프리셋 ready)에서 시작한다.

import assert from 'node:assert/strict';
import { watchProblems } from './browser.mjs';

export { assert };

export const registry = [];

/** @param {{apps?: string[], preset?: string, timeoutMs?: number}} [options]  apps: 이 점검이 의미 있는 앱('probe'|'ui'). 기본 둘 다. */
export function check(name, fn, options = {}) {
  registry.push({ name, fn, apps: options.apps ?? ['probe', 'ui'], preset: options.preset ?? 'ready', timeoutMs: options.timeoutMs ?? 30_000 });
}

export async function until(fn, { timeout = 10_000, interval = 50, message = '조건이 서지 않았다' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (cause) {
      last = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`${message} (${timeout}ms) — 마지막 값: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

/**
 * 셸 호스트를 열고 앱이 올라올 때까지 기다린다.
 * @param t     점검 컨텍스트({stack, newPage})
 * @param params shell-host.mjs 의 질의(principal·permissions·app·login·hello …)
 * @param opts.wait  앱 프레임에서 기다릴 선택자(기본: 기다리지 않고 프레임만)
 */
export async function openShell(t, params = {}, { wait } = {}) {
  const page = await t.newPage();
  const problems = watchProblems(page);
  await page.goto(t.stack.shellUrl(params));
  await page.waitForFunction(() => window.__shell?.ready === true);
  const frameHandle = await page.waitForSelector('#app-frame');
  const frame = await frameHandle.contentFrame();
  if (wait) await frame.waitForSelector(wait, { state: 'attached', timeout: 10_000 });
  const shell = {
    page,
    frame,
    problems,
    log: () => page.evaluate(() => window.__shell.log),
    /** 앱 프레임 안에서 브리지로 호출한다(probe 앱 전용). 응답 메시지 {ok,status,data|error} 를 돌려준다. */
    call: (method, path, body) => frame.evaluate(([m, p, b]) => window.probe.call(m, p, b), [method, path, body]),
  };
  return shell;
}

export const MODULE = '/api/modules/io.terra.agent/v1';
