// 자원화 창 — 유형을 고르고 값을 넣어 자원을 만들고(선언), 다른 노드에 허가하고, 원천을 대상에 끌어다 놓아 잇는다. 연결 상태는 끊김 · 사유를 가른다
//   틀의 약속: 새 자원화 유형이 내놓을 것은 어댑터 하나와 그 설정 스키마뿐 — 양식 · 수명 · 허가 · 연결 화면은 이 창이 공통으로(docs/design/svi-make.md)
//   실제(웹 빌드): window.TerraSviMake — src/api/svi-make.js(선언 = Daemon svi.declarations · 허가 = Master svi.grants · 연결 = Master svi.bindings). 10초마다 다시 읽는다
//   시안(캔버스): 같은 모양의 예시 값. 모듈 유형(카메라 · 프로그램 창)은 '시안 · 코어 대기' — Terra 에 모듈이 유형 + 스키마를 내놓는 길이 아직 없다
//   아래 BUILTIN · fieldsOf · check · linkable · bstate 는 src/api/svi-make.js 의 사본(시안용) — tests/nodesvi.test.mjs 가 같은지 본다
const ABS = '^(/|[A-Za-z]:[\\\\/])';
/** 경로의 위 폴더 — 폴더 허용 창에 미리 채울 값. 위가 드라이브 뿌리 · / 이거나 절대 경로가 아니면 '' */
function dirOf(p) {
  const q = String(p || '').trim().replace(/[\\/]+$/, ''), k = Math.max(q.lastIndexOf('/'), q.lastIndexOf('\\')); if (k < 0) return '';
  const d = q.slice(0, k); return !d || /^[A-Za-z]:$/.test(d) || !new RegExp(ABS).test(d) ? '' : d;
}
/** 선언 오류 → 한국어 안내. 코드는 뒤에 붙인다 */
function declareError(e) {
  const code = (e && e.code) || '', m = e && e.message ? ' ' + e.message : '';
  if (code === 'SVI_DECLARATION_OUTSIDE_ENVELOPE') return '허용된 폴더 밖이거나 이 종류가 닫혀 있습니다 — 왼쪽 "이 노드의 울타리"를 확인하세요. (' + code + ')';
  if (code === 'FORBIDDEN' || e && e.status === 403) return '권한이 없습니다. (' + code + ')';
  return code + m;
}
const BUILTIN = [
  { id: 'file', family: 'file', title: '파일', desc: '파일 하나를 자원으로 — 읽기(처음부터 끝까지 한 번 흘림) 또는 쓰기', schema: { required: ['path'], properties: {
    path: { type: 'string', title: '경로', description: '절대 경로 — 울타리(file_roots) 안', pattern: ABS, format: 'path' },
    direction: { type: 'string', title: '방향', enum: ['source', 'sink'], 'x-labels': ['읽기 — 내보냄', '쓰기 — 받음'], default: 'source' } } } },
  { id: 'process', family: 'process', title: '프로그램', desc: '프로그램 실행 — 표준 입출력을 자원으로', schema: { required: ['command'], properties: {
    command: { type: 'string', title: '실행 파일', description: '절대 경로 — 울타리(process · process_commands) 허용분', pattern: ABS, format: 'path' },
    args: { type: 'array', items: { type: 'string' }, title: '인자', description: '빈칸으로 나눔' },
    direction: { type: 'string', title: '방향', enum: ['source', 'sink'], 'x-labels': ['출력 내보냄', '입력 받음'], default: 'source' } } } },
  { id: 'net', family: 'net', title: '네트워크 주소', desc: 'TCP · UDP 주소 — 연결 또는 수신 · 바이트 송수신', schema: { required: ['address'], properties: {
    address: { type: 'string', title: '주소', description: 'tcp://호스트:포트 또는 udp://호스트:포트 — 울타리(net_endpoints) 안', pattern: '^(tcp|udp)://[^\\s/]+:\\d{1,5}$' },
    mode: { type: 'string', title: '방식', enum: ['connect', 'listen'], 'x-labels': ['연결 — 그 주소로 접속', '수신 — 그 주소에서 대기'], default: 'connect' },
    framing: { type: 'string', title: '나눔', enum: ['chunk', 'line'], 'x-labels': ['조각', '줄'], default: 'chunk' },
    direction: { type: 'string', title: '방향', enum: ['source', 'sink'], 'x-labels': ['받은 것 내보냄', '들어온 것 보냄'], default: 'source' } } } },
];
// 시안 — 모듈이 내놓을 유형의 예(모듈 매니페스트 contributions.svi.types 제안 꼴). 실제 모드에서는 모듈 목록에 이 자리가 있을 때만
const SAMPLE_MOD_TYPES = [
  { id: 'io.lab.camera/rtsp', module: 'io.lab.camera', moduleName: '카메라', title: '카메라(RTSP)', desc: 'RTSP 카메라 영상을 자원으로', schema: { required: ['url'], properties: {
    url: { type: 'string', title: 'RTSP 주소', description: 'rtsp://사용자:비밀번호@호스트:554/경로', pattern: '^rtsp://' },
    resolution: { type: 'string', title: '해상도', enum: ['1280x720', '1920x1080', 'source'], 'x-labels': ['720p', '1080p', '원본'], default: 'source' },
    fps: { type: 'integer', title: '초당 장면', description: '비우면 원본' }, audio: { type: 'boolean', title: '소리', default: false } } } },
  { id: 'io.lab.window/capture', module: 'io.lab.window', moduleName: '프로그램 창', title: '프로그램 창', desc: '실행 중인 프로그램 창의 화면을 자원으로', schema: { required: ['exe'], properties: {
    exe: { type: 'string', title: '실행 파일', description: '절대 경로', pattern: ABS, format: 'path' }, title: { type: 'string', title: '창 이름', description: '비우면 첫 창' } } } },
];
const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
function fieldsOf(schema, values) {
  const P = (schema && schema.properties) || {}, req = new Set((schema && schema.required) || []);
  return Object.keys(P).map((key) => { const p = P[key], v = key in values ? values[key] : p.default;
    const kind = p.enum ? 'enum' : p.type === 'boolean' ? 'bool' : p.type === 'integer' || p.type === 'number' ? 'number' : p.type === 'array' ? 'list' : p.format === 'path' ? 'path' : 'text';
    return { key, title: p.title || key, desc: p.description || '', kind, required: req.has(key), value: kind === 'list' ? (Array.isArray(v) ? v.join(' ') : v || '') : v ?? '', options: p.enum ? p.enum.map((e, i) => ({ v: e, label: (p['x-labels'] && p['x-labels'][i]) || String(e) })) : undefined }; });
}
function castOf(schema, raw) {
  const P = (schema && schema.properties) || {}, out = {};
  for (const k of Object.keys(P)) { const p = P[k]; let v = k in raw ? raw[k] : p.default; if (v === '' || v == null) continue;
    if (p.type === 'array') v = Array.isArray(v) ? v : String(v).split(/\s+/).filter(Boolean); else if (p.type === 'integer' || p.type === 'number') v = Number(v); else if (p.type === 'boolean') v = v === true || v === 'true'; out[k] = v; }
  return out;
}
function check(schema, name, raw) {
  const e = {}, P = (schema && schema.properties) || {}, v = castOf(schema, raw);
  if (!name) e.name = '이름 필요'; else if (!NAME_RE.test(name)) e.name = '소문자 · 숫자 · - 만(앞뒤는 - 아님)';
  for (const k of (schema && schema.required) || []) if (v[k] == null || (Array.isArray(v[k]) && !v[k].length)) e[k] = '필요';
  for (const [k, p] of Object.entries(P)) { if (e[k] || v[k] == null) continue;
    if (p.pattern && typeof v[k] === 'string' && !new RegExp(p.pattern).test(v[k])) e[k] = p.format === 'path' ? '절대 경로 필요' : '형식 불일치';
    if (p.enum && !p.enum.includes(v[k])) e[k] = '선택지 밖 값'; if ((p.type === 'integer' || p.type === 'number') && Number.isNaN(v[k])) e[k] = '숫자 필요'; }
  return e;
}
const PAIRS = { stream: ['stream', 'blob'], snapshot: ['command'], blob: ['blob'], collection: ['collection'], command: ['command'], duplex: ['duplex', 'stream'] };
function linkable(src, dst) {
  if (!src || !dst) return { ok: false, why: '' }; if (src.resId === dst.resId) return { ok: false, why: '같은 자원' };
  if (!['source', 'duplex'].includes(src.dir)) return { ok: false, why: '원천 : 내보냄 없음' }; if (!['sink', 'duplex'].includes(dst.dir)) return { ok: false, why: '대상 : 받음 없음' };
  if (src.interaction && dst.interaction && !(PAIRS[src.interaction] || []).includes(dst.interaction)) return { ok: false, why: src.interaction + ' → ' + dst.interaction + ' 연결 불가' };
  const nm = (s) => String(s || '').replace(/@\d+$/, ''), mj = (s) => (/@(\d+)$/.exec(String(s || '')) || [])[1];
  if (src.schema && dst.schema && nm(src.schema) !== nm(dst.schema)) return { ok: false, why: '형식 불일치 — ' + src.schema + ' → ' + dst.schema };
  if (src.schema && dst.schema && mj(src.schema) !== mj(dst.schema)) return { ok: true, why: '판 다름 — 변환 필요 가능' };
  return { ok: true, why: '' };
}
const ST = { active: ['연결됨', 'ok'], degraded: ['끊김', 'warn'], failed: ['실패', 'err'], closing: ['닫는 중', 'dim'], closed: ['닫힘', 'dim'], requested: ['연결 중', 'busy'], validating: ['연결 중', 'busy'], planning: ['연결 중', 'busy'], preparing: ['연결 중', 'busy'] };
const DST = { applied: ['적용됨', 'ok'], shadowed: ['가려짐', 'warn'], refused_by_policy: ['울타리 거절', 'err'] };
const FAM = { file: '파일', process: '프로그램', net: '네트워크' };
// ── 울타리 확장(ADR-GW-011 E3) — src/api/svi-envelope.js 의 사본(시안용) · tests/nodesvi.test.mjs 가 같은지 본다 ──
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
const winLike = (p) => /^[A-Za-z]:/.test(p);
/** p 가 root 와 같거나 그 안인가(Windows 경로는 대소문자 무시) */
function under(p, root) {
  let a = norm(p), b = norm(root); if (!a || !b) return false;
  if (winLike(a) || winLike(b)) { a = a.toLowerCase(); b = b.toLowerCase(); }
  return a === b || a.startsWith(b + '/');
}

/** envelope → 줄. file_root_sources 가 없으면(옛 Terra) 전부 설정 파일 것으로 보고 해제를 닫는다 @returns {{ path: string, mode: string, origin: 'config'|'runtime', removable: boolean }[]} */
function rootRows(env) {
  if (!env) return [];
  const A = (x) => (Array.isArray(x) ? x : []), src = new Map(A(env.file_root_sources).filter((s) => s && s.path).map((s) => [norm(s.path), s.origin]));
  return A(env.file_roots).map((r) => { const path = r.path || r, origin = src.get(norm(path)) === 'runtime' ? 'runtime' : 'config'; return { path, mode: r.mode || '', origin, removable: origin === 'runtime' }; });
}

/** 이 root 를 해제하면 울타리 밖이 되어 멈추는 파일 자원(남는 다른 root 가 품는 것은 제외) @returns {object[]} */
function affectedBy(decls, rootPath, roots) {
  const rest = (roots || []).map((r) => r.path || r).filter((p) => norm(p) !== norm(rootPath));
  return (decls || []).filter((d) => d.family === 'file' && d.state === 'applied' && d.detail && under(d.detail, rootPath) && !rest.some((p) => under(d.detail, p)));
}

/** 홈 폴더(또는 그 위)를 고르면 강한 경고 — 모르면 '' */
function sensitiveWhy(path) {
  const p = norm(path);
  if (/^[A-Za-z]:\/Users\/[^/]+$/i.test(p) || /^\/home\/[^/]+$/.test(p) || /^\/Users\/[^/]+$/.test(p) || p === '/root' || /^[A-Za-z]:\/Users$/i.test(p) || p === '/home' || p === '/Users')
    return '홈 폴더입니다. .ssh 키, 브라우저 프로필(저장된 로그인), 문서 같은 민감한 파일이 들어 있습니다. 가능하면 자원으로 쓸 하위 폴더만 고르세요.';
  return '';
}

const ROOT_WHY = {
  not_absolute: '절대 경로여야 합니다. (예: C:\\공유 또는 /srv/share)',
  not_found: '이 노드에 그런 폴더가 없습니다. 경로를 확인하세요.',
  not_directory: '폴더가 아니라 파일입니다. 폴더를 고르세요.',
  filesystem_root: '드라이브나 / 전체는 허용할 수 없습니다. 더 좁은 폴더를 고르세요.',
  protected: 'Terra 의 데이터·설정 폴더(또는 그 안)는 허용할 수 없습니다.',
};
/** 오류 → 한국어 한 문장. 코드·reason 별 */
function envelopeError(e) {
  const code = e && e.code, st = e && e.status, d = (e && (e.details || e.detail)) || {};
  if (code === 'SVI_ENVELOPE_ROOT_REFUSED') return ROOT_WHY[d.reason] || '이 폴더는 허용할 수 없습니다' + (d.reason ? ' (' + d.reason + ')' : '') + '.';
  if (code === 'SVI_ENVELOPE_ROOT_FROM_CONFIG') return '노드 설정 파일에서 온 폴더라 GUI 에서 해제할 수 없습니다. 설정 파일에서 지우고 재시작하세요.';
  if (code === 'SVI_ENVELOPE_ROOT_NOT_FOUND') return '이미 울타리에 없는 폴더입니다.';
  if (st === 429 || code === 'RATE_LIMITED' || code === 'HTTP_429') return '짧은 시간에 너무 자주 바꿨습니다(분당 5회). 잠시 뒤 다시 하세요.';
  if (code === 'FORBIDDEN' || st === 403) return '권한이 없습니다. 울타리를 바꾸려면 node.control 권한이 필요합니다.';
  if (code === 'LOCAL_ONLY' || code === 'OPERATION_NOT_REMOTE') return '이 노드에서만 바꿀 수 있습니다.';
  return (code || '오류') + (e && e.message ? ' — ' + e.message : '');
}

/** 로컬 폴더 탐색(local-fs, 읽기 전용) 결과 → 폴더만. 뿌리 + 상대 경로 → 절대 경로 */
function joinRoot(rootPath, rel) {
  const base = String(rootPath || ''), sep = base.includes('\\') && !base.includes('/') ? '\\' : '/', r = String(rel || '').replace(/^\/+|\/+$/g, '');
  return r ? base.replace(/[\\/]+$/, '') + sep + r.split('/').join(sep) : base;
}
const TTLS = [['1d', 86400], ['7d', 604800], ['30d', 2592000], ['90d', 7776000]];
// 허가 주체(노드 · 사람) — Master 위임 가드 규칙. 아래는 src/api/svi-grant.js 의 사본(시안용) — tests/svi-grant-boards.test.mjs 가 같은지 본다
const GRANT_OPS = ['inspect', 'read', 'subscribe', 'bind.source', 'bind.target', 'write', 'invoke'];
const GUARD_OPS = { user: ['inspect', 'read', 'subscribe', 'bind.source', 'bind.target'], node: ['read', 'subscribe', 'bind.source'] };
const GRANT_DEFAULTS = { user: ['inspect', 'read', 'subscribe'], node: ['read', 'subscribe', 'bind.source'] };
const GUARD_MAX_TTL = 90 * 86400;
const GRANT_TTLS = [['1h', 3600], ['1d', 86400], ['7d', 604800], ['30d', 2592000], ['90d', 7776000]];
const OP_KO = { discover: '찾기', inspect: '살펴보기', read: '읽기', list: '목록', watch: '지켜보기', subscribe: '구독', 'bind.source': '연결 원천', 'bind.target': '연결 대상', write: '쓰기', invoke: '호출' };
const KIND_KO = { user: '사람', node: '노드' };
function selfIdOf(who) {
  const p = String((who && who.principal) || '').split(/\s+via\s+/)[0].replace(/^user:/, '').trim();
  return p && p !== 'anonymous' ? p : '';
}
function subjectRule(type, id, selfId) {
  const allow = GUARD_OPS[type] || [];
  let why = '';
  if (!allow.length) why = '위임 가드 — 나 자신 · 같은 클러스터 노드만';
  else if (type === 'user' && !selfId) why = '로그인 사용자 모름';
  else if (type === 'user' && id !== selfId) why = '위임 가드 — 사람은 나 자신만 (ADR-GW-004 D-3)';
  return { ok: !why, why,
    ops: GRANT_OPS.map((op) => { const ok = allow.includes(op); return { op, label: OP_KO[op] || op, ok, why: ok ? '' : '위임 가드 — ' + (KIND_KO[type] || type) + ' : ' + op + ' 불가' }; }),
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
  if (!allow) return no('위임 가드 — 나 자신 · 같은 클러스터 노드만');
  if (!g.subject_id) return no('받는 이 없음');
  if (type === 'user' && g.subject_id !== selfId) return no(selfId ? '위임 가드 — 사람은 나 자신만' : '로그인 사용자 모름');
  const ops = Array.isArray(g.operations) ? g.operations : [];
  if (!ops.length) return no('작업 1개 이상 선택');
  const bad = ops.find((o) => !allow.includes(o)); if (bad) return no('위임 가드 — ' + KIND_KO[type] + ' : ' + bad + ' 불가');
  if (!(g.ttl_seconds > 0)) return no('기한 필요 — 위임 허가 · 90d 이하');
  if (g.ttl_seconds > GUARD_MAX_TTL) return no('기한 : 90d 까지 (위임 허가)');
  return { ok: true, why: '' };
}
const opsText = (ops) => (ops && ops.length ? ops.map((o) => OP_KO[o] || o).join(' · ') : '—');

class Component extends DCLogic {
  constructor(props) {
    super(props);
    let pre = {}; try { pre = props.pre ? JSON.parse(props.pre) : {}; } catch (e) { pre = {}; }
    this.state = { tab: pre.tab || 'make', typeId: pre.type || 'file', vals: pre.values || {}, fname: pre.name || '', replace: false, data: null, msg: '', busy: false, pick: null, hot: '', ttl: 604800, t: 0, subj: 'node', envDlg: null, gops: { node: GRANT_DEFAULTS.node.slice(), user: GRANT_DEFAULTS.user.slice() } };
    this._drag = null;
  }
  componentDidMount() { this._live = true; this.pull(); this._iv = setInterval(() => { if (this._live && this.real()) this.pull(); }, 10000); }
  componentWillUnmount() { this._live = false; clearInterval(this._iv); }
  componentDidUpdate(prev) {
    if (prev && prev.pre !== this.props.pre && this.props.pre) { try { const p = JSON.parse(this.props.pre); this.setState({ tab: p.tab || 'make', typeId: p.type || this.state.typeId, vals: p.values || {}, fname: p.name || '' }); } catch (e) {} }
    if (prev && prev.nodeRid !== this.props.nodeRid) { this.setState({ data: null, msg: '', pick: null, envDlg: null }); this.pull(); }
  }
  real() { return typeof window !== 'undefined' && !!window.TerraSviMake; }
  pull() {
    if (!this.real()) { if (!this.state.data) this.setState({ data: this.sample() }); return; }
    const rid = this.props.nodeRid; if (!rid) return;
    window.TerraSviMake.load(rid).then((data) => this._live && this.props.nodeRid === rid && this.setState({ data }), (e) => this._live && this.props.nodeRid === rid && this.setState({ msg: '읽지 못함 · ' + ((e && e.code) || '') }));
  }
  say(m) { this.setState({ msg: m }); }
  /** 실제 부르기 — 시안이면 사본만 고친다 */
  act(label, run, fake) {
    if (!this.real()) { if (fake) this.setState({ data: fake(JSON.parse(JSON.stringify(this.state.data))) }); this.say('(시안) ' + label); return; }
    this.setState({ busy: true, msg: label + ' …' });
    run().then(() => { this.setState({ busy: false, msg: label + ' — 완료' }); this.pull(); },
      (e) => { this.setState({ busy: false, msg: label + ' — 실패 · ' + declareError(e) }); this.pull(); });
  }
  types() {
    const mods = this.real() ? (window.TerraSviTypes ? window.TerraSviTypes() : []) : SAMPLE_MOD_TYPES;
    return { builtin: BUILTIN, mods };
  }
  rid() { return this.props.nodeRid || ''; }
  /** 이 계정의 사용자 id — 실제는 whoami(TerraSviMake.selfNow), 시안은 admin */
  selfId() { return this.real() ? (window.TerraSviMake.selfNow ? window.TerraSviMake.selfNow() : '') : 'admin'; }
  nodeName(id) { const D = this.state.data; const n = D && D.nodes && D.nodes.find((x) => x.id === id); return n ? n.name : id ? String(id).slice(0, 10) : '—'; }

  /** 울타리를 바꿀 수 있는 노드인가 — 이 노드(로컬)만. 시안은 로컬로 본다 */
  envLocal() { return this.real() ? !!(window.TerraSviEnvelope && window.TerraSviEnvelope.isLocal(this.rid())) : true; }
  envOpen(mode, path) {
    this.setState({ envDlg: { mode, stage: 'pick', path: path || '', err: '', busy: false, br: { roots: [], root: null, rel: '', items: [], note: '' } } });
    if (mode === 'add' || mode === 'file') this.envRoots();
  }
  envClose() { this.setState({ envDlg: null }); }
  envPatch(p) { this.setState((s) => (s.envDlg ? { envDlg: Object.assign({}, s.envDlg, p) } : null)); }
  /** 폴더 고르기 — 이 노드의 local-fs 뿌리(읽기 전용) */
  envRoots() {
    const set = (roots, note) => this.setState((s) => (s.envDlg ? { envDlg: Object.assign({}, s.envDlg, { br: Object.assign({}, s.envDlg.br, { roots, note }) }) } : null));
    if (!this.real()) { set([{ root: 'home', label: '로컬 · home', path: '/home/demo' }, { root: 'srv', label: '로컬 · srv', path: '/srv' }], ''); return; }
    window.TerraSviEnvelope.fsRoots().then((d) => set(window.TerraDesk.fileRoots(d, 'lfs').filter((r) => !r.locked), ''), (e) => set([], '폴더 목록을 못 읽음 · ' + ((e && e.code) || '') + ' — 경로를 직접 입력하세요'));
  }
  envBrowse(root, rel) {
    const d = this.state.envDlg, R = d && d.br.roots.find((x) => x.root === root); if (!R) return;
    const done = (items, note) => this.setState((s) => (s.envDlg && s.envDlg.br.root === root && s.envDlg.br.rel === rel ? { envDlg: Object.assign({}, s.envDlg, { br: Object.assign({}, s.envDlg.br, { items, note }) }) } : null));
    this.envPatch({ path: R.path ? joinRoot(R.path, rel) : d.path, err: '', br: Object.assign({}, d.br, { root, rel, items: [], note: '불러오는 중…' }) });
    if (!this.real()) { done(['data', 'media', 'docs', '.ssh'].map((n) => ({ name: n, path: rel ? rel + '/' + n : n, dir: true })).concat(d.mode === 'file' ? [{ name: 'cam.log', path: rel ? rel + '/cam.log' : 'cam.log', dir: false }] : []), ''); return; }
    window.TerraSviEnvelope.fsEntries(root, rel).then((x) => done(window.TerraDesk.fileEntries(x, rel).filter((e) => (e.dir || d.mode === 'file') && !e.locked), ''), (e) => done([], '못 읽음 · ' + ((e && e.code) || '')));
  }
  /** 성공 뒤 화면 값 — 울타리 · 그 안에 있던 선언의 상태. 곧이어 다시 읽어 Terra 값으로 덮는다 */
  envApply(data, kind, path) {
    const x = JSON.parse(JSON.stringify(data || {})), E = x.envelope = x.envelope || {}, roots = rootRows(E).concat(), before = roots.map((r) => r.path);
    const rest = kind === 'add' ? before.concat(path) : before.filter((p) => norm(p) !== norm(path));
    const aff = kind === 'remove' ? affectedBy(x.decls, path, roots).map((d) => d.name) : [];
    const srcs = rootRows(E).filter((r) => kind === 'add' || norm(r.path) !== norm(path)).map((r) => ({ path: r.path, origin: r.origin })).concat(kind === 'add' ? [{ path, origin: 'runtime' }] : []);
    E.file_roots = rest.map((p) => ({ path: p, mode: ((E.file_roots || []).find((r) => (r.path || r) === p) || {}).mode || 'rw' })); E.file_root_sources = srcs;
    x.decls = (x.decls || []).map((d) => (kind === 'add' && d.family === 'file' && d.state === 'refused_by_policy' && under(d.detail, path) ? Object.assign({}, d, { state: 'applied', reason: '' })
      : aff.includes(d.name) ? Object.assign({}, d, { state: 'refused_by_policy', reason: 'SVI_DECLARATION_OUTSIDE_ENVELOPE — 울타리에서 뺀 폴더' }) : d));
    return x;
  }
  envRun(kind, path) {
    const d = this.state.envDlg; if (!d || d.busy) return; const label = kind === 'add' ? '폴더 허용' : '폴더 해제';
    const ok = () => { this.setState((s) => ({ data: this.envApply(s.data, kind, path), envDlg: null, msg: label + ' — 완료 · ' + path })); };
    if (!this.real()) { ok(); return; }
    this.envPatch({ busy: true, err: '' });
    const Env = window.TerraSviEnvelope, rid = this.rid();
    (kind === 'add' ? Env.add(rid, path) : Env.remove(rid, path)).then(() => { ok(); this.pull(); }, (e) => { this.envPatch({ busy: false, err: envelopeError(e) }); this.pull(); });
  }
  /** 울타리 — 출처별 root 목록 · 폴더 허용 · 해제 · 확인 창 (ADR-GW-011 §2.7) */
  envVals(o, D, decls) {
    const s = this.state, e = D && D.envelope, L = this.envLocal(), roots = rootRows(e), dlg = s.envDlg;
    o.roots = roots.map((r) => ({ path: r.path, origin: r.origin === 'runtime' ? 'GUI' : '설정 파일', oCls: r.origin === 'runtime' ? 'ok' : 'dim', canRemove: L && r.removable, why: r.removable ? '' : '설정 파일에서 온 폴더 — GUI 에서 해제할 수 없음', off: !!s.busy, remove: () => this.envOpen('remove', r.path) }));
    o.noRoots = !!e && !roots.length; o.envLocal = L; o.envRemote = !L; o.envRemoteT = '다른 노드의 울타리는 아직 그 노드에서만 바꿀 수 있습니다';
    o.allowOff = !e || (this.real() && !this.rid()); o.allow = () => this.envOpen('add', '');
    o.dlgOn = !!dlg; if (!dlg) return;
    const add = dlg.mode === 'add', fileMode = dlg.mode === 'file', br = dlg.br, path = dlg.path.trim(), sens = sensitiveWhy(path);
    o.dlgAdd = add; o.dlgRemove = !add && !fileMode; o.dlgFile = fileMode; o.dlgPickAdd = add && dlg.stage === 'pick'; o.dlgPick = (add || fileMode) && dlg.stage === 'pick';
    o.dlgPathLabel = fileMode ? '파일 경로' : '폴더 경로'; o.dlgSub = fileMode ? '이 노드의 파일 — 읽기 전용 탐색 · 고르기만 하고 아무것도 바꾸지 않음' : 'svi.runtime.file_roots · 재시작 없이 적용';
    o.dlgUse = () => { if (o.dlgNextOff) { this.envPatch({ err: '절대 경로여야 합니다. (예: C:\\공유\\a.txt 또는 /srv/share/a.txt)' }); return; } this.setState((s2) => ({ vals: Object.assign({}, s2.vals, { path }), envDlg: null, msg: '경로 고름 — ' + path })); }; o.dlgConfirm = add && dlg.stage === 'confirm'; o.dlgBusy = !!dlg.busy;
    o.dlgTitle = add ? '폴더 허용' : fileMode ? '파일 고르기' : '폴더 해제'; o.dlgPath = dlg.path; o.dlgErr = dlg.err; o.dlgClose = () => this.envClose();
    o.onDlgPath = (ev) => this.envPatch({ path: ev.target.value, err: '' });
    o.brRoots = br.roots.map((r) => ({ label: r.label, cls: br.root === r.root ? 'on' : '', pick: () => this.envBrowse(r.root, '') }));
    o.brNote = br.note; o.brHas = !!br.root; o.brUp = br.rel ? () => this.envBrowse(br.root, br.rel.split('/').slice(0, -1).join('/')) : null; o.brCanUp = !!br.rel;
    o.brItems = br.items.map((it) => ({ name: it.dir && fileMode ? it.name + '/' : it.name, pick: () => (it.dir ? this.envBrowse(br.root, it.path) : this.envPatch({ path: joinRoot((br.roots.find((x) => x.root === br.root) || {}).path, it.path), err: '' })) }));
    o.dlgNextOff = !path || !new RegExp(ABS).test(path);
    o.dlgNext = () => { if (o.dlgNextOff) { this.envPatch({ err: envelopeError({ code: 'SVI_ENVELOPE_ROOT_REFUSED', details: { reason: 'not_absolute' } }) }); return; } this.envPatch({ stage: 'confirm', err: '' }); };
    o.dlgBack = () => this.envPatch({ stage: 'pick', err: '' });
    o.dlgSens = sens; o.hasSens = !!sens; o.dlgGo = () => this.envRun('add', path);
    const aff = add ? [] : affectedBy(decls, path, roots);
    o.affected = aff.map((d) => ({ name: d.name, detail: d.detail })); o.hasAffected = aff.length > 0; o.noAffected = !add && !aff.length;
    o.dlgDel = () => this.envRun('remove', path);
  }

  /** 시안 — load() 와 같은 모양 */
  sample() {
    const me = this.props.nodeName || 'desk', mid = 'nd_' + me;
    const E = (resId, resName, node, epId, dir, interaction, schema) => ({ resId, resName, node, kind: '', epId, dir, interaction, schema, status: 'available', ops: [] });
    return { miss: [], envelope: { file_roots: [{ path: '/srv/share', mode: 'rw' }, { path: '/srv/drop', mode: 'rw' }], file_root_sources: [{ path: '/srv/share', origin: 'config' }, { path: '/srv/drop', origin: 'runtime' }], process: 'allowlist', process_commands: ['/usr/bin/ffmpeg'], net: true, net_endpoints: [{ address: 'tcp://127.0.0.1:8554' }], max_declarations: 32 },
      decls: [{ family: 'file', name: 'meter-log', dir: 'source', resId: 'r-log', origin: 'runtime', state: 'applied', reason: '', detail: '/srv/share/meter.log' },
        { family: 'process', name: 'encoder', dir: 'sink', resId: 'r-enc', origin: 'runtime', state: 'refused_by_policy', reason: 'SVI_DECLARATION_OUTSIDE_ENVELOPE — /usr/local/bin/enc : 허용 목록 밖', detail: '/usr/local/bin/enc' }],
      retired: [], nodes: [{ id: mid, name: me }, { id: 'nd_02', name: '02' }, { id: 'nd_nas', name: 'nas-01' }],
      eps: [E('r-log', 'meter-log', mid, 'out', 'source', 'stream', 'terra.bytes@1'), E('r-cam', 'cam-front', 'nd_02', 'video', 'source', 'stream', 'terra.video@1'), E('r-mic', 'mic', 'nd_02', 'out', 'source', 'stream', 'terra.bytes@1'),
        E('r-store', 'archive', 'nd_nas', 'in', 'sink', 'stream', 'terra.bytes@1'), E('r-rec', 'recorder', 'nd_nas', 'in', 'sink', 'stream', 'terra.video@1'), E('r-cmd', 'relay-switch', mid, 'cmd', 'sink', 'command', 'terra.bytes@1')],
      grants: [{ id: 'g1', type: 'node', subject: 'nd_02', resId: 'r-log', ops: ['read', 'subscribe'], expires: '' }, { id: 'g2', type: 'user', subject: 'admin', resId: 'r-log', ops: ['inspect', 'read', 'subscribe', 'bind.source'], expires: '' }],
      bindings: [{ id: 'b1', src: { resource_id: 'r-cam', endpoint_id: 'video' }, dst: { resource_id: 'r-rec', endpoint_id: 'in' }, srcNode: 'nd_02', dstNode: 'nd_nas', st: { label: '연결됨', cls: 'ok', reason: '' } },
        { id: 'b2', src: { resource_id: 'r-mic', endpoint_id: 'out' }, dst: { resource_id: 'r-store', endpoint_id: 'in' }, srcNode: 'nd_02', dstNode: 'nd_nas', st: { label: '끊김', cls: 'warn', reason: '한쪽 노드 연결 끊김' } },
        { id: 'b3', src: { resource_id: 'r-log', endpoint_id: 'out' }, dst: { resource_id: 'r-store', endpoint_id: 'in' }, srcNode: mid, dstNode: 'nd_nas', st: { label: '닫힘', cls: 'dim', reason: '원천 끝남(파일 끝 등)' } }] };
  }

  renderVals() {
    const s = this.state, D = s.data, R = this.real(), T = this.types(), all = T.builtin.concat(T.mods), ty = all.find((x) => x.id === s.typeId) || T.builtin[0];
    const decls = (D && D.decls) || [], eps = (D && D.eps) || [], binds = (D && D.bindings) || [];
    const set = (p) => this.setState(p), tabOf = (id, name, n) => ({ name, n: n == null ? '' : String(n), cls: s.tab === id ? 'on' : '', cur: s.tab === id ? 'page' : 'false', pick: () => set({ tab: id, msg: '' }) });
    const o = { rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.props.nodeName || '—', kind: this.props.nodeKind || '노드', src: R ? 'Terra' : '시안',
      tabs: [tabOf('make', '만들기'), tabOf('res', '자원 · 허가', decls.length), tabOf('link', '연결', binds.length)], isMake: s.tab === 'make', isRes: s.tab === 'res', isLink: s.tab === 'link',
      env: [], msg: s.msg || (R && !this.rid() ? 'Terra 노드 목록에 없는 노드 — 자원화 불가' : R && !D ? '불러오는 중…' : ''), miss: D && D.miss && D.miss.length ? '읽지 못함 · ' + D.miss.join(' · ') : '' };
    // 울타리
    { const e = D && D.envelope, A = (x) => (Array.isArray(x) ? x : []);
      o.env = !e ? [{ k: '—', v: R ? '읽지 못함' : '' }] : [['파일', A(e.file_roots).length ? A(e.file_roots).map((r) => (r.path || r) + (r.mode ? ' (' + r.mode + ')' : '')).join(', ') : '닫힘'],
        ['프로그램', (e.process || 'off') === 'off' ? '닫힘' : e.process === 'any' ? '모두' : '허용 목록 — ' + (A(e.process_commands).join(', ') || '없음')],
        ['네트워크', e.net === false || e.net === 'off' ? '닫힘' : A(e.net_endpoints).map((x) => x.address || x).join(', ') || '열림'], ['최대 선언', e.max_declarations != null ? String(e.max_declarations) : '—']].map(([k, v]) => ({ k, v })); }

    // ── 만들기 ──
    const lockMod = !ty.family, errs = s.tried ? check(ty.schema, s.fname.trim(), s.vals) : {};
    const tyItem = (t, from) => ({ title: t.title, desc: t.desc, from, on: t.id === ty.id ? 'true' : 'false', cls: (t.id === ty.id ? 'on' : '') + (t.family ? '' : ' lock'), pick: () => set({ typeId: t.id, vals: {}, tried: false, msg: '' }) });
    o.typeGroups = [{ title: '내장', note: 'Terra Daemon', items: T.builtin.map((t) => tyItem(t, '')), empty: false, emptyT: '' },
      { title: '모듈 제공 유형', note: R ? '' : '시안 · 코어 대기', items: T.mods.map((t) => tyItem(t, t.moduleName || t.module)), empty: !T.mods.length, emptyT: '모듈 유형 없음 — 모듈 어댑터 · 설정 스키마 경로 : Terra 미지원 (contributions.svi)' }];
    o.typeTitle = ty.title; o.typeFrom = ty.family ? '내장 · ' + FAM[ty.family] : (ty.moduleName || ty.module) + ' 모듈 — 만들기 : 코어 대기';
    o.fname = s.fname; o.onName = (e) => set({ fname: e.target.value }); o.nameErr = errs.name || ''; o.nameBad = errs.name ? 'true' : 'false';
    o.fields = fieldsOf(ty.schema, s.vals).map((f) => { const up = (v) => set({ vals: Object.assign({}, s.vals, { [f.key]: v }) });
      return { title: f.title, req: f.required ? '*' : '', desc: f.desc, err: errs[f.key] || '', bad: errs[f.key] ? 'true' : 'false', isText: f.kind === 'text' || f.kind === 'path' || f.kind === 'list' || f.kind === 'number', isEnum: f.kind === 'enum', isBool: f.kind === 'bool',
        isPath: f.kind === 'path' && ty.family === 'file', browse: () => this.envOpen('file', String(f.value || '')), browseOff: !this.envLocal() || !!s.busy, browseTip: this.envLocal() ? '이 노드의 파일을 찾아 고릅니다 (읽기 전용)' : '다른 노드의 파일은 찾아볼 수 없습니다 — 경로를 직접 입력하세요',
        itype: f.kind === 'number' ? 'number' : 'text', value: f.value, ph: f.kind === 'path' ? '/절대/경로' : f.kind === 'list' ? '값 값 …' : '', onInput: (e) => up(e.target.value),
        opts: (f.options || []).map((op) => ({ label: op.label, on: op.v === f.value ? 'true' : 'false', cls: op.v === f.value ? 'on' : '', pick: () => up(op.v) })),
        on: f.value === true ? 'true' : 'false', swCls: f.value === true ? 'on' : '', swT: f.value === true ? '켬' : '끔', toggle: () => up(!(f.value === true)) }; });
    { const e = D && D.envelope, v = castOf(ty.schema, s.vals), A = (x) => (Array.isArray(x) ? x : []), L0 = this.envLocal(); let why = '';
      if (e && ty.family === 'file') { const roots = A(e.file_roots), p = v.path; if (!roots.length) why = L0 ? '이 노드에 허용된 폴더가 없어 파일 자원을 만들 수 없습니다. 먼저 폴더를 허용하세요.' : '이 노드에 허용된 폴더가 없습니다. 그 노드의 자원화 창에서 폴더를 허용해야 합니다.'; else if (p && !roots.some((r) => { const q = String(r.path || r).replace(/[\\/]+$/, ''); return p === q || p.startsWith(q + '/') || p.startsWith(q + '\\'); })) why = (L0 ? '허용된 폴더 밖입니다 — ' : '허용된 폴더 밖입니다(그 노드에서 허용해야 함) — ') + roots.map((r) => r.path || r).join(', '); }
      if (e && ty.family === 'process') { const m = e.process || 'off'; if (m === 'off') why = '프로그램 자원은 닫혀 있습니다. 노드 설정 파일(svi.runtime.process)에서만 열 수 있고 재시작이 필요합니다 — 이 화면에서는 열지 않습니다.'; else if (m === 'allowlist' && v.command && !A(e.process_commands).includes(v.command)) why = '허용 목록 밖 프로그램입니다. 노드 설정 파일(svi.runtime.process_commands)에 추가해야 합니다.'; }
      if (e && ty.family === 'net') { if (e.net === false || e.net === 'off') why = '네트워크 자원은 닫혀 있습니다. 노드 설정 파일(svi.runtime.net)에서만 열 수 있고 재시작이 필요합니다 — 이 화면에서는 열지 않습니다.'; else if (A(e.net_endpoints).length && v.address && !A(e.net_endpoints).some((x) => String(x.address || x) === v.address)) why = '허용 목록 밖 주소입니다. 노드 설정 파일(svi.runtime.net_endpoints)에 추가해야 합니다.'; }
      o.envBad = !!why; o.envWhy = why;
      o.envFix = !!why && ty.family === 'file' && L0 && !this.state.envDlg; o.envFixT = '폴더 허용…'; o.envFixGo = () => this.envOpen('add', dirOf(v.path)); }
    o.exists = !!decls.find((d) => d.name === s.fname.trim()); o.replace = !!s.replace; o.onReplace = (e) => set({ replace: e.target.checked });
    o.makeOff = s.busy || lockMod || (R && !this.rid()) || (R && o.envBad); o.makeT = lockMod ? '만들기 — 코어 대기' : s.busy ? '만드는 중…' : o.envBad && R ? '만들 수 없음 — 울타리 밖' : '자원 만들기';
    o.makeApi = lockMod ? '모듈 유형 → 모듈 어댑터 경로 : Terra 미지원' : 'svi.declarations.post · ' + (this.props.nodeName || '');
    o.submit = (e) => { if (e && e.preventDefault) e.preventDefault(); if (lockMod || (R && o.envBad)) return; const nm = s.fname.trim(), er = check(ty.schema, nm, s.vals); if (Object.keys(er).length) { set({ tried: true, msg: '값 확인 — ' + Object.values(er)[0] }); return; }
      if (o.exists && !s.replace) { set({ msg: nm + ' — 같은 이름 있음 · 교체 : 아래 칸 켬' }); return; }
      const v = castOf(ty.schema, s.vals), inp = { family: ty.family, name: nm, direction: v.direction || 'source' };
      if (ty.family === 'file') inp.path = v.path; if (ty.family === 'process') { inp.command = v.command; if (v.args && v.args.length) inp.args = v.args; } if (ty.family === 'net') { inp.address = v.address; inp.mode = v.mode || 'connect'; inp.framing = v.framing || 'chunk'; } if (s.replace) inp.replace = true;
      this.act(nm + ' 만들기', () => window.TerraSviMake.declare(this.rid(), inp), (d) => { d.decls = d.decls.filter((x) => x.name !== nm).concat({ family: ty.family, name: nm, dir: inp.direction, resId: 'r-' + nm, origin: 'runtime', state: o.envBad ? 'refused_by_policy' : 'applied', reason: o.envBad ? 'SVI_DECLARATION_OUTSIDE_ENVELOPE — ' + o.envWhy : '', detail: inp.path || inp.command || inp.address });
        if (!o.envBad) d.eps.push({ resId: 'r-' + nm, resName: nm, node: 'nd_' + (this.props.nodeName || 'desk'), epId: inp.direction === 'sink' ? 'in' : 'out', dir: inp.direction, interaction: 'stream', schema: 'terra.bytes@1', status: 'available', ops: [] }); return d; });
      set({ fname: '', vals: {}, tried: false, replace: false }); };

    // ── 자원 · 허가 — 주체(노드 · 사람)마다 고를 수 있는 작업 · 기한은 위임 가드대로(svi-grant.js) ──
    const me = this.rid() || ((D && D.nodes && D.nodes[0]) || {}).id, others = ((D && D.nodes) || []).filter((n) => n.id !== me), K = s.subj, self = this.selfId();
    const RU = subjectRule(K, K === 'user' ? self : 'n', self), gops = allowedOps(K, s.gops[K]), ttlT = (TTLS.find((t) => t[1] === s.ttl) || TTLS[1])[0];
    const UG = R && window.TerraGate ? window.TerraGate('terra.master.admin.users.get') : { open: true, why: '' };
    o.ttls = TTLS.map(([l, v]) => ({ label: l, cls: s.ttl === v ? 'on' : '', pick: () => set({ ttl: v }) }));
    o.subjOpts = [['node', '노드'], ['user', '사람']].map(([id, nm]) => ({ label: nm, cls: K === id ? 'on' : '', on: K === id ? 'true' : 'false', pick: () => set({ subj: id }) }));
    o.opChips = RU.ops.map((c) => { const on = gops.includes(c.op); return { label: c.label, on: on ? 'true' : 'false', cls: (on ? 'on' : '') + (c.ok ? '' : ' lock'), off: c.ok ? null : 'disabled', tip: c.ok ? c.op : c.why, pick: () => set({ gops: Object.assign({}, s.gops, { [K]: toggleOp(K, s.gops[K], c.op) }) }) }; });
    o.grantNote = K === 'user' ? (UG.open ? '' : '사람 목록 · ' + UG.why + ' · ') + '사람 : 나 자신만 (위임 가드) — inspect · read · subscribe · bind.source · bind.target · 90d 이하'
      : '노드 : 같은 클러스터만 (위임 가드) — read · subscribe · bind.source · 90d 이하';
    const opsShort = (ops) => (ops.includes('bind.source') || ops.includes('bind.target') ? '연결' + (ops.includes('read') ? ' · 읽기' : '') : ops.includes('read') || ops.includes('subscribe') ? '읽기' : ops.includes('inspect') ? '살펴보기' : opsText(ops));
    o.decls = decls.map((d) => { const st = DST[d.state] || [d.state || '—', 'dim'], G = (D && D.grants) || [], blocked = s.busy || !d.resId || d.state !== 'applied';
      const subs = K === 'user' ? [{ id: self, name: '나' + (self ? ' · ' + self : ''), self: true }] : others;
      return { name: d.name, fam: FAM[d.family] || d.family, dir: d.dir === 'sink' ? '받음' : '내보냄', detail: d.detail, st: st[0], stCls: st[1], hasReason: !!d.reason, reason: d.reason, off: s.busy, gLabel: K === 'user' ? '허가한 사람' : '허가한 노드',
        undeclare: () => this.act(d.name + ' 해제 — 그 위 연결 종료', () => window.TerraSviMake.undeclare(this.rid(), d.family, d.name), (x) => { x.decls = x.decls.filter((y) => y.name !== d.name); x.eps = x.eps.filter((y) => y.resId !== d.resId); return x; }),
        noNodes: K === 'node' && !others.length, noNodesT: '허가할 다른 노드 없음',
        nodes: subs.map((n) => { const g = G.find((x) => x.type === K && x.subject === n.id && x.resId === d.resId), on = !!g, rule = K === 'user' ? subjectRule('user', n.id, self) : { ok: true, why: '' };
          const chk = checkGrant({ subject_type: K, subject_id: n.id, operations: gops, ttl_seconds: s.ttl }, self);
          return { name: n.name, on: on ? 'true' : 'false', cls: on ? 'on' : '', perm: on ? opsShort(g.ops) : '', off: blocked || (!on && !chk.ok) ? 'disabled' : null,
            tip: on ? '누르기 : 회수 — ' + opsText(g.ops) : !rule.ok ? rule.why : !chk.ok ? chk.why : '누르기 : 허가 — ' + opsText(gops) + '(' + ttlT + ')',
            toggle: () => on ? this.act((K === 'user' ? '나' : n.name) + ' 허가 회수', () => window.TerraSviMake.revoke(g.id), (x) => { x.grants = x.grants.filter((y) => y.id !== g.id); return x; })
              : !chk.ok ? set({ msg: chk.why }) : K === 'user' ? this.act('나에게 허가', () => window.TerraSviMake.grantTo('user', n.id, d.resId, gops, s.ttl), (x) => { x.grants.push({ id: 'g' + Date.now(), type: 'user', subject: n.id, resId: d.resId, ops: gops }); return x; })
                : this.act(n.name + ' 에 허가', () => window.TerraSviMake.grant(d.resId, n.id, gops, s.ttl), (x) => { x.grants.push({ id: 'g' + Date.now(), type: 'node', subject: n.id, resId: d.resId, ops: gops }); return x; }) }; }) }; });
    o.noDecls = !!D && !decls.length;

    // ── 연결 ──
    const key = (e) => e.resId + '|' + e.epId, pick = s.pick && eps.find((e) => key(e) === s.pick), drag = this._drag || pick;
    const label = (e) => ({ res: e.resName, node: this.nodeName(e.node), ep: e.epId, fmt: [e.interaction, e.schema].filter(Boolean).join(' · ') });
    const doLink = (src, dst) => { const c = linkable(src, dst); if (!c.ok) { set({ msg: '연결 불가 — ' + c.why }); return; }
      set({ pick: null, hot: '' }); this._drag = null;
      this.act(src.resName + ' → ' + dst.resName + ' 연결', () => window.TerraSviMake.link(src, dst), (x) => { x.bindings.push({ id: 'b' + Date.now(), src: { resource_id: src.resId, endpoint_id: src.epId }, dst: { resource_id: dst.resId, endpoint_id: dst.epId }, srcNode: src.node, dstNode: dst.node, st: { label: '연결 중', cls: 'busy', reason: '' } }); return x; }); };
    o.srcs = eps.filter((e) => e.dir === 'source' || e.dir === 'duplex').map((e) => Object.assign(label(e), { on: s.pick === key(e) ? 'true' : 'false', cls: s.pick === key(e) ? 'on' : '',
      drag: (ev) => { this._drag = e; try { ev.dataTransfer.setData('text/plain', key(e)); ev.dataTransfer.effectAllowed = 'link'; } catch (x) {} this.setState({ t: s.t + 1 }); },
      dragEnd: () => { this._drag = null; this.setState({ hot: '' }); }, pick: () => set({ pick: s.pick === key(e) ? null : key(e) }) }));
    o.dsts = eps.filter((e) => e.dir === 'sink' || e.dir === 'duplex').map((e) => { const c = drag ? linkable(drag, e) : { ok: true, why: '' };
      return Object.assign(label(e), { cls: drag ? (c.ok ? 'ok' : 'no') + (s.hot === key(e) ? ' hot' : '') : '', why: drag && !c.ok ? c.why : drag && c.why ? c.why : '', off: !!pick && !c.ok,
        over: (ev) => { if (c.ok && this._drag) { ev.preventDefault(); if (s.hot !== key(e)) this.setState({ hot: key(e) }); } }, leave: () => s.hot === key(e) && this.setState({ hot: '' }),
        drop: (ev) => { ev.preventDefault(); if (this._drag) doLink(this._drag, e); }, pick: () => { if (pick) doLink(pick, e); else set({ msg: '원천 먼저 선택 (또는 끌기)' }); } }); });
    o.srcN = o.srcs.length + '개'; o.dstN = o.dsts.length + '개';
    const resName = (id) => { const e = eps.find((x) => x.resId === id); return e ? e.resName : String(id || '').slice(0, 10); };
    o.binds = binds.map((b) => ({ pair: resName(b.src.resource_id) + ' (' + this.nodeName(b.srcNode) + ') → ' + resName(b.dst.resource_id) + ' (' + this.nodeName(b.dstNode) + ')', label: b.st.label, cls: b.st.cls, reason: b.st.reason || '',
      idle: b.st.cls === 'ok' ? '보고 없음' : '—', idleTip: '유휴(연결됨 · 흐름 없음) : Terra 미보고 — binding 에 마지막 프레임 시각 없음', off: s.busy || b.st.label === '닫힘',
      unlink: () => this.act('연결 끊기', () => window.TerraSviMake.unlink(b.id), (x) => { const y = x.bindings.find((z) => z.id === b.id); if (y) y.st = { label: '닫힘', cls: 'dim', reason: '사용자 닫음' }; return x; }) }));
    o.noBinds = !!D && !binds.length;
    { const c = (k) => binds.filter((b) => b.st.cls === k).length; o.bindSum = '연결됨 ' + c('ok') + ' · 끊김 ' + c('warn') + ' · 실패 ' + c('err'); }
    this.envVals(o, D, decls);
    return o;
  }
}
