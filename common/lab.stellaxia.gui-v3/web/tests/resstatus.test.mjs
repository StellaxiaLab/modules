// node --test — 자원 상태 창(ResStatus): 값 뷰어 사본 = src/api/svi-view.js, 시안은 유형마다 흉내, 실제는 문이 닫혀 있으면 잠그고 why + 대체(쓰는 곳 조회)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import * as SVV from '../src/api/svi-view.js';
import * as sviRead from '../src/api/svi-read.js';
import { gateAll } from '../src/api/gates.js';

const src = readFileSync(fileURLToPath(new URL('../design/ResStatus.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const lib = new Function('DCLogic', parseBoard(src).script + '\nreturn { Component, WATCH_OPS, viewerOf, hexRows, frameValue, viewInit, reduceView, connLabel, numStats };')(DCLogic);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const txt = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));

test('보드 사본 = src — 형식 → 뷰어 · 프레임 값 · 접기 · 구독 표시', () => {
  assert.deepEqual(lib.WATCH_OPS, SVV.WATCH_OPS);
  for (const [s, e] of [['terra.bytes@1'], ['terra.text@1'], ['terra.video.frame@1', 'h264'], ['terra.image.frame@1', 'jpeg'], ['terra.input.event@1'], ['terra.sensor.sample@1'], ['x@1', 'application/json'], ['']]) assert.deepEqual(lib.viewerOf(s, e), SVV.viewerOf(s, e));
  const msgs = [{ kind: 'status', state: 'active' }, { kind: 'frame', sequence: 1, data: b64('12.5') }, { kind: 'frame', sequence: 4, data: b64('{"type":"t","a":1}\nline') }, { kind: 'conn', conn: 'lost', tries: 2 }, { kind: 'status', state: 'closed', reason: 'x' }];
  for (const k of ['number', 'text', 'bytes', 'image', 'video', 'event']) {
    let a = lib.viewInit(k), b = SVV.viewInit(k);
    for (const m of msgs) { a = lib.reduceView(a, m, { now: 5 }); b = SVV.reduceView(b, m, { now: 5 }); assert.deepEqual(a, b, k); assert.deepEqual(lib.connLabel(a), SVV.connLabel(b)); }
    assert.deepEqual(lib.frameValue(msgs[2], k), SVV.frameValue(msgs[2], k));
  }
  assert.deepEqual(lib.hexRows([1, 65, 200]), SVV.hexRows([1, 65, 200])); assert.deepEqual(lib.numStats([1, 3, 2]), SVV.numStats([1, 3, 2]));
});

const sample = (resName, ticks = 40) => { const prev = globalThis.window; globalThis.window = undefined; try { const c = new lib.Component({ resName }); for (let i = 0; i < ticks; i++) c.tick(); return { c, v: c.renderVals() }; } finally { globalThis.window = prev; } };

test('시안 — 끝점 형식마다 뷰어가 바뀌고 가짜 흐름이 흐른다', () => {
  let { c, v } = sample('camera/frames'); assert.equal(v.isImg, true); assert.match(v.imgSrc, /^data:image\/svg\+xml;base64,/); assert.match(v.vMeta, /terra\.video\.frame@1/); assert.equal(v.connT, '받는 중');
  c.state.ep = 'status'; for (let i = 0; i < 12; i++) c.tick(); v = c.renderVals(); assert.equal(v.isEvent, true); assert.ok(v.evRows.length > 0); assert.match(v.evRows[0].text, /state=streaming/);
  v = sample('syslog').v; assert.equal(v.isText, true); assert.ok(v.lines.length > 0);
  v = sample('ssh:22').v; assert.equal(v.isBytes, true); assert.ok(v.hex.length > 0); assert.match(v.hex[0].off, /^0000$/);
  v = sample('sensor').v; assert.equal(v.isNum, true); assert.notEqual(v.nowT, '—'); assert.ok(v.bars.length > 0); assert.match(v.unitT, /온도/);
});

test('시안 — 멈춤 · 꼬리 멈춤 · 끊김 뒤 다시 붙기', () => {
  const prev = globalThis.window; globalThis.window = undefined;
  try {
    const c = new lib.Component({ resName: 'syslog' }); for (let i = 0; i < 20; i++) c.tick();
    c.state.hold = true; const n = c.renderVals().lines.length; for (let i = 0; i < 20; i++) c.tick(); assert.equal(c.renderVals().lines.length, n, '꼬리 멈춤이면 줄이 늘지 않는다');
    c.state.hold = false; c.state.sub = false; c.tick(); assert.equal(c.renderVals().connT, '멈춤'); assert.equal(c.renderVals().subT, '구독 시작');
    c.state.sub = true; for (let i = 0; i < 85; i++) c.tick(); assert.match(c.renderVals().connT, /끊김 · 다시 붙는 중/);
    for (let i = 0; i < 14; i++) c.tick(); assert.equal(c.renderVals().connT, '받는 중');
  } finally { globalThis.window = prev; }
});

const RES = { items: [{ resource_id: 'r-cam', node_id: 'n1', kind: 'camera', display_name: 'cam-front', status: 'available', endpoints: [{ endpoint_id: 'video', direction: 'source', interaction: 'stream', output_schema: 'terra.video.frame@1' }, { endpoint_id: 'ctl', direction: 'sink', input_schema: 'terra.camera.control@1' }] }] };
const HD = { items: [{ handle_id: 'h1', resource_id: 'r-cam', endpoint_id: 'video', operation: 'subscribe', state: 'active', created_at: '2026-11-04T01:02:03Z' }] };
const realWin = (gateOpen, opened) => ({
  TerraTransport: {}, TerraSvi: sviRead, TerraTopology: { node: () => ({}) },
  TerraNodes: { t: { kind: 'gateway', localId: () => 'k1', meta: { k1: { rid: 'n1', name: 'desk' } } }, subscribe: () => () => {},
    read: (k, op) => ({ data: op.endsWith('resources.get') ? RES : op.endsWith('handles.get') ? HD : { items: [] } }) },
  TerraGateAll: gateOpen ? () => ({ open: true, why: '' }) : (ops) => gateAll(ops),
  TerraSviWatch: { open: (req, on) => { opened.push(req); on({ kind: 'status', state: 'active', handle_id: 'h9' }); on({ kind: 'frame', sequence: 1, encoding: 'jpeg', data: b64('jpg') }); return { stop: () => opened.push('stop') }; } },
});
const real = (gateOpen, fn) => { const prev = globalThis.window, opened = []; globalThis.window = realWin(gateOpen, opened); try { const c = new lib.Component({ resName: 'cam-front', nodeName: 'desk' }); c._live = true; return fn(c, opened); } finally { globalThis.window = prev; } };

test('실제 — 문이 닫혀 있으면 값 뷰어 자리에 잠금 + why, 대체는 쓰는 곳(handles.get), 핸들을 열지 않는다', () => real(false, (c, opened) => {
  const v = c.renderVals();
  assert.equal(v.locked, true); assert.equal(v.unlocked, false); assert.match(v.lockWhy, /잠김 : 위임 없음 — terra\.master\.svi\.handles\.post/); assert.match(v.lockAlt, /svi\.handles\.get/);
  assert.equal(v.subOff, 'disabled'); assert.equal(v.connT, '잠김'); assert.match(v.vMeta, /terra\.video\.frame@1 · 영상/);
  assert.equal(v.evH, '쓰는 곳 · 최근 사건'); assert.match(v.events[0].msg, /subscribe · video — active/);
  assert.equal(v.eps.find((e) => e.id === 'video').schema, 'stream · terra.video.frame@1');
  v.toggleSub(); c.renderVals(); assert.deepEqual(opened, []);
  assert.doesNotMatch(txt(v), /h-sample|sshd|person 0\.9|02·b|store\/data/);
}));

test('실제 — 코어가 열면(문 열림) 눌러서 핸들 열기 → 흐름이 같은 뷰어로', () => real(true, (c, opened) => {
  let v = c.renderVals(); assert.equal(v.locked, false); assert.equal(v.subT, '구독 시작'); assert.deepEqual(opened, [], '누르기 전에는 열지 않는다');
  v.toggleSub(); v = c.renderVals(); assert.deepEqual(opened[0], { resource_id: 'r-cam', endpoint_id: 'video', qos: 'realtime_latest' });
  v = c.renderVals(); assert.equal(v.isImg, true); assert.match(v.imgSrc, /^data:image\/jpeg;base64,/); assert.equal(v.connT, '받는 중');
  v.toggleSub(); c.renderVals(); assert.equal(opened.at(-1), 'stop');
}));
