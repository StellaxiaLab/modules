// 자원 상태 창(ResStatus)의 값 보기 — 끝점의 형식(output_schema) → 뷰어 종류, 스트림 메시지 → 화면 값, 구독(핸들 열기 → events 스트림 · 다시 붙기).
//
// Terra (Master 계약 products/tree/master/contracts/api/terra-api.json · svi/handle_service.go):
//   핸들 열기   terra.master.svi.handles.post { resource_id, endpoint_id, operation: inspect|read|subscribe, qos_profile?, idempotency_key, ttl_seconds?(≤ 86400) } → 202 { handle_id, operation_id, state }
//   값          terra.master.svi.handles.by-handle-id.events.get { handle_id } — SSE `event: status|frame`, data = StreamMessage
//               (같은 구독의 WebSocket 판 …stream.get). 현재 상태가 먼저, realtime_latest 는 마지막 프레임을 이어서. 핸들이 끝나면 마지막 status 뒤 닫힘
//   StreamMessage { kind: status|frame, handle_id, state?, reason?, sequence?, schema_ref?, encoding?, data?(base64) }
//   닫기        terra.master.svi.handles.by-handle-id.delete { handle_id }
//   핸들 상태   requested · authorized · validating · planning · preparing · opening · active · degraded · closing · closed · denied · failed · expired
// 지금 세 op 는 모두 앱 위임(delegated-session) 밖 — 화면은 window.TerraGateAll(WATCH_OPS) 로 잠그고 이유를 적는다. 코어가 열면 표만 다시 뽑으면 붙는다.
//
// Terra 가 쓰는 형식 이름(코드 · 설계 문서에서 찾은 것): terra.bytes@1(file · process · net 어댑터 모두) · terra.text@1 · terra.video.frame@1(h264 · nv12 · rgb24 · jpeg)
//   · terra.video.rgb24@1 · terra.video.h264@1 · terra.image.frame@1 · terra.audio.frame@1 · terra.input.event@1 · terra.input.mouse@1 · terra.input.keyboard@1
//   · terra.button@1 · terra.process.status@1 · terra.camera.status@1 · terra.detection.objects@1 · terra.file.content@1 · terra.inference.request/response@1
//   수치 전용 형식은 Terra 에 아직 없다 — terra.<무엇>.sample|level|metric|number|gauge@N 꼴을 수치로 보고(제안), 그 밖은 아래 표대로.
//
// 보드(ResStatus)의 시안 사본이 이 파일과 같은지 tests/resstatus.test.mjs 가 본다.

export const WATCH_OPS = ['terra.master.svi.handles.post', 'terra.master.svi.handles.by-handle-id.events.get', 'terra.master.svi.handles.by-handle-id.delete'];

const KIND_LABEL = { number: '수치', text: '글 · 로그', bytes: '바이트', image: '그림', video: '영상', event: '사건' };
const IMG_ENC = { jpeg: 'image/jpeg', jpg: 'image/jpeg', 'image/jpeg': 'image/jpeg', mjpeg: 'image/jpeg', png: 'image/png', 'image/png': 'image/png', webp: 'image/webp', 'image/webp': 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', 'image/svg+xml': 'image/svg+xml' };

/**
 * 형식(schema_ref) · 인코딩 → 뷰어 종류
 * @param {string} schema 예 terra.video.frame@1 @param {string} [encoding] 예 jpeg · h264 · application/json
 * @returns {{ kind: 'number'|'text'|'bytes'|'image'|'video'|'event', label: string, schema: string }}
 */
export function viewerOf(schema, encoding) {
  const s = String(schema || '').toLowerCase().replace(/@\d+$/, ''), e = String(encoding || '').toLowerCase();
  const K = (kind) => ({ kind, label: KIND_LABEL[kind], schema: String(schema || '') });
  if (/^terra\.video(\.|$)/.test(s)) return K('video');
  if (/^terra\.image(\.|$)/.test(s) || IMG_ENC[e]) return K('image');
  if (/\.(sample|level|metric|number|gauge|scalar)$/.test(s)) return K('number');
  if (/^terra\.text(\.|$)|\.(line|log)$|^terra\.log(\.|$)/.test(s) || /^text\//.test(e)) return K('text');
  if (/^terra\.(bytes|io\.raw|file\.content|audio)(\.|$)/.test(s)) return K('bytes');
  if (/^terra\.(input|button|process\.status|camera\.status|detection|inference|svi|container|filesystem|file\.entry|file\.request|process\.command|camera\.control)(\.|$)/.test(s) || e === 'application/json' || e === 'json') return K('event');
  return K('bytes');
}

/** base64 → 바이트 배열(없거나 깨지면 빈 배열) */
export function b64bytes(s) {
  if (!s) return [];
  try { const t = atob(String(s)); const out = new Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; } catch (e) { return []; }
}
/** 바이트 → UTF-8 글 */
export function utf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes || [])); } catch (e) { return String.fromCharCode.apply(null, (bytes || []).slice(0, 4096)); }
}
/** 헥스 줄 — { off, hex, txt } (16 바이트씩, 최대 rows 줄) */
export function hexRows(bytes, rows = 8) {
  const B = bytes || [], out = [], h = (n) => n.toString(16).padStart(2, '0');
  for (let i = 0; i < B.length && out.length < rows; i += 16) {
    const c = B.slice(i, i + 16);
    out.push({ off: i.toString(16).padStart(4, '0'), hex: c.map(h).join(' '), txt: c.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '·')).join('') });
  }
  return out;
}

/** SSE · WebSocket 메시지 → StreamMessage(모르는 꼴이면 null). { event, data: '<json>' } · '<json>' · 이미 객체 모두 받는다 */
export function streamMsg(raw) {
  let m = raw;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { return null; } }
  if (m && typeof m === 'object' && !m.kind && m.data !== undefined && (m.event === 'status' || m.event === 'frame')) { let d = m.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return null; } } m = Object.assign({ kind: m.event }, d); }
  return m && (m.kind === 'status' || m.kind === 'frame') ? m : null;
}

/** 프레임 하나 → 그 뷰어의 값 */
export function frameValue(msg, kind) {
  const bytes = b64bytes(msg && msg.data), enc = String((msg && msg.encoding) || '').toLowerCase();
  if (kind === 'number') { const t = utf8(bytes).trim(); let v = Number(t); if (!t || Number.isNaN(v)) { try { const j = JSON.parse(t); v = typeof j === 'number' ? j : j && typeof j.value === 'number' ? j.value : NaN; } catch (e) { v = NaN; } } return { n: Number.isFinite(v) ? v : null, size: bytes.length }; }
  if (kind === 'text') return { lines: utf8(bytes).replace(/\r\n?/g, '\n').split('\n').filter((x, i, a) => x !== '' || i < a.length - 1), size: bytes.length };
  if (kind === 'image' || kind === 'video') { const mime = IMG_ENC[enc]; return { src: mime ? 'data:' + mime + ';base64,' + msg.data : '', note: mime ? '' : (enc || '인코딩 모름') + ' — 브라우저 미지원 인코딩', size: bytes.length, enc }; }
  if (kind === 'event') { const t = utf8(bytes).trim(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    const sum = j && typeof j === 'object' ? Object.entries(j).slice(0, 6).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' · ') : t;
    return { type: (j && (j.type || j.kind || j.event || j.state)) || '', text: sum.slice(0, 160), size: bytes.length }; }
  return { bytes: bytes.slice(0, 256), size: bytes.length };
}

const OPENING = new Set(['requested', 'authorized', 'validating', 'planning', 'preparing', 'opening']);
export const TERMINAL = new Set(['closed', 'denied', 'failed', 'expired']);
/** 빈 보기 상태 */
export function viewInit(kind) { return { kind, conn: 'idle', state: '', reason: '', tries: 0, handle: '', seq: 0, frames: 0, gaps: 0, bytes: 0, times: [], num: { now: null, hist: [] }, lines: [], raw: [], img: '', imgNote: '', imgSize: 0, events: [], why: '' }; }

/**
 * 메시지 하나를 보기 상태에 접는다(새 객체). hold 면 화면 버퍼(그래프 · 줄 · 그림)는 멈추고 셈만 한다(꼬리 따라가기 멈춤)
 * 메시지: StreamMessage(status · frame) 또는 { kind: 'conn', conn: opening|lost|stopped|error, tries?, why?, handle? }
 */
export function reduceView(st, msg, o = {}) {
  const s = Object.assign({}, st), now = o.now || Date.now();
  if (!msg) return s;
  if (msg.kind === 'conn') { s.conn = msg.conn; if (msg.tries != null) s.tries = msg.tries; if (msg.why != null) s.why = msg.why; if (msg.handle) s.handle = msg.handle; return s; }
  if (msg.kind === 'status') { s.state = msg.state || ''; s.reason = msg.reason || ''; if (msg.handle_id) s.handle = msg.handle_id; s.conn = TERMINAL.has(s.state) ? 'ended' : 'live'; if (s.state === 'active') s.tries = 0; return s; }
  if (msg.kind !== 'frame') return s;
  s.conn = 'live'; s.tries = 0; s.frames = st.frames + 1;
  const q = Number(msg.sequence) || 0; if (q && st.seq && q > st.seq + 1) s.gaps = st.gaps + (q - st.seq - 1); if (q) s.seq = q;
  s.times = st.times.concat([now]).filter((t) => now - t <= 3000).slice(-90);
  const v = frameValue(msg, st.kind); s.bytes = st.bytes + (v.size || 0);
  if (o.hold) return s;
  if (st.kind === 'number' && v.n != null) s.num = { now: v.n, hist: st.num.hist.concat([v.n]).slice(-60) };
  else if (st.kind === 'text') s.lines = st.lines.concat(v.lines).slice(-200);
  else if (st.kind === 'image' || st.kind === 'video') { s.img = v.src; s.imgNote = v.note; s.imgSize = v.size; }
  else if (st.kind === 'event') s.events = [{ at: now, seq: q, type: v.type, text: v.text }].concat(st.events).slice(0, 50);
  else s.raw = v.bytes;
  return s;
}

/** 초당 프레임(최근 3초) */
export const fpsOf = (st, now = Date.now()) => { const T = st.times.filter((t) => now - t <= 3000); return T.length < 2 ? T.length / 3 : (T.length - 1) / Math.max(0.001, (T[T.length - 1] - T[0]) / 1000); };

/** 구독 표시 — { label, cls } (cls: ok · busy · warn · err · dim) */
export function connLabel(st) {
  if (st.conn === 'idle' || st.conn === 'stopped') return { label: '멈춤', cls: 'dim' };
  if (st.conn === 'error') return { label: '못 엶' + (st.why ? ' · ' + st.why : ''), cls: 'err' };
  if (st.conn === 'lost') return { label: '끊김 · 재연결 중' + (st.tries > 1 ? ' (' + st.tries + '번째)' : ''), cls: 'warn' };
  if (st.conn === 'opening' || (st.conn === 'live' && OPENING.has(st.state))) return { label: '여는 중', cls: 'busy' };
  if (st.conn === 'ended' || TERMINAL.has(st.state)) return { label: { closed: '닫힘', denied: '거절', failed: '실패', expired: '만료' }[st.state] + (st.reason ? ' · ' + st.reason : ''), cls: st.state === 'closed' || st.state === 'expired' ? 'dim' : 'err' };
  if (st.state === 'degraded') return { label: '끊김 · 원천 쪽 복구 중' + (st.reason ? ' · ' + st.reason : ''), cls: 'warn' };
  return { label: '받는 중', cls: 'ok' };
}

/** 수치 요약 — 지금 · 최소 · 평균 · 최대 · 막대 높이(%) */
export function numStats(hist) {
  const H = (hist || []).filter((x) => Number.isFinite(x)); if (!H.length) return { now: null, min: null, max: null, avg: null, bars: [] };
  const mn = Math.min(...H), mx = Math.max(...H), lo = mn - (mx - mn) * 0.1, span = Math.max(1e-9, mx - lo);
  return { now: H[H.length - 1], min: mn, max: mx, avg: H.reduce((a, b) => a + b, 0) / H.length, bars: H.map((v) => Math.max(2, Math.round(((v - lo) / span) * 100))) };
}

/**
 * 구독 — 핸들을 열고 events 스트림을 붙인다. 끊기면 다시 붙고(1 · 2 · 4 … 30초), 핸들이 사라졌으면(NOT_FOUND) 새로 연다
 * @param {{ invoke: Function, stream: (op: string, input: object, onMessage: Function, onClose: Function) => Promise<() => void> }} terra src/api/terra.js
 */
export function createSviWatch(terra, o = {}) {
  const T = o.setTimeout || ((f, ms) => setTimeout(f, ms)), C = o.clearTimeout || ((t) => clearTimeout(t));
  return {
    /** @param {{ resource_id: string, endpoint_id: string, qos?: string, ttl?: number }} req @param {(msg: object) => void} on @returns {{ stop: () => void }} */
    open(req, on) {
      let handle = '', close = null, dead = false, ended = false, tries = 0, timer = null;
      const key = 'gui-v3-watch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const retry = () => { if (dead || ended) return; tries++; on({ kind: 'conn', conn: 'lost', tries }); timer = T(attach, Math.min(30000, 1000 * 2 ** Math.min(tries - 1, 5))); };
      const attach = async () => {
        if (dead) return;
        if (!tries) on({ kind: 'conn', conn: 'opening' });
        try {
          if (!handle) {
            const h = await terra.invoke('terra.master.svi.handles.post', { resource_id: req.resource_id, endpoint_id: req.endpoint_id, operation: 'subscribe', qos_profile: req.qos || 'realtime_latest', idempotency_key: key, ttl_seconds: req.ttl || 3600 });
            handle = (h && h.handle_id) || ''; if (!handle) throw Object.assign(new Error('handle_id 없음'), { code: 'BAD_RESPONSE', status: 500 });
            on({ kind: 'conn', conn: 'opening', handle }); if (h.state) on({ kind: 'status', handle_id: handle, state: h.state });
          }
          if (dead) return;
          const got = (raw) => { const m = streamMsg(raw); if (!m) return; tries = 0; if (m.kind === 'status' && TERMINAL.has(m.state)) ended = true; on(m); }, lost = () => { close = null; retry(); };
          // events.get 은 SSE — 스트림 티켓(WebSocket)은 SSE 를 잇지 못한다(sse.js). sse 가 없는 시험 전송만 stream 으로
          close = terra.sse ? await terra.sse('terra.master.svi.handles.by-handle-id.events.get', { handle_id: handle }, { onEvent: (e) => got(e && e.data !== undefined ? e.data : e), onClose: lost })
            : await terra.stream('terra.master.svi.handles.by-handle-id.events.get', { handle_id: handle }, got, lost);
        } catch (e) {
          const st = (e && e.status) || 0;
          if (st === 404 && handle) { handle = ''; retry(); return; }
          if (st >= 400 && st < 500) { ended = true; on({ kind: 'conn', conn: 'error', why: (e && (e.code || e.message)) || String(st) }); return; }
          retry();
        }
      };
      attach();
      return { stop() {
        dead = true; if (timer) C(timer); if (close) { try { close(); } catch (e) {} close = null; }
        if (handle && !ended) terra.invoke('terra.master.svi.handles.by-handle-id.delete', { handle_id: handle }).catch(() => {});
        on({ kind: 'conn', conn: 'stopped' });
      } };
    }
  };
}
