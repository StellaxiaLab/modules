// node --test — 제어기의 두 터미널: 노드 터미널(잠김 — 실행 길 없음) · Terra 터미널(terra shell 낱말 → 위임표의 읽기 operation, 셸 문법 거절)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShells, tokenize, expandHistory, apiAllowed, TERRA_OPS, GATEWAY_READS, NODE_SHELL, ELSEWHERE } from './shells.js';
import SCOPE from './op-scope.json' with { type: 'json' };
import MASTER from './master-delegated.json' with { type: 'json' };

const NODES = [
  { node_id: 'n-desk-0001', display_name: 'desk', dns_label: 'desk', cluster_address: '100.80.0.11', status: 'online', relay_connected: true, daemon_version: '0.6.10', roles: ['leaf'], parent_node_id: 'n-srv-0002' },
  { node_id: 'n-srv-0002', display_name: 'server', status: 'online', roles: ['tree'] },
];
const fake = (handlers) => { const calls = []; return { calls, invoke: async (op, input = {}, at = {}) => { calls.push([op, input, at.node || '']); const h = handlers[op]; if (!h) throw Object.assign(new Error(op), { code: 'NOT_MOCKED' }); return typeof h === 'function' ? h(input, at) : h; } }; };
const topo = () => ({ localId: 'n-desk-0001' });

test('tokenize — 빈칸으로만 나누고, 셸 문법(따옴표 · $변수 · 메타문자 · 여러 줄)은 줄째 거절', () => {
  assert.deepEqual(tokenize('  node get  desk.terra '), ['node', 'get', 'desk.terra']);
  assert.deepEqual(tokenize('api terra.daemon.modules.by-module-id.get module_id=io.terra.agent'), ['api', 'terra.daemon.modules.by-module-id.get', 'module_id=io.terra.agent']);
  assert.deepEqual(tokenize('route candidates 노드-가 100.80.0.11'), ['route', 'candidates', '노드-가', '100.80.0.11']);
  for (const bad of ['node get "my node"', "node get 'x'", 'node get $N', 'status; rm -rf /', 'status && ls', 'status | cat', 'status > out', 'status < in', 'status `id`', 'status $(id)', 'node get a\\b', 'status &', 'node get {a}', 'node get *', 'node get ?', 'node get ~', 'status!', 'status\nls', 'status\rls'])
    assert.throws(() => tokenize(bad), (e) => e.code === 'SHELL_SYNTAX', bad);
  assert.equal(expandHistory('!!', ['a', 'b']), 'b'); assert.equal(expandHistory('!1', ['a', 'b']), 'a'); assert.equal(expandHistory('!9', ['a']), null);
});

test('명령표 — 모든 명령의 operation 이 위임표(op-scope · master-delegated · Gateway 읽기)에 있고 읽기다', () => {
  for (const [cmd, ops] of Object.entries(TERRA_OPS)) for (const op of ops) {
    const D = SCOPE.operations[op], M = MASTER.operations[op];
    assert.ok(D || M || GATEWAY_READS.includes(op), cmd + ' → ' + op + ' 이 위임표에 없다');
    if (D) { assert.equal(D.risk, 'read', op); assert.ok(!D.permissions.includes('process.execute'), op); }
    if (M) assert.equal(M.method, 'GET', op);
    assert.equal(apiAllowed(op).ok, true, op);
  }
});

test('명령 → operation 1:1 — 부른 op 는 명령표의 그 명령 칸에 든 것뿐', async () => {
  const T = fake({ 'terra.master.nodes.get': NODES, 'terra.daemon.status.get': { daemon: { node_id: 'n-desk-0001' } }, 'terra.gateway.agent.whoami.get': { principal: 'user:a', permissions: ['node.read'] },
    'terra.master.network.status.get': { nodes: [] }, 'terra.master.route.graph.get': { edges: [] }, 'terra.master.route.sessions.get': { sessions: [] }, 'terra.master.network.probes.get': { probes: [] },
    'terra.daemon.modules.get': { modules: [] }, 'terra.daemon.tasks.get': { tasks: [] }, 'terra.daemon.tasks.by-task-id.get': { id: 't-1', state: 'done' } });
  for (const [line, cmd] of [['status', 'status'], ['whoami', 'whoami'], ['node list', 'node'], ['network status', 'network'], ['route graph', 'route'], ['session list', 'session'], ['probe list', 'probe'], ['module list', 'module'], ['task list', 'task'], ['task get t-1', 'task'], ['daemon status', 'daemon'], ['use desk', 'use']]) {
    T.calls.length = 0; await createShells(T, topo).terra.run(line);   // 노드 목록은 셸마다 10초 붙잡아 두므로 줄마다 새로
    for (const [op] of T.calls) assert.ok(TERRA_OPS[cmd].includes(op), line + ' 이 표 밖의 ' + op + ' 을 불렀다');
    assert.ok(T.calls.length > 0, line);
  }
});

test('위임 밖 · 쓰기 명령 — 부르지 않고 "여기서 못 함 + 대신 할 곳"', async () => {
  const T = fake({});
  const S = createShells(T, topo);
  for (const [line, where] of [['module install a.tpkg', /모듈 창/], ['module start io.terra.agent', /모듈 창/], ['task cancel t-1', /작업 관리자/], ['task output t-1', /작업 관리자/], ['config set logging.level debug', /설정 창/], ['daemon restart', /terra CLI/],
    ['wg up', /네트워크 창/], ['svi grant x', /자원 관리/], ['login', /로그인 화면/], ['exec ls', /노드 셸 — 잠김/], ['terra sudo ls', /노드 셸 — 잠김/], ['bash', /노드 셸/], ['set var N desk', /변수 없음/]])
    await assert.rejects(S.terra.run(line), (e) => e.code === 'NOT_HERE' && /여기서 불가 · 대신 : /.test(e.message) && where.test(e.message), line);
  assert.equal(T.calls.length, 0, '아무것도 부르지 않았다');
  assert.ok(ELSEWHERE.every(([, , w]) => typeof w === 'string' && w.length > 0));
});

test('노드 터미널 — 잠김: 실행 길이 없고(commands.execute 를 부르지 않는다) 이유와 설계 문서를 든다', async () => {
  const T = fake({ 'terra.daemon.commands.execute.post': { task_id: 't-1' } });
  const S = createShells(T, topo);
  assert.equal(NODE_SHELL.locked, true); assert.equal(S.NODE_SHELL, NODE_SHELL); assert.equal(S.node.locked, true);
  assert.match(NODE_SHELL.reason, /^잠김 : /); assert.equal(NODE_SHELL.design, 'docs/design/node-shell.md'); assert.ok(NODE_SHELL.instead.length >= 2);
  assert.equal(S.node.can(''), false); assert.equal(S.node.can('n-desk-0001'), false);
  await assert.rejects(S.node.run('', 'ls'), (e) => e.code === 'LOCKED'); await assert.rejects(S.node.cd('', '/'), (e) => e.code === 'LOCKED');
  assert.equal(T.calls.length, 0);
  assert.ok(Object.isFrozen(NODE_SHELL));
});

test('Terra 터미널 — node list · node get(이름 · .terra · id 앞부분) · use', async () => {
  const T = fake({ 'terra.master.nodes.get': NODES });
  const S = createShells(T, topo);
  const L = await S.terra.run('terra node list'); assert.match(L.lines[0].t, /^이름\s+node_id/); assert.match(L.lines[1].t, /desk\s+n-desk-0001/);
  const G = await S.terra.run('node get desk.terra'); assert.match(G.lines.map((l) => l.t).join('\n'), /부모\s+server[\s\S]*100\.80\.0\.11\s+desk\.terra/);
  const U = await S.terra.run('use n-srv'); assert.equal(U.cur, 'n-srv-0002'); assert.equal(U.curName, 'server');
  await assert.rejects(S.terra.run('node get nope'), /Master 노드 목록에 없음/);
  await assert.rejects(S.terra.run('frobnicate'), /모르는 명령/);
});

test('Terra 터미널 — route candidates 는 두 노드 쌍으로, 다른 노드의 module list 는 중계', async () => {
  const T = fake({ 'terra.master.nodes.get': NODES,
    'terra.master.route.candidates.get': { policy_source: 'default', candidates: [{ route_type: 'mesh_vpn_direct', adapter: 'wireguard', healthy: true, latency_ms: 4 }], denied_candidates: [{ route_type: 'lan_direct', adapter: 'tcp', reason: 'no fresh probe' }] },
    'terra.daemon.modules.get': { modules: [{ id: 'io.terra.agent', version: '0.3.0', state: 'running' }] } });
  const S = createShells(T, topo);
  const R = await S.terra.run('route candidates desk server'); assert.equal(R.lines[0].t, 'desk → server · 정책 default'); assert.match(R.lines[1].t, /^✓ mesh 직결\s+wireguard\s+4ms/); assert.match(R.lines[2].t, /^× LAN 직결.*no fresh probe/);
  assert.deepEqual(T.calls.find(([op]) => op === 'terra.master.route.candidates.get')[1], { source_node_id: 'n-desk-0001', target_node_id: 'n-srv-0002' });
  await S.terra.run('module list', { cur: 'n-srv-0002' }); assert.equal(T.calls.find(([op]) => op === 'terra.daemon.modules.get')[2], 'n-srv-0002');
});

test('Terra 터미널 api — 위임표의 읽기만(이름=값 입력), 쓰기 · 위험 · 표 밖 · 로컬 전용은 거절', async () => {
  const T = fake({ 'terra.master.nodes.get': NODES, 'terra.daemon.status.get': { daemon: { node_id: 'n-desk-0001' } }, 'terra.daemon.modules.by-module-id.get': (i) => ({ id: i.module_id }) });
  const S = createShells(T, topo);
  const A = await S.terra.run('api terra.daemon.status.get'); assert.match(A.lines.map((l) => l.t).join(''), /n-desk-0001/);
  const B = await S.terra.run('api terra.daemon.modules.by-module-id.get module_id=io.terra.agent'); assert.match(B.lines.map((l) => l.t).join(''), /io\.terra\.agent/);
  assert.deepEqual(T.calls.at(-1), ['terra.daemon.modules.by-module-id.get', { module_id: 'io.terra.agent' }, '']);
  await assert.rejects(S.terra.run('api terra.daemon.status.get --input {}'), (e) => e.code === 'SHELL_SYNTAX');
  await assert.rejects(S.terra.run('api terra.daemon.status.get junk'), (e) => e.code === 'BAD_INPUT');
  const n0 = T.calls.length;
  for (const [op, code, where] of [['terra.daemon.commands.execute.post', 'NOT_HERE', /노드 셸 — 잠김/], ['terra.daemon.tasks.by-task-id.output.get', 'NOT_HERE', /작업 관리자/], ['terra.daemon.modules.by-module-id.stop.post', 'NOT_HERE', /모듈 창/], ['terra.daemon.config.apply.post', 'NOT_HERE', /설정 창/],
    ['terra.master.svi.grants.post', 'NOT_HERE', /자원 관리/], ['terra.master.crossboundary.login-routes.get', 'DELEGATION_NOT_OPEN', /B 모드/], ['lab.stellaxia.gui-v3.status.get', 'NOT_DELEGATED', /terra CLI/]]) {
    assert.equal(apiAllowed(op).ok, false, op);
    await assert.rejects(S.terra.run('api ' + op), (e) => e.code === code && /여기서 불가/.test(e.message) && where.test(e.message), op);
  }
  assert.equal(T.calls.length, n0, '거절한 op 는 부르지 않았다');
  await assert.rejects(S.terra.run('api terra.daemon.live.get', { cur: 'n-srv-0002' }), (e) => e.code === 'LOCAL_ONLY');
});

