// node --test — 제어기 쓰기 흐름의 순수 함수(desk-flows.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { parseEnrollCode, enrollResult, ENROLL_ERR, readTmod, tmodView, tmodPerms, asgSteps, NET_WRITES, tunnelInput, DECIDE, CONTRACT_WHY } from './desk-flows.js';

const b64u = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('등록 코드 — tnc_ · 주소를 품은 꼴 · tjc_ 거절 · 깨진 주소는 비밀만', () => {
  assert.deepEqual(parseEnrollCode(''), { ok: false, kind: '', why: '', origin: '', masked: '', needsUrl: false });
  const a = parseEnrollCode('tnc_AbCdEfGh12');
  assert.equal(a.ok, true); assert.equal(a.origin, ''); assert.equal(a.needsUrl, true); assert.match(a.masked, /^tnc_AbCd… \(10자\)$/);
  const b = parseEnrollCode(' tnc_Zz9_-Q.' + b64u('https://tree-02.lab:8080/') + ' ');
  assert.equal(b.ok, true); assert.equal(b.origin, 'https://tree-02.lab:8080'); assert.equal(b.needsUrl, false);
  assert.equal(parseEnrollCode('tjc_abcd').kind, 'tjc');
  assert.equal(parseEnrollCode('TR-1234').kind, 'bad');
  const c = parseEnrollCode('tnc_abcd.' + b64u('ftp://x'));
  assert.equal(c.ok, true); assert.equal(c.origin, ''); assert.match(c.note, /http\(s\)/);
  const d = parseEnrollCode('tnc_abcd.%%%');
  assert.equal(d.ok, true); assert.equal(d.needsUrl, true);
});

test('등록 결과 — 202 응답(재시작 · 종료 코드 75 · 주소 못 적음)과 오류 문장', () => {
  const L = enrollResult({ status: { registered: true, node_id: 'nd_1' }, master_url: 'https://t', master_url_persisted: false, restarting: true, service_manager: 'systemd-user', exit_code: 75 });
  assert.deepEqual(L.map((x) => x[0]), ['등록', 'Master', '다시 시작']);
  assert.match(L[0][1], /nd_1/); assert.match(L[1][1], /설정 저장 실패/); assert.match(L[2][1], /종료 코드 75/);
  assert.match(enrollResult({ status: {}, restarting: false })[2][1], /직접 재시작/);
  for (const k of ['ENROLL_CODE_USED', 'ENROLL_CODE_EXPIRED', 'ENROLL_MASTER_URL_REQUIRED', 'LOCAL_API_CONFLICT']) assert.ok(ENROLL_ERR[k], k);
});

// 작은 zip — 엔트리 [이름, 내용, 압축?]
function zip(files) {
  const loc = [], cen = []; let off = 0;
  for (const [name, text, def] of files) {
    const nb = Buffer.from(name), raw = Buffer.from(text), data = def ? deflateRawSync(raw) : raw;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(def ? 8 : 0, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nb.length, 26);
    loc.push(h, nb, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(def ? 8 : 0, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...loc, cd, e]));
}
const MAN = { schemaVersion: 2, id: 'lab.x.demo', name: 'Demo', version: '1.2.0', kind: 'service', compatibility: { products: ['leaf'], os: ['linux'] },
  permissions: { coreOperations: [{ id: 'terra.daemon.commands.execute.post' }, { capability: 'node.read' }], storage: ['module-data'], native: ['gpio'] },
  signature: { algorithm: 'ed25519', keyId: 'k-lab-1', issuer: 'tree:lab', signedAt: '2026-10-01T00:00:00Z', value: 'xx' } };

test('.tmod — 압축된 module.json 을 브라우저 방식(DecompressionStream)으로 읽고, 권한 · 서명 · 게시자 키를 보인다', async () => {
  const r = await readTmod(zip([['module.json', JSON.stringify(MAN), true], ['bin/linux-amd64/demo', 'ELF', true]]));
  assert.equal(r.first, true); assert.deepEqual(r.entries, ['module.json', 'bin/linux-amd64/demo']); assert.equal(r.manifest.id, 'lab.x.demo');
  const v = tmodView(r, { ver: '1.1.0' }, { os: 'linux' });
  assert.equal(v.signed, true); assert.equal(v.key, 'k-lab-1 · tree:lab'); assert.equal(v.exists, '설치됨 1.1.0 → 1.2.0'); assert.equal(v.files, 2);
  assert.deepEqual(v.perms.map((p) => p.t), ['terra.daemon.commands.execute.post', 'node.read', 'storage:module-data', 'native:gpio']);
  assert.equal(v.perms[0].cls, 'warn'); assert.equal(v.perms[3].cls, 'err');
  assert.ok(v.warns.some((w) => /검증 안 함/.test(w.t))); assert.ok(v.warns.some((w) => /native/.test(w.t)));
});

test('.tmod — 서명 없음 · 첫 엔트리 아님 · 다른 OS · zip 아님 · module.json 없음', async () => {
  const m = Object.assign({}, MAN); delete m.signature;
  const r = await readTmod(zip([['README', 'hi', false], ['module.json', JSON.stringify(m), false]]));
  const v = tmodView(r, null, { os: 'windows' });
  assert.equal(v.signed, false); assert.equal(v.exists, '새 모듈');
  assert.ok(v.warns.some((w) => /서명 없음 — 개발 모드/.test(w.t))); assert.ok(v.warns.some((w) => /첫 엔트리 아님/.test(w.t))); assert.ok(v.warns.some((w) => /호환 목록/.test(w.t) && w.cls === 'err'));
  await assert.rejects(readTmod(new Uint8Array([1, 2, 3, 4])), /zip 아님/);
  await assert.rejects(readTmod(zip([['x.txt', 'a', false]])), /module\.json 없음 — 모듈 패키지 아님/);
  assert.deepEqual(tmodPerms({ permissions: ['node.read'] }).map((p) => p.t), ['node.read']);
});

test('배정 진행 — 단계 · 막대 · 실패 안내', () => {
  const t0 = 1e6;
  let r = asgSteps({ post: { st: 'err', code: 'MODULE_NOT_FOUND' } }, t0);
  assert.deepEqual(r.steps.map((s) => s.st), ['fail', 'fail', 'wait', 'wait', 'wait']); assert.match(r.fix, /게시본 없음/); assert.equal(r.end, true);
  r = asgSteps({ post: { st: 'err', code: 403 } }, t0); assert.match(r.fix, /module\.manage/); assert.equal(r.steps[0].st, 'unknown');
  r = asgSteps({ post: { st: 'ok', at: t0 } }, t0 + 1000); assert.deepEqual(r.steps.map((s) => s.st), ['done', 'done', 'now', 'wait', 'wait']); assert.equal(r.pct, 40); assert.equal(r.fix, '');
  r = asgSteps({ post: { st: 'ok', at: t0 } }, t0 + 61000); assert.match(r.fix, /하트비트/);
  r = asgSteps({ post: { st: 'ok' }, offer: { st: 'wait', state: 'offered' } }, t0); assert.equal(r.steps[3].st, 'now'); assert.match(r.fix, /동의/);
  r = asgSteps({ post: { st: 'ok' }, offer: { st: 'wait', state: 'stale' } }, t0); assert.equal(r.steps[2].st, 'fail'); assert.match(r.fix, /stale/); assert.equal(r.end, true);
  r = asgSteps({ offer: { st: 'consent', state: 'accepted' } }, t0); assert.deepEqual(r.steps.map((s) => s.st), ['done', 'done', 'done', 'done', 'now']);
  r = asgSteps({ offer: { st: 'consent' }, mod: { st: 'fail', err: 'disk quota' } }, t0); assert.equal(r.steps[4].st, 'fail'); assert.match(r.fix, /disk quota/);
  r = asgSteps({ mod: { st: 'run' } }, t0); assert.equal(r.pct, 100); assert.equal(r.end, true);
  r = asgSteps({}, t0); assert.deepEqual(r.steps.map((s) => s.st), ['unknown', 'wait', 'wait', 'wait', 'wait']);
});

// Master 라우트 입력 구조체(routes_network.go) · 계약에 그 op 가 있는지
const M = JSON.parse(readFileSync(new URL('./master-delegated.json', import.meta.url), 'utf8'));
test('네트워크 쓰기 — op 이름은 Master 계약 꼴 · 입력 모양', () => {
  const ids = NET_WRITES.map((w) => w.op);
  assert.deepEqual(ids, ['terra.master.network.mesh.wireguard.reconcile.post', 'terra.master.network.mesh.wireguard.plan.post', 'terra.master.network.mesh.wireguard.peers.revoke.post', 'terra.master.network.probes.post',
    'terra.master.route.policies.put', 'terra.master.route.policies.by-policy-id.delete', 'terra.master.route.sessions.by-session-id.close.post', 'terra.master.connection-groups.by-group-id.close.post']);
  for (const w of NET_WRITES) { assert.ok(!M.operations[w.op], w.op + ' 는 아직 위임 밖이다 — 열렸으면 이 시험을 고친다(화면은 저절로 열린다)'); assert.ok(w.undo && w.what, w.id); }
  const by = Object.fromEntries(NET_WRITES.map((w) => [w.id, w]));
  assert.deepEqual(by.plan.input({ nodes: 'a, b', cidr: '10.0.0.0/24', listen_port: '51820' }), { nodes: [{ node_id: 'a' }, { node_id: 'b' }], cidr: '10.0.0.0/24', listen_port: 51820 });
  assert.equal(by.plan.check({ nodes: 'a' }), '노드 둘 이상 필요');
  assert.deepEqual(by.revoke.input({ source_node_id: 'a', target_node_id: 'b' }), { source_node_id: 'a', target_node_id: 'b', bidirectional: true });
  assert.deepEqual(by.probe.input({ source_node_id: 'a', target_node_id: 'b', adapter: '' }), { source_node_id: 'a', target_node_id: 'b' });
  assert.deepEqual(by.policyPut.input({ target_node_id: 'b', mode: 'prefer', prefer: 'mesh_direct,master_relay' }), { scope: { target_node_id: 'b' }, policy: { mode: 'prefer', prefer: ['mesh_direct', 'master_relay'] } });
  assert.deepEqual(by.sessionClose.input({ session_id: 'rt_1' }), { session_id: 'rt_1' });
});

test('서비스 터널 열기 — Master serviceTunnelPlanInput 꼴, loopback 만', () => {
  assert.deepEqual(tunnelInput({ target_node_id: 'nd_b', target_port: '22', local_port: '', max_connections: '' }, 'nd_a').input,
    { source_node_id: 'nd_a', target_node_id: 'nd_b', service_id: 'tcp-22', target_host: '127.0.0.1', target_port: 22, local_bind_host: '127.0.0.1', local_port: 0, max_connections: 1 });
  assert.match(tunnelInput({ target_node_id: 'nd_b', target_port: '0' }, 'nd_a').err, /대상 포트/);
  assert.match(tunnelInput({ target_node_id: 'nd_a', target_port: '22' }, 'nd_a').err, /다른 노드/);
  assert.match(tunnelInput({ target_port: '22' }, '').err, /Master id/);
});

test('결정 표 · 계약 이유 — 파일 설치는 결정 전까지 닫힘', () => {
  assert.equal(DECIDE.tmodInstall.locked, true); assert.match(DECIDE.tmodInstall.why, /^결정 필요 — process\.execute 경로/);
  assert.match(CONTRACT_WHY['terra.master.users.by-user-id.external-identities.post'], /위임 세션\(앱 토큰\) 닫힘/);
});
