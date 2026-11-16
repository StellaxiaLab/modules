// op 콘솔 — Gateway 카탈로그의 모든 operation 을 한 화면에서 (ADR-GW-014 P17-1). 전역 틀 설정 › op 콘솔 (창 종류 'opconsole')
//   카탈로그 → 목록 · 검색 · 분류 → 입력 스키마 폼 → 등급별 호출 : T0 · T1 곧장 · T2 이 화면의 두 번 누르기 · T3 · T4 호스트 승인 문(window.TerraApprove)
//   앱 토큰에 닫힌 op 는 잠금 칩 + 이유(window.TerraGate) · secret_result 칸은 승인 화면에만(콘솔에는 숨김 줄)
//   실제(웹 빌드) : window.TerraCatalog · TerraTransport · TerraApprove · TerraGate · TerraCanApprove(src/boot/main.js) · 시안(캔버스) : 아래 sample()

// ── src/api/op-console.js 와 같은 사본 (tests/opconsole-board.test.mjs 가 맞춰 본다) ──
const TIERS = [['T0', '읽기'], ['T1', '쓰기'], ['T2', '앱 확인'], ['T3', '승인 문'], ['T4', '승인+재인증']];
const TIER_NAME = Object.fromEntries(TIERS);

/** 카탈로그 항목 하나의 등급 */
function tierOf(op) {
  const ex = (op && op.execution) || {}, ap = ex.approval;
  if (ap && (ap.tier === 'T3' || ap.tier === 'T4')) return ap.tier;
  const risk = ex.risk || '', conf = ex.confirmationMode || '';
  if (risk === 'read') return 'T0';
  if (risk === 'dangerous' || risk === 'privileged' || conf === 'required' || conf === 'always') return 'T2';
  return risk ? 'T1' : (/\.(get|list)$/.test(op.operationId || '') ? 'T0' : 'T1');   // 계약이 위험도를 안 적었으면 이름으로 짐작(읽기 동사만) — 모르면 쓰기로 보수적으로
}

/** 카탈로그 응답 → 콘솔 목록 항목 */
function normalizeCatalog(raw) {
  const list = Array.isArray(raw) ? raw : (raw && (raw.operations || raw.items)) || [];
  return list.filter((o) => o && o.operationId).map((o) => {
    const ex = o.execution || {}, ap = ex.approval || null;
    return {
      id: o.operationId, title: o.title || '', summary: o.summary || '', category: o.category || categoryOf(o.operationId), tags: o.tags || [],
      tier: tierOf(o), risk: ex.risk || '', perms: o.permissions || [], out: (o.output && o.output.mode) || '',
      scopes: (o.availability && o.availability.scopes) || [], approval: ap ? { tier: ap.tier, impact: ap.impact || '', inputs: ap.inputs || [], sw: ap.switch || '', secret: ap.secret_result || [] } : null,
      stream: ((o.output && o.output.mode) || '') === 'stream',
    };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
}
/** 분류가 비었을 때 — terra.daemon.modules.get → 'daemon · modules' 처럼 id 앞 두 마디 */
function categoryOf(id) { const p = String(id).split('.'); return p.length > 2 ? p[1] + ' · ' + p[2] : p[1] || p[0] || '기타'; }

/** 분류 칩 — [[이름, 개수], …] 개수 많은 순 */
function categories(items) {
  const m = new Map(); for (const o of items) m.set(o.category, (m.get(o.category) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
/** 검색(공백으로 나눈 낱말이 모두 id · 제목 · 요약 · 태그 · 분류에 든다) · 분류 · 등급 */
function filterOps(items, f = {}) {
  const words = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((o) => {
    if (f.cat && o.category !== f.cat) return false;
    if (f.tier && o.tier !== f.tier) return false;
    if (!words.length) return true;
    const hay = (o.id + ' ' + o.title + ' ' + o.summary + ' ' + o.category + ' ' + o.tags.join(' ')).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ── 입력 스키마 → 폼 ──
const pickType = (s) => { const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type; return t || (s.enum ? 'string' : s.properties ? 'object' : s.items ? 'array' : 'string'); };
/**
 * JSON Schema(최상위 object) → 칸 목록. 평평한 입력이라 최상위 속성만 칸이 된다.
 * 칸 종류 kind : text · number · bool · enum · json(배열 · 객체 — JSON 으로 적는다)
 * 스키마가 object 가 아니거나 속성이 없으면 { fields: [], free: true } — 칸 없이 JSON 한 칸(자유 입력)
 */
function formFields(schema) {
  const s = schema && typeof schema === 'object' ? schema : null;
  if (!s || !s.properties || typeof s.properties !== 'object') return { fields: [], free: !s || pickType(s) === 'object' || !s.type };
  const req = new Set(Array.isArray(s.required) ? s.required : []);
  const fields = Object.entries(s.properties).map(([key, p]) => {
    const sc = p && typeof p === 'object' ? p : {}, t = pickType(sc);
    const kind = sc.enum ? 'enum' : t === 'boolean' ? 'bool' : t === 'integer' || t === 'number' ? 'number' : t === 'array' || t === 'object' ? 'json' : 'text';
    return { key, label: sc.title || key, desc: sc.description || '', kind, type: t, required: req.has(key), enum: sc.enum ? sc.enum.map(String) : [], def: sc.default, secret: sc.format === 'password' || sc.writeOnly === true, fmt: sc.format || '' };
  });
  return { fields, free: false };
}
/** 칸의 처음 값(문자열 — 입력 칸이 든다) */
function initialValues(fields) {
  const v = {}; for (const f of fields) v[f.key] = f.def === undefined ? (f.kind === 'bool' ? 'false' : '') : f.kind === 'json' ? JSON.stringify(f.def) : String(f.def);
  return v;
}
/**
 * 칸 값(문자열) → 입력 JSON. 빈 칸은 안 보낸다(필수면 오류). 오류는 { 칸: 문구 }
 * @returns {{ ok: boolean, input: Record<string, unknown>, errors: Record<string, string> }}
 */
function buildInput(fields, values) {
  const input = {}, errors = {};
  for (const f of fields) {
    const raw = values[f.key] == null ? '' : String(values[f.key]), blank = raw.trim() === '';
    if (f.kind === 'bool') { if (raw === 'true' || raw === 'false') input[f.key] = raw === 'true'; else if (f.required) errors[f.key] = '필수'; continue; }
    if (blank) { if (f.required) errors[f.key] = '필수'; continue; }
    if (f.kind === 'number') { const n = Number(raw); if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) errors[f.key] = f.type === 'integer' ? '정수만' : '숫자만'; else input[f.key] = n; continue; }
    if (f.kind === 'enum') { if (!f.enum.includes(raw)) errors[f.key] = '목록에 없는 값'; else input[f.key] = f.type === 'integer' || f.type === 'number' ? Number(raw) : raw; continue; }
    if (f.kind === 'json') { try { const v = JSON.parse(raw); if ((f.type === 'array') !== Array.isArray(v) || (f.type === 'object' && (v === null || typeof v !== 'object'))) errors[f.key] = f.type === 'array' ? '배열([…])로' : '객체({…})로'; else input[f.key] = v; } catch { errors[f.key] = 'JSON 이 아님'; } continue; }
    input[f.key] = raw;
  }
  return { ok: !Object.keys(errors).length, input, errors };
}
/** 자유 입력(스키마 없음) — 빈 칸이면 {} , 아니면 JSON 객체 */
function buildFree(text) {
  const t = String(text || '').trim(); if (!t) return { ok: true, input: {}, errors: {} };
  try { const v = JSON.parse(t); if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, input: v, errors: {} }; return { ok: false, input: {}, errors: { _free: '객체({…})로' } }; }
  catch { return { ok: false, input: {}, errors: { _free: 'JSON 이 아님' } }; }
}

// ── 잠금 ──
/**
 * 이 op 를 지금 부를 수 있나. 칩 : '' · 'app'(앱 토큰에 닫힘) · 'perm'(계정 권한) · 'local'(이 노드에서만) · 'door'(승인 문 없음) · 'dead'(없음)
 * @param {{ tier: string, id: string }} item
 * @param {{ gate?: (op: string, o?: object) => { open: boolean, needs?: string, why?: string }, canApprove?: boolean, remote?: boolean }} ctx  gate = window.TerraGate (없으면 시안 — 막지 않음)
 * @returns {{ locked: boolean, chip: string, why: string }}
 */
function lockOf(item, ctx = {}) {
  if (item.tier === 'T3' || item.tier === 'T4') {
    if (!ctx.canApprove) return { locked: true, chip: 'door', why: '승인 문 없음 — Terra 셸 안에서 열어야 부를 수 있음 · 터미널 : ' + cliLine(item.id) };
    return { locked: false, chip: '', why: '' };
  }
  if (!ctx.gate) return { locked: false, chip: '', why: '' };
  const g = ctx.gate(item.id, { remote: !!ctx.remote });
  if (g.open) return { locked: false, chip: '', why: '' };
  const chip = g.needs === 'user-perm' ? 'perm' : g.needs === 'local' ? 'local' : 'app';
  return { locked: true, chip, why: String(g.why || '잠김').replace(/^잠김 : /, '') + ' · 터미널 : ' + cliLine(item.id) };
}
const CHIP_TEXT = { app: '앱 토큰에 닫힘', perm: '계정 권한 없음', local: '이 노드에서만', door: '승인 문 없음', dead: '없음' };

/** CLI 로 같은 일을 하는 줄 */
function cliLine(id, input) { return 'terra module call ' + id + (input && Object.keys(input).length ? " --input '" + JSON.stringify(input) + "'" : ''); }

/** 단추 글자 — 등급마다 다르다 */
function buttonText(tier, arm) {
  if (tier === 'T0') return '읽기';
  if (tier === 'T1') return '실행';
  if (tier === 'T2') return arm ? '한 번 더 눌러 실행' : '실행 …';
  return tier === 'T4' ? '승인 문으로 · 재인증' : '승인 문으로';
}

/**
 * 호출 한 번. 던지지 않고 { ok, … } 로 돌려준다.
 * @param {{ item: object, input: object, node?: string }} q  node = 대상 노드 id(rid · 빈 값 = 이 노드)
 * @param {{ invoke: (rid: string, op: string, input: object) => Promise<any>, invokeLocal: (op: string, input: object) => Promise<any>, approve?: (op: string, input: object) => Promise<any>, textOf?: (op: string, e: any, ctx?: object) => string }} d
 * @returns {Promise<{ ok: boolean, data?: any, text?: string, code?: string, withheld?: string[], via: 'door'|'app', sec?: boolean }>}
 */
async function runOp(q, d) {
  const { item, input } = q, door = item.tier === 'T3' || item.tier === 'T4';
  if (door) {
    if (!d.approve) return { ok: false, via: 'door', code: 'APPROVAL_UNAVAILABLE', text: '승인 문 없음 — Terra 셸 안에서 열기' };
    const r = await d.approve(item.id, input);
    if (r && r.ok) return { ok: true, via: 'door', data: r.data, withheld: r.withheld || [] };
    return { ok: false, via: 'door', code: (r && r.code) || 'APPROVAL_FAILED', text: (r && r.text) || '', silent: !r || !r.text };   // 빈 문구 = 사람이 거절함 — 조용히
  }
  try {
    const data = q.node ? await d.invoke(q.node, item.id, input) : await d.invokeLocal(item.id, input);
    return { ok: true, via: 'app', data, withheld: [] };
  } catch (e) {
    const code = (e && e.code) || 'ERROR';
    return { ok: false, via: 'app', code, text: d.textOf ? d.textOf(item.id, e, q.node ? { node: q.node } : {}) : String((e && e.message) || code) };
  }
}

/** 결과를 보일 글자 — 최대 n 글자 */
function resultText(data, n = 6000) {
  let s; try { s = typeof data === 'string' ? data : JSON.stringify(data === undefined ? null : data, null, 2); } catch { s = String(data); }
  return s.length > n ? s.slice(0, n) + '\n… (' + (s.length - n) + '자 더 — CLI 로 전체)' : s;
}
const tierName = (t) => TIER_NAME[t] || t;
// ── 사본 끝 ──

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
