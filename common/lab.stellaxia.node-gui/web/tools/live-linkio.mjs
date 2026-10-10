// 입출력 연결(MD-1 · MD-32) 진짜 스택 실측 — 모듈 코드(TerraClient · applyLink · grantSelf · syncLinks · closeBindings)를 그대로,
// 이 앱의 토큰(tsa_)으로 진짜 leaf 게이트웨이의 위임 입구(/api/upstream — Terra ADR-GW-003 · 004)에 붙인다. 화면(브라우저)은 거치지 않는다.
//
//   TERRA_GW=http://127.0.0.1:28787 TERRA_APP_TOKEN_FILE=app.tok \
//   TERRA_SRC_RES=svi.<node>.test.stream TERRA_SINK_RES=svi.<node>.io-weave.pointer \
//   TERRA_PEER_NODE=<같은 클러스터의 다른 node_id> node tools/live-linkio.mjs
//
// 스택 만드는 법과 결과: docs/api/real-data-layer.md §5.8. 이 판은 호환되는 소스 · 싱크 쌍이 없는 스택(test.stream bytes ↔ io-weave mouse)에서
// 도는 것을 전제로 한다 — 정상 바인딩(active)은 이 시험에 없다. 그 자리는 Terra 의 Go e2e(binding_delegated_e2e_test.go)가 본다.
import { readFileSync } from 'node:fs';
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
const SRC = E.TERRA_SRC_RES, SINK = E.TERRA_SINK_RES, PEER = E.TERRA_PEER_NODE;
if (!SRC || !SINK || !PEER) { console.error('TERRA_SRC_RES · TERRA_SINK_RES · TERRA_PEER_NODE 가 필요하다'); process.exit(2); }
const authFetch = (url, init = {}) => fetch(url, Object.assign({}, init, { headers: Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + app }) }));
const client = new TerraClient(GW, { fetch: authFetch, delegated: true });
await client.refreshCatalog();

const results = [];
const check = (name, ok, info) => { results.push([ok, name]); console.log((ok ? '✓ ' : '✗ ') + name + (info ? ' — ' + info : '')); };
const one = (s) => String(s).replace(/\n/g, ' ⏎ ').slice(0, 260);

// ───── 0) 신원 · 위임 입구 ─────
const who = await client.get('/api/v1/agent/whoami');
const principal = who.kind === 'ok' && who.data ? who.data.principal : '';
const userId = userIdOf(principal);
check('whoami — 앱 토큰의 principal 은 `user_… via <앱>` 이고 사용자 id 만 꺼낸다', /^user_\S+$/.test(userId) && / via /.test(principal), principal + ' → ' + userId);
const eps = await client.invoke(OPS.endpoints, { resource_id: SRC });
check('엔드포인트 읽기 — 위임 입구(GET)', eps.kind === 'ok', one(JSON.stringify((eps.data && (eps.data.items || eps.data.endpoints) || []).map((e) => e.endpoint_id + ':' + e.direction))));

// ───── 맵 · 연결 (화면이 만드는 것과 같은 모양) ─────
const NODE_SRC = SRC.split('.')[1];   // svi.<node_id>.<local>
const ctx = {
  rsrc: { '1-1': { app: 'svi', id: SRC, node: 'leaf', name: 'src' }, '3-1': { app: 'svi', id: SINK, node: 'leaf', name: 'sink' } },
  nodes: { '0-0': { name: 'peer' } }, self: null, map: 'leaf', treeId: 'live-md32',
  nodeIdOf: (n) => ({ leaf: NODE_SRC, peer: PEER }[n] || null)
};
const L = (id, from, to) => ({ id, from, to, start: from, path: [], road: 'stone' });
const opts = { userId: principal };   // 화면은 whoami principal 을 그대로 넘긴다 — 정규화는 applyLink · grantSelf 가 한다

// ───── 1) 바인딩 — 소스 bytes ↔ 싱크 mouse: 계열이 달라 Master 가 거절해야 한다 ─────
// 소스 자원은 엔드포인트가 둘(output · text)이라 사람이 고른다 — 고르지 않으면 invalid(endpoint_not_chosen)
const bind0 = L('md32-bind', '1-1', '3-1');
let bindIO = buildIO(bind0, [bind0], ctx, null);   // 화면이 연결을 그릴 때 만드는 io
bindIO = setEndpointChoice(bindIO, 'source', SRC, 'output');
bindIO = setEndpointChoice(bindIO, 'target', SINK, 'input');
const bind = Object.assign({}, bind0, { io: bindIO });
const r1 = await applyLink({ client }, bind, [bind], ctx, opts);
check('바인딩 적용 — 어긋난 쌍은 만들어지지 않는다', r1.applied === 0 && !r1.io.pairs.some((p) => p.binding_id), 'phase ' + r1.io.phase + ' · ' + one(r1.notes.join(' / ')));
const pair = r1.io.pairs[0] || {};
check('거절 이유를 말한다(미리 검사 또는 Master)', !!(pair.reason || r1.io.reason || r1.notes.length), one(pair.reason || r1.io.reason || r1.notes[0] || ''));

// ───── 2) 내 허가 — 2b 위임 입구(user 주체 · 기한 있음 · 90일 이하) ─────
const lacks = [{ resource_id: SRC, endpoint_id: 'output', operation: 'bind.source' }, { resource_id: SINK, endpoint_id: 'input', operation: 'bind.target' }];
check('허가 기본 기한은 90일 이하', GRANT_SELF_TTL_DEFAULT <= 90 * 86400, GRANT_SELF_TTL_DEFAULT / 86400 + '일');
const g = await grantSelf(client, lacks, principal);
check('grantSelf — 본인에게 허가 만들기(2b)', g && !(g.failed && g.failed.length), one(JSON.stringify(g)));
const mine = await client.invoke(OPS.grantsGet, { resource_id: SRC, subject_type: 'user', subject_id: userId, limit: 50 });
const mineItems = mine.kind === 'ok' ? (mine.data.items || mine.data.grants || []) : [];
check('허가 목록에 보인다 — 기한이 있다', mineItems.some((x) => x.operations && x.operations.includes('bind.source') && x.expires_at), one(JSON.stringify(mineItems.map((x) => ({ ops: x.operations, exp: x.expires_at })))));

// 90일 넘는 기한은 위임 입구가 거절한다(ADR-GW-004 §3)
const over = await client.invoke(OPS.grantsPost, { subject_type: 'user', subject_id: userId, resource_id: SRC, operations: ['read'], ttl_seconds: 91 * 86400 });
check('91일 기한은 거절(403)', over.kind !== 'ok' && over.kind !== 'accepted', over.kind + ' ' + (over.status || '') + ' ' + one(over.reason || ''));
const noTtl = await client.invoke(OPS.grantsPost, { subject_type: 'user', subject_id: userId, resource_id: SRC, operations: ['read'] });
check('기한 없는 허가는 거절', noTtl.kind !== 'ok' && noTtl.kind !== 'accepted', noTtl.kind + ' ' + (noTtl.status || ''));
const toOther = await client.invoke(OPS.grantsPost, { subject_type: 'user', subject_id: 'user_someone_else', resource_id: SRC, operations: ['read'], ttl_seconds: 3600 });
check('남에게 주는 허가는 거절', toOther.kind !== 'ok' && toOther.kind !== 'accepted', toOther.kind + ' ' + (toOther.status || ''));

// 허가가 있는 지금, 같은 연결을 다시 적용 — 이번에는 허가 부족이 아니라 호환성 때문에 거절돼야 한다
const r2 = await applyLink({ client }, bind, [bind], ctx, opts);
check('허가 뒤 다시 적용 — 여전히 바인딩 없음 · 이유는 허가가 아니다', r2.applied === 0 && !r2.io.pairs.some((p) => p.binding_id) && lacksOf(r2.io.pairs[0] || {}).length === 0, 'phase ' + r2.io.phase + ' · ' + one((r2.io.pairs[0] || {}).reason || r2.notes.join(' / ')));
const direct = await client.invoke(OPS.bindPost, { source_resource_id: SRC, source_endpoint_id: 'output', target_resource_id: SINK, target_endpoint_id: 'input', idempotency_key: 'live-md32-direct' });
check('bindings.post — Master 가 호환 안 되는 쌍을 거절', direct.kind !== 'ok' && direct.kind !== 'accepted', direct.kind + ' ' + (direct.status || '') + ' ' + one(direct.reason || JSON.stringify(direct.data || '')));

// ───── 3) 공유 — 자원 → 같은 클러스터의 다른 노드(노드 주체 허가) ─────
const share = L('md32-share', '1-1', '0-0');
const s1 = await applyLink({ client }, share, [share], ctx, opts);
const gid = s1.io.pairs[0] && s1.io.pairs[0].grant_id;
check('공유 적용 — 노드 주체 허가가 만들어진다', s1.io.phase === 'shared' && !!gid, 'phase ' + s1.io.phase + ' · grant ' + gid + ' · ' + one(s1.notes.join(' / ')));
const s2 = await applyLink({ client }, share, [share], ctx, opts);
check('공유 다시 적용 — 있는 허가를 쓴다(새로 만들지 않는다)', s2.io.pairs[0] && s2.io.pairs[0].grant_id === gid && s2.applied === 0, 'applied ' + s2.applied);
const sy = await syncLinks(client, [Object.assign({}, share, { io: s1.io })]);
check('상태 맞추기 — 공유 허가가 보인다', sy.links && sy.links[0] && sy.links[0].io.phase === 'shared', sy.links && one(sy.links[0].io.phase + ' ' + (sy.unavailable || '')));
const nodeGrants = await client.invoke(OPS.grantsGet, { resource_id: SRC, subject_type: 'node', limit: 50 });
const ng = nodeGrants.kind === 'ok' ? (nodeGrants.data.items || nodeGrants.data.grants || []) : [];
const mineNode = ng.find((x) => x.grant_id === gid);
check('Master 기록 — 노드 허가 · 기한 ' + SHARE_TTL_DEFAULT / 86400 + '일 안', mineNode && mineNode.subject && mineNode.subject.id === PEER && Date.parse(mineNode.expires_at) - Date.now() <= 90 * 86400000, one(JSON.stringify(mineNode && { subject: mineNode.subject, ops: mineNode.operations, exp: mineNode.expires_at })));
// 공유 철회 — 위임 입구의 grants.delete(받는 이 가드 없음)
const rev = await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: gid });
check('허가 철회(2b delete)', rev.kind === 'ok' || rev.kind === 'accepted', rev.kind + ' ' + (rev.status || ''));
const sy2 = await syncLinks(client, [Object.assign({}, share, { io: s1.io })]);
check('철회 뒤 상태 맞추기 — 더는 shared 가 아니다', sy2.links && sy2.links[0].io.phase !== 'shared', sy2.links && sy2.links[0].io.phase);

// 남은 내 허가 정리(스택을 깨끗이)
const mineSink = await client.invoke(OPS.grantsGet, { resource_id: SINK, subject_type: 'user', subject_id: userId, limit: 50 });
const sinkItems = mineSink.kind === 'ok' ? (mineSink.data.items || mineSink.data.grants || []) : [];
for (const x of mineItems.concat(sinkItems)) if (x.grant_id) await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: x.grant_id });
const cl = await closeBindings(client, ['svib_does_not_exist']);
check('없는 바인딩 닫기 — 이미 없는 것으로 친다', cl.closed.length === 1 && cl.failed.length === 0, JSON.stringify(cl));

const bad = results.filter((r) => !r[0]);
console.log('\n' + (results.length - bad.length) + '/' + results.length + ' 통과');
process.exit(bad.length ? 1 : 0);
