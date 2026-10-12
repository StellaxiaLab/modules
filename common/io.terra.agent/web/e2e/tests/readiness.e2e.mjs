// 시연에 없던 점검(TODO-checks.md 둘째 표) 가운데 지금 화면이 받쳐 주는 것 — 준비 상태(위임 관문 포함)와 응답 유실.
// 35개 이식 목록에는 들지 않는다. 가짜 환경이 이미 받쳐 주던 약속을 앱이 지키는지 본다.

import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };
const newSession = (app) => app.$('[data-role="new-session"]');

check('준비 상태: agent.use 가 없는 계정은 "준비 안 됨"이고 세션·기록을 부르지 않는다 — 준비 단계의 읽기(models·credentials)만 403 으로 막힌다 (함정 10, GAP-2)', async (t) => {
  const app = await openApp(t, { principal: 'noperm' });
  await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비 안 됨'), { message: '준비 안 됨이 서지 않았다' });
  assert.match((await app.$('[data-role="readiness-guide"] .guide-headline').textContent()) ?? '', /agent\.use 권한이 없습니다/);
  assert.equal(await newSession(app).getAttribute('aria-disabled'), 'true');
  const calls = await t.control.requests('');
  const denied = calls.filter((r) => r.status === 403).map((r) => r.op).sort();
  assert.deepEqual(denied, ['io.terra.agent.credentials.get', 'io.terra.agent.models.list'], '403 은 준비 단계의 읽기 둘뿐이어야 한다');
  const ops = new Set(calls.map((r) => r.op));
  for (const forbidden of [OP.sessionsList, OP.sessionsGet, OP.sessionsPost, OP.messagesList, OP.messagesPost]) assert.ok(!ops.has(forbidden), `권한 없는 계정이 ${forbidden} 를 불렀다`);
  // 일부러 만든 403 은 브라우저가 4xx 로 기록한다 — 그것 말고는 아무 문제도 없다.
  assert.deepEqual(app.problems.all().filter((p) => !p.startsWith('HTTP 403:') && !/Failed to load resource.*403/.test(p)), []);
}, UI);

for (const [preset, expected, proposal] of [
  ['empty', /기본 모델이 없습니다|위임 자격이 아직 맡겨져 있지 않습니다/, null],
  ['no-model', /기본 모델이 없습니다/, false],
  ['no-credential', /위임 자격이 아직 맡겨져 있지 않습니다/, true],
  ['expired-credential', /만료되었습니다/, true],
]) {
  check(`준비 상태: 프리셋 ${preset} — 막힌 단계를 말하고 새 세션이 꺼진다${proposal ? ' ("제안 · 아직 없음" 표지)' : ''}`, async (t) => {
    const app = await openApp(t, {});
    await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비 안 됨'), { message: '준비 안 됨이 서지 않았다' });
    assert.match((await app.$('[data-role="readiness-guide"] .steps').textContent()) ?? '', expected);
    assert.equal(await newSession(app).getAttribute('aria-disabled'), 'true');
    if (proposal !== null) assert.equal(await app.$('[data-role="readiness-guide"] .proposal').isVisible(), proposal, '"제안 · 아직 없음" 안내의 보임이 다르다');
    assert.deepEqual(app.problems.all(), []);
  }, { ...UI, preset });
}

check('응답 유실(I17): 보냈는데 응답을 잃으면 앱은 다시 보내지 않고 기록을 읽어 확인하게 한다 — 서버에는 글이 한 번만 쌓인다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'lost' });
  const app = await openApp(t, { route: '#/s/lost' });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 열리지 않았다' });
  await t.control.inject({ op: OP.messagesPost }, { drop: 'after' });
  const before = await mark(t);
  await app.type('이 응답은 유실된다');
  const notice = app.$('[data-role="composer-notice"]');
  await until(async () => (await notice.isVisible()) && /다시 보내 주세요/.test((await notice.textContent()) ?? ''), { message: '유실 안내가 서지 않았다' });
  // 글은 서버에 한 번 쌓였고, 앱은 기록을 읽어 그것을 화면에 올린다.
  await until(async () => (await app.lineKinds()).includes('user'), { message: '기록을 읽어 보낸 글을 보이지 않았다' });
  assert.equal((await requestsOf(t, OP.messagesPost, before)).length, 1, '유실된 글을 앱이 다시 보냈다');
  assert.equal((await api.entries('lost')).filter((e) => e.kind === 'user').length, 1);
  assert.equal(await notice.getAttribute('role'), 'status');
}, UI);

check('준비 상태: 위임 관문이 없는 노드(delegate_door:false)는 "위임 관문" 단계만 막히고 — 나머지는 통과한 채 — 새 세션이 꺼진다. 세션 목록은 그대로 읽는다 (요구 §6.2)', async (t) => {
  await agentApi(t).open({ id: 'door-old', autonomy: 'ask' });
  await t.control.config({ door: false });
  assert.equal((await t.control.state()).door, false);
  const app = await openApp(t, {});
  await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비 안 됨'), { message: '준비 안 됨이 서지 않았다' });
  const steps = app.$('[data-role="readiness-guide"] .step');
  assert.equal(await steps.count(), 6);
  // 순서: 모듈 · 권한 · 위임 관문 · 모델 · 위임 자격 · 만료. 막힌 것은 관문 하나다.
  assert.deepEqual(await steps.evaluateAll((els) => els.map((el) => el.className)), ['step ok', 'step ok', 'step bad', 'step ok', 'step ok', 'step ok']);
  assert.match((await app.$('[data-role="readiness-guide"] .guide-headline').textContent()) ?? '', /위임 관문/);
  assert.match((await steps.nth(2).locator('.st-detail').textContent()) ?? '', /읽기만 할 수 있고 새 세션은 열 수 없습니다/);
  assert.equal(await newSession(app).getAttribute('aria-disabled'), 'true');
  assert.equal(await app.$('[data-role="readiness-guide"] .proposal').isVisible(), false, '관문이 없는 것을 "자격을 맡기면 된다"는 제안으로 말했다 — 자격 문제가 아니다');
  // 읽기는 된다: 이미 있던 세션이 목록에 서고 열린다.
  await until(async () => (await app.$('a.sess').count()) === 1, { message: '관문이 없어도 읽을 수 있는 세션 목록이 서지 않았다' });
  await app.goto('door-old');
  await app.waitChip('대기');
  assert.deepEqual(app.problems.all(), []);
}, UI);
