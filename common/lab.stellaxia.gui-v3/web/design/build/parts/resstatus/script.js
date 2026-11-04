// 자원 상태 창 — 자원 하나의 상태 · 값(스트림) · 끝점 · 연결 · 최근 이벤트를 CLI 처럼 (상태 창과 같은 결, 바탕이 비친다)
//   열기 — 자원 이름을 누르면(자원 창 · 설정 › Leaf › 자원) · 위성 우클릭 › 상태. 자원마다 창 하나, 같은 자원이면 앞으로
//   Terra 대응 (트리 Master):
//     정보 · 상태 — terra.master.svi.resources.get(끝점의 output_schema 까지) · 연결 — terra.master.svi.bindings.get · 쓰는 곳 — svi.handles.get(10초 조회)
//     값 — terra.master.svi.handles.post { resource_id, endpoint_id, operation: subscribe, qos_profile, idempotency_key } → handles.by-handle-id.events.get(SSE status · frame)
//          닫을 때 handles.by-handle-id.delete. 세 op 는 지금 앱 위임 밖 — window.TerraGateAll(WATCH_OPS) 가 잠그고 이유를 준다(코어가 열면 표만 다시 뽑아 붙는다)
//   값 뷰어 — 끝점의 형식(output_schema) → 수치(큰 현재값 + 막대 + 최소/평균/최대) · 글/로그(꼬리 따라가기 · 멈춤) · 바이트(헥스 + 글자) · 그림/영상(프레임) · 사건(목록)
//   아래 WATCH_OPS · viewerOf · b64bytes · utf8 · hexRows · frameValue · viewInit · reduceView · connLabel · numStats 는 src/api/svi-view.js 의 사본(시안용) — tests/resstatus.test.mjs 가 같은지 본다
//   시안 — 끝점마다 가짜 흐름(같은 StreamMessage 모양 → 같은 reduceView). 40초마다 몇 초 끊겼다가 다시 붙는다. 실제 모드로는 새지 않는다
const WATCH_OPS = ['terra.master.svi.handles.post', 'terra.master.svi.handles.by-handle-id.events.get', 'terra.master.svi.handles.by-handle-id.delete'];
const KIND_LABEL = { number: '수치', text: '글 · 로그', bytes: '바이트', image: '그림', video: '영상', event: '사건' };
const IMG_ENC = { jpeg: 'image/jpeg', jpg: 'image/jpeg', 'image/jpeg': 'image/jpeg', mjpeg: 'image/jpeg', png: 'image/png', 'image/png': 'image/png', webp: 'image/webp', 'image/webp': 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', 'image/svg+xml': 'image/svg+xml' };
function viewerOf(schema, encoding) {
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
function b64bytes(s) {
  if (!s) return [];
  try { const t = atob(String(s)); const out = new Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; } catch (e) { return []; }
}
function utf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes || [])); } catch (e) { return String.fromCharCode.apply(null, (bytes || []).slice(0, 4096)); }
}
function hexRows(bytes, rows = 8) {
  const B = bytes || [], out = [], h = (n) => n.toString(16).padStart(2, '0');
  for (let i = 0; i < B.length && out.length < rows; i += 16) {
    const c = B.slice(i, i + 16);
    out.push({ off: i.toString(16).padStart(4, '0'), hex: c.map(h).join(' '), txt: c.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '·')).join('') });
  }
  return out;
}
function frameValue(msg, kind) {
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
const TERMINAL = new Set(['closed', 'denied', 'failed', 'expired']);
function viewInit(kind) { return { kind, conn: 'idle', state: '', reason: '', tries: 0, handle: '', seq: 0, frames: 0, gaps: 0, bytes: 0, times: [], num: { now: null, hist: [] }, lines: [], raw: [], img: '', imgNote: '', imgSize: 0, events: [], why: '' }; }
function reduceView(st, msg, o = {}) {
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
function connLabel(st) {
  if (st.conn === 'idle' || st.conn === 'stopped') return { label: '멈춤', cls: 'dim' };
  if (st.conn === 'error') return { label: '못 엶' + (st.why ? ' · ' + st.why : ''), cls: 'err' };
  if (st.conn === 'lost') return { label: '끊김 · 재연결 중' + (st.tries > 1 ? ' (' + st.tries + '번째)' : ''), cls: 'warn' };
  if (st.conn === 'opening' || (st.conn === 'live' && OPENING.has(st.state))) return { label: '여는 중', cls: 'busy' };
  if (st.conn === 'ended' || TERMINAL.has(st.state)) return { label: { closed: '닫힘', denied: '거절', failed: '실패', expired: '만료' }[st.state] + (st.reason ? ' · ' + st.reason : ''), cls: st.state === 'closed' || st.state === 'expired' ? 'dim' : 'err' };
  if (st.state === 'degraded') return { label: '끊김 · 원천 쪽 복구 중' + (st.reason ? ' · ' + st.reason : ''), cls: 'warn' };
  return { label: '받는 중', cls: 'ok' };
}
function numStats(hist) {
  const H = (hist || []).filter((x) => Number.isFinite(x)); if (!H.length) return { now: null, min: null, max: null, avg: null, bars: [] };
  const mn = Math.min(...H), mx = Math.max(...H), lo = mn - (mx - mn) * 0.1, span = Math.max(1e-9, mx - lo);
  return { now: H[H.length - 1], min: mn, max: mx, avg: H.reduce((a, b) => a + b, 0) / H.length, bars: H.map((v) => Math.max(2, Math.round(((v - lo) / span) * 100))) };
}
const QOS_KO = { realtime_latest: '실시간 최신', realtime_ordered: '실시간 순서', reliable_ordered: '신뢰 순서', bulk_resumable: '대용량 재개' };

class Component extends DCLogic {
  // state.sub — 시안은 열자마자 흐른다 · rsub — 실제는 눌러야 연다(핸들 열기는 감사되는 쓰기) · hold — 꼬리 멈춤(받기는 계속, 화면만 멈춤)
  constructor(props) { super(props); this.state = { q: 0, ep: '', sub: true, rsub: false, hold: false }; this._vs = {}; this._ev = []; this._w = null; try { window.addEventListener('terra-help', () => this.setState({})); } catch (e) {} }
  componentDidMount() { this._live = true; this._iv = setInterval(() => { if (this._live && !this.RT()) this.tick(); }, 250); }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); if (this._un) { this._un(); this._un = null; } this.unwatch(); }
  help() { try { return localStorage.getItem('terra.help') === '1'; } catch (e) { return false; } }
  name() { return this.props.resName || 'gpio'; }
  seed() { let h = 7; for (const ch of this.name() + (this.props.nodeName || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  rnd(i) { const x = Math.sin(this.seed() * 0.001 + i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  // 자원 종류 — 이름에서 (시안). 끝점 [id, 방향, 형식, 인코딩, 수치(이름 · 단위 · 기준 · 폭 · 소수)] — 형식 이름은 Terra 가 쓰는 것(수치 형식만 제안)
  profile() {
    const n = this.name().toLowerCase(), P = (type, eps) => ({ type, eps: eps.map(([id, dir, schema, enc, m]) => ({ id, dir, schema, enc: enc || '', m })) });
    if (/^ssh|:22/.test(n)) return P('service · ssh', [['session', 'source · sink', 'terra.bytes@1']]);
    if (/^tty|serial/.test(n)) return P('serial', [['rx', 'source', 'terra.text@1'], ['tx', 'sink', 'terra.bytes@1']]);
    if (/gpio/.test(n)) return P('gpio', [['pins', 'source', 'terra.input.event@1'], ['level', 'source', 'terra.gpio.level@1', '', ['pin 17', '', 0.5, 0.5, 2]]]);
    if (/cam|frame/.test(n)) return P('camera', [['frames', 'source', 'terra.video.frame@1', 'svg'], ['still', 'source', 'terra.image.frame@1', 'svg'], ['status', 'source', 'terra.camera.status@1']]);
    if (/sensor|stat/.test(n)) return P('sensor', [['temp', 'source', 'terra.sensor.sample@1', '', ['온도', '°C', 41, 4, 1]], ['humid', 'source', 'terra.sensor.sample@1', '', ['습도', '%', 46, 6, 0]]]);
    if (/gpu|infer/.test(n)) return P('compute · gpu', [['infer', 'source · sink', 'terra.inference.response@1'], ['load', 'source', 'terra.gpu.metric@1', '', ['사용률', '%', 62, 25, 0]]]);
    if (/log/.test(n)) return P('log', [['lines', 'source', 'terra.text@1']]);
    if (/proc|exec|enc/.test(n)) return P('process', [['stdout', 'source', 'terra.bytes@1'], ['status', 'source', 'terra.process.status@1']]);
    return P('resource', [['data', 'source', 'terra.bytes@1']]);
  }
  value(m, i, t) { const [, , base, amp, dec] = m, r = (k) => this.rnd(k + i * 7), w = Math.sin(t * (0.25 + r(1) * 0.6) + r(2) * 6) + Math.sin(t * (0.9 + r(3)) + r(4) * 3) * 0.35;
    if (dec === 2) return w + r(5) * 0.6 - 0.3 > 0 ? 1 : 0;   // 디지털 — 0 / 1
    return Math.max(0, base + w * amp * 0.75); }
  // ── 시안 흐름 — 끝점마다 같은 StreamMessage 모양을 만들어 reduceView 에 넣는다 ──
  fake(ep, k, q, t) {
    const b64 = (s) => { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ''; } }, r = (i) => this.rnd(i + q * 0.37);
    const tm = () => { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
    const F = (data, enc) => ({ kind: 'frame', handle_id: 'h-sample', sequence: q, schema_ref: ep.schema, encoding: enc || ep.enc || '', data });
    if (k === 'number') { const v = this.value(ep.m, 0, t); return F(b64(v.toFixed(ep.m[4] === 2 ? 0 : ep.m[4]))); }
    if (k === 'text') { const L = this.name().includes('tty') ? ['AT+CSQ', '+CSQ: 21,99', 'OK', 'RX 0x3e 0x01 · crc ok', 'temp=41.2 hum=46'] : ['sshd[311]: Accepted publickey for ops from 10.0.0.4', 'kernel: usb 1-1: new high-speed USB device', 'terra-daemon: svi heartbeat ok', 'cron[88]: (root) CMD (sync)', 'app[201]: GET /api 200 12ms'];
      return F(b64(tm() + ' ' + L[Math.floor(r(1) * L.length)] + '\n')); }
    if (k === 'event') { const E = /gpio/.test(this.name()) ? [{ type: 'edge', pin: 17, level: r(2) > 0.5 ? 'high' : 'low' }, { type: 'press', button: 'a' }] : /cam/.test(this.name()) ? [{ state: 'streaming', fps: 30, exposure: 'auto' }, { state: 'streaming', fps: 29, gain: 1.2 }]
      : /gpu|infer/.test(this.name()) ? [{ type: 'detection', label: 'person', score: +(0.7 + r(3) * 0.29).toFixed(2) }, { type: 'detection', label: 'car', score: +(0.6 + r(4) * 0.3).toFixed(2) }] : [{ state: 'running', pid: 4211, cpu: +(r(5) * 30).toFixed(1) }, { state: 'running', pid: 4211, rss_mb: 82 }];
      return F(b64(JSON.stringify(E[Math.floor(r(6) * E.length)]))); }
    if (k === 'image' || k === 'video') { const x = 40 + Math.round(120 * (0.5 + 0.5 * Math.sin(q / 6))), y = 50 + Math.round(30 * Math.cos(q / 4)), hue = (q * 7) % 360;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#07101c"/><path d="M0 140 L80 110 L150 128 L230 96 L320 120 L320 180 L0 180Z" fill="#12301f"/>'
        + '<circle cx="' + x + '" cy="' + y + '" r="18" fill="hsl(' + hue + ',70%,60%)" opacity=".85"/><rect x="200" y="60" width="70" height="44" fill="none" stroke="#60e28c" stroke-width="1.5"/><text x="203" y="56" fill="#60e28c" font-size="10" font-family="monospace">person 0.9</text>'
        + '<text x="8" y="172" fill="#9cc4a8" font-size="10" font-family="monospace">' + (k === 'video' ? 'frame ' + q : 'still') + ' · ' + tm() + '</text></svg>';
      return F(b64(svg), 'svg'); }
    const n = 24 + Math.floor(r(7) * 40), B = []; for (let i = 0; i < n; i++) B.push(i % 9 < 5 ? 97 + Math.floor(this.rnd(q + i) * 26) : Math.floor(this.rnd(q * 3 + i) * 256));
    return F(btoa(String.fromCharCode.apply(null, B)));
  }
  tick() {
    const S = this.state, q = S.q + 1, t = Math.floor(q / 4), P = this.profile(), ep = P.eps.find((e) => e.id === S.ep) || P.eps[0]; if (!ep) return;
    const v = viewerOf(ep.schema, ep.enc), key = ep.id; let st = this._vs[key] || (this._vs[key] = viewInit(v.kind));
    const dead = this.rnd(40) < 0.12, down = S.sub && q % 160 >= 120 && q % 160 < 132, back = S.sub && q % 160 === 132;   // dead — 자원이 끊긴 시안(흐름 없음, 원천 쪽 끊김)
    if (dead && S.sub) st = reduceView(st, { kind: 'status', state: 'degraded', reason: 'participant_disconnected' });
    else if (!S.sub) { if (st.conn !== 'stopped' && st.conn !== 'idle') st = reduceView(st, { kind: 'conn', conn: 'stopped' }); }
    else if (st.conn === 'idle' || st.conn === 'stopped') { st = reduceView(st, { kind: 'conn', conn: 'opening' }); st = reduceView(st, { kind: 'status', state: 'active', handle_id: 'h-sample' });
      if (v.kind === 'number' && !st.num.hist.length) for (let k = 59; k >= 1; k--) st = reduceView(st, this.fake(ep, 'number', st.seq + 1, t - k), { now: Date.now() - k * 1000 }); }   // 수치는 지난 60개를 채워 연다(realtime_latest 의 마지막 값처럼)
    else if (down) st = reduceView(st, { kind: 'conn', conn: 'lost', tries: 1 + Math.floor((q % 160 - 120) / 4) });
    else if (back) st = reduceView(st, { kind: 'status', state: 'active' });
    else if (st.conn === 'live' && (v.kind === 'video' || q % 4 === 0)) st = reduceView(st, this.fake(ep, v.kind, (st.seq || 0) + 1 + (q % 97 === 0 ? 2 : 0), t), { hold: S.hold });
    this._vs[key] = st;
    if (t > 0 && q % 44 === 0) { this._ev.push({ at: Date.now(), lv: 'info', msg: ep.id + ' · 프레임 ' + st.frames }); if (this._ev.length > 6) this._ev.shift(); }
    if (q % 160 === 120 && S.sub) this._ev.push({ at: Date.now(), lv: 'warn', msg: '구독 끊김 — 재연결 중 (시안)' });
    this.setState({ q });
  }
  // ── 실제 Tree(웹 빌드 · 로그인) — Master SVI 를 부른다(src/api/svi-read.js = window.TerraSvi). 캔버스 · 실제 지도 밖 노드는 시안 그대로 ──
  RT() {
    const W = typeof window !== 'undefined' ? window : null, TN = W && W.TerraNodes, SV = W && W.TerraSvi, key = this.props.nodeKey || (TN && TN.t.localId());
    if (!TN || !SV || TN.t.kind !== 'gateway' || !key) return null;
    const meta = TN.t.meta || {}, me = meta[key]; if (!me || !me.rid) return null;
    const TP = W.TerraTopology, raw = TP && TP.node ? TP.node(me.rid) : null, parent = (raw && raw.parent_node_id) || '';
    const names = new Map(Object.values(meta).filter((m) => m.rid).map((m) => [m.rid, m.name]));
    const rd = (op, input) => TN.read(key, op, input ? { input, ttl: 10000 } : { ttl: 10000 });
    return { TN, SV, key, rid: me.rid, parent, names, metas: Object.values(meta).filter((m) => m.rid), rd };
  }
  live() { if (this._un || typeof window === 'undefined' || !window.TerraNodes) return; this._un = window.TerraNodes.subscribe(() => this.setState({})); }
  unwatch() { if (this._w) { const w = this._w; this._w = null; try { w.h.stop(); } catch (e) {} } }
  /** 실제 구독 — window.TerraSviWatch(src/api/svi-view.js createSviWatch). 문이 닫혀 있으면 부르지 않는다 */
  watch(R, ep, kind) {
    const W = window, key = R.id + '#' + ep.id; if (this._w && this._w.key === key) return; this.unwatch();
    if (!W.TerraSviWatch) return; this._vs[key] = reduceView(viewInit(kind), { kind: 'conn', conn: 'opening' });
    const h = W.TerraSviWatch.open({ resource_id: R.id, endpoint_id: ep.id, qos: 'realtime_latest' }, (m) => { if (!this._live && this._live !== undefined) return; this._vs[key] = reduceView(this._vs[key] || viewInit(kind), m, { hold: this.state.hold }); this.setState({}); });
    this._w = { key, h };
  }
  /** 값 칸 — 뷰어 종류마다 같은 이름의 값(시안 · 실제 공통) */
  viewVals(eps, epCur, st, o) {
    const S = this.state, v = viewerOf(epCur ? epCur.schema : '', epCur ? epCur.enc : ''), C = connLabel(st), now = Date.now(), H = this.help();
    const T = st.times.filter((t) => now - t <= 3000), fps = T.length < 2 ? 0 : (T.length - 1) / Math.max(0.001, (T[T.length - 1] - T[0]) / 1000);
    const m = epCur && epCur.m, fmtN = (x) => (x == null ? '—' : m && m[4] === 2 ? (x ? 'HIGH' : 'LOW') : (+x).toFixed(m ? m[4] : Math.abs(x) < 10 ? 2 : 1)), N = numStats(st.num.hist);
    const kb = (b) => (b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'KiB' : (b / 1048576).toFixed(1) + 'MiB');
    const meta = [epCur && epCur.schema ? epCur.schema + (epCur.enc ? ' · ' + epCur.enc : '') : '형식 모름', v.label, st.frames ? '프레임 ' + st.frames : '', st.seq ? '#' + st.seq : '', v.kind === 'video' && fps ? fps.toFixed(1) + ' fps' : '', st.bytes ? kb(st.bytes) : '', st.gaps ? '빠짐 ' + st.gaps : ''].filter(Boolean).join(' · ');
    return {
      vEps: eps.map((e) => { const on = epCur && e.id === epCur.id; return { name: e.id, k: viewerOf(e.schema, e.enc).label, cls: on ? 'on' : '', on: on ? 'true' : 'false', pick: () => { this.setState({ ep: e.id }); } }; }), hasVEps: eps.length > 1,
      vMeta: meta, connT: C.label, connCls: C.cls, locked: !!o.lockWhy, lockWhy: o.lockWhy || '', lockAlt: o.lockAlt || '', unlocked: !o.lockWhy && !!epCur, noEp: !epCur,
      subT: (o.sub == null ? S.sub : o.sub) ? '멈춤' : '구독 시작', toggleSub: o.toggleSub || (() => {}), subOff: o.lockWhy || !epCur ? 'disabled' : null,
      holdT: S.hold ? '따라가기' : '꼬리 멈춤', toggleHold: () => this.setState({ hold: !S.hold }),
      isNum: v.kind === 'number', isText: v.kind === 'text', isBytes: v.kind === 'bytes', isImg: v.kind === 'image' || v.kind === 'video', isEvent: v.kind === 'event',
      nowT: fmtN(N.now), unitT: m ? m[0] + (m[1] ? ' · ' + m[1] : '') : '값', minT: fmtN(N.min), avgT: N.avg == null ? '—' : m && m[4] === 2 ? Math.round(N.avg * 100) + '% HIGH' : fmtN(N.avg), maxT: fmtN(N.max),
      bars: N.bars.map((h) => ({ h, col: C.cls === 'warn' ? '#ffd27a' : '#60e28c' })),
      lines: st.lines.slice(-14).map((x) => ({ t: x })), noLines: !st.lines.length,
      hex: hexRows(st.raw, 8), noHex: !st.raw.length,
      imgSrc: st.img || '', hasImg: !!st.img, imgNote: st.imgNote || (st.img ? '' : '프레임 대기'), imgCap: v.kind === 'video' ? (fps ? fps.toFixed(1) + ' fps · ' : '') + (st.imgSize ? kb(st.imgSize) + '/프레임' : '') : st.imgSize ? kb(st.imgSize) : '',
      evRows: st.events.slice(0, 8).map((e) => { const d = new Date(e.at); return { t: [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'), ty: e.type || '—', text: e.text }; }), noEv: !st.events.length,
      apiV: H ? 'svi.handles.post → handles.events' : ''
    };
  }
  // 자원 상태 창 — 실제: 정보 · 끝점(svi.resources.*) · 연결(svi.bindings.get) · 쓰는 곳(svi.handles.get, 10초마다 다시) · 값(핸들 열기 → events — 문이 열려야)
  realVals() {
    const C = this.RT(); if (!C) return null; this.live();
    const SV = C.SV, H = this.help(), W = window, res = C.rd('terra.master.svi.resources.get'), all = SV.resources(res.data);
    const nodeRid = [...C.names.entries()].find(([, nm]) => nm === this.props.nodeName);
    const R = all.find((r) => r.name === this.name() && (!nodeRid || r.node === nodeRid[0])) || all.find((r) => r.name === this.name()) || null;
    const base = { rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.name(), src: this.props.src || '내 자원', srcCls: { 지명: 'nd', 전체: 'sc', 외부: 'ex' }[this.props.src] || 'tr',
      liveT: '', apiR: H ? 'svi.resources' : '', apiB: H ? 'svi.bindings' : '', apiE: H ? 'svi.handles.get · 갱신 : 10s' : '', evH: '쓰는 곳 · 최근 사건' };
    if (!R) { this.unwatch(); return Object.assign(base, this.viewVals([], null, viewInit('bytes'), { lockWhy: '' }), { type: '—', stT: res.loading && !res.data ? '받는 중' : '없음', stCol: '#9aa1ab', node: this.props.nodeName || '—', approve: '—', presence: '—', seen: '—', lease: '—', eps: [], binds: [], noBinds: true,
      events: [{ t: '', lv: 'warn', col: '#ffd27a', msg: res.err && !res.data ? 'svi.resources 미수신 · ' + res.err.code : 'Master SVI 목록에 이 이름 없음' }] }); }
    const bi = C.rd('terra.master.svi.bindings.get'), hd = C.rd('terra.master.svi.handles.get', { resource_id: R.id });
    const binds = SV.bindings(bi.data).filter((b) => b.srcRes === R.id || b.tgtRes === R.id);
    const ok = /available/.test(R.status), busy = binds.length > 0;
    const evs = SV.handleRows(hd.data, R.id).map((e) => Object.assign(e, { col: e.lv === 'warn' ? '#ffd27a' : '#709c80' }));
    if (hd.err && !hd.data) evs.push({ t: '', lv: 'warn', col: '#ffd27a', msg: '쓰는 곳 미수신 · ' + hd.err.code });
    if (!evs.length) evs.push({ t: '', lv: 'info', col: '#709c80', msg: hd.loading && !hd.data ? '받는 중…' : '쓰는 곳 없음' });
    // 값 — 내보내는 끝점만. 문이 닫혀 있으면 잠그고 이유 · 대체(쓰는 곳 조회)를 옆에
    const vis = R.eps.filter((e) => /source|duplex/.test(e.dir)).map((e) => ({ id: e.id, dir: e.dir, schema: e.schema || '', enc: '' }));
    const epCur = vis.find((e) => e.id === this.state.ep) || vis[0] || null, kind = viewerOf(epCur ? epCur.schema : '').kind;
    const G = W.TerraGateAll ? W.TerraGateAll(WATCH_OPS) : { open: false, why: '잠김 : 문 판정(TerraGate) 없음' };
    const vkey = epCur ? R.id + '#' + epCur.id : '';
    if (!G.open || !this.state.rsub || !epCur) this.unwatch(); else this.watch(R, epCur, kind);
    const st = (vkey && this._vs[vkey]) || viewInit(kind);
    const V = this.viewVals(vis, epCur, G.open ? st : viewInit(kind), { lockWhy: G.open ? '' : G.why, lockAlt: '대신 : 아래 ‘쓰는 곳’ (svi.handles.get · 갱신 : 10s)', toggleSub: () => this.setState({ rsub: !this.state.rsub }), sub: this.state.rsub });
    if (!G.open) { V.connT = '잠김'; V.connCls = 'dim'; V.subT = '구독 시작'; }
    return Object.assign(base, V, { type: R.kind || 'resource', stT: !ok ? R.status || '알 수 없음' : busy ? '사용 중' : '사용 가능', stCol: !ok ? '#ff9c8c' : busy ? '#ffd27a' : '#60e28c',
      node: C.names.get(R.node) || R.node || '—', approve: '—', presence: R.status || '—', seen: '—', lease: '—',
      eps: R.eps.map((e) => ({ id: e.id, dir: e.dir, schema: [e.interaction, e.schema].filter(Boolean).join(' · ') || '—' })),
      binds: binds.map((b) => ({ to: (b.srcRes === R.id ? '→ ' + (C.names.get(b.tgtNode) || b.tgtNode) + ' › ' + b.tgtRes + (b.tgtEp ? '#' + b.tgtEp : '') : '← ' + (C.names.get(b.srcNode) || b.srcNode) + ' › ' + b.srcRes), q: QOS_KO[b.qos] || b.qos, rate: b.state + (b.reason ? ' · ' + b.reason : '') })),
      noBinds: binds.length === 0, events: evs });
  }
  renderVals() {
    const RV = this.realVals(); if (RV) return RV;
    const S = this.state, t = Math.floor(S.q / 4), P = this.profile(), H = this.help(), r = (i) => this.rnd(i), src = this.props.src || '내 자원';
    const down = r(40) < 0.12, busy = r(41) < 0.5;
    const vis = P.eps.filter((e) => /source/.test(e.dir)), epCur = vis.find((e) => e.id === S.ep) || vis[0] || null;
    const st = (epCur && this._vs[epCur.id]) || viewInit(viewerOf(epCur ? epCur.schema : '', epCur ? epCur.enc : '').kind);
    if (!this._ev.length) { const t0 = Date.now(); [['info', '선언됨 · 승인'], ['info', '연결 → store/data'], ['info', 'lease 갱신'], [down ? 'warn' : 'info', down ? 'presence missing' : 'presence ok']].forEach((e, k) => this._ev.push({ at: t0 - (4 - k) * 61000, lv: e[0], msg: e[1] })); }
    const tm = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
    const peer = ['02·a', '02·c', '02', '01·a'][Math.floor(r(30) * 4)];
    const binds = down ? [] : busy ? [[peer, 'store/data', '신뢰 순서', Math.round(20 + r(31) * 80) + 'KB/s']] : [];
    const stT = down ? '끊김' : binds.length ? '사용 중' : '사용 가능', stCol = down ? '#ff9c8c' : binds.length ? '#ffd27a' : '#60e28c';
    const V = this.viewVals(vis, epCur, st, { lockWhy: '', toggleSub: () => this.setState({ sub: !S.sub }) });
    return Object.assign({
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.name(), type: P.type, stT, stCol, src, srcCls: { 지명: 'nd', 전체: 'sc', 외부: 'ex' }[src] || 'tr',
      node: this.props.nodeName || '02·b', approve: down ? '승인 · 없음' : '승인', presence: down ? 'missing' : 'present', seen: down ? Math.floor(40 + r(32) * 200) + 's 전' : '방금', lease: Math.floor(20 + r(33) * 40) + 'm 남음',
      liveT: '시안', eps: P.eps.map((e) => ({ id: e.id, dir: e.dir, schema: e.schema + (e.enc && H ? ' · ' + e.enc : '') })),
      binds: binds.map(([to, ep, q, rate]) => ({ to: to + ' › ' + ep, q, rate })), noBinds: binds.length === 0,
      events: this._ev.slice().reverse().map((e) => ({ t: tm(e.at), lv: e.lv, col: e.lv === 'warn' ? '#ffd27a' : '#709c80', msg: e.msg })), evH: '최근 이벤트',
      apiR: H ? 'svi.resources' : '', apiB: H ? 'svi.bindings' : '', apiE: ''
    }, V);
  }
}
