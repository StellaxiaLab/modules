// 자원 창 — 리프의 자원을 소속 클러스터 안에서 주고받는다. 분류 둘:
//   자원 공유 — 노드 데스크톱에서 공유한 자원(캡슐화 · 열기는 노드 안의 일)마다 어디에 줄지: 전체(소속 클러스터 전체) · Tree(부모) · Leaf(클러스터의 리프) · 계정
//   외부 자원 등록 — 이 노드가 볼 수 있는 자원 중 골라 등록해 쓴다. 등록 가능 = 이 노드를 지명한 것 · 전체 공유된 것 · Tree 가 클러스터 밖에서 가져온 것(Tree 가 지명 · 전체)
//     등록한 자원 = 수신 위치 · 품질을 정해 이은 것
//   자원 이름을 누르면 자원 상태 창(onOpen('res', '이름|출처|제공 노드'))
//   자원은 같은 클러스터 안에서만 주고받는다. 클러스터 밖과는 Tree 가 받고 준다(Tree 의 자원 창 — 다음)
//   Terra 대응 (트리 Master):
//     공유 — terra.master.svi.grants.post { subject_type: node|user, subject_id, resource_id, operations[], ttl_seconds? } · grants.delete
//       전체 · Leaf · Tree → 노드 주체 허가(흐름 허용 목록, SVI 계약 §12.10). 전체는 Terra 에 클러스터 주체가 없어 지금 있는 노드로 펼친다(이후 추가 노드 제외)
//       계정 → 사용자 주체 허가
//     등록 가능 — terra.master.svi.grants.list (subject_type=node · subject_id=이 노드) + 카탈로그
//     등록 — terra.master.svi.bindings.post { source_resource_id/endpoint_id, target_resource_id/endpoint_id, qos_profile } · bindings.delete
//     클러스터 밖 자원(외부) — Terra 코어에 아직 길이 없다(SVI 허가 · 바인딩은 클러스터 안) — 시안
//   시안 — 바뀐 것은 창 안에서만, 적용하면 기준이 바뀐다
//   허가 주체 — 노드 · 사람. Master 위임 가드(ADR-GW-004 2b): 노드에게 read · subscribe · bind.source, 사람은 나 자신에게만 inspect · read · subscribe · bind.source · bind.target,
//     기한은 반드시 · 90일 이하. 사람 목록(terra.master.admin.users.get)은 위임 밖 — 잠그고 why, '나'(whoami)만 고른다
//   아래 GRANT_OPS · GUARD_OPS · GRANT_DEFAULTS · GRANT_TTLS · OP_KO · selfIdOf · subjectRule · allowedOps · toggleOp · checkGrant · opsText 는 src/api/svi-grant.js 의 사본(시안용) — tests/svi-grant-boards.test.mjs 가 같은지 본다
const GRANT_OPS = ['inspect', 'read', 'subscribe', 'bind.source', 'bind.target', 'write', 'invoke'];
const GUARD_OPS = { user: ['inspect', 'read', 'subscribe', 'bind.source', 'bind.target'], node: ['read', 'subscribe', 'bind.source'] };
const GRANT_DEFAULTS = { user: ['inspect', 'read', 'subscribe'], node: ['read', 'subscribe', 'bind.source'] };
const GUARD_MAX_TTL = 90 * 86400;
const GRANT_TTLS = [['1시간', 3600], ['1일', 86400], ['7일', 604800], ['30일', 2592000], ['90일', 7776000]];
const OP_KO = { discover: '찾기', inspect: '살펴보기', read: '읽기', list: '목록', watch: '지켜보기', subscribe: '구독', 'bind.source': '연결 원천', 'bind.target': '연결 대상', write: '쓰기', invoke: '호출' };
const KIND_KO = { user: '사람', node: '노드' };
function selfIdOf(who) {
  const p = String((who && who.principal) || '').split(/\s+via\s+/)[0].replace(/^user:/, '').trim();
  return p && p !== 'anonymous' ? p : '';
}
function subjectRule(type, id, selfId) {
  const allow = GUARD_OPS[type] || [];
  let why = '';
  if (!allow.length) why = '위임 가드 — 앱 자격으로는 나 자신 또는 같은 클러스터의 노드에게만';
  else if (type === 'user' && !selfId) why = '로그인한 사용자를 알 수 없다';
  else if (type === 'user' && id !== selfId) why = '위임 가드 — 앱 자격으로는 사람 가운데 나 자신에게만 줄 수 있다(ADR-GW-004 D-3)';
  return { ok: !why, why,
    ops: GRANT_OPS.map((op) => { const ok = allow.includes(op); return { op, label: OP_KO[op] || op, ok, why: ok ? '' : '앱 자격으로는 ' + (KIND_KO[type] || type) + '에게 ' + op + ' 를 줄 수 없다' }; }),
    defaults: (GRANT_DEFAULTS[type] || []).slice(), ttls: GRANT_TTLS.slice() };
}
function allowedOps(type, picked) {
  const allow = GUARD_OPS[type] || [], s = new Set(picked || []);
  return GRANT_OPS.filter((op) => allow.includes(op) && s.has(op));
}
function toggleOp(type, picked, op) {
  if (!(GUARD_OPS[type] || []).includes(op)) return allowedOps(type, picked);
  const s = new Set(picked || []); if (s.has(op)) s.delete(op); else s.add(op);
  return allowedOps(type, [...s]);
}
function checkGrant(g, selfId) {
  const no = (why) => ({ ok: false, why });
  const type = (g && g.subject_type) || 'user', allow = GUARD_OPS[type];
  if (!allow) return no('위임 가드 — 앱 자격으로는 나 자신 또는 같은 클러스터의 노드에게만');
  if (!g.subject_id) return no('받는 이가 없다');
  if (type === 'user' && g.subject_id !== selfId) return no(selfId ? '위임 가드 — 사람 가운데 나 자신에게만' : '로그인한 사용자를 알 수 없다');
  const ops = Array.isArray(g.operations) ? g.operations : [];
  if (!ops.length) return no('작업을 하나 이상 고른다');
  const bad = ops.find((o) => !allow.includes(o)); if (bad) return no('앱 자격으로는 ' + KIND_KO[type] + '에게 ' + bad + ' 를 줄 수 없다');
  if (!(g.ttl_seconds > 0)) return no('위임 허가는 기한이 있어야 한다(90일 이하)');
  if (g.ttl_seconds > GUARD_MAX_TTL) return no('위임 허가는 90일까지');
  return { ok: true, why: '' };
}
const opsText = (ops) => (ops && ops.length ? ops.map((o) => OP_KO[o] || o).join(' · ') : '—');

class Component extends DCLogic {
  constructor(props) { super(props); try { window.addEventListener('terra-help', () => this.setState({})); } catch (e) {} this.state = { tab: 'share', res: null, base: null, cur: null, draft: { kind: 'node', who: '전체', picks: [], ops: { node: GRANT_DEFAULTS.node.slice(), user: GRANT_DEFAULTS.user.slice() }, me: true, ttl: '7일', target: '', qos: '신뢰 순서' }, msg: '', open: null }; }
  help() { try { return localStorage.getItem('terra.help') === '1'; } catch (e) { return false; } }   // 설정 › 기타 › 도움말
  TTL() { const o = {}; for (const [k, v] of GRANT_TTLS) o[k] = v; return o; }
  QOS() { return { '실시간 최신': 'realtime_latest', '실시간 순서': 'realtime_ordered', '신뢰 순서': 'reliable_ordered', '대용량 재개': 'bulk_resumable' }; }
  // 시안 계정 — 나(admin)와 같은 Tree 의 다른 사람들(위임 가드가 막으므로 잠근 칩으로만)
  SELF() { return 'admin'; }
  ACCTS() { return ['ops', 'viewer']; }
  // 공유한 자원 — 노드 데스크톱에서 공유로 내놓은 것(시안: 위성 이름). 실제로는 Daemon SVI 선언
  resList() { const r = this.props.resList; return Array.isArray(r) ? r : typeof r === 'string' && r ? r.split(',') : ['ssh:22', 'tty0', 'gpio']; }
  peers() { const p = this.props.peers; if (Array.isArray(p) && p.length) return p;
    return [['01', '트리', ''], ['02', '트리', ''], ['01·a', '리프', '01'], ['02·a', '리프', '02'], ['02·b', '리프', '02'], ['02·c', '리프', '02'], ['03·b', '리프', '03']].map(([name, kind, parent]) => ({ id: name, name, kind, parent })); }
  sinks() { const k = this.props.sinkList; return Array.isArray(k) && k.length ? k : ['store/data', 'display/sink', 'log/in']; }
  me() { return this.props.nodeName || '02·b'; }
  // 소속 클러스터 — 부모 Tree 와 그 아래 리프
  par() { const m = this.peers().find((p) => p.name === this.me()); return (m && m.parent) || this.props.parentName || String(this.me()).split('·')[0]; }
  leaves() { const pa = this.par(); return this.peers().filter((p) => p.name !== this.me() && p.kind === '리프' && p.parent === pa); }
  clusterN() { return this.leaves().length + 1; }
  // 시안 데이터 — 노드 이름으로 정해지는 예시
  seed() {
    const L = this.leaves(), R = this.resList(), pa = this.par(), lf = (i) => (L.length ? L[i % L.length].name : pa);
    const shares = {}; R.forEach((r, i) => { shares[r] = i === 0 ? [{ who: pa, type: 'Tree', ops: ['read', 'subscribe'], ttl: '30일' }, { who: '나 · ' + this.SELF(), type: '사람', ops: ['inspect', 'read', 'subscribe', 'bind.source'], ttl: '7일' }] : i === 1 ? [{ who: '클러스터 전체', type: '전체', ops: ['read', 'subscribe', 'bind.source'], ttl: '90일' }] : []; });
    const avail = [{ res: 'camera/frames', from: lf(0), src: '지명', perm: '연결 원천' }, { res: 'sensor/stats', from: lf(1), src: '전체', perm: '읽기', bound: 'store/data', qos: '신뢰 순서' },
      { res: 'gpu/infer', from: pa, src: '외부', origin: '클러스터 03', perm: '연결 원천' }, { res: 'log/archive', from: pa, src: '외부', origin: '클러스터 01', perm: '읽기' }];
    return { shares, avail: avail.map((a) => Object.assign({ bound: '', qos: '' }, a)) };
  }
  V() { const nk = (this.props.nodeKey || '') + '|' + this.me(); if (this._vk !== nk) { this._vk = nk; this.state.cur = null; this.state.res = null; this.state.open = null; }   // 다른 노드로 열리면 처음부터
    if (!this.state.cur) { const s = this.seed(); this.state.cur = JSON.parse(JSON.stringify(s)); this.state.base = JSON.parse(JSON.stringify(s)); } return this.state.cur; }
  set(fn) { const c = JSON.parse(JSON.stringify(this.V())); fn(c); this.setState({ cur: c, msg: '' }); }
  dirtyN() { const a = this.V(), b = this.state.base; let n = 0;
    for (const r of Object.keys(a.shares)) if (JSON.stringify(a.shares[r]) !== JSON.stringify(b.shares[r] || [])) n++;
    a.avail.forEach((o, i) => { if (JSON.stringify(o) !== JSON.stringify(b.avail[i])) n++; });
    return n; }
  giveNow(res) {
    const D = this.state.draft, pa = this.par(), ops = allowedOps(D.kind, D.ops[D.kind]), ttl = this.TTL()[D.ttl], row = (who, type) => ({ who, type, ops, ttl: D.ttl });
    const list = D.kind === 'user' ? (D.me ? [row('나 · ' + this.SELF(), '사람')] : []) : D.who === '전체' ? [row('클러스터 전체', '전체')] : D.who === 'Tree' ? [row(pa, 'Tree')] : D.picks.map((w) => row(w, 'Leaf'));
    if (!list.length) { this.setState({ msg: D.kind === 'user' ? '나를 고른다' : 'Leaf 선택 필요' }); return; }
    const c = checkGrant({ subject_type: D.kind, subject_id: D.kind === 'user' ? this.SELF() : 'n', operations: ops, ttl_seconds: ttl }, this.SELF()); if (!c.ok) { this.setState({ msg: c.why }); return; }
    this.set((v) => { const g = v.shares[res] || (v.shares[res] = []); for (const x of list) { const i = g.findIndex((y) => y.who === x.who && y.type === x.type); if (i >= 0) g[i] = x; else g.push(x); } });
    this.setState({ draft: Object.assign({}, D, { picks: [] }), msg: D.kind === 'node' && D.who === '전체' && this.help() ? '전체 · 지금 ' + this.clusterN() + '곳 (이후 추가 노드 제외)' : '' });
  }
  /** 주체 · 작업 · 기한 칸(시안 · 실제 공통) — o: { selfId, others[], peopleWhy, ttlCur } */
  compose(o) {
    const D = this.state.draft, k = D.kind, up = (p) => this.setState({ draft: Object.assign({}, D, p), msg: '' });
    const R = subjectRule(k, k === 'user' ? o.selfId : 'n', o.selfId), ops = allowedOps(k, D.ops[k]), ttls = R.ttls.map((t) => t[0]), tc = ttls.includes(D.ttl) ? D.ttl : '7일';
    const sg = (opts, cur, fn) => opts.map((x) => ({ name: x, cls: cur === x ? 'on' : '', on: cur === x ? 'true' : 'false', pick: () => fn(x) }));
    const meOk = !!o.selfId, rule = subjectRule('user', o.selfId, o.selfId);
    return {
      kindOpts: [['node', '노드'], ['user', '사람']].map(([id, nm]) => ({ name: nm, cls: k === id ? 'on' : '', on: k === id ? 'true' : 'false', pick: () => up({ kind: id }) })),
      kindNote: k === 'user' ? '사람 — 앱 자격으로는 나 자신에게만' : '노드 — 같은 클러스터', isNodeKind: k === 'node', isUserKind: k === 'user',
      people: [{ name: '나 · ' + (o.selfId || '알 수 없음'), on: meOk && D.me ? 'true' : 'false', cls: meOk && D.me ? 'on' : '', off: meOk ? null : 'disabled', tip: meOk ? '이 계정(whoami)' : rule.why, pick: () => up({ me: !D.me }) }]
        .concat((o.others || []).map((nm) => ({ name: nm, on: 'false', cls: '', off: 'disabled', tip: subjectRule('user', nm, o.selfId).why, pick: () => {} }))),
      peopleWhy: o.peopleWhy,
      opChips: R.ops.map((c) => { const on = ops.includes(c.op); return { name: c.label, on: on ? 'true' : 'false', cls: on ? 'on' : '', off: c.ok ? null : 'disabled', tip: c.ok ? c.op : c.why, pick: () => up({ ops: Object.assign({}, D.ops, { [k]: toggleOp(k, D.ops[k], c.op) }) }) }; }),
      ttlOpts: sg(ttls, tc, (x) => up({ ttl: x })), ttlCur: tc, ops,
      giveOff: (k === 'user' && (!meOk || !D.me)) || !ops.length ? 'disabled' : null,
      permOps: (ops.length ? ops.join(' · ') : '작업 없음') + ' · ' + tc + ' — 앱 자격의 허가는 ' + (k === 'user' ? '나에게 inspect · read · subscribe · bind.source · bind.target' : '노드에게 read · subscribe · bind.source') + ', 기한 90일 이하(Master 위임 가드)'
    };
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
  componentWillUnmount() { if (this._un) { this._un(); this._un = null; } }
  live() { if (this._un || typeof window === 'undefined' || !window.TerraNodes) return; this._un = window.TerraNodes.subscribe(() => this.setState({})); }
  // 자원 창 — 실제: 자원 공유 = 이 노드의 SVI 자원(svi.resources.get)마다 허가(svi.grants.*), 외부 자원 등록 = 이 노드를 지명한 허가 + 바인딩(svi.bindings.*).
  //   적용은 바로 Master 에 간다(시안의 '적용' 단계 없음). 사람 주체는 '나'(whoami) 하나 — 사용자 목록(admin.users.get)은 위임 밖이라 문이 잠그고, 남은 위임 가드가 막는다
  realVals() {
    const C = this.RT(); if (!C) return null; this.live();
    const S = this.state, D = S.draft, H = this.help(), SV = C.SV, QOS = this.QOS(), TC = { 전체: 'sc', Tree: 'tr', Leaf: 'nd', 사람: 'us', 지명: 'nd' }, W0 = window, me = selfIdOf(W0.TerraWho);
    const res = C.rd('terra.master.svi.resources.get'), gr = C.rd('terra.master.svi.grants.get'), bi = C.rd('terra.master.svi.bindings.get');
    const mine = SV.resources(res.data).filter((r) => r.node === C.rid), cur = mine.find((r) => r.name === S.res) || mine[0] || null;
    const say = (m) => this.setState({ msg: m }), fail = (e) => say('못 함 · ' + ((e && (e.message || e.code)) || '오류'));
    const W = (op, input, after) => C.TN.write(C.key, op, input).then(() => { C.TN.refresh(C.key, after); }, fail);
    const sg = (opts, v, fn) => opts.map((o) => ({ name: o, cls: v === o ? 'on' : '', on: v === o ? 'true' : 'false', pick: () => fn(o) }));
    const leaves = C.metas.filter((m) => m.rid !== C.rid && m.rid !== C.parent).map((m) => ({ id: m.rid, name: m.name }));
    const G = cur ? SV.grantRows(gr.data, cur.id, C.names, C.parent, Date.now(), me) : [], AV = SV.availRows(gr.data, res.data, bi.data, C.rid, C.names), sk = SV.sinks(res.data, C.rid);
    const regs = AV.filter((o) => o.bound), av = AV.filter((o) => !o.bound), who = D.who;
    const openRs = (name, src, from) => () => (this.props.onOpen ? this.props.onOpen('res', name + '|' + (src || '') + '|' + (from || '')) : null);
    const why = [res, gr, bi].map((r, i) => (r.err && !r.data ? ['svi.resources', 'svi.grants', 'svi.bindings'][i] + ' · ' + r.err.code : '')).filter(Boolean).join(' · ');
    const UG = W0.TerraGate ? W0.TerraGate('terra.master.admin.users.get') : { open: true, why: '' };
    const CP = this.compose({ selfId: me, others: [], peopleWhy: (UG.open ? '' : '사람 목록 잠김 — ' + UG.why + ' · ') + '나 말고는 위임 가드가 막는다(앱 자격으로는 나 자신에게만)' });
    const give = () => {
      if (!cur) return; const ops = allowedOps(D.kind, D.ops[D.kind]), ttl = this.TTL()[CP.ttlCur];   // 위임 허가는 기한이 있어야 한다(90일 이하)
      if (D.kind === 'user') { const g = { subject_type: 'user', subject_id: me, resource_id: cur.id, operations: ops, ttl_seconds: ttl }, c = checkGrant(g, me); if (!c.ok) { say(c.why); return; }
        C.TN.write(C.key, 'terra.master.svi.grants.post', g).then(() => { say('허가 — 나 · ' + opsText(ops)); C.TN.refresh(C.key, 'terra.master.svi.grants.get'); }, fail); return; }
      const subs = who === '전체' ? [C.parent].concat(leaves.map((l) => l.id)).filter(Boolean) : who === 'Tree' ? [C.parent].filter(Boolean) : D.picks.map((nm) => (leaves.find((l) => l.name === nm) || {}).id).filter(Boolean);
      if (!subs.length) { say(who === 'Leaf' && leaves.length ? 'Leaf 선택 필요' : '줄 노드가 없다 — ' + (C.parent ? '보이는 다른 노드가 없다' : '부모 Tree 도 다른 노드도 보이지 않는다(단독 리프)')); return; }
      const c = checkGrant({ subject_type: 'node', subject_id: subs[0], operations: ops, ttl_seconds: ttl }, me); if (!c.ok) { say(c.why); return; }
      Promise.all(subs.map((id) => C.TN.write(C.key, 'terra.master.svi.grants.post', { subject_type: 'node', subject_id: id, resource_id: cur.id, operations: ops, ttl_seconds: ttl })))
        .then(() => { say('허가 ' + subs.length + '건 — ' + opsText(ops)); C.TN.refresh(C.key, 'terra.master.svi.grants.get'); }, fail);
      this.setState({ draft: Object.assign({}, D, { picks: [] }) });
    };
    return Object.assign({
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.me(), kind: this.props.nodeKind || '리프', cluster: C.parent ? '클러스터 ' + (C.names.get(C.parent) || C.parent) : '단독 리프',
      tabs: [['share', '자원 공유', mine.length], ['reg', '외부 자원 등록', regs.length]].map(([id, nm, c]) => ({ name: nm, n: c ? '' + c : '', cls: S.tab === id ? 'on' : '', cur: S.tab === id ? 'page' : 'false', pick: () => this.setState({ tab: id, open: null }) })),
      isShare: S.tab === 'share', isReg: S.tab === 'reg', apiG: H ? 'svi.grants' : '', apiB: H ? 'svi.bindings' : '', apiV: H ? '이 노드를 지명한 허가' : '',
      resItems: mine.map((r) => ({ name: r.name, n: '', cls: cur && r.id === cur.id ? 'on' : '', pick: () => this.setState({ res: r.name }) })),
      openRes: cur ? openRs(cur.name, '', '') : () => {}, res: cur ? cur.name : '', hasRes: !!cur, noRes: !cur, noGrants: !!cur && G.length === 0,
      grants: G.map((g) => ({ who: g.who, type: g.type, typeCls: TC[g.type] || 'nd', perm: opsText(String(g.ops || '').split(' · ').filter(Boolean)), ops: g.ops, ttl: g.ttl === '없음' ? '기한 없음' : g.ttl,
        del: () => W('terra.master.svi.grants.by-grant-id.delete', { grant_id: g.id }, 'terra.master.svi.grants.get') })),
      whoOpts: sg(['전체', 'Tree', 'Leaf'], who, (o) => this.setState({ draft: Object.assign({}, D, { who: o, picks: [] }) })),
      whoNote: who === '전체' ? '부모 Tree 와 지금 보이는 노드 ' + (leaves.length + (C.parent ? 1 : 0)) + '곳(이후 추가 노드 제외)' : who === 'Tree' ? (C.names.get(C.parent) || C.parent || '부모 없음') : '',
      hasPicks: who === 'Leaf' && leaves.length > 0,
      picks: (who === 'Leaf' ? leaves : []).map((l) => { const on = D.picks.includes(l.name); return { name: l.name, on: on ? 'true' : 'false', cls: on ? 'on' : '', pick: () => this.setState({ draft: Object.assign({}, D, { picks: on ? D.picks.filter((x) => x !== l.name) : D.picks.concat([l.name]) }) }) }; }),
      give,
      regs: regs.map((o) => ({ open: openRs(o.res, o.src, o.from), res: o.res, src: o.src, srcCls: 'nd', from: o.from, target: o.bound, qos: o.qos, cut: () => W('terra.master.svi.bindings.by-binding-id.delete', { binding_id: o.bindId }, 'terra.master.svi.bindings.get') })),
      noRegs: regs.length === 0,
      avail: av.map((o, j) => { const editing = S.open === 'reg' + j, tg = sk.find((x) => x.label === D.target) || sk[0];
        return { open: openRs(o.res, o.src, o.from), res: o.res, src: o.src, srcCls: 'nd', from: o.from, perm: o.perm, state: o.canBind ? (sk.length ? '' : '이 노드에 받는 끝점(sink)이 없다') : '읽기 — 연결 원천(bind.source) 허가면 이어 받기', canReg: !editing && o.canBind && sk.length > 0, editing,
          reg: () => this.setState({ open: 'reg' + j, draft: Object.assign({}, D, { target: sk[0] ? sk[0].label : '' }) }),
          targets: sg(sk.map((x) => x.label), tg ? tg.label : '', (v) => this.setState({ draft: Object.assign({}, D, { target: v }) })), qosOpts: sg(Object.keys(QOS), D.qos, (q) => this.setState({ draft: Object.assign({}, D, { qos: q }) })),
          ok: () => { if (!tg) return; W('terra.master.svi.bindings.post', SV.bindBody(o, tg, QOS[D.qos]), 'terra.master.svi.bindings.get'); this.setState({ open: null }); }, cancel: () => this.setState({ open: null }) }; }),
      noAvail: av.length === 0,
      dirtyT: '바로 반영 — Master', clean: 'disabled', msg: S.msg || why || (res.loading && !res.data ? '받는 중…' : ''),
      apply: () => {}, revert: () => {}, openDesk: () => (this.props.onOpen ? this.props.onOpen('ctl') : null)
    }, CP);
  }
  renderVals() {
    const RV = this.realVals(); if (RV) return RV;
    const F = this.props.focusRes || ''; if (F !== this._fseen) { this._fseen = F; if (F) { this.state.res = F; this.state.tab = 'share'; } }   // 위성에서 열었으면 그 자원을 고른 채로
    const S = this.state, v = this.V(), R = this.resList(), res = S.res && R.includes(S.res) ? S.res : R[0] || '', D = S.draft, n = this.dirtyN(), H = this.help();
    const sg = (opts, cur, fn) => opts.map((o) => ({ name: o, cls: cur === o ? 'on' : '', on: cur === o ? 'true' : 'false', pick: () => fn(o) }));
    const TC = { 전체: 'sc', Tree: 'tr', Leaf: 'nd', 사람: 'us', 지명: 'nd', 외부: 'ex' };
    const UG = typeof window !== 'undefined' && window.TerraGate ? window.TerraGate('terra.master.admin.users.get') : { open: true, why: '' };   // 시안 — 문이 없으면 열린 것으로(다른 사람은 시안 계정)
    const CP = this.compose({ selfId: this.SELF(), others: UG.open ? this.ACCTS() : [], peopleWhy: (UG.open ? '' : '사람 목록 잠김 — ' + UG.why + ' · ') + '다른 사람은 위임 가드가 막는다 — 앱 자격으로는 나 자신에게만(ADR-GW-004 D-3)' });
    const G = v.shares[res] || [], regs = v.avail.map((o, j) => [o, j]).filter(([o]) => o.bound), av = v.avail.map((o, j) => [o, j]).filter(([o]) => !o.bound);
    const fromT = (o) => (o.src === '외부' ? 'Tree ← ' + o.origin : o.from);
    const openRs = (name, src, from) => () => (this.props.onOpen ? this.props.onOpen('res', name + '|' + (src || '') + '|' + (from || '')) : this.setState({ msg: name + ' 상태 창 (시안)' }));
    const pickOpts = D.who === 'Leaf' ? this.leaves().map((p) => p.name) : [];
    return Object.assign({
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.me(), kind: this.props.nodeKind || '리프', cluster: '클러스터 ' + this.par(),
      tabs: [['share', '자원 공유', R.length], ['reg', '외부 자원 등록', regs.length]].map(([id, nm, c]) => ({ name: nm, n: c ? '' + c : '', cls: S.tab === id ? 'on' : '', cur: S.tab === id ? 'page' : 'false', pick: () => this.setState({ tab: id, open: null }) })),
      isShare: S.tab === 'share', isReg: S.tab === 'reg',
      apiG: H ? 'svi.grants' : '', apiB: H ? 'svi.bindings' : '', apiV: H ? '지명 · 전체 · Tree 외부' : '',
      resItems: R.map((r) => ({ name: r, n: (v.shares[r] || []).length ? '' + (v.shares[r] || []).length : '', cls: r === res ? 'on' : '', pick: () => this.setState({ res: r }) })),
      openRes: openRs(res, '', ''), res, hasRes: R.length > 0, noRes: R.length === 0, noGrants: R.length > 0 && G.length === 0,
      grants: G.map((g, j) => ({ who: g.who, type: g.type, typeCls: TC[g.type] || 'nd', perm: opsText(g.ops), ops: (g.ops || []).join(' · '), ttl: g.ttl === '없음' ? '기한 없음' : g.ttl,
        del: () => this.set((c) => { c.shares[res] = (c.shares[res] || []).filter((x, q) => q !== j); }) })),
      whoOpts: sg(['전체', 'Tree', 'Leaf'], D.who, (o) => this.setState({ draft: Object.assign({}, D, { who: o, picks: [] }) })),
      whoNote: D.who === '전체' ? (H ? '소속 클러스터 전체 · ' + this.clusterN() + '곳' : '소속 클러스터') : D.who === 'Tree' ? this.par() + (H ? ' — 클러스터 밖은 Tree 가 전달' : '') : '',
      hasPicks: pickOpts.length > 0,
      picks: pickOpts.map((w) => { const on = D.picks.includes(w); return { name: w, on: on ? 'true' : 'false', cls: on ? 'on' : '', pick: () => this.setState({ draft: Object.assign({}, D, { picks: on ? D.picks.filter((x) => x !== w) : D.picks.concat([w]) }) }) }; }),
      give: () => this.giveNow(res),
      regs: regs.map(([o, j]) => ({ open: openRs(o.res, o.src, o.from), res: o.res, src: o.src, srcCls: TC[o.src] || 'sc', from: fromT(o), target: o.bound, qos: o.qos, cut: () => this.set((c) => { c.avail[j].bound = ''; c.avail[j].qos = ''; }) })),
      noRegs: regs.length === 0,
      avail: av.map(([o, j]) => { const editing = S.open === 'reg' + j, bindable = o.perm === '연결 원천';
        return { open: openRs(o.res, o.src, o.from), res: o.res, src: o.src, srcCls: TC[o.src] || 'sc', from: fromT(o), perm: o.perm, state: bindable ? '' : H ? '읽기 — 연결 원천 권한이면 이어 받기' : '읽기', canReg: !editing, editing,
          reg: () => this.setState({ open: 'reg' + j, draft: Object.assign({}, D, { target: this.sinks()[0] }) }),
          targets: sg(this.sinks(), D.target, (t) => this.setState({ draft: Object.assign({}, D, { target: t }) })), qosOpts: sg(Object.keys(this.QOS()), D.qos, (q) => this.setState({ draft: Object.assign({}, D, { qos: q }) })),
          ok: () => { this.set((c) => { c.avail[j].bound = D.target; c.avail[j].qos = D.qos; }); this.setState({ open: null }); }, cancel: () => this.setState({ open: null }) }; }),
      noAvail: av.length === 0,
      dirtyT: n ? '변경 ' + n : '변경 없음', clean: n ? null : 'disabled', msg: S.msg,
      apply: () => this.setState({ base: JSON.parse(JSON.stringify(v)), msg: '적용 ' + n + '건' + (H ? ' (시안 · svi.grants · svi.bindings)' : '') }),
      revert: () => this.setState({ cur: JSON.parse(JSON.stringify(S.base)), msg: '되돌림', open: null }),
      openDesk: () => (this.props.onOpen ? this.props.onOpen('ctl') : this.setState({ msg: '노드 데스크톱을 엽니다 (시안)' }))
    }, CP);
  }
}
