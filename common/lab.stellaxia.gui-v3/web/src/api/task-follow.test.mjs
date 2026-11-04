// node --test — 작업 출력 따라가기(SSE · 폴링) · SSE 읽기 · 바뀐 줄 찾기
import test from 'node:test';
import assert from 'node:assert/strict';
import { sseParser } from './sse.js';
import { emptyLog, applyEvent, applyPoll, endLine, followTask, MAX_LINES } from './task-follow.js';
import { diffRows, diffSigns, signMap } from './changes.js';

test('sseParser — 나눠 온 조각 · 주석 · id 이어짐 · JSON data', () => {
  const P = sseParser();
  assert.deepEqual(P.feed(': subscribed terra.task-output.v1\n\nid: 3\nevent: out'), []);
  const a = P.feed('put\ndata: {"stream":"stdout","text":"hi\\n"}\n\nevent: state\ndata: {"state":"succeeded","exit_code":0}\n\n');
  assert.deepEqual(a.map((e) => [e.id, e.event, e.data]), [['3', 'output', { stream: 'stdout', text: 'hi\n' }], ['3', 'state', { state: 'succeeded', exit_code: 0 }]]);
  assert.deepEqual(P.comments, ['subscribed terra.task-output.v1']);
  assert.deepEqual(P.feed('data: plain\r\n\r\n').map((e) => [e.event, e.data]), [['message', 'plain']]);
});

test('applyEvent — output · gap · state · end · overflow, 다시 붙어 겹친 seq 는 버린다', () => {
  let L = emptyLog();
  L = applyEvent(L, { id: '1', event: 'output', data: { stream: 'stdout', at: '2026-11-04T01:02:03Z', text: 'a\n' } });
  L = applyEvent(L, { id: '2', event: 'output', data: { stream: 'stderr', text: 'b' } });
  L = applyEvent(L, { id: '2', event: 'output', data: { stream: 'stderr', text: 'b' } });
  L = applyEvent(L, { event: 'gap', data: { before_seq: 5, bytes: 900 } });
  assert.deepEqual(L.lines.map((x) => [x.k, x.stream, x.text]), [['out', 'stdout', 'a'], ['out', 'stderr', 'b'], ['gap', undefined, '… 앞 900B 버림 (보관 한도 · #5 앞)']]);
  assert.equal(L.last, 2); assert.equal(endLine(L), null);
  L = applyEvent(L, { event: 'state', data: { state: 'failed', exit_code: 2 } }); L = applyEvent(L, { event: 'end', data: { last_seq: 2 } });
  assert.deepEqual(endLine(L), { text: '끝 · 실패 · exit 2', tone: 'err' });
  assert.deepEqual(endLine(Object.assign(emptyLog(), { end: true, state: 'succeeded', exit: 0 })), { text: '끝 · 성공 · exit 0', tone: 'ok' });
  assert.equal(endLine(Object.assign(emptyLog(), { end: true, timedOut: true })).tone, 'warn');
});

test('applyPoll — after_seq 뒤만, 버려진 앞 · 끝 · 결과', () => {
  let L = applyPoll(emptyLog(), { chunks: [{ seq: 4, stream: 'stdout', text: 'x' }, { seq: 5, stream: 'stderr', text: 'y' }], last_seq: 5, dropped: { bytes: 10 } });
  assert.deepEqual(L.lines.map((x) => x.k + ':' + (x.text || '')), ['gap:… 앞 10B 버림 (보관 한도)', 'out:x', 'out:y']);
  L = applyPoll(L, { chunks: [{ seq: 5, text: 'y' }, { seq: 6, text: 'z' }], last_seq: 6, complete: true, result: { state: 'succeeded', exit_code: 0 } });
  assert.deepEqual(L.lines.slice(-1).map((x) => x.text), ['z']); assert.equal(L.end, true); assert.equal(endLine(L).text, '끝 · 성공 · exit 0');
});

test('로그 줄 상한 — 앞을 버리고 센다', () => {
  let L = emptyLog(); const chunks = []; for (let i = 1; i <= MAX_LINES + 5; i++) chunks.push({ seq: i, text: 'l' + i });
  L = applyPoll(L, { chunks }); assert.equal(L.lines.length, MAX_LINES); assert.equal(L.cut, 5); assert.equal(L.lines[0].text, 'l6');
});

const timers = () => { const q = []; return { q, set: (f, ms) => { q.push({ f, ms }); return q.length; }, clear: () => {}, run: () => { const t = q.shift(); if (t) t.f(); } }; };
const flush = () => new Promise((r) => setTimeout(r, 0));

test('followTask — 이 노드: SSE 로 따라가다 overflow 로 닫히면 last_event_id 로 다시, end 면 멈춘다', async () => {
  const opens = [], T = timers(); let h;
  const sse = async (op, input, hh) => { opens.push([op, input]); h = hh; return () => {}; };
  const ups = []; const F = followTask({ taskId: 't1', sse, poll: async () => { throw new Error('부르면 안 됨'); }, onUpdate: (L, i) => ups.push([L.lines.length, i.mode]), setTimer: T.set, clearTimer: T.clear });
  await flush();
  h.onEvent({ id: '7', event: 'output', data: { stream: 'stdout', text: 'go' } });
  h.onEvent({ event: 'overflow', data: { last_seq: 7 } }); h.onClose();
  assert.equal(F.mode(), 'again'); T.run(); await flush();
  assert.deepEqual(opens, [['terra.daemon.tasks.by-task-id.output.events.get', { task_id: 't1' }], ['terra.daemon.tasks.by-task-id.output.events.get', { task_id: 't1', last_event_id: '7' }]]);
  h.onEvent({ event: 'state', data: { state: 'succeeded', exit_code: 0 } }); h.onEvent({ event: 'end', data: { last_seq: 7 } }); h.onClose();
  assert.equal(T.q.length, 0, '끝나면 다시 붙지 않는다'); assert.equal(F.log().end, true);
});

test('followTask — 429 TOO_MANY_STREAMS 면 폴링으로, 다른 노드(sse 없음)는 처음부터 폴링(after_seq)', async () => {
  const T = timers(), polls = [];
  const poll = async (i) => { polls.push(i); return polls.length === 1 ? { chunks: [{ seq: 1, text: 'a' }], last_seq: 1 } : { chunks: [], last_seq: 1, complete: true }; };
  let info; const F = followTask({ taskId: 't2', sse: async () => { throw Object.assign(new Error(''), { code: 'TOO_MANY_STREAMS' }); }, poll, onUpdate: (L, i) => { info = i; }, setTimer: T.set, clearTimer: T.clear });
  await flush(); await flush(); assert.equal(F.mode(), 'poll'); assert.match(info.why, /구독 한도/);
  T.run(); await flush(); await flush();
  assert.deepEqual(polls, [{ task_id: 't2', tail: '400' }, { task_id: 't2', after_seq: '1' }]); assert.equal(T.q.length, 0, '끝나면 그만 읽는다');
  const R = followTask({ taskId: 't3', poll: async () => ({ chunks: [], complete: true }), onUpdate: (L, i) => { info = i; }, setTimer: T.set, clearTimer: T.clear });
  await flush(); assert.equal(R.mode(), 'poll'); assert.match(info.why, /다른 노드 — 스트림은 이 노드에서만/);
});

test('diffRows — 처음은 없음, 그 뒤 새로 · 바뀜 · 사라짐', () => {
  const id = (r) => r.id, sig = (r) => r.st;
  assert.equal(diffRows(null, [{ id: 'a', st: 1 }], id, sig).added.size, 0);
  const d = diffRows([{ id: 'a', st: 'run' }, { id: 'b', st: 'run' }, { id: 'c', st: 'ok' }], [{ id: 'a', st: 'ok' }, { id: 'b', st: 'run' }, { id: 'd', st: 'run' }, { id: '', st: 'x' }], id, sig);
  assert.deepEqual([[...d.added], [...d.changed], [...d.removed]], [['d'], ['a'], ['c']]);
  assert.equal(diffSigns(signMap([{ id: 1, st: 'x' }], id, sig), signMap([{ id: 1, st: 'x' }], id, sig)).changed.size, 0);
});

test('terra.sse — invoke 를 Accept: text/event-stream 으로, 조각을 이벤트로, 열기 전 429 는 TerraError', async () => {
  const { createTerra } = await import('./terra.js');
  const seen = [];
  const body = (parts) => new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
  const fetch = async (path, init) => { seen.push([path, init.headers.accept, JSON.parse(init.body)]); return path.includes('busy') ? new Response(JSON.stringify({ error: { code: 'TOO_MANY_STREAMS', message: 'limit' } }), { status: 429 }) : new Response(body(['id: 1\nevent: output\ndata: {"text":"a"}\n', '\nevent: end\ndata: {}\n\n']), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
  const T = createTerra({ fetch }), evs = []; let closed = false;
  await T.sse('terra.daemon.tasks.by-task-id.output.events.get', { task_id: 'x' }, { onEvent: (e) => evs.push(e.event + ':' + JSON.stringify(e.data)), onClose: () => { closed = true; } });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen[0], ['/api/v1/operations/terra.daemon.tasks.by-task-id.output.events.get/invoke', 'text/event-stream', { task_id: 'x' }]);
  assert.deepEqual(evs, ['output:{"text":"a"}', 'end:{}']); assert.equal(closed, true);
  await assert.rejects(T.sse('busy', {}, { onEvent() {} }), (e) => e.code === 'TOO_MANY_STREAMS' && e.status === 429);
  await assert.rejects(T.sse('terra.daemon.tasks.by-task-id.output.events.get', {}, { onEvent() {}, node: 'n2' }), (e) => e.code === 'LOCAL_ONLY');
});

test('밀어 받기 — terra.sse 가 있으면 SSE 로, 다시 붙을 때 last_event_id, reset 이면 사본 전부', async () => {
  const { startPush } = await import('./push.js');
  const opens = []; let h; const refreshed = [];
  const terra = { sse: async (op, input, hh) => { opens.push([op, input]); h = hh; return () => {}; }, stream: async () => { throw new Error('WS 길은 안 쓴다'); } };
  const store = { t: { localId: () => 'L' }, cache: new Map([['L|tasks', {}], ['L|config', {}], ['L|x|{"a":1}', {}]]), refresh: (n, r) => refreshed.push(r) };
  const P = startPush({ terra, store: () => store, delayMs: 1 }); await new Promise((r) => setTimeout(r, 1));
  h.onEvent({ id: '41', event: 'terra.tasks.changed', data: { signal: 'terra.tasks.changed' } }); await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(refreshed, ['tasks']);
  h.onEvent({ id: '42', event: 'reset', data: {} }); await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(refreshed.slice(1).sort(), ['config', 'tasks']);   // 입력이 있는 읽기(x|{…})는 보드가 다시 그릴 때 받는다
  P.stop();
  assert.deepEqual(opens, [['terra.daemon.events.get', {}]]);
});
