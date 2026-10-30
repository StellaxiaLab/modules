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
class Component extends DCLogic {
  constructor(props) { super(props); try { window.addEventListener('terra-help', () => this.setState({})); } catch (e) {} this.state = { tab: 'share', res: null, base: null, cur: null, draft: { who: '전체', picks: [], perm: '읽기', ttl: '없음', target: '', qos: '신뢰 순서' }, msg: '', open: null }; }
  help() { try { return localStorage.getItem('terra.help') === '1'; } catch (e) { return false; } }   // 설정 › 기타 › 도움말
  PERMS() { return { 보기: ['discover', 'inspect'], 읽기: ['discover', 'inspect', 'read', 'list', 'watch', 'subscribe'], 쓰기: ['discover', 'inspect', 'read', 'list', 'watch', 'subscribe', 'write'], 제어: ['discover', 'inspect', 'read', 'list', 'watch', 'subscribe', 'write', 'invoke'], '연결 원천': ['discover', 'inspect', 'bind.source'] }; }
  TTL() { return { 없음: 0, '1시간': 3600, '1일': 86400, '7일': 604800 }; }
  QOS() { return { '실시간 최신': 'realtime_latest', '실시간 순서': 'realtime_ordered', '신뢰 순서': 'reliable_ordered', '대용량 재개': 'bulk_resumable' }; }
  ACCTS() { return ['admin', 'ops', 'viewer']; }
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
    const shares = {}; R.forEach((r, i) => { shares[r] = i === 0 ? [{ who: pa, type: 'Tree', perm: '읽기', ttl: '없음' }, { who: 'ops', type: '계정', perm: '제어', ttl: '1일' }] : i === 1 ? [{ who: '클러스터 전체', type: '전체', perm: '연결 원천', ttl: '없음' }] : []; });
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
    const D = this.state.draft, pa = this.par(), row = (who, type) => ({ who, type, perm: D.perm, ttl: D.ttl });
    const list = D.who === '전체' ? [row('클러스터 전체', '전체')] : D.who === 'Tree' ? [row(pa, 'Tree')] : D.picks.map((w) => row(w, D.who));
    if (!list.length) { this.setState({ msg: (D.who === '계정' ? '계정' : 'Leaf') + ' 선택 필요' }); return; }
    this.set((v) => { const g = v.shares[res] || (v.shares[res] = []); for (const x of list) { const i = g.findIndex((y) => y.who === x.who && y.type === x.type); if (i >= 0) g[i] = x; else g.push(x); } });
    this.setState({ draft: Object.assign({}, D, { picks: [] }), msg: D.who === '전체' && this.help() ? '전체 · 지금 ' + this.clusterN() + '곳 (이후 추가 노드 제외)' : '' });
  }
  renderVals() {
    const F = this.props.focusRes || ''; if (F !== this._fseen) { this._fseen = F; if (F) { this.state.res = F; this.state.tab = 'share'; } }   // 위성에서 열었으면 그 자원을 고른 채로
    const S = this.state, v = this.V(), R = this.resList(), res = S.res && R.includes(S.res) ? S.res : R[0] || '', D = S.draft, PM = this.PERMS(), n = this.dirtyN(), H = this.help();
    const sg = (opts, cur, fn) => opts.map((o) => ({ name: o, cls: cur === o ? 'on' : '', on: cur === o ? 'true' : 'false', pick: () => fn(o) }));
    const TC = { 전체: 'sc', Tree: 'tr', Leaf: 'nd', 계정: 'us', 지명: 'nd', 외부: 'ex' };
    const G = v.shares[res] || [], regs = v.avail.map((o, j) => [o, j]).filter(([o]) => o.bound), av = v.avail.map((o, j) => [o, j]).filter(([o]) => !o.bound);
    const fromT = (o) => (o.src === '외부' ? 'Tree ← ' + o.origin : o.from);
    const openRs = (name, src, from) => () => (this.props.onOpen ? this.props.onOpen('res', name + '|' + (src || '') + '|' + (from || '')) : this.setState({ msg: name + ' 상태 창 (시안)' }));
    const pickOpts = D.who === 'Leaf' ? this.leaves().map((p) => p.name) : D.who === '계정' ? this.ACCTS() : [];
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.me(), kind: this.props.nodeKind || '리프', cluster: '클러스터 ' + this.par(),
      tabs: [['share', '자원 공유', R.length], ['reg', '외부 자원 등록', regs.length]].map(([id, nm, c]) => ({ name: nm, n: c ? '' + c : '', cls: S.tab === id ? 'on' : '', cur: S.tab === id ? 'page' : 'false', pick: () => this.setState({ tab: id, open: null }) })),
      isShare: S.tab === 'share', isReg: S.tab === 'reg',
      apiG: H ? 'svi.grants' : '', apiB: H ? 'svi.bindings' : '', apiV: H ? '지명 · 전체 · Tree 외부' : '',
      resItems: R.map((r) => ({ name: r, n: (v.shares[r] || []).length ? '' + (v.shares[r] || []).length : '', cls: r === res ? 'on' : '', pick: () => this.setState({ res: r }) })),
      openRes: openRs(res, '', ''), res, hasRes: R.length > 0, noRes: R.length === 0, noGrants: R.length > 0 && G.length === 0,
      grants: G.map((g, j) => ({ who: g.who, type: g.type, typeCls: TC[g.type] || 'nd', perm: g.perm, ops: PM[g.perm].join(' · '), ttl: g.ttl === '없음' ? '기한 없음' : g.ttl,
        del: () => this.set((c) => { c.shares[res] = (c.shares[res] || []).filter((x, q) => q !== j); }) })),
      whoOpts: sg(['전체', 'Tree', 'Leaf', '계정'], D.who, (o) => this.setState({ draft: Object.assign({}, D, { who: o, picks: [] }) })),
      whoNote: D.who === '전체' ? (H ? '소속 클러스터 전체 · ' + this.clusterN() + '곳' : '소속 클러스터') : D.who === 'Tree' ? this.par() + (H ? ' — 클러스터 밖은 Tree 가 전달' : '') : '',
      hasPicks: pickOpts.length > 0,
      picks: pickOpts.map((w) => { const on = D.picks.includes(w); return { name: w, on: on ? 'true' : 'false', cls: on ? 'on' : '', pick: () => this.setState({ draft: Object.assign({}, D, { picks: on ? D.picks.filter((x) => x !== w) : D.picks.concat([w]) }) }) }; }),
      permOpts: sg(Object.keys(PM), D.perm, (o) => this.setState({ draft: Object.assign({}, D, { perm: o }) })), permOps: H ? PM[D.perm].join(' · ') : '',
      ttlOpts: sg(Object.keys(this.TTL()), D.ttl, (o) => this.setState({ draft: Object.assign({}, D, { ttl: o }) })),
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
    };
  }
}
