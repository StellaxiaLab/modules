// node --test — Tree 관리 창(TreeAdmin, P14-4): Tree 가 아니면 이유만, 탭마다 위임 읽기 목록, 쓰기는 승인 문으로만(페이지가 직접 안 부름),
//   코어 쓰기 뒤 "N대에 적용", 설정은 검증(읽기) 통과 뒤에만 patch(T4)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { createTreeAdmin, OPS } from '../src/api/tree-admin.js';

const read = (n) => readFileSync(fileURLToPath(new URL(n, import.meta.url)), 'utf8');
const B = parseBoard(read('../design/TreeAdmin.dc.html'));
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const lib = new Function('DCLogic', B.script + '\nreturn { Component };')(DCLogic);
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const open = (op) => ({ open: true, needs: '', why: '', op });

const READS = {
  [OPS.publications]: { publications: [{ publication_id: 'pub-1', module_id: 'io.terra.file', version: '0.4.0', policy: 'recommended', stage: 50, digest: 'a'.repeat(64) }] },
  [OPS.promotions]: { promotions: [{ promotion_id: 'pr-1', module_id: 'io.terra.agent', version: '0.2.0', state: 'pending', permissions: { digest: 'sha256:abc', added: ['file.write'] } }] },
  [OPS.ceilingGet]: { permissions: ['process.execute'] },
  [OPS.mirrorBlocks]: { blocks: [{ pattern: 'acme.*', reason: 'x' }] },
  [OPS.coreReleases]: { releases: [{ release_id: 'rel-1', role: 'tree', version: '0.6.22', apply: true, stage: 10 }] },
  [OPS.configSchema]: { fields: [{ key: 'log_level', type: 'string', editable: true }, { key: 'audit.retention_days', type: 'int', editable: true, restart_required: true }, { key: 'jwt_secret', type: 'string', secret: true, editable: false }] },
  [OPS.configGet]: { config: { log_level: 'info', audit: { retention_days: 30 }, jwt_secret: 'zzz' }, pending_restart: [], editable: true },
};

async function mount(o = {}) {
  const calls = { read: [], door: [] }, valid = { v: true };
  const terra = { invoke: async (op, input) => { calls.read.push([op, input]);
    if (op === OPS.configValidate) return valid.v ? { valid: true, restart_required: [], errors: [] } : { valid: false, errors: [{ key: 'log_level', message: '허용하지 않는 값' }] };
    if (!(op in READS)) throw Object.assign(new Error('no ' + op), { code: 'NOT_FOUND' }); return READS[op]; } };
  const ta = createTreeAdmin(terra, () => ({ allPermissions: true }), { gate: o.gate || open, canApprove: () => o.door !== false,
    approve: async (op, inp) => { calls.door.push([op, inp]); return o.deny ? { ok: false, code: 'APPROVAL_DENIED', text: '', hint: '' } : { ok: true, status: 200, data: o.result || { affected_nodes: 3, cluster_nodes: 5, restart_required: ['audit.retention_days'] }, withheld: [] }; } });
  const prev = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {}, TerraTreeAdmin: ta };
  const c = new lib.Component({ nodeName: 'tree-1', nodeKind: o.kind || 'tree' }); c.componentDidMount(); await flush();
  return { c, v: () => c.renderVals(), calls, done: () => { globalThis.window = prev; } };
}
const tab = async (m, k) => { m.v().tabs.find((t) => t.name === k).pick(); await flush(); return m.v(); };
const act = (m, name) => m.v().acts.find((a) => a.name === name).pick();
const typeIn = (m, label, value) => { const f = m.v().fields.find((x) => x.label.startsWith(label)); f.onInput({ target: { value } }); };

test('Tree 노드가 아니면 창이 이유만 보이고 아무것도 부르지 않는다', async () => {
  const m = await mount({ kind: 'leaf' });
  try { const v = m.v(); assert.equal(v.openOn, false); assert.equal(v.blockedOn, true); assert.match(v.blockedT, /리프 노드에는 Master 가 없어/); assert.equal(m.calls.read.length, 0); } finally { m.done(); }
});

test('모듈 게시 탭 — 목록을 읽고 줄을 누르면 게시 id 가 채워지고, 롤아웃은 승인 문으로(정수 단계)', async () => {
  const m = await mount();
  try {
    let v = m.v(); assert.equal(v.rows.length, 1); assert.match(v.rows[0].title, /io\.terra\.file 0\.4\.0/); assert.deepEqual(v.tabs.map((t) => t.name), ['모듈 게시', '승격 심사', '정책', '코어 롤아웃', 'Master 설정']);
    act(m, '롤아웃'); m.v().rows[0].pick();
    assert.equal(m.v().fields.find((f) => f.key === 'publication_id').value, 'pub-1');
    typeIn(m, '단계', '1'); m.v().bar[0].run(); await flush(); v = m.v();   // 카나리아 노드 없이 단계 1 → 입력 오류
    assert.match(v.resHead, /입력 오류/); assert.equal(m.calls.door.length, 0);
    typeIn(m, '단계', '10'); m.v().bar[0].run(); await flush(); v = m.v();
    assert.deepEqual(m.calls.door, [['terra.master.modules.publications.by-publication-id.rollout.post', { publication_id: 'pub-1', stage: 10 }]]);
    assert.match(v.resHead, /T3 · 승인됨/); assert.equal(v.resCls, 'ta-ok');
    assert.ok(!m.calls.read.some(([op]) => /\.post$/.test(op) && op !== OPS.configValidate), '쓰기는 직접 호출하지 않는다');
  } finally { m.done(); }
});

test('승격 심사 — 권한이 늘면 줄에 표시, 줄을 누르면 digest 가 채워져 승인에 실린다 · 거절은 이유 필수', async () => {
  const m = await mount();
  try {
    let v = await tab(m, '승격 심사'); assert.equal(v.rows[0].tagOn, true); assert.equal(v.rows[0].tag, '권한↑');
    m.v().rows[0].pick();
    m.v().bar[0].run(); await flush();
    assert.deepEqual(m.calls.door.at(-1), ['terra.master.modules.promotions.by-promotion-id.approve.post', { promotion_id: 'pr-1', acknowledge_permissions: 'sha256:abc' }]);
    act(m, '거절'); m.v().rows[0].pick(); m.v().bar[0].run(); await flush(); v = m.v();
    assert.match(v.resHead, /입력 오류 — reason 필요/); assert.equal(m.calls.door.length, 1);
  } finally { m.done(); }
});

test('정책 — 상한 · 미러 거부 목록, 상한은 T4 이고 쉼표 목록이 배열로', async () => {
  const m = await mount();
  try {
    let v = await tab(m, '정책'); assert.deepEqual(v.rows.filter((r) => r.isHead).map((r) => r.title), ['승인 상한 — 1개', '미러 거부 — 1개']);
    assert.equal(v.tier, 'T4'); typeIn(m, '넘을 수 없는', 'process.execute, file.write'); m.v().bar[0].run(); await flush();
    assert.deepEqual(m.calls.door.at(-1), ['terra.master.modules.approval-ceiling.post', { permissions: ['process.execute', 'file.write'] }]);
  } finally { m.done(); }
});

test('코어 롤아웃 — 끝난 뒤 "N대에 적용"(affected_nodes) · 거절은 조용히', async () => {
  const m = await mount();
  try {
    await tab(m, '코어 롤아웃'); act(m, '롤아웃'); m.v().rows[0].pick(); typeIn(m, '단계', '50'); m.v().bar[0].run(); await flush();
    assert.deepEqual(m.calls.door.at(-1), ['terra.master.core.releases.by-release-id.rollout.post', { release_id: 'rel-1', stage: 50 }]);
    assert.match(m.v().resHead, /T4 · 승인됨 · 3대에 적용 \(이 클러스터 5대 중\)/); assert.equal(m.v().tier, 'T4');
  } finally { m.done(); }
  const n = await mount({ deny: true });
  try { await tab(n, '코어 롤아웃'); act(n, '롤아웃'); n.v().rows[0].pick(); typeIn(n, '단계', '10'); n.v().bar[0].run(); await flush(); assert.equal(n.v().resOn, false); } finally { n.done(); }
});

test('Master 설정 — 스키마로 칸(비밀 · 고칠 수 없음은 읽기 줄), 검증 통과 뒤에만 patch(T4), 안 받으면 patch 안 나감', async () => {
  const m = await mount();
  try {
    let v = await tab(m, 'Master 설정'); assert.deepEqual(v.fields.map((f) => f.key), ['audit.retention_days', 'log_level']); assert.equal(v.roOn, true); assert.equal(v.roRows[0].value, '(숨김)');
    assert.equal(v.bar[1].off, 'disabled');   // 바뀐 칸 없음
    v.fields.find((f) => f.key === 'log_level').onInput({ target: { value: 'debug' } });
    m.v().bar[1].run(); await flush(); v = m.v();
    assert.deepEqual(m.calls.door, [['terra.master.config.patch', { changes: { log_level: 'debug' } }]]);
    assert.match(v.resHead, /T4 · 승인됨 · 저장됨 — Master 를 다시 시작해야 반영 : audit\.retention_days/);
  } finally { m.done(); }
  const n = await mount();
  try {
    await tab(n, 'Master 설정');
    n.v().fields.find((f) => f.key === 'audit.retention_days').onInput({ target: { value: 'abc' } }); n.v().bar[1].run(); await flush();
    assert.match(n.v().resHead, /입력 오류 — audit\.retention_days 숫자/); assert.equal(n.calls.door.length, 0);
  } finally { n.done(); }
});

test('Master 가 값을 안 받으면(validate 거부) patch 를 제안하지 않는다', async () => {
  const calls = { door: [] };
  const terra = { invoke: async (op) => (op === OPS.configValidate ? { valid: false, errors: [{ key: 'log_level', message: '허용하지 않는 값' }] } : READS[op]) };
  const ta = createTreeAdmin(terra, () => ({ allPermissions: true }), { gate: open, canApprove: () => true, approve: async (op, i) => { calls.door.push([op, i]); return { ok: true, data: {} }; } });
  const prev = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {}, TerraTreeAdmin: ta };
  try {
    const c = new lib.Component({ nodeKind: 'tree' }); c.componentDidMount(); await flush();
    c.pickTab('config'); await flush(); let v = c.renderVals();
    v.fields.find((f) => f.key === 'log_level').onInput({ target: { value: 'nope' } }); c.renderVals().bar[1].run(); await flush(); v = c.renderVals();
    assert.equal(calls.door.length, 0); assert.match(v.resHead, /Master 가 이 값을 받지 않음/); assert.match(v.resBody, /log_level — 허용하지 않는 값/);
  } finally { globalThis.window = prev; }
});

test('승인 문이 없으면(단독 실행) 쓰기 단추는 닫히고 안내 · 위임 표가 안 열어 준 op 는 잠금 칩', async () => {
  const m = await mount({ door: false });
  try { const v = m.v(); assert.equal(v.noDoorOn, true); assert.equal(v.bar[0].off, 'disabled'); assert.equal(v.rows.length, 1, '읽기는 그대로'); } finally { m.done(); }
  const g = await mount({ gate: (op) => ({ open: false, needs: 'core', why: '잠김 : 위임 없음 — ' + op, op }) });
  try { const v = g.v(); assert.equal(v.lockOn, true); assert.equal(v.chipT, '위임 없음'); assert.equal(v.bar[0].off, 'disabled'); assert.match(v.why, /위임 없음/); } finally { g.done(); }
});

test('읽기를 못 하면 "없음"이 아니라 "못 봤음"', async () => {
  const terra = { invoke: async () => { throw Object.assign(new Error('x'), { code: 'GATEWAY_UNAVAILABLE' }); } };
  const ta = createTreeAdmin(terra, () => ({ allPermissions: true }), { gate: open, canApprove: () => true, approve: async () => ({ ok: true, data: {} }) });
  const prev = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {}, TerraTreeAdmin: ta };
  try { const c = new lib.Component({ nodeKind: 'tree' }); c.componentDidMount(); await flush(); const v = c.renderVals(); assert.match(v.emptyT, /못 봤음 : GATEWAY_UNAVAILABLE/); assert.equal(v.rows.length, 0); } finally { globalThis.window = prev; }
});

test('시안(캔버스) — Terra 없이 탭 · 줄 · 칸이 보이고 실행은 닫혀 있다', async () => {
  const prev = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    const c = new lib.Component({}); c.componentDidMount(); const v = c.renderVals();
    assert.equal(v.tabs.length, 5); assert.ok(v.rows.length >= 1); assert.ok(v.fields.length >= 1); assert.equal(v.bar[0].off, 'disabled'); assert.match(v.srcT, /시안/);
  } finally { globalThis.window = prev; }
});
