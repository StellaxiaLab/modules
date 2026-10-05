// 실시간 이벤트(Terra B-5) — SSE 프레임 읽기 · 이어 받기 · 길이 없으면 끄기 · 신호 → 다시 받기.
//   npm test
// 프레임 모양은 Daemon local_api/events_sse.go 의 것이다: `: subscribed` · `id: <seq>` · `event: <signal>` · `data: {"signal","at","data"}` · `event: reset`
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { sseFrames, frameEvent, openEvents, EVENTS_OP, SIGNAL_APPS } = await import('../src/api/events.js');
const { applySignal } = await import('../src/data/node-live.js');
const { wireHelm } = await import('../src/api/wire.js');
const { HELM_APPS } = await import('../src/api/operations.js');
const { prep } = await import('../src/boot/module.js');
const { default: NodeScreen } = await import('../src/screens/node.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder();

/** 조각으로 오는 SSE 응답 — 조각 사이 경계는 프레임 중간이어도 된다 */
function sse(chunks, status = 200) {
  const body = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}
const frame = (id, sig, data) => 'id: ' + id + '\nevent: ' + sig + '\ndata: ' + JSON.stringify({ signal: sig, at: '2026-10-05T00:00:00Z', data }) + '\n\n';

test('SSE 프레임 — 주석(: subscribed · : keep-alive)은 건너뛰고, 덜 온 프레임은 남긴다 · \\r\\n 도 읽는다', () => {
  const a = sseFrames(': subscribed terra.daemon.events/v1\n\n' + frame('7', 'terra.tasks.changed', { task_id: 't1' }) + 'id: 8\nevent: terra.io');
  assert.equal(a.frames.length, 1);
  assert.deepEqual([a.frames[0].id, a.frames[0].event], ['7', 'terra.tasks.changed']);
  assert.equal(a.rest, 'id: 8\nevent: terra.io');
  const b = sseFrames(a.rest + '.devices.changed\r\ndata: {"signal":"terra.io.devices.changed","data":{"action":"scan"}}\r\n\r\n: keep-alive\n\n');
  assert.equal(b.frames.length, 1);
  const ev = frameEvent(b.frames[0]);
  assert.deepEqual([ev.id, ev.signal, ev.data.action], ['8', 'terra.io.devices.changed', 'scan']);
  assert.equal(b.rest, '');
  const r = frameEvent(sseFrames('event: reset\ndata: {"signal":"reset","data":{"reason":"last_event_id_out_of_window"}}\n\n').frames[0]);
  assert.deepEqual([r.id, r.signal, r.data.reason], [null, 'reset', 'last_event_id_out_of_window']);
});

test('openEvents — invoke 로 열고(Accept: text/event-stream), 끊기면 마지막 id 부터 이어 받는다(last_event_id · Last-Event-ID)', async () => {
  const calls = [], got = [], states = [];
  let n = 0;
  const client = {
    base: '',
    async fetch(url, init) {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      n++;
      if (n === 1) return sse([': subscribed\n\n', frame('1', 'terra.tasks.changed', {}).slice(0, 20), frame('1', 'terra.tasks.changed', {}).slice(20), frame('2', 'terra.modules.changed', { module_id: 'm' })]);
      if (n === 2) return sse([frame('3', 'terra.wireguard.changed', { action: 'apply' })]);
      return new Promise(() => {});   // 세 번째는 열린 채로
    }
  };
  const stop = openEvents(client, (e) => got.push(e.signal + '#' + e.id), { onState: (s) => states.push(s), sleep: () => Promise.resolve() });
  await sleep(30);
  stop();
  assert.equal(calls[0].url, '/api/v1/operations/' + EVENTS_OP + '/invoke');
  assert.equal(calls[0].headers.Accept, 'text/event-stream');
  assert.deepEqual(calls[0].body, {}, '처음에는 이어 받을 자리가 없다');
  assert.deepEqual(got, ['terra.tasks.changed#1', 'terra.modules.changed#2', 'terra.wireguard.changed#3'], '조각 경계가 프레임 가운데여도 한 번씩');
  assert.deepEqual([calls[1].body.last_event_id, calls[1].headers['Last-Event-ID']], ['2', '2']);
  assert.equal(calls[2].body.last_event_id, '3');
  assert.deepEqual(states.slice(0, 4), ['open', 'retry', 'open', 'retry']);
});

test('openEvents — 길이 없으면(404 · 501 · 이벤트 스트림이 아닌 답) 끄고 다시 하지 않는다 — 폴링만 남는다', async () => {
  for (const res of [() => new Response('{}', { status: 404 }), () => new Response('{}', { status: 501 }), () => new Response('{}', { status: 406, headers: { 'Content-Type': 'application/json' } })]) {
    let n = 0;
    const states = [];
    openEvents({ base: '', async fetch() { n++; return res(); } }, () => {}, { onState: (s, i) => states.push(s + ':' + (i && i.status)), sleep: () => Promise.resolve() });
    await sleep(10);
    assert.equal(n, 1);
    assert.equal(states.at(-1).split(':')[0], 'off');
  }
  // 게이트웨이가 잠시 아프다(502) — 다시 해 보다가 여섯 번째에 끈다
  let m = 0;
  const st = [];
  openEvents({ base: '', async fetch() { m++; return new Response('{}', { status: 502 }); } }, () => {}, { onState: (s) => st.push(s), sleep: () => Promise.resolve() });
  await sleep(20);
  assert.equal(m, 6);
  assert.equal(st.at(-1), 'off');
});

test('신호 → 다시 받기: 0.25초 모아서 한 번 — 작업은 알림, 장치 · 모듈은 자원 요약, 터널 · WireGuard 는 네트워크, 그 앱 목록(_hbRefresh). reset 은 다', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read'];
  const calls = [];
  const client = { catalog: new Map(), has: () => true, async invoke(op) { calls.push(op); return { kind: 'ok', data: {} }; }, async get() { return { kind: 'ok', data: {} }; } };
  const refreshed = [];
  s._hbRefresh = (apps, node) => refreshed.push(apps.slice().sort().join(',') + '@' + node);
  applySignal(s, client, { signal: 'terra.tasks.changed' }, 20);
  applySignal(s, client, { signal: 'terra.tasks.changed' }, 20);
  applySignal(s, client, { signal: 'terra.io.devices.changed' }, 20);
  await sleep(60);
  assert.equal(calls.filter((c) => c === 'terra.daemon.tasks.get').length, 1, '모아서 한 번');
  assert.ok(calls.includes('terra.daemon.io.devices.get'), '장치가 바뀌면 자원 요약을 다시');
  assert.ok(!calls.includes('terra.daemon.service-tunnels.get'));
  assert.deepEqual(refreshed, ['io,job@' + s.state.localNode.name]);
  calls.length = 0; refreshed.length = 0;
  applySignal(s, client, { signal: 'reset' }, 5);
  await sleep(40);
  ['terra.daemon.tasks.get', 'terra.daemon.io.devices.get', 'terra.daemon.service-tunnels.get', 'terra.daemon.config.schema.get'].forEach((op) => assert.ok(calls.includes(op), op));
  assert.deepEqual(refreshed[0].split('@')[0].split(','), Object.keys(HELM_APPS).sort());
  // 로그인 전 · 로그아웃 뒤의 신호는 버린다
  s.__real.perms = null;
  calls.length = 0;
  applySignal(s, client, { signal: 'terra.tasks.changed' }, 5);
  await sleep(20);
  assert.equal(calls.length, 0);
  // 신호 표 — 조타륜 앱 이름만
  Object.values(SIGNAL_APPS).flat().forEach((a) => assert.ok(a in HELM_APPS, a));
});

test('wire — 실시간 신호는 받아 둔 목록만 다시 받는다(_hbRefresh). 끊으면 지운다 · 열려 있으면 폴링은 여섯 배 느리게', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'node.control'];
  s.__client = { has: () => true };
  const local = s.state.localNode.name, lists = { io: [{ id: 'd1', name: 'cam', kind: 'camera', presence: 'present', approval: 'approved', enabled: true }] };
  const asked = [];
  const src = { mock: false, localNode: local, async list(node, app) { asked.push(node + '|' + app); return (lists[app] || []).slice(); }, async act() { return { kind: 'ok' }; } };
  let open = true;
  const unwire = wireHelm(s, src, { pollMs: 5000, live: () => open });
  s._hbRefresh(['io'], local);
  await sleep(10);
  assert.deepEqual(asked, [], '받은 적 없는 목록은 신호로 열지 않는다');
  // 받아 둔 목록 하나를 만든다 — 상태 화면이 보는 자원처럼
  s.setState({ rsrc: { '3-3': { node: local, app: 'io', id: 'd1', name: 'cam' } } });
  await sleep(500);
  const first = asked.length;
  assert.ok(first >= 1, '설치한 자원의 앱은 처음 한 번 받는다');
  s._hbRefresh(['io', 'job'], local);
  s._hbRefresh(['io'], 'other-node');
  await sleep(10);
  assert.equal(asked.length, first + 1, '그 노드의 그 앱만 다시');
  await sleep(500);
  assert.equal(asked.length, first + 1, '이벤트가 열려 있으면 폴링(5초)을 서른 초로 늦춘다 — 0.5초 사이에 더 부르지 않는다');
  unwire();
  assert.equal(s._hbRefresh, undefined);
  open = false;
});
