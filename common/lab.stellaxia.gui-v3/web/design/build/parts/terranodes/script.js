// 노드 데이터 층 — 노드에 딸린 것(설정 · 모듈 · 장치 · 자원 · 작업)은 그 노드가 원본이다. GUI 는 사본(캐시)만 들고, 어느 화면이든 이 층을 거친다.
//
// 분할 정책 PA/EL (PACELC)
//   P(분할 — 노드가 꺼졌거나 Master 중계가 끊김): 가용성. 마지막 사본(이 브라우저의 캐시, 없으면 Master 가 마지막으로 관측한 값)을 그대로 보여 준다.
//      나이와 출처를 같이 단다('끊김 · 3분 전 · Master 관측'). 그 노드에서 해야 하는 쓰기는 하지 않는다 — 몰래 쌓아 두었다가 나중에 보내지 않는다(되살아날 때 낡은 의도가 덮어쓴다).
//      단, Master 가 원하는 상태(desired)로 받는 것(모듈 배포 지정)은 노드가 없어도 Master 에 적는다 — 노드가 돌아오면 스스로 맞춘다.
//   E(평소): 지연 우선. 사본을 즉시 돌려주고, 나이가 TTL 을 넘었으면 뒤에서 새로 받는다(stale-while-revalidate). 쓰기는 사본에 먼저 반영(낙관)하고 실패하면 되돌린다.
// 로컬 노드(이 GUI 를 띄운 노드)는 로컬 Gateway 로 바로, 다른 노드는 Gateway 의 노드 주소 호출(Master 중계, 직계 자식만 — 아니면 DELEGATION_REQUIRED · via)로 간다.
// 제어기의 바탕 구성(아이콘 · 배경 · 독 · 모양)은 그 노드가 원본이다(desk* 메서드 — 아래). 창 배치 · 열린 앱 같은 PC 상태만 view() 로 이 브라우저(terra.pc.*)에 둔다 — 계정 문서로 올리지 않는다.
//
// 전송(transport)은 갈아 끼운다: window.TerraTransport 가 있으면 그것(웹 빌드 — Gateway), 없으면 목업(캔버스 — 노드 쪽 값을 이 브라우저에 두고 지연 · 끊김을 흉내).
//   transport = { kind, localId(), bindScene?(장면 로컬 id, 노드 메타들), meta?, invoke(nodeId, opId, input) → Promise<data> (실패: { code, status, retryable }), invokeRid?(rid, opId, input, { signal }) → Promise<data>, master?(nodeId, res) → Promise<data> }

// 노드의 GUI 데이터(프로필 그림 · 스킨 구 파일 · 그 경로를 적은 속성표)도 그 노드가 원본이다 — lab.stellaxia.gui-v3 백엔드가 그 노드의 모듈 데이터에 둔다.
//   쓰기: 그 노드를 먼저 고치고, 성공해야 사본을 바꾼다(낙관 없음). 끊겼으면 하지 않는다. 읽기: 속성표는 자원 props, 파일은 blob() — 경로에 시각이 들어 있어 내용이 바뀌지 않으므로 한 번 받으면 끝(IndexedDB 에 남아 끊겨도 보인다)
const NODE_OP = 'lab.stellaxia.gui-v3.node-', OP_PATCH = NODE_OP + 'props.patch', OP_GET = NODE_OP + 'files.get', OP_PUT = NODE_OP + 'files.put', OP_DEL = NODE_OP + 'files.delete';
const DATA_DIR = '/데이터/', READ_STEP = 480 * 1024, WRITE_STEP = 640 * 1024, BLOB_KEEP = 24, BLOB_RETRY = 30000;   // 읽기 조각 — 다른 노드 응답 상한(768 KiB) 안, 3 의 배수라 base64 를 그대로 잇는다
const safeFile = (s, d) => String(s || d).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '_').slice(0, 100) || d;
const bytesOf = (b64) => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
const b64Of = (u8) => { let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(bin); };
const IDB = {   // 파일 사본 — localStorage 에는 너무 크다. 안 되는 환경이면 조용히 메모리만
  db: null,
  open() { if (this.db) return this.db; return (this.db = new Promise((ok, no) => { const q = indexedDB.open('terra.node-blobs', 1); q.onupgradeneeded = () => q.result.createObjectStore('f'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); })); },
  async run(mode, f) { const db = await this.open(); return new Promise((ok, no) => { const tx = db.transaction('f', mode), q = f(tx.objectStore('f')); tx.oncomplete = () => ok(q.result); tx.onerror = () => no(tx.error); }); },
  get(k) { return this.run('readonly', (s) => s.get(k)).catch(() => null); },
  async put(k, v) { try { if (await this.run('readonly', (s) => s.count()) > 64) await this.run('readwrite', (s) => s.clear()); await this.run('readwrite', (s) => s.put(v, k)); } catch (e) {} },
  clear() { return this.run('readwrite', (s) => s.clear()).catch(() => {}); },
};

const RES = {   // 자원 이름 → 읽기 operation · TTL(ms) · 끊겼을 때 Master 의 관측으로 대신할 길
  status:  { op: 'terra.daemon.status.get', ttl: 5000, master: 'terra.master.nodes.by-node-id.get' },
  config:  { op: 'terra.daemon.config.get', ttl: 60000 },
  modules: { op: 'terra.daemon.modules.get', ttl: 15000, master: 'terra.master.nodes.by-node-id.modules.get' },
  offers:  { op: 'terra.daemon.modules.offers.get', ttl: 30000 },
  devices: { op: 'terra.daemon.io.devices.get', ttl: 15000 },
  tasks:   { op: 'terra.daemon.tasks.get', ttl: 5000 },
  svi:     { op: 'terra.daemon.svi.declarations.get', ttl: 30000 },
  wg:      { op: 'terra.daemon.wireguard.status.get', ttl: 15000 },
  tunnels: { op: 'terra.daemon.service-tunnels.get', ttl: 15000 },
  enroll:  { op: 'terra.daemon.enrollment.status.get', ttl: 60000 },
  props:   { op: 'lab.stellaxia.gui-v3.node-props.get', ttl: 60000, retry: 60000 },   // 속성표 — 지도가 노드마다 읽으므로 드물게(끊긴 노드는 1분에 한 번)
  // 제어기(노드 데스크톱) 묶음 — 위 자원들을 한 화면 모양으로. 목업은 보드 씨앗, 웹 빌드 전송은 operation 여럿을 불러 묶는다(desk.js)
  tombs:   { op: 'terra.daemon.io.tombstones.get', ttl: 15000 },   // 지운 장치 기록 — 지운 기록 목록(계약 입력 없음 · node.read · local + cluster)
  desk:    { op: 'gui-v3.desk', ttl: 15000, compose: ['config', 'modules', 'offers', 'devices', 'tombs', 'tasks', 'svi', 'wg', 'tunnels', 'enroll'] }
};
const PARTITION = new Set(['NODE_OFFLINE', 'RELAY_NOT_CONNECTED', 'NETWORK', 'TIMEOUT', 'GATEWAY_UNREACHABLE', 'UPSTREAM_UNREACHABLE', 'MODULE_INVOCATION_TIMEOUT', 'RELAY_SEND_FAILED']);   // 이 코드면 분할로 본다
// 바탕 구성(desk) — 노드가 원본. 키는 전부 Terra node_id(rid). 설계 docs/design/node-owned-desk.md §7 · §8 · §10 · §12 · §13
const OP_DESK_GET = NODE_OP + 'desk.get', OP_DESK_PATCH = NODE_OP + 'desk.patch', OP_LIST = NODE_OP + 'files.list';
const WALL_DIR = 'desk/wall', WALL_MAX = 2.5 * 1024 * 1024, WALL_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };   // 배경 그림 — 서버 허용 형식 · 2.5 MiB(§6.3)
const clipBytes = (s, n) => { let out = '', b = 0; for (const ch of String(s == null ? '' : s)) { const w = new TextEncoder().encode(ch).length; if (b + w > n) break; out += ch; b += w; } return out; };   // UTF-8 바이트 기준 자르기(서버 이름 상한)
const DESK_POLL = 5000, DESK_OLD = 60000, DESK_ABORT = 8000, PROPS_EVERY = 30000, DESK_WAKE_GAP = 500, DESK_TICK = 500, DESK_PATCH_ABORT = 25000, DESK_STALE = DESK_POLL + DESK_ABORT;   // 폴링 · 옛 버전 재시도 · 읽기 상한 · 프로필 주기 · 연속 깨움 무시 · 낡음(5초 + 폴링 제한 8초 = 13초)
const DESK_CONFLICT_MSG = '다른 곳에서 먼저 바뀌었습니다';
const DESK_SAVE0 = () => ({ state: 'idle', at: 0, code: '', msg: '', lost: [] });
const deskStateOf = (code) => (code === 'OPERATION_NOT_REMOTE' || code === 'MODULE_ROUTE_NOT_FOUND' ? 'old' : code === 'MODULE_UNAVAILABLE' ? 'down' : code === 'MODULE_PERMISSION_DENIED' ? 'denied' : code === 'DELEGATION_REQUIRED' ? 'far' : code === 'NODE_NOT_FOUND' || code === 'NODE_UNMAPPED' ? 'none' : code === 'NO_NODE' ? 'norid' : PARTITION.has(code) ? 'offline' : 'error');   // HTTP 상태는 보지 않는다 — 코드만(§13)
const DESK_MSG = { old: '이 노드의 gui-v3가 옛 버전이라 바탕 구성을 읽고 쓸 수 없습니다', down: '그 노드의 gui-v3가 꺼져 있음', denied: '바탕 구성을 읽을 권한이 없음', far: '직접 닿지 않는 노드', none: 'Terra 에 없는 노드', norid: '노드 id 가 없음', offline: '노드와 끊김', error: '바탕 구성을 읽지 못함' };
const jclone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };

class NodeStore {
  constructor(transport) {
    this.t = transport; this.shapes = {}; this.subs = new Set(); this.inflight = new Map(); this.links = new Map(); this.views = new Map();
    this.cache = new Map(Object.entries(LS.get('terra.cache') || {}));   // 새로 띄워도 마지막 사본이 남는다(끊긴 채 시작해도 보인다)
    this._saveT = 0;
    this.blobs = new Map(); this.gen = 0; this.rbg = new Map();   // rbg — 장면 id 가 다른 노드로 다시 묶인 횟수(늦은 응답을 거른다)
    this.pendingRes = new Map();   // 진행 중인 쓰기의 표시층 — 자원 키 → Set({ apply, mark }). 저장하지 않는다(cache 밖). 사본(e.data)은 노드가 준 값만
    // 바탕 구성 — 사본은 this.cache 의 rid|nodedesk 한 항목({revision, doc}). 아래는 저장하지 않는다(표시층 · 전송 · 상태 · watch)
    this.deskDefaults = { icons: {}, prefs: {} };   // Embed 가 등록 — 표시와 첫 쓰기에만
    this.pendingDesk = new Map(); this.desks = new Map(); this.deskSends = new Map(); this.watched = new Map(); this._deskT = null; this._deskOn = false;
    this._deskWake = () => this.deskWake();
  }
  key(n, r, inp) { return n + '|' + r + (inp ? '|' + JSON.stringify(inp) : ''); }   // 입력이 있는 읽기(모듈 로그 · 모듈 설정 스키마)는 입력마다 따로
  emit(n) { for (const f of this.subs) { try { f(n); } catch (e) {} } }
  subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); }
  persist() { clearTimeout(this._saveT); this._saveT = setTimeout(() => { if (!this.cache.size) { try { localStorage.removeItem('terra.cache'); } catch (e) {} return; } const o = {}; for (const [k, v] of this.cache) o[k] = v; if (!LS.set('terra.cache', o)) LS.set('terra.cache', {}); }, 400); }
  isLocal(n) { return n === this.t.localId(); }
  link(n) { if (this.isLocal(n)) return { state: 'local' }; return this.links.get(n) || { state: 'unknown' }; }
  setLink(n, L) { const o = this.links.get(n); this.links.set(n, Object.assign({}, L, { at: Date.now() })); if (!o || o.state !== L.state || o.code !== L.code) this.emit(n); }

  /** 읽기 — 사본을 바로(EL). 없거나 낡았으면 뒤에서 받는다. 끊겼으면 사본(PA). o.input — 그 operation 의 입력(자원 이름 대신 op id 를 줄 때) */
  read(n, res, o = {}) {
    const R = RES[res] || { op: res, ttl: 15000 }, k = this.key(n, res, o.input), e = this.cache.get(k), now = Date.now(), age = e ? now - e.at : Infinity, L = this.link(n);
    const wait = !o.force && ((L.state === 'offline' && L.retryAt > now) || (e && e.err && now - (e.errAt || 0) < (e.err.code === 'UNAUTHENTICATED' ? 5000 : R.retry || 5000)));   // 끊긴 노드 · 실패한 자원은 5초에 한 번만 다시 두드린다(그리기마다 부르지 않게)
    if ((age > (o.ttl ?? R.ttl) || o.force) && !wait && !this.inflight.has(k)) this.refresh(n, res, o.input);
    const ov = this.pendingRes.get(k), data = e ? e.data : null;
    return { data, view: ov && ov.size && data != null ? this.applyView(data, ov) : data, pending: new Set(ov ? [...ov].map((x) => x.mark).filter(Boolean) : []), busy: ov ? ov.size : 0, at: e ? e.at : 0, age, src: e ? e.src : '', stale: age > (o.ttl ?? R.ttl), loading: this.inflight.has(k), link: L, err: e && e.err };
  }
  /** 노드 값(data)에 진행 중인 쓰기의 apply 를 차례로 얹은 표시용 값 — data 는 건드리지 않는다(복제해서) */
  applyView(data, ov) { let v = jclone(data); for (const x of ov) { try { v = x.apply(v); } catch (err) { /* 표시층 오류는 노드 값으로 */ } } return v; }
  refresh(n, res, input) {
    const R = RES[res] || { op: res }, k = this.key(n, res, input);
    if (this.inflight.has(k)) return this.inflight.get(k);
    const rb = this.rbg.get(n) | 0, g0 = this.gen, stale = () => (this.rbg.get(n) | 0) !== rb || this.gen !== g0;   // gen — 로그아웃(clear)이 그 사이 있었으면 앞 사람의 응답이다   // 그 사이 장면 id 가 다른 노드로 묶였으면 이 응답은 옛 노드 것이다
    const p = this.fetchRes(n, res, R, input).then((data) => {
      if (stale()) return;
      this.cache.set(k, { data, at: Date.now(), src: this.isLocal(n) ? '로컬' : '노드' }); if (!this.isLocal(n)) this.setLink(n, { state: 'online' });   // 받았으면 지난 오류는 지운다
    }, (err) => {
      if (stale()) return;
      const code = (err && err.code) || 'ERROR', e0 = this.cache.get(k);
      this.cache.set(k, Object.assign({}, e0 || { data: null, at: 0 }, { err: { code, msg: err && err.message }, errAt: Date.now() }));   // 사본은 그대로 두고 오류만 단다(5초 동안 다시 안 부름)
      if (PARTITION.has(code)) {
        this.setLink(n, { state: 'offline', code, retryAt: Date.now() + 5000 });
        // 사본이 없으면 Master 가 마지막으로 관측한 값으로 (가능한 자원만)
        if (!(e0 && e0.data) && R.master && this.t.master) return this.t.master(n, R.master).then((data) => { if (stale()) return; this.cache.set(k, { data, at: Date.now(), src: 'Master 관측', observed: true, err: { code }, errAt: Date.now() }); }, () => {});
      } else if (code === 'DELEGATION_REQUIRED') this.setLink(n, { state: 'far', code, via: err.via || '' });
      else if (code === 'NODE_NOT_FOUND' || code === 'NODE_UNMAPPED') this.setLink(n, { state: 'none', code });
    }).finally(() => { if (this.inflight.get(k) === p) this.inflight.delete(k); if (this.gen === g0) this.persist(); this.emit(n); });
    this.inflight.set(k, p); this.emit(n);
    return p;
  }

  // 묶음 자원(compose) — 목업은 한 번에, 실제 전송은 operation 들을 함께 불러 보드의 모양(shapes[res])으로. 다 분할로 실패하면 분할
  fetchRes(n, res, R, input) {
    const meta = (this.t.meta && this.t.meta[n]) || { id: n };
    if (!R.compose || this.t.kind === 'mock' || !this.shapes[res]) return this.t.invoke(n, R.op, input || {}).then((d) => (this.t.kind !== 'mock' && this.shapes[res] ? this.shapes[res](d, meta) : d));
    return Promise.allSettled(R.compose.map((r) => this.t.invoke(n, RES[r].op, {}))).then((rs) => {
      const P = {}; let fail = null, ok = 0;
      rs.forEach((x, i) => { if (x.status === 'fulfilled') { P[R.compose[i]] = x.value; ok++; } else if (!fail || PARTITION.has(x.reason && x.reason.code)) fail = x.reason; });
      if (!ok) throw fail || { code: 'ERROR' };
      return this.shapes[res](P, meta);
    });
  }
  /**
   * 쓰기 — 끊겼으면 하지 않는다(PA: 몰래 쌓지 않음). o.apply(data) → 새 값은 사본이 아니라 표시층(pendingRes)에만: read().view 에 보이고 data 는 노드가 준 값 그대로.
   *   성공해도 사본의 at 을 바꾸지 않는다 — 노드에서 다시 읽은 값만 사본이 된다. 다시 읽기가 끝나면(실패해도) 표시층을 걷는다(낙관 값이 사본으로 남지 않는다). 실패하면 바로 걷는다.
   *   o.mark — read().pending 에 실릴 이름(진행 중 행 표시: 'mod:<id>' 따위). o.refresh === false 면 다시 읽지 않고 바로 걷는다
   */
  write(n, opId, input, o = {}) {
    const L = this.link(n);
    if (L.state === 'offline' || L.state === 'far' || L.state === 'none') return Promise.reject({ code: 'PARTITIONED', message: (L.state === 'far' ? '직접 닿지 않는 노드' : '노드와 끊김') + ' — 재연결 후 재시도' });
    const k = o.res ? this.key(n, o.res) : null, gen = this.gen; let ov = null;
    if (k && o.apply) { ov = { apply: o.apply, mark: o.mark || '' }; let m = this.pendingRes.get(k); if (!m) this.pendingRes.set(k, m = new Set()); m.add(ov); this.emit(n); }
    const drop = () => { if (ov && gen === this.gen) { const m = this.pendingRes.get(k); if (m) { m.delete(ov); if (!m.size) this.pendingRes.delete(k); } this.emit(n); } };
    return this.t.invoke(n, opId, input, o).then((r) => {
      if (gen !== this.gen) return r;
      if (k && o.refresh !== false) this.refreshAfter(n, o.res).then(drop, drop); else drop();
      return r;
    }, (err) => { drop(); if (gen === this.gen && PARTITION.has(err && err.code)) { this.setLink(n, { state: 'offline', code: err.code }); this.emit(n); } throw err; });
  }
  /** 진행 중인 읽기가 있으면 그것이 끝난 뒤(그건 쓰기 전 값일 수 있다) 새로 한 번 읽는다 */
  refreshAfter(n, res) { const cur = this.inflight.get(this.key(n, res)); return Promise.resolve(cur).catch(() => {}).then(() => this.refresh(n, res)); }

  /** 장면 id 가 다른 노드(rid)로 다시 묶였다(지도가 바뀌어 순번이 밀림) — 그 id 의 사본 · 링크 · 받는 중 표시를 지운다. 옛 노드 값이 새 노드 화면에 보이지 않게(§9.2) */
  rebound(ids) {
    for (const id of ids || []) {
      const pre = id + '|';
      for (const k of [...this.cache.keys()]) if (k.startsWith(pre)) this.cache.delete(k);
      for (const k of [...this.inflight.keys()]) if (k.startsWith(pre)) this.inflight.delete(k);
      for (const k of [...this.blobs.keys()]) if (k.startsWith(pre)) this.blobs.delete(k);
      this.links.delete(id); this.rbg.set(id, (this.rbg.get(id) | 0) + 1);
    }
    this.persist(); for (const id of ids || []) this.emit(id);
  }
  /** 보낼 operation 이 없는 저장 전 초안 — 사본만 고친다(노드로 보내지 않는다 · 다음 받기에 노드 값으로 돌아온다) */
  draft(n, res, apply) { const k = this.key(n, res), e = this.cache.get(k); if (!e) return false; this.cache.set(k, Object.assign({}, e, { data: apply(e.data) })); this.emit(n); return true; }
  /** 그 노드의 속성표 — 사본을 바로, 낡았으면 뒤에서 받는다. props 는 아직 모르면 null */
  nodeProps(n) { const r = this.read(n, 'props'); return { props: (r.data && r.data.props) || null, at: r.at, link: r.link, loading: r.loading, err: r.err }; }
  /** 받아 둔 속성표만 — 묻지 않는다(목록을 그릴 때 모든 노드를 두드리지 않게) */
  peekProps(n) { const e = this.cache.get(this.key(n, 'props')); return (e && e.data && e.data.props) || null; }
  /** 노드 파일 사본 { url(data:), mime } — 없으면 뒤에서 받고 null. 다 받으면 emit */
  blob(n, rel) {
    const k = n + '|' + rel, e = this.blobs.get(k);
    if (e && e.url) return e;
    if (!e || (!e.busy && Date.now() - e.errAt > BLOB_RETRY)) this.loadBlob(n, rel, k);
    return null;
  }
  /** 파일을 글자로 (스킨 구 파일) */
  blobText(n, rel) { const B = this.blob(n, rel); return B ? new TextDecoder().decode(bytesOf(B.url.slice(B.url.indexOf(',') + 1))) : ''; }
  remember(k, mime, b64) { this.blobs.delete(k); this.blobs.set(k, { url: 'data:' + mime + ';base64,' + b64, mime }); for (const q of this.blobs.keys()) { if (this.blobs.size <= BLOB_KEEP) break; if (this.blobs.get(q).url) this.blobs.delete(q); else break; } }
  async loadBlob(n, rel, k) {
    const gen = this.gen; this.blobs.set(k, { busy: true, errAt: 0 });
    try {
      let v = await IDB.get(k);
      if (!v) { v = await this.fetchBlob(n, rel); IDB.put(k, v); }
      if (gen !== this.gen) return;
      this.remember(k, v.mime, v.b64); this.emit(n);
    } catch (err) { if (gen === this.gen) this.blobs.set(k, { busy: false, errAt: Date.now() }); }
  }
  async fetchBlob(n, rel) {
    let off = 0, b64 = '', mime = '';
    for (;;) {
      const d = await this.t.invoke(n, OP_GET, { path: rel, offset: off, limit: READ_STEP }), s = d.data || '', pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, got = s.length * 3 / 4 - pad;
      b64 += s; mime = d.mime || mime; off += got;
      if (!got || off >= d.size) return { mime, b64 };
    }
  }
  /** 바꿀 수 있나 — 끊겼거나 닿지 않는 노드는 표시만 한다 */
  canWrite(n) { const s = this.link(n).state; return s !== 'offline' && s !== 'far' && s !== 'none'; }
  async putNodeFile(n, rel, u8, mime) {
    let off = 0, retried = false;
    while (off < u8.length) {
      const chunk = u8.subarray(off, Math.min(u8.length, off + WRITE_STEP));
      try { off = (await this.t.invoke(n, OP_PUT, { path: rel, mime, data: b64Of(chunk), offset: off, total: u8.length })).received; }
      catch (e) { if (e && e.code === 'CHUNK_OUT_OF_ORDER' && !retried) { retried = true; off = 0; continue; } throw e; }
    }
  }
  /** 속성 key 를 그 노드의 파일 하나로(file 이 null 이면 지운다) — 그 노드의 지금 값을 읽고 → 파일 → 속성표 → 사본 → 지난 파일. 어디서 실패하든 사본은 그대로 */
  async setNodeFile(n, key, field, file) {
    if (!this.canWrite(n)) throw { code: 'PARTITIONED', message: '노드와 끊김 — 표시만 되고 바꿀 수 없음' };
    const g0 = this.gen;
    try {
      const got = await this.t.invoke(n, RES.props.op, {}), cur = got && got.props && got.props[key], oldV = (cur && cur[field]) || '', old = oldV.startsWith(DATA_DIR) ? oldV.slice(DATA_DIR.length) : '';
      if (file) await this.putNodeFile(n, file.rel, file.bytes, file.mime);
      const r = await this.t.invoke(n, OP_PATCH, { set: { [key]: file ? { [field]: DATA_DIR + file.rel } : null } });
      if (g0 !== this.gen) return r.props;
      this.cache.set(this.key(n, 'props'), { data: r, at: Date.now(), src: this.isLocal(n) ? '로컬' : '노드' });
      if (file) { const k = n + '|' + file.rel, v = { mime: file.mime, b64: b64Of(file.bytes) }; IDB.put(k, v); this.remember(k, v.mime, v.b64); }
      if (old && (!file || old !== file.rel)) await this.t.invoke(n, OP_DEL, { path: old }).catch(() => {});
      this.persist(); this.emit(n);
      return r.props;
    } catch (err) {
      if (PARTITION.has(err && err.code)) this.setLink(n, { state: 'offline', code: err.code, retryAt: Date.now() + 5000 });
      throw err;
    }
  }
  /** 프로필 — f: { name, mime, data(data: URL) } · null = 지우기 */
  setProfile(n, f) { return this.setNodeFile(n, 'profile', 'image', f ? { rel: 'profile/image/' + Date.now().toString(36) + '-' + safeFile(f.name, 'profile'), mime: f.mime, bytes: bytesOf(f.data.slice(f.data.indexOf(',') + 1)) } : null); }
  /** 스킨 — 보관함의 구 파일을 그 노드로 복사한다. s: { id, text } · null = 기본 무늬 */
  setSkin(n, s) { return this.setNodeFile(n, 'skin', 'file', s ? { rel: 'skin/' + safeFile(s.id, 'skin') + '-' + Date.now().toString(36) + '.json', mime: 'application/json', bytes: new TextEncoder().encode(s.text) } : null); }

  // ───────────── 바탕 구성(desk) — 메서드 이름은 desk 로 시작 ─────────────
  deskKey(rid) { return rid + '|nodedesk'; }   // 입력을 키에 넣지 않는다(revision 마다 항목이 늘지 않게)
  deskMeta(rid) { let D = this.desks.get(rid); if (!D) this.desks.set(rid, D = { seq: 0, applied: 0, fetching: 0, cur: null, lastStart: 0, nextAt: 0, tmo: 0, got: false, st: '', code: '', msg: '' }); return D; }
  deskSend(rid) { let S = this.deskSends.get(rid); if (!S) this.deskSends.set(rid, S = { sending: false, queue: new Map(), waiters: [], retry: null, failed: null, lost: new Set(), ver: 0, save: DESK_SAVE0() }); return S; }
  deskIsOk(rid) { const D = this.desks.get(rid); return !!D && (D.st === 'ok' || D.st === 'empty'); }
  /** 사본(노드가 준 값) · 표시층 · 상태 — 동기, 요청을 일으키지 않는다 */
  deskRead(rid) {
    const e = rid ? this.cache.get(this.deskKey(rid)) : null, D = rid ? this.desks.get(rid) : null, S = rid ? this.deskSends.get(rid) : null, pm = rid ? this.pendingDesk.get(rid) : null, now = Date.now();
    const state = !rid ? 'norid' : (D && D.st) || 'loading', code = !rid ? 'NO_NODE' : (D && D.code) || '', msg = !rid ? DESK_MSG.norid : (D && D.msg) || '';
    const doc = (e && e.data && e.data.doc) || null, age = e && e.at ? now - e.at : Infinity;
    let sv = S ? S.save : DESK_SAVE0();
    if (S && S.lost.size) { const own = sv.state === 'failed' && sv.code; sv = { state: 'failed', at: sv.at, code: own ? sv.code : 'REVISION_CONFLICT', msg: own ? sv.msg : DESK_CONFLICT_MSG, lost: [...S.lost] }; }   // 잃은 키는 사용자가 닫을 때까지 failed — 뒤따른 성공이 덮지 않는다
    return { rid, revision: (e && e.data && e.data.revision) | 0, doc, view: this.deskView(doc, pm), pending: new Set(pm ? pm.keys() : []), at: e ? e.at : 0, age, state, code, msg,
      save: { state: sv.state, at: sv.at, code: sv.code, msg: sv.msg, lost: sv.lost.slice() }, ro: state !== 'ok' && state !== 'empty', stale: age > DESK_STALE };
  }
  /** 노드 값(없으면 기본값)에 표시층을 얹은 것 — 사본은 건드리지 않는다 */
  deskView(doc, pm) {
    const v = jclone(doc || this.deskDefaults || {}) || {}; v.icons = v.icons || {}; v.prefs = v.prefs || {};
    if (pm) for (const [k, val] of pm) {
      if (k === 'wall') { if (val == null) delete v.wall; else v.wall = jclone(val); continue; }
      const i = k.indexOf('.'), g = k.slice(0, i), f = k.slice(i + 1);
      if ((g === 'icons' || g === 'prefs') && f) { if (val == null) delete v[g][f]; else v[g][f] = jclone(val); }
    }
    return v;
  }
  /** 전용 읽기 — read · refresh 를 쓰지 않는다. since_revision 은 사본의 revision, unchanged 면 사본 유지 + at 만 갱신. 실패해도 던지지 않고 true/false */
  deskFetch(rid, o = {}) {
    if (!rid) return Promise.resolve(false);
    const D = this.deskMeta(rid), gen = this.gen, k = this.deskKey(rid);
    if (D.fetching && !o.force) return D.cur || Promise.resolve(false);
    const my = ++D.seq, e = this.cache.get(k), input = {};
    if (e && e.data && typeof e.data.revision === 'number') input.since_revision = e.data.revision;
    const ac = typeof AbortController === 'function' ? new AbortController() : null; let timer = 0, onAbort = null;
    const abort = new Promise((_, no) => { if (ac) { onAbort = () => no({ code: 'TIMEOUT', message: '그 노드가 ' + DESK_ABORT / 1000 + '초 안에 답하지 않음' }); ac.signal.addEventListener('abort', onAbort); timer = setTimeout(() => ac.abort(), DESK_ABORT); } });
    D.fetching++; const started = D.lastStart = Date.now();
    const call = typeof this.t.invokeRid === 'function' ? this.t.invokeRid(rid, OP_DESK_GET, input, { signal: ac ? ac.signal : undefined }) : Promise.reject({ code: 'NO_TRANSPORT', message: '이 전송은 노드 id 호출을 지원하지 않음' });
    const p = Promise.race([call, abort]).then((res) => {
      if (gen !== this.gen || my < D.applied) return false;   // 늦은 응답 — 요청 순번으로 거른다(revision 비교는 복원 때 영구히 낡는다)
      const now = Date.now(), prev = this.cache.get(k);
      if (res && res.unchanged && prev && prev.data) this.cache.set(k, Object.assign({}, prev, { at: now }));
      else if (res && typeof res.revision === 'number' && !res.unchanged) this.cache.set(k, { data: { revision: res.revision, doc: res.doc == null ? null : res.doc }, at: now, src: this.isLocal(rid) ? '로컬' : '노드' });
      else throw { code: 'BAD_RESPONSE', message: '바탕 구성 응답이 이상함' };
      D.applied = my; const c = this.cache.get(k).data; D.st = c.revision === 0 || !c.doc ? 'empty' : 'ok'; D.code = ''; D.msg = ''; D.tmo = 0; D.nextAt = started + DESK_POLL;   // 주기는 시작 기준(느린 응답이 간격을 늘리지 않게 · 이미 지났으면 다음 tick)
      if (c.revision > 0) D.got = true; this.persist(); return true;
    }).catch((err) => {
      if (gen !== this.gen || my < D.applied) return false;
      const code = (err && err.name === 'AbortError' ? 'TIMEOUT' : err && err.code) || 'ERROR', cp = this.cache.get(k);
      if (code === 'TIMEOUT' && ++D.tmo < 2) { D.nextAt = started + DESK_POLL; return false; }   // 자기 abort 의 첫 TIMEOUT 은 분할이 아니다(relay 가 몰리면 정상 노드도 8초를 넘긴다) — 상태 · ro 그대로. 연속 2번째부터 offline
      if (code !== 'TIMEOUT') D.tmo = 0;   // 답을 받았다(다른 코드) — 연속이 끊긴다
      D.st = deskStateOf(code); D.code = code; D.msg = (err && err.message) || DESK_MSG[D.st] || '';
      if (code === 'MODULE_ROUTE_NOT_FOUND' && (D.got || (cp && cp.data && cp.data.revision > 0))) { D.st = 'down'; D.msg = DESK_MSG.down; }   // 받은 적이 있으면 옛 버전이 아니라 모듈 재시작 직후다 — 5초 재시도(60초 기다리지 않는다)
      D.nextAt = started + (D.st === 'old' ? DESK_OLD : DESK_POLL); return false;   // 사본은 그대로 — 상태만 단다
    }).then((ok) => { clearTimeout(timer); if (ac && onAbort) ac.signal.removeEventListener('abort', onAbort); D.fetching--; if (D.cur === p) D.cur = null; if (gen === this.gen) this.emit(rid); return ok; });
    D.cur = p; return p;
  }
  /**
   * 바탕 구성 쓰기 — 사본은 응답 전까지 그대로, 표시층(pendingDesk)에만. rid 마다 전송은 하나.
   * 키마다 "그 시점 사본의 revision" 을 base 로 적어 두고(대기 키는 처음 적은 낮은 base 를 지킨다), 전송은 같은 base 끼리 묶은 그룹을 낮은 base 부터 하나씩 —
   * 합본이 서버의 충돌 판정을 우회하지 못하게(다른 PC 가 그 키를 바꿨으면 409). 타이머 없음.
   * set: { 'icons.<id>' | 'prefs.<f>' | 'wall': 값 | null }. 읽기 전용(분할 · 옛 버전 …)이면 PARTITIONED 로 즉시 거절 — 표시층도 대기열도 없다
   */
  deskPatch(rid, set) {
    const keys = Object.keys(set || {}), s = this.deskRead(rid);
    if (s.state === 'loading') return Promise.reject({ code: 'DESK_NOT_READY', state: s.state, message: '바탕 구성을 아직 받지 못함' });
    if (s.ro) return Promise.reject({ code: 'PARTITIONED', state: s.state, message: (DESK_MSG[s.state] || '읽기 전용') + ' — 바꿀 수 없음' });
    if (!keys.length) return Promise.resolve({ revision: s.revision, doc: s.doc });
    const S = this.deskSend(rid); let pm = this.pendingDesk.get(rid); if (!pm) this.pendingDesk.set(rid, pm = new Map());
    if (!(S.failed && S.failed.size && S.save.state === 'failed')) S.save = { state: 'saving', at: S.save.at, code: '', msg: '', lost: [] };   // 실패 표시가 남아 있으면 새 저장이 나가도 그대로(키별로 성공해야 풀린다)
    const ver = ++S.ver, w = { ok: null, no: null, pend: new Map(), lost: [], res: null };
    for (const k of keys) { pm.set(k, set[k]); const q = S.queue.get(k); S.queue.set(k, { v: set[k], base: q ? Math.min(q.base, s.revision) : s.revision, ver }); w.pend.set(k, ver); }
    return new Promise((ok, no) => { w.ok = ok; w.no = no; S.waiters.push(w); this.emit(rid); this.deskPump(rid); });
  }
  /** 키가 다 정해진 waiter 를 끝낸다 — 잃은 키가 있으면 reject, 아니면 마지막 응답으로 resolve */
  deskSettleWaiters(S) {
    S.waiters = S.waiters.filter((w) => { if (w.pend.size) return true; if (w.lost.length) w.no({ code: 'REVISION_CONFLICT', message: DESK_CONFLICT_MSG, lost: w.lost.slice() }); else w.ok(w.res); return false; });
  }
  /** 충돌로 잃은 키 — 같은 키의 대기분도 함께(노드 값이 바뀐 것을 모르고 덮지 않게). S.lost 에 쌓아 사용자가 닫을 때까지 */
  deskLose(rid, S, keys) {
    const pm = this.pendingDesk.get(rid);
    for (const k of keys) { S.lost.add(k); if (S.failed) S.failed.delete(k); S.queue.delete(k); if (S.retry) S.retry.entries.delete(k); if (pm) pm.delete(k); for (const w of S.waiters) if (w.pend.has(k)) { w.pend.delete(k); w.lost.push(k); } }
    this.deskSettleWaiters(S);
  }
  deskPump(rid) {
    const S = this.deskSends.get(rid); if (!S || S.sending) return;
    if (!S.retry && !S.queue.size) return;
    if (!this.deskIsOk(rid)) { const D = this.deskMeta(rid); return this.deskFail(rid, S, null, { code: D.code || 'PARTITIONED', message: D.msg || DESK_MSG[D.st] || '읽기 전용 — 보내지 못함' }, false); }   // 나갈 수 없는 상태 — 낡은 의도를 쌓아 두지 않는다
    let batch;
    if (S.retry) { batch = S.retry; S.retry = null; }
    else {
      const lo = Math.min(...[...S.queue.values()].map((q) => q.base)), entries = new Map();
      for (const [k, q] of S.queue) if (q.base === lo) entries.set(k, q);
      for (const k of entries.keys()) S.queue.delete(k);
      batch = { entries, base: lo, retried: false };
    }
    S.sending = true; this.deskTransmit(rid, S, batch);
  }
  /** 사본이 비었으면(revision 0) 첫 쓰기 — 기본값 전체(prefs 6칸 · icons)를 펼치고 사용자 변경을 위에 얹는다 */
  deskFirst(set) {
    const d = this.deskDefaults || {}, prefs = Object.assign({}, d.prefs || {}), out = {};
    if (prefs.wallFit == null) prefs.wallFit = 'cover';
    for (const f in prefs) out['prefs.' + f] = prefs[f];
    for (const id in d.icons || {}) out['icons.' + id] = d.icons[id];
    return Object.assign(out, set);
  }
  async deskTransmit(rid, S, batch) {
    const gen = this.gen;
    try { await this.deskSendOnce(rid, S, batch, gen); }
    catch (x) { if (gen === this.gen) { try { this.deskFail(rid, S, batch, x && x.code ? x : { code: 'ERROR', message: String((x && x.message) || x) }, true); } catch (y) { /* 아래 finally 가 전송을 풀어 준다 */ } } }
    finally { if (gen === this.gen) { S.sending = false; this.persist(); this.emit(rid); this.deskPump(rid); } }   // 어떤 경우에도 전송 중 표시가 남지 않는다
  }
  async deskSendOnce(rid, S, batch, gen) {
    const k = this.deskKey(rid), e = this.cache.get(k), rev0 = e && e.data ? e.data.revision | 0 : 0, sent = [...batch.entries.keys()], base = rev0 === 0 ? 0 : batch.base;   // 첫 쓰기는 사본이 비었을 때만(배치 base 가 아니라)
    let set = {}; for (const [x, q] of batch.entries) set[x] = q.v; if (rev0 === 0) set = this.deskFirst(set);
    const ac = typeof AbortController === 'function' ? new AbortController() : null; let res = null, err = null, timer = 0, onAbort = null;
    const abort = new Promise((_, no) => { if (ac) { onAbort = () => no({ code: 'TIMEOUT', message: '그 노드가 ' + DESK_PATCH_ABORT / 1000 + '초 안에 답하지 않음' }); ac.signal.addEventListener('abort', onAbort); timer = setTimeout(() => ac.abort(), DESK_PATCH_ABORT); } });
    try { res = await Promise.race([this.t.invokeRid(rid, OP_DESK_PATCH, { base_revision: base, set }, { signal: ac ? ac.signal : undefined }), abort]); }
    catch (x) { err = x || { code: 'ERROR' }; }
    finally { clearTimeout(timer); if (ac && onAbort) ac.signal.removeEventListener('abort', onAbort); }
    if (gen !== this.gen) return;
    if (!err && !(res && Number.isInteger(res.revision) && 'doc' in res)) err = { code: 'BAD_RESPONSE', message: '바탕 구성 쓰기 응답이 이상함' };
    if (!err) {   // 응답은 항상 반영한다 — 그 전에 출발한 읽기는 버린다
      const now = Date.now(), D = this.deskMeta(rid), pm = this.pendingDesk.get(rid), R = res.revision, doc = res.doc == null ? null : res.doc;
      D.applied = ++D.seq; this.cache.set(k, { data: { revision: R, doc }, at: now, src: this.isLocal(rid) ? '로컬' : '노드' });
      D.st = 'ok'; D.code = ''; D.msg = ''; D.nextAt = now + DESK_POLL;
      if (rev0 === 0) { for (const q of S.queue.values()) q.base = R; if (S.retry) S.retry.base = R; }   // 첫 쓰기는 모든 키를 새로 적었다 — 그 사이 쌓인 대기분이 내 첫 쓰기와 충돌하지 않게 base 를 올린다
      for (const [x, q] of batch.entries) {
        if (S.failed) S.failed.delete(x);   // 그 키가 저장에 성공했으니 실패 기록에서 뺀다
        const nq = S.queue.get(x); if (nq) nq.base = R; else if (pm) pm.delete(x);   // 같은 키 대기분의 base 는 내 응답 revision 으로 — 자기 자신과 충돌하지 않게(안 보낸 키의 base 는 그대로)
        for (const w of S.waiters) { const v = w.pend.get(x); if (v != null && v <= q.ver) { w.pend.delete(x); w.res = { revision: R, doc }; } }
      }
      if (S.failed && !S.failed.size) S.failed = null;
      if (S.failed && S.save.state === 'failed') S.save = Object.assign({}, S.save, { at: now });   // 다른 키의 실패가 남아 있으면 failed 를 지키고 시각만
      else S.save = { state: S.queue.size || S.retry ? 'saving' : 'saved', at: now, code: '', msg: '', lost: [] };   // 잃은 키(S.lost)는 deskRead 가 failed 로 계속 보인다
      return this.deskSettleWaiters(S);
    }
    if (err.code === 'REVISION_CONFLICT') {
      const dk = err.details && Array.isArray(err.details.keys) ? err.details.keys.filter((x) => batch.entries.has(x)) : [];
      const conflict = batch.retried || !dk.length ? sent : dk, rest = sent.filter((x) => !conflict.includes(x));
      await this.deskFetch(rid, { force: true });   // 노드 값을 먼저 받고 — 그 뒤에 잃음을 알린다(reject 를 받은 호출자가 이미 노드 값을 본다)
      if (gen !== this.gen) return;
      this.deskLose(rid, S, conflict);
      if (!rest.length) return;
      if (!this.deskIsOk(rid)) { const D = this.deskMeta(rid); return this.deskFail(rid, S, { entries: new Map(rest.map((x) => [x, batch.entries.get(x)])) }, { code: D.code || 'ERROR', message: D.msg }, false); }
      // 충돌 아닌 키는 한 번만 자동 재전송 — 원래 base 그대로. 새 revision 으로 바꾸면 그 사이 다른 PC 가 그 키를 바꿨는지 알 수 없다(설계 §7 은 "새 revision" 이라 적었으나 충돌 감지를 지키려 다르게 한다. 바뀌었으면 다시 409 → 잃음)
      S.retry = { entries: new Map(rest.map((x) => [x, batch.entries.get(x)])), base: batch.base, retried: true };
      return;
    }
    this.deskFail(rid, S, batch, err, true);   // 그 외 실패
  }
  /**
   * 실패 — 표시층과 대기열(전송분 · 재전송 대기 · 대기분) 전부 비우고 사본은 그대로. 실패한 set 은 전송분 + 그때 대기분을 합쳐 deskRetry 용으로 둔다(저절로 다시 보내지 않는다).
   * recheck: 전송했는데 결과를 모르는 경우(끊김 · 시간 초과 · 이상한 응답) 노드 값을 다시 읽어 확인
   */
  deskFail(rid, S, batch, err, recheck) {
    const D = this.deskMeta(rid), code = (err.name === 'AbortError' ? 'TIMEOUT' : err.code) || 'ERROR', failed = new Map(S.failed || []);   // 앞선 실패 기록에 쌓는다
    if (batch) for (const [x, q] of batch.entries) failed.set(x, q.v);
    if (S.retry) for (const [x, q] of S.retry.entries) failed.set(x, q.v);
    for (const [x, q] of S.queue) failed.set(x, q.v);
    S.queue = new Map(); S.retry = null; this.pendingDesk.delete(rid);
    const ws = S.waiters; S.waiters = [];
    S.failed = failed.size ? failed : null; S.save = { state: 'failed', at: S.save.at, code, msg: err.message || '', lost: [] };
    if (PARTITION.has(code)) { D.st = 'offline'; D.code = code; D.msg = err.message || DESK_MSG.offline; D.nextAt = Date.now() + DESK_POLL; }
    for (const w of ws) w.no(err);
    if (recheck) this.deskFetch(rid, { force: true });
  }
  /** 실패한 저장을 같은 흐름으로 다시 — 보관한 set 그대로 */
  deskRetry(rid) { const S = this.deskSends.get(rid); if (!S || !S.failed) return Promise.reject({ code: 'NOTHING_TO_RETRY', message: '다시 보낼 것이 없음' }); return this.deskPatch(rid, Object.fromEntries(S.failed)); }
  /** 실패 표시를 닫는다(사용자가 닫을 때만 — 저절로 사라지지 않는다). 잃은 키 목록도 여기서 비운다 */
  deskClearSave(rid) { const S = this.deskSends.get(rid); if (!S || this.deskRead(rid).save.state !== 'failed') return; S.failed = null; S.lost.clear(); S.save = { state: 'idle', at: S.save.at, code: '', msg: '', lost: [] }; this.emit(rid); }

  // 갱신 타이머 — store 에 하나. 제어기를 연 쪽이 watch/unwatch(같은 rid 를 여러 창이 열어도 합쳐서 한 번)
  deskHidden() { return typeof document !== 'undefined' && !!document && document.visibilityState === 'hidden'; }
  watch(rid, o = {}) {
    if (!rid) return;
    let w = this.watched.get(rid); const first = !w;
    if (!w) this.watched.set(rid, w = { n: 0, scene: '', propsAt: Date.now() });
    w.n++; if (o && o.scene) w.scene = o.scene;
    this.deskStart(); if (first) this.deskFetch(rid);
  }
  unwatch(rid) { const w = this.watched.get(rid); if (!w) return; if (--w.n <= 0) this.watched.delete(rid); if (!this.watched.size) this.deskStop(); }
  deskStart() {
    if (!this._deskT) { this._deskT = setInterval(() => this.deskTick(), DESK_TICK); if (this._deskT && this._deskT.unref) this._deskT.unref(); }
    if (this._deskOn) return; this._deskOn = true;
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', this._deskWake);
    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') window.addEventListener('focus', this._deskWake);
  }
  /** 타이머와 깨움 구독을 멈춘다(watch 가 0 이거나 시험 끝) */
  deskStop() {
    clearInterval(this._deskT); this._deskT = null;
    if (!this._deskOn) return; this._deskOn = false;
    if (typeof document !== 'undefined' && document && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', this._deskWake);
    if (typeof window !== 'undefined' && window && typeof window.removeEventListener === 'function') window.removeEventListener('focus', this._deskWake);
  }
  deskTick() {
    if (this.deskHidden()) return;   // 숨은 탭은 묻지 않는다
    const now = Date.now();
    for (const [rid, w] of this.watched) {
      const D = this.deskMeta(rid); if (!D.fetching && now >= D.nextAt) this.deskFetch(rid);
      if (w.scene && now - w.propsAt >= PROPS_EVERY) { w.propsAt = now; this.refresh(w.scene, 'props'); }   // 프로필 · 스킨도 같은 타이머로 30초마다
    }
  }
  /** 탭이 다시 보일 때 · 창에 포커스가 올 때 — 바로 읽는다(둘이 겹쳐도 직전 시작 500ms 안이면 건너뜀) */
  deskWake() {
    if (this.deskHidden()) return;
    const now = Date.now();
    for (const rid of this.watched.keys()) { const D = this.deskMeta(rid); if (now - D.lastStart >= DESK_WAKE_GAP) this.deskFetch(rid); }
  }

  // ───────────── 배경 그림(§6.3) — node-files 의 desk/wall/<시각>.<확장자>, 이름 · 형식은 wall 에 ─────────────
  /** 청크로 올린다 — invokeRid. 순서가 어긋나면 한 번만 처음부터 */
  async deskPutFile(rid, rel, u8, mime) {
    let off = 0, retried = false;
    while (off < u8.length) {
      const chunk = u8.subarray(off, Math.min(u8.length, off + WRITE_STEP));
      try { off = (await this.t.invokeRid(rid, OP_PUT, { path: rel, mime, data: b64Of(chunk), offset: off, total: u8.length }, {})).received; }
      catch (e) { if (e && e.code === 'CHUNK_OUT_OF_ORDER' && !retried) { retried = true; off = 0; continue; } throw e; }
    }
  }
  /** 그림을 올리고 가리킨다 — f: { name, type, bytes(Uint8Array) }. 올리기 → 패치({wall, prefs.wall:'img'}) → 지난 파일 정리. 어디서 실패해도 지금 바탕은 그대로 */
  async deskWallPut(rid, f) {
    const ext = WALL_EXT[f && f.type], u8 = f && f.bytes;
    if (!ext) throw { code: 'WALL_TYPE', message: 'png · jpeg · gif · webp 만 올릴 수 있음' };
    if (!u8 || !u8.length) throw { code: 'WALL_EMPTY', message: '빈 파일' };
    if (u8.length > WALL_MAX) throw { code: 'WALL_TOO_LARGE', message: '상한 2.5MiB · 이 파일 ' + (u8.length / 1048576).toFixed(1) + 'MiB' };
    const s = this.deskRead(rid);
    if (s.state === 'loading') throw { code: 'DESK_NOT_READY', state: s.state, message: '바탕 구성을 아직 받지 못함' };
    if (s.ro) throw { code: 'PARTITIONED', state: s.state, message: (DESK_MSG[s.state] || '읽기 전용') + ' — 바꿀 수 없음' };
    const gen = this.gen, file = WALL_DIR + '/' + Date.now() + '.' + ext;
    await this.deskPutFile(rid, file, u8, f.type);
    if (gen !== this.gen) throw { code: 'CLEARED', message: '로그아웃으로 비워짐' };
    await this.deskPatch(rid, { wall: { file, name: clipBytes(f.name, 256) || 'wallpaper', type: f.type, at: Date.now() }, 'prefs.wall': 'img' });
    if (gen !== this.gen) return;
    const k = rid + '|' + file, v = { mime: f.type, b64: b64Of(u8) }; IDB.put(k, v); this.remember(k, v.mime, v.b64); this.emit(rid);   // 방금 올린 것은 다시 받지 않는다
    await this.deskWallSweep(rid, file);
  }
  /** 그림을 지우고 노을로 */
  async deskWallClear(rid) {
    const gen = this.gen;
    await this.deskPatch(rid, { wall: null, 'prefs.wall': 'dusk' });
    if (gen === this.gen) await this.deskWallSweep(rid, '');
  }
  /** 패치가 성공한 뒤 desk/wall/ 의 나머지를 지운다(실패 무시 — 못 지운 잔재는 다음 정리 때). 그 사이 다른 PC 가 가리킨 파일은 남긴다 */
  async deskWallSweep(rid, keep) {
    const gen = this.gen;
    try {
      await this.deskFetch(rid, { force: true });
      const cur = this.deskRead(rid).doc, now = cur && cur.wall && cur.wall.file;
      const list = await this.t.invokeRid(rid, OP_LIST, { dir: WALL_DIR }, {}), ents = (list && list.entries) || [];
      // 서버가 준 modified 로만 견준다(이 PC 시계를 쓰지 않는다) — 지금 가리키는 파일보다 오래된 것만 지운다. 다른 PC 가 막 올린 더 새 파일은 남는다. 가리키는 파일이 없으면(지우기) 전부
      const refE = ents.find((e) => e && e.path === now) || ents.find((e) => e && e.path === keep), ref = refE ? Date.parse(refE.modified) : NaN;
      if ((now || keep) && Number.isNaN(ref)) return;
      for (const e of ents) {
        if (gen !== this.gen) return;
        if (!e || !e.path || e.path === keep || e.path === now) continue;
        if (!Number.isNaN(ref) && !(Date.parse(e.modified) < ref)) continue;
        try { await this.t.invokeRid(rid, OP_DEL, { path: e.path }, {}); } catch (x) { /* 실패 무시 */ }
      }
    } catch (x) { /* 정리는 덤 — 실패해도 바탕은 바뀐 뒤다 */ }
  }
  /** 배경 그림 사본 { url(data:), mime } — 없으면 뒤에서 받고 null(받는 동안 노을로 떨어뜨리지 않는다). 키 rid|file, 경로에 시각이 있어 사본이 낡지 않는다. 다 받으면 emit(rid) */
  deskWallBlob(rid, file) {
    const k = rid + '|' + file, e = this.blobs.get(k);
    if (e && e.url) return e;
    if (!e || (!e.busy && Date.now() - e.errAt > BLOB_RETRY)) this.loadWall(rid, file, k);
    return null;
  }
  /** 그림을 못 받았나(마지막 시도가 실패) — "받는 중"이 영원히 가지 않게 화면이 구분한다 */
  deskWallFailed(rid, file) { const e = this.blobs.get(rid + '|' + file); return !!e && !e.busy && !e.url; }
  async loadWall(rid, file, k) {
    const gen = this.gen; this.blobs.set(k, { busy: true, errAt: 0 });
    try {
      let v = await IDB.get(k);
      if (!v) { v = await this.fetchWall(rid, file); IDB.put(k, v); }
      if (gen !== this.gen) return;
      this.remember(k, v.mime, v.b64); this.emit(rid);
    } catch (err) { if (gen === this.gen) { this.blobs.set(k, { busy: false, errAt: Date.now() }); this.emit(rid); } }
  }
  async fetchWall(rid, file) {
    let off = 0, b64 = '', mime = '';
    for (;;) {
      const d = await this.t.invokeRid(rid, OP_GET, { path: file, offset: off, limit: READ_STEP }, {}), s = d.data || '', pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, got = s.length * 3 / 4 - pad;
      b64 += s; mime = d.mime || mime; off += got;
      if (!got || off >= d.size) return { mime, b64 };
    }
  }

  /** 비우기 — 로그아웃 때(다음 사람이 앞 사람의 사본을 보지 않게) */
  clear() { clearTimeout(this._saveT); this.pendingRes.clear(); for (const S of this.deskSends.values()) for (const w of S.waiters) w.no({ code: 'CLEARED', message: '로그아웃으로 비워짐' }); this.pendingDesk.clear(); this.deskSends.clear(); this.desks.clear();   // 바탕 구성의 표시층 · 대기열 · 상태 — watch 목록과 타이머는 남긴다(토큰 갱신도 clear 를 부른다)
    this.cache.clear(); this.links.clear(); this.views.clear(); this.inflight.clear(); this.blobs.clear(); this.gen++; IDB.clear(); try { localStorage.removeItem('terra.cache'); } catch (e) {} for (const f of this.subs) { try { f(''); } catch (e) {} } }
  /** GUI 보기 상태 — 노드 키마다 (노드 데이터가 아니다) */
  view(key) { if (!this.views.has(key)) this.views.set(key, LS.get('terra.pc.' + key) || null); return this.views.get(key); }
  setView(key, v) { this.views.set(key, v); LS.set('terra.pc.' + key, v); }   // 이 브라우저에만 — 계정 문서 · 노드로 보내지 않는다
  /** PC 상태 키(view · setView 에 넘긴다 → terra.pc.<키>) — src/api/pc-state.js 와 같은 모양 */
  pcDesk(rid) { return 'desk.' + rid; }
  pcTerm(principal, rid) { return 'term.' + encodeURIComponent(String(principal)).replace(/\./g, '%2E') + '.' + rid; }

  /** 링크 문구 — 화면 머리줄에 */
  linkText(n, at) {
    const L = this.link(n), ago = (ms) => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 10 ? '방금' : s < 60 ? Math.round(s) + 's 전' : s < 3600 ? Math.round(s / 60) + 'm 전' : Math.round(s / 3600) + 'h 전'; };
    if (L.state === 'local') return { t: '로컬', cls: 'local', ro: false };
    if (L.state === 'offline') return { t: '끊김 · ' + (at ? ago(at) + ' 사본' : '사본 없음') + ' · 읽기 전용', cls: 'off', ro: true };
    if (L.state === 'far') return { t: '직접 닿지 않음' + (L.via ? ' · ' + L.via + ' 경유 필요' : '') + ' · 읽기 전용', cls: 'off', ro: true };
    if (L.state === 'none') return { t: 'Terra 에 없는 노드 · 시안 자리', cls: 'off', ro: true };
    if (L.state === 'online') return { t: '원격 · ' + (at ? ago(at) : '받는 중'), cls: 'on', ro: false };
    return { t: '원격 · 연결 확인 중', cls: 'wait', ro: false };
  }
}

// 목업 전송 — 캔버스 시안용. 노드 쪽 값은 이 브라우저(terra.mock.<노드>.<자원>)에 두고, 처음 읽을 때 보드가 등록한 씨앗(seed)으로 만든다.
//   지연: 로컬 40–90ms · 원격 160–520ms. 끊김: terra.mock.cut 에 든 노드(시험 — 우클릭 › 끊기)
class MockTransport {
  constructor() { this.seeds = {}; this.meta = {}; this._local = ''; this.kind = 'mock'; }
  localId() { return this._local; }
  bindScene(localId, metas) { this._local = localId; for (const m of metas) this.meta[m.id] = m; }
  cut() { return new Set(LS.get('terra.mock.cut') || []); }
  setCut(n, on) { const s = this.cut(); if (on) s.add(n); else s.delete(n); LS.set('terra.mock.cut', [...s]); }
  resOf(op) { for (const r in RES) if (RES[r].op === op) return r; return null; }
  nodeData(n, res) { const k = 'terra.mock.' + n + '.' + res; let v = LS.get(k); if (v == null && res === 'props') v = { props: {} }; if (v == null && this.seeds[res]) { v = this.seeds[res](this.meta[n] || { id: n, name: n }); LS.set(k, v); } return v; }
  /** 노드 id(rid)로 부르기 — 캔버스 시안에서 rid 는 장면 id 다. invoke 와 같다 */
  invokeRid(rid, op, input, o = {}) { return this.invoke(rid, op, input, o); }
  /** 노드 쪽 바탕 구성(terra.mock.<rid>.desk) — 서버 규칙 그대로: 키마다 revs, 충돌 409, 첫 쓰기 형태 */
  deskOp(n, op, input) {
    const k = 'terra.mock.' + n + '.desk', v = LS.get(k) || { revision: 0, doc: null, revs: {}, floor: 0 }, err = (code, status, d) => ({ code, status, message: code, details: d || null });
    if (op === OP_DESK_GET) { const s = input && input.since_revision; if (v.revision === 0) return { revision: 0, doc: null }; return s === v.revision ? { revision: v.revision, unchanged: true } : { revision: v.revision, doc: v.doc }; }
    const base = input && input.base_revision, set = (input && input.set) || {}, keys = Object.keys(set);
    if (typeof base !== 'number') throw err('INVALID_REQUEST', 400);
    if (base > v.revision) throw err('REVISION_CONFLICT', 409, { keys });
    const bad = keys.filter((x) => (v.revs[x] == null ? v.floor : v.revs[x]) > base); if (bad.length) throw err('REVISION_CONFLICT', 409, { keys: bad });
    const doc = jclone(v.doc) || { icons: {}, prefs: {} }; doc.icons = doc.icons || {}; doc.prefs = doc.prefs || {};
    if (v.revision === 0 && !(['dark', 'wall', 'wallFit', 'dock', 'snap', 'anim'].every((f) => 'prefs.' + f in set) && keys.some((x) => x.startsWith('icons.') && set[x] != null))) throw err('INVALID_REQUEST', 400);
    const rev = v.revision + 1;
    for (const x of keys) { v.revs[x] = rev; if (x === 'wall') { if (set[x] == null) delete doc.wall; else doc.wall = set[x]; continue; } const i = x.indexOf('.'), g = x.slice(0, i), f = x.slice(i + 1); if (set[x] == null) delete doc[g][f]; else doc[g][f] = set[x]; }
    v.revision = rev; v.doc = doc; LS.set(k, v); return { revision: rev, doc };
  }
  invoke(n, op, input, o = {}) {
    const local = n === this._local, ms = local ? 40 + Math.random() * 50 : 160 + Math.random() * 360;
    return new Promise((ok, no) => setTimeout(() => {
      if (!local && this.cut().has(n)) return no({ code: 'NODE_OFFLINE', status: 409, retryable: true, message: 'target node is offline' });
      if (op === OP_DESK_GET || op === OP_DESK_PATCH) { try { return ok(this.deskOp(n, op, input)); } catch (x) { return no(x); } }
      const res = this.resOf(op), fk = 'terra.mock.' + n + '.file.' + (input && input.path);
      if (res) return ok(this.nodeData(n, res));
      if (op === OP_PATCH) { const v = this.nodeData(n, 'props'); for (const k in input.set) { if (input.set[k] == null) delete v.props[k]; else v.props[k] = input.set[k]; } LS.set('terra.mock.' + n + '.props', v); return ok(v); }
      if (op === OP_PUT) { const bin = (input.offset ? this._up || '' : '') + atob(input.data); this._up = bin; if (bin.length >= input.total) { this._up = ''; if (!LS.set(fk, { mime: input.mime, b64: btoa(bin) })) return no({ code: 'TOO_LARGE', message: '브라우저 저장 공간 부족' }); } return ok({ done: bin.length >= input.total, received: bin.length, total: input.total }); }
      if (op === OP_GET) { const f = LS.get(fk); if (!f) return no({ code: 'NOT_FOUND', message: 'not found' }); return ok({ path: input.path, size: atob(f.b64).length, mime: f.mime, data: f.b64 }); }
      if (op === OP_DEL) { try { localStorage.removeItem(fk); } catch (e) {} return ok({}); }
      // 쓰기 — 목업은 o.res 의 노드 쪽 값에 o.apply 를 그대로
      if (o.res && o.apply) { const k = 'terra.mock.' + n + '.' + o.res; LS.set(k, o.apply(this.nodeData(n, o.res))); }
      ok({ ok: true });
    }, ms));
  }
  // Master 가 마지막으로 관측한 값 — 목업은 노드 쪽 값 그대로(끊기기 전 마지막)
  master(n, op) { return new Promise((ok) => setTimeout(() => { const r = op.endsWith('modules.get') ? 'modules' : 'status'; ok(this.nodeData(n, r)); }, 120)); }
}

class Component extends DCLogic {
  constructor(props) {
    super(props);
    if (typeof window !== 'undefined' && !window.TerraNodes) {
      const t = window.TerraTransport || new MockTransport();
      window.TerraNodes = new NodeStore(t); window.TerraNodes.RES = RES;
    }
  }
  // 캔버스에서 이 보드만 열면 사본 표가 보인다(시험 · 설명용). 씬 · 전역 틀에 들어갈 때는 quiet — 아무것도 그리지 않는다
  componentDidMount() { if (this.props.quiet) return; const T = window.TerraNodes; this._un = T && T.subscribe(() => this.setState({})); this._iv = setInterval(() => this.setState({}), 1000); }
  componentWillUnmount() { if (this._un) this._un(); clearInterval(this._iv); }
  renderVals() {
    if (this.props.quiet) return { disp: 'none', rows: [], emptyD: 'none', kind: '', local: '', clear: null };
    const T = typeof window !== 'undefined' ? window.TerraNodes : null; if (!T) return { disp: 'block', rows: [], emptyD: 'block', kind: '—', local: '—', clear: null };
    const rows = [...T.cache.entries()].map(([k, e]) => { const [n, res] = k.split('|'), L = T.linkText(n, e.at), M = T.t.meta && T.t.meta[n];
      return { node: (M && M.name) || n, res, age: e.at ? Math.round((Date.now() - e.at) / 1000) + 's' : '—', src: e.src || '', link: L.t, col: L.cls === 'off' ? '#ffd27a' : L.cls === 'local' ? '#709c80' : '#96f0aa' }; });
    return { disp: 'block', rows, emptyD: rows.length ? 'none' : 'block', kind: T.t.kind || '?', local: (T.t.meta && T.t.meta[T.t.localId()] && T.t.meta[T.t.localId()].name) || T.t.localId() || '—', clear: () => T.clear() };
  }
}
