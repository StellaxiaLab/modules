// 이전 모듈 모양과 오류 문장 — 앱이 아직 새 필드(M-2~M-7)를 내지 않는 모듈에 붙었을 때도 화면이 거짓말하지 않는가.
// `features({...:false})` 는 가짜 모듈이 그 필드를 응답에서 뺀다(계획서 §4). 화면은 없는 것을 "없다/적지 않았다/근사"로 말해야 하고,
// 영어 문장(`last_error`)에서 오류 코드를 추측하지 않는다(함정 5, GAP-7).

import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';
import { openAsk, slot, waitCard } from '../lib/cards.mjs';

const UI = { apps: ['ui'] };
const ALL_OFF = { contract: false, expires: false, reasonJudgement: false, lastErrorCode: false, modelFields: false };

/** 값이 없는 칸을 그대로 글자로 찍는 실수(undefined·null·NaN·[object …])가 화면 어디에도 없다. */
async function assertNoLeakedValues(app) {
  const text = (await app.f.locator('body').innerText()).replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /undefined|\bnull\b|NaN|\[object /, `화면에 값이 새어 나왔다: ${(/.{0,30}(undefined|\bnull\b|NaN|\[object ).{0,30}/.exec(text) ?? [''])[0]}`);
}

/**
 * `pending_approvals[].judgement`(M-4)가 없어도 판정 근거는 기록의 `approval` 줄의 `note` 에 실려 온다 — 카드는 거기서 읽는다(cards.ts).
 * 둘 다 없을 때의 "판정 근거도 오지 않았습니다" 표시는 화면 단위 시험이 본다.
 */
async function assertJudgementFromRecord(card) {
  assert.equal(await card.locator('.appr-judge .dim').count(), 1, '머리말 말고는 흐린 글(= 판정 없음)이 없어야 한다');
  assert.match((await card.locator('.appr-judge').textContent()) ?? '', /autonomy=ask/);
}

/** 카드가 선 상태까지 가서 카드를 돌려준다. */
async function cardOf(t, features, id) {
  await t.control.features(features);
  const { app } = await openAsk(t, { id, scenario: 'approval-flow' });
  await app.type('io.terra.chat 을 다시 시작해 줘');
  return { app, card: await waitCard(app) };
}

/** 한 판을 끝까지 승인해 본다 — 필드가 없어도 승인 길은 그대로여야 한다. */
async function approveAndFinish(t, app, card) {
  const before = await mark(t);
  await card.locator('[data-role="approve"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '승인 뒤 차례가 끝나지 않았다' });
  await app.waitChip('대기');
  assert.equal((await requestsOf(t, OP.approvalsPost, before)).length, 1);
  assert.equal(await slot(app, 'approved').count(), 1);
  assert.equal((await t.control.calls()).filter((c) => c.reached).length, 1);
}

check('이전 모듈 모양(M-2·M-3·M-4·M-6·M-7 모두 없음): 카드는 계약 없음·근사 마감·이유 없음으로 말하고 판정 근거는 기록의 approval 줄에서 읽으며, 승인 한 판은 그대로 돈다 — 없는 값을 글자로 찍지 않는다', async (t) => {
  const { app, card } = await cardOf(t, ALL_OFF, 'old-all');
  const [pending] = (await agentApi(t).session('old-all')).pending_approvals;
  for (const key of ['contract', 'expires_ms', 'reason', 'judgement']) assert.equal(key in pending, false, `가짜 서버가 ${key} 를 빼지 않았다`);

  assert.equal(await card.locator('.facts').getAttribute('data-contract'), 'unreadable');
  assert.equal(await card.locator('.claim-text .dim').count(), 1, '이유가 없는데 모델의 주장 칸이 채워져 있다');
  await assertJudgementFromRecord(card);
  const clock = card.locator('[data-role="clock"]');
  assert.notEqual(await clock.getAttribute('data-approximate'), null, 'expires_ms 가 없는데 정확한 마감인 것처럼 그렸다');
  assert.match((await clock.locator('[data-role="clock-vis"]').textContent()) ?? '', /^약 \d+:\d{2}$/);
  assert.equal(await card.locator('[data-role="approve"]').isEnabled(), true, '필드가 없다고 답할 길을 막았다');
  await assertNoLeakedValues(app);

  await approveAndFinish(t, app, card);
  assert.equal(await app.lastError.isVisible(), false);
  await assertNoLeakedValues(app);
  assert.deepEqual(app.problems.all(), []);
}, UI);

for (const [flag, label, verify] of [
  [
    'contract',
    'M-2 contract',
    async (card) => {
      assert.equal(await card.locator('.facts').getAttribute('data-contract'), 'unreadable');
      assert.equal(await card.locator('.claim-text .dim').count(), 0, '계약만 빠졌는데 이유 칸이 비었다');
      assert.equal(await card.locator('[data-role="clock"]').getAttribute('data-approximate'), null);
    },
  ],
  [
    'expires',
    'M-3 expires_ms',
    async (card) => {
      assert.equal(await card.locator('.facts').getAttribute('data-contract'), 'known');
      const clock = card.locator('[data-role="clock"]');
      assert.notEqual(await clock.getAttribute('data-approximate'), null, '마감을 모듈이 안 알려 줬는데 정확하다고 말한다');
      assert.match((await clock.locator('[data-role="clock-vis"]').textContent()) ?? '', /^약 \d+:\d{2}$/);
      assert.match((await clock.getAttribute('title')) ?? '', /근사/);
    },
  ],
  [
    'reasonJudgement',
    'M-4 reason·judgement',
    async (card) => {
      assert.equal(await card.locator('.facts').getAttribute('data-contract'), 'known');
      assert.equal(await card.locator('.claim-text .dim').count(), 1);
      await assertJudgementFromRecord(card);
      assert.equal(await card.locator('[data-role="clock"]').getAttribute('data-approximate'), null);
    },
  ],
]) {
  check(`이전 모듈 모양(${label} 만 없음): 카드가 빠진 칸만 "없다"고 말하고 나머지는 그대로 선다`, async (t) => {
    const { app, card } = await cardOf(t, { [flag]: false }, `old-${flag}`);
    await verify(card);
    await assertNoLeakedValues(app);
    await approveAndFinish(t, app, card);
    assert.deepEqual(app.problems.all(), []);
  }, UI);
}

check('이전 모듈 모양(M-7 model 줄의 provider·model 구조 필드 없음): 모델 줄이 값 없이 그려지지 않는다 — 승인 한 판이 그대로 돈다', async (t) => {
  const { app, card } = await cardOf(t, { modelFields: false }, 'old-model');
  const entries = await agentApi(t).entries('old-model');
  const model = entries.find((e) => e.kind === 'model');
  assert.equal('provider' in model || 'model' in model, false, '가짜 서버가 구조 필드를 빼지 않았다');
  assert.equal(await app.$('.line[data-kind="model"] .ev').count() >= 1, true);
  await assertNoLeakedValues(app);
  await approveAndFinish(t, app, card);
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ───────── last_error 영어 문장 → 코드 사전 (함정 5, GAP-7) ─────────

/** 영어 원문이 접힌 `<details>` 밖에 글자로 나와 있는가. */
const englishOutsideDetails = (app, needle) =>
  app.f.evaluate((text) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.textContent ?? '').includes(text) && !node.parentElement?.closest('details')) found.push(node.parentElement?.className ?? '');
    }
    return found;
  }, needle);

for (const [features, label] of [
  [{}, '새 모듈(last_error_code 있음)'],
  [{ lastErrorCode: false }, '이전 모듈(last_error_code 없음)'],
]) {
  check(`last_error 영어 문장 → 코드 사전: 모델 실패(failed)는 ${label}에서도 상태 옆에 코드 MODEL_UNAVAILABLE 이 서고 영어 문장은 접힌 원문에만 있다`, async (t) => {
    await t.control.features(features);
    const api = agentApi(t);
    await api.open({ id: 'le-fail', scenario: 'model-failure' });
    await api.say('le-fail', '모델이 죽는다');
    await api.waitState('le-fail', 'failed');
    const snapshot = await api.session('le-fail');
    assert.match(snapshot.last_error, /anthropic API returned 529/, '가짜 서버의 last_error 는 영어 문장이다');
    assert.equal('last_error_code' in snapshot, features.lastErrorCode !== false);

    const app = await openApp(t, { route: '#/s/le-fail' });
    await app.pane.waitFor({ state: 'visible' });
    await app.waitChip('실패');
    await until(async () => (await app.lastError.isVisible()) && (await app.lastError.textContent()).trim() === 'MODEL_UNAVAILABLE', { message: '상태 옆에 코드가 서지 않았다' });
    // 오류 줄: 사전의 한국어 문구가 머리말이고 코드 칩이 붙는다. 영어 원문은 접힌 상세에만 있다.
    const line = app.$('.line[data-kind="error"]');
    assert.equal(await line.count(), 1);
    assert.match((await line.locator('.err-head b').textContent()) ?? '', /모델 호출이 실패했습니다/);
    assert.equal(await line.locator('.err-head .chip.err').textContent(), 'MODEL_UNAVAILABLE');
    const raw = line.locator('details');
    assert.equal(await raw.count(), 1);
    assert.equal(await raw.evaluate((el) => el.open), false, '영어 원문이 펼쳐져 있다');
    assert.match((await raw.textContent()) ?? '', /anthropic API returned 529/);
    assert.deepEqual(await englishOutsideDetails(app, 'anthropic API returned 529'), [], '영어 원문이 접힌 상세 밖에 나왔다');
    assert.equal((await app.$('a.sess[aria-current="page"] .sess-err').textContent()).trim(), 'MODEL_UNAVAILABLE');
    assert.deepEqual(app.problems.all(), []);
  }, UI);
}

check('last_error 영어 문장 → 코드 사전: 이전 모듈의 목록 행은 기록을 읽기 전에는 코드를 모른다고 두고(문장에서 추측하지 않는다), 세션을 열어 기록을 읽으면 코드가 선다', async (t) => {
  await t.control.features({ lastErrorCode: false });
  const api = agentApi(t);
  await api.open({ id: 'le-dead', scenario: 'model-failure' });
  await api.say('le-dead', '모델이 죽는다');
  await api.waitState('le-dead', 'failed');
  await api.open({ id: 'le-live' });

  const app = await openApp(t, { route: '#/s/le-live' });
  await app.pane.waitFor({ state: 'visible' });
  await app.$('#tab-ended').click();
  const row = app.$('a.sess[href="#/s/le-dead"]');
  await row.waitFor({ state: 'visible' });
  const err = row.locator('.sess-err');
  assert.equal(await err.isVisible(), false, '기록을 읽지 않은 세션의 행이 코드를 말한다 — 영어 문장에서 추측했다');
  assert.equal(((await err.textContent()) ?? '').trim(), '');
  assert.deepEqual(await englishOutsideDetails(app, 'API returned 529'), [], '목록 행에 영어 문장이 나왔다');

  await row.click();
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => (await app.lastError.isVisible()) && (await app.lastError.textContent()).trim() === 'MODEL_UNAVAILABLE', { message: '열고 기록을 읽었는데 코드가 서지 않았다' });
  await until(async () => (await row.locator('.sess-err').isVisible()) && ((await row.locator('.sess-err').textContent()) ?? '').trim() === 'MODEL_UNAVAILABLE', { message: '기록을 읽은 뒤에도 목록 행에 코드가 없다' });
  assert.deepEqual(app.problems.all(), []);
}, UI);
