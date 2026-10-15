// 호출 줄의 접힌 상세(M-5) — 입력 요약 · 결과 요약 · 결과 방식(output.mode), 그리고 "접수 ≠ 완료"(DC-18).
// 시나리오 `call-details` 를 auto 세션에 못 박고 앱으로 본다. 켜지 않은 호출(이전 모듈의 모양)은 새 칸이 숨는다.
//
// 지키는 약속: 화면은 서버가 준 사실만 그린다 · 비밀로 이름 붙은 값은 다시 드러나지 않는다(I1) · 모델이 쓴 글은 글자로만(I7).

import { agentApi, assert, openApp, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };
const SECRET = 'sk-test-SECRET-1234567890';
const INPUT = '입력 (비밀로 이름 붙은 값은 가려짐)';

/** 접힌 상세의 라벨 → 값. */
async function rowsOf(line) {
  return line.locator('details.ev-detail').evaluate((el) => Object.fromEntries([...el.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? ''])));
}

async function openDetails(t, { id, simulate = false }) {
  const api = agentApi(t);
  await api.open({ id, autonomy: 'auto', scenario: 'call-details', ...(simulate ? { simulate: true } : {}) });
  const app = await openApp(t, { route: `#/s/${id}` });
  await app.pane.waitFor({ state: 'visible' });
  await app.type('세 가지를 확인해 줘');
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  return { api, app };
}

check('접수 ≠ 완료: accepted-job 호출은 줄에서 ok 가 아니라 accepted-job 칩과 "접수 ≠ 완료"로 선다 — 즉시(immediate) 호출은 ok 그대로', async (t) => {
  const { app } = await openDetails(t, { id: 'cd-accepted' });
  const calls = app.$('.line[data-kind="call"]');
  assert.equal(await calls.count(), 3);

  const accepted = calls.nth(0).locator('.ev.call');
  assert.equal(await accepted.getAttribute('data-status'), 'ok', '서버가 준 status 는 그대로여야 한다');
  assert.equal(await accepted.locator('.chip.info').textContent(), 'accepted-job');
  assert.match((await accepted.textContent()) ?? '', /접수 ≠ 완료/);
  assert.equal(await accepted.locator('.chip.ok').count(), 0, '접수된 호출이 ok 칩으로 끝난 것처럼 읽힌다');

  const immediate = calls.nth(1).locator('.ev.call');
  assert.equal(await immediate.locator('.chip.ok').textContent(), 'ok');
  assert.equal(await immediate.locator('.chip.info').count(), 0);
  assert.doesNotMatch((await immediate.textContent()) ?? '', /접수/);

  // 결과 방식을 모르는 이전 모양의 호출은 지금까지처럼 ok 이고 접수라고 말하지 않는다.
  const legacy = calls.nth(2).locator('.ev.call');
  assert.equal(await legacy.locator('.chip.ok').textContent(), 'ok');
  assert.equal(await legacy.locator('.chip.info').count(), 0);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('접힌 상세: 입력 요약 · 결과 요약 · 결과 방식이 접혀 있다가 펼치면 보이고, 비밀로 이름 붙은 값은 가려진 채다(I1)', async (t) => {
  const { app } = await openDetails(t, { id: 'cd-rows' });
  const first = app.$('.line[data-kind="call"]').nth(0);
  const detail = first.locator('details.ev-detail');
  assert.equal(await detail.evaluate((el) => el.open), false, '상세가 처음부터 펼쳐져 있다');

  await detail.locator('summary').click();
  const rows = await rowsOf(first);
  assert.equal(rows['결과 방식'], 'accepted-job — 접수이지 완료가 아닙니다');
  assert.equal(rows[INPUT], '{"api_key":"***","node":"tree-home"}');
  assert.match(rows['결과 요약'], /"job_id":"job-0002"/);
  assert.match(rows['모델이 말한 이유 (주장이며 근거가 아닙니다)'], /부하가 치우쳐/);

  // 비밀은 화면 어디에도, DOM 속성에도 없다.
  assert.equal((await app.f.locator('body').innerHTML()).includes(SECRET), false, '가려진 비밀이 화면에 다시 나왔다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('이전 모듈 호환: 새 칸이 없는 호출은 그 칸의 라벨도 빈 줄도 없다 — 판정·이유 등 있던 칸만 남는다', async (t) => {
  const { app } = await openDetails(t, { id: 'cd-legacy' });
  const legacy = app.$('.line[data-kind="call"]').nth(2);
  await legacy.locator('details.ev-detail summary').click();
  const rows = await rowsOf(legacy);
  for (const label of ['결과 방식', INPUT, '결과 요약']) assert.equal(label in rows, false, `칸이 없는데 '${label}' 가 그려졌다`);
  assert.ok('판정' in rows && 'trace id' in rows, `있던 칸이 사라졌다: ${Object.keys(rows)}`);
  assert.equal(await legacy.locator('details.ev-detail dd:empty').count(), 0, '빈 값 칸이 그려졌다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('시뮬레이션: planned 줄은 입력과 결과 방식을 보이되 결과 요약이 없고, 접수 칩도 달지 않는다 — 실행되지 않았다(I13)', async (t) => {
  const { app } = await openDetails(t, { id: 'cd-planned', simulate: true });
  const planned = app.$('.line[data-kind="planned"]');
  assert.equal(await planned.count(), 3);
  const first = planned.nth(0);
  assert.match((await first.locator('.ev.plan').textContent()) ?? '', /실행되지 않았습니다/);
  assert.equal(await first.locator('.chip.info').count(), 0, '실행하지 않은 호출에 접수 칩이 달렸다');
  await first.locator('details.ev-detail summary').click();
  const rows = await rowsOf(first);
  assert.equal(rows[INPUT], '{"api_key":"***","node":"tree-home"}');
  assert.equal(rows['결과 방식'], 'accepted-job — 접수이지 완료가 아닙니다');
  assert.equal('결과 요약' in rows, false, '실행하지 않았는데 결과 요약이 있다');
  assert.equal((await app.f.locator('body').innerHTML()).includes(SECRET), false);
  assert.deepEqual(app.problems.all(), []);
}, UI);
