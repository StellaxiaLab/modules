// 폴링에서 줄이 빠지거나 겹치지 않는다(계획서 WP-4 완료 조건) — 기록 읽기(`messages.list`)가 중간에 실패하거나 느려도 마지막에 화면의 줄이
// 서버의 기록과 한 줄씩 같다. 브리지에는 스트림이 없어 폴링이 유일한 길이다(함정 3). 1200줄 쪽 넘김은 `scroll.e2e.mjs` 가 본다.
//
// 시간은 모두 실제 시간이다(앱의 타이머는 밖에서 감을 수 없다). 그래서 "얼마 뒤에 다시"는 **아래쪽 경계**(그보다 일찍 다시 부르면 안 된다)로만 단언하고,
// 끝나기를 기다리는 것은 `until()` 이다.

import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };

const afterSeqOf = (request) => Number(new URL(request.path, 'http://x.invalid').searchParams.get('after_seq') ?? 0);

/** 화면의 줄이 서버의 기록과 한 줄씩 같은가 — 빠짐도 겹침도 없다. */
async function assertSameAsServer(app, api, id) {
  const server = (await api.entries(id)).map((e) => [e.seq, e.kind]);
  const shown = (await app.lines()).map((l) => [l.seq, l.kind]);
  assert.deepEqual(shown, server, '화면의 줄이 서버의 기록과 다르다');
  const seqs = shown.map(([seq]) => seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'seq 가 1부터 빠짐없이 이어지지 않는다');
  assert.equal(await app.$('.line[data-seq]').evaluateAll((els) => new Set(els.map((el) => el.dataset.seq)).size), seqs.length, '같은 seq 의 줄이 둘 이상 그려졌다');
}

check('폴링 중 기록 읽기가 중간에 실패: 실패가 이어지는 동안 백오프(2초·4초…)로 늦춰 부르고 같은 지점부터 다시 읽으며, 복구되면 줄이 빠짐·겹침 없이 서버와 같아진다', async (t) => {
  await t.control.config({ model_delay_ms: 1000 }); // 차례가 폴링 몇 번 동안 이어지게
  const api = agentApi(t);
  await api.open({ id: 'poll-fail', scenario: 'read-only-answer' });
  const app = await openApp(t, { route: '#/s/poll-fail' });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 열리지 않았다' });

  const before = await mark(t);
  // 보낸 직후의 읽기 둘(보내기 흐름의 읽기 하나, 곧바로 이어지는 폴링 하나)은 지나가게 하고 — 줄이 몇 줄 오른 뒤 —
  // 그 다음 폴링 세 번을 실패시킨다. 실패가 모두 폴링 몫이어야 백오프 간격을 잴 수 있다.
  await t.control.inject({ op: OP.messagesList }, { module_error: { code: 'AGENT_UNAVAILABLE', message: 'RAW english: storage failed' } }, { skip: 2, times: 3 });
  await app.type('목록을 보고 답해 줘');
  await until(async () => (await t.control.call('GET', '/inject')).injections.length === 0, { timeout: 25_000, message: '주입한 세 번의 실패가 다 쓰이지 않았다' });
  await until(async () => (await api.session('poll-fail')).state === 'idle', { message: '차례가 끝나지 않았다' });
  // 서버는 끝났는데 화면은 아직 못 따라온 때가 있다 — 복구되면 따라온다.
  await until(async () => (await app.lineKinds()).includes('done'), { timeout: 15_000, message: '복구된 뒤에도 마지막 줄(done)이 화면에 오르지 않았다' });
  await assertSameAsServer(app, api, 'poll-fail');

  const reads = await requestsOf(t, OP.messagesList, before);
  const failed = reads.filter((r) => r.status === 503);
  assert.equal(failed.length, 3, `기록 읽기가 정확히 세 번 실패해야 한다: ${reads.map((r) => r.status)}`);
  // 백오프: 실패가 이어질수록 늦게 부른다(2초 → 4초). 아래쪽 경계만 본다 — 타이머는 늦을 수는 있어도 일찍 울리지 않는다.
  const gaps = [failed[1].at - failed[0].at, failed[2].at - failed[1].at];
  assert.ok(gaps[0] >= 1800, `첫 실패 뒤 ${gaps[0]}ms 만에 다시 불렀다 — 2초 백오프가 아니다`);
  assert.ok(gaps[1] >= 3800, `둘째 실패 뒤 ${gaps[1]}ms 만에 다시 불렀다 — 4초 백오프가 아니다`);
  // 같은 지점부터 다시 읽는다: 실패한 요청들과 그 다음 성공의 after_seq 가 같다(건너뛰지 않는다).
  const recovered = reads.find((r) => r.n > failed[2].n && r.status === 200);
  assert.ok(recovered, '복구 뒤의 성공한 읽기가 없다');
  assert.deepEqual(failed.map(afterSeqOf), [afterSeqOf(failed[0]), afterSeqOf(failed[0]), afterSeqOf(failed[0])]);
  assert.equal(afterSeqOf(recovered), afterSeqOf(failed[0]), '실패한 지점을 건너뛰고 읽었다');
  // 보낸 글은 한 번만 나갔다 — 폴링 실패가 보내기를 되풀이시키지 않는다.
  assert.equal((await requestsOf(t, OP.messagesPost, before)).length, 1);
  assert.equal((await api.session('poll-fail')).state, 'idle');
  // 일부러 만든 503 만 있다.
  assert.deepEqual(app.problems.all().filter((p) => !/^HTTP 503:/.test(p) && !/Failed to load resource/.test(p)), []);
}, { ...UI, timeoutMs: 60_000 });

check('폴링 중 기록 읽기가 느림: 응답이 늦어도 줄이 빠지거나 겹치지 않고, 앞의 읽기가 끝나기 전에 다음 읽기를 겹쳐 부르지 않는다', async (t) => {
  await t.control.config({ model_delay_ms: 700 });
  const api = agentApi(t);
  await api.open({ id: 'poll-slow', scenario: 'read-only-answer' });
  const app = await openApp(t, { route: '#/s/poll-slow' });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 열리지 않았다' });

  // 앞의 읽기가 응답하기 전에 다음 읽기가 오면 "겹침"이다. 서버가 요청을 받은 때(at)와 응답을 늦춘 시간으로 겹침 여부를 센다.
  const DELAY = 900;
  await t.control.inject({ op: OP.messagesList }, { delay_ms: DELAY }, { times: 6 });
  const before = await mark(t);
  await app.type('목록을 보고 답해 줘');
  await until(async () => (await api.session('poll-slow')).state === 'idle', { message: '차례가 끝나지 않았다' });
  await until(async () => (await app.lineKinds()).includes('done'), { timeout: 15_000, message: '마지막 줄(done)이 화면에 오르지 않았다' });
  await assertSameAsServer(app, api, 'poll-slow');

  // 느린 읽기를 세 번 이상 겪을 때까지(차례가 끝난 뒤의 느린 폴링도 센다).
  const delayedReads = async () => (await requestsOf(t, OP.messagesList, before)).filter((r) => r.injected);
  await until(async () => (await delayedReads()).length >= 3, { timeout: 20_000, message: '느린 읽기를 세 번 겪지 못했다' });
  const delayed = await delayedReads();
  // 보내기 흐름의 읽기(store.send)는 폴링과 따로 불리므로 첫 쌍은 빼고, 폴링끼리의 간격을 본다.
  // 이전 읽기는 at 에 도착해 DELAY 만큼 늦게 응답했다. 다음 폴링은 그 응답이 끝난 뒤에 와야 한다.
  for (let i = 2; i < delayed.length; i += 1) {
    const gap = (delayed[i]?.at ?? 0) - (delayed[i - 1]?.at ?? 0);
    assert.ok(gap >= DELAY - 50, `읽기가 겹쳤다: ${gap}ms 간격`);
  }
  assert.equal((await requestsOf(t, OP.messagesPost, before)).length, 1);
  assert.deepEqual(app.problems.all(), []);
}, { ...UI, timeoutMs: 60_000 });
