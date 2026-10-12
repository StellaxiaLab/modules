// 오류 코드 사전이 화면에서 어떻게 보이는가 — 모듈 오류 15 + Gateway 오류 7 + 브리지 오류(BRIDGE_NO_PERMISSIONS)·UNAUTHORIZED.
// 사전 자체(코드 → 문구·행동)의 완전성은 Vitest(`tests/errors.test.ts`)가 계약 파일과 대조한다. 여기서는 오류가 **앱 화면의 어느 자리에 어떤 말로** 서는지를 본다.
//
// 약속(요구 §6.4·§6.5): 서버 문구는 영어이고 CLI 안내가 섞여 있으니 화면은 `code` 로 자기(한국어) 문구를 고른다. 모르는 코드는 "알 수 없는 오류"로 말하고,
// 요청이 갔는지 모르는 쓰기는 자동으로 다시 보내지 않는다(I17). 가짜 서버가 주입하는 오류의 코드 표는 `lib/errors.mjs` 와 같아야 하므로 표가 어긋나면 이 시험이 먼저 알린다.

import { MODULE_ERRORS, GATEWAY_ERRORS } from '../lib/errors.mjs';
import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';
import { openAsk, pendingCard, slot, waitCard } from '../lib/cards.mjs';

const UI = { apps: ['ui'] };

/** 일부러 만든 4xx·5xx 는 브라우저가 기록한다 — 그것 말고는 아무 문제도 없어야 한다. */
const unexpected = (app) => app.problems.all().filter((p) => !/^HTTP [45]\d\d:/.test(p) && !/Failed to load resource/.test(p));

/** 화면 문구(src/data/errors.ts 의 사전)를 가르는 낱말. 같은 문구가 둘 이상의 코드에 걸리지 않게 고른다. */
const MODULE_PHRASES = {
  INVALID_REQUEST: /요청 형식이 맞지 않습니다/,
  SESSION_NOT_OWNED: /다른 사람이 연 세션입니다/,
  CREDENTIAL_NOT_UNATTENDED: /무인으로 발급된 자격/,
  CREDENTIAL_REJECTED: /자격을 받아들이지 않았습니다/,
  SESSION_NOT_FOUND: /세션을 찾을 수 없습니다/,
  APPROVAL_NOT_FOUND: /이미 답했거나 만료된 승인/,
  MCP_SERVER_UNKNOWN: /등록되지 않은 외부 서버/,
  SESSION_BUSY: /모델이 답하는 중입니다/,
  SESSION_FINISHED: /끝난 세션입니다/,
  CREDENTIAL_MISSING: /위임 자격이 맡겨져 있지 않습니다/,
  MODEL_NOT_CONFIGURED: /등록된 모델이 없습니다/,
  MCP_UNATTENDED_CONFLICT: /외부 MCP 서버와 함께 열 수 없습니다/,
  MCP_SERVER_FAILED: /외부 서버가 실행되지 않았거나/,
  MODEL_UNAVAILABLE: /모델 호출이 실패했습니다/,
  AGENT_UNAVAILABLE: /에이전트 모듈이 지금 처리할 수 없습니다/,
};
const GATEWAY_PHRASES = {
  MODULE_UNAVAILABLE: /에이전트 모듈이 꺼져 있습니다/,
  MODULE_PERMISSION_DENIED: /agent\.use 권한이 없거나 도달 범위 밖/,
  MODULE_INVOCATION_TIMEOUT: /모듈이 제때 답하지 않았습니다/,
  UNAUTHORIZED: /로그인 세션이 끝났습니다/,
  QUOTA_EXCEEDED: /요청이 너무 많습니다/,
  REQUEST_TOO_LARGE: /요청이 너무 큽니다/,
  SCOPE_TOKEN_DENIED: /앱 토큰 발급이 거절되었습니다/,
};

check('오류 사전 표: 시험의 문구 표가 가짜 서버가 주입하는 코드(모듈 15 + Gateway 7)와 한 글자도 다르지 않다 — 코드가 늘면 이 점검이 먼저 깨진다', async () => {
  assert.deepEqual(Object.keys(MODULE_PHRASES).sort(), Object.keys(MODULE_ERRORS).sort());
  assert.deepEqual(Object.keys(GATEWAY_PHRASES).sort(), Object.keys(GATEWAY_ERRORS).sort());
  assert.equal(Object.keys(MODULE_ERRORS).length, 15);
  assert.equal(Object.keys(GATEWAY_ERRORS).length, 7);
}, UI);

/**
 * 보내기(messages.post)를 실패시켜 입력칸 위의 안내(`composer-notice`)에 서는 문구를 본다.
 * 같은 입력칸에서 코드를 돌려 가며 시도한다 — 글은 가지 않았으니 입력칸에 남는다.
 */
async function composerNoticeFor(t, effects) {
  const api = agentApi(t);
  await api.open({ id: 'err-notice', autonomy: 'ask' });
  const app = await openApp(t, { route: '#/s/err-notice' });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 열리지 않았다' });
  const notice = app.$('[data-role="composer-notice"]');
  const before = await mark(t);
  let attempts = 0;
  for (const [code, effect, phrase] of effects) {
    // 서버 원문(영어)에 표식을 단다 — 화면에 보이는 글(접힌 상세는 빼고)에는 나오지 않아야 한다.
    const injected = effect.module_error ? { module_error: { code, message: `RAW english message for ${code}` } } : { gateway_error: { code, message: `RAW english message for ${code}` } };
    await t.control.inject({ op: OP.messagesPost }, injected);
    await app.textarea.fill('보낼 글');
    await app.textarea.press('Enter');
    attempts += 1;
    await until(async () => phrase.test((await notice.textContent()) ?? '') && (await notice.isVisible()), { message: `${code}: 한국어 문구가 서지 않았다 — 지금 안내: ${JSON.stringify(await notice.textContent())}` });
    const text = (await notice.textContent()) ?? '';
    assert.match(text, /[가-힣]/, `${code}: 안내에 한국어가 없다`);
    assert.doesNotMatch(await notice.innerText(), /RAW english/, `${code}: 서버의 영어 원문이 그대로 보인다`);
    assert.equal(await notice.getAttribute('role'), 'status');
    assert.match((await notice.getAttribute('class')) ?? '', /\b(warn|err)\b/, `${code}: 안내가 오류 색이 아니다`);
    assert.equal(await app.textarea.inputValue(), '보낼 글', `${code}: 실패한 글이 입력칸에서 사라졌다`);
    // 재시도 never: 실패해도 앱이 알아서 다시 보내지 않는다.
    assert.equal((await requestsOf(t, OP.messagesPost, before)).length, attempts, `${code}: 앱이 messages.post 를 다시 보냈다`);
  }
  assert.deepEqual((await api.entries('err-notice')).filter((e) => e.kind === 'user'), [], '주입한 오류인데 글이 서버에 쌓였다');
  assert.deepEqual(unexpected(app), []);
}

check('오류 사전(모듈 오류 15): 보내기가 어떤 모듈 오류로 실패해도 입력칸 위에 한국어 문구가 서고, 입력은 보존되며, 자동으로 다시 보내지 않는다', async (t) => {
  await composerNoticeFor(t, Object.entries(MODULE_PHRASES).map(([code, phrase]) => [code, { module_error: true }, phrase]));
}, { ...UI, timeoutMs: 60_000 });

check('오류 사전(Gateway 오류 7): Gateway 봉투 {ok:false,error,meta} 도 코드로 풀어 한국어 문구를 말한다 — 504 처럼 결과를 모르는 쓰기는 기록을 읽어 확인하라고 덧붙인다', async (t) => {
  await composerNoticeFor(t, Object.entries(GATEWAY_PHRASES).map(([code, phrase]) => [code, { gateway_error: true }, phrase]));
}, { ...UI, timeoutMs: 60_000 });

check('오류 사전(낯선 응답): 모르는 코드는 "알 수 없는 오류"로, 봉투가 아닌 본문(HTML 502)은 "처리됐는지 알 수 없다"로 말한다 — 서버 원문을 그대로 띄우지 않는다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'err-odd', autonomy: 'ask' });
  const app = await openApp(t, { route: '#/s/err-odd' });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 열리지 않았다' });
  const notice = app.$('[data-role="composer-notice"]');

  await t.control.inject({ op: OP.messagesPost }, { module_error: { code: 'SOME_FUTURE_CODE', message: 'RAW english: something new', status: 418 } });
  await app.type('낯선 코드');
  await until(async () => /알 수 없는 오류입니다/.test((await notice.textContent()) ?? ''), { message: `모르는 코드의 안내가 서지 않았다: ${JSON.stringify(await notice.textContent())}` });

  await t.control.inject({ op: OP.messagesPost }, { status: 502, body: '<html><body>502 Bad Gateway — nginx</body></html>', content_type: 'text/html' });
  await app.textarea.press('Enter');
  await until(async () => /처리됐는지 알 수 없습니다/.test((await notice.textContent()) ?? ''), { message: `HTML 본문의 안내가 서지 않았다: ${JSON.stringify(await notice.textContent())}` });
  assert.doesNotMatch((await notice.textContent()) ?? '', /nginx|<html>/, '서버의 HTML 이 화면에 나왔다');
  assert.equal((await api.entries('err-odd')).filter((e) => e.kind === 'user').length, 0);
  assert.deepEqual(unexpected(app), []);
}, UI);

// ───────── 읽기 오류가 서는 자리 ─────────

check('오류가 서는 자리(세션 읽기): 없는 세션은 SESSION_NOT_FOUND, 남의 세션은 SESSION_NOT_OWNED 문구가 대화 자리에 경고(role=alert)로 서고 입력은 잠긴다', async (t) => {
  const bob = agentApi(t, 'bob');
  await bob.open({ id: 'bobs-session', autonomy: 'ask' });
  const app = await openApp(t, { route: '#/s/does-not-exist' });
  await app.pane.waitFor({ state: 'visible' });
  const problem = app.$('[data-role="session-pane"] .problem');
  await until(async () => (await problem.isVisible()) && /세션을 찾을 수 없습니다/.test((await problem.textContent()) ?? ''), { message: `없는 세션의 안내가 서지 않았다: ${JSON.stringify(await problem.textContent())}` });
  assert.equal(await problem.getAttribute('role'), 'alert');
  assert.equal(await app.textarea.isDisabled(), true);
  assert.equal(await app.send.isDisabled(), true);
  await app.waitChip('읽지 못함');

  await app.goto('bobs-session');
  await until(async () => (await problem.isVisible()) && /다른 사람이 연 세션입니다/.test((await problem.textContent()) ?? ''), { message: `남의 세션의 안내가 서지 않았다: ${JSON.stringify(await problem.textContent())}` });
  assert.equal(await app.textarea.isDisabled(), true, '남의 세션에 입력이 열렸다');
  assert.equal(await app.$('.line[data-seq]').count(), 0, '남의 세션의 줄이 그려졌다');
  assert.deepEqual(unexpected(app), []);
}, UI);

check('오류가 서는 자리(목록 읽기): 세션 목록을 못 읽으면 사이드바에 사전 문구가 서고, 복구되면 사라진다 — 열어 둔 대화는 그대로다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'err-list', autonomy: 'ask' });
  const app = await openApp(t, { route: '#/s/err-list' });
  await app.pane.waitFor({ state: 'visible' });
  const note = app.$('.list-note');
  await until(async () => (await app.$('a.sess').count()) === 1, { message: '목록이 서지 않았다' });
  await t.control.inject({ op: OP.sessionsList }, { gateway_error: { code: 'QUOTA_EXCEEDED', message: 'RAW english: slow down' } }, { times: 50 });
  await until(async () => (await note.isVisible()) && /요청이 너무 많습니다/.test((await note.textContent()) ?? ''), { timeout: 20_000, message: `목록 오류의 안내가 서지 않았다: ${JSON.stringify(await note.textContent())}` });
  assert.equal(await app.pane.isVisible(), true);
  assert.equal(await app.textarea.isDisabled(), false, '목록 오류가 열어 둔 대화를 잠갔다');
  await t.control.clearInjections();
  await until(async () => !(await note.isVisible()), { timeout: 30_000, message: '복구된 뒤에도 목록 오류의 안내가 남아 있다' });
  assert.deepEqual(unexpected(app), []);
}, { ...UI, timeoutMs: 60_000 });

// ───────── 승인 답의 오류 ─────────

/** 카드가 다시 그려져 자리가 잠깐 비어도 멈추지 않게 — 컨트롤이 있고 켜져 있을 때 누른다. */
async function pressWhenReady(app, role) {
  const control = pendingCard(app).locator(`[data-role="${role}"]`);
  await until(async () => (await control.count()) === 1 && (await control.isEnabled()), { message: `${role} 컨트롤이 켜지지 않았다` });
  await control.click({ timeout: 5_000 });
}

check('오류가 서는 자리(승인 답): 이미 답한 승인(APPROVAL_NOT_FOUND)은 정상이라 경고 없이 카드가 닫히고, 그 밖의 오류는 카드 안 안내로 서며 컨트롤이 다시 켜진다', async (t) => {
  const { api, app } = await openAsk(t, { id: 'err-appr', scenario: 'two-approvals' });
  app.page.setDefaultTimeout(8_000); // 멈추면 어느 단계인지 이름이 남게
  await app.type('다시 시작하고 메모를 남겨 줘');
  const first = await waitCard(app);
  const firstId = await first.getAttribute('data-request-id');

  // 그 밖의 오류: 카드 안에 한국어 안내가 서고 다시 답할 수 있다. 서버의 질문은 그대로 열려 있다.
  await t.control.inject({ op: OP.approvalsPost }, { gateway_error: { code: 'QUOTA_EXCEEDED', message: 'RAW english: slow down' } });
  await pressWhenReady(app, 'approve');
  const notice = pendingCard(app).locator('[data-role="notice"]');
  await until(async () => (await notice.count()) === 1 && /요청이 너무 많습니다/.test((await notice.textContent()) ?? ''), { message: '카드 안 오류 안내가 서지 않았다' });
  assert.equal(await notice.getAttribute('role'), 'status', '경고(warn) 등급 오류가 alert 로 서면 스크린 리더가 끊는다');
  assert.equal(await pendingCard(app).count(), 1);
  assert.equal((await api.session('err-appr')).pending_approvals.length, 1, '실패한 답이 서버에 닿았다');

  // 정상 오류: 서버가 "이미 처리됐거나 만료"라 답한다 — 앱은 경고를 띄우지 않고 세션을 새로 읽는다.
  await t.control.inject({ op: OP.approvalsPost }, { module_error: { code: 'APPROVAL_NOT_FOUND', message: 'RAW english: no such approval request' } });
  await pressWhenReady(app, 'deny'); // 오류 뒤에 컨트롤이 다시 켜졌다는 것도 이 기다림이 본다
  // 자리가 없을 때 getAttribute 는 기다리며 멈추므로 개수로 먼저 본다.
  const settled = async () => (await slot(app, 'already-handled').count()) === 1 || ((await pendingCard(app).count()) === 1 && (await pendingCard(app).getAttribute('data-request-id')) !== firstId);
  await until(settled, { message: '이미 처리된 승인이 카드에서 정리되지 않았다' });
  assert.equal(await app.$('[data-role="notice"]').count(), 0, 'APPROVAL_NOT_FOUND 에 경고를 띄웠다 — 이 오류는 정상이다');
  assert.equal(await app.$('.appr-notice.err').count(), 0);
  assert.deepEqual(unexpected(app), []);
}, UI);

// ───────── 준비 단계의 오류 ─────────

const guide = (app) => app.$('[data-role="readiness-guide"]');

for (const [label, effect, phrase] of [
  ['MODULE_UNAVAILABLE(모듈 정지)', { gateway_error: { code: 'MODULE_UNAVAILABLE', message: 'RAW english: module is stopped' } }, /에이전트 모듈이 꺼져 있습니다/],
  ['UNAUTHORIZED(로그인 세션 끝)', { gateway_error: { code: 'UNAUTHORIZED', message: 'RAW english: session ended' } }, /로그인 세션이 끝났습니다/],
  ['AGENT_UNAVAILABLE(모듈이 처리하지 못함)', { module_error: { code: 'AGENT_UNAVAILABLE', message: 'RAW english: store failed' } }, /에이전트 모듈이 지금 처리할 수 없습니다/],
  ['연결 끊김(응답 없음)', { drop: 'before' }, /연결할 수 없습니다/],
]) {
  check(`오류가 서는 자리(준비 상태): status.get 이 ${label}이면 첫 단계가 그 말을 하고 나머지는 앞 단계를 먼저 해결하라고 하며, 세션은 부르지 않고 새 세션이 꺼진다 — 복구되면 "다시 확인"으로 준비됨이 된다`, async (t) => {
    await t.control.inject({ op: 'io.terra.agent.status.get' }, effect, { times: 50 });
    const app = await openApp(t, {});
    await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비 안 됨'), { message: '준비 안 됨이 서지 않았다' });
    const steps = guide(app).locator('.step');
    assert.equal(await steps.count(), 6);
    assert.equal(await steps.first().getAttribute('class'), 'step bad');
    assert.match((await steps.first().locator('.st-title').textContent()) ?? '', phrase);
    assert.match((await guide(app).locator('.guide-headline').textContent()) ?? '', phrase, '머리글이 막힌 단계의 말을 하지 않는다');
    for (let i = 1; i < 6; i += 1) assert.match((await steps.nth(i).locator('.st-title').textContent()) ?? '', /앞 단계를 먼저 해결해 주세요/);
    assert.equal(await app.$('[data-role="new-session"]').getAttribute('aria-disabled'), 'true');
    const ops = new Set((await t.control.requests('')).map((r) => r.op));
    for (const forbidden of [OP.sessionsList, OP.sessionsGet, OP.sessionsPost, OP.messagesList, OP.messagesPost, 'io.terra.agent.models.list', 'io.terra.agent.credentials.get']) {
      assert.ok(!ops.has(forbidden), `모듈이 답하지 않는데 ${forbidden} 를 불렀다`);
    }

    // 복구: 주입을 걷고 "다시 확인"을 누른다.
    await t.control.clearInjections();
    await guide(app).getByRole('button', { name: '다시 확인' }).click();
    await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비됨'), { message: '복구한 뒤 "다시 확인"으로 준비됨이 되지 않았다' });
    assert.equal(await app.$('[data-role="new-session"]').getAttribute('aria-disabled'), 'false');
    // 끊긴 연결은 브라우저가 실패한 요청으로 기록한다 — 일부러 끊은 것이다.
    assert.deepEqual(unexpected(app).filter((p) => effect.drop === undefined || !/ERR_EMPTY_RESPONSE/.test(p)), []);
  }, UI);
}

check('오류가 서는 자리(UNAUTHORIZED): 로그인이 끝난 채(엄격 Gateway, 토큰 없음) 열면 준비 상태가 "로그인 세션이 끝났습니다"를 말하고 첫 호출 말고는 부르지 않는다', async (t) => {
  await t.control.config({ strict_gateway: true });
  const app = await openApp(t, { login: '0' });
  await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비 안 됨'), { message: '준비 안 됨이 서지 않았다' });
  assert.match((await guide(app).locator('.guide-headline').textContent()) ?? '', /로그인 세션이 끝났습니다/);
  assert.equal(await app.$('[data-role="new-session"]').getAttribute('aria-disabled'), 'true');
  assert.deepEqual((await t.control.requests('')).map((r) => [r.op, r.status]), [['io.terra.agent.status.get', 401]]);
  assert.deepEqual(unexpected(app), []);
}, UI);

check('오류가 서는 자리(UNAUTHORIZED, 세션 도중): 쓰는 중에 로그인이 끝나면 목록에 사전 문구가 서고, 보내려 하면 보내기 직전 읽기가 막혀 글은 가지 않으며 입력은 남는다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'err-401', autonomy: 'ask' });
  const app = await openApp(t, { route: '#/s/err-401' });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 열리지 않았다' });
  const note = app.$('.list-note');
  const ended = { gateway_error: { code: 'UNAUTHORIZED', message: 'RAW english: the session is missing or has ended' } };
  await t.control.inject({ op: OP.sessionsList }, ended, { times: 50 });
  await until(async () => (await note.isVisible()) && /로그인 세션이 끝났습니다/.test((await note.textContent()) ?? ''), { timeout: 20_000, message: `목록의 로그인 끝 안내가 서지 않았다: ${JSON.stringify(await note.textContent())}` });

  await t.control.inject({ op: OP.sessionsGet }, ended, { times: 50 });
  const before = await mark(t);
  await app.type('보낼 글');
  const notice = app.$('[data-role="composer-notice"]');
  await until(async () => (await notice.isVisible()) && /로그인 세션이 끝났습니다/.test((await notice.textContent()) ?? ''), { message: `보내기 직전 읽기의 안내가 서지 않았다: ${JSON.stringify(await notice.textContent())}` });
  assert.equal((await requestsOf(t, OP.messagesPost, before)).length, 0, '확인하지 못했는데 messages.post 가 갔다');
  assert.equal(await app.textarea.inputValue(), '보낼 글');
  assert.deepEqual(unexpected(app), []);
}, { ...UI, timeoutMs: 60_000 });
