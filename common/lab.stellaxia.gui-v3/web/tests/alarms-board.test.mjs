// node --test — 알림 창(Alarms): 보드의 사본이 src/api/alarms.js 와 같은지, 실제 모드에서 알림 책을 그대로 그리고(시안 값 없음) 읽음 · 지우기 · 대상으로 가는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { ALARM_FILTERS, alarmKey, filterAlarms, countAlarms, markRead, clearAlarms, addAlarms, createAlarmBook, diff } from '../src/api/alarms.js';

const read = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const lib = new Function('DCLogic', parseBoard(read('Alarms')).script + '\nreturn { Component, ALARM_FILTERS, alarmKey, filterAlarms, countAlarms, markRead, clearAlarms, addAlarms };')(DCLogic);

const real = () => {   // diff() 가 낸 알림 그대로
  const a = diff(null, { tasks: [{ id: 't1', type: 'module.install', state: 'running' }, { id: 't2', type: 'svi.bind', state: 'running' }] }, { modules: [{ id: 'm1', name: 'Agent', state: 'running' }] });
  const b = diff(a.next, { tasks: [{ id: 't1', type: 'module.install', state: 'failed' }, { id: 't2', type: 'svi.bind', state: 'succeeded' }] }, { modules: [{ id: 'm1', name: 'Agent', state: 'failed', last_error: 'exit 1' }] }, Date.now() - 5000);
  const B = createAlarmBook(); B.add(b.alarms); return B;
};
const mount = (win, props) => { const prev = globalThis.window; globalThis.window = Object.assign({ addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, win); const c = new lib.Component(Object.assign({ nodeName: 'desk' }, props)); c._live = true; return { c, done: () => { globalThis.window = prev; } }; };

test('보드 사본 = src — 거르기 · 열쇠 · 읽음 · 지우기 · 더하기', () => {
  assert.deepEqual(lib.ALARM_FILTERS, ALARM_FILTERS);
  const A = [{ at: 1, kind: 'task', id: 'a', st: 'failed', sev: 'bad', m: 'x' }, { at: 2, kind: 'module', id: 'b', st: 'running', sev: 'ok', m: 'y' }, { at: 3, kind: 'task', id: 'c', st: 'canceled', sev: 'warn', m: 'z' }];
  const L = addAlarms([], A), L1 = lib.addAlarms([], A);
  assert.deepEqual(L1, L);
  for (const [k] of ALARM_FILTERS) assert.deepEqual(lib.filterAlarms(L, k), filterAlarms(L, k), k);
  assert.deepEqual(lib.countAlarms(L), countAlarms(L));
  for (const key of ['*', L[1].key, [L[0].key, L[2].key]]) { assert.deepEqual(lib.markRead(L, key), markRead(L, key)); assert.deepEqual(lib.clearAlarms(L, key), clearAlarms(L, key)); }
  assert.equal(lib.alarmKey(A[0]), alarmKey(A[0]));
});

test('실제 — 알림 책 그대로, 시안 알림이 새지 않는다', () => {
  const B = real(), { c, done } = mount({ TerraTransport: {}, TerraAlarmBook: B }); try {
    const v = c.renderVals(), txt = JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));
    assert.deepEqual(v.items.map((i) => i.m), ['모듈 Agent — failed · exit 1', '작업 svi.bind 완료', '작업 module.install 실패']);
    assert.equal(v.unread, 3); assert.equal(v.filters.find((f) => f.name === '실패만').n, 2);
    assert.match(v.srcT, /terra\.daemon\.tasks\.get/);
    assert.doesNotMatch(txt, /core\.update\.check|t_8d04|노드 대화|Metrics|시안/);
    assert.equal(globalThis.window.TerraAlarmDemo, undefined);   // 실제 모드는 시안 책을 만들지 않는다
  } finally { done(); }
});

test('실제 — 로그인 전(책 없음)은 시안 대신 까닭', () => {
  const { c, done } = mount({ TerraTransport: {} }); try {
    const v = c.renderVals(); assert.equal(v.items.length, 0); assert.match(v.note, /로그인 뒤에/); assert.equal(v.emptyT, '받는 중…');
  } finally { done(); }
});

test('줄 누르기 — 읽음 + 대상으로(작업 → 제어기 작업 관리자 · 모듈 → 모듈 상태 창)', () => {
  const B = real(), opened = [], { c, done } = mount({ TerraTransport: {}, TerraAlarmBook: B }, { onOpen: (k, a) => opened.push([k, a]) }); try {
    let v = c.renderVals(); v.items[0].go(); v.items[2].go();
    assert.deepEqual(opened, [['mod', 'm1'], ['ctl', 'jobs:t1']]);
    assert.equal(B.unread(), 1);
    v = c.renderVals(); assert.equal(v.items[0].cls, 'rd'); assert.equal(v.items[1].cls, '');
    v.items[1].read(); assert.equal(B.unread(), 0);
  } finally { done(); }
});

test('거르기 · 모두 읽음 · 지우기는 두 번 누르기(무엇을 · 어디 · 되돌리기)', () => {
  const B = real(), { c, done } = mount({ TerraTransport: {}, TerraAlarmBook: B }); try {
    let v = c.renderVals(); v.filters.find((f) => f.name === '작업').pick();
    v = c.renderVals(); assert.equal(v.items.length, 2); assert.equal(v.readT, '작업 읽음');
    v.readAll(); assert.equal(B.unread(), 1);   // 거른 것만 읽음
    v = c.renderVals(); v.clearAll(); assert.equal(B.list.length, 3);   // 한 번은 무장만
    v = c.renderVals(); assert.equal(v.armOn, true); assert.match(v.armT, /작업 2개.*Terra 의 작업 · 모듈은 그대로.*못 함/);
    v.clearAll(); assert.deepEqual(B.list.map((a) => a.kind), ['module']);   // 거른 것만 지운다
    clearTimeout(c._armT);
  } finally { done(); }
});

test('시안 — diff() 모양의 시안 알림과 전역 틀 배지용 책', () => {
  const { c, done } = mount({}); try {
    const v = c.renderVals();
    assert.equal(v.items.length, 8); assert.match(v.srcT, /시안/);
    for (const a of globalThis.window.TerraAlarmDemo.list) for (const k of ['at', 'kind', 'id', 'g', 'c', 'm', 'sev', 'st', 'name', 'key']) assert.ok(a[k] !== undefined, k);
    assert.equal(globalThis.window.TerraAlarmDemo.unread(), 4);
  } finally { done(); }
});

test('전역 틀 — 설정 › 알림 이 알림 창(자리 24)을 연다', () => {
  const F = read('Field');
  assert.match(F, /data-slot="24"[^\n]*name="Alarms"[^\n]*on-open="\{\{openFn24\}\}"/);
  assert.match(F, /exec\(t, t === '알림' \? 'alarms' : 'tool'\)/);
  assert.match(F, /if \(x === 'alarms'\) return this\.alarmOpen\(\)/);
  assert.match(F, /alarm: \[24\]/); assert.match(F, /alarm: '알림'/);
  assert.match(read('Scene'), /name="Alarms"/);
});
