// 대화 화면의 상태 묶음 — 취소 · 자율성 · 시간 초과(카드 밖의 몫) · 인박스 · 종료 세션 · 규칙 I20 · 차례 줄.
// 원본: design/checks/demo-checks.mjs 의 "Live:" 점검들. 승인 카드가 있어야 하는 점검은 approvals.e2e.mjs 에 있다.
// 시계는 `control.advance(초)` 로 감는다. 기다림은 `until()` 이다.

import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };
const kinds = (entries) => entries.map((e) => e.kind);

// ───────── 취소 ─────────

check('취소: 실행 중 취소 — 확인창이 서고 "그대로 두기"는 아무것도 부르지 않으며, 취소하면 cancelled · 입력 잠김 · 취소 뒤 20초 동안 줄이 늘지 않는다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'c-run', scenario: 'cancel-mid-turn' });
  const app = await openApp(t, { route: '#/s/c-run' });
  await app.pane.waitFor({ state: 'visible' });
  await app.type('오래 걸리는 일');
  await app.waitChip('진행 중');
  assert.equal(await app.textarea.isDisabled(), true, '진행 중인데 입력이 열려 있다');
  assert.equal(await app.cancel.isVisible(), true);

  // 취소 단추 → 확인창(role=dialog). 초점은 안전한 쪽("그대로 두기").
  const before = await mark(t);
  await app.cancel.click();
  await app.dialog.waitFor({ state: 'visible' });
  assert.equal(await app.dialog.getAttribute('aria-modal'), 'true');
  assert.equal(await app.f.evaluate(() => document.activeElement?.getAttribute('data-role')), 'cancel-keep', '확인창의 초점이 "그대로 두기"가 아니다');
  await app.$('[data-role="cancel-keep"]').click();
  await app.dialog.waitFor({ state: 'hidden' });
  assert.equal(await app.f.evaluate(() => document.activeElement?.getAttribute('data-role')), 'cancel', '닫으면 초점이 연 단추로 돌아가야 한다');
  assert.equal((await requestsOf(t, OP.sessionsCancel, before)).length, 0, '"그대로 두기"가 취소를 불렀다');
  assert.equal((await api.session('c-run')).state, 'running');

  // Esc 도 그대로 두기다. 이어서 정말 취소한다.
  await app.cancel.click();
  await app.dialog.waitFor({ state: 'visible' });
  await app.page.keyboard.press('Escape');
  await app.dialog.waitFor({ state: 'hidden' });
  assert.equal((await requestsOf(t, OP.sessionsCancel, before)).length, 0, 'Esc 가 취소를 불렀다');

  await app.cancel.click();
  await app.$('[data-role="cancel-confirm"]').click();
  await app.waitChip('취소됨');
  assert.equal(await app.cancel.isVisible(), false, '종료 상태에 취소 단추가 남아 있다');
  assert.equal(await app.textarea.isDisabled(), true);
  assert.match((await app.textarea.getAttribute('placeholder')) ?? '', /새 세션/);
  assert.equal((await requestsOf(t, OP.sessionsCancel, before)).length, 1, 'sessions.cancel 이 정확히 한 번이 아니다');

  // 취소 뒤 20초: 시계를 감고, 앱이 그 사이 한 번 더 읽은 뒤에도 줄이 그대로여야 한다.
  const settled = await api.entries('c-run');
  assert.equal(settled.filter((e) => e.kind === 'cancelled').length, 1);
  const domBefore = await app.lines();
  const mid = await mark(t);
  await t.control.advance(20);
  await until(async () => (await t.control.requests(`?since=${mid}`)).some((r) => r.op === OP.sessionsGet || r.op === OP.sessionsList), { timeout: 15_000, message: '20초 뒤 앱이 서버를 다시 읽지 않았다' });
  assert.deepEqual(kinds(await api.entries('c-run')), kinds(settled), '취소 뒤 서버 기록에 줄이 늘었다');
  assert.deepEqual((await app.lines()).map((l) => l.seq), domBefore.map((l) => l.seq), '취소 뒤 화면에 줄이 늘었다');
  assert.deepEqual(app.problems.all(), []);
}, { ...UI, timeoutMs: 40_000 });

check('취소: 확인창은 Tab 이 창 안에서만 돈다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'c-tab', scenario: 'cancel-mid-turn' });
  const app = await openApp(t, { route: '#/s/c-tab' });
  await app.type('멈출 일');
  await app.waitChip('진행 중');
  await app.cancel.click();
  await app.dialog.waitFor({ state: 'visible' });
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    await app.page.keyboard.press('Tab');
    seen.push(await app.f.evaluate(() => document.activeElement?.getAttribute('data-role')));
  }
  assert.ok(seen.every((r) => r === 'cancel-keep' || r === 'cancel-confirm'), `Tab 이 창 밖으로 나갔다: ${seen}`);
  await app.page.keyboard.press('Escape');
  await app.dialog.waitFor({ state: 'hidden' });
}, UI);

// ───────── 자율성 ─────────

check('자율성: plan 새 세션 — 화면에서 열고, 모델의 호출은 "제안 · 실행 안 됨"으로만 남고 Gateway 에 닿지 않는다. ask·auto·unattended 는 아직 꺼져 있다', async (t) => {
  await t.control.scenario('propose-call');
  const app = await openApp(t, {});
  await app.$('[data-role="new-session"]').waitFor({ state: 'visible' });
  await until(async () => (await app.$('[data-role="new-session"]').getAttribute('aria-disabled')) === 'false', { message: '새 세션이 켜지지 않았다(준비 상태)' });
  await app.$('[data-role="new-session"]').click();
  await app.$('[data-role="new-session-pane"]').waitFor({ state: 'visible' });
  const radios = await app.$('input[name="autonomy"]').evaluateAll((els) => els.map((el) => ({ value: el.value, disabled: el.disabled, checked: el.checked })));
  assert.deepEqual(radios, [
    { value: 'plan', disabled: false, checked: true },
    { value: 'ask', disabled: true, checked: false },
    { value: 'auto', disabled: true, checked: false },
    { value: 'unattended', disabled: true, checked: false },
  ]);
  await app.$('[data-role="open-session"]').click();
  await app.pane.waitFor({ state: 'visible' });
  const id = await app.f.evaluate(() => decodeURIComponent(location.hash.replace(/^#\/s\//, '')));
  assert.ok(id.length > 0);
  await until(async () => /plan/.test((await app.$('[data-role="autonomy-chip"]').textContent()) ?? ''), { message: '머리의 자율성 칩이 plan 이 아니다' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 열리지 않았다' });
  await app.type('chat 모듈을 다시 시작해 줘');
  await app.waitChip('진행 중');
  await app.waitChip('대기');
  const call = app.$('.line[data-kind="call"] .ev.call');
  await call.waitFor({ state: 'visible' });
  assert.equal(await call.getAttribute('data-status'), 'refused');
  assert.match((await call.textContent()) ?? '', /제안 · 실행 안 됨/);
  assert.equal(await app.$('[data-card-state="pending"]').count(), 0, 'plan 에서 승인 질문이 섰다');
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 0, 'plan 의 제안이 Gateway 에 닿았다');
  assert.equal((await agentApi(t).session(id)).autonomy, 'plan');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('자율성: unattended — 묻지 않고 거절한다(TERRA_APPROVAL_REQUIRED). 사전 승인 밖 쓰기는 거절 줄, 승인 질문도 인박스도 없다', async (t) => {
  await t.control.reset('unattended-credential');
  const api = agentApi(t);
  await api.open({ id: 'u-refuse', autonomy: 'unattended', scenario: 'unattended-refuse' });
  const app = await openApp(t, { route: '#/s/u-refuse' });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => /unattended/.test((await app.$('[data-role="autonomy-chip"]').textContent()) ?? ''), { message: '머리의 자율성 칩이 unattended 가 아니다' });
  await app.type('파일을 쓰고 다시 시작해 줘');
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  await app.waitChip('대기');
  const refused = app.$('.line[data-kind="call"] .ev.call[data-status="refused"]');
  assert.equal(await refused.count(), 1);
  assert.match((await refused.textContent()) ?? '', /TERRA_APPROVAL_REQUIRED/);
  assert.equal(await app.$('.line[data-kind="approval"]').count(), 0, '무인 세션에 승인 질문이 섰다');
  assert.equal(await app.$('[data-role="pending-chip"]').isVisible(), false);
  assert.equal(await app.$('[data-role="inbox"]').isVisible(), false);
  // 사전 승인된 restart 는 묻지 않고 돈다 — 호출 둘 중 하나만 Gateway 에 닿았다.
  const reached = (await t.control.calls()).filter((c) => c.reached);
  assert.equal(reached.length, 1);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('자율성: auto — 되돌릴 수 있는 쓰기는 묻지 않고 돌고 접수(accepted-job)로 남는다 (위험한 호출을 묻는 카드는 approvals.e2e.mjs)', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'a-auto', autonomy: 'auto', scenario: 'accepted-job' });
  const app = await openApp(t, { route: '#/s/a-auto' });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => /auto/.test((await app.$('[data-role="autonomy-chip"]').textContent()) ?? ''), { message: '머리의 자율성 칩이 auto 가 아니다' });
  await app.type('노드를 다시 균형 맞춰 줘');
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  const call = app.$('.line[data-kind="call"] .ev.call');
  assert.equal(await call.getAttribute('data-status'), 'ok');
  assert.equal(await app.$('.line[data-kind="approval"]').count(), 0, 'auto 의 쓰기를 물었다');
  const reached = (await t.control.calls()).filter((c) => c.reached);
  assert.equal(reached.length, 1);
  const answer = await app.$('.line[data-kind="assistant"] .body').last().textContent();
  assert.match(answer ?? '', /접수/);
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── 시간 초과 (카드 밖의 몫) ─────────

check('시간 초과(카드 밖의 몫): 무응답으로 시간이 끝나면 idle · TIME_LIMIT 한 줄 · denied 줄 없음 · 입력 복귀 (카드 "시간 초과" 표시는 approvals.e2e.mjs)', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 't-time', autonomy: 'ask', scenario: 'approval-timeout', max_seconds: 300 });
  const app = await openApp(t, { route: '#/s/t-time' });
  await app.pane.waitFor({ state: 'visible' });
  assert.equal((await api.session('t-time')).state, 'idle');
  await app.type('chat 모듈을 다시 시작해 줘');
  await app.waitChip('승인 대기');
  assert.equal(await app.textarea.isDisabled(), true, '승인 대기인데 입력이 열려 있다');
  await t.control.advance(301);
  await app.waitChip('대기');
  await until(async () => !(await app.textarea.isDisabled()), { message: '시간이 끝났는데 입력이 돌아오지 않았다' });
  assert.equal((await app.lastError.textContent()).trim(), 'TIME_LIMIT');
  await until(async () => (await app.lineKinds()).includes('error'), { message: 'TIME_LIMIT 오류 줄이 오르지 않았다' });
  const lines = await app.lines();
  assert.equal(lines.filter((l) => l.kind === 'denied').length, 0, '시간 초과에 denied 줄이 생겼다');
  assert.equal(lines.filter((l) => l.kind === 'error').length, 1);
  assert.equal((await api.session('t-time')).pending_approvals.length, 0);
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 0);
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── 인박스 ─────────

check('인박스: 다른 세션의 대기 승인이 인박스와 머리 칩에 뜨고, 누르면 그 세션이 열린다. 남의 세션은 섞이지 않는다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'ib-a', autonomy: 'ask', scenario: 'approval-flow', topic: '첫째 세션' });
  await api.open({ id: 'ib-b', autonomy: 'ask', scenario: 'approval-flow', topic: '둘째 세션' });
  const bob = agentApi(t, 'bob');
  await bob.open({ id: 'ib-bob', autonomy: 'ask', scenario: 'approval-flow', topic: '밥의 세션' });
  await api.say('ib-b', '다시 시작해 줘');
  await bob.say('ib-bob', '다시 시작해 줘');
  await api.waitState('ib-b', 'waiting-approval');
  await bob.waitState('ib-bob', 'waiting-approval');

  const app = await openApp(t, { route: '#/s/ib-a' });
  await app.pane.waitFor({ state: 'visible' });
  const inbox = app.$('[data-role="inbox"]');
  await inbox.waitFor({ state: 'visible' });
  const items = app.$('[data-role="inbox"] .inbox-item');
  assert.equal(await items.count(), 1, '인박스는 내 다른 세션의 것 하나여야 한다(밥의 것이 섞였거나 빠졌다)');
  assert.match((await items.first().textContent()) ?? '', /둘째 세션/);
  assert.match((await items.first().textContent()) ?? '', /승인이 필요합니다/);
  assert.equal((await app.$('[data-role="pending-chip"]').textContent()).trim(), '승인 대기 1');
  assert.equal(await app.$('a.sess').filter({ hasText: '밥의 세션' }).count(), 0, '남의 세션이 목록에 보인다');

  await items.first().click();
  await until(async () => (await app.f.evaluate(() => location.hash)) === '#/s/ib-b', { message: '인박스를 눌러도 그 세션이 열리지 않았다' });
  await app.waitChip('승인 대기');
  // 열어 둔 세션의 것은 인박스에서 빠진다(대화 안에 있다).
  await until(async () => (await app.$('[data-role="inbox"]').isVisible()) === false, { message: '열어 둔 세션이 인박스에 남아 있다' });
  assert.equal((await app.$('[data-role="pending-chip"]').textContent()).trim(), '승인 대기 1');
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── 종료 세션 ─────────

check('종료 세션: failed 는 읽기 전용 — 입력 잠김 · 취소 숨김 · "새 세션" 안내 · 종료됨 탭에 선다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'e-fail', scenario: 'model-failure' });
  await api.say('e-fail', '모델이 죽는다');
  await api.waitState('e-fail', 'failed');
  const app = await openApp(t, { route: '#/s/e-fail' });
  await app.pane.waitFor({ state: 'visible' });
  await app.waitChip('실패');
  assert.equal(await app.textarea.isDisabled(), true);
  assert.equal(await app.send.isDisabled(), true);
  assert.equal(await app.cancel.isVisible(), false);
  assert.match((await app.$('#composer-foot').textContent()) ?? '', /새 세션/);
  assert.equal((await app.lastError.textContent()).trim(), 'MODEL_UNAVAILABLE');
  // 종료됨 탭에 있고 "내 세션"에는 없다.
  assert.equal(await app.$('[role="tab"][aria-selected="true"]').getAttribute('id'), 'tab-ended');
  assert.equal(await app.$('a.sess[aria-current="page"]').count(), 1);
  // 끝난 세션에 억지로 보내도 서버로 가지 않는다.
  const before = await mark(t);
  await app.textarea.evaluate((el) => {
    el.disabled = false;
    el.value = '그래도 보낸다';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await app.textarea.press('Enter');
  await app.f.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  assert.equal((await requestsOf(t, OP.messagesPost, before)).length, 0, '실패한 세션에 글이 나갔다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('종료 세션: archived(모듈 재시작) 와 done(runs) 도 종료됨이다 — idle 이던 세션도 archived 가 된다(함정 4)', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'e-idle' });
  await api.open({ id: 'e-wait', autonomy: 'ask', scenario: 'module-restart' });
  await api.say('e-wait', '다시 시작해 줘');
  await api.waitState('e-wait', 'waiting-approval');
  // runs.post 는 세션 id 를 모듈이 정한다(요청의 session_id 는 무시된다) — 한 번 실행은 끝나서 done 이다.
  const run = await api.call('POST', '/runs', { prompt: '한 번 실행' });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  const runId = run.data.session_id;
  await api.waitState(runId, 'done');
  await t.control.restartModule();
  assert.equal((await api.session('e-idle')).state, 'archived');
  assert.equal((await api.session('e-wait')).state, 'archived');
  assert.equal((await api.session(runId)).state, 'done', 'done 은 재시작해도 done 이다');

  const app = await openApp(t, { route: '#/s/e-idle' });
  await app.pane.waitFor({ state: 'visible' });
  await app.waitChip('보관됨');
  assert.equal(await app.textarea.isDisabled(), true);
  assert.equal(await app.cancel.isVisible(), false);
  await until(async () => (await app.$('a.sess').count()) === 3, { message: '종료된 세션 셋이 목록에 서지 않았다' });
  assert.match((await app.$('#tab-ended').textContent()) ?? '', /3/);
  assert.equal(await app.$('#tab-mine').textContent(), '내 세션');
  await app.goto(runId);
  await app.waitChip('끝남');
  assert.equal(await app.textarea.isDisabled(), true);
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── 규칙 I20 ─────────

for (const [scenario, code, open] of [
  ['step-limit', 'STEP_LIMIT', { max_steps: 3 }],
  ['token-budget', 'TOKEN_BUDGET', { token_budget: 10_000 }],
  ['model-refusal', 'MODEL_REFUSED', {}],
  ['model-truncated', 'MODEL_TRUNCATED', {}],
]) {
  check(`규칙 I20: ${code} 로 멈춘 세션은 idle 이고(failed 가 아니다) 마지막 오류 코드가 상태 옆과 목록에 보인다`, async (t) => {
    const api = agentApi(t);
    const id = `i20-${scenario}`;
    await api.open({ id, scenario, ...open });
    const app = await openApp(t, { route: `#/s/${id}` });
    await app.pane.waitFor({ state: 'visible' });
    await app.type('끝까지 해 줘');
    await until(async () => (await app.lineKinds()).includes('error'), { message: `${code} 오류 줄이 오르지 않았다` });
    await app.waitChip('대기');
    assert.equal((await app.lastError.textContent()).trim(), code);
    assert.equal(await app.lastError.isVisible(), true);
    assert.equal((await api.session(id)).state, 'idle');
    assert.equal(await app.textarea.isDisabled(), false, '한도로 멈춘 세션은 이어 쓸 수 있다');
    assert.equal((await app.$('a.sess[aria-current="page"] .sess-err').textContent()).trim(), code, '목록 행에 마지막 오류 코드가 없다');
    // 오류 줄은 사전 문구 + 코드 칩이다 — 영어 원문은 접힌 상세에 있다.
    assert.ok((await app.$('.line[data-kind="error"] .chip.err').first().textContent()).includes(code));
    assert.deepEqual(app.problems.all(), []);
  }, UI);
}

check('규칙 I20: 새 모듈 필드(last_error_code)가 없어도 기록의 error 줄에서 코드를 읽는다 — 영어 문장에서 추측하지 않는다', async (t) => {
  await t.control.features({ lastErrorCode: false });
  const api = agentApi(t);
  await api.open({ id: 'i20-old', scenario: 'step-limit', max_steps: 3 });
  const app = await openApp(t, { route: '#/s/i20-old' });
  await app.pane.waitFor({ state: 'visible' });
  await app.type('끝까지 해 줘');
  await until(async () => (await app.lineKinds()).includes('error'), { message: '오류 줄이 오르지 않았다' });
  await app.waitChip('대기');
  assert.equal((await api.session('i20-old')).last_error_code, undefined, '가짜 서버가 last_error_code 를 뺐어야 한다');
  await until(async () => (await app.lastError.isVisible()) && (await app.lastError.textContent()).trim() === 'STEP_LIMIT', { message: '기록의 error 줄에서 코드를 읽지 못했다' });
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── 차례 줄 ─────────

check('차례 줄: 호출은 차례 몫, 토큰은 세션 누적 — 두 차례를 돌리면 모델 호출 수는 각 줄의 몫이고 누적 토큰은 마지막 줄에만 붙는다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'turns', scenario: 'read-only-answer' });
  const app = await openApp(t, { route: '#/s/turns' });
  await app.pane.waitFor({ state: 'visible' });
  const doneLines = () => app.$('.line[data-kind="done"] .ev.done').evaluateAll((els) => els.map((el) => el.textContent ?? ''));
  const tokensOf = (text) => Number((/세션 누적 ([\d,.]+)([kKmM]?)/.exec(text) ?? [])[1]?.replace(/,/g, ''));

  await app.type('첫째 질문');
  await until(async () => (await doneLines()).length === 1, { message: '첫 차례가 끝나지 않았다' });
  const first = (await doneLines())[0];
  assert.match(first, /모델 호출 2회/);
  assert.match(first, /세션 누적/);
  const usage1 = (await api.session('turns')).usage;

  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 돌아오지 않았다' });
  await app.type('둘째 질문');
  await until(async () => (await doneLines()).length === 2, { message: '둘째 차례가 끝나지 않았다' });
  const [one, two] = await doneLines();
  assert.match(one, /모델 호출 2회/);
  assert.doesNotMatch(one, /세션 누적/, '누적 토큰은 마지막 done 줄에만 붙는다');
  assert.match(two, /모델 호출 2회/, '호출 수는 차례 몫이다(누적이 아니다)');
  assert.match(two, /세션 누적/);
  const usage2 = (await api.session('turns')).usage;
  assert.ok(usage2.input_tokens + usage2.output_tokens > usage1.input_tokens + usage1.output_tokens, '서버의 누적 사용량이 늘지 않았다');
  assert.ok(tokensOf(two) >= 0);
  assert.match((await app.$('.line[data-kind="done"] .dim').first().textContent()) ?? '', /성공을 뜻하지 않음/);
  assert.deepEqual(app.problems.all(), []);
}, UI);
