// 스크롤 묶음(§5.3 "스크롤", DC-23·GAP-4) — 긴 기록이 스크롤되고, 새 줄은 맨 아래에서 따라가며, 올려 읽는 중에는 읽던 자리를 지킨다.
// 원본: design/checks/demo-checks.mjs DC-23, scroll-follow.mjs. 긴 기록은 1200줄 시드(long-history) — 모듈은 500줄에서 끊으므로 앱이 after_seq 로 쪽을 넘겨 읽어야 한다(함정 8).

import { OP, agentApi, assert, mark, openApp, requestsOf, settle, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };
const nextFrame = (app) => app.f.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
const metrics = (app) => app.log.evaluate((el) => ({ top: Math.round(el.scrollTop), height: el.scrollHeight, client: el.clientHeight, fromBottom: Math.round(el.scrollHeight - el.clientHeight - el.scrollTop) }));
const newBar = (app) => app.$('[data-role="newbar"]');

async function openLong(t) {
  await t.control.seed({ scenario: 'long-history', session_id: 'long', owner: 'alice', entries: 1200 });
  const app = await openApp(t, { route: '#/s/long' });
  await app.pane.waitFor({ state: 'visible' });
  await app.$('[data-role="older"]').waitFor({ state: 'visible' });
  return app;
}

check('스크롤: 1200줄 기록은 500줄 쪽 셋으로 읽혀 마지막 200줄이 맨 아래에 서고, "이전 줄 더 보기"로 맨 처음 줄까지 빠짐·겹침 없이 닿는다', async (t) => {
  const before = await mark(t);
  const app = await openLong(t);
  // 이음새: 1200줄을 500 + 500 + 200 으로 읽었다 — after_seq 가 이어진다.
  const pages = (await requestsOf(t, OP.messagesList, before)).map((r) => new URL(r.path, 'http://x').searchParams.get('after_seq'));
  assert.ok(pages.includes('500') && pages.includes('1000'), `after_seq 500·1000 쪽을 읽지 않았다: ${pages}`);

  const m = await metrics(app);
  assert.ok(m.height > m.client, '긴 기록인데 스크롤 영역이 아니다');
  assert.ok(m.fromBottom <= 40, `처음 열면 맨 아래에서 시작해야 한다 (바닥에서 ${m.fromBottom}px)`);
  assert.equal(await app.log.getAttribute('role'), 'log');
  const seqs = (await app.lines()).map((l) => l.seq);
  assert.deepEqual([seqs[0], seqs.at(-1), seqs.length], [1001, 1200, 200]);
  assert.match((await app.$('[data-role="older"]').textContent()) ?? '', /이전 줄 1000개/);

  // 한 쪽을 위에 붙여도 읽던 줄이 화면에서 움직이지 않는다. (단추는 기록 맨 위에 있다 — 사용자가 맨 위까지 올려 눌렀을 때를 본다.)
  await app.log.evaluate((el) => {
    el.scrollTop = 0;
  });
  await nextFrame(app);
  await settle(app); // 들어오는 줄의 rise 애니메이션이 끝난 위치를 잰다(도중에는 최대 10px 어긋난다)
  const anchor = await app.log.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const line = [...el.querySelectorAll('.line[data-seq]')].find((l) => l.getBoundingClientRect().top >= box.top);
    return { seq: line.dataset.seq, y: Math.round(line.getBoundingClientRect().top - box.top) };
  });
  await app.$('[data-role="older"]').click();
  await until(async () => (await app.lines()).length === 400, { message: '이전 줄 200개가 붙지 않았다' });
  await settle(app);
  const after = await app.log.evaluate((el, seq) => {
    const box = el.getBoundingClientRect();
    return Math.round(el.querySelector(`.line[data-seq="${seq}"]`).getBoundingClientRect().top - box.top);
  }, anchor.seq);
  assert.ok(Math.abs(after - anchor.y) <= 2, `이전 줄을 붙였더니 읽던 줄이 ${anchor.y}px → ${after}px 로 밀렸다`);

  for (let i = 0; i < 4; i += 1) await app.$('[data-role="older"]').click();
  await until(async () => (await app.lines()).length === 1200, { message: '맨 처음 줄까지 닿지 않았다' });
  assert.equal(await app.$('[data-role="older"]').isVisible(), false);
  const all = (await app.lines()).map((l) => l.seq);
  assert.deepEqual(all, Array.from({ length: 1200 }, (_, i) => i + 1), '줄이 빠졌거나 겹쳤다');
  assert.deepEqual(app.problems.all(), []);
}, { ...UI, timeoutMs: 40_000 });

check('스크롤: 맨 아래에서는 새 줄을 따라가고, 올려 읽는 중에는 읽던 자리를 지키며 "새 글 n줄 · 맨 아래로"가 서고 누르면 바닥으로 간다', async (t) => {
  await t.control.pin('slow-model', 'long');
  const app = await openLong(t);
  const api = agentApi(t);
  const doneCount = async () => (await api.entries('long')).filter((e) => e.kind === 'done').length;
  const startDone = await doneCount();

  // ① 맨 아래: 보낸 글과 모델의 답이 와도 바닥에 붙어 있다.
  await app.type('따라가기');
  await until(async () => (await doneCount()) === startDone + 1, { message: '첫 차례가 끝나지 않았다' });
  await until(async () => (await app.lineKinds()).filter((k) => k === 'done').length > 0 && (await app.stateChip.textContent()) === '대기', { message: '화면이 차례 끝을 보이지 않는다' });
  await until(async () => (await app.lines()).some((l) => l.kind === 'assistant' && l.text.includes('오래 생각했습니다')), { message: '새 줄이 화면에 오르지 않았다' });
  await until(async () => (await metrics(app)).fromBottom <= 40, { message: `새 줄을 따라가지 못했다 (바닥에서 ${(await metrics(app)).fromBottom}px)` });
  assert.equal(await newBar(app).isVisible(), false);

  // ② 올려 읽는 중: 새 줄이 와도 scrollTop 을 건드리지 않는다.
  await app.log.evaluate((el) => {
    el.scrollTop = 400;
  });
  await nextFrame(app);
  const reading = await metrics(app);
  assert.ok(reading.fromBottom > 40);
  await app.type('올려 읽는 중');
  await until(async () => (await doneCount()) === startDone + 2, { message: '둘째 차례가 끝나지 않았다' });
  await until(async () => (await app.lines()).filter((l) => l.kind === 'done').length >= 2 && (await app.stateChip.textContent()) === '대기', { message: '화면이 둘째 차례 끝을 보이지 않는다' });
  await newBar(app).waitFor({ state: 'visible' });
  const kept = await metrics(app);
  assert.equal(kept.top, reading.top, `올려 읽는 중에 scrollTop 이 ${reading.top} → ${kept.top} 으로 움직였다`);
  assert.match((await newBar(app).textContent()) ?? '', /^새 글 \d+줄 · 맨 아래로$/);
  assert.ok(Number(/\d+/.exec(await newBar(app).textContent())[0]) >= 4, '새 줄 수를 세지 못했다');

  // ③ 누르면 바닥으로 가고 막대는 사라진다.
  await newBar(app).click();
  await until(async () => (await metrics(app)).fromBottom <= 40, { message: '"맨 아래로"가 바닥으로 데려가지 않았다' });
  await newBar(app).waitFor({ state: 'hidden' });
  assert.deepEqual(app.problems.all(), []);
}, { ...UI, timeoutMs: 40_000 });
