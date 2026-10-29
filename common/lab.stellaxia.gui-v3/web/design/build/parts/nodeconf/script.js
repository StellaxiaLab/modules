// 설정 창 — 노드를 두 쪽에서 관리. 왼쪽 분류, 오른쪽 항목, 아래 적용 · 되돌리기 (바뀐 수 · 재시작 필요 수)
//   GUI(사람마다 · 노드마다 보이는 모습) — 표시 · 프로필 · 스킨 · 뷰
//     표시 · 뷰 · 스킨 → 사용자 문서 me/documents (app:lab.stellaxia.gui-v3/…) — 어느 기기에서든 같다
//     프로필 → v3 모듈 백엔드(노드의 모듈 데이터 영역 · lab.stellaxia.gui-v3.node-files.*) — 그 노드를 보는 모든 사람에게 같다
//     (시안에서는 셋 다 localStorage 로 흉내: 'terra.skin' · 'terra.fs' · 'terra.fs.f.<노드 id>:<상대 경로>')
//   노드(Terra 코어 Daemon 설정 config.json — 실제 키 이름 그대로) — 정체 · 연결 · 공유 · 업데이트 · 로그 · 위험
//     읽기 terra.daemon.config.get(+schema.get) · 쓰기 terra.daemon.config.patch {set, save:true} — 쓰기는 로컬 노드만(권한 node.config)
//     원격 노드(remote)면 전부 읽기 + "그 노드에서 열기". 계정 · 리소스는 노드가 아니라 노드 설정이 없다
//     키마다 소유자(편집 = operator · 읽기 = installer/derived)와 재시작 필요 여부를 함께 보인다. 비밀 키 · 효과 없는 키 · 포트 편집은 두지 않는다
//   시안 — 노드 설정 값은 이 창 안에서만 (적용하면 기준값이 바뀐다)
class Component extends DCLogic {
  constructor(props) { super(props); this.state = { sec: 'show', v: null, base: null, draft: {}, msg: '', arm: null, needRestart: 0 }; }
  isNode() { const k = this.props.nodeKind || '리프'; return k === '트리' || k === '리프'; }
  remote() { return !!this.props.remote; }
  // Daemon 설정 키 — [키, 소유자(O 편집 · I/D 읽기), 재시작 필요]. 근거: Terra products/leaf/daemon/src/terra_daemon/core/config.go (스키마 140키 중 v3 1차 노출분)
  DKEYS() { return {
    'daemon.device_name': ['O', false], 'daemon.roles': ['D', false], 'registration.node_id': ['D', false], 'registration.parent': ['D', false],
    'master.url': ['O', true], 'wireguard.advertise_endpoint': ['O', true], 'heartbeat.interval_sec': ['O', true],
    'storage.shared_dirs': ['O', true], 'storage.memos_dir': ['O', true], 'local_fs.enabled': ['O', false],
    'core.version': ['D', false], 'core_distribution.hold': ['O', true], 'core_distribution.hold_reason': ['O', true], 'core_distribution.allow_apply': ['O', true], 'core_distribution.maintenance_window': ['O', true], 'core_distribution.disk_quota_mb': ['O', true],
    'logging.level': ['O', false], 'logging.max_size_mb': ['O', true], 'logging.max_backups': ['O', true] }; }
  defaults() {
    const k = this.props.nodeKind || '리프', nm = this.props.nodeName || 'lab-ws-02', slug = nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'node', par = this.props.parentName || '—';
    return { label: true, orbit: true, color: '기본', proj: '마스크', view: k === '트리' ? '리프 뷰' : k === '리프' ? '리소스 뷰' : '트리 뷰', dbl: true, badge: true, skin: this.skinOf(), profile: this.profOf(),
      // 노드 설정 — 시안 값 (실제로는 GET /config 의 실행 중 값)
      'daemon.device_name': slug, 'daemon.roles': k === '트리' ? 'tree' : 'leaf', 'registration.parent': par, 'registration.node_id': this.nodeId(),
      'master.url': 'https://' + (par.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tree') + '.terra.local:8080', 'wireguard.advertise_endpoint': '', 'heartbeat.interval_sec': 10,
      'storage.shared_dirs': [{ name: 'share-0', path: '~/TerraShare' }], 'storage.memos_dir': '', 'local_fs.enabled': true,
      'core.version': '1.7.0', 'core_distribution.hold': false, 'core_distribution.hold_reason': '', 'core_distribution.allow_apply': true, 'core_distribution.maintenance_window': '', 'core_distribution.disk_quota_mb': 4096,
      'logging.level': 'info', 'logging.max_size_mb': 10, 'logging.max_backups': 5 };
  }
  // 스킨 — 노드 id 로 저장한 구 id ('' = 기본 무늬). 보관함은 스타메이커와 같은 terra.star.index
  // ── 노드 파일 (프로필) ──
  fsAll() { try { const v = JSON.parse(localStorage.getItem('terra.fs') || 'null'); if (v && v.nodes) return v; } catch (e) {} return { nodes: {} }; }
  fsNode(F, id) { return F.nodes[id] || (F.nodes[id] = { files: {}, props: {} }); }
  profOf() { const N = this.fsAll().nodes[this.props.nodeKey || '']; return (N && N.props && N.props.profile && N.props.profile.image) || ''; }
  nodeBase() { return this.props.nodePath || '/' + (this.props.nodeName || 'node'); }
  // 속성에 적는 경로는 노드 상대 '/데이터/…' (백엔드 lab.stellaxia.gui-v3.node-props 와 같은 꼴) — 화면엔 노드 경로를 앞에 붙여 보인다. 예전 꼴(노드 경로 포함)도 읽는다
  relOf(path) { if (!path) return ''; const a = '/데이터/', b = this.nodeBase() + '/데이터/'; return path.startsWith(a) ? path.slice(a.length) : path.startsWith(b) ? path.slice(b.length) : ''; }
  profData(path) { const id = this.props.nodeKey || '', rel = this.relOf(path); if (!rel) return ''; try { return localStorage.getItem('terra.fs.f.' + id + ':' + rel) || ''; } catch (e) { return ''; } }
  profPick(f) {
    if (!f) return; if (!/^image\//.test(f.type)) { this.setState({ msg: '이미지 · GIF 파일만 올릴 수 있어요' }); return; }
    if (f.size > 2.5 * 1024 * 1024) { this.setState({ msg: '2.5MB 이하만 — 브라우저 저장소가 작아요 (' + (f.size / 1048576).toFixed(1) + 'MB)' }); return; }
    const rd = new FileReader(); rd.onload = () => { const nm = (f.name || 'profile').replace(/[\\/:*?"<>|]+/g, '_'); this._pend = { name: nm, mime: f.type, size: f.size, data: rd.result }; this.set('profile', '(새 파일) ' + nm + ' · ' + Date.now()); }; rd.readAsDataURL(f);
  }
  profApply(v) {
    const id = this.props.nodeKey || '', F = this.fsAll(), N = this.fsNode(F, id), old = N.props.profile && N.props.profile.image;
    // 지난 프로필 파일은 지운다 (프로필 폴더엔 지금 것 하나만)
    if (this.relOf(old)) { const rel = this.relOf(old); delete N.files[rel]; try { localStorage.removeItem('terra.fs.f.' + id + ':' + rel); } catch (e) {} }
    if (v.profile && this._pend) { const P = this._pend, rel = 'profile/image/' + P.name;
      try { localStorage.setItem('terra.fs.f.' + id + ':' + rel, P.data); } catch (e) { this.setState({ msg: '저장 공간이 모자라요 — 더 작은 파일로' }); return false; }
      N.files[rel] = { mime: P.mime, size: P.size, at: Date.now() }; N.props.profile = { image: '/데이터/' + rel }; this._pend = null; }
    else delete N.props.profile;
    try { localStorage.setItem('terra.fs', JSON.stringify(F)); } catch (e) {}
    try { window.dispatchEvent(new Event('terra-fs')); } catch (e) {}
    return true;
  }
  skinMap() { try { return JSON.parse(localStorage.getItem('terra.skin') || '{}') || {}; } catch (e) { return {}; } }
  skinOf() { return this.skinMap()[this.props.nodeKey || ''] || ''; }
  starIdx() { try { const v = JSON.parse(localStorage.getItem('terra.star.index') || 'null'); if (v && Array.isArray(v.files)) return v; } catch (e) {} return { folders: ['star'], files: [] }; }
  V() { const nk = (this.props.nodeKey || '') + '|' + (this.props.nodeName || ''); if (this._vk !== nk) { this._vk = nk; this.state.v = null; this._pend = null; }   // 다른 노드로 열리면 처음부터
    if (!this.state.v) { const d = this.defaults(); this.state.v = JSON.parse(JSON.stringify(d)); this.state.base = JSON.parse(JSON.stringify(d)); } return this.state.v; }
  set(k, val) { const v = Object.assign({}, this.V(), { [k]: val }); this.setState({ v, msg: '' }); }
  dirty() { const v = this.V(), b = this.state.base; return Object.keys(v).filter((k) => JSON.stringify(v[k]) !== JSON.stringify(b[k])); }
  SECS() { return [['GUI', [['show', '표시'], ['prof', '프로필'], ['skin', '스킨'], ['view', '뷰']]], ['노드', [['ident', '정체'], ['conn', '연결'], ['share', '공유'], ['upd', '업데이트'], ['log', '로그'], ['danger', '위험']]]]; }
  KEYS() { return { show: ['label', 'orbit', 'color', 'proj'], skin: ['skin'], prof: ['profile'], view: ['view', 'dbl', 'badge'],
    ident: ['daemon.device_name'], conn: ['master.url', 'wireguard.advertise_endpoint', 'heartbeat.interval_sec'], share: ['storage.shared_dirs', 'storage.memos_dir', 'local_fs.enabled'],
    upd: ['core_distribution.hold', 'core_distribution.hold_reason', 'core_distribution.allow_apply', 'core_distribution.maintenance_window', 'core_distribution.disk_quota_mb'], log: ['logging.level', 'logging.max_size_mb', 'logging.max_backups'], danger: [] }; }
  // 노드 설정 줄의 머리표 — 키 이름 · 편집/읽기 · 재시작
  meta(k) { const D = this.DKEYS()[k]; if (!D) return {}; const ro = D[0] !== 'O' || this.remote(); return { keyT: k, tagT: ro ? '읽기' : '편집', tagCls: ro ? 'ro' : 'ed', rsT: D[1] && !ro ? '재시작 필요' : D[0] === 'O' && !D[1] && !ro ? '즉시' : '', isMeta: true }; }
  // 노드가 아닌 것 · 원격 노드 — 안내 줄
  noteRow(t, sub, act) { return { label: t, sub, isNote: true, noteAct: act || null, hasAct: !!act, actT: act ? act.t : '' }; }
  rows(sec) {
    const v = this.V(), S = this.state, RO = (k) => { const D = this.DKEYS()[k]; return !!D && (D[0] !== 'O' || this.remote()); }, M = (k, r) => Object.assign(r, this.meta(k));
    const T = (k, label, sub) => (RO(k) ? X(k, label, sub) : M(k, { label, sub, isToggle: true, on: v[k] ? 'true' : 'false', tgCls: v[k] ? 'on' : '', tgT: v[k] ? '켬' : '끔', toggle: () => this.set(k, !v[k]) }));
    const G = (k, label, sub, opts) => (RO(k) ? X(k, label, sub) : M(k, { label, sub, isSeg: true, opts: opts.map((o) => ({ name: o, on: v[k] === o ? 'true' : 'false', cls: v[k] === o ? 'on' : '', pick: () => this.set(k, o) })) }));
    const X = (k, label, sub, ph) => M(k, { label, sub, isText: true, val: typeof v[k] === 'boolean' ? (v[k] ? '켬' : '끔') : Array.isArray(v[k]) ? v[k].map((d) => (d.name ? d.name + ' = ' : '') + d.path).join(' · ') : String(v[k] ?? ''), ph: ph || '', ro: RO(k) ? 'readonly' : null, input: (e) => this.set(k, e.target.value) });
    const N = (k, label, sub, min, max, step, unit) => (RO(k) ? X(k, label, sub) : M(k, { label, sub, isRange: true, min, max, step: step || 1, val: v[k], valT: v[k] + unit, input: (e) => this.set(k, +e.target.value) }));
    const D = (id, label, sub, t1, t2, off) => ({ label, sub, isDanger: true, dOff: off ? 'disabled' : null, dCls: S.arm === id ? 'arm' : '', dT: off ? t1 : S.arm === id ? t2 : t1, act: () => { if (off) return; if (S.arm === id) { this.setState({ arm: null, needRestart: 0, msg: label + ' — 요청을 보냈어요 (시안 · POST /restart)' }); } else { this.setState({ arm: id }); clearTimeout(this._armT); this._armT = setTimeout(() => this.setState({ arm: null }), 4000); } } });
    if (sec === 'show') return [T('label', '이름표', '노드 이름을 늘 띄움 · 사용자 문서'), T('orbit', '궤도 선', '이 노드의 궤도를 그림 · 사용자 문서'), G('color', '노드 색', '지도 · 뷰의 기호 색 · 사용자 문서', ['기본', '파랑', '초록', '주황']), G('proj', '표시 방식', '글자 장에 그리는 컴포넌트 타입 · 사용자 문서', ['마스크', '레거시', '혼합'])];
    if (sec === 'prof') { const cur = v.profile, pend = cur && cur.startsWith('(새 파일) ') && this._pend, img = pend ? this._pend.data : this.profData(cur);
      return [{ label: '프로필 사진', sub: '이미지 · GIF (2.5MB 이하) — 트리 뷰에서 이 노드 원 안에. 이 노드를 보는 모두에게 같다 (v3 모듈이 노드에 저장)', isProf: true, pImg: img || '', hasImg: !!img, noImg: !img,
        pPath: pend ? '적용하면 → ' + this.nodeBase() + '/데이터/profile/image/' + this._pend.name : cur ? (cur.startsWith('/데이터/') ? this.nodeBase() + cur : cur) : '없음', pProps: this.nodeBase() + '/데이터/properties.json › profile.image',
        pick: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; this.profPick(f); }, clear: () => { this._pend = null; this.set('profile', ''); } }]; }
    if (sec === 'skin') { const L = this.starIdx(), planet = (this.props.nodeKind || '리프') === '리프', pick = (id) => () => this.set('skin', id), C = (id) => (v.skin === id ? 'on' : '');
      const files = L.files.slice().sort((a, b) => (a.path + '/' + a.name).localeCompare(b.path + '/' + b.name));
      return [{ label: '행성 스킨', sub: (planet ? '유틸/스타메이커/star 의 구 파일 — 겉면을 그 표면 지도로' : '행성(리프)일 때 장면에 보임 — 지금은 저장만') + ' · 사용자 문서(내 화면에서만)', isSkin: true,
        skins: [{ name: '기본', path: '타입 무늬', thumb: '', noThumb: true, hasThumb: false, cls: C(''), on: v.skin === '' ? 'true' : 'false', pick: pick('') }].concat(files.map((f) => ({ name: f.name, path: f.path + ' · ' + (f.kind === 'planet' ? '행성' : '항성'), thumb: f.thumb || '', noThumb: !f.thumb, hasThumb: !!f.thumb, cls: C(f.id), on: v.skin === f.id ? 'true' : 'false', pick: pick(f.id) }))),
        skinEmpty: files.length ? '' : 'star 폴더가 비어 있어요 — 스타메이커에서 구를 저장하면 여기 뜹니다' }]; }
    if (sec === 'view') return [G('view', '기본 진입 뷰', '진입하면 처음 보는 뷰 · 사용자 문서', ['트리 뷰', '리프 뷰', '리소스 뷰']), T('dbl', '두 번 눌러 진입', '끄면 우클릭 › 진입으로만 · 사용자 문서'), T('badge', '알림 배지', '경고 · 이벤트 수를 노드 옆에 · 사용자 문서')];
    // ── 노드 설정 (Daemon) ──
    if (!this.isNode()) return [this.noteRow((this.props.nodeKind === '계정' ? '계정은' : '리소스는') + ' 노드가 아니에요', this.props.nodeKind === '계정' ? '계정 · 사용자 · 권한은 트리 화면(클러스터 관리)에서 — Master 사용자 API' : '리소스는 리프 노드의 SVI 선언 — 그 리프의 설정 › 공유에서')];
    const head = this.remote() ? [this.noteRow('원격 노드 — 읽기만', '노드 설정 쓰기(terra.daemon.config.patch)는 그 노드에서만 됩니다. 값은 실행 중 값(GET /config, 비밀은 가림)', { t: '그 노드에서 열기', run: () => this.setState({ msg: '그 노드의 GUI 를 엽니다 (시안)' }) })] : [];
    if (sec === 'ident') return head.concat([X('daemon.device_name', '표시 이름', '지도 · 목록에 보이는 이 노드의 이름', 'lab-ws-02'), X('daemon.roles', '역할', '설치된 역할 — 바꾸려면 인스톨러로 재구성'), X('registration.parent', '부모 트리', '이 노드가 등록된 트리'), X('registration.node_id', '노드 ID', '등록 때 정해짐'),
      this.noteRow('관리자 · 권한', '사용자 · 권한은 노드 설정이 아니라 트리의 Master 가 관리한다 — 트리 화면(클러스터 관리)')]);
    if (sec === 'conn') return head.concat([X('master.url', 'Master 주소', '이 노드가 붙는 트리 Master (https 권장)', 'https://tree.example:8080'), X('wireguard.advertise_endpoint', '광고 주소', '다른 노드가 이 노드에 직접 닿을 주소 (host:port, 비우면 자동)', 'host:51820'), N('heartbeat.interval_sec', 'heartbeat 주기', '살아 있음 보고 간격', 1, 60, 1, '초'),
      { label: '포트', sub: '생성된 표(endpoints.json)에 고정 — 바꾸면 모든 연결 쪽과 어긋나 편집하지 않는다', isList: true, items: ['Gateway 8787 (leaf) · 8788 (tree)', 'Local API 17321', 'Master 8080', 'direct TCP 17322 · mesh 17323 · gRPC 17325 (기본 꺼짐)', 'WireGuard 51820'].map((t) => ({ t })), keyT: 'host/endpoints.go', tagT: '읽기', tagCls: 'ro', rsT: '', isMeta: true }]);
    if (sec === 'share') { const k = 'storage.shared_dirs', dirs = v[k] || [], ro = RO(k);
      const L = ro ? X(k, '공유 폴더', '모듈(파일 등)이 다른 노드에 보이는 폴더') : M(k, { label: '공유 폴더', sub: '모듈(파일 등)이 다른 노드에 보이는 폴더 — 이름 memos 는 예약', isDirs: true,
        dirs: dirs.map((dd, j) => ({ name: dd.name || '', path: dd.path || '', inName: (e) => this.set(k, dirs.map((x, q) => (q === j ? Object.assign({}, x, { name: e.target.value }) : x))), inPath: (e) => this.set(k, dirs.map((x, q) => (q === j ? Object.assign({}, x, { path: e.target.value }) : x))), del: () => this.set(k, dirs.filter((x, q) => q !== j)) })),
        add: () => this.set(k, dirs.concat([{ name: 'share-' + dirs.length, path: '' }])) });
      return head.concat([L, X('storage.memos_dir', '메모 폴더', '비우면 기본(<storage>/memos)', '<storage>/memos'), T('local_fs.enabled', '이 기기 폴더 보기', 'GUI 의 폴더 탐색기가 이 기기의 파일을 보여 줌')]); }
    if (sec === 'upd') return head.concat([X('core.version', '코어 버전', '지금 실행 중 — 업데이트는 트리가 내려보낸다(채널 없음)'), T('core_distribution.hold', '업데이트 보류', '트리가 보낸 새 코어를 받지 않음'), X('core_distribution.hold_reason', '보류 이유', '트리에 함께 보고', '예: 시연 중'),
      T('core_distribution.allow_apply', '받은 업데이트 적용', '끄면 받기만 하고 교체하지 않음'), X('core_distribution.maintenance_window', '정비 시간', '이 시간에만 교체 (HH:MM-HH:MM, 비우면 언제든)', '02:00-05:00'), N('core_distribution.disk_quota_mb', '받기 용량', '업데이트 스테이징에 쓰는 디스크', 512, 16384, 512, 'MB')]);
    if (sec === 'log') return head.concat([G('logging.level', '로그 수준', 'daemon.log · job.log · audit.log', ['debug', 'info', 'warn', 'error']), N('logging.max_size_mb', '파일 크기', '이 크기에서 새 파일로', 1, 100, 1, 'MB'), N('logging.max_backups', '보관 파일 수', '지난 파일을 몇 개 남길지', 0, 20, 1, '개')]);
    return head.concat([D('restart', '노드 다시 시작', '코어를 내렸다 올림 — 잠깐 끊김 · terra.daemon.restart.post', '다시 시작', '한 번 더 누르면 실행', this.remote()), D('detach', '트리에서 빼기', '대응하는 코어 동작을 아직 확인하지 못했다 — 열린 질문', '준비 중', '', true)]);
  }
  nodeId() { let h = 7; for (const ch of (this.props.nodeName || 'node')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 'nd_' + h.toString(16).padStart(8, '0').slice(0, 8); }
  renderVals() {
    const S = this.state, v = this.V(), dk = this.dirty(), K = this.KEYS(), sec = S.sec, grp = this.SECS().find((g) => g[1].some((i) => i[0] === sec)), DK = this.DKEYS(),
      filled = (r) => Object.assign({ isToggle: false, isSeg: false, isText: false, isRange: false, isChips: false, isDanger: false, isSkin: false, isProf: false, isNote: false, isList: false, isDirs: false, isMeta: false, hasAct: false, sub: '', keyT: '', tagT: '', tagCls: '', rsT: '', ph: '', dOff: null }, r);
    const rsN = dk.filter((k) => DK[k] && DK[k][1]).length;
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh', name: this.props.nodeName || 'lab-ws-02', kind: (this.props.nodeKind || '리프') + (this.remote() ? ' · 원격' : ''), nodeId: this.nodeId(),
      groups: this.SECS().map(([g, items]) => ({ name: g, items: items.map(([id, nm]) => { const n = K[id].filter((k) => dk.includes(k)).length; return { name: nm, cls: id === sec ? 'on' : '', cur: id === sec ? 'page' : 'false', badge: n ? '●' + n : '', pick: () => this.setState({ sec: id, arm: null }) }; }) })),
      secName: (grp[1].find((i) => i[0] === sec) || [])[1], secGroup: grp[0] === '노드' ? '노드 · Daemon 설정' : grp[0],
      rows: this.rows(sec).map(filled).map((r) => (r.isNote && r.noteAct ? Object.assign(r, { noteRun: r.noteAct.run }) : Object.assign(r, { noteRun: null }))),
      dirtyT: dk.length ? '바뀐 항목 ' + dk.length + (rsN ? ' · 재시작 필요 ' + rsN : '') : '바뀐 것 없음', clean: dk.length ? null : 'disabled', msg: S.msg,
      restartD: S.needRestart ? 'inline-flex' : 'none', restartNow: () => this.setState({ needRestart: 0, msg: '다시 시작 요청을 보냈어요 (시안 · POST /restart)' }),
      apply: () => { if (dk.includes('profile') && !this.profApply(v)) return; if (dk.includes('skin')) { const m = this.skinMap(), key = this.props.nodeKey || ''; if (v.skin) m[key] = v.skin; else delete m[key]; try { localStorage.setItem('terra.skin', JSON.stringify(m)); } catch (e) {} if (this.props.onSkin) this.props.onSkin(key, v.skin); }
        // 노드 설정 — 실제로는 바뀐 키만 terra.daemon.config.patch {set:{…}, save:true} 한 번 (전부 적용되거나 전부 안 됨, 키별 오류는 그 줄에). path 인자는 넘기지 않는다
        const nd = dk.filter((k) => DK[k]);
        this.setState({ base: JSON.parse(JSON.stringify(v)), needRestart: (S.needRestart || 0) + rsN, msg: '적용했어요 — ' + dk.length + '개' + (nd.length ? ' (노드 설정 ' + nd.length + '개 · 시안)' : '') + (rsN ? ' · 재시작해야 반영되는 항목 ' + rsN + '개' : '') }); },
      revert: () => { this._pend = null; this.setState({ v: JSON.parse(JSON.stringify(S.base)), msg: '되돌렸어요' }); }
    };
  }
}
