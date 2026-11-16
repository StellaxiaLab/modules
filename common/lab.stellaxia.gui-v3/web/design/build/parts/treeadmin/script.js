// Tree 관리 — 쓰기 창 (ADR-GW-014 P14-4). 전역 틀 설정 › Tree 관리 (창 종류 'treeadmin', 자리 26)
//   탭 다섯 : 모듈 게시 · 승격 심사 · 정책 · 코어 롤아웃 · Master 설정. 왼쪽은 목록(위임 읽기), 오른쪽은 단추 → 입력 칸 → 실행.
//   쓰기는 모두 호스트 승인 문(window.TerraTreeAdmin.act → TerraApprove, T3 · T4)으로만 나가고, 이 화면은 제안만 한다. 코어 쓰기는 끝난 뒤 "N대에 적용"(affected_nodes).
//   Master 설정은 스키마(config.schema.get)로 칸을 만들고, 저장 전에 validate(읽기)를 통과해야 patch(T4)를 제안한다.
//   Master 는 Tree 노드에만 있다 — 다른 노드면 창이 이유만 보인다.
//   실제(웹 빌드) : window.TerraTreeAdmin(src/boot/main.js · src/api/tree-admin.js) · 시안(캔버스) : 아래 sampleKit() 몇 줄

function sampleKit() {
  const f = (k, label, o = {}) => Object.assign({ k, label, kind: 'text' }, o);
  return { TABS: [['mod', '모듈 게시'], ['promo', '승격 심사'], ['policy', '정책'], ['core', '코어 롤아웃'], ['config', 'Master 설정']],
    ACTIONS: { mod: [{ key: 'publish', label: '게시', fields: [f('digest', '패키지 digest(64자)', { req: true })], hint: '시안' }], promo: [{ key: 'approvePromo', label: '승인', fields: [f('promotion_id', '심사 id', { req: true, from: 'id' })], hint: '시안' }],
      policy: [{ key: 'ceiling', label: '승인 상한', fields: [f('permissions', '권한(쉼표)', { req: true })], hint: '시안' }], core: [{ key: 'coreRollout', label: '롤아웃', fields: [f('release_id', '릴리스 id', { req: true, from: 'id' })], hint: '시안' }], config: [] },
    WRITES: { publish: ['', 'T3'], approvePromo: ['', 'T3'], ceiling: ['', 'T4'], coreRollout: ['', 'T4'], configPatch: ['', 'T4'] },
    buildInput: () => ({ input: {}, errors: {} }), configFields: () => [], configChanges: () => ({ changes: {}, errors: {} }), treeReason: () => '', impactOf: () => '' };
}
const SAMPLE = { mod: [{ id: 'pub-1', module: 'io.terra.file', version: '0.4.0', policy: 'recommended', stage: 50, state: 'published' }], promo: [{ id: 'pr-1', module: 'io.terra.agent', version: '0.2.0', from: 'leaf-a', state: 'pending', widens: true, digest: 'sha256:ab…' }],
  policy: { ceiling: ['process.execute'], mirror: [{ pattern: 'acme.*', reason: '' }] }, core: [{ id: 'rel-1', role: 'tree', version: '0.6.22', apply: true, stage: 10, state: 'published' }] };

class Component extends DCLogic {
  constructor(props) { super(props);
    this.state = { tab: 'mod', act: {}, vals: {}, data: {}, edits: {}, cv: null, errs: {}, running: false, res: null, touched: false }; }
  componentDidMount() { this._live = true; this.load(this.state.tab); }
  componentWillUnmount() { this._live = false; }
  TA() { return typeof window !== 'undefined' && window.TerraTreeAdmin && window.TerraTreeAdmin.kit ? window.TerraTreeAdmin : null; }
  kit() { const t = this.TA(); return t ? t.kit : (this._sk || (this._sk = sampleKit())); }
  set(p) { if (this._live !== false) this.setState(p); }
  reason() { return this.kit().treeReason(this.props.nodeKind || 'tree'); }
  // 읽기 — 탭마다. 못 봤음(err) · 잠김(locked) · 있음(ok) 을 가른다
  load(tab) {
    const t = this.TA(), put = (d) => this.set({ data: Object.assign({}, this.state.data, { [tab]: d }) });
    if (this.reason()) return;
    if (!t) { put({ st: 'ok', rows: tab === 'policy' ? SAMPLE.policy : SAMPLE[tab] || [], sample: true }); return; }
    put({ st: 'load' });
    const one = (p) => p.then((r) => (r.ok ? { st: 'ok', rows: r.rows, raw: r.raw } : r.locked ? { st: 'locked', msg: r.locked.why } : { st: 'err', msg: (r.err && (r.err.code || r.err.message)) || 'ERROR' }), (e) => ({ st: 'err', msg: (e && e.message) || 'ERROR' }));
    if (tab === 'mod') one(t.publications()).then(put);
    else if (tab === 'promo') one(t.promotions()).then(put);
    else if (tab === 'core') one(t.coreReleases()).then(put);
    else if (tab === 'policy') Promise.all([one(t.ceiling()), one(t.mirrorBlocks())]).then(([c, m]) => put(c.st !== 'ok' ? c : m.st !== 'ok' ? m : { st: 'ok', rows: { ceiling: c.rows, mirror: m.rows } }));
    else if (tab === 'config') Promise.all([one(t.configSchema()), one(t.config())]).then(([s, c]) => put(s.st !== 'ok' ? s : c.st !== 'ok' ? c : { st: 'ok', rows: t.kit.configFields(s.rows, c.raw), view: c.raw }));
  }
  actions() { return this.kit().ACTIONS[this.state.tab] || []; }
  curAct() { const L = this.actions(); return L.find((a) => a.key === this.state.act[this.state.tab]) || L[0] || null; }
  valsOf(a) { return (a && this.state.vals[a.key]) || {}; }
  setVal(a, k, v) { this.set({ vals: Object.assign({}, this.state.vals, { [a.key]: Object.assign({}, this.valsOf(a), { [k]: v }) }), errs: {}, res: null }); }
  pickTab(tab) { this.set({ tab, res: null, errs: {}, cv: null, edits: {}, touched: false }); if (!this.state.data[tab] || this.state.data[tab].st !== 'ok') this.load(tab); }
  // 줄을 누르면 지금 단추의 '줄에서 채우는' 칸이 그 줄의 값으로 채워진다
  pickRow(raw) {
    const a = this.curAct(); if (!a) return;
    const patch = {}; for (const f of a.fields) if (f.from && raw[f.from] != null && raw[f.from] !== '') patch[f.k] = String(raw[f.from]);
    if (Object.keys(patch).length) this.set({ vals: Object.assign({}, this.state.vals, { [a.key]: Object.assign({}, this.valsOf(a), patch) }), errs: {}, res: null });
  }
  finish(r, tab) {
    if (r.ok) { this.set({ running: false, res: { ok: true, head: r.tier + ' · 승인됨 · ' + r.line, body: '' }, vals: {}, edits: {}, cv: null }); this.load(tab); }
    else this.set({ running: false, res: r.silent ? null : { ok: false, head: r.text || r.code, body: r.hint || '' } });
  }
  run() {
    const t = this.TA(), a = this.curAct(); if (!t || !a || this.state.running) return;
    const B = this.kit().buildInput(a, this.valsOf(a)); this.set({ touched: true, errs: B.errors });
    if (Object.keys(B.errors).length) { this.set({ res: { ok: false, head: '입력 오류 — ' + Object.entries(B.errors).map(([k, v]) => k + ' ' + v).join(' · '), body: '' } }); return; }
    const tab = this.state.tab; this.set({ running: true, res: null });
    t.act(a.key, B.input).then((r) => this.finish(r, tab));
  }
  // 설정 — 저장 전 검증(읽기), 통과하면 patch(T4)를 제안
  cfgFields() { const d = this.state.data.config; return d && d.st === 'ok' ? d.rows : []; }
  cfgBuilt() { return this.kit().configChanges(this.cfgFields(), this.state.edits); }
  validate() {
    const t = this.TA(); if (!t) return Promise.resolve(null);
    const B = this.cfgBuilt(); if (Object.keys(B.errors).length || !Object.keys(B.changes).length) return Promise.resolve(null);
    this.set({ running: true, res: null });
    return t.configValidate(B.changes).then((r) => { const cv = r.ok ? r.rows : { valid: false, errors: [{ message: r.locked ? r.locked.why : (r.err && (r.err.message || r.err.code)) || 'ERROR' }] }; this.set({ running: false, cv }); return cv; });
  }
  save() {
    const t = this.TA(); if (!t || this.state.running) return;
    const B = this.cfgBuilt(); this.set({ touched: true, errs: B.errors });
    if (Object.keys(B.errors).length) { this.set({ res: { ok: false, head: '입력 오류 — ' + Object.entries(B.errors).map(([k, v]) => k + ' ' + v).join(' · '), body: '' } }); return; }
    if (!Object.keys(B.changes).length) { this.set({ res: { ok: false, head: '바뀐 칸이 없음', body: '' } }); return; }
    this.validate().then((cv) => {
      if (!cv || cv.valid === false) { this.set({ res: { ok: false, head: 'Master 가 이 값을 받지 않음', body: ((cv && cv.errors) || []).map((e) => (e.key ? e.key + ' — ' : '') + e.message).join('\n') } }); return; }
      this.set({ running: true, res: null }); t.act('configPatch', { changes: B.changes }).then((r) => this.finish(r, 'config'));
    });
  }
  renderVals() {
    const S = this.state, K = this.kit(), T = this.TA(), real = !!T, reason = this.reason(), tab = S.tab, d = S.data[tab];
    const canDoor = real ? T.canApprove() : true, A = this.curAct(), isCfg = tab === 'config';
    const rows = [], arrOf = (x) => (Array.isArray(x) ? x : []);
    const row = (title, sub, raw, o = {}) => rows.push({ isHead: false, isRow: true, hdCls: '', title, sub, on: o.on ? 'true' : 'false', cls: o.on ? 'on' : '', tip: sub, tagOn: !!o.tag, tag: o.tag || '', tagCls: o.tagCls || '', pick: () => this.pickRow(raw || {}) });
    const head = (title) => rows.push({ isHead: true, isRow: false, hdCls: 'ta-hd', title, sub: '', on: 'false', cls: '', tip: '', tagOn: false, tag: '', tagCls: '', pick: () => {} });
    const ok = d && d.st === 'ok';
    if (ok && tab === 'mod') arrOf(d.rows).forEach((p) => row((p.module || '—') + ' ' + p.version, [p.policy, p.stage != null ? p.stage + '%' : '', p.state, p.id].filter(Boolean).join(' · '), { id: p.id, digest: p.digest }));
    if (ok && tab === 'promo') arrOf(d.rows).forEach((p) => row((p.module || '—') + ' ' + p.version, [p.from, p.state, p.id].filter(Boolean).join(' · '), { id: p.id, digest: p.digest }, p.widens ? { tag: '권한↑', tagCls: '' } : {}));
    if (ok && tab === 'core') arrOf(d.rows).forEach((r) => row((r.role || '—') + ' ' + r.version, [r.apply ? '적용 지시' : '적용 안 함', r.stage != null ? r.stage + '%' : '', r.state, r.id].filter(Boolean).join(' · '), { id: r.id }));
    if (ok && tab === 'policy') { head('승인 상한 — ' + arrOf(d.rows.ceiling).length + '개'); arrOf(d.rows.ceiling).forEach((c) => row(c, '이 권한을 요구하는 승격은 거부', {})); head('미러 거부 — ' + arrOf(d.rows.mirror).length + '개'); arrOf(d.rows.mirror).forEach((m) => row(m.pattern, m.reason || '', { pattern: m.pattern })); }
    if (ok && isCfg) arrOf(d.rows).forEach((f) => row(f.key, f.secret ? '비밀 — 화면에 오지 않음' : f.value === '' ? '(비어 있음)' : f.value, {}, f.pending ? { tag: '재시작 대기' } : !f.editable ? { tag: f.secret ? '비밀' : '고칠 수 없음', tagCls: 'mut' } : f.restart ? { tag: '재시작 필요', tagCls: 'mut' } : {}));
    const loading = !d || d.st === 'load';
    const emptyT = reason ? '' : loading ? '받는 중…' : d.st === 'err' ? '못 봤음 : ' + d.msg + ' — 다시 열기' : d.st === 'locked' ? '🔒 ' + d.msg : !rows.length ? { mod: '게시된 모듈 없음', promo: '심사를 기다리는 승격 없음', core: '코어 릴리스 없음', policy: '', config: '설정 칸 없음' }[tab] : '';
    // 오른쪽 — 단추 · 칸 · 실행
    const vals = this.valsOf(A), B = A && !isCfg ? K.buildInput(A, vals) : { input: {}, errors: {} };
    const errs = isCfg ? (S.touched ? this.cfgBuilt().errors : {}) : (S.touched ? B.errors : {});
    let fields = [];
    if (isCfg) fields = this.cfgFields().filter((f) => f.editable).map((f) => ({ key: f.key, label: f.key, desc: f.owner || '', req: '', err: errs[f.key] || '', bad: errs[f.key] ? 'true' : 'false', isText: true, isEnum: false, ph: f.type, value: S.edits[f.key] != null ? S.edits[f.key] : f.value, opts: [], onInput: (e) => this.set({ edits: Object.assign({}, this.state.edits, { [f.key]: e.target.value }), cv: null, errs: {}, res: null }) }));
    else if (A) fields = A.fields.map((f) => { const v = vals[f.k] == null ? '' : vals[f.k], isEnum = f.kind === 'enum' || f.kind === 'bool', optList = f.kind === 'bool' ? ['true', 'false'] : (f.opts || []);
      return { key: f.k, label: f.label, desc: f.hint || '', req: f.req || f.reqIf ? '*' : '', err: errs[f.k] || '', bad: errs[f.k] ? 'true' : 'false', isText: !isEnum, isEnum, ph: f.hint || f.label, value: v,
        opts: [{ v: '', t: f.req ? '— 고르기 —' : '— 안 보냄 —', sel: v === '' }].concat(optList.map((o) => ({ v: String(o), t: String(o), sel: v === String(o) }))), onInput: (e) => this.setVal(A, f.k, e.target.value) }; });
    const wkey = isCfg ? 'configPatch' : A ? A.key : '', G = real && wkey ? T.writeGate(wkey) : { open: true, needs: '', why: '' }, tier = wkey && K.WRITES[wkey] ? K.WRITES[wkey][1] : '';
    const off = !real || !!reason || !G.open || !canDoor || S.running || (isCfg && !Object.keys(this.cfgBuilt().changes).length);
    const bar = isCfg
      ? [{ name: 'Master 에 검증', cls: '', off: !real || !!reason || S.running || !Object.keys(this.cfgBuilt().changes).length ? 'disabled' : null, tip: '읽기 — 승인 없이 Master 가 값을 받는지만 봅니다', run: () => this.validate() },
         { name: S.running ? '승인 기다리는 중…' : '저장', cls: 'ta-b-T4', off: off ? 'disabled' : null, tip: !G.open ? G.why : '검증을 통과하면 호스트의 승인 화면에서 사람이 승인해야 저장됩니다', run: () => this.save() }]
      : [{ name: S.running ? '승인 기다리는 중…' : (A ? A.label : '—'), cls: 'ta-b-' + (tier || 'T3'), off: off || !A ? 'disabled' : null, tip: !G.open ? G.why : '호스트의 승인 화면에서 사람이 승인해야 나갑니다', run: () => this.run() }];
    const cv = S.cv, cvLines = cv ? (cv.valid === false ? ['Master 가 받지 않음'].concat(arrOf(cv.errors).map((e) => (e.key ? e.key + ' — ' : '') + e.message)) : ['검증 통과' + (arrOf(cv.restart_required).length ? ' · 재시작 필요 : ' + arrOf(cv.restart_required).join(' · ') : ' · 다시 시작 없이 반영')]) : null;
    const res = S.res || (cvLines ? { ok: cv.valid !== false, head: cvLines[0], body: cvLines.slice(1).join('\n') } : null);
    const roRows = isCfg ? this.cfgFields().filter((f) => !f.editable).map((f) => ({ key: f.key, value: f.secret ? '(숨김)' : f.value || '—', tag: f.secret ? '비밀' : f.owner || '고칠 수 없음' })) : [];
    const impact = wkey ? K.impactOf(wkey) : '';
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.props.nodeName || '—',
      kindT: { tree: 'Tree', leaf: 'Leaf', root: '계정' }[this.props.nodeKind || 'tree'] || String(this.props.nodeKind || ''),
      srcT: real ? '출처 : Master 위임 읽기 · 쓰기 : 호스트 승인 문(T3 · T4) — 이 화면은 제안만 합니다' : '시안 값 · 실제 Terra 에서는 Master 의 목록과 승인 문',
      blockedOn: !!reason, blockedT: reason, noDoorOn: real && !reason && !canDoor, openOn: !reason,
      tabs: K.TABS.map(([k, n]) => ({ name: n, on: tab === k ? 'true' : 'false', cls: tab === k ? 'on' : '', pick: () => this.pickTab(k) })),
      listLabel: (K.TABS.find((x) => x[0] === tab) || [0, ''])[1] + ' 목록', rows, empty: !!emptyT && (!rows.length || d.st !== 'ok'), emptyT,
      actOn: !isCfg && !!A, acts: this.actions().map((a) => ({ name: a.label, on: A && A.key === a.key ? 'true' : 'false', cls: A && A.key === a.key ? 'on' : '', tip: a.hint || '', pick: () => this.set({ act: Object.assign({}, this.state.act, { [tab]: a.key }), errs: {}, res: null, touched: false }) })),
      hintOn: !!(isCfg || (A && A.hint)), hint: isCfg ? '바뀐 칸만 보냅니다 — 저장 전에 Master 가 값을 받는지 검증합니다. 자격 증명 · 설치기 소유 키는 고칠 수 없습니다' : A ? A.hint : '',
      tierOn: !!tier, tier: tier || 'T3', tierName: tier === 'T4' ? '승인 + 재인증' : '승인 문',
      impactOn: !!impact, impact, lockOn: real && !G.open, chipT: G.needs === 'user-perm' ? '계정 권한 없음' : G.needs === 'core' ? '위임 없음' : '잠김', why: G.why || '',
      roOn: !!roRows.length, roRows, fields, bar, runSub: real ? (canDoor ? '승인 문 — 이 페이지가 아니라 호스트가 부름' : '승인 문 없음') : '시안 — 실제 Terra 에서 실행',
      resOn: !!res, resCls: res ? (res.ok ? 'ta-ok' : 'bad') : '', resHead: res ? res.head : '', resBodyOn: !!(res && res.body), resBody: res ? res.body : '',
    };
  }
}
