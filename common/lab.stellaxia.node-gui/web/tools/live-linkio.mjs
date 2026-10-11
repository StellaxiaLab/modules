// 입출력 연결(MD-1 · MD-32) 진짜 스택 실측 — 모듈 코드(TerraClient · applyLink · grantSelf · syncLinks · closeBindings)를 그대로,
// 이 앱의 토큰(tsa_)으로 진짜 leaf 게이트웨이의 위임 입구(/api/upstream — Terra ADR-GW-003 · 004)에 붙인다. 화면(브라우저)은 거치지 않는다.
//
//   tools/live-stack-up.sh <Terra 체크아웃> <작업 폴더>   # 스택을 세우고 env.sh 를 만든다
//   . <작업 폴더>/env.sh && node tools/live-linkio.mjs
//
// 쓰는 환경변수(env.sh 가 채운다): TERRA_GW · TERRA_APP_TOKEN_FILE · TERRA_SRC_RES(test.stream — bytes 소스) · TERRA_PEER_NODE(같은 클러스터의 다른 노드)
//   · TERRA_D1_LOCAL · TERRA_D1_LOCAL_TOKEN_FILE · TERRA_FILES_DIR(Daemon 의 svi.runtime 울타리 안 — 파일 싱크를 런타임 선언으로 올린다)
// 스택 만드는 법과 결과: docs/api/real-data-layer.md §5.9 · §5.10
import { readFileSync, statSync, existsSync } from 'node:fs';
const W = new URL('../src/', import.meta.url).href;
const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win; globalThis.window = win;
const { TerraClient } = await import(W + 'api/client.js');
const { applyLink, grantSelf, lacksOf, userIdOf, OPS, GRANT_SELF_TTL_DEFAULT } = await import(W + 'api/link-apply.js');
const { syncLinks, closeBindings } = await import(W + 'api/link-sync.js');
const { SHARE_TTL_DEFAULT, setEndpointChoice, buildIO } = await import(W + 'model/link-io.js');

const E = process.env;
const GW = E.TERRA_GW || 'http://127.0.0.1:28787';
const app = readFileSync(E.TERRA_APP_TOKEN_FILE || 'app.tok', 'utf8').trim();
const SRC = E.TERRA_SRC_RES, PEER = E.TERRA_PEER_NODE;
// 싱크는 **소스와 다른 노드(d2)** 에 올린다 — Terra 의 Go e2e 도 두 Daemon 사이로 잇는다
const LOCAL = E.TERRA_D2_LOCAL, LOCAL_TOK = E.TERRA_D2_LOCAL_TOKEN_FILE && readFileSync(E.TERRA_D2_LOCAL_TOKEN_FILE, 'utf8').trim(), FILES = E.TERRA_FILES_DIR;
if (!SRC || !PEER || !LOCAL || !LOCAL_TOK || !FILES) { console.error('env.sh 를 먼저 읽는다(tools/live-stack-up.sh)'); process.exit(2); }
const authFetch = (url, init = {}) => fetch(url, Object.assign({}, init, { headers: Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + app }) }));
const client = new TerraClient(GW, { fetch: authFetch, delegated: true });
await client.refreshCatalog();

const results = [];
const check = (name, ok, info) => { results.push([ok, name]); console.log((ok ? '✓ ' : '✗ ') + name + (info ? ' — ' + info : '')); };
const one = (s) => String(s).replace(/\n/g, ' ⏎ ').slice(0, 260);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizeOf = (p) => (existsSync(p) ? statSync(p).size : 0);

// ───── 0) 신원 · 위임 입구 ─────
const who = await client.get('/api/v1/agent/whoami');
const principal = who.kind === 'ok' && who.data ? who.data.principal : '';
const userId = userIdOf(principal);
check('whoami — 앱 토큰의 principal 은 `user_… via <앱>` 이고 사용자 id 만 꺼낸다', /^user_\S+$/.test(userId) && / via /.test(principal), principal + ' → ' + userId);
const eps = await client.invoke(OPS.endpoints, { resource_id: SRC });
check('엔드포인트 읽기 — 위임 입구(GET)', eps.kind === 'ok', one(JSON.stringify((eps.data && (eps.data.items || eps.data.endpoints) || []).map((e) => e.endpoint_id + ':' + e.direction))));

// 파일 싱크를 런타임 선언으로 올린다 — 이 노드(d1)의 Local API. 같은 이름이면 그대로(unchanged)
const sinkPath = FILES + '/inbox.log';
const decl = await fetch(LOCAL + '/svi/declarations', { method: 'POST', headers: { Authorization: 'Bearer ' + LOCAL_TOK, 'Content-Type': 'application/json' }, body: JSON.stringify({ family: 'file', name: 'inbox', direction: 'sink', path: sinkPath }) }).then((r) => r.json());
const SINK = decl.data && decl.data.resource_id;
check('파일 싱크 선언(런타임) — 호환되는 쌍의 도착', !!SINK && decl.data.published !== false, SINK || one(JSON.stringify(decl)));
for (let i = 0; i < 20; i++) { const r = await client.invoke(OPS.endpoints, { resource_id: SINK }); if (r.kind === 'ok') break; await sleep(500); }

// ───── 맵 · 연결 (화면이 만드는 것과 같은 모양) ─────
const NODE_SRC = SRC.split('.')[1];   // svi.<node_id>.<local>
const ctx = {
  rsrc: { '1-1': { app: 'svi', id: SRC, node: 'leaf', name: 'src' }, '3-1': { app: 'svi', id: SINK, node: 'sink', name: 'sink' } },
  nodes: { '0-0': { name: 'peer' } }, self: null, map: 'leaf', treeId: 'live-md32',
  nodeIdOf: (n) => ({ leaf: NODE_SRC, sink: SINK.split('.')[1], peer: PEER }[n] || null)
};
const L = (id, from, to) => ({ id, from, to, start: from, path: [], road: 'stone' });
const opts = { userId: principal };   // 화면은 whoami principal 을 그대로 넘긴다 — 정규화는 applyLink · grantSelf 가 한다
/** 소스 자원은 엔드포인트가 둘(output · text)이라 사람이 고른다 — 고르지 않으면 invalid(endpoint_not_chosen) */
const linkWith = (id, srcEp) => {
  const l0 = L(id, '1-1', '3-1');
  let io = buildIO(l0, [l0], ctx, null);   // 화면이 연결을 그릴 때 만드는 io
  io = setEndpointChoice(io, 'source', SRC, srcEp);
  io = setEndpointChoice(io, 'target', SINK, 'append');
  return Object.assign({}, l0, { io });
};

// ───── 1) 어긋난 쌍 — 소스 text(terra.text@1) → 싱크 bytes: 계열이 달라 만들어지지 않는다 ─────
const bad = linkWith('md32-bad', 'text');
const rb = await applyLink({ client }, bad, [bad], ctx, opts);
check('어긋난 쌍은 바인딩이 만들어지지 않는다', rb.applied === 0 && !rb.io.pairs.some((p) => p.binding_id), 'phase ' + rb.io.phase + ' · ' + one(rb.notes.join(' / ')));
check('거절 이유를 말한다(미리 검사 또는 Master)', !!((rb.io.pairs[0] || {}).reason || rb.io.reason || rb.notes.length), one((rb.io.pairs[0] || {}).reason || rb.io.reason || rb.notes[0] || ''));
const direct = await client.invoke(OPS.bindPost, { source_resource_id: SRC, source_endpoint_id: 'text', target_resource_id: SINK, target_endpoint_id: 'append', idempotency_key: 'live-md32-direct' });
check('bindings.post — Master 도 거절한다', direct.kind !== 'ok' && direct.kind !== 'accepted', direct.kind + ' ' + (direct.status || '') + ' ' + one(direct.reason || ''));

// ───── 2) 정상 쌍 — 소스 output(bytes) → 싱크 append(bytes): 허가 없음 → 허가 → 바인딩 → active → 데이터 → 닫기 ─────
const good = linkWith('md32-good', 'output');
const g0 = await applyLink({ client }, good, [good], ctx, opts);
const lacks = (g0.io.pairs[0] ? lacksOf(g0.io.pairs[0]) : []);
check('허가 없이 적용 — needs-grant · 부족한 허가 둘 · 바인딩은 만들지 않는다', g0.io.phase === 'needs-grant' && lacks.length === 2 && !g0.io.pairs.some((p) => p.binding_id), 'phase ' + g0.io.phase + ' · ' + one(lacks.map((l) => l.operation).join(', ')));

check('허가 기본 기한은 90일 이하', GRANT_SELF_TTL_DEFAULT <= 90 * 86400, GRANT_SELF_TTL_DEFAULT / 86400 + '일');
const g = await grantSelf(client, lacks, principal);
check('grantSelf — 본인에게 허가 만들기(2b)', g && g.ok && g.made.length === 2, one(JSON.stringify(g)));
const mine = await client.invoke(OPS.grantsGet, { resource_id: SRC, subject_type: 'user', subject_id: userId, limit: 50 });
const mineItems = mine.kind === 'ok' ? (mine.data.items || mine.data.grants || []) : [];
check('허가 목록에 보인다 — 기한이 있다', mineItems.some((x) => x.operations && x.operations.includes('bind.source') && x.expires_at), one(JSON.stringify(mineItems.map((x) => ({ ops: x.operations, exp: x.expires_at })))));

const before = sizeOf(sinkPath);
const g1 = await applyLink({ client }, good, [good], ctx, opts);
const bid = g1.io.pairs[0] && g1.io.pairs[0].binding_id;
check('허가 뒤 적용 — 바인딩이 만들어진다(2a)', !!bid && g1.applied === 1, 'phase ' + g1.io.phase + ' · binding ' + bid + ' · ' + one(g1.notes.join(' / ')));
const g2 = await applyLink({ client }, Object.assign({}, good, { io: g1.io }), [good], ctx, opts);
check('다시 적용 — 같은 바인딩을 쓴다(새로 만들지 않는다)', g2.io.pairs[0] && g2.io.pairs[0].binding_id === bid && g2.applied === 0, 'applied ' + g2.applied);

let cur = Object.assign({}, good, { io: g1.io }), phase = cur.io.phase;
for (let i = 0; i < 40 && phase !== 'active'; i++) { await sleep(500); const s = await syncLinks(client, [cur]); if (s.links && s.links[0]) { cur = s.links[0]; phase = cur.io.phase; } }
check('상태 맞추기 — 바인딩이 active 가 된다', phase === 'active', 'phase ' + phase);
for (let i = 0; i < 30 && sizeOf(sinkPath) - before <= 0; i++) await sleep(500);   // 소스가 첫 프레임을 내는 데 걸리는 시간
const grown = sizeOf(sinkPath) - before;
check('데이터가 흐른다 — 싱크 파일이 자란다', grown > 0, grown + ' 바이트');

const cl = await closeBindings(client, [bid]);
check('closeBindings — 바인딩 닫기(2a delete)', cl.closed.includes(bid) && cl.failed.length === 0, JSON.stringify(cl));
let ph2 = '';
for (let i = 0; i < 40 && ph2 !== 'closed'; i++) { await sleep(500); const s = await syncLinks(client, [cur]); if (s.links && s.links[0]) { cur = s.links[0]; ph2 = cur.io.phase; } }
check('닫은 뒤 상태 맞추기 — closed', ph2 === 'closed', 'phase ' + ph2);
await sleep(800); const s1 = sizeOf(sinkPath); await sleep(1200);
check('닫은 뒤 파일이 더 자라지 않는다', sizeOf(sinkPath) === s1, s1 + ' → ' + sizeOf(sinkPath));
const cl2 = await closeBindings(client, [bid, 'svib_does_not_exist']);
check('이미 닫힌 · 없는 바인딩 닫기 — 오류로 치지 않는다', cl2.failed.length === 0, JSON.stringify(cl2));

// ───── 3) 위임 입구의 가드(ADR-GW-004 §3) ─────
const over = await client.invoke(OPS.grantsPost, { subject_type: 'user', subject_id: userId, resource_id: SRC, operations: ['read'], ttl_seconds: 91 * 86400 });
check('91일 기한은 거절(403)', over.kind !== 'ok' && over.kind !== 'accepted', over.kind + ' ' + (over.status || '') + ' ' + one(over.reason || ''));
const noTtl = await client.invoke(OPS.grantsPost, { subject_type: 'user', subject_id: userId, resource_id: SRC, operations: ['read'] });
check('기한 없는 허가는 거절', noTtl.kind !== 'ok' && noTtl.kind !== 'accepted', noTtl.kind + ' ' + (noTtl.status || ''));
const toOther = await client.invoke(OPS.grantsPost, { subject_type: 'user', subject_id: 'user_someone_else', resource_id: SRC, operations: ['read'], ttl_seconds: 3600 });
check('남에게 주는 허가는 거절', toOther.kind !== 'ok' && toOther.kind !== 'accepted', toOther.kind + ' ' + (toOther.status || ''));

// ───── 4) 공유 — 자원 → 같은 클러스터의 다른 노드(노드 주체 허가) ─────
const share = L('md32-share', '1-1', '0-0');
const sh1 = await applyLink({ client }, share, [share], ctx, opts);
const gid = sh1.io.pairs[0] && sh1.io.pairs[0].grant_id;
check('공유 적용 — 노드 주체 허가가 만들어진다', sh1.io.phase === 'shared' && !!gid, 'phase ' + sh1.io.phase + ' · grant ' + gid + ' · ' + one(sh1.notes.join(' / ')));
const sh2 = await applyLink({ client }, share, [share], ctx, opts);
check('공유 다시 적용 — 있는 허가를 쓴다(새로 만들지 않는다)', sh2.io.pairs[0] && sh2.io.pairs[0].grant_id === gid && sh2.applied === 0, 'applied ' + sh2.applied);
const sy = await syncLinks(client, [Object.assign({}, share, { io: sh1.io })]);
check('상태 맞추기 — 공유 허가가 보인다', sy.links && sy.links[0] && sy.links[0].io.phase === 'shared', sy.links && one(sy.links[0].io.phase + ' ' + (sy.unavailable || '')));
const nodeGrants = await client.invoke(OPS.grantsGet, { resource_id: SRC, subject_type: 'node', limit: 50 });
const ng = nodeGrants.kind === 'ok' ? (nodeGrants.data.items || nodeGrants.data.grants || []) : [];
const mineNode = ng.find((x) => x.grant_id === gid);
check('Master 기록 — 노드 허가 · 기한 ' + SHARE_TTL_DEFAULT / 86400 + '일 안', mineNode && mineNode.subject && mineNode.subject.id === PEER && Date.parse(mineNode.expires_at) - Date.now() <= 90 * 86400000, one(JSON.stringify(mineNode && { subject: mineNode.subject, ops: mineNode.operations, exp: mineNode.expires_at })));
const rev = await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: gid });
check('허가 철회(2b delete)', rev.kind === 'ok' || rev.kind === 'accepted', rev.kind + ' ' + (rev.status || ''));
const sy2 = await syncLinks(client, [Object.assign({}, share, { io: sh1.io })]);
check('철회 뒤 상태 맞추기 — 더는 shared 가 아니다', sy2.links && sy2.links[0].io.phase !== 'shared', sy2.links && sy2.links[0].io.phase);

// 남은 내 허가 정리(스택을 깨끗이)
for (const res of [SRC, SINK]) {
  const r = await client.invoke(OPS.grantsGet, { resource_id: res, subject_type: 'user', subject_id: userId, limit: 50 });
  for (const x of (r.kind === 'ok' ? (r.data.items || r.data.grants || []) : [])) if (x.grant_id) await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: x.grant_id });
}

const failed = results.filter((r) => !r[0]);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 통과');
process.exit(failed.length ? 1 : 0);
