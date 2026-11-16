// node --test — 실시간 갱신: Master 이벤트 스트림 수신 · 끊김 대비(폴링) · 닫힘(세션 만료 · 토큰 폐기) · 없음/못 봤음 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { startLive, targetsFor, failKind, liveText, shouldPoll, routeSignals, LIVE_OP } from './live-stream.js';
import { mapState } from './map-state.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const mk = () => {
  const timers = [], states = [], sigs = [], opens = []; let h = null;
  const terra = { sse: async (op, input, hh) => { opens.push([op, input]); if (terra.fail) throw terra.fail; h = hh; return () => opens.push(['close']); } };
  const o = { terra, onSignal: (s) => sigs.push(s), onState: (s) => states.push(s.state), setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearTimeout: () => {}, now: () => 1000 };
  return { terra, o, timers, states, sigs, opens, push: (e) => h.onEvent(e), drop: () => h.onClose() };
};

test('targetsFor — 신호 이름 → 다시 읽을 것', () => {
  assert.deepEqual(targetsFor({ signal: 'terra.nodes.liveness' }), ['topology']);
  assert.deepEqual(targetsFor({ signal: 'terra.modules.changed' }).sort(), ['alarms', 'modules', 'tasks']);
  assert.deepEqual(targetsFor({ signal: 'terra.svi.handles.changed' }), ['svi']);
  assert.deepEqual(targetsFor({ signal: 'terra.network.changed' }).sort(), ['net', 'topology']);
  assert.deepEqual(targetsFor({ signal: 'x.unknown' }), ['topology']);
});

test('startLive — 스트림을 열고 신호를 받는다(마지막 id 로 이어 붙는다)', async () => {
  const m = mk(); const L = startLive(m.o); await tick();
  assert.deepEqual(m.opens[0], [LIVE_OP, {}]);
  m.push({ id: '7', event: 'terra.nodes.changed', data: { signal: 'terra.nodes.changed', at: 'x', data: {} } });
  assert.equal(m.sigs.length, 1); assert.deepEqual(m.sigs[0].targets, ['topology']); assert.equal(L.state().state, 'live'); assert.equal(L.state().lastAt, 1000);
  m.push({ id: '8', event: 'message', data: null }); assert.equal(m.sigs.length, 1, '이름 없는 프레임은 신호가 아니다');
  m.drop(); assert.equal(L.state().state, 'lost'); assert.equal(m.timers[0][1], 2000);
  await m.timers[0][0](); await tick(); assert.deepEqual(m.opens.at(-1), [LIVE_OP, { last_event_id: '8' }]);
  m.push({ id: '9', event: 'reset', data: null }); assert.equal(m.sigs.at(-1).reset, true); assert.ok(m.sigs.at(-1).targets.includes('svi'), 'reset 은 전부 다시');
  L.stop(); assert.equal(L.state().state, 'stopped');
});

test('startLive — 끊김은 점점 길게 다시 열고(최대 30초) 받으면 처음으로', async () => {
  const m = mk(); startLive(m.o); await tick();
  const waits = [];
  for (let i = 0; i < 7; i++) { m.drop(); waits.push(m.timers.at(-1)[1]); await m.timers.at(-1)[0](); await tick(); }
  assert.deepEqual(waits, [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  m.push({ id: '1', event: 'terra.jobs.changed', data: { signal: 'terra.jobs.changed' } }); m.drop(); assert.equal(m.timers.at(-1)[1], 2000);
});

test('failKind — 401 · 403 은 닫힘(다시 열지 않음), 429 · 네트워크는 다시', () => {
  assert.equal(failKind({ status: 401 }).reason, 'session'); assert.equal(failKind({ status: 401 }).closed, true);
  assert.equal(failKind({ status: 403, code: 'DELEGATION_NOT_OPEN' }).reason, 'denied'); assert.match(failKind({ status: 403, code: 'DELEGATION_NOT_OPEN' }).text, /DELEGATION_NOT_OPEN/);
  assert.equal(failKind({ status: 429, code: 'TOO_MANY_STREAMS' }).closed, false); assert.equal(failKind({ code: 'NETWORK' }).closed, false);
});

test('startLive — 세션 만료 · 토큰 폐기(401)와 위임 밖(403)은 닫히고 다시 열지 않는다, restart 는 다시 연다', async () => {
  const m = mk(); m.terra.fail = Object.assign(new Error('x'), { status: 401, code: 'UNAUTHENTICATED' }); const L = startLive(m.o); await tick();
  assert.equal(L.state().state, 'closed'); assert.equal(L.state().reason, 'session'); assert.equal(m.timers.length, 0, '다시 열기를 걸지 않는다');
  m.terra.fail = null; L.restart(); await tick(); assert.equal(m.opens.length, 2); m.push({ id: '1', event: 'terra.nodes.changed', data: { signal: 'terra.nodes.changed' } }); assert.equal(L.state().state, 'live');
  const m2 = mk(); m2.terra.fail = Object.assign(new Error('x'), { status: 403, code: 'DELEGATION_NOT_OPEN' }); const L2 = startLive(m2.o); await tick(); assert.equal(L2.state().reason, 'denied'); assert.match(L2.state().text, /닫혀/);
  // 받던 중 토큰이 폐기돼 다시 열 때 401
  const m3 = mk(); const L3 = startLive(m3.o); await tick(); m3.push({ id: '1', event: 'terra.nodes.changed', data: { signal: 'terra.nodes.changed' } });
  m3.terra.fail = Object.assign(new Error('x'), { status: 401 }); m3.drop(); await m3.timers[0][0](); await tick(); assert.equal(L3.state().state, 'closed');
});

test('shouldPoll — 스트림이 받는 중이면 5번에 한 번만, 아니면 매번', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10].map((n) => shouldPoll('live', n)), [false, false, false, false, true, false, true]);
  for (const s of ['lost', 'closed', 'opening', undefined, 'stopped']) assert.equal(shouldPoll(s, 1), true, String(s));
});

test('routeSignals — 몰린 신호는 한 번에, 사본이 있는 자원만 다시 받는다', () => {
  const calls = [], T = []; const store = { t: { localId: () => 'L' }, cache: new Map([['L|terra.master.svi.resources.get|', {}], ['L|modules', {}], ['L|desk', {}], ['X|modules', {}]]), refresh: (n, r) => calls.push(n + '|' + r) };
  const on = routeSignals({ refreshTopology: () => calls.push('topo'), poke: () => calls.push('poke'), store: () => store, setTimeout: (f) => { T.push(f); return T.length; }, clearTimeout: () => {} });
  on({ targets: ['svi'], reset: false }); on({ targets: ['topology', 'alarms', 'modules'], reset: false }); T.at(-1)();
  assert.deepEqual(calls.sort(), ['L|modules', 'L|terra.master.svi.resources.get', 'poke', 'topo']); calls.length = 0;
  on({ targets: ['topology'], reset: true }); T.at(-1)(); assert.ok(calls.includes('L|desk') && calls.includes('L|modules') && !calls.includes('X|modules'), 'reset 은 이 노드 사본 전부');
});

test('liveText · mapState — 끊긴 스트림의 조용함을 "없음"으로 읽지 않는다', () => {
  assert.equal(liveText({ state: 'live' }).live, true);
  assert.match(liveText({ state: 'lost' }).text, /못 봤을 수 있음/); assert.match(liveText({ state: 'closed', text: '세션 만료' }).text, /세션 만료/);
  const rec = [{ id: 'a' }], base = { real: true, records: rec, nodeStats: () => ({ level: 'ok' }), ago: () => '방금' };
  assert.equal(mapState(Object.assign({ state: { state: 'ok', at: 1, live: { state: 'live' } } }, base)).tone, 'ok');
  const lost = mapState(Object.assign({ state: { state: 'ok', at: 1, live: { state: 'lost' } } }, base)); assert.equal(lost.tone, 'warn'); assert.match(lost.stat, /실시간 끊김/); assert.match(lost.sub, /보지 못했을 수 있습니다/);
  assert.match(mapState(Object.assign({ state: { state: 'ok', at: 1, live: { state: 'closed', text: '세션 만료' } } }, base)).head, /세션 만료/);
  const empty = mapState(Object.assign({ state: { state: 'empty', at: 1, live: { state: 'lost' } } }, base)); assert.equal(empty.card, 'empty');   // 정말 없음은 그대로
  assert.equal(mapState(Object.assign({ state: { state: 'error', at: 1, error: 'E', live: { state: 'lost' } } }, base, { records: [] })).card, 'err');
});
