// 보내기 직전 가드(함정 6, `src/data/send-guard.ts`).
//
// 대기 승인이 있을 때 모듈은 "y"·"n"·"approve"·"deny"(+ 낱말 하나)를 글이 아니라 승인 답으로 읽는다(loop.go answerText).
// 앱이 폴링으로 늦게 알아 입력이 아직 열려 있을 때 사용자가 "y" 를 보내면, 카드를 보지도 않은 채 승인이 된다.
// 그래서 앱은 보내기 직전에 sessions.get 으로 pending_approvals 를 **다시 읽고**, 있으면 보내지 않는다(승인은 approvals.post 로만, I8).

import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };

/** 앱이 열려 있고 입력이 열린 idle 세션. */
async function openIdle(t, id, scenario) {
  const api = agentApi(t);
  await api.open({ id, autonomy: 'ask', scenario });
  const app = await openApp(t, { route: `#/s/${id}` });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 열리지 않았다' });
  return { api, app };
}

/** 주입이 모두 소비될 때까지(= 앱의 폴링이 그 요청을 보냈다). */
const injectionsDrained = (t) => until(async () => (await t.control.call('GET', '/inject')).injections.length === 0, { message: '주입한 요청이 앱에서 오지 않았다' });

for (const typed of ['y', 'Deny please']) {
  check(`함정 6: 앱이 대기 승인을 늦게 알아 입력이 열려 있을 때 "${typed}" 를 보내도 보내기 직전 sessions.get 이 막는다 — messages.post 가 가지 않고 승인도 되지 않는다`, async (t) => {
    const { api, app } = await openIdle(t, 'trap6', 'two-approvals');
    // 앱의 다음 폴링을 붙잡는다. 폴링은 sessions.get(idle 을 읽는다) 다음에 messages.list 를 부르는데, 그 기록 읽기가 응답 없이
    // 걸려 있는 동안 앱은 새 판독을 저장하지 못해 마지막 판독이 "idle" 로 굳는다(폴링 지연). 걸리는 것은 기록 읽기뿐이라
    // 보내기 직전의 sessions.get 은 막히지 않는다(같은 주소의 요청은 브라우저가 앞의 것 뒤에 세우므로 sessions.get 은 걸 수 없다).
    await t.control.inject({ op: OP.messagesList }, { hang: true });
    await injectionsDrained(t);

    // 그 사이 다른 쪽(다른 창·다른 기기)이 말을 걸어 서버에 대기 승인이 선다. 앱은 아직 모른다.
    await api.say('trap6', '다시 시작하고 메모를 남겨 줘');
    await api.waitState('trap6', 'waiting-approval');
    assert.equal((await api.session('trap6')).pending_approvals.length, 1);
    assert.equal(await app.textarea.isDisabled(), false, '앱이 이미 알아 버렸다 — 폴링 지연을 만들지 못했다');
    assert.equal(await app.$('.appr').count(), 0, '앱이 카드를 그렸다 — 폴링 지연을 만들지 못했다');

    const before = await mark(t);
    await app.type(typed);
    const notice = app.$('[data-role="composer-notice"]');
    await until(async () => (await notice.isVisible()) && /대기 중인 승인이 있습니다/.test((await notice.textContent()) ?? ''), { message: '가드의 안내가 서지 않았다' });
    assert.equal(await notice.getAttribute('role'), 'status');
    assert.match(await notice.getAttribute('class'), /warn/);

    // 보내기 직전에 세션을 다시 읽었고, 글은 가지 않았다.
    assert.ok((await requestsOf(t, OP.sessionsGet, before)).length >= 1, '보내기 직전에 sessions.get 을 부르지 않았다');
    assert.equal((await requestsOf(t, OP.messagesPost, before)).length, 0, '가드가 막았는데 messages.post 가 갔다');
    assert.equal(await app.textarea.inputValue(), typed, '막힌 글이 입력칸에서 사라졌다 — 사용자가 쓴 것을 잃는다');

    // 서버: 승인 답으로 읽히지 않았다. 대기는 그대로이고 사람 글도 쌓이지 않았다.
    const after = await api.session('trap6');
    assert.equal(after.state, 'waiting-approval');
    assert.equal(after.pending_approvals.length, 1, '대기 승인이 사라졌다 — 글이 승인 답으로 읽혔다');
    const entries = await api.entries('trap6');
    for (const kind of ['approved', 'denied']) assert.equal(entries.filter((e) => e.kind === kind).length, 0, `${kind} 줄이 쌓였다`);
    assert.deepEqual(entries.filter((e) => e.kind === 'user').map((e) => e.text), ['다시 시작하고 메모를 남겨 줘'], `사람 글이 더 쌓였다: ${typed}`);
    assert.deepEqual((await t.control.calls()).filter((c) => c.reached), [], '승인되지 않았는데 호출이 Gateway 에 닿았다');
  }, UI);
}

check('보내기 직전 가드: 대기 승인이 없으면 "y" 도 일반 글로 간다 — 보내기 직전에 sessions.get 을 부르고 그 뒤에 messages.post 가 한 번 간다', async (t) => {
  const { api, app } = await openIdle(t, 'trap6-idle', 'read-only-answer');
  const before = await mark(t);
  await app.type('y');
  await until(async () => (await app.lineKinds()).includes('user'), { message: '보낸 글이 기록에 오르지 않았다' });
  const posts = await requestsOf(t, OP.messagesPost, before);
  assert.equal(posts.length, 1);
  const gets = await requestsOf(t, OP.sessionsGet, before);
  assert.ok(gets.some((r) => r.n < posts[0].n), '보내기 전에 sessions.get 으로 확인하지 않았다');
  const entries = await api.entries('trap6-idle');
  assert.deepEqual(entries.filter((e) => e.kind === 'user').map((e) => e.text), ['y']);
  assert.equal(entries.filter((e) => e.kind === 'approved' || e.kind === 'denied').length, 0);
  await until(async () => (await api.session('trap6-idle')).state === 'idle', { message: '차례가 끝나지 않았다' });
  assert.equal(await app.$('[data-role="composer-notice"]').isVisible(), false, '정상 전송에 안내가 떴다');
  assert.deepEqual(app.problems.all(), []);
}, UI);
