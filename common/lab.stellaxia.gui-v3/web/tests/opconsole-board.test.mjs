// node --test — op 콘솔 창(OpConsole): 보드의 사본이 src/api/op-console.js 와 같은지, 실제 모드에서 카탈로그를 그대로 그리고(시안 값 없음)
//   폼 생성 · 등급 분기(T2 두 번 누르기 · T3/T4 승인 문) · 잠금 칩을 보이는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { gate } from '../src/api/gates.js';

const read = (n) => readFileSync(fileURLToPath(new URL(n, import.meta.url)), 'utf8');
const B = parseBoard(read('../design/OpConsole.dc.html'));
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const lib = new Function('DCLogic', B.script + '\nreturn { Component };')(DCLogic);

test('보드 사본 = src/api/op-console.js (export 만 뺀 같은 글)', () => {
  const src = read('../src/api/op-console.js'), copy = B.script;
  const body = src.slice(src.indexOf('export const TIERS')).replace(/^export /gm, '').replace(/\r/g, '').trimEnd();
  assert.ok(copy.replace(/\r/g, '').includes(body), '보드 안의 사본이 src 와 다르다 — design/build/parts/opconsole/script.js 를 다시 맞추고 build_parts.py opconsole');
});

const catalog = { operations: [
  { operationId: 'terra.daemon.modules.get', title: '모듈 목록', execution: { risk: 'read' } },
  { operationId: 'terra.daemon.config.patch', title: '설정', execution: { risk: 'write' } },
  { operationId: 'terra.daemon.commands.execute.post', title: '명령 실행', execution: { risk: 'dangerous', confirmationMode: 'required' } },
  { operationId: 'terra.master.crossboundary.peer-grants.by-grant-id.revoke.post', title: '허가 폐기', execution: { risk: 'dangerous', approval: { tier: 'T3', impact: '연결이 끊긴다', inputs: ['grant_id'], secret_result: ['token'] } } },
  { operationId: 'terra.daemon.svi.declarations.apply.post', title: '선언 적용', execution: { risk: 'write' } },
] };
const schemas = {
  'terra.daemon.config.patch': { type: 'object', required: ['key'], properties: { key: { type: 'string' }, value: { type: 'string' }, dry: { type: 'boolean' }, mode: { type: 'string', enum: ['a', 'b'] }, tags: { type: 'array' } } },
  'terra.master.crossboundary.peer-grants.by-grant-id.revoke.post': { type: 'object', required: ['grant_id'], properties: { grant_id: { type: 'string' } } },
};
const flush = () => new Promise((r) => setTimeout(r, 0));

async function mount(o = {}) {
  const calls = { local: [], door: [], remote: [] };
  const prev = globalThis.window;
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    TerraTransport: { localId: () => 'me', invoke: async (n, op, i) => { calls.local.push([op, i]); return { ok: 1 }; }, invokeRid: async (rid, op, i) => { calls.remote.push([rid, op, i]); return { r: 1 }; } },
    TerraCatalog: { list: async () => catalog, describe: async (id) => ({ operationId: id, input: schemas[id] }) },
    TerraGate: (op, x) => gate(op, Object.assign({ who: { allPermissions: true }, app: true }, x)),
    TerraCanApprove: () => o.door !== false,
    TerraApprove: async (op, inp) => { calls.door.push([op, inp]); return { ok: true, status: 200, data: { done: 1 }, withheld: ['token'] }; },
    TerraErrorLine: (op, e) => 'E:' + e.code, TerraCanRemote: () => true,
  };
  const c = new lib.Component({ nodeName: 'desk' }); c.componentDidMount(); await flush();
  const v = () => c.renderVals();
  return { c, v, calls, done: () => { globalThis.window = prev; } };
}

test('실제 모드 — 카탈로그를 읽어 목록 · 검색 · 등급 거르기, 앱 토큰에 닫힌 op 는 잠금 칩', async () => {
  const m = await mount();
  try {
    let v = m.v();
    assert.equal(v.rows.length, 5); assert.equal(v.countT, '5개');
    assert.deepEqual(v.rows.map((r) => r.tier).sort(), ['T0', 'T1', 'T1', 'T2', 'T3']);
    assert.match(v.rows.find((r) => r.id.includes('declarations.apply')).tip, /🔒 앱 토큰에 닫힘/);
    m.c.set({ q: '명령' }); v = m.v(); assert.deepEqual(v.rows.map((r) => r.id), ['terra.daemon.commands.execute.post']);
    m.c.set({ q: '', tier: 'T3' }); v = m.v(); assert.equal(v.rows.length, 1);
    m.c.set({ tier: '' });
    // 잠긴 op 를 고르면 단추가 닫히고 이유 · CLI 이름
    m.c.pick(m.c.items().find((o) => o.id.includes('declarations.apply'))); await flush(); v = m.v();
    assert.equal(v.lockOn, true); assert.equal(v.chipT, '앱 토큰에 닫힘'); assert.equal(v.runOff, 'disabled'); assert.match(v.why, /terra module call/);
  } finally { m.done(); }
});

test('폼 생성 — 스키마 칸 · 필수 오류 · 입력 JSON 이 호출에 실린다 (T1 은 곧장)', async () => {
  const m = await mount();
  try {
    m.c.pick(m.c.items().find((o) => o.id === 'terra.daemon.config.patch')); await flush();
    let v = m.v();
    assert.deepEqual(v.fields.map((f) => [f.key, f.isText, f.isEnum, f.isJson, f.req]), [['key', true, false, false, '*'], ['value', true, false, false, ''], ['dry', false, true, false, ''], ['mode', false, true, false, ''], ['tags', false, false, true, '']]);
    assert.equal(v.runT, '실행'); assert.equal(v.runOff, null);
    m.c.run(m.c.items().find((o) => o.id === 'terra.daemon.config.patch')); v = m.v();   // 필수 칸 비어 있음
    assert.equal(m.calls.local.length, 0); assert.match(v.resHead, /입력 오류/); assert.equal(v.fields[0].err, '필수');
    v.fields[0].onInput({ target: { value: 'log.level' } }); m.v().fields[3].onInput({ target: { value: 'b' } }); m.v().fields[2].onInput({ target: { value: 'true' } });
    m.c.run(m.c.items().find((o) => o.id === 'terra.daemon.config.patch')); await flush();
    assert.deepEqual(m.calls.local, [['terra.daemon.config.patch', { key: 'log.level', dry: true, mode: 'b' }]]);
    v = m.v(); assert.equal(v.resHead, '완료'); assert.match(v.resBody, /"ok": 1/); assert.match(v.cli, /--input/);
  } finally { m.done(); }
});

test('T2 — 첫 누름은 확인만, 두 번째에 실행 · 취소하면 안 나감', async () => {
  const m = await mount();
  try {
    const it = m.c.items().find((o) => o.tier === 'T2'); m.c.pick(it); await flush();
    assert.equal(m.v().runT, '실행 …');
    m.c.run(it); let v = m.v(); assert.equal(v.armOn, true); assert.match(v.runT, /한 번 더/); assert.equal(m.calls.local.length, 0);
    v.disarm(); assert.equal(m.v().armOn, false); assert.equal(m.calls.local.length, 0);
    m.c.run(it); m.c.run(it); await flush();
    assert.equal(m.calls.local.length, 1); assert.equal(m.v().armOn, false);
    // 대상 노드를 적으면 그 노드로(앱 길 · 노드 주소 호출) — 이 노드에서만 되는 op 는 그 순간 잠긴다
    m.c.pick(it); await flush(); m.c.set({ node: 'n-7' }); const lk = m.v(); assert.equal(lk.chipT, '이 노드에서만'); assert.equal(lk.runOff, 'disabled');
    const rd = m.c.items().find((o) => o.id === 'terra.daemon.modules.get'); m.c.pick(rd); await flush(); m.c.set({ node: 'n-7' }); m.c.run(rd); await flush();
    assert.deepEqual(m.calls.remote.map((c) => [c[0], c[1]]), [['n-7', 'terra.daemon.modules.get']]);
  } finally { m.done(); }
});

test('T3 — 승인 문으로만 나가고(페이지가 직접 안 부름), secret_result 는 숨김 줄만', async () => {
  const m = await mount();
  try {
    const it = m.c.items().find((o) => o.tier === 'T3'); m.c.pick(it); await flush();
    let v = m.v();
    assert.equal(v.lockOn, false, '게이트가 위임 없음으로 닫아도 승인 문이 있으면 열림'); assert.match(v.runT, /승인 문으로/); assert.equal(v.impactOn, true); assert.equal(v.secretOn, true); assert.equal(v.nodeOn, false, 'T3 는 대상 노드 칸 없음 — 입력이 정한다');
    v.fields[0].onInput({ target: { value: 'g-1' } });
    m.c.run(it); await flush();
    assert.deepEqual(m.calls.door, [['terra.master.crossboundary.peer-grants.by-grant-id.revoke.post', { grant_id: 'g-1' }]]);
    assert.equal(m.calls.local.length + m.calls.remote.length, 0);
    v = m.v(); assert.equal(v.resHead, '승인됨 · 완료'); assert.equal(v.withheldOn, true); assert.equal(v.withheldT, 'token'); assert.ok(!/token/.test(v.resBody));
  } finally { m.done(); }
});

test('승인 문이 없으면(단독 실행) T3 는 잠금 칩 · 단추 닫힘', async () => {
  const m = await mount({ door: false });
  try {
    const it = m.c.items().find((o) => o.tier === 'T3'); m.c.pick(it); await flush(); const v = m.v();
    assert.equal(v.lockOn, true); assert.equal(v.chipT, '승인 문 없음'); assert.equal(v.runOff, 'disabled'); assert.equal(v.noteOn, true);
  } finally { m.done(); }
});

test('시안(캔버스) — Terra 없이 등급마다 하나씩 보이고 폼이 나온다', async () => {
  const prev = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    const c = new lib.Component({}); c.componentDidMount(); let v = c.renderVals();
    assert.deepEqual([...new Set(v.rows.map((r) => r.tier))].sort(), ['T0', 'T1', 'T2', 'T3', 'T4']);
    c.pick(c.items().find((o) => o.id === 'terra.daemon.config.patch')); v = c.renderVals(); assert.ok(v.fields.length >= 2);
  } finally { globalThis.window = prev; }
});
