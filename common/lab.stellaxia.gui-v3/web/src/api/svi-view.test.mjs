// node --test — 자원 상태 창 값 보기: 형식 → 뷰어, 메시지 → 화면 값, 구독 · 다시 붙기
import test from 'node:test';
import assert from 'node:assert/strict';
import { WATCH_OPS, viewerOf, b64bytes, hexRows, streamMsg, frameValue, viewInit, reduceView, connLabel, numStats, fpsOf, createSviWatch } from './svi-view.js';
import MD from './master-delegated.json' with { type: 'json' };

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const F = (seq, data, extra = {}) => Object.assign({ kind: 'frame', handle_id: 'h1', sequence: seq, data: b64(data) }, extra);

test('viewerOf — Terra 가 쓰는 형식 이름마다 뷰어', () => {
  const k = (s, e) => viewerOf(s, e).kind;
  assert.equal(k('terra.bytes@1'), 'bytes'); assert.equal(k('terra.file.content@1'), 'bytes'); assert.equal(k('terra.audio.frame@1'), 'bytes');
  assert.equal(k('terra.text@1'), 'text'); assert.equal(k('terra.text.line@1'), 'text'); assert.equal(k('terra.bytes@1', 'text/plain'), 'text');
  assert.equal(k('terra.video.frame@1', 'h264'), 'video'); assert.equal(k('terra.video.rgb24@1'), 'video'); assert.equal(k('terra.image.frame@1'), 'image');
  assert.equal(k('terra.input.event@1'), 'event'); assert.equal(k('terra.button@1'), 'event'); assert.equal(k('terra.process.status@1'), 'event'); assert.equal(k('terra.detection.objects@1'), 'event');
  assert.equal(k('terra.sensor.sample@1'), 'number'); assert.equal(k('terra.gpio.level@1'), 'number');
  assert.equal(k(''), 'bytes'); assert.equal(k('x.unknown@3'), 'bytes'); assert.equal(viewerOf('terra.text@1').label, '글 · 로그');
});

test('hexRows · b64bytes — 16 바이트씩, 글자 아닌 것은 ·', () => {
  const r = hexRows(b64bytes(b64('AB\n0123456789abcdefXYZ')));
  assert.equal(r.length, 2); assert.equal(r[0].off, '0000'); assert.match(r[0].hex, /^41 42 0a 30/); assert.equal(r[0].txt.slice(0, 3), 'AB·'); assert.equal(r[1].off, '0010');
  assert.deepEqual(b64bytes('***'), []);
});

test('streamMsg — SSE { event, data } · 글 · 객체 모두, 모르는 꼴은 null', () => {
  assert.equal(streamMsg({ event: 'frame', data: JSON.stringify({ handle_id: 'h', sequence: 2 }) }).kind, 'frame');
  assert.equal(streamMsg('{"kind":"status","state":"active"}').state, 'active');
  assert.equal(streamMsg({ kind: 'frame', data: 'AA==' }).data, 'AA==');
  assert.equal(streamMsg('keep-alive'), null); assert.equal(streamMsg({ kind: 'other' }), null);
});

test('frameValue — 수치 · 글 · 그림(jpeg 는 data URL, h264 는 이유) · 사건 요약', () => {
  assert.equal(frameValue(F(1, ' 41.5\n'), 'number').n, 41.5); assert.equal(frameValue(F(1, '{"value":3}'), 'number').n, 3); assert.equal(frameValue(F(1, 'x'), 'number').n, null);
  assert.deepEqual(frameValue(F(1, 'a\nb\n'), 'text').lines, ['a', 'b']);
  assert.match(frameValue(F(1, 'jpg', { encoding: 'jpeg' }), 'video').src, /^data:image\/jpeg;base64,/);
  const h = frameValue(F(1, 'nal', { encoding: 'h264' }), 'video'); assert.equal(h.src, ''); assert.match(h.note, /h264 — 브라우저 미지원 인코딩/);
  const e = frameValue(F(1, '{"type":"press","button":"a"}'), 'event'); assert.equal(e.type, 'press'); assert.match(e.text, /button=a/);
});

test('reduceView — 셈 · 빠진 순번 · hold(꼬리 멈춤) · 상태', () => {
  let s = viewInit('number');
  for (const [q, v] of [[1, '1'], [2, '5'], [5, '3']]) s = reduceView(s, F(q, v), { now: 1000 + q * 100 });
  assert.equal(s.frames, 3); assert.equal(s.gaps, 2); assert.deepEqual(s.num.hist, [1, 5, 3]); assert.equal(s.conn, 'live');
  const held = reduceView(s, F(6, '9'), { hold: true }); assert.equal(held.frames, 4); assert.deepEqual(held.num.hist, [1, 5, 3]);
  const n = numStats(s.num.hist); assert.equal(n.min, 1); assert.equal(n.max, 5); assert.equal(n.avg, 3); assert.equal(n.bars.length, 3);
  let t = reduceView(viewInit('text'), F(1, 'a\nb'), {}); t = reduceView(t, F(2, 'c\n'), {}); assert.deepEqual(t.lines, ['a', 'b', 'c']);
  let ev = reduceView(viewInit('event'), F(1, '{"state":"running"}'), { now: 5 }); ev = reduceView(ev, F(2, '{"state":"exited"}'), { now: 6 }); assert.equal(ev.events[0].type, 'exited');
  assert.equal(connLabel(reduceView(s, { kind: 'status', state: 'degraded', reason: 'participant_disconnected' })).cls, 'warn');
  assert.equal(connLabel(reduceView(s, { kind: 'status', state: 'closed', reason: 'source_completed' })).label, '닫힘 · source_completed');
  assert.equal(connLabel(reduceView(s, { kind: 'conn', conn: 'lost', tries: 3 })).label, '끊김 · 재연결 중 (3번째)');
  assert.equal(connLabel(viewInit('bytes')).label, '멈춤'); assert.equal(connLabel(reduceView(viewInit('bytes'), { kind: 'status', state: 'opening' })).label, '여는 중');
  assert.ok(Math.abs(fpsOf({ times: [0, 500, 1000] }, 1000) - 2) < 1e-9);
});

test('WATCH_OPS — Master 계약에 있고, 지금은 앱 위임 표 밖(코어가 열면 표만 다시 뽑는다)', () => {
  for (const op of WATCH_OPS) assert.ok(!MD.operations[op], op + ' 가 위임 표에 생겼다 — 화면이 저절로 열린다(이 시험만 고친다)');
});

test('createSviWatch — 핸들 열기 → events 스트림, 끊기면 다시 붙고, 멈추면 핸들을 닫는다', async () => {
  const calls = [], timers = [], msgs = []; let closeFn = null, push = null;
  const terra = {
    invoke: async (op, inp) => { calls.push([op, inp]); return op.endsWith('handles.post') ? { handle_id: 'h9', state: 'requested' } : {}; },
    stream: async (op, inp, onMsg, onClose) => { calls.push([op, inp]); push = onMsg; closeFn = onClose; return () => calls.push(['close']); },
  };
  const w = createSviWatch(terra, { setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearTimeout: () => {} });
  const h = w.open({ resource_id: 'r1', endpoint_id: 'out' }, (m) => msgs.push(m));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls[0][0], 'terra.master.svi.handles.post'); assert.deepEqual(Object.keys(calls[0][1]).sort(), ['endpoint_id', 'idempotency_key', 'operation', 'qos_profile', 'resource_id', 'ttl_seconds']);
  assert.equal(calls[0][1].operation, 'subscribe'); assert.deepEqual(calls[1], ['terra.master.svi.handles.by-handle-id.events.get', { handle_id: 'h9' }]);
  push({ event: 'frame', data: JSON.stringify({ kind: 'frame', handle_id: 'h9', sequence: 1, data: 'AA==' }) }); assert.equal(msgs.at(-1).kind, 'frame');
  closeFn(); assert.deepEqual(msgs.at(-1), { kind: 'conn', conn: 'lost', tries: 1 }); assert.equal(timers[0][1], 1000);
  await timers[0][0](); assert.equal(calls.filter((c) => c[0].endsWith('handles.post')).length, 1, '같은 핸들에 다시 붙는다');
  h.stop(); assert.ok(calls.some((c) => c[0] === 'close')); assert.deepEqual(calls.at(-1), ['terra.master.svi.handles.by-handle-id.delete', { handle_id: 'h9' }]); assert.equal(msgs.at(-1).conn, 'stopped');
});

test('createSviWatch — 4xx 는 다시 붙지 않고 이유를 보인다', async () => {
  const msgs = [], terra = { invoke: async () => { throw Object.assign(new Error('x'), { code: 'FORBIDDEN', status: 403 }); }, stream: async () => () => {} };
  createSviWatch(terra, { setTimeout: () => assert.fail('다시 붙으면 안 된다') }).open({ resource_id: 'r', endpoint_id: 'e' }, (m) => msgs.push(m));
  await new Promise((r) => setTimeout(r, 0)); assert.deepEqual(msgs.at(-1), { kind: 'conn', conn: 'error', why: 'FORBIDDEN' });
});
