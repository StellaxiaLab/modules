// 입출력 연결(MD-32) 진짜 스택 실측 2 — 호환되는 소스 · 싱크 쌍으로 바인딩이 `active` 까지 가고, 끊으면 `closed` 가 되는지.
// 모듈 코드(TerraClient · applyLink · lacksOf · grantSelf · syncLinks · orphanedBindings · closeBindings)를 그대로,
// 이 앱의 토큰(tsa_)으로 진짜 leaf 게이트웨이의 위임 입구(/api/upstream — Terra ADR-GW-003 · 004)에 붙인다. 화면(브라우저)은 거치지 않는다.
//
//   TERRA_GW=http://127.0.0.1:28787 TERRA_APP_TOKEN_FILE=app.tok \
//   TERRA_SRC_RES=svi.<node>.test.stream TERRA_SINK_RES=svi.<node>.fs.<name> TERRA_SINK_FILE=<그 싱크의 파일 경로> \
//   node tools/live-linkbind.mjs
//
// 쌍: Daemon 의 시험 흐름(`test.stream` · output · terra.bytes@1 — feature.enable_svi_test_stream) →
//     다른 Daemon 설정의 파일 싱크(`svi.file_sinks` → `svi.<node>.fs.<name>` · append · terra.bytes@1). 두 노드 · 같은 소유자(PF-19 — 남의 자원과는 못 잇는다).
//     같은 노드 안의 쌍은 Master 가 active 라고 해도 데이터가 흐르지 않는다(Daemon 이 한 바인딩의 두 역할을 binding_id 하나로 들고 있다) — §5.10.
// 스택 만드는 법과 결과: docs/api/real-data-layer.md §5.10. 어긋난 쌍 · 위임 입구의 가드 · 공유는 live-linkio.mjs(§5.9)가 본다.
import { readFileSync, statSync } from 'node:fs';
const W = new URL('../src/', import.meta.url).href;
const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win; globalThis.window = win;
const { TerraClient } = await import(W + 'api/client.js');
const { applyLink, grantSelf, lacksOf, userIdOf, OPS } = await import(W + 'api/link-apply.js');
const { syncLinks, closeBindings, orphanedBindings, SYNC_OPS } = await import(W + 'api/link-sync.js');
const { setEndpointChoice, buildIO } = await import(W + 'model/link-io.js');

const E = process.env;
const GW = E.TERRA_GW || 'http://127.0.0.1:28787';
const app = readFileSync(E.TERRA_APP_TOKEN_FILE || 'app.tok', 'utf8').trim();
const SRC = E.TERRA_SRC_RES, SINK = E.TERRA_SINK_RES, SINK_FILE = E.TERRA_SINK_FILE || '';
if (!SRC || !SINK) { console.error('TERRA_SRC_RES · TERRA_SINK_RES 가 필요하다'); process.exit(2); }
const authFetch = (url, init = {}) => fetch(url, Object.assign({}, init, { headers: Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + app }) }));
const client = new TerraClient(GW, { fetch: authFetch, delegated: true });
await client.refreshCatalog();

const results = [];
const check = (name, ok, info) => { results.push([ok, name]); console.log((ok ? '✓ ' : '✗ ') + name + (info ? ' — ' + info : '')); };
const one = (s) => String(s).replace(/\n/g, ' ⏎ ').slice(0, 260);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const items = (r) => (r.kind === 'ok' ? (r.data.items || r.data.grants || r.data.bindings || []) : []);
const size = () => { try { return statSync(SINK_FILE).size; } catch { return 0; } };

// ───── 0) 신원 · 두 끝의 엔드포인트 ─────
const who = await client.get('/api/v1/agent/whoami');
const principal = who.kind === 'ok' && who.data ? who.data.principal : '';
const userId = userIdOf(principal);
check('whoami — 앱 토큰의 사용자', /^user_\S+$/.test(userId), principal);
const epOf = async (res) => { const r = await client.invoke(OPS.endpoints, { resource_id: res }); return r.kind === 'ok' ? (r.data.items || r.data.endpoints || []) : []; };
const srcEps = await epOf(SRC), sinkEps = await epOf(SINK);
const out = srcEps.find((e) => e.endpoint_id === 'output'), app_ = sinkEps.find((e) => e.endpoint_id === 'append');
if (SRC.split('.')[1] === SINK.split('.')[1]) console.log('! 소스 · 싱크가 같은 노드다 — active 가 돼도 데이터는 흐르지 않을 수 있다(real-data-layer §5.10)');
check('호환되는 쌍 — 소스 output 과 싱크 append 가 같은 형식', !!out && !!app_ && out.output_schema === app_.input_schema,
  (out && out.output_schema) + ' → ' + (app_ && app_.input_schema));

// 시작 전 정리 — 지난 실행이 남긴 내 허가(이 두 자원)를 지운다. 그래야 "허가가 없어 막힘 → 허가 → 적용" 을 처음부터 본다
const myGrants = async (res) => items(await client.invoke(OPS.grantsGet, { resource_id: res, subject_type: 'user', subject_id: userId, limit: 200 }));
for (const g of (await myGrants(SRC)).concat(await myGrants(SINK))) if (g.grant_id) await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: g.grant_id });

// ───── 맵 · 연결 (화면이 만드는 것과 같은 모양) ─────
const NODE = SRC.split('.')[1];
const ctx = {
  rsrc: { '1-1': { app: 'svi', id: SRC, node: 'leaf', name: 'test.stream' }, '3-1': { app: 'svi', id: SINK, node: 'leaf', name: 'file sink' } },
  nodes: {}, self: null, map: 'leaf', treeId: 'live-md32-active-' + Date.now().toString(36),
  nodeIdOf: (n) => (n === 'leaf' ? NODE : null)
};
const link0 = { id: 'md32-active', from: '1-1', to: '3-1', start: '1-1', path: [], road: 'stone' };
let io = buildIO(link0, [link0], ctx, null);
io = setEndpointChoice(io, 'source', SRC, 'output');   // 소스는 엔드포인트가 둘(output · text) — 사람이 고른다
let link = Object.assign({}, link0, { io });
const opts = { userId: principal };

// ───── 1) 허가 없이 적용 → needs-grant(Master 는 부르지 않는다) ─────
const r1 = await applyLink({ client }, link, [link], ctx, opts);
const p1 = r1.io.pairs[0] || {};
const lacks = lacksOf(p1);
check('허가 없이 적용 — needs-grant · 부족한 허가 둘(bind.source · bind.target)', r1.applied === 0 && r1.io.phase === 'needs-grant' && lacks.length === 2,
  'phase ' + r1.io.phase + ' · ' + one(p1.reason || ''));
link = Object.assign({}, link, { io: r1.io });

// ───── 2) [나에게 허가 주기] — 막힌 쌍의 이유에서 꺼낸 그대로 ─────
const g = await grantSelf(client, lacks, principal);
check('grantSelf — 부족한 허가를 내게 만든다(2b · 30일)', g.ok && g.made.length === 2, one(JSON.stringify(g)));

// ───── 3) 다시 적용 → bindings.post → binding_id ─────
const r2 = await applyLink({ client }, link, [link], ctx, opts);
const p2 = r2.io.pairs[0] || {};
const bid = p2.binding_id;
check('허가 뒤 적용 — bindings.post 가 받는다(phase binding · binding_id)', r2.applied === 1 && !!bid && (r2.io.phase === 'binding' || r2.io.phase === 'active'),
  'phase ' + r2.io.phase + ' · ' + bid + ' · ' + one(r2.notes.join(' / ')));
link = Object.assign({}, link, { io: r2.io });

// ───── 4) 상태 맞추기 — active 가 될 때까지(syncLinks 가 Master 의 observed_state 를 읽는다) ─────
const t0 = Date.now();
let phases = [link.io.phase];
for (let i = 0; i < 40 && link.io.phase !== 'active'; i++) {
  await sleep(500);
  const s = await syncLinks(client, [link]);
  if (s.unavailable) { phases.push('unavailable:' + s.unavailable); break; }
  link = s.links[0];
  if (phases[phases.length - 1] !== link.io.phase) phases.push(link.io.phase);
  if (/^(failed|denied|lost|closed)$/.test(link.io.phase)) break;
}
check('상태 맞추기 — active', link.io.phase === 'active', phases.join(' → ') + ' · ' + (Date.now() - t0) + ' ms · schema ' + (link.io.schema_ref || '-') + (link.io.reason ? ' · ' + link.io.reason : ''));
const rec = await client.invoke(SYNC_OPS.bindingGet, { binding_id: bid });
const b = rec.kind === 'ok' ? (rec.data.binding || rec.data) : {};
check('Master 기록 — desired active · observed active', b.desired_state === 'active' && b.observed_state === 'active',
  one(JSON.stringify({ desired: b.desired_state, observed: b.observed_state, qos: b.qos_profile, schema: b.schema_ref, plan: b.plan && (b.plan.transport || b.plan.route_type) })));

// ───── 5) 데이터가 흐른다 — 싱크 파일이 자란다(같은 컴퓨터일 때만) ─────
if (SINK_FILE) {
  const a = size(); await sleep(2000); const z = size();
  let tail = '';
  try { const buf = readFileSync(SINK_FILE); tail = buf.subarray(Math.max(0, buf.length - 60)).toString('utf8'); } catch {}
  check('흐름 — 싱크 파일에 시험 흐름의 프레임이 쌓인다', z > a && /terra-svi-frame-\d+/.test(tail), a + ' → ' + z + ' 바이트 · 끝 "' + one(tail) + '"');
}

// ───── 6) 다시 적용 — 있는 바인딩을 쓴다(새로 만들지 않는다) ─────
const r3 = await applyLink({ client }, link, [link], ctx, opts);
check('다시 적용 — 같은 binding_id · 새로 만들지 않음', r3.applied === 0 && (r3.io.pairs[0] || {}).binding_id === bid, one(r3.notes.join(' / ')));
const list = items(await client.invoke(SYNC_OPS.bindingsGet, {})).filter((x) => x.source && x.source.resource_id === SRC && x.target && x.target.resource_id === SINK && x.desired_state === 'active');
check('바인딩 목록 — 이 쌍의 살아 있는 바인딩은 하나', list.length === 1 && list[0].binding_id === bid, list.map((x) => x.binding_id).join(', '));

// ───── 7) 연결 지우기 → 남은 연결이 쓰지 않는 바인딩 → closeBindings → closed ─────
const orphans = orphanedBindings([link], [[]]);
check('연결을 지우면 닫을 바인딩 — 이 바인딩', orphans.length === 1 && orphans[0] === bid, orphans.join(', '));
const cl = await closeBindings(client, orphans);
check('closeBindings — bindings.delete 가 받는다', cl.closed.length === 1 && cl.failed.length === 0, JSON.stringify(cl));
const t1 = Date.now(); phases = [link.io.phase];
for (let i = 0; i < 40 && link.io.phase !== 'closed'; i++) {
  await sleep(500);
  const s = await syncLinks(client, [link]);
  if (s.unavailable) { phases.push('unavailable:' + s.unavailable); break; }
  link = s.links[0];
  if (phases[phases.length - 1] !== link.io.phase) phases.push(link.io.phase);
}
check('상태 맞추기 — closed', link.io.phase === 'closed', phases.join(' → ') + ' · ' + (Date.now() - t1) + ' ms');
const rec2 = await client.invoke(SYNC_OPS.bindingGet, { binding_id: bid });
const b2 = rec2.kind === 'ok' ? (rec2.data.binding || rec2.data) : {};
check('Master 기록 — desired closed · observed closed', b2.desired_state === 'closed' && b2.observed_state === 'closed', one(JSON.stringify({ desired: b2.desired_state, observed: b2.observed_state })));
if (SINK_FILE) {
  await sleep(500); const a = size(); await sleep(1500); const z = size();
  check('흐름 멈춤 — 닫은 뒤 싱크 파일이 더 자라지 않는다', z === a, a + ' → ' + z + ' 바이트');
}
const again = await closeBindings(client, [bid]);
check('닫힌 바인딩 다시 닫기 — 닫힌 것으로 친다', again.closed.length === 1 && again.failed.length === 0, JSON.stringify(again));

// 정리 — 이번에 만든 내 허가
for (const x of (await myGrants(SRC)).concat(await myGrants(SINK))) if (x.grant_id) await client.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: x.grant_id });

const bad = results.filter((r) => !r[0]);
console.log('\n' + (results.length - bad.length) + '/' + results.length + ' 통과');
process.exit(bad.length ? 1 : 0);
