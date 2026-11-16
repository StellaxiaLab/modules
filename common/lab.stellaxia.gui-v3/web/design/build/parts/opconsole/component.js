class Component extends DCLogic {
  constructor(props) { super(props);
    this.state = { q: '', cat: '', tier: '', sel: '', vals: {}, free: '', node: '', arm: false, running: false, res: null, desc: null, cat0: null, catErr: '' }; }
  componentDidMount() { this._live = true; if (this.real()) this.loadCatalog(); }
  componentWillUnmount() { this._live = false; clearTimeout(this._armT); }
  real() { return typeof window !== 'undefined' && !!window.TerraTransport && !!window.TerraCatalog; }
  set(p) { if (this._live !== false) this.setState(p); }
  // 카탈로그 — 실제 : window.TerraCatalog(src/boot/main.js) · 시안(캔버스) : 아래 sample() 몇 개
  loadCatalog() {
    this.set({ cat0: null, catErr: '' });
    window.TerraCatalog.list().then((r) => this.set({ cat0: normalizeCatalog(r) }), (e) => this.set({ cat0: [], catErr: (e && (e.code || e.message)) || 'ERROR' }));
  }
  items() {
    if (this.real()) return this.state.cat0;
    return this._sample || (this._sample = normalizeCatalog(sample()));
  }
  canApprove() { return this.real() ? !!(window.TerraCanApprove && window.TerraCanApprove()) : true; }
  lock(it) { return lockOf(it, { gate: this.real() && window.TerraGate ? window.TerraGate : null, canApprove: this.canApprove(), remote: !!this.state.node.trim() }); }
  // 고른 것 — 스키마는 하나씩(describe)
  pick(it) {
    this.set({ sel: it.id, vals: {}, free: '', node: '', arm: false, res: null, desc: this.real() ? { st: 'load' } : { st: 'ok', schema: sampleSchema(it.id) } });
    if (!this.real()) { const F = formFields(sampleSchema(it.id)); this.set({ vals: initialValues(F.fields) }); return; }
    const id = it.id;
    window.TerraCatalog.describe(id).then((d) => {
      if (this.state.sel !== id) return;
      const schema = d && d.input && typeof d.input === 'string' ? safeParse(d.input) : d && d.input;
      this.set({ desc: { st: 'ok', schema }, vals: initialValues(formFields(schema).fields) });
    }, (e) => { if (this.state.sel === id) this.set({ desc: { st: 'err', err: (e && (e.code || e.message)) || 'ERROR' } }); });
  }
  form() { const d = this.state.desc; if (!d || d.st !== 'ok') return { fields: [], free: d && d.st === 'err' }; return formFields(d.schema); }
  built() { const F = this.form(); return F.free ? buildFree(this.state.free) : buildInput(F.fields, this.state.vals); }
  run(it) {
    const S = this.state, L = this.lock(it); if (L.locked || S.running) return;
    const B = this.built(); if (!B.ok) { this.set({ res: { ok: false, head: '입력 오류 — 빨간 칸을 고치세요', body: '' } }); return; }
    if (it.tier === 'T2' && !S.arm) { this.set({ arm: true }); clearTimeout(this._armT); this._armT = setTimeout(() => this.set({ arm: false }), 4000); return; }
    clearTimeout(this._armT); this.set({ arm: false, running: true, res: null });
    const T = window.TerraTransport, node = S.node.trim();
    const deps = this.real()
      ? { invoke: (rid, op, inp) => T.invokeRid(rid, op, inp), invokeLocal: (op, inp) => T.invoke(T.localId(), op, inp), approve: window.TerraApprove, textOf: (op, e, c) => (window.TerraErrorLine ? window.TerraErrorLine(op, e, c) : String((e && e.message) || '')) }
      : { invoke: async () => ({ sample: true }), invokeLocal: async (op) => ({ sample: true, op }), approve: async (op) => ({ ok: true, data: { sample: true, op }, withheld: it.approval ? it.approval.secret : [] }) };
    runOp({ item: it, input: B.input, node }, deps).then((r) => {
      if (r.ok) this.set({ running: false, res: { ok: true, head: (r.via === 'door' ? '승인됨 · 완료' : '완료'), body: resultText(r.data), withheld: r.withheld || [] } });
      else this.set({ running: false, res: r.silent ? null : { ok: false, head: r.text || r.code, body: '', code: r.code } });
    });
  }
  renderVals() {
    const R = this.real(), S = this.state, all = this.items(), D = '—';
    const loading = all === null, list = all || [];
    const shown = filterOps(list, { q: S.q, cat: S.cat, tier: S.tier }), CAP = 200, rows = shown.slice(0, CAP);
    const it = list.find((o) => o.id === S.sel) || null, L = it ? this.lock(it) : null, F = this.form(), B = it ? this.built() : null;
    const d = S.desc, errs = (S.res && S.res.ok === false && S.res.head.startsWith('입력 오류')) ? B.errors : (it && this._touched ? B.errors : {});
    const cats = [['', '분류 — 전체 ' + list.length]].concat(categories(list).map(([c, n]) => [c, c + ' · ' + n]));
    const tierN = (t) => list.filter((o) => o.tier === t).length;
    const node = S.node.trim(), canRemote = it && it.tier !== 'T3' && it.tier !== 'T4' && (!R || !window.TerraCanRemote || window.TerraCanRemote(it.id));
    const free = it && F.free, bad = (k) => (errs[k] ? 'true' : 'false');
    const touch = () => { this._touched = true; };
    const setVal = (k) => (e) => { touch(); this.set({ vals: Object.assign({}, this.state.vals, { [k]: e.target.value }), arm: false }); };
    const fields = it ? F.fields.map((f) => ({
      key: f.key, label: f.label, desc: f.desc, req: f.required ? '*' : '', err: errs[f.key] || '', bad: bad(f.key),
      isText: f.kind === 'text' || f.kind === 'number', isEnum: f.kind === 'enum' || f.kind === 'bool', isJson: f.kind === 'json',
      itype: f.kind === 'number' ? 'number' : f.secret ? 'password' : 'text', value: S.vals[f.key] == null ? '' : S.vals[f.key],
      ph: f.kind === 'json' ? (f.type === 'array' ? '[…]' : '{…}') : f.desc ? f.desc.slice(0, 40) : f.type, onInput: setVal(f.key),
      opts: (f.kind === 'bool' ? ['', 'true', 'false'] : [''].concat(f.enum)).map((v) => ({ v, t: v === '' ? (f.required ? '— 고르기 —' : '— 안 보냄 —') : v, sel: (S.vals[f.key] || '') === v })),
    })) : [];
    const runOff = !it || !!(L && L.locked) || S.running || (d && d.st === 'load');
    const apv = it && (it.tier === 'T3' || it.tier === 'T4');
    const secret = it && it.approval ? it.approval.secret : [];
    const res = S.res, runT = S.running ? (apv ? '승인 기다리는 중…' : '실행 중…') : it ? buttonText(it.tier, S.arm) : '';
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.props.nodeName || D,
      countT: loading ? '카탈로그 읽는 중…' : shown.length === list.length ? list.length + '개' : shown.length + ' / ' + list.length + '개',
      srcT: R ? '출처 : Gateway /api/v1/catalog · 등급 : 계약 execution · T3 · T4 는 승인 문(사람이 승인)' : '시안 값 · 실제 Terra 에서는 카탈로그 전체',
      noteOn: !!S.catErr || (R && !this.canApprove()), noteCls: S.catErr ? 'warn' : '',
      note: S.catErr ? '카탈로그를 못 읽음 : ' + S.catErr + ' — 다시 열기' : '승인 문 없음 — T3 · T4 operation 은 Terra 셸 안에서만 부를 수 있음 (단독 실행)',
      q: S.q, onQ: (e) => this.set({ q: e.target.value }),
      tierChips: [['', '전체']].concat(TIERS.map(([t, n]) => [t, t + ' ' + tierN(t)])).map(([t, name]) => ({ name, on: S.tier === t ? 'true' : 'false', cls: S.tier === t ? 'on' : '', tip: t ? tierName(t) : '모든 등급', pick: () => this.set({ tier: t }) })),
      cats: cats.map(([v, t]) => ({ v, t, sel: S.cat === v })), onCat: (e) => this.set({ cat: e.target.value }),
      rows: rows.map((o) => { const lk = this.lock(o); return { id: o.id, tier: o.tier, on: S.sel === o.id ? 'true' : 'false', cls: (S.sel === o.id ? 'on ' : '') + (lk.locked ? 'lk' : ''), tip: (lk.locked ? '🔒 ' + CHIP_TEXT[lk.chip] + ' — ' : '') + (o.title || o.summary || o.id), pick: () => { this._touched = false; this.pick(o); } }; }),
      empty: !loading && !rows.length, emptyT: loading ? '받는 중…' : list.length ? '맞는 operation 없음' : R ? '카탈로그가 비었음' : D,
      moreOn: shown.length > CAP, moreT: '… ' + (shown.length - CAP) + '개 더 — 검색으로 좁히기',
      noSel: !it, hasSel: !!it,
      selId: it ? it.id : '', selTier: it ? it.tier : 'T0', selTierName: it ? tierName(it.tier) + (it.risk ? ' · 위험도 ' + it.risk : '') + (it.out ? ' · ' + it.out : '') : '', selTitle: it ? it.title : '',
      selSumOn: !!(it && it.summary), selSum: it ? it.summary : '',
      impactOn: !!(it && it.approval && it.approval.impact), impact: it && it.approval ? it.approval.impact : '',
      lockOn: !!(L && L.locked), chipT: L ? CHIP_TEXT[L.chip] || '잠김' : '', why: L ? L.why : '',
      secretOn: secret.length > 0, secretT: secret.join(' · '),
      descLoad: !!(d && d.st === 'load'), descErrOn: !!(d && d.st === 'err'), descErr: d && d.err ? d.err : '',
      fields, freeOn: !!free, freeV: S.free, onFree: (e) => { touch(); this.set({ free: e.target.value, arm: false }); }, freeBad: bad('_free'), freeErr: errs._free || '',
      nodeOn: !!canRemote, nodeV: S.node, onNode: (e) => this.set({ node: e.target.value, arm: false }), nodeT: node ? '노드 ' + node : '이 노드',
      armCls: S.arm ? 'arm' : '', armOn: !!S.arm, disarm: () => { clearTimeout(this._armT); this.set({ arm: false }); },
      runOff: runOff ? 'disabled' : null, runT, run: () => it && this.run(it),
      runTip: L && L.locked ? L.why : it ? (apv ? '호스트의 승인 화면에서 사람이 승인해야 나갑니다' : it.tier === 'T2' ? '두 번 눌러야 실행됩니다' : '곧장 실행') : '',
      runSub: it ? (apv ? '승인 문 — 이 페이지가 아니라 호스트가 부름' : it.tier === 'T2' ? '앱 확인 — 두 번 누르기' : '앱 토큰으로 곧장') : '',
      cli: it ? cliLine(it.id, B && B.ok ? B.input : null) : '',
      resOn: !!res, resCls: res && !res.ok ? 'bad' : '', resHead: res ? res.head : '', resBodyOn: !!(res && res.body), resBody: res ? res.body : '',
      withheldOn: !!(res && res.withheld && res.withheld.length), withheldT: res && res.withheld ? res.withheld.join(' · ') : '',
    };
  }
}
function safeParse(t) { try { return JSON.parse(t); } catch (e) { return null; } }
// 시안(캔버스) — 등급마다 하나씩
function sample() {
  const ex = (risk, ap) => ({ risk, confirmationMode: risk === 'dangerous' ? 'required' : 'none', approval: ap });
  return { operations: [
    { operationId: 'terra.daemon.status.get', title: '노드 상태', summary: '이 노드 Daemon 의 상태', category: 'daemon · status', execution: ex('read'), output: { mode: 'immediate' } },
    { operationId: 'terra.daemon.modules.get', title: '모듈 목록', category: 'daemon · modules', execution: ex('read') },
    { operationId: 'terra.daemon.config.patch', title: '설정 고치기', summary: '노드 설정의 일부를 바꾼다', category: 'daemon · config', execution: ex('write') },
    { operationId: 'terra.daemon.commands.execute.post', title: '명령 실행', summary: '이 노드에서 명령을 실행', category: 'daemon · commands', execution: ex('dangerous') },
    { operationId: 'terra.master.crossboundary.peer-grants.by-grant-id.revoke.post', title: '피어 허가 폐기 (시안)', category: 'master · crossboundary', execution: ex('dangerous', { tier: 'T3', impact: '이 허가로 오던 연결이 끊깁니다', inputs: ['grant_id'], secret_result: [] }) },
    { operationId: 'terra.master.nodes.by-node-id.modules.assignments.post', title: '모듈 배정 (시안)', category: 'master · nodes', execution: ex('privileged', { tier: 'T4', impact: '노드에 모듈이 배정됩니다', inputs: ['node_id', 'module_id'], secret_result: ['token'] }) },
  ] };
}
function sampleSchema(id) {
  if (id === 'terra.daemon.config.patch') return { type: 'object', required: ['key', 'value'], properties: { key: { type: 'string', description: '설정 키' }, value: { type: 'string' }, dry_run: { type: 'boolean' } } };
  if (id === 'terra.daemon.commands.execute.post') return { type: 'object', required: ['command'], properties: { command: { type: 'string', description: '실행할 명령' }, args: { type: 'array', items: { type: 'string' } }, timeout_s: { type: 'integer' } } };
  if (id.endsWith('revoke.post')) return { type: 'object', required: ['grant_id'], properties: { grant_id: { type: 'string' } } };
  if (id.endsWith('assignments.post')) return { type: 'object', required: ['node_id', 'module_id'], properties: { node_id: { type: 'string' }, module_id: { type: 'string' }, channel: { type: 'string', enum: ['stable', 'beta'] }, pin: { type: 'integer' } } };
  return { type: 'object', properties: {} };
}
