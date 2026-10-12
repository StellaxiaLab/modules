// 글꼴 점검 — 앱에 실은 Pretendard·Inter(결정 D-11)가 실제 Chromium 에서 font-src 'self' 로 로드되는지 본다.
// 앱 자산 CSP 는 외부 origin 을 막는다. 글꼴이 안 실렸거나 CSP 에 걸리면 'loaded' 가 서지 않고 콘솔 오류가 난다.

import { agentApi, openApp } from '../lib/app.mjs';
import { assert, check, until } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };

check('글꼴: 한글 화면을 그리면 Pretendard 조각이 로드되고(필요한 조각만) 실패·CSP 위반이 없다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'font-1', scenario: 'read-only-answer', topic: '글꼴 확인 세션' });
  const app = await openApp(t, {});
  await until(async () => (await app.$('a.sess .sess-title').allTextContents()).includes('글꼴 확인 세션'), { message: '세션이 목록에 서지 않았다' });

  const state = () =>
    app.f.evaluate(async () => {
      await document.fonts.ready;
      const faces = [...document.fonts];
      return {
        families: [...new Set(faces.map((f) => f.family.replace(/"/g, '')))].sort(),
        total: faces.length,
        loaded: faces.filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
        errored: faces.filter((f) => f.status === 'error').length,
        bodyFont: getComputedStyle(document.body).fontFamily,
        koreanOk: document.fonts.check('16px "Pretendard Variable"', '한글'),
      };
    });
  await until(async () => (await state()).loaded.includes('Pretendard Variable'), { message: 'Pretendard Variable 이 로드되지 않았다(document.fonts)' });
  const s = await state();
  assert.deepEqual(s.families, ['Inter', 'Pretendard Variable']);
  assert.ok(s.total > 90, `@font-face 가 ${s.total}개 — Pretendard dynamic subset 92 + Inter 2 가 선언돼야 한다`);
  assert.ok(s.loaded.length >= 1 && s.loaded.length < 20, `화면에 나온 글자의 조각만 로드돼야 한다 — 로드 ${s.loaded.length}/${s.total}`);
  const bytes = await app.f.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((r) => r.name.includes('/fonts/'))
      .map((r) => ({ name: r.name.split('/').pop(), size: r.encodedBodySize })),
  );
  const total = bytes.reduce((n, b) => n + b.size, 0);
  console.log(`    글꼴 ${bytes.length}개 ${total} 바이트 로드: ${bytes.map((b) => `${b.name}=${b.size}`).join(' ')}`);
  assert.equal(bytes.length, s.loaded.length, '로드된 조각 수와 글꼴 요청 수가 같아야 한다');
  assert.ok(total < 500_000, `첫 화면의 글꼴이 500KB 를 넘는다: ${total}`);
  assert.equal(s.errored, 0, '로드에 실패한 글꼴 조각이 있다');
  assert.match(s.bodyFont, /^"?Pretendard Variable"?/, '본문 글꼴 스택 맨 앞이 Pretendard Variable 이어야 한다');
  assert.equal(s.koreanOk, true);
  assert.deepEqual(app.problems.all(), [], '콘솔 오류·실패한 요청·4xx 가 없어야 한다');
  assert.deepEqual(app.problems.cspViolations, []);
}, UI);
