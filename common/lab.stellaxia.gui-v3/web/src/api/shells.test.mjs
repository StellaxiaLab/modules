// node --test — 제어기의 두 터미널: 노드 터미널(commands.execute → task output) · Terra 터미널(terra shell 낱말 → operation)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShells, tokenize, expandHistory } from './shells.js';

const NODES = [
  { node_id: 'n-desk-0001', display_name: 'desk', dns_label: 'desk', cluster_address: '100.80.0.11', status: 'online', relay_connected: true, daemon_version: '0.6.10', roles: ['leaf'], parent_node_id: 'n-srv-0002' },
  { node_id: 'n-srv-0002', display_name: 'server', status: 'online', roles: ['tree'] },
];
const fake = (handlers) => { const calls = []; return { calls, invoke: async (op, input = {}, at = {}) => { calls.push([op, input, at.node || '']); const h = handlers[op]; if (!h) throw Object.assign(new Error(op), { code: 'NOT_MOCKED' }); return typeof h === 'function' ? h(input, at) : h; } }; };
const topo = () => ({ localId: 'n-desk-0001' });

test('tokenize — 따옴표 · $변수 · 작은따옴표 안은 그대로', () => {
  assert.deepEqual(tokenize(`node get "my node" $N '$N'`, { N: 'desk' }), ['node', 'get', 'my node', 'desk', '$N']);
  assert.throws(() => tokenize('a "b'), /따옴표/);
  assert.equal(expandHistory('!!', ['a', 'b']), 'b'); assert.equal(expandHistory('!1', ['a', 'b']), 'a'); assert.equal(expandHistory('!9', ['a']), null);
});

test('노드 터미널 — commands.execute 후 새 출력 조각만, 끝나면 종료 코드', async () => {
  let n = 0;
  const T = fake({
    'terra.daemon.commands.execute.post': { task_id: 't-1' },
    'terra.daemon.tasks.by-task-id.output.get': () => (++n === 1 ? { chunks: [{ seq: 1, stream: 'stdout', text: 'a\n' }], complete: false } : { chunks: [{ seq: 1, stream: 'stdout', text: 'a\n' }, { seq: 2, stream: 'stderr', text: 'warn\n' }], complete: true }),
    'terra.daemon.tasks.by-task-id.get': { state: 'succeeded', exit_code: 0 },
  });
  const S = createShells(T, topo), got = [];
  const r = await S.node.run('', 'ls -la', { cwd: '/home/u', onChunk: (c) => got.push(c.stream + ':' + c.text), sleep: async () => {} });
  assert.deepEqual(got, ['stdout:a\n', 'stderr:warn\n']); assert.equal(r.exit, 0); assert.equal(r.taskId, 't-1');
  assert.deepEqual(T.calls[0], ['terra.daemon.commands.execute.post', { command: 'ls -la', timeout_sec: 120, working_dir: '/home/u' }, '']);
});

test('노드 터미널 — 다른 노드는 LOCAL_ONLY(commands.execute 는 scope local), Ctrl+C 는 cancel', async () => {
  const T = fake({ 'terra.daemon.commands.execute.post': { task_id: 't-2' }, 'terra.daemon.tasks.by-task-id.output.get': { chunks: [], complete: false }, 'terra.daemon.tasks.by-task-id.cancel.post': {}, 'terra.daemon.tasks.by-task-id.get': { state: 'cancelled' } });
  const S = createShells(T, topo);
  assert.equal(S.node.can('n-srv-0002'), false); assert.equal(S.node.can(''), true);
  await assert.rejects(S.node.run('n-srv-0002', 'ls'), (e) => e.code === 'LOCAL_ONLY');
  const sig = { stop: true }; const r = await S.node.run('', 'sleep 9', { signal: sig, sleep: async () => {} });
  assert.equal(r.state, 'cancelled'); assert.ok(T.calls.some(([op]) => op === 'terra.daemon.tasks.by-task-id.cancel.post'));
});

test('Terra 터미널 — node list · node get(이름 · .terra · id 앞부분) · use', async () => {
  const T = fake({ 'terra.master.nodes.get': NODES });
  const S = createShells(T, topo);
  const L = await S.terra.run('terra node list'); assert.match(L.lines[0].t, /^이름\s+node_id/); assert.match(L.lines[1].t, /desk\s+n-desk-0001/);
  const G = await S.terra.run('node get desk.terra'); assert.match(G.lines.map((l) => l.t).join('\n'), /부모\s+server[\s\S]*100\.80\.0\.11\s+desk\.terra/);
  const U = await S.terra.run('use n-srv'); assert.equal(U.cur, 'n-srv-0002'); assert.equal(U.curName, 'server');
  await assert.rejects(S.terra.run('node get nope'), /Master 노드 목록에 없다/);
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

test('Terra 터미널 — set var · api(--input) · 로컬 전용 op 를 다른 노드에서 부르면 거절', async () => {
  const T = fake({ 'terra.master.nodes.get': NODES, 'terra.daemon.status.get': { daemon: { node_id: 'n-desk-0001' } } });
  const S = createShells(T, topo);
  const V = await S.terra.run('set var N desk'); assert.deepEqual(V.vars, { N: 'desk' });
  const A = await S.terra.run('api terra.daemon.status.get --input {}'); assert.match(A.lines.map((l) => l.t).join(''), /n-desk-0001/);
  await assert.rejects(S.terra.run('api terra.daemon.commands.execute.post', { cur: 'n-srv-0002' }), (e) => e.code === 'LOCAL_ONLY');
});
