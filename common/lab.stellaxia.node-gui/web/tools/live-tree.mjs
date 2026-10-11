// MD-13 · tree 게이트웨이에서 Master 쪽 추가 · 수정 · 삭제 E2E — 모듈 코드(TerraClient · applyLink · grantSelf · syncLinks · closeBindings)를 그대로,
// 이 앱의 토큰(tsa_)으로 **tree 게이트웨이**(Master 계약이 카탈로그가 되고, 앱 토큰은 세션 id 위임 입구로 Master 에 간다 — Terra ADR-GW-003 · 004)에 붙인다.
// leaf 용 live-linkio.mjs · live-linkbind.mjs 는 /api/upstream 경로로 같은 길을 보지만, 여기서는 **operation id 로 부르는 tree 쪽**이 처음 실제로 불린다.
//
//   tools/live-tree-up.sh <Terra 체크아웃> <작업 폴더>   # 스택을 세우고 env.sh 를 만든다
//   . <작업 폴더>/env.sh && node tools/live-tree.mjs
//
// 쓰는 환경변수(env.sh 가 채운다): TERRA_GW · TERRA_APP_TOKEN_FILE · TERRA_NODE_1 · TERRA_NODE_2 · TERRA_SRC_RES(NODE_1 의 test.stream)
// 끝에 "경로별 결과" 표를 찍는다 — 동작 / 거절(이유) / 닿지 않음(빠진 op · 경로). 하나라도 기대와 다르면 종료 코드 1.
// 스택 만드는 법과 결과: docs/api/real-data-layer.md §5.11
import { readFileSync, statSync, existsSync } from 'node:fs';
const W = new URL('../src/', import.meta.url).href;
const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win; globalThis.window = win;
const { TerraClient } = await import(W + 'api/client.js');
const { applyLink, grantSelf, lacksOf, userIdOf, OPS } = await import(W + 'api/link-apply.js');
const { syncLinks, closeBindings } = await import(W + 'api/link-sync.js');
const { setEndpointChoice, buildIO } = await import(W + 'model/link-io.js');

const E = process.env;
const GW = E.TERRA_GW || 'http://127.0.0.1:38787';
const app = readFileSync(E.TERRA_APP_TOKEN_FILE || 'app.tok', 'utf8').trim();
const SRC = E.TERRA_SRC_RES, N1 = E.TERRA_NODE_1, N2 = E.TERRA_NODE_2;
if (!SRC || !N1 || !N2) { console.error('env.sh 를 먼저 읽는다(tools/live-tree-up.sh)'); process.exit(2); }
const authFetch = (url, init = {}) => fetch(url, Object.assign({}, init, { headers: Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + app }) }));
const client = new TerraClient(GW, { fetch: authFetch, delegated: true });
await client.refreshCatalog();

const results = [], rows = [];
const check = (name, ok, info) => { results.push([ok, name]); console.log((ok ? '✓ ' : '✗ ') + name + (info ? ' — ' + info : '')); };
const one = (s) => String(s).replace(/\n/g, ' ⏎ ').slice(0, 240);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizeOf = (p) => (existsSync(p) ? statSync(p).size : 0);
const ok = (r) => r.kind === 'ok' || r.kind === 'accepted';
const items = (r) => (r.kind === 'ok' ? (r.data.items || r.data.grants || r.data.bindings || []) : []);
const code = (r) => (r.data && r.data.error && r.data.error.code) || r.reason || '';
const msg = (r) => (r.data && r.data.error && r.data.error.message) || '';
/** 결과 표에 한 줄 — outcome: 동작 · 거절 · 닿지 않음 */
const row = (path, outcome, detail) => { rows.push([path, outcome, detail]); };

// ───── 0) tree 게이트웨이 · 신원 ─────
const cat = client.catalog;
check('tree 카탈로그 — terra.master.* 가 카탈로그에 있다(leaf 와 다르다: 경로가 아니라 operation id 로 부른다)', [...cat.keys()].filter((k) => k.startsWith('terra.master.')).length > 100 && cat.has('terra.master.svi.grants.post'),
  'catalog ' + cat.size + ' · master ' + [...cat.keys()].filter((k) => k.startsWith('terra.master.')).length + ' · daemon ' + [...cat.keys()].filter((k) => k.startsWith('terra.daemon.')).length);
check('viaUpstream 은 꺼져 있다 — 카탈로그에 있는 Master op 는 /api/upstream 으로 가지 않는다', client.viaUpstream('terra.master.svi.grants.post') === false);
const who = await client.get('/api/v1/agent/whoami');
const principal = who.kind === 'ok' && who.data ? who.data.principal : '';
const userId = userIdOf(principal);
check('whoami — 앱 토큰의 사용자', /^user_\S+$/.test(userId) && / via /.test(principal), principal);
const nodes = await client.invoke('terra.master.nodes.get', {});
const nodeIds = nodes.kind === 'ok' ? (nodes.data.nodes || nodes.data.items || []).map((n) => n.node_id) : [];
check('Master 노드 목록(읽기, 위임 입구) — 두 노드가 보인다', nodeIds.includes(N1) && nodeIds.includes(N2), nodeIds.length + '개');

// 시작 전 정리 — 지난 실행이 남긴 내 허가
const grantsOn = async (res, q = {}) => items(await client.invoke(OPS.grantsGet, Object.assign({ resource_id: res, limit: 200 }, q)));
const sweep = async (...res) => { for (const r of res) for (const g of await grantsOn(r)) if (g.grant_id) await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: g.grant_id }); };
await sweep(SRC);

// ───── 1) 다른 노드(N2)에 싱크 선언 — 노드 주소 호출(중계) 쓰기 ─────
// tree 에는 Local API 가 없다. 모듈은 Master 중계(/api/v1/nodes/{id}/operations/{op}/invoke)로 그 노드의 Daemon op 를 부른다.
const dir = E.TERRA_FILES_DIR;
const sinkPath = dir + '/tree-inbox.log';
let decl;   // 스택을 막 세웠으면 Daemon 의 중계 연결이 아직 안 섰을 수 있다(409 NODE_OFFLINE) — 서면 다시
for (let i = 0; i < 40; i++) { decl = await client.invoke('terra.daemon.svi.declarations.post', { family: 'file', name: 'tree-inbox', direction: 'sink', path: sinkPath }, { node: N2 }); if (code(decl) !== 'NODE_OFFLINE') break; await sleep(1000); }
let SINK = decl.kind === 'ok' && decl.data ? decl.data.resource_id : '';
const declOk = ok(decl) && !!SINK;
// 이 앱이 node.config 를 매니페스트에 선언하지 않으면(지금의 module.json) 노드 카탈로그가 allowed:false 로 막는다 → remote-denied. 그때는 싱크를 Daemon Local API 로 세워 바인딩 시험은 잇는다.
check('선언 쓰기(다른 노드 · 중계) — 열리거나, node.config 가 없어 remote-denied 로 막힌다', declOk || (decl.kind === 'forbidden' && decl.reason === 'remote-denied'),
  declOk ? SINK : decl.kind + ' ' + (decl.status || '') + ' ' + (decl.reason || code(decl)) + ' ' + one(msg(decl)));
row('선언 추가 — terra.daemon.svi.declarations.post (노드 중계)', declOk ? '동작' : decl.reason === 'remote-denied' ? '거절' : '거절', declOk ? SINK : (decl.reason || code(decl)) + (decl.reason === 'remote-denied' ? ' — 노드 카탈로그 allowed:false · 필요한 권한 node.config(앱 매니페스트에 없다)' : ''));
let viaLocal = false;
if (!declOk && E.TERRA_D2_LOCAL && E.TERRA_D2_LOCAL_TOKEN_FILE) {
  const tok = readFileSync(E.TERRA_D2_LOCAL_TOKEN_FILE, 'utf8').trim();
  const d = await fetch(E.TERRA_D2_LOCAL + '/svi/declarations', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ family: 'file', name: 'tree-inbox', direction: 'sink', path: sinkPath }) }).then((r) => r.json());
  SINK = d.data && d.data.resource_id; viaLocal = true;
  console.log('! 싱크를 Daemon Local API 로 세웠다(중계 선언이 막혀서) — ' + SINK);
}
check('바인딩 시험용 싱크가 있다', !!SINK, SINK);
const declLocal = await client.invoke('terra.daemon.svi.declarations.get', {});
check('같은 op 를 노드 지정 없이 — 이 게이트웨이(Master 쪽)에는 Daemon op 가 없다', declLocal.kind === 'unavailable' && declLocal.reason === 'not-in-catalog', declLocal.kind + ' ' + declLocal.reason);
row('Daemon op 를 노드 지정 없이 (예: svi.declarations.get)', '닿지 않음', 'not-in-catalog — tree 카탈로그에 terra.daemon.* 가 없다. {node} 를 붙여야 한다');
for (let i = 0; i < 30 && SINK; i++) { const r = await client.invoke(OPS.endpoints, { resource_id: SINK }); if (r.kind === 'ok') break; await sleep(500); }
await sweep(SINK);

// ───── 2) 허가 — 만들기 · 고치기 · 지우기 ─────
const T3600 = 3600;
const g1 = await client.invoke(OPS.grantsPost, { subject_type: 'user', subject_id: userId, resource_id: SRC, operations: ['read', 'subscribe'], ttl_seconds: T3600 });
const gid1 = g1.data && (g1.data.grant_id || (g1.data.grant && g1.data.grant.grant_id));
check('grants.post — 본인에게 허가 만들기(2b)', ok(g1) && !!gid1, g1.kind + ' ' + (g1.status || '') + ' ' + (gid1 || code(g1)));
row('허가 만들기 (본인) — svi.grants.post', ok(g1) && gid1 ? '동작' : '거절', gid1 || code(g1));
const listed = (await grantsOn(SRC, { subject_type: 'user', subject_id: userId })).find((x) => x.grant_id === gid1);
check('grants.get — 만든 허가가 보인다 · 기한이 있다', !!listed && !!listed.expires_at && listed.operations.length === 2, one(JSON.stringify(listed && { ops: listed.operations, exp: listed.expires_at })));
const p1 = await client.invoke('terra.master.svi.grants.by-grant-id.patch', { grant_id: gid1, operations: ['read'] });
check('grants.patch — 줄이기(operations 를 read 하나로)', ok(p1), p1.kind + ' ' + (p1.status || '') + ' ' + one(code(p1) + ' ' + msg(p1)));
row('허가 고치기 (줄이기) — svi.grants.by-grant-id.patch', ok(p1) ? '동작' : '거절', ok(p1) ? 'operations 줄임' : code(p1) + ' ' + msg(p1));
const after1 = (await grantsOn(SRC, { subject_type: 'user', subject_id: userId })).find((x) => x.grant_id === gid1);
check('patch 뒤 목록 — operations 가 read 하나', !!after1 && after1.operations.length === 1 && after1.operations[0] === 'read', one(JSON.stringify(after1 && after1.operations)));
const p2 = await client.invoke('terra.master.svi.grants.by-grant-id.patch', { grant_id: gid1, operations: ['read', 'bind.source'] });
check('grants.patch — 넓히기는 가드를 다시 통과해야 한다(본인에게 bind.source 는 허용)', ok(p2) || p2.kind === 'forbidden', p2.kind + ' ' + (p2.status || '') + ' ' + one(code(p2) + ' ' + msg(p2)));
row('허가 고치기 (넓히기: +bind.source, 본인) — svi.grants.by-grant-id.patch', ok(p2) ? '동작' : '거절', ok(p2) ? '가드 통과(본인에게 bind.source 는 허용 집합)' : code(p2) + ' ' + msg(p2));
const p3 = await client.invoke('terra.master.svi.grants.by-grant-id.patch', { grant_id: gid1, operations: ['read', 'write'] });
check('grants.patch — write 로 넓히기는 거절(D-4)', !ok(p3), p3.kind + ' ' + (p3.status || '') + ' ' + one(code(p3) + ' ' + msg(p3)));
row('허가 고치기 (넓히기: +write) — svi.grants.by-grant-id.patch', ok(p3) ? '동작(!)' : '거절', code(p3) + ' ' + one(msg(p3)));
const p4 = await client.invoke('terra.master.svi.grants.by-grant-id.patch', { grant_id: gid1, ttl_seconds: 120 });
check('grants.patch — 기한 줄이기(ttl_seconds)', ok(p4), p4.kind + ' ' + (p4.status || '') + ' ' + one(code(p4) + ' ' + msg(p4)));
row('허가 고치기 (기한 줄이기) — svi.grants.by-grant-id.patch {ttl_seconds}', ok(p4) ? '동작' : '거절', ok(p4) ? 'ttl 120초' : code(p4) + ' ' + msg(p4));
// 노드 주체 허가(공유) — 같은 클러스터의 다른 노드
const gn = await client.invoke(OPS.grantsPost, { subject_type: 'node', subject_id: N2, resource_id: SRC, operations: ['read', 'subscribe'], ttl_seconds: T3600 });
const gidn = gn.data && (gn.data.grant_id || (gn.data.grant && gn.data.grant.grant_id));
check('grants.post — 같은 클러스터의 노드에게(공유)', ok(gn) && !!gidn, gn.kind + ' ' + (gn.status || '') + ' ' + (gidn || code(gn)));
row('허가 만들기 (같은 클러스터 노드) — svi.grants.post', ok(gn) && gidn ? '동작' : '거절', gidn || code(gn));
const del1 = await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: gid1 });
const deln = await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: gidn });
check('grants.delete — 본인 허가 · 노드 허가 철회', ok(del1) && ok(deln), del1.kind + '/' + deln.kind);
row('허가 지우기 — svi.grants.by-grant-id.delete', ok(del1) && ok(deln) ? '동작' : '거절', del1.kind + '/' + deln.kind);
check('지운 뒤 목록 — 둘 다 없다', !(await grantsOn(SRC)).some((x) => x.grant_id === gid1 || x.grant_id === gidn));
// 가드(ADR-GW-004 D-3 · D-4 · Q14) — 모듈이 보내는 모양 그대로 거절을 읽는지
const bad = async (name, input, why) => {
  const r = await client.invoke(OPS.grantsPost, Object.assign({ resource_id: SRC }, input));
  check('가드 — ' + name + ' 거절', !ok(r), r.kind + ' ' + (r.status || '') + ' ' + code(r));
  row('허가 만들기 가드 — ' + name, ok(r) ? '동작(!)' : '거절', (r.status || '') + ' ' + code(r) + (why ? ' · ' + why : ''));
};
await bad('91일 기한', { subject_type: 'user', subject_id: userId, operations: ['read'], ttl_seconds: 91 * 86400 }, 'Q14 최대 90일');
await bad('기한 없음', { subject_type: 'user', subject_id: userId, operations: ['read'] }, 'ttl_seconds 필수');
await bad('남에게(다른 사용자)', { subject_type: 'user', subject_id: 'user_someone_else', operations: ['read'], ttl_seconds: 3600 }, 'D-3 본인 또는 같은 클러스터 노드만');
await bad('write 권한', { subject_type: 'user', subject_id: userId, operations: ['write'], ttl_seconds: 3600 }, 'D-4 write · invoke 금지');
await bad('다른 클러스터 · 없는 노드', { subject_type: 'node', subject_id: 'node_does_not_exist', operations: ['read'], ttl_seconds: 3600 }, 'NODE_NOT_FOUND');
await bad('다른 주체 유형(group)', { subject_type: 'group', subject_id: 'g', operations: ['read'], ttl_seconds: 3600 }, 'D-3');

// ───── 3) 바인딩 — 허가 없음 → 허가 → 만들기 → active → 데이터 → 닫기 → closed ─────
const NODE_SRC = SRC.split('.')[1], NODE_SINK = SINK.split('.')[1];
const ctx = {
  rsrc: { '1-1': { app: 'svi', id: SRC, node: 'a', name: 'src' }, '3-1': { app: 'svi', id: SINK, node: 'b', name: 'sink' } },
  nodes: {}, self: null, map: 'a', treeId: 'live-tree-' + Date.now().toString(36),
  nodeIdOf: (n) => ({ a: NODE_SRC, b: NODE_SINK }[n] || null)
};
const l0 = { id: 'tree-good', from: '1-1', to: '3-1', start: '1-1', path: [], road: 'stone' };
let io = buildIO(l0, [l0], ctx, null);
io = setEndpointChoice(io, 'source', SRC, 'output'); io = setEndpointChoice(io, 'target', SINK, 'append');
let link = Object.assign({}, l0, { io });
const opts = { userId: principal };
const a0 = await applyLink({ client }, link, [link], ctx, opts);
const lacks = a0.io.pairs[0] ? lacksOf(a0.io.pairs[0]) : [];
check('허가 없이 적용 — needs-grant · 부족한 허가 둘 · Master 의 bindings.post 는 부르지 않는다', a0.io.phase === 'needs-grant' && lacks.length === 2 && !a0.io.pairs.some((p) => p.binding_id), 'phase ' + a0.io.phase);
const gs = await grantSelf(client, lacks, principal);
check('grantSelf — 부족한 허가를 본인에게 만든다', gs.ok && gs.made.length === 2, one(JSON.stringify(gs)));
const before = sizeOf(sinkPath);
const a1 = await applyLink({ client }, link, [link], ctx, opts);
const bid = a1.io.pairs[0] && a1.io.pairs[0].binding_id;
check('허가 뒤 적용 — svi.bindings.post 가 받는다(2a)', !!bid && a1.applied === 1, 'phase ' + a1.io.phase + ' · ' + bid + ' · ' + one(a1.notes.join(' / ')));
row('바인딩 만들기 — svi.bindings.post', bid ? '동작' : '거절', bid || one(a1.notes.join(' / ')));
link = Object.assign({}, link, { io: a1.io });
let phase = link.io.phase;
const phases = [phase];
for (let i = 0; i < 40 && phase !== 'active'; i++) { await sleep(500); const s = await syncLinks(client, [link]); if (s.links && s.links[0]) { link = s.links[0]; phase = link.io.phase; if (phases[phases.length - 1] !== phase) phases.push(phase); } }
check('상태 맞추기 — active', phase === 'active', phases.join(' → '));
for (let i = 0; i < 30 && sizeOf(sinkPath) - before <= 0; i++) await sleep(500);
check('데이터가 흐른다 — 싱크 파일이 자란다', sizeOf(sinkPath) - before > 0, (sizeOf(sinkPath) - before) + ' 바이트');
const cl = await closeBindings(client, [bid]);
check('closeBindings — svi.bindings.by-binding-id.delete 가 받는다(2a)', cl.closed.includes(bid) && cl.failed.length === 0, JSON.stringify(cl));
row('바인딩 닫기 — svi.bindings.by-binding-id.delete', cl.closed.includes(bid) ? '동작' : '거절', JSON.stringify(cl));
let ph2 = '';
for (let i = 0; i < 40 && ph2 !== 'closed'; i++) { await sleep(500); const s = await syncLinks(client, [link]); if (s.links && s.links[0]) { link = s.links[0]; ph2 = link.io.phase; } }
check('닫은 뒤 상태 맞추기 — closed', ph2 === 'closed', 'phase ' + ph2);
const again = await closeBindings(client, [bid, 'svib_does_not_exist']);
check('이미 닫힌 · 없는 바인딩 닫기 — 오류로 치지 않는다', again.failed.length === 0, JSON.stringify(again));
await sweep(SRC, SINK);

// ───── 4) 그 밖의 쓰기 — 모듈이 이미 짜 둔 길이 tree 에서 닿는지 ─────
// 입력은 모듈이 보내는 모양대로 아무것이나(막히면 어차피 게이트웨이에서 막힌다). 위험한 것은 일부러 존재하지 않는 id 를 쓴다.
const probe = async (label, op, input, opt) => {
  const r = await client.invoke(op, input || {}, opt);
  const closed = r.reason === 'DELEGATION_NOT_OPEN' || code(r) === 'DELEGATION_NOT_OPEN';
  row(label, ok(r) ? '동작' : closed ? '닿지 않음' : '거절', closed ? 'DELEGATION_NOT_OPEN (' + r.status + ') — 위임 입구가 연 쓰기는 svi.bindings.post|delete · svi.grants.post|patch|delete 뿐' : (r.status || '') + ' ' + (code(r) || r.kind) + ' ' + one(msg(r)));
  return r;
};
const tun = await probe('터널 선언 추가 — terra.master.service-tunnels.declarations.post', 'terra.master.service-tunnels.declarations.post', { service_id: 'svc.live-tree', target_node_id: N2, target_port: 9, local_port: 0 });
check('터널 선언 추가 — 위임 입구가 닫혀 있다(DELEGATION_NOT_OPEN)', tun.reason === 'DELEGATION_NOT_OPEN', tun.kind + ' ' + tun.status + ' ' + tun.reason);
const tunOpen = await probe('터널 즉석 열기 — terra.master.service-tunnels.open.post', 'terra.master.service-tunnels.open.post', { source_node_id: N1, target_node_id: N2, service: 'live-tree', target_port: 9 });
check('터널 열기 — 위임 입구가 닫혀 있다', tunOpen.reason === 'DELEGATION_NOT_OPEN', tunOpen.kind + ' ' + tunOpen.status);
await probe('터널 경로 계획 — terra.master.service-tunnels.plan.post', 'terra.master.service-tunnels.plan.post', { source_node_id: N1, target_node_id: N2 });
await probe('터널 선언 지우기 — terra.master.service-tunnels.declarations.by-declaration-id.delete', 'terra.master.service-tunnels.declarations.by-declaration-id.delete', { declaration_id: 'none' });
const rev = await probe('peer 철회 — terra.master.network.mesh.wireguard.peers.revoke.post', 'terra.master.network.mesh.wireguard.peers.revoke.post', { source_node_id: 'none', target_node_id: 'none', bidirectional: true });
check('카탈로그만 보는 잠금은 닫힌 op 를 못 거른다 — tree 에서는 reaches(peers.revoke)가 참인데 부르면 DELEGATION_NOT_OPEN', client.reaches('terra.master.network.mesh.wireguard.peers.revoke.post') === true && rev.reason === 'DELEGATION_NOT_OPEN', 'reaches ' + client.reaches('terra.master.network.mesh.wireguard.peers.revoke.post') + ' · ' + rev.reason);
check('peer 철회 — 위임 입구가 닫혀 있다', rev.reason === 'DELEGATION_NOT_OPEN', rev.kind + ' ' + rev.status);
await probe('mesh 자동 조정 — terra.master.network.mesh.wireguard.reconcile.post', 'terra.master.network.mesh.wireguard.reconcile.post', {});
await probe('mesh 수동 계획 — terra.master.network.mesh.wireguard.plan.post', 'terra.master.network.mesh.wireguard.plan.post', {});
await probe('라우트 세션 닫기 — terra.master.route.sessions.by-session-id.close.post', 'terra.master.route.sessions.by-session-id.close.post', { session_id: 'none' });
await probe('연결 그룹 닫기 — terra.master.connection-groups.by-group-id.close.post', 'terra.master.connection-groups.by-group-id.close.post', { group_id: 'none' });
const cmd = await probe('다른 노드 작업 — terra.master.commands.post (Master jobs)', 'terra.master.commands.post', { node_id: N2, command: 'echo live-tree' });
check('다른 노드 작업(Master commands) — 위임 입구가 닫혀 있다', cmd.reason === 'DELEGATION_NOT_OPEN', cmd.kind + ' ' + cmd.status);
await probe('작업 취소 — terra.master.jobs.by-job-id.cancel.post', 'terra.master.jobs.by-job-id.cancel.post', { job_id: 'none' });
await probe('노드 중계(세션 id 길) — terra.master.nodes.by-node-id.operations.invoke.post', 'terra.master.nodes.by-node-id.operations.invoke.post', { node_id: N2, operation_id: 'terra.daemon.health.get' });
await probe('노드 이름 바꾸기 — terra.master.nodes.by-node-id.patch', 'terra.master.nodes.by-node-id.patch', { node_id: N2, device_name: 'x' });
await probe('모듈 할당 — terra.master.nodes.by-node-id.modules.assignments.post', 'terra.master.nodes.by-node-id.modules.assignments.post', { node_id: N2, module_id: 'none' });
await probe('SVI 핸들 열기 — terra.master.svi.handles.post', 'terra.master.svi.handles.post', {});

// 노드 주소 호출(중계)로 다른 노드의 쓰기 — 이 길은 위임 표와 따로다. 모듈은 Daemon op 를 이 길로 부른다
const rl = await client.invoke('terra.daemon.commands.execute.post', { command: 'echo live-tree-relay' }, { node: N2 });
row('다른 노드 작업 — terra.daemon.commands.execute.post (노드 중계)', ok(rl) ? '동작' : rl.kind === 'unavailable' ? '닿지 않음' : '거절', ok(rl) ? 'task ' + ((rl.data && (rl.data.task_id || (rl.data.task && rl.data.task.task_id))) || '') : (rl.status || '') + ' ' + (rl.reason || code(rl)) + ' ' + one(msg(rl)));
check('다른 노드 작업(노드 중계) — 결과를 읽는다(동작이든 이유가 있는 거절이든)', ok(rl) || !!(rl.reason || code(rl)), rl.kind + ' ' + (rl.status || '') + ' ' + (rl.reason || code(rl)));
const cs = await client.invoke('terra.daemon.service-tunnels.get', {}, { node: N2 });
row('다른 노드 터널 목록 — terra.daemon.service-tunnels.get (노드 중계, 읽기)', ok(cs) ? '동작' : '거절', cs.kind + ' ' + (cs.status || '') + ' ' + (cs.reason || code(cs)));
const cc = await client.invoke('terra.daemon.service-tunnels.by-tunnel-id.close.post', { tunnel_id: 'none' }, { node: N2 });
row('다른 노드 터널 닫기 — terra.daemon.service-tunnels.by-tunnel-id.close.post (노드 중계)', ok(cc) ? '동작' : cc.kind === 'unavailable' ? '닿지 않음' : '거절', cc.kind + ' ' + (cc.status || '') + ' ' + (cc.reason || code(cc)) + ' ' + one(msg(cc)));

// 선언 지우기(정리) — 만든 선언을 노드 중계로 철회한다
if (viaLocal) {
  const tok = readFileSync(E.TERRA_D2_LOCAL_TOKEN_FILE, 'utf8').trim();
  const u = await client.invoke('terra.daemon.svi.declarations.by-family.by-name.undeclare.post', { family: 'file', name: 'tree-inbox' }, { node: N2 });
  row('선언 지우기 — svi.declarations.by-family.by-name.undeclare.post (노드 중계)', ok(u) ? '동작' : '거절', u.kind + ' ' + (u.reason || code(u)));
  check('선언 철회(중계)도 같은 이유로 막힌다', ok(u) || u.reason === 'remote-denied', u.kind + ' ' + (u.reason || ''));
  await fetch(E.TERRA_D2_LOCAL + '/svi/declarations/file/tree-inbox/undeclare', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }).catch(() => {});   // 정리(Local API)
} else {
  const un = await client.invoke('terra.daemon.svi.declarations.by-family.by-name.undeclare.post', { family: 'file', name: 'tree-inbox' }, { node: N2 });
  check('선언 철회(다른 노드 · 중계) — undeclare', ok(un), un.kind + ' ' + (un.status || '') + ' ' + (un.reason || code(un)) + ' ' + one(msg(un)));
  row('선언 지우기 — svi.declarations.by-family.by-name.undeclare.post (노드 중계)', ok(un) ? '동작' : '거절', un.kind + ' ' + (un.status || '') + ' ' + (un.reason || code(un)));
}

console.log('\n── 경로별 결과 ──');
for (const r of rows) console.log(r[1].padEnd(6) + ' | ' + r[0] + ' | ' + one(r[2]));
const failed = results.filter((r) => !r[0]);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 통과');
process.exit(failed.length ? 1 : 0);
