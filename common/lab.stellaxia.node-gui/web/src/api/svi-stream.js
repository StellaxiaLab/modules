// SVI 핸들 흐름 (A-28) — Master `terra.master.svi.handles.by-handle-id.events.get` SSE를 화면 모양으로 바꾼다.
//   Terra (products/tree/master/src/terra_master/api/routes_svi_handle_events.go · svi/handle_service.go):
//   · `event: status` · `event: frame`, data = StreamMessage {kind, handle_id, state?, reason?, sequence?, schema_ref?, encoding?, data?(base64)}
//     — 필드가 다 omitempty라 sequence 0은 오지 않는다
//   · 구독하면 지금 상태 → (realtime_latest · QoS 미지정이면) 마지막 프레임 → 실시간. 끝난 핸들은 상태만 주고 닫힌다
//   · 15초 `: keep-alive` · **이어 받기(Last-Event-ID)가 없다** — 다시 붙으면 그 시점부터
//   · 핸들당 구독자 32 · 대기열 256 · 프레임 하나 최대 1 MiB · read 핸들은 프레임 1개로 끝난다
// 브라우저 보호: 꼬리는 500줄 또는 1 MB까지 · 프레임 하나에서 그릴 만큼(끝 64 KiB)만 디코딩 · 처리는 시간 조각(8 ms)으로 나눈다 ·
//   화면 갱신은 부르는 쪽이 초당 10번까지 (snapshot은 바뀐 것이 있을 때만 새로 만든다)

export const TAIL_LINES = 500, TAIL_BYTES = 1 << 20, VIEW_LINES = 80, DECODE_MAX = 64 * 1024, HEX_MAX = 48;
export const TERMINAL = /^(closed|denied|failed|expired)$/;

/** base64 길이 → 바이트 수 (디코딩 없이) */
export function b64Size(s) { const n = (s || '').length; if (!n) return 0; const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0; return Math.floor(n * 3 / 4) - pad; }

/** base64의 끝 max 바이트만 디코딩 (4글자 경계에 맞춘다) → { bytes, cut: 잘라 낸 앞 바이트 수 } */
export function decodeTail(b64, max = DECODE_MAX) {
  const s = b64 || '', total = b64Size(s), keepChars = Math.ceil(max / 3) * 4;
  const from = s.length > keepChars ? s.length - keepChars : 0, part = s.slice(from - (from % 4));
  let bin = ''; try { bin = atob(part); } catch { return { bytes: new Uint8Array(0), cut: total, bad: true }; }
  const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, cut: total - out.length };
}

const UTF8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;
/** UTF-8로 읽히면 글자, 아니면 null. 잘린 앞쪽의 이어진 바이트(10xxxxxx)는 버리고 읽는다. 제어 문자(탭 · 줄바꿈 · CR 밖)가 많으면 글자가 아니다 */
export function asText(bytes, cut) {
  if (!UTF8) return null;
  let b = bytes, k = 0;
  if (cut) { while (k < b.length && k < 3 && (b[k] & 0xc0) === 0x80) k++; b = b.subarray(k); }
  let s; try { s = UTF8.decode(b); } catch { return null; }
  let ctl = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 32 && c !== 9 && c !== 10 && c !== 13) ctl++; }
  return ctl > Math.max(2, s.length * 0.02) ? null : s;
}
/** 바이트 → hex 한 줄 (앞 HEX_MAX 바이트) */
export function hexLine(bytes, size) {
  const n = Math.min(bytes.length, HEX_MAX); let h = '';
  for (let i = 0; i < n; i++) h += (i ? ' ' : '') + bytes[i].toString(16).padStart(2, '0');
  return h + (size > n ? ' … (' + fmtBytes(size) + ')' : '');
}
export function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }
const clock = () => new Date().toTimeString().slice(0, 8);

/** 본문 종류 — schema_ref로 가른다 */
export function bodyKind(schema) {
  const s = String(schema || '');
  return /^terra\.(bytes|text)@/.test(s) ? 'text' : /^terra\.image\.frame@/.test(s) ? 'image' : 'meta';
}

/** 핸들 하나의 흐름 상태 · 꼬리. 화면은 snapshot()만 읽는다 */
export class StreamView {
  /** @param {{ resId: string, handleId: string, op?: string, qos?: string, name?: string, now?: () => number }} o */
  constructor(o) {
    Object.assign(this, { resId: o.resId, handleId: o.handleId, op: o.op || '', qos: o.qos || '', name: o.name || o.resId });
    this.now = o.now || (() => Date.now());
    this.state = 'opening'; this.reason = ''; this.seq = null; this.frames = 0; this.bytes = 0; this.dropped = 0; this.evicted = 0;
    this.tail = []; this.tailChars = 0; this.img = null; this.meta = []; this.kind = null; this.schema = ''; this.encoding = '';
    this.arrivals = []; this.queue = []; this.paused = false; this.pausedView = null; this.pending = 0; this.note = ''; this.noteC = ''; this.ended = false; this.dirty = true;
  }
  /** SSE 한 건 (events.js raw) */
  push(m) {
    if (!m) return;
    // 다시 붙으면 (realtime_latest) 마지막 프레임이 한 번 더 온다 — 이미 받은 순번은 건너뛴다 (sequence 0은 오지 않으니 0/없음은 거르지 않는다)
    if (m.kind === 'frame' && this.relinked && m.sequence && this.seq && m.sequence <= this.seq) return;
    if (m.kind === 'frame') { this.queue.push(m); this.frames++; this.bytes += b64Size(m.data); this.seq = m.sequence || 0; this.arrivals.push(this.now()); if (this.paused) this.pending++; this.dirty = true; return; }
    this.state = m.state || this.state; this.reason = m.reason || '';
    if (TERMINAL.test(this.state)) {
      this.ended = true;
      // read 핸들은 프레임 하나로 끝난다 — 끊김 · 오류가 아니다
      if (this.op === 'read' && this.frames >= 1 && this.state === 'closed') this.setNote('읽기 끝 — read 핸들은 프레임 하나로 끝난다', 'ok');
      else if (this.state === 'closed') this.setNote('핸들이 닫혔다' + (this.reason ? ' — ' + this.reason : ''), 'off');
      else this.setNote(this.state + (this.reason ? ' — ' + this.reason : ''), 'bad');
    }
    this.dirty = true;
  }
  setNote(t, c) { this.note = t; this.noteC = c || 'off'; this.dirty = true; }
  /** 연결 사건 (events.js onState) */
  link(s, again) {
    if (this.ended) return;
    if (s === 'retry') this.setNote('끊김 — 다시 붙는 중. 이어 받기가 없어 끊긴 동안의 프레임은 받지 못한다', 'wait');
    else if (s === 'open' && again) this.relinked = true, this.setNote('다시 붙음 — 이 시점부터 받는다 (끊긴 동안의 프레임은 없다)', 'wait');
    else if (s === 'off') { this.ended = true; if (!this.note) this.setNote('흐름이 끝났다 — 핸들을 볼 수 없다', 'off'); }
  }
  /** 핸들 보기(svi.handles.by-handle-id.get)에서 센 것 */
  counters(h) { if (!h) return; const d = +h.dropped_frames || 0, e = +h.evicted_subscribers || 0; if (d !== this.dropped || e !== this.evicted || (h.qos_profile && h.qos_profile !== this.qos)) { this.dropped = d; this.evicted = e; if (h.qos_profile) this.qos = h.qos_profile; this.dirty = true; } }
  /** 쌓인 프레임을 budget ms 안에서 처리한다. 남았으면 true */
  process(budget = 8) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    while (this.queue.length) {
      const m = this.queue.shift();
      const kind = bodyKind(m.schema_ref), size = b64Size(m.data), seq = m.sequence || 0;
      this.kind = kind; this.schema = m.schema_ref || ''; this.encoding = m.encoding || '';
      if (kind === 'image') {
        if (this.queue.some((x) => bodyKind(x.schema_ref) === 'image')) continue;   // 그림은 최신 한 장만 — 앞 것은 그리지 않고 버린다
        this.img = /^image\/(png|jpeg|jpg|gif|webp|bmp)$/i.test(m.encoding || '') ? 'data:' + m.encoding.toLowerCase().replace('jpg', 'jpeg') + ';base64,' + m.data : null;
        this.imgInfo = '#' + seq + ' · ' + fmtBytes(size) + ' · ' + (m.encoding || '인코딩 없음') + (this.img ? '' : ' — 이 인코딩은 브라우저에서 그리지 않는다');
      } else if (kind === 'text') {
        const { bytes, cut, bad } = decodeTail(m.data, DECODE_MAX), txt = bad ? null : asText(bytes, cut);
        if (txt != null) {
          const lines = txt.replace(/\r\n/g, '\n').split('\n'); if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
          lines.forEach((ln, i) => this.add({ seq, t: clock(), text: (i === 0 && cut ? '… ' : '') + ln, hex: false }));
        } else this.add({ seq, t: clock(), text: hexLine(cut ? bytes.subarray(0, HEX_MAX) : bytes, size), hex: true });
      } else this.meta = this.meta.concat([{ seq, t: clock(), text: '#' + seq + ' · ' + fmtBytes(size) + ' · ' + (m.schema_ref || 'schema 없음') + (m.encoding ? ' · ' + m.encoding : '') }]).slice(-VIEW_LINES);
      this.dirty = true;
      if ((typeof performance !== 'undefined' ? performance : Date).now() - t0 > budget) break;
    }
    return this.queue.length > 0;
  }
  add(line) {
    this.tail.push(line); this.tailChars += line.text.length;
    while (this.tail.length > TAIL_LINES || this.tailChars > TAIL_BYTES) { const x = this.tail.shift(); this.tailChars -= x.text.length; }
  }
  fps() { const n = this.now(), A = this.arrivals; while (A.length && n - A[0] > 3000) A.shift(); return A.length ? Math.round(A.length / 3 * 10) / 10 : 0; }
  flowing() { return !this.ended && TERMINAL.test(this.state) === false && this.fps() > 0; }
  setPaused(p) { if (p === this.paused) return; this.paused = p; this.pending = 0; this.pausedView = p ? this.body() : null; this.dirty = true; }
  clear() { this.tail = []; this.tailChars = 0; this.meta = []; this.img = null; this.imgInfo = ''; this.pending = 0; if (this.paused) this.pausedView = this.body(); this.dirty = true; }
  body() { return { lines: this.tail.slice(-VIEW_LINES), meta: this.meta.slice(-VIEW_LINES), img: this.img, imgInfo: this.imgInfo || '' }; }
  /** 화면 모양 (state.sviStream) */
  snapshot() {
    this.dirty = false;
    const b = this.paused ? this.pausedView : this.body();
    return { resId: this.resId, handleId: this.handleId, name: this.name, op: this.op, state: this.state, reason: this.reason, qos: this.qos || 'realtime_latest', seq: this.seq, fps: this.fps(),
      frames: this.frames, bytes: this.bytes, dropped: this.dropped, evicted: this.evicted, kind: this.kind || 'text', schema: this.schema, encoding: this.encoding,
      lines: b.lines, meta: b.meta, img: b.img, imgInfo: b.imgInfo, tailLines: this.tail.length, paused: this.paused, pending: this.pending, note: this.note, noteC: this.noteC, ended: this.ended, live: true };
  }
  /** ⬇ 저장 — 받은 꼬리 (hex 줄은 그대로) */
  saveText() { return this.tail.map((l) => '#' + l.seq + '\t' + l.t + '\t' + (l.hex ? '[hex] ' : '') + l.text).join('\n') + '\n'; }
}
