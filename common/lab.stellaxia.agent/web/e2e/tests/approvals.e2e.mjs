// 승인 카드(화면 4·5, WP-5)의 점검 — 승인 한 판 · 더블클릭 · 거부 · 시간 초과의 카드 몫 · 취소 · 자율성(ask·auto) · 실시간 카드 · 규칙 I18.
// 원본: design/checks/demo-checks.mjs 의 "Live:" 점검들(#3 #4 #5 #6 #8 #12 #13 #24 #26). 현황은 TODO-checks.md.
//
// 시계는 두 개다. 서버(가짜 Gateway)는 `control.advance(초)` 로 감는다 — 카드의 `expires_ms`·턴 한도가 그 시계를 따른다.
// 브라우저의 앱은 실제 시계를 쓴다(앱 시계는 밖에서 주입할 수 없다). 그래서 "마감이 지났다"는 서버가 질문을 닫는 것으로 보고,
// 앱의 카운트다운은 실제로 흐르는 글자를 조건으로 기다려 본다. 기다림은 모두 `until()` 이다.

import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { openAsk, pendingCard, slot, waitCard } from '../lib/cards.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };
const RESTART = 'terra.daemon.modules.by-module-id.restart.post';

// ───────── #3 승인 한 판 ─────────

check('승인 한 판(ask): 진행 중(입력 잠김) → 승인 대기(카드·머리 칩·잠김) → 승인 → 접수(accepted-job) → 대기. 승인은 한 번 가고 호출은 Gateway 에 한 번 닿는다', async (t) => {
  await t.control.config({ model_delay_ms: 600 }); // "진행 중" 이 눈에 띄게
  const { api, app } = await openAsk(t, { id: 'ap-flow' });
  assert.equal((await api.session('ap-flow')).state, 'idle');
  await until(async () => /ask/.test((await app.$('[data-role="autonomy-chip"]').textContent()) ?? ''), { message: '머리의 자율성 칩이 ask 가 아니다' });
  const before = await mark(t);

  await app.type('io.terra.chat 을 다시 시작해 줘');
  await app.waitChip('진행 중');
  assert.equal(await app.textarea.isDisabled(), true, '진행 중인데 입력이 열려 있다');
  assert.equal(await pendingCard(app).count(), 0, '모델이 제안하기 전에 카드가 섰다');

  const card = await waitCard(app);
  assert.equal(await app.textarea.isDisabled(), true, '승인 대기인데 입력이 열려 있다');
  // 머리 칩은 세션 목록(느린 폴링)에서 센다 — 카드보다 늦을 수 있어 조건으로 기다린다.
  await until(async () => (await app.$('[data-role="pending-chip"]').textContent()).trim() === '승인 대기 1', { timeout: 15_000, message: '머리 칩이 대기 승인을 세지 않는다' });
  assert.equal(await app.$('[data-role="inbox"]').isVisible(), false, '열어 둔 세션의 승인이 인박스에도 올랐다');

  // 계약 사실(서버가 싣는다)과 모델의 주장이 다른 칸에 선다. 카운트다운은 모듈이 알려 준 마감이라 근사 표시가 없다.
  assert.equal(await card.locator('.facts').getAttribute('data-contract'), 'known');
  assert.match((await card.locator('.facts').textContent()) ?? '', /risk: dangerous/);
  assert.match((await card.locator('.facts').textContent()) ?? '', /accepted-job/);
  assert.equal(await card.locator('.claim').count(), 1);
  assert.notEqual(((await card.locator('.claim-text').textContent()) ?? '').trim(), '', '모델의 주장 칸이 비었다');
  assert.equal(await card.locator('[data-role="clock"]').count(), 1, '마감 시계가 없다');
  assert.equal(await card.locator('[data-role="clock"]').getAttribute('data-approximate'), null, 'expires_ms 가 있는데 근사로 표시됐다');
  assert.equal(await card.locator('[data-role="approve"]').isEnabled(), true);
  assert.equal(await card.locator('[data-role="deny"]').isEnabled(), true);
  assert.equal(await app.$('[data-role="send"]').isDisabled(), true);

  await card.locator('[data-role="approve"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '승인했는데 차례가 끝나지 않았다' });
  await app.waitChip('대기');
  await until(async () => !(await app.textarea.isDisabled()), { message: '차례가 끝났는데 입력이 돌아오지 않았다' });

  const posts = await requestsOf(t, OP.approvalsPost, before);
  assert.equal(posts.length, 1, 'approvals.post 가 정확히 한 번이 아니다');
  const reached = (await t.control.calls()).filter((c) => c.reached);
  assert.equal(reached.length, 1, '승인한 호출이 Gateway 에 한 번 닿아야 한다');
  assert.equal(reached[0].operation_id, RESTART);
  assert.equal(await pendingCard(app).count(), 0);
  assert.equal(await slot(app, 'approved').count(), 1, '끝난 카드가 "승인함" 한 줄로 남아야 한다');
  const kinds = await app.lineKinds();
  assert.ok(kinds.indexOf('approval') < kinds.indexOf('approved') && kinds.indexOf('approved') < kinds.indexOf('call'), `줄 순서가 틀렸다: ${kinds}`);
  // 접수 ≠ 완료: 승인 줄은 "실행됨이 아닙니다" 로 말하고, 모델의 끝말도 접수라고만 한다.
  assert.match((await app.$('.line[data-kind="approved"]').textContent()) ?? '', /실행됨이 아닙니다/);
  assert.match((await app.$('.line[data-kind="assistant"] .body').last().textContent()) ?? '', /접수/);
  await until(async () => !(await app.$('[data-role="pending-chip"]').isVisible()), { timeout: 15_000, message: '답한 뒤에도 머리 칩이 남아 있다' });
  assert.deepEqual(app.problems.all(), []);
}, { ...UI, timeoutMs: 40_000 });

// ───────── #4 더블클릭 ─────────

check('승인 더블클릭: 실제 더블클릭에도 approvals.post 는 한 번이고 곧바로 두 컨트롤이 꺼진다', async (t) => {
  const { api, app } = await openAsk(t, { id: 'ap-dbl' });
  // 응답을 늦춰 "답을 보내는 중" 창을 넓힌다 — 두 번째 클릭이 첫 응답 전에 들어간다.
  await t.control.inject({ op: OP.approvalsPost }, { delay_ms: 300 }, { times: 5 });
  await app.type('다시 시작해 줘');
  const card = await waitCard(app);
  const before = await mark(t);
  await card.locator('[data-role="approve"]').dblclick();
  // 보내는 동안 카드는 처리 중이고 둘 다 꺼져 있다.
  await until(async () => (await card.locator('[data-role="approve"]').isDisabled()) && (await card.locator('[data-role="deny"]').isDisabled()), { message: '누른 직후에도 컨트롤이 켜져 있다' });
  await until(async () => (await app.lineKinds()).includes('done'), { message: '승인 뒤 차례가 끝나지 않았다' });
  await app.waitChip('대기');
  assert.equal((await requestsOf(t, OP.approvalsPost, before)).length, 1, 'approvals.post 가 한 번이 아니다');
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 1, '호출이 한 번만 닿아야 한다');
  const entries = await api.entries('ap-dbl');
  assert.equal(entries.filter((e) => e.kind === 'approved').length, 1);
  // 늦은 두 번째 요청이 있었다면 404 APPROVAL_NOT_FOUND 가 났을 것이고 그 4xx 는 problems 에 남는다 — 한 번뿐이니 비어 있다.
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── #5 거부 ─────────

check('거부: TERRA_APPROVAL_DENIED 줄 · denied 줄 · 호출은 Gateway 에 닿지 않음 · 재시작 없음 · 안내 글 · 대기', async (t) => {
  const { api, app } = await openAsk(t, { id: 'ap-deny' });
  await app.type('다시 시작해 줘');
  const card = await waitCard(app);
  const before = await mark(t);
  await card.locator('[data-role="deny"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '거부 뒤 차례가 끝나지 않았다' });
  await app.waitChip('대기');
  await until(async () => !(await app.textarea.isDisabled()), { message: '거부 뒤 입력이 돌아오지 않았다' });

  const posts = await requestsOf(t, OP.approvalsPost, before);
  assert.equal(posts.length, 1);
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 0, '거부했는데 호출이 Gateway 에 닿았다');
  const entries = await api.entries('ap-deny');
  assert.equal(entries.filter((e) => e.kind === 'denied').length, 1);
  assert.equal(entries.filter((e) => e.kind === 'approved').length, 0);
  const call = entries.find((e) => e.kind === 'call');
  assert.equal(call.error_code, 'TERRA_APPROVAL_DENIED');
  assert.equal(call.status, 'refused');
  // 화면: 거부한 호출 줄(refused · 코드 칩), 카드는 "거부함", 모델의 안내 글. 재시작을 다시 제안하지 않았다.
  const refused = app.$('.line[data-kind="call"] .ev.call[data-status="refused"]');
  assert.equal(await refused.count(), 1);
  assert.match((await refused.textContent()) ?? '', /TERRA_APPROVAL_DENIED/);
  assert.equal(await slot(app, 'denied').count(), 1, '끝난 카드가 "거부함" 한 줄로 남아야 한다');
  assert.equal(await pendingCard(app).count(), 0);
  assert.equal(await app.$('.line[data-kind="approval"]').count(), 1, '거부했는데 새 질문이 섰다(재시작 시도)');
  assert.equal((await app.$('.line[data-kind="assistant"] .body').last().textContent()).trim(), '거부하셨으므로 다시 시작하지 않았습니다.');
  assert.equal((await api.session('ap-deny')).state, 'idle');
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── #6 시간 초과의 카드 몫 ─────────

check('시간 초과(카드 몫): 서버가 질문을 닫으면 카드가 "시간 초과" 한 줄로 바뀌고 컨트롤이 사라진다 — 시계는 서버 시계를 감는다', async (t) => {
  const { api, app } = await openAsk(t, { id: 'ap-time', scenario: 'approval-timeout', max_seconds: 300 });
  await app.type('다시 시작해 줘');
  const card = await waitCard(app);
  // 카드의 마감은 서버가 알려 준 expires_ms 다 — 한 차례의 한도(300초) 안이다.
  const [pending] = (await api.session('ap-time')).pending_approvals;
  assert.ok(pending.expires_ms - pending.created_ms <= 300_000);
  assert.equal(await card.locator('[data-role="clock"]').getAttribute('data-approximate'), null);

  await t.control.advance(301);
  await app.waitChip('대기');
  await slot(app, 'timed-out').waitFor({ state: 'visible' });
  assert.equal(((await slot(app, 'timed-out').locator('.chip').last().textContent()) ?? '').trim(), '시간 초과');
  assert.equal(await pendingCard(app).count(), 0, '닫힌 질문에 컨트롤이 남아 있다');
  assert.equal(await app.$('[data-role="approve"]').count(), 0);
  assert.equal(await app.$('[data-role="deny"]').count(), 0);
  assert.equal(await app.$('.line[data-kind="denied"]').count(), 0, '시간 초과에 denied 줄이 생겼다');
  assert.equal((await app.lastError.textContent()).trim(), 'TIME_LIMIT');
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 0);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('시간 초과(30분 무응답): 턴 한도가 넉넉하면 30분 뒤 서버가 거부로 닫는다 — 카드는 "무응답 거부" 이고 TIME_LIMIT 은 없다', async (t) => {
  const { api, app } = await openAsk(t, { id: 'ap-silent', scenario: 'approval-timeout', max_seconds: 7200 });
  await app.type('다시 시작해 줘');
  await waitCard(app);
  await t.control.advance(1801);
  await app.waitChip('대기');
  await slot(app, 'no-answer').waitFor({ state: 'visible' });
  assert.equal(((await slot(app, 'no-answer').locator('.chip').last().textContent()) ?? '').trim(), '무응답 거부');
  const denied = (await api.entries('ap-silent')).filter((e) => e.kind === 'denied');
  assert.equal(denied.length, 1);
  assert.match(denied[0].note, /no answer within/);
  assert.equal(await pendingCard(app).count(), 0);
  assert.equal((await api.session('ap-silent')).last_error_code, undefined, '무응답 거부는 TIME_LIMIT 이 아니다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── #8 승인 대기 중 취소 ─────────

check('승인 대기 중 취소: 확인창을 거쳐 취소하면 카드가 "취소됨" 한 줄이 되고 컨트롤이 사라진다 — 호출은 가지 않고 답도 가지 않는다', async (t) => {
  const { api, app } = await openAsk(t, { id: 'ap-cancel' });
  await app.type('다시 시작해 줘');
  const card = await waitCard(app);
  assert.equal(await app.cancel.isVisible(), true, '승인 대기 중에 취소 단추가 없다');
  const before = await mark(t);
  await app.cancel.click();
  await app.dialog.waitFor({ state: 'visible' });
  await app.$('[data-role="cancel-confirm"]').click();
  await app.waitChip('취소됨');
  await slot(app, 'cancelled').waitFor({ state: 'visible' });
  assert.equal(((await slot(app, 'cancelled').locator('.chip').last().textContent()) ?? '').trim(), '취소됨');
  assert.equal(await pendingCard(app).count(), 0);
  assert.equal(await card.count(), 0, '낡은 카드 노드가 남아 있다');
  assert.equal(await app.$('[data-role="approve"]').count(), 0);
  assert.equal((await requestsOf(t, OP.sessionsCancel, before)).length, 1);
  assert.equal((await requestsOf(t, OP.approvalsPost, before)).length, 0, '취소했는데 승인·거부가 나갔다');
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 0);
  assert.equal((await api.session('ap-cancel')).state, 'cancelled');
  assert.equal(await app.textarea.isDisabled(), true);
  await until(async () => !(await app.$('[data-role="pending-chip"]').isVisible()), { timeout: 15_000, message: '취소한 세션의 대기가 머리 칩에 남아 있다' });
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── #12 #13 자율성 ─────────

check('자율성(ask): 위험한 restart 뿐 아니라 쓰기(files.write)도 하나씩 묻는다 — 첫 카드에 답하면 둘째 카드가 선다', async (t) => {
  const { app } = await openAsk(t, { id: 'ap-ask', scenario: 'two-approvals' });
  await until(async () => /ask/.test((await app.$('[data-role="autonomy-chip"]').textContent()) ?? ''), { message: '머리의 자율성 칩이 ask 가 아니다' });
  await app.type('다시 시작하고 메모를 남겨 줘');

  const first = await waitCard(app);
  assert.equal(await first.locator('.op').textContent(), RESTART);
  assert.equal(await app.$('.appr[data-card-state="pending"]').count(), 1, '카드는 하나씩 서야 한다');
  await first.locator('[data-role="approve"]').click();

  await until(async () => (await pendingCard(app).locator('.op').first().textContent().catch(() => null)) === 'terra.files.write', { message: '둘째 카드(files.write)가 서지 않았다' });
  const second = pendingCard(app);
  assert.match((await second.locator('.facts').textContent()) ?? '', /risk: write/, 'ask 는 위험하지 않은 쓰기도 묻는다');
  await second.locator('[data-role="deny"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  await app.waitChip('대기');
  const reached = (await t.control.calls()).filter((c) => c.reached);
  assert.deepEqual(reached.map((c) => c.operation_id), [RESTART], '승인한 것만 닿고 거부한 쓰기는 닿지 않아야 한다');
  assert.equal(await slot(app, 'approved').count(), 1);
  assert.equal(await slot(app, 'denied').count(), 1);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('자율성(auto): 위험한 restart 는 auto 에서도 묻는다 — 카드가 서고 승인하면 접수된다', async (t) => {
  const { api, app } = await openAsk(t, { id: 'ap-auto', autonomy: 'auto' });
  await until(async () => /auto/.test((await app.$('[data-role="autonomy-chip"]').textContent()) ?? ''), { message: '머리의 자율성 칩이 auto 가 아니다' });
  await app.type('다시 시작해 줘');
  const card = await waitCard(app);
  assert.equal((await api.session('ap-auto')).autonomy, 'auto');
  assert.match((await card.locator('.facts').textContent()) ?? '', /risk: dangerous/);
  // 판정 근거는 모듈이 계산한 것이다 — 화면은 다시 계산하지 않고 그대로 싣는다(I5).
  const [pending] = (await api.session('ap-auto')).pending_approvals;
  assert.ok(pending.judgement, '서버가 판정 근거를 싣지 않았다');
  assert.ok((await card.locator('.appr-judge').textContent()).includes(pending.judgement), '카드가 판정 근거를 그대로 싣지 않았다');
  await card.locator('[data-role="approve"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '승인 뒤 차례가 끝나지 않았다' });
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 1);
  assert.match((await app.$('.line[data-kind="assistant"] .body').last().textContent()) ?? '', /접수/);
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── #24 실시간 카드 ─────────

check('실시간 카드: 서버 시계를 감지 않아도 카드가 서고, 마감 시계는 같은 노드에서 글자만 흐른다', async (t) => {
  const { app } = await openAsk(t, { id: 'ap-live' });
  await app.type('다시 시작해 줘');
  const card = await waitCard(app);
  const clock = card.locator('[data-role="clock-vis"]');
  const first = await clock.textContent();
  assert.match(first ?? '', /^\d+:\d{2}$/, `시계 글자가 m:ss 가 아니다: ${first}`);
  // 두 노드에 표식을 달아 두고, 시계 글자가 바뀌어도 노드가 그대로인지 본다(초점·스크린 리더가 흔들리지 않도록).
  await card.evaluate((el) => {
    el.__same = true;
    el.querySelector('[data-role="clock"]').__same = true;
  });
  await until(async () => (await clock.textContent()) !== first, { timeout: 15_000, message: '실제 시간이 흘러도 카운트다운 글자가 바뀌지 않았다' });
  assert.equal(await card.evaluate((el) => el.__same === true && el.querySelector('[data-role="clock"]').__same === true), true, '카운트다운이 카드나 시계 노드를 갈아 끼웠다');
  assert.equal(await card.locator('[data-role="clock"]').getAttribute('role'), 'timer');
  assert.equal(await card.locator('[data-role="approve"]').isEnabled(), true);
  assert.deepEqual(app.problems.all(), []);
}, { ...UI, timeoutMs: 40_000 });

// ───────── #26 규칙 I18 ─────────

check('규칙 I18(거부 기억): 거부한 같은 호출을 모델이 다시 제안하면 새 카드에 "이전에 거부한 같은 호출" 표식이 서고 첫 카드에는 없다', async (t) => {
  const { app } = await openAsk(t, { id: 'ap-i18', scenario: 'approval-deny-repropose' });
  await app.type('다시 시작해 줘');
  const first = await waitCard(app);
  const firstId = await first.getAttribute('data-request-id');
  assert.equal(await first.locator('[data-role="prev-denied"]').count(), 0, '첫 카드에 표식이 있다');
  await first.locator('[data-role="deny"]').click();

  // 둘째 카드: 새 request_id, 같은 호출 — 표식이 선다.
  await until(async () => {
    const id = await pendingCard(app).getAttribute('data-request-id').catch(() => null);
    return id !== null && id !== firstId;
  }, { message: '거부한 뒤 같은 호출의 새 카드가 서지 않았다' });
  const second = pendingCard(app);
  const mark1 = second.locator('[data-role="prev-denied"]');
  await mark1.waitFor({ state: 'visible' });
  assert.match((await mark1.textContent()) ?? '', /1회/);
  assert.equal(await second.locator('[data-role="prev-denied-unknown"]').count(), 0);
  // 거부한 첫 카드는 "거부함" 한 줄로 남는다.
  assert.equal(await slot(app, 'denied').count(), 1);

  await second.locator('[data-role="deny"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '두 번 거부한 뒤 차례가 끝나지 않았다' });
  await app.waitChip('대기');
  assert.equal(await slot(app, 'denied').count(), 2);
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 0);
  // 끝난 둘째 카드의 줄에도 표식이 붙어 있다(첫째에는 없다).
  const marks = await app.$('.approval-slot[data-card-state="denied"]').evaluateAll((els) => els.map((el) => el.querySelectorAll('[data-role="prev-denied"]').length));
  assert.deepEqual(marks, [0, 1]);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('규칙 I18(이전 모듈 모양): 판정·이유를 싣지 않는 모듈에서도 같은 입력의 거부 기억이 선다 — 카드는 이유 없음·판정 없음으로 말한다', async (t) => {
  await t.control.features({ reasonJudgement: false });
  const { app } = await openAsk(t, { id: 'ap-i18-old', scenario: 'approval-deny-repropose' });
  await app.type('다시 시작해 줘');
  const first = await waitCard(app);
  const firstId = await first.getAttribute('data-request-id');
  assert.equal(await first.locator('.claim-text .dim').count(), 1, '이유가 없는데 모델의 주장 칸이 채워져 있다');
  await first.locator('[data-role="deny"]').click();
  await until(async () => {
    const id = await pendingCard(app).getAttribute('data-request-id').catch(() => null);
    return id !== null && id !== firstId;
  }, { message: '둘째 카드가 서지 않았다' });
  await pendingCard(app).locator('[data-role="prev-denied"]').waitFor({ state: 'visible' });
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('규칙 I18(입력을 못 본 거부): 앱을 거부 뒤에 열면 같은 호출인지 비교할 수 없다고 말한다 — 같다고 단정하지 않는다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'ap-i18-late', autonomy: 'ask', scenario: 'approval-deny-repropose' });
  await api.say('ap-i18-late', '다시 시작해 줘');
  await api.waitState('ap-i18-late', 'waiting-approval');
  const [firstPending] = (await api.session('ap-i18-late')).pending_approvals;
  // 앱이 첫 카드를 보기 전에 서버 쪽에서 거부한다.
  const answered = await api.call('POST', `/approvals/${firstPending.request_id}`, { deny: true });
  assert.equal(answered.status, 200, JSON.stringify(answered.data));
  await until(async () => {
    const s = await api.session('ap-i18-late');
    return s.state === 'waiting-approval' && s.pending_approvals.length === 1 && s.pending_approvals[0].request_id !== firstPending.request_id;
  }, { message: '둘째 질문이 서지 않았다' });
  const app = await openApp(t, { route: '#/s/ap-i18-late' });
  const card = pendingCard(app);
  await card.waitFor({ state: 'visible' });
  await card.locator('[data-role="prev-denied-unknown"]').waitFor({ state: 'visible' });
  assert.equal(await card.locator('[data-role="prev-denied"]').count(), 0, '입력을 본 적 없는데 같은 호출이라고 단정했다');
  assert.deepEqual(app.problems.all(), []);
}, UI);
