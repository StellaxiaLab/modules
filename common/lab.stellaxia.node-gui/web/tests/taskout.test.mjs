// 명령 작업의 출력 · 다시 실행 (Terra PF-7) — 조타륜 명령 · 작업 앱.
//   npm test
// 모양은 Terra Daemon 에서 확인했다(products/leaf/daemon/src/terra_daemon/local_api/task_output_routes.go · task_rerun_routes.go):
//   output.get { task_id, after_seq?, max_bytes? } → { task_id, state, captured, chunks[{seq, at, stream, text}], first_seq, last_seq, complete, truncated, dropped{before_seq, bytes}, bytes, more, result? }
//   output.events.get SSE — `id: <seq>` `event: output` {stream, at, text} · `event: gap` · `event: state` {state, exit_code, error, timed_out} · `event: end` {last_seq}
//   rerun.post { task_id, confirmed: true } → 202 { task_id(새 것), rerun_of, type, output_url } · Master 가 보낸 작업은 409 TASK_RERUN_VIA_MASTER
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { TerraClient, resultText } = await import('../src/api/client.js');
const { LiveSource } = await import('../src/api/source.js');
const { ADAPT } = await import('../src/api/adapters.js');
const { HELM_APPS } = await import('../src/api/operations.js');
const { OutputView, followOutput, OUTPUT_OP, OUTPUT_EVENTS_OP, OUTPUT_PAGE } = await import('../src/api/task-output.js');
const { wireHelm, outText } = await import('../src/api/wire.js');
const { prep } = await import('../src/boot/module.js');
const { default: NodeScreen } = await import('../src/screens/node.js');

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const opOf = (url) => decodeURIComponent((/\/operations\/([^/]+)\/invoke$/.exec(url) || [])[1] || '');
/** 조각으로 오는 SSE — open 이면 다 보낸 뒤에도 닫지 않는다 */
function sse(chunks, open) {
  const body = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); if (!open) c.close(); } });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const ev = (event, data, id) => (id ? 'id: ' + id + '\n' : '') + 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
const chunk = (seq, text, stream = 'stdout') => ({ seq, at: '2026-10-07T01:00:00Z', stream, text });
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => { const c = { url, op: opOf(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} }; calls.push(c); return answer(c, calls); };
  f.calls = calls;
  return f;
}

test('출력 쪽 → 출력 칸의 글 — 줄을 잇고, 두 흐름이 섞이면 stderr 에 표시 · 버린 앞부분 · 끝 상태', () => {
  const page = { task_id: 't1', state: 'succeeded', captured: true, chunks: [chunk(3, 'building\n'), chunk(4, 'warn: old\n', 'stderr'), chunk(5, 'done\n')],
    first_seq: 3, last_seq: 5, complete: true, truncated: true, dropped: { before_seq: 3, bytes: 1200 }, more: false, result: { state: 'succeeded', exit_code: 0, timed_out: false } };
  const t = new OutputView().page(page).text();
  assert.equal(t, '— 앞부분 1200 바이트는 노드의 보관 한도로 버렸다\nbuilding\n! warn: old\ndone\n— 완료 · exit 0');
  assert.equal(outText('out', page), t, '출력 칸(wire.js outText)도 같은 글');
  const quiet = new OutputView().page({ state: 'running', captured: true, chunks: [], last_seq: 0, complete: false });
  assert.equal(quiet.text(), '(아직 출력 없음)\n— 실행 중');
  assert.match(new OutputView().page({ state: 'succeeded', captured: false, chunks: [], complete: true, result: { state: 'succeeded', exit_code: 0 } }).text(), /^\(이 작업은 출력을 받지 않게 실행했다/);
  const bad = new OutputView().page({ captured: true, chunks: [chunk(1, 'x\n', 'stderr')], complete: true, result: { state: 'failed', exit_code: 2, error: 'exit status 2' } });
  assert.equal(bad.text(), 'x\n— 실패 · exit 2 · exit status 2', 'stderr 뿐이면 표시하지 않는다');
  // Master 작업 · 출력 없는 기록은 예전 모양 그대로
  assert.equal(outText('out', { output: { stdout: 'hi', exit_code: 0 } }), 'hi\n— exit 0');
  assert.match(outText('out', { type: 'process.execute', state: 'succeeded' }), /이 기록에는 출력이 없다/);
});

test('따라온 조각 — 이미 받은 순번은 버린다 · 화면에 두는 글은 끝만', () => {
  const v = new OutputView().page({ captured: true, chunks: [chunk(1, 'a\n'), chunk(2, 'b\n')], last_seq: 2, complete: false });
  assert.equal(v.chunk(chunk(2, 'b\n')), false, '다시 붙을 때 겹친 것');
  assert.equal(v.chunk(chunk(3, 'c\n')), true);
  v.gap({ before_seq: 1, bytes: 10 });
  v.finish({ state: 'succeeded', exit_code: 0 });
  assert.equal(v.text(), '— 앞부분 10 바이트는 노드의 보관 한도로 버렸다\na\nb\nc\n— 완료 · exit 0');
  const big = new OutputView(), line = 'x'.repeat(4095) + '\n';
  for (let i = 1; i <= 200; i++) big.chunk(chunk(i, line));
  assert.ok(big.chars <= 512 * 1024 && big.cut > 0);
  assert.match(big.text(), /^— 앞부분 \d+ 글자는 이 화면에서 덜어 냈다/);
});

test('followOutput — 읽은 last_seq 뒤부터 SSE 로 받고, end 에 스스로 닫는다 · 끊기면 받은 순번부터 잇는다', async () => {
  let n = 0;
  const f = fakeFetch(() => {
    n++;
    if (n === 1) return sse([': subscribed\n\n', ev('output', { stream: 'stdout', text: 'three\n' }, 3)]);   // 끝 없이 끊겼다
    return sse([ev('output', { stream: 'stdout', text: 'three\n' }, 3), ev('output', { stream: 'stderr', text: 'four\n' }, 4), ev('state', { state: 'failed', exit_code: 1 }), ev('end', { last_seq: 4 })], true);
  });
  const view = new OutputView().page({ captured: true, chunks: [chunk(1, 'one\n'), chunk(2, 'two\n')], last_seq: 2, complete: false });
  let changes = 0;
  followOutput({ base: '', fetch: f }, 't9', view, () => { changes++; }, { sleep: () => Promise.resolve() });
  await sleep(30);
  assert.equal(f.calls[0].url, '/api/v1/operations/' + OUTPUT_EVENTS_OP + '/invoke');
  assert.deepEqual([f.calls[0].body, f.calls[0].headers['Last-Event-ID']], [{ task_id: 't9', last_event_id: '2' }, '2'], '읽은 것 뒤부터');
  assert.equal(f.calls[1].body.last_event_id, '3', '끊기면 받은 순번부터');
  assert.equal(f.calls.length, 2, 'end 뒤에는 다시 붙지 않는다');
  assert.equal(view.text(), 'one\ntwo\nthree\n! four\n— 실패 · exit 1');
  assert.ok(view.ended && changes >= 3);
});

test('대응표 — 이 노드의 출력은 output.get(process.execute) · 다시 실행은 rerun.post {confirmed} 두 번 누르기 · Master 가 보낸 작업은 이유', async () => {
  const L = HELM_APPS.job.local.acts;
  assert.deepEqual([L.out.op, L.out.perm, L.rerun.op, !!L.rerun.confirm, L.rerun.none], [OUTPUT_OP, 'process.execute', 'terra.daemon.tasks.by-task-id.rerun.post', true, undefined]);
  const f = fakeFetch((c) => (c.op === 'terra.daemon.tasks.by-task-id.rerun.post'
    ? json(202, { status: 'accepted', data: { task_id: 'task-2', rerun_of: c.url && 'task-1', type: 'process.execute.request', output_url: '/tasks/task-2/output' } })
    : json(200, { status: 'ok', data: { task_id: 'task-1', state: 'succeeded', captured: true, chunks: [], complete: true } })));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a' });
  const out = await source.act('leaf-a', 'job', 'task-1', 'out', { id: 'task-1' });
  assert.deepEqual([out.kind, f.calls[0].op, f.calls[0].body], ['ok', OUTPUT_OP, { task_id: 'task-1', max_bytes: OUTPUT_PAGE }]);
  const re = await source.act('leaf-a', 'job', 'task-1', 'rerun', { id: 'task-1', origin: 'local' });
  assert.deepEqual([re.kind, re.job, f.calls[1].body], ['accepted', 'task-2', { task_id: 'task-1', confirmed: true }]);
  const via = await source.act('leaf-a', 'job', 'task-3', 'rerun', { id: 'task-3', origin: 'master' });
  assert.deepEqual([via.kind, via.reason, f.calls.length], ['unavailable', 'TASK_RERUN_VIA_MASTER', 2], 'Master 가 보낸 작업은 부르지 않는다');
  assert.match(resultText(via), /Master 가 보낸 작업이다/);
  assert.match(resultText({ kind: 'error', reason: 'TASK_SPEC_EXPIRED' }), /\+ 실행으로 다시 적는다/);
  // 목록 → 카드: 끝 코드 · 어디서 왔나 · 무엇을 다시 실행했나
  const items = ADAPT.jobLocal({ tasks: [{ id: 'task-2', type: 'process.execute.request', state: 'failed', origin: { kind: 'local', principal: 'local-cli' }, result: { state: 'failed', exit_code: 3 }, rerun_of: 'task-1' }] });
  assert.deepEqual([items[0].code, items[0].origin, items[0].rerunOf, items[0].state], [3, 'local', 'task-1', 'failed']);
});

test('조타륜 — 출력은 실행 중에도 보고 이 노드면 따라간다 · 다시는 두 번 눌러야 부른다', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'process.execute'];
  const local = s.state.localNode.name;
  let streamed = false;
  const f = fakeFetch((c) => {
    if (c.op === 'terra.daemon.tasks.get') return json(200, { status: 'ok', data: { tasks: [
      { id: 'task-run', type: 'process.execute.request', state: 'running', origin: { kind: 'local' }, started_at: new Date().toISOString() },
      { id: 'task-old', type: 'process.execute.request', state: 'succeeded', origin: { kind: 'local' }, result: { state: 'succeeded', exit_code: 0 } }] } });
    if (c.op === OUTPUT_OP) return json(200, { status: 'ok', data: { task_id: c.body.task_id, state: 'running', captured: true, chunks: [chunk(1, 'step 1\n')], first_seq: 1, last_seq: 1, complete: false } });
    if (c.op === OUTPUT_EVENTS_OP) { streamed = true; return sse([ev('output', { stream: 'stdout', text: 'step 2\n' }, 2), ev('state', { state: 'succeeded', exit_code: 0 }), ev('end', { last_seq: 2 })]); }
    if (c.op === 'terra.daemon.tasks.by-task-id.rerun.post') return json(202, { status: 'accepted', data: { task_id: 'task-new', rerun_of: 'task-old' } });
    return json(200, { status: 'ok', data: { id: 'task-new', state: 'succeeded' } });
  });
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: local, localId: 'node_a' });
  const said = [], say = s.hbSay.bind(s);
  s.hbSay = (t, c) => { said.push(t); say(t, c); };
  const unwire = wireHelm(s, source, { pollMs: 60000 });
  try {
    s.hbPut(local, 'job', await source.list(local, 'job'));
    assert.deepEqual(s.hbItems(local, 'job').map((d) => d.state), ['running', 'success']);

    await s.hbAct('job', 'task-run', 'out', local);
    assert.equal(s.state.hbOut.id, 'task-run');
    await sleep(40);
    assert.ok(streamed, '실행 중인 이 노드의 작업은 따라간다');
    assert.equal(s.state.hbOut.text, 'step 1\nstep 2\n— 완료 · exit 0');

    const before = f.calls.length;
    await s.hbAct('job', 'task-old', 'rerun', local);
    assert.equal(f.calls.length, before, '첫 누름은 겨누기만');
    assert.equal(s.state.hbArm, 'task-old');
    assert.ok(said.some((t) => /한 번 더 누르면/.test(t)));
    await s.hbAct('job', 'task-old', 'rerun', local);
    const call = f.calls.find((c) => c.op === 'terra.daemon.tasks.by-task-id.rerun.post');
    assert.deepEqual(call && call.body, { task_id: 'task-old', confirmed: true });
    assert.equal(s.state.hbArm, null);
  } finally { unwire(); }
});
