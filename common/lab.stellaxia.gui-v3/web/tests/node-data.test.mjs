// node --test — 노드 데이터 층(캔버스 보드 TerraNodes)의 PA/EL: 사본 먼저 · 끊기면 마지막 사본을 읽기 전용 · 쓰기는 쌓지 않음 · 낙관 반영과 되돌림
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boardModule } from '../tools/dc-board.mjs';

const D = new URL('../design/', import.meta.url).pathname;
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function loadStore(transport) {
  globalThis.localStorage = mem(); globalThis.window = { TerraTransport: transport };
  const dir = mkdtempSync(join(tmpdir(), 'tn-')), rt = join(dir, 'rt.mjs'), f = join(dir, 'TerraNodes.mjs');
  writeFileSync(rt, 'export class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState() {} }\nexport const defineBoard = (d) => d;\n');
  writeFileSync(f, boardModule(readFileSync(join(D, 'TerraNodes.dc.html'), 'utf8'), 'TerraNodes', rt));
  const def = (await import(f)).default; new def.Logic({ quiet: true });
  return globalThis.window.TerraNodes;
}
// 시험 전송 — 노드마다 값 · 끊김을 손으로
function fake() {
  const data = { L: { modules: [{ id: 'm', st: 'run' }] }, R: { modules: [{ id: 'm', st: 'run' }] } }, cut = new Set(), calls = [];
  return { kind: 'test', meta: { L: { name: 'local' }, R: { name: 'remote' } }, data, cut, calls, localId: () => 'L',
    invoke(n, op, input) { calls.push([n, op]); return new Promise((ok, no) => setTimeout(() => {
      if (cut.has(n)) return no({ code: 'NODE_OFFLINE', status: 409 });
      if (op === 'terra.daemon.modules.get') return ok(JSON.parse(JSON.stringify(data[n].modules)));
      if (op.endsWith('.fail')) return no({ code: 'MODULE_BUSY' });
      ok({ ok: true }); }, 1)); },
    master(n) { return Promise.resolve([{ id: 'm', st: 'observed' }]); } };
}

test('EL — 처음엔 받는 중, 받은 뒤엔 사본을 바로 · TTL 안에선 다시 부르지 않는다', async () => {
  const t = fake(), S = await loadStore(t);
  const r0 = S.read('R', 'modules'); assert.equal(r0.data, null); assert.equal(r0.loading, true);
  await tick(5);
  const r1 = S.read('R', 'modules'); assert.equal(r1.data[0].st, 'run'); assert.equal(r1.src, '노드'); assert.equal(S.link('R').state, 'online');
  S.read('R', 'modules'); assert.equal(t.calls.length, 1);
  assert.equal(S.linkText('L').t, '로컬'); assert.match(S.linkText('R', r1.at).t, /^원격 · /);
});

test('PA — 끊기면 마지막 사본을 나이와 함께 읽기 전용으로, 쓰기는 하지 않고(쌓지 않음) 돌아오면 다시', async () => {
  const t = fake(), S = await loadStore(t);
  S.read('R', 'modules'); await tick(5);
  t.cut.add('R'); S.refresh('R', 'modules'); await tick(5);
  const r = S.read('R', 'modules'), L = S.linkText('R', r.at);
  assert.equal(r.data[0].st, 'run'); assert.equal(S.link('R').state, 'offline'); assert.equal(L.ro, true); assert.match(L.t, /끊김 · .* 사본 · 읽기 전용/);
  const n = t.calls.length;
  await assert.rejects(S.write('R', 'terra.daemon.modules.by-module-id.stop.post', { module_id: 'm' }, { res: 'modules', apply: (d) => d }), { code: 'PARTITIONED' });
  assert.equal(t.calls.length, n);   // 나가지 않았다
  S.read('R', 'modules'); assert.equal(t.calls.length, n);   // 끊긴 노드는 5초에 한 번만 두드린다
  t.cut.delete('R'); await S.refresh('R', 'modules'); assert.equal(S.link('R').state, 'online');
});

test('PA — 사본이 없으면 Master 가 마지막으로 관측한 값으로', async () => {
  const t = fake(), S = await loadStore(t); t.cut.add('R');
  S.read('R', 'modules'); await tick(5); await tick(1);
  const r = S.read('R', 'modules'); assert.equal(r.src, 'Master 관측'); assert.equal(r.data[0].st, 'observed');
});

test('쓰기 — 사본에 먼저(낙관) · 실패하면 되돌림 · 성공하면 다시 받는다', async () => {
  const t = fake(), S = await loadStore(t);
  S.read('R', 'modules'); await tick(5);
  const stop = (d) => d.map((m) => ({ ...m, st: 'stop' }));
  const p = S.write('R', 'x.fail', {}, { res: 'modules', apply: stop });
  assert.equal(S.read('R', 'modules').data[0].st, 'stop');   // 바로 보인다
  await assert.rejects(p, { code: 'MODULE_BUSY' });
  assert.equal(S.read('R', 'modules').data[0].st, 'run');   // 되돌림
  await S.write('R', 'terra.daemon.modules.by-module-id.stop.post', { module_id: 'm' }, { res: 'modules', apply: stop });
  assert.ok(t.calls.some((c) => c[1] === 'terra.daemon.modules.by-module-id.stop.post'));
});

test('묶음 자원(desk) · 모양 — 실제 전송이면 operation 여럿을 불러 보드의 모양으로, 일부 실패는 비운 채', async () => {
  const t = fake(); t.invoke = (n, op) => op === 'terra.daemon.tasks.get' ? Promise.reject({ code: 'FORBIDDEN' }) : Promise.resolve({ op });
  const S = await loadStore(t); S.shapes.desk = (P) => ({ got: Object.keys(P).sort() });
  await S.refresh('L', 'desk');
  assert.deepEqual(S.read('L', 'desk').data.got, ['config', 'devices', 'modules', 'offers', 'svi', 'wg']);
  S.clear(); assert.equal(S.read('L', 'desk').data, null);   // 로그아웃 — 앞 사람의 사본을 남기지 않는다
});

test('보기 상태 — 노드 키마다 따로(GUI 것, 노드 데이터가 아니다)', async () => {
  const t = fake(), S = await loadStore(t);
  S.setView('desk.L', { wins: { term: 1 } }); S.setView('desk.R', { wins: {} });
  assert.deepEqual(S.view('desk.L'), { wins: { term: 1 } }); assert.deepEqual(S.view('desk.R'), { wins: {} });
});

test('오류 — 실패한 자원은 그리기마다 다시 부르지 않는다(5초)', async () => {
  const t = fake(); let n = 0; t.invoke = () => { n++; return Promise.reject({ code: 'UNAUTHENTICATED' }); };
  const S = await loadStore(t);
  S.read('R', 'modules'); await tick(2);
  for (let i = 0; i < 20; i++) S.read('R', 'modules');
  assert.equal(n, 1); assert.equal(S.read('R', 'modules').err.code, 'UNAUTHENTICATED');
});
