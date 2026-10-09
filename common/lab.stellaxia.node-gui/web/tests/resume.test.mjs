// 끊긴 뒤 이어서(구현해야 할 것 MD-21) — 페이지를 닫았다 다시 열어도 올리기 · 받기를 잇는다.
//   npm test
// 올리기: 보내던 화면이 닫히면 부분 파일과 전송 기록(checkpoint)이 서버에 남는다 — 같은 파일을 다시 올리면 새로 만들기가
//         FILE_TARGET_EXISTS 다. 그 자리에 같은 파일(크기 · SHA-256)을 보내다 멈춘 전송이 있으면 resume_id 로 그 전송을 다시 연다.
// 받기:   받은 조각을 이 브라우저(src/store/parts.js — IndexedDB)에 둔다. 같은 파일을 다시 받으면 새로 연 받기의 SHA-256 · 크기가
//         같을 때 둔 곳부터 잇는다. IndexedDB 자체는 Chromium 에서 본다(tests/smoke.mjs) — 여기서는 같은 약속의 메모리 판을 쓴다.
// 입력 모양은 io.terra.file 계약 · api.go 에서 확인했다: transfers.create { …, resume_id } · transfers.list → { transfers: [기록] } ·
//   기록 { transfer_id, direction, root, path, size_bytes, checksum_sha256, mode, offset, state, updated_at, expires_at }
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { TerraClient } = await import('../src/api/client.js');
const { LiveSource, markStalled, STALL_MS, SEEN_MS } = await import('../src/api/source.js');
const { ADAPT } = await import('../src/api/adapters.js');
const { Sha256, sha256Blob, toB64 } = await import('../src/api/sha256.js');
const { wireHelm } = await import('../src/api/wire.js');
const { prep } = await import('../src/boot/module.js');
const { default: NodeScreen } = await import('../src/screens/node.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const opOf = (url) => decodeURIComponent((/\/operations\/([^/]+)\/invoke$/.exec(url) || [])[1] || '');
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url, op: opOf(url), body: init.body ? JSON.parse(init.body) : null }); return answer(calls.at(-1), calls); };
  f.calls = calls;
  return f;
}
const ops = (f, op) => f.calls.filter((c) => c.op === 'io.terra.file.' + op);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
LiveSource.PROBE_MS = 5;   // 다른 화면이 보내는 중인지 다시 볼 때 기다리는 시간

/** parts.js 와 같은 약속 — key → { sha, size, tid } · [key, offset] → 조각. 0부터 빈틈없이 이어진 조각만 돌려준다 */
function memParts() {
  const meta = new Map(), rows = new Map();
  return {
    meta, rows,
    async open(key, want) {
      const m = meta.get(key), chunks = [];
      let offset = 0;
      if (m && m.sha === want.sha && m.size === want.size) {
        for (const [o, b] of [...(rows.get(key) || new Map())].sort((a, z) => a[0] - z[0])) { if (o !== offset) break; chunks.push(b); offset += b.length; }
      } else if (m) rows.delete(key);
      meta.set(key, { sha: want.sha, size: want.size, tid: want.tid });
      return { offset, chunks, tid: m ? m.tid : null };
    },
    async add(key, offset, bytes) { if (!rows.has(key)) rows.set(key, new Map()); rows.get(key).set(offset, bytes); return true; },
    async drop(key) { meta.delete(key); rows.delete(key); }
  };
}

test('멈춘 전송 — 이 화면이 하지 않고, 기한이 지났거나 STALL_MS 넘게 움직이지 않은 prepared · transferring 만 멈춤(이어서 · 중단)으로', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  const rec = (id, o) => Object.assign({ transfer_id: id, direction: 'push', root: 'share-0', path: 'a/' + id + '.bin', size_bytes: 1000, checksum_sha256: 'ab', offset: 400, state: 'transferring', updated_at: iso(now - 5000), expires_at: iso(now + 3600e3) }, o);
  const items = ADAPT.xfer({ transfers: [
    rec('fresh'), rec('old', { updated_at: iso(now - STALL_MS - 1) }), rec('expired', { expires_at: iso(now - 1) }), rec('mine', { updated_at: iso(now - 600e3) }),
    rec('pull', { direction: 'pull', updated_at: iso(now - 600e3) }), rec('paused', { state: 'aborted' }), rec('prep', { state: 'prepared', offset: 0, updated_at: iso(now - 600e3) })
  ] });
  assert.deepEqual([items[0].root, items[0].path, items[0].bytes, items[0].sha, items[0].at], ['share-0', 'a/fresh.bin', 1000, 'ab', now - 5000], '이을 때 쓸 것을 싣는다');
  const out = Object.fromEntries(markStalled(items, new Set(['mine']), now).map((d) => [d.id, d]));
  assert.equal(out.fresh.state, 'transferring', '움직이는 중');
  assert.equal(out.mine.state, 'transferring', '이 화면이 보내는 중');
  assert.deepEqual([out.old.state, out.expired.state, out.prep.state], ['stalled', 'stalled', 'stalled']);
  assert.match(out.old.reason, /40%에서 보내던 화면이 닫혔다/);
  assert.match(out.pull.reason, /받던 화면이 닫혔다 — 이어서: 이 브라우저에 받아 둔 만큼은 건너뛴다/);
  assert.equal(out.paused.state, 'aborted', '중단한 것은 그대로 중단됨');
  assert.match(out.paused.reason, /중단 · 40% 남겨 둠 — 같은 파일을 다시 올리면 거기서부터/);
  // 이 화면이 지켜본다 — 서버 시계가 어긋나 updated_at 이 늘 새로워 보여도, SEEN_MS 동안 offset 이 그대로면 멈춘 것이다
  const seen = new Map(), skew = (o) => ADAPT.xfer({ transfers: [rec('slow', Object.assign({ updated_at: iso(now + 3600e3) }, o))] });
  assert.equal(markStalled(skew(), null, now, seen)[0].state, 'transferring', '처음 본다');
  assert.equal(markStalled(skew(), null, now + SEEN_MS - 1, seen)[0].state, 'transferring');
  assert.equal(markStalled(skew(), null, now + SEEN_MS, seen)[0].state, 'stalled', '그대로다 — 멈췄다');
  assert.equal(markStalled(skew({ offset: 500 }), null, now + SEEN_MS + 1, seen)[0].state, 'transferring', '움직였다 — 다시 지켜본다');
  markStalled([], null, now, seen);
  assert.equal(seen.size, 0, '목록에서 사라진 것은 잊는다');
});

/** 올리기 서버 — 0~3바이트를 받은 채 멈춘 전송(tr-old)이 있다. FILE_TARGET_EXISTS 는 그 부분 파일 때문이다 */
function pushServer(data, sha, o = {}) {
  let next = 3;
  return fakeFetch((c) => {
    if (c.op === 'io.terra.file.transfers.create') {
      if (c.body.resume_id) return json(202, { status: 'accepted', data: { transfer: { transfer_id: c.body.resume_id, root: c.body.root, path: c.body.path, size_bytes: data.length, checksum_sha256: sha, chunk_size: 4, offset: next, state: 'prepared' } } });
      return json(409, { error: { code: 'FILE_TARGET_EXISTS', message: 'the target already exists' } });
    }
    if (c.op === 'io.terra.file.transfers.list') return json(200, { transfers: o.list || [] });
    if (c.op === 'io.terra.file.transfers.chunks.put') {
      if (o.expireAt === c.body.offset && !o.expired) { o.expired = true; next = c.body.offset; return json(409, { error: { code: 'TRANSFER_EXPIRED' } }); }
      if (o.stopped) return json(409, { error: { code: 'TRANSFER_WRONG_STATE' } });
      next = c.body.offset + atob(c.body.data).length;
      return json(200, { next_offset: next, size_bytes: data.length });
    }
    if (c.op === 'io.terra.file.transfers.complete') return json(200, { transfer_id: c.body.transfer_id, bytes: data.length, checksum_sha256: sha, verified: true });
    return json(404, {});
  });
}

test('올리기 — 같은 자리에 같은 파일을 보내다 멈춘 전송이 있으면 새로 만들지 않고 그 전송을 다시 연다(resume_id · 서버가 받은 곳부터)', async () => {
  const data = 'hello terra', sha = await sha256Blob(new Blob([data])), file = new File([data], 'hi.txt');
  const now = Date.now();
  const stalled = { transfer_id: 'tr-old', direction: 'push', root: 'share-0', path: 'hi.txt', size_bytes: data.length, checksum_sha256: sha, mode: 'create', offset: 3, state: 'transferring', updated_at: iso(now - 600e3), expires_at: iso(now + 600e3) };
  const f = pushServer(data, sha, { list: [stalled] });
  const seen = [];
  const r = await new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a' }).upload('leaf-a', file, '', (off) => seen.push(off));
  assert.deepEqual([r.kind, r.from], ['ok', 3]);
  assert.deepEqual(f.calls.map((c) => c.op.replace('io.terra.file.', '')).slice(0, 3), ['transfers.create', 'transfers.list', 'transfers.create']);
  assert.deepEqual(ops(f, 'transfers.create')[1].body, { direction: 'push', root: 'share-0', path: 'hi.txt', size_bytes: data.length, checksum_sha256: sha, mode: 'create', resume_id: 'tr-old' });
  assert.deepEqual(ops(f, 'transfers.chunks.put').map((c) => c.body.offset), [3, 7], '서버가 받은 곳(3)부터');
  assert.deepEqual(seen, [3, 7, 11]);
  // 부분 남김으로 중단한 것도 잇는다
  const g = pushServer(data, sha, { list: [Object.assign({}, stalled, { state: 'aborted', updated_at: iso(now) })] });
  assert.equal((await new LiveSource(new TerraClient('', { fetch: g }), { localNode: 'leaf-a' }).upload('leaf-a', file, '')).from, 3);
});

test('올리기 — 이을 수 없으면 까닭을 말하고 보내지 않는다: 다른 화면이 보내는 중 · 같은 이름의 다른 파일 · 그런 전송이 없다', async () => {
  const data = 'hello terra', sha = await sha256Blob(new Blob([data])), file = new File([data], 'hi.txt'), now = Date.now();
  const rec = (o) => Object.assign({ transfer_id: 'tr-x', direction: 'push', root: 'share-0', path: 'hi.txt', size_bytes: data.length, checksum_sha256: sha, offset: 3, state: 'transferring', updated_at: iso(now - 1000), expires_at: iso(now + 600e3) }, o);
  const up = async (list) => { const f = pushServer(data, sha, { list }); const r = await new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a' }).upload('leaf-a', file, ''); return [r.kind, r.reason, ops(f, 'transfers.chunks.put').length]; };
  assert.deepEqual(await up([rec()]), ['unavailable', 'xfer-busy', 0], '움직이는 중');
  assert.deepEqual(await up([rec({ checksum_sha256: 'f'.repeat(64), updated_at: iso(now - 600e3) })]), ['unavailable', 'xfer-other', 0], '같은 이름의 다른 파일');
  assert.deepEqual(await up([rec({ path: 'other.txt', updated_at: iso(now - 600e3) })]), ['error', 'FILE_TARGET_EXISTS', 0], '그 자리의 전송이 없다 — 진짜로 있는 파일');
});

test('올리기 — 방금까지 움직인 것은 잠깐 기다려 다시 본다: offset 이 그대로면 보내던 화면이 닫힌 것이다(닫고 곧바로 다시 올릴 때)', async () => {
  const data = 'hello terra', sha = await sha256Blob(new Blob([data])), file = new File([data], 'hi.txt'), now = Date.now();
  const rec = { transfer_id: 'tr-just', direction: 'push', root: 'share-0', path: 'hi.txt', size_bytes: data.length, checksum_sha256: sha, offset: 3, state: 'transferring', updated_at: iso(now - 500), expires_at: iso(now + 600e3) };
  const run = async (later) => {
    const base = pushServer(data, sha, { list: [rec] });
    const f = fakeFetch((c) => (c.op === 'io.terra.file.transfers.get' ? json(200, { transfer: Object.assign({}, rec, later) }) : base(c.url, { body: c.body ? JSON.stringify(c.body) : undefined })));
    const r = await new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'n' }).upload('n', file, '');
    return [r.kind, r.reason || r.from, ops(f, 'transfers.get').length];
  };
  assert.deepEqual(await run({}), ['ok', 3, 1], '그대로다 — 이어서');
  assert.deepEqual(await run({ offset: 7 }), ['unavailable', 'xfer-busy', 1], '움직였다 — 다른 화면이 보내는 중');
});

test('올리기 — 카드의 이어서: 고른 파일이 그 전송의 것(크기 · SHA-256)이어야 다시 연다 · 기한이 지나면 다시 열고 · 중단되면 멈춘다', async () => {
  const data = 'hello terra', sha = await sha256Blob(new Blob([data])), file = new File([data], 'renamed.txt');
  const item = { id: 'tr-old', dir: 'push', root: 'share-1', path: 'docs/hi.txt', bytes: data.length, sha, mode: 'create', off: 0.27 };
  const no = pushServer(data, sha);
  const bad = await new LiveSource(new TerraClient('', { fetch: no }), { localNode: 'n' }).upload('n', new File(['other'], 'x.txt'), '', null, { resume: item });
  assert.deepEqual([bad.kind, bad.reason, no.calls.length], ['unavailable', 'xfer-differs', 0], '다른 파일 — 부르지 않는다');
  const f = pushServer(data, sha, { expireAt: 7 });
  const r = await new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'n' }).upload('n', file, '', null, { resume: item });
  assert.deepEqual([r.kind, r.from], ['ok', 3]);
  const creates = ops(f, 'transfers.create').map((c) => c.body);
  assert.deepEqual(creates[0], { direction: 'push', root: 'share-1', path: 'docs/hi.txt', size_bytes: data.length, checksum_sha256: sha, mode: 'create', resume_id: 'tr-old' }, '이름이 달라도 그 전송의 자리로');
  assert.equal(creates.length, 2, '기한이 지나 같은 전송을 한 번 더 열었다');
  assert.equal(creates[1].resume_id, 'tr-old');
  assert.deepEqual(ops(f, 'transfers.chunks.put').map((c) => c.body.offset), [3, 7, 7]);
  // 다른 곳에서 중단했다 — 한 번에 멈춘다
  const s = pushServer(data, sha, { stopped: true });
  const st = await new LiveSource(new TerraClient('', { fetch: s }), { localNode: 'n' }).upload('n', file, '', null, { resume: item });
  assert.deepEqual([st.kind, st.reason, ops(s, 'transfers.chunks.put').length], ['error', 'TRANSFER_WRONG_STATE', 1]);
});

/** 받기 서버 — 받을 때마다 새 전송 id(p1, p2 … · prefix 를 주면 그 글자로). cut — 그 offset 에서 끊긴다(네트워크) */
function pullServer(body, o = {}) {
  let n = 0;
  const sum = o.sum;
  return fakeFetch((c) => {
    if (c.op === 'io.terra.file.transfers.pulls.create') {
      if (c.body.resume_id) return json(202, { transfer: { transfer_id: c.body.resume_id, direction: 'pull', size_bytes: body.length, checksum_sha256: sum, chunk_size: 4, state: 'prepared' } });
      return json(202, { transfer: { transfer_id: (o.prefix || 'p') + (++n), direction: 'pull', root: c.body.root, path: c.body.path, size_bytes: body.length, checksum_sha256: sum, chunk_size: 4, offset: 0, state: 'prepared' } });
    }
    if (c.op === 'io.terra.file.transfers.chunks.get') {
      if (o.cut === c.body.offset) { o.cut = null; return json(502, { error: { code: 'UPSTREAM_UNREACHABLE' } }); }
      if (o.expireAt === c.body.offset) { o.expireAt = null; return json(409, { error: { code: 'TRANSFER_EXPIRED' } }); }
      const b = new TextEncoder().encode(body.slice(c.body.offset, c.body.offset + 4));
      return json(200, { offset: c.body.offset, data: toB64(b), sha256: new Sha256().update(b).hex(), eof: c.body.offset + 4 >= body.length });
    }
    if (c.op === 'io.terra.file.transfers.pulls.complete') return json(200, { transfer_id: c.body.transfer_id, bytes: body.length, checksum_sha256: sum, verified: true });
    if (c.op === 'io.terra.file.transfers.pulls.abort') return json(200, { transfer_id: c.body.transfer_id, state: 'aborted', kept_partial: false });
    return json(404, {});
  });
}

test('받기 — 받은 조각을 이 브라우저에 두고, 다시 받으면 SHA-256 · 크기가 같을 때 둔 곳부터 잇는다. 앞선 전송은 닫고, 다 받으면 지운다', async () => {
  const body = 'hello terra, again', sum = await sha256Blob(new Blob([body])), parts = memParts();
  const key = 'node_a|share-0/docs/hi.txt';
  // 처음 — 8바이트에서 끊긴다
  const f1 = pullServer(body, { sum, cut: 8 });
  const s1 = new LiveSource(new TerraClient('', { fetch: f1 }), { localNode: 'leaf-a', localId: 'node_a', parts });
  const r1 = await s1.download('leaf-a', 'share-0/docs/hi.txt');
  assert.equal(r1.kind, 'error');
  assert.deepEqual([...parts.rows.get(key).keys()], [0, 4], '받은 조각은 남는다');
  assert.equal(ops(f1, 'transfers.pulls.abort').at(-1).body.transfer_id, 'p1', '그 받기는 닫는다');
  // 다시 — 새로 열고(p1 이 아니라 새 전송), 8 부터. 앞선 전송 id 를 닫는다(여기서는 이미 닫혔지만 페이지를 닫았다면 남아 있다)
  const f2 = pullServer(body, { sum, prefix: 'q' });
  const seen = [];
  const r2 = await new LiveSource(new TerraClient('', { fetch: f2 }), { localNode: 'leaf-a', localId: 'node_a', parts }).download('leaf-a', 'share-0/docs/hi.txt', (off) => seen.push(off), { old: 'p-card' });
  assert.deepEqual([r2.kind, r2.from, await r2.blob.text()], ['ok', 8, body]);
  assert.deepEqual(ops(f2, 'transfers.chunks.get').map((c) => c.body.offset), [8, 12, 16], '받아 둔 8바이트는 건너뛴다');
  assert.deepEqual(seen, [8, 12, 16, 18]);
  assert.deepEqual(ops(f2, 'transfers.pulls.abort').map((c) => c.body.transfer_id).sort(), ['p-card', 'p1'], '카드의 전송 · 이 브라우저에 적어 둔 전송을 닫는다');
  assert.equal(parts.meta.has(key), false, '다 받았으면 지운다');
});

test('받기 — 그 사이 파일이 바뀌었으면(SHA-256 이 다르다) 둔 것을 버리고 처음부터 · 전체가 어긋나면 둔 것도 버린다 · 기한이 지나면 같은 받기를 다시 연다', async () => {
  const body = 'hello terra, again', sum = await sha256Blob(new Blob([body])), parts = memParts(), key = 'node_a|share-0/hi.txt';
  await parts.open(key, { sha: 'old-sum', size: body.length, tid: 'p0' });
  await parts.add(key, 0, new TextEncoder().encode('HELL'));
  const f = pullServer(body, { sum, expireAt: 8 });
  const r = await new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a', localId: 'node_a', parts }).download('leaf-a', 'share-0/hi.txt');
  assert.deepEqual([r.kind, r.from, await r.blob.text()], ['ok', undefined, body], '처음부터 — 예전 조각(HELL)을 쓰지 않는다');
  assert.deepEqual(ops(f, 'transfers.chunks.get').map((c) => c.body.offset), [0, 4, 8, 8, 12, 16]);
  assert.deepEqual(ops(f, 'transfers.pulls.create').map((c) => c.body.resume_id || null), [null, 'p1'], '기한이 지나 같은 받기(p1)를 다시 열었다');
  // 전체 검사가 어긋난다 — 저장하지 않고, 둔 것도 버린다
  const g = pullServer(body, { sum: 'f'.repeat(64) });
  const bad = await new LiveSource(new TerraClient('', { fetch: g }), { localNode: 'leaf-a', localId: 'node_a', parts }).download('leaf-a', 'share-0/hi.txt');
  assert.deepEqual([bad.kind, bad.reason, parts.meta.has(key)], ['error', 'checksum', false]);
  // 둘 곳이 없으면(IndexedDB 없음) 예전처럼 메모리로만
  const h = pullServer(body, { sum });
  const plain = await new LiveSource(new TerraClient('', { fetch: h }), { localNode: 'leaf-a' }).download('leaf-a', 'share-0/hi.txt');
  assert.deepEqual([plain.kind, await plain.blob.text()], ['ok', body]);
});

test('전송 앱 카드의 이어서 — 받기는 다시 받되 멈춘 전송을 닫는다 · 올리기는 파일을 고르게 해 그 전송을 잇는다. act 로 부르면 이유만', async () => {
  const body = 'hello terra, again', sum = await sha256Blob(new Blob([body])), now = Date.now();
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'file.read', 'file.write'];
  const local = s.state.localNode.name;
  const recs = [
    { transfer_id: 'p-old', direction: 'pull', root: 'share-0', path: 'docs/hi.txt', size_bytes: body.length, checksum_sha256: sum, offset: 4, state: 'transferring', updated_at: iso(now - 600e3), expires_at: iso(now + 600e3) },
    { transfer_id: 'tr-old', direction: 'push', root: 'share-0', path: 'up/hi.txt', size_bytes: body.length, checksum_sha256: sum, offset: 3, state: 'transferring', updated_at: iso(now - 600e3), expires_at: iso(now + 600e3) }
  ];
  const pull = pullServer(body, { sum }), push = pushServer(body, sum);
  const f = fakeFetch((c) => {
    if (c.op === 'io.terra.file.transfers.list') return json(200, { transfers: recs });
    return (/pulls|chunks\.get/.test(c.op) ? pull : push)(c.url, { body: c.body ? JSON.stringify(c.body) : undefined });
  });
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: local, localId: 'node_a', parts: memParts() });
  const said = [];
  const say = s.hbSay.bind(s);
  s.hbSay = (t, c) => { said.push(t); say(t, c); };
  const picked = new File([body], 'hi.txt'), saved = [];
  const prev = globalThis.document;
  globalThis.document = {
    body: { appendChild() {} },
    createElement: (tag) => {
      if (tag === 'input') { const inp = { files: [picked], click() { setTimeout(() => inp.onchange(), 0); } }; return inp; }
      return { style: {}, click() { saved.push(this.download); }, remove() {} };
    }
  };
  try {
    const unwire = wireHelm(s, source, { pollMs: 60000 });
    s.hbPut(local, 'xfer', await source.list(local, 'xfer'));
    assert.deepEqual(s.hbItems(local, 'xfer').map((d) => d.state), ['stalled', 'stalled'], '둘 다 멈췄다 — 이어서 · 중단');
    assert.deepEqual(await source.act(local, 'xfer', 'p-old', 'resume', s.hbItems(local, 'xfer')[0]), { kind: 'unavailable', reason: 'no-upload' });
    assert.equal(source.lockFor('xfer', 'resume', local), null, '잠그지 않는다');
    await s.hbAct('xfer', 'p-old', 'resume', local);
    await sleep(20);
    assert.ok(f.calls.some((c) => c.op === 'io.terra.file.transfers.pulls.abort' && c.body.transfer_id === 'p-old'), '멈춘 받기를 닫았다');
    assert.ok(said.some((t) => /↓ hi\.txt 받음 — 검사 통과/.test(t)), said.join(' | '));
    assert.deepEqual(saved, ['hi.txt'], '브라우저로 저장했다');
    await s.hbAct('xfer', 'tr-old', 'resume', local);
    await sleep(40);
    const resumed = f.calls.find((c) => c.op === 'io.terra.file.transfers.create' && c.body.resume_id);
    assert.deepEqual([resumed && resumed.body.root, resumed && resumed.body.path], ['share-0', 'up/hi.txt']);
    assert.ok(said.some((t) => /↑ hi\.txt 올림 — 검사 통과 \(share-0\/up\/hi\.txt · 16%부터 이어서\)/.test(t)), said.join(' | '));
    unwire();
  } finally { globalThis.document = prev; }
});

test('중단 · 치우기 — 중단은 부분을 남기고(이어서 올릴 수 있다), 치우기는 남겨 둔 것을 버린다. 노드마다 따로 지켜본다', async () => {
  const f = fakeFetch((c) => json(200, { transfer_id: c.body && c.body.transfer_id, state: 'aborted', kept_partial: !!(c.body && c.body.keep_partial) }));
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a' });
  await source.act('leaf-a', 'xfer', 'tr-1', 'abort', { id: 'tr-1', dir: 'push', name: 'a.bin', state: 'transferring' });
  const c = await source.act('leaf-a', 'xfer', 'tr-1', 'clear', { id: 'tr-1', dir: 'push', name: 'a.bin', state: 'aborted' });
  assert.deepEqual(f.calls.map((x) => [x.op, x.body]), [
    ['io.terra.file.transfers.abort', { transfer_id: 'tr-1', keep_partial: true }],
    ['io.terra.file.transfers.abort', { transfer_id: 'tr-1', keep_partial: false }]
  ]);
  assert.equal(c.say, 'a.bin 치움 — 남겨 둔 부분 파일도 지웠다');
  assert.equal((await source.act('leaf-a', 'xfer', 'p-1', 'clear', { id: 'p-1', dir: 'pull', name: 'b.bin', state: 'aborted' })).say, 'b.bin 치움');
  // 두 노드의 전송 목록을 번갈아 받아도 서로의 지켜봄을 지우지 않는다
  const now = Date.now();
  const lists = { 'leaf-a': [{ transfer_id: 'ta', direction: 'push', size_bytes: 10, offset: 4, state: 'transferring', updated_at: iso(now + 3600e3) }], 'leaf-b': [{ transfer_id: 'tb', direction: 'push', size_bytes: 10, offset: 4, state: 'transferring', updated_at: iso(now + 3600e3) }] };
  const g = fakeFetch((x) => json(200, { transfers: lists[x.url.includes('/nodes/node_b/') ? 'leaf-b' : 'leaf-a'] }));
  const two = new LiveSource(new TerraClient('', { fetch: g }), { localNode: 'leaf-a', localId: 'node_a', idOf: (n) => (n === 'leaf-b' ? 'node_b' : null) });
  two.client.invokeModuleAt = async (id, op) => { const r = await g('/api/nodes/' + id + '/modules/x', {}); return { kind: 'ok', data: await r.json() }; };
  await two.list('leaf-a', 'xfer'); await two.list('leaf-b', 'xfer');
  assert.deepEqual([...two.seen.keys()].sort(), ['leaf-a', 'leaf-b']);
  assert.deepEqual([[...two.seen.get('leaf-a').keys()], [...two.seen.get('leaf-b').keys()]], [['ta'], ['tb']]);
});
