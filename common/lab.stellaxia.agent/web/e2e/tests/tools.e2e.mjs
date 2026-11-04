// 도구 줄과 카드의 모양 — 외부 도구(Gateway 계약도 감사도 없다) · 계약이 적지 않은 칸 · 승인 뒤의 Gateway 거절 · 시뮬레이션.
// 35개 이식 목록에는 들지 않는 "시연에 없던 점검"이다(TODO-checks.md). 시나리오를 못 박은 ask 세션을 서버에서 심고 앱으로 본다.
//
// 지키는 약속: 화면은 서버가 준 사실만 그린다 — 계약이 없으면 없다고, 안 적었으면 안 적었다고, 감사에 없으면 없다고 말한다(I5·I12·I13, DC-17).

import { OP, agentApi, assert, mark, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';
import { openAsk, pendingCard, slot, waitCard } from '../lib/cards.mjs';

const UI = { apps: ['ui'] };
const RESTART = 'terra.daemon.modules.by-module-id.restart.post';

/** 외부 MCP 서버를 등록한다(agent.external 이 있는 계정으로 — 앱은 등록하지 않는다). */
async function registerMcp(t) {
  const put = await agentApi(t, 'ext').call('PUT', '/mcp/servers/fake-mcp', { command: 'fake-mcp-cmd', read_only: ['read_file'] });
  assert.equal(put.status, 200, `외부 서버를 등록하지 못했다: ${JSON.stringify(put.data)}`);
}

/** 계약 칸(승인 카드의 dl)의 값 칸. 순서는 approval-card.ts 의 rows: 위험 · 확인 · 부작용 · 재시도 · 멱등 · 결과 · 대상. */
const ROW = { risk: 0, confirmation: 1, sideEffects: 2, retry: 3, idempotency: 4, output: 5 };
const cell = (card, name) => card.locator('.facts dl.appr-kv dd').nth(ROW[name]);

// ───────── 외부 도구 ─────────

check('외부 쓰기 도구의 카드(I12): 계약 사실이 없다 — "계약 사실을 읽지 못했습니다"로 말하고 표를 그리지 않으며, 승인하면 external 줄로 남는다', async (t) => {
  await registerMcp(t);
  const { api, app } = await openAsk(t, { id: 'ext-write', scenario: 'external-write-ask', mcp_servers: ['fake-mcp'] });
  await app.type('외부 서버에 저장해 줘');
  const card = await waitCard(app);
  const [pending] = (await api.session('ext-write')).pending_approvals;
  assert.equal('contract' in pending, false, '서버가 외부 도구 카드에 계약을 실었다 — 시나리오가 틀렸다');

  const facts = card.locator('.facts');
  assert.equal(await facts.getAttribute('data-contract'), 'unreadable');
  assert.match((await card.locator('.appr-unreadable').textContent()) ?? '', /계약 사실을 읽지 못했습니다/);
  assert.equal(await card.locator('dl.appr-kv').count(), 0, '계약이 없는데 위험·부작용 표가 그려졌다');
  assert.equal(await card.locator('[data-unspecified]').count(), 0, '계약이 없는 것을 "적지 않음"으로 칠했다 — 없는 계약과 안 적은 칸은 다른 사실이다');
  assert.equal(await card.locator('.appr-chips .chip').count(), 0, '계약이 없는데 위험 칩이 섰다');
  // 판정 근거(서버가 계산한 것)와 모델의 주장은 그대로 선다 — 계약 칸만 비어 있다.
  assert.match((await card.locator('.appr-judge').textContent()) ?? '', /autonomy=ask/);
  assert.equal(await card.locator('.claim-text').textContent(), '결과를 저장합니다');
  assert.equal(await card.locator('[data-role="approve"]').isEnabled(), true, '계약이 없다고 답할 길을 막았다');
  assert.match((await card.locator('.op').textContent()) ?? '', /^mcp__fake-mcp__write_file$/);

  await card.locator('[data-role="approve"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '승인 뒤 차례가 끝나지 않았다' });
  assert.equal(await slot(app, 'approved').count(), 1);
  const external = app.$('.line[data-kind="external"] .ev.external');
  assert.equal(await external.count(), 1, '승인한 외부 호출이 external 줄로 남지 않았다');
  assert.equal(await app.$('.line[data-kind="call"]').count(), 0, '외부 호출이 Gateway 호출(call) 줄로 그려졌다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('외부 읽기 도구(I12): 묻지 않고 돌고 external 줄이 "Gateway 감사에 없습니다"라고 말한다 — 서버 이름·바이트 수가 보이고 trace 도 승인 카드도 없다', async (t) => {
  await registerMcp(t);
  const { api, app } = await openAsk(t, { id: 'ext-read', scenario: 'external-call', mcp_servers: ['fake-mcp'] });
  await app.type('외부 서버에서 읽어 줘');
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  await app.waitChip('대기');

  const external = app.$('.line[data-kind="external"] .ev.external');
  assert.equal(await external.count(), 1);
  assert.match((await external.locator('b').textContent()) ?? '', /감사에 없/);
  const text = (await external.textContent()) ?? '';
  assert.match(text, /fake-mcp/);
  assert.match(text, /2[,.]?048 B/);
  assert.equal(await external.locator('.chip').last().textContent(), 'ok');
  assert.equal(await app.$('.line[data-kind="external"]').count(), 1);
  assert.equal(await app.$('.line[data-kind="call"]').count(), 0);
  assert.equal(await app.$('.line[data-kind="approval"]').count(), 0, '읽기 도구에 승인 카드가 섰다');
  // 이 줄에는 Gateway 감사 id(trace)가 없다 — 상세에도 trace id 행이 없어야 한다.
  const detail = app.$('.line[data-kind="external"] details');
  await detail.locator('summary').click();
  const detailText = (await detail.textContent()) ?? '';
  assert.doesNotMatch(detailText, /trace id/, '외부 줄에 trace id 행이 있다 — 서버가 trace 를 싣지 않았는데');
  assert.match(detailText, /no gateway audit/, '서버의 메모(감사에 없다)가 상세에 없다');
  const entries = await api.entries('ext-read');
  assert.equal(entries.find((e) => e.kind === 'external').trace_id, undefined);
  assert.equal((await api.session('ext-read')).mcp_servers[0], 'fake-mcp');
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── 계약이 적지 않은 칸 ─────────

check('계약 사실 "적지 않음"(DC-17): 계약이 안 적은 칸은 "적지 않음", 적었는데 빈 목록은 "없음" — 같은 카드에서 둘이 갈린다', async (t) => {
  const { app } = await openAsk(t, { id: 'lc', scenario: 'legacy-contract' });
  await app.type('표식을 남기고 파일을 써 줘');

  // 첫 카드: terra.legacy.touch — 계약이 위험만 적었다. 나머지 다섯 칸은 "적지 않음"이다.
  const first = await waitCard(app);
  assert.equal(await first.locator('.op').textContent(), 'terra.legacy.touch');
  assert.equal(await first.locator('.facts').getAttribute('data-contract'), 'known');
  assert.match((await cell(first, 'risk').textContent()) ?? '', /risk: write/);
  assert.equal(await cell(first, 'risk').locator('[data-unspecified]').count(), 0, '적은 위험을 "적지 않음"으로 칠했다');
  for (const name of ['confirmation', 'sideEffects', 'retry', 'idempotency', 'output']) {
    assert.equal(await cell(first, name).locator('[data-unspecified]').count(), 1, `${name} 칸을 계약이 적지 않았는데 "적지 않음"이라 말하지 않았다`);
  }
  assert.equal(await first.locator('[data-unspecified]').count(), 5);
  assert.equal(await first.locator('.appr-chips .chip.mut').count(), 0, '적지 않은 권한 목록을 "권한 없음"으로 칠했다');
  const unspecifiedText = (await first.locator('[data-unspecified]').first().textContent()) ?? '';
  await first.locator('[data-role="approve"]').click();

  // 둘째 카드: terra.files.write — 계약이 side_effects: [] 로 "없음"이라 적었다.
  await until(async () => (await pendingCard(app).locator('.op').count()) === 1 && (await pendingCard(app).locator('.op').textContent()) === 'terra.files.write', { message: '둘째 카드(files.write)가 서지 않았다' });
  const second = pendingCard(app);
  assert.equal(await second.locator('[data-unspecified]').count(), 0, '계약이 모두 적은 카드에 "적지 않음"이 있다');
  const none = (await cell(second, 'sideEffects').textContent()) ?? '';
  assert.notEqual(none.trim(), '', '"없음"이 비어 있다');
  assert.notEqual(none.trim(), unspecifiedText.trim(), '"없음"과 "적지 않음"이 같은 글자다 — 다른 사실이 같게 보인다');
  assert.match((await second.locator('.appr-chips').textContent()) ?? '', /files\.write/);
  assert.equal(await cell(second, 'sideEffects').locator('.appr-effects').count(), 0, '빈 부작용 목록에 칩이 섰다');
  await second.locator('[data-role="deny"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  assert.deepEqual((await t.control.calls()).filter((c) => c.reached).map((c) => c.operation_id), ['terra.legacy.touch']);
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── 승인 뒤의 Gateway ─────────

check('승인 뒤에도 Gateway 가 거절(I5): 카드는 "승인은 물어봤다"고 미리 말하고, 승인한 호출이 error 줄(MODULE_PERMISSION_DENIED)로 남는다 — 성공처럼 그리지 않는다', async (t) => {
  const { api, app } = await openAsk(t, { id: 'g403', scenario: 'gateway-403-after-approve' });
  await app.type('모듈을 다시 시작해 줘');
  const card = await waitCard(app);
  // 승인 전부터 카드가 말한다: 승인은 "물어봤다"이고 Gateway 가 다시 판정한다.
  assert.match((await card.locator('.appr-foot .appr-hint').textContent()) ?? '', /물어봤다.*다시 판정/);
  const before = await mark(t);
  await card.locator('[data-role="approve"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '승인 뒤 차례가 끝나지 않았다' });
  await app.waitChip('대기');

  assert.equal((await requestsOf(t, OP.approvalsPost, before)).length, 1);
  const reached = (await t.control.calls()).filter((c) => c.reached);
  assert.deepEqual(reached.map((c) => [c.operation_id, c.outcome, c.approved]), [[RESTART, 'error', true]], '승인한 호출이 Gateway 에 닿아 error 로 끝났어야 한다');

  // 화면: 승인함 한 줄 + error 호출 줄. 오류 코드 칩과 사전 문구가 같이 선다. ok 로 칠한 호출은 없다.
  assert.equal(await slot(app, 'approved').count(), 1);
  const call = app.$('.line[data-kind="call"] .ev.call');
  assert.equal(await call.count(), 1);
  assert.equal(await call.getAttribute('data-status'), 'error');
  assert.equal(await app.$('.ev.call[data-status="ok"]').count(), 0, '거절된 호출이 ok 로 그려졌다');
  assert.equal(await call.locator('.chip.mono').textContent(), 'MODULE_PERMISSION_DENIED');
  assert.equal(await call.locator('.chip.err').first().textContent(), 'error');
  const detail = app.$('.line[data-kind="call"] details');
  await detail.locator('summary').click();
  // call 줄의 거절은 에이전트가 위임 자격으로 부른 호출이다 — 사용자 계정의 agent.use 가 아니라 자격의 권한 부족으로 말한다(B3).
  const detailText = (await detail.textContent()) ?? '';
  assert.match(detailText, /MODULE_PERMISSION_DENIED — 위임 자격에 이 operation 에 필요한 권한이 없어/);
  assert.doesNotMatch(detailText, /이 계정에 agent\.use 권한이 없거나/);
  // 승인 줄은 "실행됨이 아닙니다"라고 말한다.
  assert.match((await app.$('.line[data-kind="approved"]').textContent()) ?? '', /실행됨이 아닙니다/);
  const entries = await api.entries('g403');
  const entry = entries.find((e) => e.kind === 'call');
  assert.deepEqual([entry.status, entry.error_code], ['error', 'MODULE_PERMISSION_DENIED']);
  assert.equal((await api.session('g403')).state, 'idle', '호출 오류가 세션을 failed 로 만들었다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── 시뮬레이션 ─────────

check('시뮬레이션(I13): 모든 호출이 "실행되지 않았습니다" planned 줄로 남고 카드·call 줄이 없으며 Gateway 에 닿지 않는다 — 머리에 "호출 없음"이 선다', async (t) => {
  const { api, app } = await openAsk(t, { id: 'sim', scenario: 'simulate-planned', simulate: true });
  assert.equal((await api.session('sim')).simulate, true);
  await app.f.getByText('시뮬레이션 · 호출 없음').waitFor({ state: 'visible' });
  await app.type('모듈을 다시 시작하고 목록을 보여 줘');
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  await app.waitChip('대기');

  const planned = app.$('.line[data-kind="planned"] .ev.plan');
  assert.equal(await planned.count(), 2);
  for (const i of [0, 1]) {
    assert.match((await planned.nth(i).locator('b').textContent()) ?? '', /실행되지 않았습니다/);
    assert.equal(await planned.nth(i).locator('.chip').last().textContent(), '실행 안 됨');
  }
  assert.deepEqual(await planned.locator('.op').allTextContents(), [RESTART, 'terra.daemon.modules.list']);
  const kinds = await app.lineKinds();
  for (const forbidden of ['call', 'approval', 'approved', 'denied', 'external']) assert.ok(!kinds.includes(forbidden), `시뮬레이션에 ${forbidden} 줄이 있다`);
  assert.equal(await pendingCard(app).count(), 0);
  assert.deepEqual((await t.control.calls()).filter((c) => c.reached), [], '시뮬레이션이 Gateway 에 닿았다');
  assert.match((await app.$('.line[data-kind="assistant"] .body').last().textContent()) ?? '', /실행되지 않았습니다/);
  assert.deepEqual(app.problems.all(), []);
}, UI);
