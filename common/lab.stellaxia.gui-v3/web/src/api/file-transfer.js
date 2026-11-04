// 파일 내용 · 전송 — 공유 폴더(io.terra.file)에서 내용 열기(미리보기) · 올리기 · 내려받기. 제어기(NodeDesktopEmbed)의 파일 관리자가 쓴다.
//
// 계약(io.terra.file contracts/api/terra-api.json · 설계 docs/modules/terra-file/design/terra-file-transfer-design.md §5):
//   entries.read           { root, path, offset, length ≤ 1 MiB }        → { offset, length, data(base64), sha256, eof, size }   file.read · 전송 기록 없음
//   transfers.create       { direction: push, root, path, size_bytes, checksum_sha256, mode: create|overwrite, resume_id? }
//                                                                       → { transfer: { transfer_id, chunk_size, offset(재개 지점), state, expires_at … } }   file.write
//   transfers.chunks.put   { transfer_id, offset, data(base64), sha256 } → { next_offset, size_bytes }
//                          거절 409 CHUNK_OUT_OF_ORDER · CHUNK_CHECKSUM_MISMATCH + retry_offset(본문 맨 위 — Gateway 를 거치면 빠질 수 있어 없으면 transfers.get 의 offset)
//   transfers.complete     { transfer_id }                               → { bytes, verified }  (불일치면 모듈이 부분 파일을 지운다)
//   transfers.pulls.create { root, path, resume_id? }                    → { transfer: { transfer_id, size_bytes, checksum_sha256, chunk_size, offset } }   file.read(받기만)
//   transfers.chunks.get   { transfer_id, offset }                       → { offset, data, sha256, eof }   빈 데이터인데 eof 도 아니면 TRANSFER_STALLED 로 멈춘다(§5.6)
//   transfers.pulls.complete · pulls.abort / transfers.abort { transfer_id, reason?, keep_partial? }
// 청크 크기는 응답의 chunk_size 그대로(Gateway 본문 상한 1 MiB 를 모듈이 640 KiB 상한으로 지킨다). 청크 · 파일 두 층 모두 SHA-256(crypto.subtle).
// 같은 offset 은 3번까지 다시 보낸다. 실패(끊김 · 만료)는 전송을 지우지 않는다 — '다시' 가 resume_id 로 이어 간다. 취소는 abort(부분 파일도 지움).

export const PREVIEW = { text: 64 * 1024, image: 4 * 1024 * 1024, piece: 512 * 1024 };   // 미리보기 상한 — 글은 앞 64 KiB, 그림은 4 MiB 까지(넘으면 정보 + 내려받기). 한 번 읽기 512 KiB(base64 ≈ 683 KiB)
export const BROWSER_MAX = 256 * 1024 * 1024;   // 브라우저가 파일 전체 SHA-256 을 한 번에 계산한다(crypto.subtle 은 흘려 계산하지 못함) — 올리기 · 내려받기 256 MiB 까지
const RETRIES = 3;

const TEXT_EXT = /\.(txt|md|markdown|log|json|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|go|rs|c|h|cc|cpp|hpp|java|kt|sh|bash|zsh|ps1|bat|sql|env|gitignore|dockerfile|makefile|tex|rst|srt|vtt)$/i;
const IMG_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon' };

/** 이름 · 크기 → 미리보기 꼴. text 는 앞부분만(상한), image 는 상한 안에서만, 그 밖은 정보 + 내려받기 */
export function previewKind(name, size) {
  const n = String(name || ''), ext = (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase(), sz = Number(size) || 0;
  if (IMG_EXT[ext]) return sz > PREVIEW.image ? { kind: 'other', mime: IMG_EXT[ext], why: '그림이 미리보기 상한 ' + fmtBytes(PREVIEW.image) + ' 를 넘는다 — 내려받아 연다' } : { kind: 'image', mime: IMG_EXT[ext], limit: PREVIEW.image };
  if (TEXT_EXT.test(n) || /^(readme|license|makefile|dockerfile)$/i.test(n) || !ext) return { kind: 'text', mime: 'text/plain', limit: PREVIEW.text, part: sz > PREVIEW.text };
  return { kind: 'other', mime: 'application/octet-stream', why: '미리보기 없는 형식 — 내려받아 연다' };
}

/** 글로 보일 수 있나 — NUL 이 있거나 제어 문자가 많으면 이진 */
export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 8192); let bad = 0;
  for (let i = 0; i < n; i++) { const b = bytes[i]; if (b === 0) return true; if (b < 9 || (b > 13 && b < 32)) bad++; }
  return n > 0 && bad / n > 0.1;
}
/** UTF-8 로 — 상한에서 잘린 마지막 글자는 버린다 */
export function decodeText(bytes) { return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/�$/, ''); }

/** 청크 계획 — [offset, offset+length) 를 chunk 크기로. 순수(시험용 · 화면은 실행기가 응답의 next_offset 을 따른다) */
export function chunkPlan(size, chunk, start = 0) {
  const out = []; if (!(chunk > 0)) return out;
  for (let o = Math.max(0, start); o < size; o += chunk) out.push({ offset: o, length: Math.min(chunk, size - o) });
  return out;
}

export function b64(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
export function unb64(str) {
  const s = typeof atob === 'function' ? atob(String(str || '')) : Buffer.from(String(str || ''), 'base64').toString('binary');
  const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u;
}
export async function sha256Hex(bytes, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  if (!subtle) throw Object.assign(new Error('이 브라우저는 SHA-256(crypto.subtle)을 못 한다 — https 또는 localhost 에서 연다'), { code: 'NO_SUBTLE' });
  const h = new Uint8Array(await subtle.digest('SHA-256', bytes)); let s = ''; for (const b of h) s += b.toString(16).padStart(2, '0'); return s;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
export function fmtBytes(n) { n = Number(n) || 0; let i = 0; while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 1 : 0) : String(n)) + ' ' + UNITS[i]; }
/** 속도 — 최근 3초의 표본 [{ t, bytes }](bytes 는 누적) → 초당 바이트 */
export function rateOf(samples, now = Date.now(), win = 3000) {
  const s = (samples || []).filter((x) => now - x.t <= win); if (s.length < 2) return 0;
  const a = s[0], b = s[s.length - 1], dt = (b.t - a.t) / 1000; return dt > 0 ? Math.max(0, (b.bytes - a.bytes) / dt) : 0;
}
export const fmtRate = (bps) => (bps > 0 ? fmtBytes(Math.round(bps)) + '/s' : '');

const why = (e) => ({ code: (e && e.code) || 'ERROR', msg: (e && e.message) || String(e || '') });
const fail = (code, message) => Object.assign(new Error(message), { code });
const retryOffsetOf = (e) => { const v = e && ((e.details && e.details.retry_offset) ?? e.retry_offset); return Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null; };

/**
 * @param {{ invoke: (op: string, input: object) => Promise<any>, subtle?: SubtleCrypto, now?: () => number }} o
 *   invoke — 그 노드의 operation 호출(제어기는 TerraNodes 전송의 invoke(노드, op, 입력)를 묶어 준다 — 다른 노드는 Master 중계).
 *   io.terra.file 이 그 노드에 없으면 Gateway 의 MODULE_NOT_FOUND · MODULE_ROUTE_NOT_FOUND 를 그대로 job.err 에 옮긴다
 */
export function createFileTransfer(o) {
  const inv = o.invoke, now = o.now || Date.now, sub = o.subtle;
  const sha = (b) => sha256Hex(b, sub || (globalThis.crypto && globalThis.crypto.subtle));
  let seq = 0;

  /** 미리보기 — 앞에서부터 max 바이트(entries.read 를 512 KiB 씩). 전송 기록을 만들지 않는다 */
  async function readHead({ root, path, max }) {
    const parts = []; let have = 0, size = 0, eof = false;
    while (have < max) {
      const r = await inv('io.terra.file.entries.read', { root, path, offset: have, length: Math.min(PREVIEW.piece, max - have) });
      const d = unb64(r && r.data); size = Number(r && r.size) || size; eof = !!(r && r.eof);
      if (!d.length && !eof) throw fail('TRANSFER_STALLED', '빈 조각인데 끝도 아니다 — 노드가 잘못 답했다');
      parts.push(d); have += d.length; if (eof) break;
    }
    const bytes = new Uint8Array(have); let p = 0; for (const x of parts) { bytes.set(x, p); p += x.length; }
    return { bytes, size, eof, cut: !eof };
  }

  function job(dir, base) {
    const j = Object.assign({ id: 'tx-' + (++seq) + '-' + (now() % 100000), dir, state: 'prep', done: 0, size: 0, rate: 0, err: null, tid: '', note: '', samples: [] }, base);
    const emit = () => { j.rate = rateOf(j.samples, now()); if (base.onChange) try { base.onChange(j); } catch {} };
    j.cancel = () => { if (j.state === 'prep' || j.state === 'run' || j.state === 'verify') { j._cancel = true; j.note = '취소하는 중…'; emit(); } };
    j.retry = () => { if (j.state !== 'fail' && j.state !== 'cancel') return j.promise; if (j.state === 'cancel') { j.tid = ''; j.parts = null; } j._cancel = false; j.err = null; j.note = ''; j.state = 'prep'; j.promise = run(); return j.promise; };
    const tick = (n) => { j.done = n; j.samples.push({ t: now(), bytes: n }); if (j.samples.length > 40) j.samples.shift(); emit(); };
    const stop = async (abortOp, reason) => { if (j.tid) { try { await inv(abortOp, { transfer_id: j.tid, reason }); } catch {} } };
    const run = dir === 'up' ? () => up(j, emit, tick, stop) : () => down(j, emit, tick, stop);
    j.promise = run();
    return j;
  }

  async function up(j, emit, tick, stop) {
    try {
      emit();
      if (j.size > BROWSER_MAX) throw fail('TOO_LARGE_FOR_BROWSER', '브라우저에서 올리기는 ' + fmtBytes(BROWSER_MAX) + ' 까지 — 더 큰 파일은 terra file send');
      if (!j.bytes) { j.note = '체크섬 계산 중…'; emit(); j.bytes = new Uint8Array(await j.file.arrayBuffer()); j.sum = await sha(j.bytes); j.note = ''; }
      if (j._cancel) { j.state = 'cancel'; j.note = ''; return emit(); }
      const r = await inv('io.terra.file.transfers.create', Object.assign({ direction: 'push', root: j.root, path: j.path, size_bytes: j.size, checksum_sha256: j.sum, mode: j.mode || 'create' }, j.tid ? { resume_id: j.tid } : {}));
      const T = (r && r.transfer) || r || {}; j.tid = T.transfer_id || ''; const cs = Number(T.chunk_size) || 0;
      if (!j.tid || !cs) throw fail('TRANSFER_FAILED', '모듈이 전송 id · 청크 크기를 답하지 않았다');
      let off = Number(T.offset ?? T.resume_offset ?? 0) || 0, tries = 0; j.chunk = cs; j.resumed = off > 0; j.state = 'run'; tick(off);
      while (off < j.size) {
        if (j._cancel) break;
        const slice = j.bytes.subarray(off, Math.min(j.size, off + cs));
        try {
          const a = await inv('io.terra.file.transfers.chunks.put', { transfer_id: j.tid, offset: off, data: b64(slice), sha256: await sha(slice) });
          const next = Number(a && a.next_offset);
          if (!(next > off)) { await stop('io.terra.file.transfers.abort', 'stalled'); throw fail('TRANSFER_STALLED', off + ' 에서 받았다면서 나아가지 않았다'); }
          off = next; tries = 0; tick(off);
        } catch (e) {
          if ((e.code === 'CHUNK_OUT_OF_ORDER' || e.code === 'CHUNK_CHECKSUM_MISMATCH') && ++tries <= RETRIES) {
            const ro = retryOffsetOf(e); off = ro !== null ? ro : Number(((await inv('io.terra.file.transfers.get', { transfer_id: j.tid })).transfer || {}).offset) || 0; tick(off); continue;
          }
          throw e;
        }
      }
      if (j._cancel) { await stop('io.terra.file.transfers.abort', 'cancelled'); j.state = 'cancel'; j.note = ''; return emit(); }
      j.state = 'verify'; emit();
      const c = await inv('io.terra.file.transfers.complete', { transfer_id: j.tid });
      if (!c || c.verified !== true) throw fail('CHECKSUM_MISMATCH', '노드가 받은 파일이 체크섬과 맞지 않는다 — 부분 파일은 지워졌다');
      j.state = 'done'; j.bytes = null; tick(j.size);
    } catch (e) { j.state = 'fail'; j.err = why(e); j.note = ''; if (e.code === 'CHECKSUM_MISMATCH' || e.code === 'TRANSFER_STALLED') j.tid = ''; emit(); }
  }

  async function down(j, emit, tick, stop) {
    try {
      emit();
      const r = await inv('io.terra.file.transfers.pulls.create', Object.assign({ root: j.root, path: j.path }, j.tid ? { resume_id: j.tid } : {}));
      const T = (r && r.transfer) || r || {}; j.tid = T.transfer_id || ''; j.size = Number(T.size_bytes) || 0; j.sum = T.checksum_sha256 || '';
      if (!j.tid) throw fail('TRANSFER_FAILED', '모듈이 전송 id 를 답하지 않았다');
      if (j.size > BROWSER_MAX) { await stop('io.terra.file.transfers.pulls.abort', 'too large for browser'); j.tid = ''; throw fail('TOO_LARGE_FOR_BROWSER', '브라우저로 받기는 ' + fmtBytes(BROWSER_MAX) + ' 까지 — 더 큰 파일은 terra file get'); }
      if (!j.parts) j.parts = [];
      let have = j.parts.reduce((s, x) => s + x.length, 0), tries = 0; j.resumed = have > 0; j.state = 'run'; tick(have);
      for (;;) {
        if (j._cancel) break;
        const g = await inv('io.terra.file.transfers.chunks.get', { transfer_id: j.tid, offset: have });
        const d = unb64(g && g.data), eof = !!(g && g.eof);
        if (g && g.sha256 && d.length && (await sha(d)) !== g.sha256) { if (++tries <= RETRIES) continue; throw fail('CHUNK_CHECKSUM_MISMATCH', have + ' 의 청크가 다이제스트와 맞지 않는다'); }
        if (!d.length && !eof) { await stop('io.terra.file.transfers.pulls.abort', 'stalled'); j.tid = ''; j.parts = null; throw fail('TRANSFER_STALLED', have + ' 에서 빈 청크인데 끝도 아니다 — 노드가 잘못 답했다'); }
        tries = 0; if (d.length) { j.parts.push(d); have += d.length; tick(have); }
        if (eof) break;
      }
      if (j._cancel) { await stop('io.terra.file.transfers.pulls.abort', 'cancelled'); j.state = 'cancel'; j.note = ''; return emit(); }
      j.state = 'verify'; emit();
      const all = new Uint8Array(have); let p = 0; for (const x of j.parts) { all.set(x, p); p += x.length; }
      if (j.sum && (await sha(all)) !== j.sum) { j.parts = null; j.tid = ''; throw fail('CHECKSUM_MISMATCH', '받은 파일이 합의한 체크섬과 맞지 않는다 — 버렸다'); }
      try { await inv('io.terra.file.transfers.pulls.complete', { transfer_id: j.tid }); } catch {}
      j.blob = typeof Blob === 'function' ? new Blob(j.parts, { type: j.mime || 'application/octet-stream' }) : all; j.parts = null;
      j.state = 'done'; tick(have);
    } catch (e) { j.state = 'fail'; j.err = why(e); j.note = ''; emit(); }
  }

  return {
    readHead,
    /** @param {{ root: string, path: string, file: Blob & { name?: string }, mode?: 'create'|'overwrite', onChange?: (j: object) => void }} a */
    upload: (a) => job('up', { root: a.root, path: a.path, name: a.name || (a.file && a.file.name) || a.path.split('/').pop(), file: a.file, size: Number(a.file && a.file.size) || 0, mode: a.mode, onChange: a.onChange }),
    /** @param {{ root: string, path: string, name?: string, mime?: string, onChange?: (j: object) => void }} a */
    download: (a) => job('down', { root: a.root, path: a.path, name: a.name || a.path.split('/').pop(), mime: a.mime, onChange: a.onChange }),
  };
}
