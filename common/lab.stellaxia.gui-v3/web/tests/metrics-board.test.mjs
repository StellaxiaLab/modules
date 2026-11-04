// node --test — 자원 추이 · 모듈 상태 창: 실제 모드에서 지어낸 CPU · 메모리 · 가동이 없고, 로그는 Daemon 모듈 로그(logs.get), 전역 틀 그래프는 하트비트 점열 + 주기
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { logLines } from '../src/api/desk-adapt.js';

const read = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const ModStatus = new Function('DCLogic', parseBoard(read('ModStatus')).script + '\nreturn Component;')(DCLogic);

const MOD = { id: 'io.terra.agent', name: 'Agent', ver: '0.6.2', kind: 'service', apps: [], perms: [], svi: [], st: 'run', node: 'desk', nodeId: 'n1', remote: false, startedAt: new Date(Date.now() - (2 * 3600 + 5 * 60) * 1000).toISOString(), pid: 4242, restarts: 1 };
const store = (reads, logs) => ({ t: { kind: 'gateway' }, read(n, res, o) { reads.push([n, res, o && o.input]); if (res === 'modules') return { data: [MOD], at: Date.now() }; if (res.endsWith('logs.get')) return logs; return { data: null }; }, subscribe() { return () => {}; }, linkText() { return { t: '', cls: 'local', ro: false }; } });
const mount = (win) => { const prev = globalThis.window; globalThis.window = Object.assign({ addEventListener() {}, dispatchEvent() {} }, win); return { done: () => { globalThis.window = prev; } }; };

test('ModStatus 실제 — CPU · MEM 은 까닭과 함께 —, 가동은 started_at, 로그는 logs.get', () => {
  const reads = [], L = { data: { module_id: MOD.id, lines: [{ at: '2026-11-04T01:02:03Z', stream: 'stdout', text: 'listening :7000' }, { at: '2026-11-04T01:02:04Z', stream: 'stderr', text: 'ERROR dial failed' }] }, at: Date.now() };
  const { done } = mount({ TerraNodes: store(reads, L), TerraDesk: { logLines } }); try {
    const c = new ModStatus({ mod: MOD }); const v = c.renderVals(), txt = JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));
    assert.equal(v.cpuT, '—'); assert.equal(v.memT, '—'); assert.match(v.cpuS, /코어 : 모듈별 CPU op 없음/); assert.match(v.memN, /모듈별 메모리 op 없음/);
    assert.match(v.up, /^2h 5m · pid 4242 · 재시작 1회$/);
    assert.deepEqual(v.logs.map((l) => [l.lv, l.msg]), [['error', 'ERROR dial failed'], ['info', 'listening :7000']]);
    assert.deepEqual(reads.find((r) => r[1].endsWith('logs.get')), ['n1', 'terra.daemon.modules.by-module-id.logs.get', { module_id: 'io.terra.agent', tail: 40 }]);
    assert.doesNotMatch(txt, /RSS|MB"|manifest 검사|health ok/);   // 시안 줄 · 시안 사용량이 새지 않는다
  } finally { done(); }
});

test('ModStatus 실제 — 시작 시각이 없으면 까닭, 로그를 못 받으면 그 코드', () => {
  const M2 = Object.assign({}, MOD, { startedAt: '', pid: 0, restarts: 0 }), reads = [];
  const S = store(reads, { data: null, err: { code: 'NODE_OFFLINE' } }); S.read = ((f) => (n, res, o) => (res === 'modules' ? { data: [M2] } : f(n, res, o)))(S.read);
  const { done } = mount({ TerraNodes: S, TerraDesk: { logLines } }); try {
    const v = new ModStatus({ mod: M2 }).renderVals();
    assert.equal(v.up, '— · 모듈 상태에 시작 시각 없음'); assert.equal(v.logs[0].msg, '로그 미수신 · NODE_OFFLINE');
  } finally { done(); }
});

test('전역 틀 — 실제면 추이는 TerraMetrics 점열 · NET 은 까닭 · 갱신 주기 줄, 시안 그래프만 움직인다', () => {
  const F = read('Field');
  assert.match(F, /MT\.spark\(RN\.node_id, 'cpu', 17\)/);
  assert.match(F, /코어: 실시간 지표 op 없음/);
  assert.match(F, /MT\.cadence\(RN\.node_id\)\.text/);
  assert.match(F, /this\._sparkId = SMP \? 'ln' \+ sparkRow : ''/);
  assert.match(F, /startedAt: m\.started_at/);
  const S = read('Scene'); assert.match(S, /코어: 실시간 지표 op 없음/);
});
