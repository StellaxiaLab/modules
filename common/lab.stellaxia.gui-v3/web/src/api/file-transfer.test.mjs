// node --test — 파일 전송(lab.stellaxia.file transfers.*): 청크 순서 · offset · 재개 · 취소 · 거절 뒤 다시 · stall · 미리보기 읽기
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFileTransfer, chunkPlan, previewKind, looksBinary, decodeText, rateOf, b64, unb64, sha256Hex, PREVIEW, BROWSER_MAX } from './file-transfer.js';

const hex = (b) => createHash('sha256').update(b).digest('hex');
const bytes = (n) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 7) % 251; return u; };
const blob = (u, name = 'a.bin') => ({ name, size: u.length, arrayBuffer: async () => u.buffer.slice(u.byteOffset, u.byteOffset + u.length) });
const err = (code, extra) => Object.assign(new Error(code), { code }, extra || {});

/** 가짜 lab.stellaxia.file — 노드 쪽 파일 · 전송 기록. calls 에 (op, 입력 요약) */
function fakeNode(o = {}) {
  const files = new Map(Object.entries(o.files || {})), tx = new Map(), calls = []; let n = 0;
  const chunk = o.chunk || 4;
  const invoke = async (op, i) => {
    calls.push([op.replace('lab.stellaxia.file.', ''), i.offset ?? '', i.resume_id || '']);
    if (o.hook) { const r = await o.hook(op, i, { tx, files }); if (r !== undefined) return r; }
    if (op.endsWith('transfers.create')) {
      if (i.resume_id && tx.has(i.resume_id)) { const t = tx.get(i.resume_id); return { transfer: { transfer_id: t.id, chunk_size: chunk, offset: t.off, state: 'transferring' } }; }
      const id = 'tr-' + (++n); tx.set(id, { id, dir: 'push', path: i.path, size: i.size_bytes, sum: i.checksum_sha256, buf: new Uint8Array(i.size_bytes), off: 0 }); return { transfer: { transfer_id: id, chunk_size: chunk, offset: 0, state: 'prepared' } };
    }
    if (op.endsWith('transfers.pulls.create')) {
      if (!files.has(i.path)) throw err('FILE_NOT_FOUND');
      const f = files.get(i.path), id = 'tr-' + (++n); tx.set(id, { id, dir: 'pull', f }); return { transfer: { transfer_id: id, chunk_size: chunk, size_bytes: f.length, checksum_sha256: hex(f), offset: 0 } };
    }
    const t = tx.get(i.transfer_id);
    if (op.endsWith('chunks.put')) {
      if (i.offset !== t.off) throw err('CHUNK_OUT_OF_ORDER', { details: { retry_offset: t.off } });
      const d = unb64(i.data); if (hex(d) !== i.sha256) throw err('CHUNK_CHECKSUM_MISMATCH');
      t.buf.set(d, t.off); t.off += d.length; return { next_offset: t.off, size_bytes: t.size };
    }
    if (op.endsWith('transfers.get')) return { transfer: { transfer_id: t.id, offset: t.off } };
    if (op.endsWith('transfers.complete')) { const ok = hex(t.buf) === t.sum; if (ok) files.set(t.path, t.buf); return { transfer_id: t.id, bytes: t.off, verified: ok }; }
    if (op.endsWith('chunks.get')) { const d = t.f.subarray(i.offset, i.offset + chunk); return { offset: i.offset, data: b64(d), sha256: hex(d), eof: i.offset + d.length >= t.f.length }; }
    if (op.endsWith('abort')) { t.aborted = i.reason; return { transfer_id: t.id, state: 'aborted' }; }
    if (op.endsWith('pulls.complete')) return { transfer_id: t.id, bytes: t.f.length, verified: true };
    if (op.endsWith('entries.read')) { const f = files.get(i.path); const d = f.subarray(i.offset, i.offset + i.length); return { offset: i.offset, length: d.length, data: b64(d), sha256: hex(d), eof: i.offset + d.length >= f.length, size: f.length }; }
    throw err('FILE_OPERATION_NOT_FOUND');
  };
  return { invoke, calls, files, tx };
}

test('chunkPlan — chunk 크기로 나누고 시작 offset 부터', () => {
  assert.deepEqual(chunkPlan(10, 4), [{ offset: 0, length: 4 }, { offset: 4, length: 4 }, { offset: 8, length: 2 }]);
  assert.deepEqual(chunkPlan(10, 4, 8), [{ offset: 8, length: 2 }]);
  assert.deepEqual(chunkPlan(10, 0), []);
});

test('sha256Hex · b64 — node 의 것과 같다', async () => {
  const u = bytes(1000); assert.equal(await sha256Hex(u), hex(u)); assert.deepEqual(unb64(b64(u)), u);
});

test('올리기 — create(push · 크기 · 체크섬) → chunks.put 을 응답의 chunk_size 로 offset 순서대로 → complete', async () => {
  const N = fakeNode({ chunk: 4 }), F = createFileTransfer({ invoke: N.invoke }), u = bytes(10), seen = [];
  const j = F.upload({ root: 'share-0', path: 'up/a.bin', file: blob(u), onChange: (x) => seen.push(x.state + ':' + x.done) });
  await j.promise;
  assert.equal(j.state, 'done', JSON.stringify(j.err));
  assert.deepEqual(N.calls.map((c) => c[0] + '@' + c[1]), ['transfers.create@', 'transfers.chunks.put@0', 'transfers.chunks.put@4', 'transfers.chunks.put@8', 'transfers.complete@']);
  assert.deepEqual(N.files.get('up/a.bin'), u);
  assert.ok(seen.includes('run:4') && seen.includes('verify:10') && seen.at(-1) === 'done:10');
});

test('올리기 — 거절(CHUNK_OUT_OF_ORDER)이면 retry_offset 부터, 없으면 transfers.get 의 offset 부터', async () => {
  let once = true;
  const N = fakeNode({ chunk: 4, hook: (op, i, S) => { if (op.endsWith('chunks.put') && i.offset === 4 && once) { once = false; const t = S.tx.get(i.transfer_id); throw err('CHUNK_OUT_OF_ORDER'); } } });
  const j = createFileTransfer({ invoke: N.invoke }).upload({ root: 'share-0', path: 'b.bin', file: blob(bytes(10)) }); await j.promise;
  assert.equal(j.state, 'done');
  assert.deepEqual(N.calls.map((c) => c[0] + '@' + c[1]), ['transfers.create@', 'transfers.chunks.put@0', 'transfers.chunks.put@4', 'transfers.get@', 'transfers.chunks.put@4', 'transfers.chunks.put@8', 'transfers.complete@']);
});

test('올리기 — 끊겨 실패하면 전송을 지우지 않고, 다시는 resume_id 로 응답의 offset(재개 지점)부터', async () => {
  let cut = true;
  const N = fakeNode({ chunk: 4, hook: (op, i) => { if (op.endsWith('chunks.put') && i.offset === 8 && cut) { cut = false; throw err('NETWORK'); } } });
  const j = createFileTransfer({ invoke: N.invoke }).upload({ root: 'share-0', path: 'c.bin', file: blob(bytes(10)) }); await j.promise;
  assert.equal(j.state, 'fail'); assert.equal(j.err.code, 'NETWORK'); assert.equal(j.done, 8); assert.ok(j.tid);
  assert.ok(!N.calls.some((c) => c[0].endsWith('abort')), '실패는 abort 하지 않는다');
  N.calls.length = 0; await j.retry();
  assert.equal(j.state, 'done');
  assert.deepEqual(N.calls.map((c) => c[0] + '@' + c[1] + (c[2] ? '#' + c[2] : '')), ['transfers.create@#tr-1', 'transfers.chunks.put@8', 'transfers.complete@']);
  assert.equal(j.resumed, true);
});

test('올리기 — 취소는 지금 청크 뒤에 멈추고 abort(cancelled), 다시는 새 전송', async () => {
  let F, j, once = true; const N = fakeNode({ chunk: 4, hook: (op, i) => { if (op.endsWith('chunks.put') && i.offset === 4 && once) { once = false; j.cancel(); } } });
  F = createFileTransfer({ invoke: N.invoke }); j = F.upload({ root: 'share-0', path: 'd.bin', file: blob(bytes(10)) }); await j.promise;
  assert.equal(j.state, 'cancel');
  assert.deepEqual(N.calls.map((c) => c[0] + '@' + c[1]), ['transfers.create@', 'transfers.chunks.put@0', 'transfers.chunks.put@4', 'transfers.abort@']);
  assert.equal(N.tx.get('tr-1').aborted, 'cancelled');
  N.calls.length = 0; await j.retry(); assert.equal(j.state, 'done'); assert.equal(N.calls[0][2], '', '취소 뒤 다시는 resume 하지 않는다');
});

test('올리기 — 받았다면서 나아가지 않으면 TRANSFER_STALLED · abort', async () => {
  const N = fakeNode({ chunk: 4, hook: (op, i) => (op.endsWith('chunks.put') && i.offset === 4 ? { next_offset: 4 } : undefined) });
  const j = createFileTransfer({ invoke: N.invoke }).upload({ root: 'share-0', path: 'e.bin', file: blob(bytes(10)) }); await j.promise;
  assert.equal(j.state, 'fail'); assert.equal(j.err.code, 'TRANSFER_STALLED'); assert.ok(N.calls.some((c) => c[0] === 'transfers.abort'));
});

test('올리기 — 모듈이 없으면 Gateway 의 코드를 그대로', async () => {
  const j = createFileTransfer({ invoke: async () => { throw err('MODULE_ROUTE_NOT_FOUND'); } }).upload({ root: 'share-0', path: 'x', file: blob(bytes(3)) }); await j.promise;
  assert.equal(j.state, 'fail'); assert.equal(j.err.code, 'MODULE_ROUTE_NOT_FOUND');
});

test('올리기 — 브라우저 상한을 넘으면 부르지도 않는다', async () => {
  let called = 0; const j = createFileTransfer({ invoke: async () => { called++; } }).upload({ root: 's', path: 'big', file: { name: 'big', size: BROWSER_MAX + 1, arrayBuffer: async () => { throw new Error('읽으면 안 됨'); } } }); await j.promise;
  assert.equal(j.state, 'fail'); assert.equal(j.err.code, 'TOO_LARGE_FOR_BROWSER'); assert.equal(called, 0);
});

test('내려받기 — pulls.create(file.read) → chunks.get 을 offset 순서로 eof 까지 → 전체 체크섬 → pulls.complete · Blob', async () => {
  const f = bytes(10), N = fakeNode({ chunk: 4, files: { 'r.bin': f } });
  const j = createFileTransfer({ invoke: N.invoke }).download({ root: 'share-0', path: 'r.bin' }); await j.promise;
  assert.equal(j.state, 'done', JSON.stringify(j.err));
  assert.deepEqual(N.calls.map((c) => c[0] + '@' + c[1]), ['transfers.pulls.create@', 'transfers.chunks.get@0', 'transfers.chunks.get@4', 'transfers.chunks.get@8', 'transfers.pulls.complete@']);
  assert.deepEqual(new Uint8Array(await j.blob.arrayBuffer()), f);
});

test('내려받기 — 빈 청크인데 eof 가 아니면 TRANSFER_STALLED(멈추고 abort) — 무한히 돌지 않는다', async () => {
  const N = fakeNode({ chunk: 4, files: { 's.bin': bytes(10) }, hook: (op, i) => (op.endsWith('chunks.get') && i.offset === 4 ? { offset: 4, data: '', sha256: hex(new Uint8Array(0)), eof: false } : undefined) });
  const j = createFileTransfer({ invoke: N.invoke }).download({ root: 'share-0', path: 's.bin' }); await j.promise;
  assert.equal(j.state, 'fail'); assert.equal(j.err.code, 'TRANSFER_STALLED'); assert.ok(N.calls.some((c) => c[0] === 'transfers.pulls.abort'));
});

test('내려받기 — 끊겼다 다시는 받은 데까지 두고 그 뒤 offset 부터(resume_id)', async () => {
  let cut = true; const f = bytes(10);
  const N = fakeNode({ chunk: 4, files: { 't.bin': f }, hook: (op, i) => { if (op.endsWith('chunks.get') && i.offset === 8 && cut) { cut = false; throw err('TIMEOUT'); } } });
  const j = createFileTransfer({ invoke: N.invoke }).download({ root: 'share-0', path: 't.bin' }); await j.promise;
  assert.equal(j.state, 'fail'); assert.equal(j.done, 8);
  N.calls.length = 0; await j.retry();
  assert.equal(j.state, 'done'); assert.deepEqual(N.calls.map((c) => c[0] + '@' + c[1] + (c[2] ? '#' + c[2] : '')), ['transfers.pulls.create@#tr-1', 'transfers.chunks.get@8', 'transfers.pulls.complete@']);
  assert.deepEqual(new Uint8Array(await j.blob.arrayBuffer()), f);
});

test('미리보기 읽기 — entries.read 를 앞에서부터 상한까지, 잘렸으면 cut', async () => {
  const f = bytes(PREVIEW.piece + 100), N = fakeNode({ files: { 'big.txt': f } }), F = createFileTransfer({ invoke: N.invoke });
  const a = await F.readHead({ root: 'share-0', path: 'big.txt', max: PREVIEW.text });
  assert.equal(a.bytes.length, PREVIEW.text); assert.equal(a.cut, true); assert.equal(a.size, f.length);
  const b = await F.readHead({ root: 'share-0', path: 'big.txt', max: PREVIEW.image });
  assert.equal(b.bytes.length, f.length); assert.equal(b.cut, false); assert.deepEqual(N.calls.filter((c) => c[0] === 'entries.read').map((c) => c[1]), [0, 0, PREVIEW.piece]);
});

test('previewKind · looksBinary · decodeText · rateOf', () => {
  assert.equal(previewKind('a.md', 10).kind, 'text'); assert.equal(previewKind('log.txt', 10 * 2 ** 20).part, true);
  assert.equal(previewKind('p.png', 1000).kind, 'image'); assert.equal(previewKind('p.png', PREVIEW.image + 1).kind, 'other');
  assert.equal(previewKind('x.tar', 1).kind, 'other');
  assert.equal(looksBinary(new Uint8Array([104, 0, 105])), true); assert.equal(looksBinary(new TextEncoder().encode('안녕\n')), false);
  assert.equal(decodeText(new TextEncoder().encode('안녕').subarray(0, 4)), '안');   // 잘린 마지막 글자는 버린다
  assert.equal(rateOf([{ t: 0, bytes: 0 }, { t: 1000, bytes: 2048 }], 1000), 2048); assert.equal(rateOf([{ t: 0, bytes: 0 }], 10), 0);
});
