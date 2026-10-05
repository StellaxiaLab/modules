// 이 노드의 손 동작 — 모듈 로그 · 로컬 탐색(local-fs) · 바탕화면에서 열기(desktop.open) · 파일 올리기(io.terra.file 전송) · 장치 손 등록.
//   npm test
// 입력 모양은 서버 계약에서 확인했다: Daemon local-fs.entries.get { root, path?, limit } · desktop.open.post { root, path?, action } ·
// io.terra.file transfers.create { direction, path, size_bytes, checksum_sha256, mode, root? } → chunks.put { transfer_id, offset, data(base64) } → complete ·
// io.devices.post { kind, name, adapter_id: manual.rtsp | manual.http-camera, address }
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {}, origin: 'http://app-lab--stellaxia--node-gui--web.localhost:28787' };
win.parent = win;
globalThis.window = win;

const { TerraClient } = await import('../src/api/client.js');
const { LiveSource } = await import('../src/api/source.js');
const { manualAdapter, logLines } = await import('../src/api/operations.js');
const { outText } = await import('../src/api/wire.js');
const { Sha256, sha256Blob, toB64, fromB64 } = await import('../src/api/sha256.js');
const { localRootItems, localEntryItems } = await import('../src/data/files.js');
const { realNode, masterWhy, onThisMachine, deskOpen, loadLocalFolder } = await import('../src/data/node-live.js');
const { default: NodeScreen } = await import('../src/screens/node.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const opOf = (url) => decodeURIComponent((/\/operations\/([^/]+)\/invoke$/.exec(url) || [])[1] || '');
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url, op: opOf(url), body: init.body ? JSON.parse(init.body) : null }); return answer(url, init, calls); };
  f.calls = calls;
  return f;
}

test('SHA-256 · base64 — 올리기가 싣는 검사값과 조각', async () => {
  assert.equal(await sha256Blob(new Blob(['abc'])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Blob(new Blob([])), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(toB64(new TextEncoder().encode('hello')), 'aGVsbG8=');
  assert.equal(new TextDecoder().decode(fromB64('aGVsbG8=')), 'hello');
});

test('올리기 — 만들기(크기 · SHA-256) → 조각 → 409 면 서버가 받은 곳부터 → 완료. 진행을 알린다', async () => {
  const data = 'x'.repeat(10), file = new File([data], 'note.txt');
  let rejected = false;
  const f = fakeFetch((url, init, calls) => {
    const c = calls.at(-1);
    if (c.op === 'io.terra.file.transfers.create') return json(202, { status: 'accepted', data: { transfer: { transfer_id: 'tr-1', chunk_size: 4, offset: 0 } } });
    if (c.op === 'io.terra.file.transfers.chunks.put') {
      if (c.body.offset === 4 && !rejected) { rejected = true; return json(409, { error: { code: 'TRANSFER_OFFSET_MISMATCH' } }); }
      return json(200, { status: 'ok', data: { next_offset: c.body.offset + atob(c.body.data).length } });
    }
    if (c.op === 'io.terra.file.transfers.get') return json(200, { status: 'ok', data: { transfer: { transfer_id: 'tr-1', offset: 2 } } });
    if (c.op === 'io.terra.file.transfers.complete') return json(200, { status: 'ok', data: { transfer: { transfer_id: 'tr-1', state: 'completed' }, verified: true } });
    return json(404, {});
  });
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a', localId: 'node_a' });
  const seen = [];
  const r = await source.upload('leaf-a', file, 'share-0/docs', (off) => seen.push(off));
  assert.equal(r.kind, 'ok');
  const cr = f.calls[0];
  assert.deepEqual(cr.body, { direction: 'push', path: 'docs/note.txt', size_bytes: 10, checksum_sha256: await sha256Blob(new Blob([data])), mode: 'create', root: 'share-0' });
  const puts = f.calls.filter((c) => c.op === 'io.terra.file.transfers.chunks.put').map((c) => c.body.offset);
  assert.deepEqual(puts, [0, 4, 2, 6], '409 뒤 서버가 받은 곳(2)부터 다시');
  assert.ok(f.calls.some((c) => c.op === 'io.terra.file.transfers.get'));
  assert.equal(f.calls.at(-1).op, 'io.terra.file.transfers.complete');
  assert.deepEqual(f.calls.at(-1).body, { transfer_id: 'tr-1' });
  assert.equal(seen.at(-1), 10);
  // 공유 폴더를 고르지 않았으면 root 를 싣지 않는다(share-0 맨 위)
  const g = fakeFetch(() => json(500, { error: { code: 'INTERNAL' } }));
  const bad = await new LiveSource(new TerraClient('', { fetch: g }), { localNode: 'leaf-a' }).upload('leaf-a', file, '');
  assert.deepEqual([bad.kind, g.calls[0].body.path, 'root' in g.calls[0].body], ['error', 'note.txt', false]);
});

test('올리기 — 409 가 계속되면 다섯 번에서 멈춘다(무한히 돌지 않는다)', async () => {
  const f = fakeFetch((url, init, calls) => {
    const c = calls.at(-1);
    if (c.op === 'io.terra.file.transfers.create') return json(202, { status: 'accepted', data: { transfer: { transfer_id: 't', chunk_size: 4 } } });
    if (c.op === 'io.terra.file.transfers.get') return json(200, { status: 'ok', data: { transfer: { offset: 0 } } });
    return json(409, { error: { code: 'TRANSFER_OFFSET_MISMATCH' } });
  });
  const r = await new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'n' }).upload('n', new File(['abcdefgh'], 'a.bin'), '');
  assert.deepEqual([r.kind, r.status], ['error', 409]);
  assert.equal(f.calls.filter((c) => c.op === 'io.terra.file.transfers.chunks.put').length, 6);
});

test('받기 — pulls.create → chunks.get(eof 까지 · 조각 SHA-256) → 전체 SHA-256 → pulls.complete. 어긋나면 pulls.abort 로 닫고 저장하지 않는다', async () => {
  const body = 'hello terra!', sum = await sha256Blob(new Blob([body]));
  const chunk = (off, n, eof, bad) => { const b = new TextEncoder().encode(body.slice(off, off + n)); return { offset: off, data: toB64(b), sha256: bad ? '00' : new Sha256().update(b).hex(), eof }; };
  const server = (opts = {}) => fakeFetch((url, init, calls) => {
    const c = calls.at(-1);
    if (c.op === 'io.terra.file.transfers.pulls.create') return json(200, { status: 'ok', data: { transfer: { transfer_id: 'p1', direction: 'pull', root: c.body.root, path: c.body.path, size_bytes: body.length, checksum_sha256: opts.sum || sum, chunk_size: 5, offset: 0, state: 'prepared' } } });
    if (c.op === 'io.terra.file.transfers.chunks.get') return json(200, { status: 'ok', data: chunk(c.body.offset, 5, c.body.offset + 5 >= body.length, opts.badChunk && c.body.offset === 5) });
    if (c.op === 'io.terra.file.transfers.pulls.complete') return json(200, { status: 'ok', data: { transfer_id: 'p1', bytes: body.length, checksum_sha256: sum, verified: true } });
    if (c.op === 'io.terra.file.transfers.pulls.abort') return json(200, { status: 'ok', data: { transfer_id: 'p1', state: 'aborted' } });
    return json(404, {});
  });
  const f = server();
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a' });
  const seen = [];
  const r = await source.download('leaf-a', 'share-0/docs/hello.txt', (off, size) => seen.push(off + '/' + size));
  assert.equal(r.kind, 'ok');
  assert.equal(r.name, 'hello.txt');
  assert.equal(await r.blob.text(), body);
  assert.deepEqual(f.calls[0].body, { root: 'share-0', path: 'docs/hello.txt' });
  assert.deepEqual(f.calls.filter((c) => c.op === 'io.terra.file.transfers.chunks.get').map((c) => c.body.offset), [0, 5, 10]);
  assert.deepEqual(seen, ['5/12', '10/12', '12/12']);
  assert.equal(f.calls.at(-1).op, 'io.terra.file.transfers.pulls.complete');
  // 조각이 상했다 → 닫는다
  const g = server({ badChunk: true });
  const bad = await new LiveSource(new TerraClient('', { fetch: g }), { localNode: 'leaf-a' }).download('leaf-a', 'share-0/hello.txt');
  assert.deepEqual([bad.kind, bad.reason, g.calls.at(-1).op], ['error', 'chunk-checksum', 'io.terra.file.transfers.pulls.abort']);
  // 전체 검사값이 다르다 → 닫고 저장하지 않는다
  const h = server({ sum: 'f'.repeat(64) });
  const wrong = await new LiveSource(new TerraClient('', { fetch: h }), { localNode: 'leaf-a' }).download('leaf-a', 'share-0/hello.txt');
  assert.deepEqual([wrong.kind, wrong.reason, wrong.blob, h.calls.at(-1).op], ['error', 'checksum', undefined, 'io.terra.file.transfers.pulls.abort']);
  // 공유 폴더(맨 위 칸) 자체는 받지 않는다
  assert.equal((await source.download('leaf-a', 'share-0')).reason, 'share-root');
  // 폴더 앱의 받기는 누르기 전에 잠그지 않는다(카탈로그를 못 받았으면) · act 로 부르면 이유만
  assert.equal(source.lockFor('folder', 'get', 'leaf-a'), null);
  assert.deepEqual(await source.act('leaf-a', 'folder', 'share-0/x', 'get', {}), { kind: 'unavailable', reason: 'no-download' });
});

test('장치 손 등록 — 주소의 scheme 이 어댑터를 고른다. 비우면 스캔, 모르는 scheme 은 부르지 않는다', async () => {
  assert.deepEqual(['rtsp://cam/1', 'RTSPS://x', 'http://cam', 'https://cam:8443/s', 'ftp://x', 'cam', ''].map(manualAdapter),
    ['manual.rtsp', 'manual.rtsp', 'manual.http-camera', 'manual.http-camera', '', '', '']);
  const f = fakeFetch(() => json(200, { status: 'ok', data: { device: { id: 'd1' } } }));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a' });
  await source.crud('leaf-a', 'io', 'create', { name: '현관 카메라', addr: ' rtsp://cam.local/stream ' });
  assert.deepEqual([f.calls[0].op, f.calls[0].body], ['terra.daemon.io.devices.post', { kind: 'camera', name: '현관 카메라', adapter_id: 'manual.rtsp', address: 'rtsp://cam.local/stream' }]);
  const scan = await source.crud('leaf-a', 'io', 'create', { name: '', addr: '' });
  assert.equal(f.calls[1].op, 'terra.daemon.io.scan.post');
  assert.ok(scan.say !== undefined, '스캔이면 찾은 수를 글줄로');
  const no = await source.crud('leaf-a', 'io', 'create', { name: 'x', addr: 'ftp://cam' });
  assert.deepEqual([no.kind, no.reason, f.calls.length], ['unavailable', 'io-addr', 2]);
});

test('모듈 로그 · 작업 출력 — 출력 칸의 글', () => {
  assert.deepEqual(logLines({ logs: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(logLines({ lines: [{ at: 't', stream: 'stdout', text: 'up' }, { at: 't', stream: 'stderr', text: 'oops' }] }), ['up', '! oops']);
  assert.equal(outText('log', { logs: ['one', 'two'], truncated: true }), 'one\ntwo\n— 앞부분은 잘렸다');
  assert.equal(outText('log', { lines: [] }), '(최근 로그 없음)');
  const t = outText('out', { type: 'process.execute', state: 'succeeded', started_at: '2026-10-05T01:00:00Z', finished_at: '2026-10-05T01:00:02Z' });
  assert.match(t, /작업 process\.execute/);
  assert.match(t, /명령 출력을 돌려주지 않는다/);
  assert.equal(outText('out', { output: { stdout: 'hi', exit_code: 0 } }), 'hi\n— exit 0');
});

test('로컬 탐색 — 최상위 루트 · 폴더 항목. 읽을 수 없는 것은 잠그고 이유를 보인다', () => {
  const roots = localRootItems([{ name: 'home', path: '/home/user', kind: 'home' }, { name: 'secret', readable: false, reason: '권한 없음' }, { path: '/x' }]);
  assert.deepEqual(roots.map((r) => [r.id, r.dir, !!r.locked]), [['home', true, false], ['secret', true, true]]);
  assert.equal(roots[1].info, '🔒 권한 없음');
  const items = localEntryItems('home', 'docs', [{ name: 'a.txt', size: 2048, modified_at: '2026-10-05T01:02:00Z' }, { name: 'sub', is_dir: true }, { name: 'x', readable: false }, { size: 1 }]);
  assert.deepEqual(items.map((e) => [e.id, e.parent, e.dir, e.rel]), [['home/docs/a.txt', 'home/docs', false, 'docs/a.txt'], ['home/docs/sub', 'home/docs', true, 'docs/sub'], ['home/docs/x', 'home/docs', false, 'docs/x']]);
  assert.ok(items[2].locked);
  assert.equal(localEntryItems('home', '', [{ name: 'b', path: '/b' }])[0].id, 'home/b', '루트 바로 아래 · path 가 오면 그것을 쓴다');
});

function signedIn(answer) {
  const s = new (realNode(NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'node.control', 'file.read'];
  const f = fakeFetch(answer);
  s.__client = new TerraClient('', { fetch: f });
  const said = [];
  s.fbSay = (t, c) => said.push(t);
  return { s, f, said };
}

test('로컬 탐색 — 들어간 폴더를 한 번 읽는다(한 쪽 500개). 실패하면 다시 읽을 수 있게 둔다', async () => {
  const { s, f, said } = signedIn((url, init, calls) => (calls.length === 1
    ? json(200, { status: 'ok', data: { root: 'home', path: 'docs', entries: [{ name: 'a.txt', size: 1 }] } })
    : json(403, { error: { code: 'LOCAL_FS_DENIED' } })));
  await loadLocalFolder(s, s.__client, 'home/docs');
  assert.deepEqual([f.calls[0].op, f.calls[0].body], ['terra.daemon.local-fs.entries.get', { root: 'home', path: 'docs', limit: 500 }]);
  assert.ok(s.__real.fb.local.some((x) => x.id === 'home/docs/a.txt'));
  await loadLocalFolder(s, s.__client, 'home/docs');
  assert.equal(f.calls.length, 1, '읽은 폴더는 다시 부르지 않는다');
  await loadLocalFolder(s, s.__client, 'home');
  assert.deepEqual(f.calls[1].body, { root: 'home', limit: 500 }, '루트는 path 없이');
  assert.match(said.at(-1), /닫힌 폴더/, 'Daemon 오류 코드는 화면 글로');
  assert.ok(!s.__real.loaded.has('local:home'), '실패한 폴더는 다시 읽을 수 있다');
});

test('바탕화면에서 열기 — 그 컴퓨터에서 볼 때만. 공유 폴더는 shared:<이름>, 실행 파일은 열지 않는다(409)', async () => {
  assert.equal(onThisMachine('http://app-x.localhost:28787'), true);
  assert.equal(onThisMachine('http://127.0.0.1:5173'), true);
  assert.equal(onThisMachine('http://[::1]:8080'), true);
  assert.equal(onThisMachine('https://terra.example.org'), false);
  assert.equal(onThisMachine('not a url'), false);
  const { s, f, said } = signedIn((url, init, calls) => (calls.at(-1).body.path === 'run.sh'
    ? json(409, { error: { code: 'DESKTOP_OPEN_EXECUTABLE' } })
    : json(200, { status: 'ok', data: { opened: true } })));
  await deskOpen(s, 'repo', { id: 'share-0/docs/a.pdf', name: 'a.pdf' }, 'open');
  assert.deepEqual([f.calls[0].op, f.calls[0].body], ['terra.daemon.desktop.open.post', { root: 'shared:share-0', action: 'open', path: 'docs/a.pdf' }]);
  assert.match(said.at(-1), /열었다 — a\.pdf/);
  await deskOpen(s, 'local', { id: 'home', name: 'home' }, 'reveal');
  assert.deepEqual(f.calls[1].body, { root: 'home', action: 'reveal' });
  assert.match(said.at(-1), /파일 관리자로 열었다/);
  await deskOpen(s, 'local', { id: 'home/run.sh', name: 'run.sh' }, 'open');
  assert.match(said.at(-1), /실행 파일은 열지 않는다/);
  // 다른 기계에서 보고 있으면 부르지 않는다
  const was = win.origin;
  win.origin = 'https://terra.example.org';
  try {
    await deskOpen(s, 'repo', { id: 'share-0/x', name: 'x' }, 'open');
    assert.equal(f.calls.length, 3);
    assert.match(said.at(-1), /그 컴퓨터에서 이 화면을 볼 때만/);
  } finally { win.origin = was; }
  // 로그인 전
  s.__client = null;
  assert.equal(await deskOpen(s, 'repo', { id: 'share-0/x', name: 'x' }, 'open'), null);
});

test('노드 관리(이름 · 부모 바꾸기 · 지우기) — 앱 토큰은 Master 에 닿지 않는다: 이유를 보이고 잠근다', () => {
  assert.match(masterWhy(null, 'x'), /연결되지 않았다/);
  const blocked = { masterBlocked: true, catalog: new Map([['a', {}]]), has: () => true };
  assert.match(masterWhy(blocked, 'terra.master.nodes.by-node-id.patch'), /Master에 닿지 않는다/);
  const missing = { masterBlocked: false, catalog: new Map([['a', {}]]), has: () => false };
  assert.match(masterWhy(missing, 'terra.master.nodes.by-node-id.patch'), /Master에 닿지 않는다/);
  const fine = { masterBlocked: false, catalog: new Map([['terra.master.nodes.by-node-id.patch', {}]]), has: () => true };
  assert.equal(masterWhy(fine, 'terra.master.nodes.by-node-id.patch'), '');
  assert.equal(masterWhy({ masterBlocked: false, catalog: new Map(), has: () => true }, 'x'), '', '카탈로그를 못 받았으면 막지 않는다');
});
