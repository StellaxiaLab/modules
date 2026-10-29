// 노드 데이터 층 — 노드에 딸린 것(설정 · 모듈 · 장치 · 자원 · 작업)은 그 노드가 원본이다. GUI 는 사본(캐시)만 들고, 어느 화면이든 이 층을 거친다.
//
// 분할 정책 PA/EL (PACELC)
//   P(분할 — 노드가 꺼졌거나 Master 중계가 끊김): 가용성. 마지막 사본(이 브라우저의 캐시, 없으면 Master 가 마지막으로 관측한 값)을 그대로 보여 준다.
//      나이와 출처를 같이 단다('끊김 · 3분 전 · Master 관측'). 그 노드에서 해야 하는 쓰기는 하지 않는다 — 몰래 쌓아 두었다가 나중에 보내지 않는다(되살아날 때 낡은 의도가 덮어쓴다).
//      단, Master 가 원하는 상태(desired)로 받는 것(모듈 배포 지정)은 노드가 없어도 Master 에 적는다 — 노드가 돌아오면 스스로 맞춘다.
//   E(평소): 지연 우선. 사본을 즉시 돌려주고, 나이가 TTL 을 넘었으면 뒤에서 새로 받는다(stale-while-revalidate). 쓰기는 사본에 먼저 반영(낙관)하고 실패하면 되돌린다.
// 로컬 노드(이 GUI 를 띄운 노드)는 로컬 Gateway 로 바로, 다른 노드는 Gateway 의 노드 주소 호출(Master 중계, 직계 자식만 — 아니면 DELEGATION_REQUIRED · via)로 간다.
// GUI 가 노드마다 따로 두는 보기 상태(제어기 창 배치 · 바탕화면 · 열린 앱 · 아이콘)는 노드 데이터가 아니다 — view() 로 노드 키마다 따로 저장한다.
//
// 전송(transport)은 갈아 끼운다: window.TerraTransport 가 있으면 그것(웹 빌드 — Gateway), 없으면 목업(캔버스 — 노드 쪽 값을 이 브라우저에 두고 지연 · 끊김을 흉내).
//   transport = { kind, localId(), bindScene?(장면 로컬 id, 노드 메타들), meta?, invoke(nodeId, opId, input) → Promise<data> (실패: { code, status, retryable }), loadView?(key), saveView?(key, v), master?(nodeId, res) → Promise<data> }

const RES = {   // 자원 이름 → 읽기 operation · TTL(ms) · 끊겼을 때 Master 의 관측으로 대신할 길
  status:  { op: 'terra.daemon.status.get', ttl: 5000, master: 'terra.master.nodes.by-node-id.get' },
  config:  { op: 'terra.daemon.config.get', ttl: 60000 },
  modules: { op: 'terra.daemon.modules.get', ttl: 15000, master: 'terra.master.nodes.by-node-id.modules.get' },
  offers:  { op: 'terra.daemon.modules.offers.get', ttl: 30000 },
  devices: { op: 'terra.daemon.io.devices.get', ttl: 15000 },
  tasks:   { op: 'terra.daemon.tasks.get', ttl: 5000 },
  svi:     { op: 'terra.daemon.svi.declarations.get', ttl: 30000 },
  wg:      { op: 'terra.daemon.wireguard.status.get', ttl: 15000 },
  // 제어기(노드 데스크톱) 묶음 — 위 자원들을 한 화면 모양으로. 목업은 보드 씨앗, 웹 빌드 전송은 operation 여럿을 불러 묶는다(desk.js)
  desk:    { op: 'gui-v3.desk', ttl: 15000, compose: ['config', 'modules', 'offers', 'devices', 'tasks', 'svi', 'wg'] }
};
const PARTITION = new Set(['NODE_OFFLINE', 'RELAY_NOT_CONNECTED', 'NETWORK', 'TIMEOUT', 'GATEWAY_UNREACHABLE']);   // 이 코드면 분할로 본다
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };

class NodeStore {
  constructor(transport) {
    this.t = transport; this.shapes = {}; this.subs = new Set(); this.inflight = new Map(); this.links = new Map(); this.views = new Map();
    this.cache = new Map(Object.entries(LS.get('terra.cache') || {}));   // 새로 띄워도 마지막 사본이 남는다(끊긴 채 시작해도 보인다)
    this._saveT = 0;
  }
  key(n, r) { return n + '|' + r; }
  emit(n) { for (const f of this.subs) { try { f(n); } catch (e) {} } }
  subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); }
  persist() { clearTimeout(this._saveT); this._saveT = setTimeout(() => { const o = {}; for (const [k, v] of this.cache) o[k] = v; if (!LS.set('terra.cache', o)) LS.set('terra.cache', {}); }, 400); }
  isLocal(n) { return n === this.t.localId(); }
  link(n) { if (this.isLocal(n)) return { state: 'local' }; return this.links.get(n) || { state: 'unknown' }; }
  setLink(n, L) { const o = this.links.get(n); this.links.set(n, Object.assign({}, L, { at: Date.now() })); if (!o || o.state !== L.state || o.code !== L.code) this.emit(n); }

  /** 읽기 — 사본을 바로(EL). 없거나 낡았으면 뒤에서 받는다. 끊겼으면 사본(PA) */
  read(n, res, o = {}) {
    const R = RES[res] || { op: res, ttl: 15000 }, k = this.key(n, res), e = this.cache.get(k), now = Date.now(), age = e ? now - e.at : Infinity, L = this.link(n);
    const wait = !o.force && ((L.state === 'offline' && L.retryAt > now) || (e && e.err && now - (e.errAt || 0) < 5000));   // 끊긴 노드 · 실패한 자원은 5초에 한 번만 다시 두드린다(그리기마다 부르지 않게)
    if ((age > (o.ttl ?? R.ttl) || o.force) && !wait && !this.inflight.has(k)) this.refresh(n, res);
    return { data: e ? e.data : null, at: e ? e.at : 0, age, src: e ? e.src : '', stale: age > (o.ttl ?? R.ttl), loading: this.inflight.has(k), link: L, err: e && e.err };
  }
  refresh(n, res) {
    const R = RES[res] || { op: res }, k = this.key(n, res);
    if (this.inflight.has(k)) return this.inflight.get(k);
    const p = this.fetchRes(n, res, R).then((data) => {
      this.cache.set(k, { data, at: Date.now(), src: this.isLocal(n) ? '로컬' : '노드' }); if (!this.isLocal(n)) this.setLink(n, { state: 'online' });   // 받았으면 지난 오류는 지운다
    }, (err) => {
      const code = (err && err.code) || 'ERROR', e0 = this.cache.get(k);
      this.cache.set(k, Object.assign({}, e0 || { data: null, at: 0 }, { err: { code, msg: err && err.message }, errAt: Date.now() }));   // 사본은 그대로 두고 오류만 단다(5초 동안 다시 안 부름)
      if (PARTITION.has(code)) {
        this.setLink(n, { state: 'offline', code, retryAt: Date.now() + 5000 });
        // 사본이 없으면 Master 가 마지막으로 관측한 값으로 (가능한 자원만)
        if (!(e0 && e0.data) && R.master && this.t.master) return this.t.master(n, R.master).then((data) => { this.cache.set(k, { data, at: Date.now(), src: 'Master 관측', observed: true, err: { code }, errAt: Date.now() }); }, () => {});
      } else if (code === 'DELEGATION_REQUIRED') this.setLink(n, { state: 'far', code, via: err.via || '' });
      else if (code === 'NODE_NOT_FOUND' || code === 'NODE_UNMAPPED') this.setLink(n, { state: 'none', code });
    }).finally(() => { this.inflight.delete(k); this.persist(); this.emit(n); });
    this.inflight.set(k, p); this.emit(n);
    return p;
  }

  // 묶음 자원(compose) — 목업은 한 번에, 실제 전송은 operation 들을 함께 불러 보드의 모양(shapes[res])으로. 다 분할로 실패하면 분할
  fetchRes(n, res, R) {
    const meta = (this.t.meta && this.t.meta[n]) || { id: n };
    if (!R.compose || this.t.kind === 'mock' || !this.shapes[res]) return this.t.invoke(n, R.op, {}).then((d) => (this.t.kind !== 'mock' && this.shapes[res] ? this.shapes[res](d, meta) : d));
    return Promise.allSettled(R.compose.map((r) => this.t.invoke(n, RES[r].op, {}))).then((rs) => {
      const P = {}; let fail = null, ok = 0;
      rs.forEach((x, i) => { if (x.status === 'fulfilled') { P[R.compose[i]] = x.value; ok++; } else if (!fail || PARTITION.has(x.reason && x.reason.code)) fail = x.reason; });
      if (!ok) throw fail || { code: 'ERROR' };
      return this.shapes[res](P, meta);
    });
  }
  /** 쓰기 — 끊겼으면 하지 않는다(PA: 몰래 쌓지 않음). 평소엔 사본에 먼저(낙관), 실패하면 되돌림. o.apply(data) → 새 사본 */
  write(n, opId, input, o = {}) {
    const L = this.link(n);
    if (L.state === 'offline' || L.state === 'far' || L.state === 'none') return Promise.reject({ code: 'PARTITIONED', message: (L.state === 'far' ? '직접 닿지 않는 노드' : '노드와 끊김') + ' — 돌아오면 다시' });
    const k = o.res ? this.key(n, o.res) : null, prev = k ? this.cache.get(k) : null;
    if (k && o.apply && prev) { this.cache.set(k, Object.assign({}, prev, { data: o.apply(prev.data), pending: true })); this.emit(n); }
    return this.t.invoke(n, opId, input, o).then((r) => { if (k) { const e = this.cache.get(k); if (e) { e.pending = false; e.at = Date.now(); } this.persist(); this.emit(n); if (o.refresh !== false) this.refresh(n, o.res); } return r; },
      (err) => { if (k && prev) this.cache.set(k, prev); if (PARTITION.has(err && err.code)) this.setLink(n, { state: 'offline', code: err.code }); this.emit(n); throw err; });
  }

  /** 비우기 — 로그아웃 때(다음 사람이 앞 사람의 사본을 보지 않게) */
  clear() { this.cache.clear(); this.links.clear(); this.views.clear(); this.inflight.clear(); try { localStorage.removeItem('terra.cache'); } catch (e) {} for (const f of this.subs) { try { f(''); } catch (e) {} } }
  /** GUI 보기 상태 — 노드 키마다 (노드 데이터가 아니다) */
  view(key) { if (!this.views.has(key)) this.views.set(key, (this.t.loadView && this.t.loadView(key)) || LS.get('terra.view.' + key) || null); return this.views.get(key); }
  setView(key, v) { this.views.set(key, v); if (this.t.saveView) this.t.saveView(key, v); else LS.set('terra.view.' + key, v); }

  /** 링크 문구 — 화면 머리줄에 */
  linkText(n, at) {
    const L = this.link(n), ago = (ms) => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 10 ? '방금' : s < 60 ? Math.round(s) + '초 전' : s < 3600 ? Math.round(s / 60) + '분 전' : Math.round(s / 3600) + '시간 전'; };
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
  nodeData(n, res) { const k = 'terra.mock.' + n + '.' + res; let v = LS.get(k); if (v == null && this.seeds[res]) { v = this.seeds[res](this.meta[n] || { id: n, name: n }); LS.set(k, v); } return v; }
  invoke(n, op, input, o = {}) {
    const local = n === this._local, ms = local ? 40 + Math.random() * 50 : 160 + Math.random() * 360;
    return new Promise((ok, no) => setTimeout(() => {
      if (!local && this.cut().has(n)) return no({ code: 'NODE_OFFLINE', status: 409, retryable: true, message: 'target node is offline' });
      const res = this.resOf(op);
      if (res) return ok(this.nodeData(n, res));
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
      return { node: (M && M.name) || n, res, age: e.at ? Math.round((Date.now() - e.at) / 1000) + '초' : '—', src: e.src || '', link: L.t, col: L.cls === 'off' ? '#ffd27a' : L.cls === 'local' ? '#709c80' : '#96f0aa' }; });
    return { disp: 'block', rows, emptyD: rows.length ? 'none' : 'block', kind: T.t.kind || '?', local: (T.t.meta && T.t.meta[T.t.localId()] && T.t.meta[T.t.localId()].name) || T.t.localId() || '—', clear: () => T.clear() };
  }
}
