// 공통 부품 (디자인 노트) — 디자인 캔버스 원본 design/Components.dc.html 에서 옮긴 화면 로직 (tools/gen-pages.py로 다시 만든다)
// 데이터 연동 지점은 docs/api/frontend-api.md 참고
import { DCLogic } from '../runtime/dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = {
      grant: false, tip: null, popKey: 0,
      typed: 'agen', acceptedA: false,
      hold: 'idle', // idle | holding | done
      job: { phase: 'idle', pct: 0 }, failNext: false,
      log: [
        { t: '18:58:40', g: '◇', c: '#2563eb', m: 'chat 재시작 접수됨 — 작업 #J-2031' },
        { t: '18:41:02', g: '■', c: '#d33d52', m: 'vdevice 시작 실패 — 로그 보기' }
      ],
      form: this.formDefaults(), step: 1, touched: false, applyAsk: false,
      draft: '', reveal: false
    };
  }
  formDefaults() { return { name: 'leaf-desk-01', port: '7780', level: 'info', auto: true, hosts: ['127.0.0.1', '10.8.0.0/24'] }; }
  componentWillUnmount() { clearInterval(this._jt); clearTimeout(this._ht); clearTimeout(this._at); clearTimeout(this._jt2); }

  now() { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':'); }
  pushLog(g, c, m) { this.setState({ log: [{ t: this.now(), g, c, m }].concat(this.state.log).slice(0, 4) }); }

  ring(phase, pct, R) {
    const L = 2 * Math.PI * R;
    const s = {
      idle:     { c: '#c3cad5', track: '#eef1f5', dash: '0 ' + L, glyph: '', txt: '', spin: '', march: '', name: '대기', state: '대기' },
      accepted: { c: '#2563eb', track: '#e6eefc', dash: '4 4', glyph: '', txt: '', spin: '', march: 'cp-march', name: '접수됨', state: '접수됨' },
      running:  { c: '#2563eb', track: '#e6eefc', dash: (L * pct).toFixed(1) + ' ' + L.toFixed(1), glyph: '', txt: Math.round(pct * 100) + '', spin: '', march: '', name: '진행 중', state: '진행 중 ' + Math.round(pct * 100) + '%' },
      done:     { c: '#1f7a4d', track: '#e3f1e8', dash: L.toFixed(1) + ' 0', glyph: 'M-8 0 L-2.5 5.5 L8.5 -5.5', txt: '', spin: '', march: '', name: '완료', state: '완료' },
      failed:   { c: '#d33d52', track: '#fcf1f2', dash: L.toFixed(1) + ' 0', glyph: 'M-6 -6 L6 6 M6 -6 L-6 6', txt: '', spin: '', march: '', name: '실패', state: '실패' },
      canceled: { c: '#8b95a6', track: '#eef1f5', dash: '2 5', glyph: 'M-6 0 L6 0', txt: '', spin: '', march: '', name: '취소됨', state: '취소됨' }
    }[phase];
    return s;
  }

  runJob() {
    if (this.state.job.phase === 'accepted' || this.state.job.phase === 'running') return;
    clearInterval(this._jt); clearTimeout(this._jt2);
    this.setState({ job: { phase: 'accepted', pct: 0 } });
    this.pushLog('◇', '#2563eb', 'chat 재시작 접수됨 — 작업 #J-2032');
    this._jt2 = setTimeout(() => {
      this.setState({ job: { phase: 'running', pct: 0 } });
      this._jt = setInterval(() => {
        const j = this.state.job;
        if (j.phase !== 'running') { clearInterval(this._jt); return; }
        const fail = this.state.failNext;
        const pct = Math.min(fail ? 0.62 : 1, j.pct + 0.04 + Math.random() * 0.05);
        if ((fail && pct >= 0.62) || pct >= 1) {
          clearInterval(this._jt);
          this.setState({ job: { phase: fail ? 'failed' : 'done', pct } });
          if (fail) this.pushLog('■', '#d33d52', '#J-2032 실패 — chat 시작 시간 초과 · 로그 보기');
          else this.pushLog('●', '#1f7a4d', '#J-2032 완료 — chat 재시작됨 (4.1초)');
        } else this.setState({ job: { phase: 'running', pct } });
      }, 140);
    }, 900);
  }
  cancelJob() {
    const j = this.state.job;
    if (j.phase !== 'accepted' && j.phase !== 'running') return;
    clearInterval(this._jt); clearTimeout(this._jt2);
    this.setState({ job: { phase: 'canceled', pct: j.pct } });
    this.pushLog('–', '#8b95a6', '#J-2032 취소됨 — tasks.by-task-id.cancel.post');
  }

  validate(F) {
    const e = {};
    if (!F.name.trim()) e.name = '비울 수 없습니다';
    else if (/\s/.test(F.name)) e.name = '공백 없이 — 영문·숫자·- 만';
    const p = Number(F.port);
    if (!/^\d+$/.test(F.port)) e.port = '숫자만 입력';
    else if (p < 1024 || p > 65535) e.port = '1024 – 65535 사이여야 합니다';
    return e;
  }

  renderVals() {
    const S = this.state, grant = S.grant;
    const lockIcon = 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z';

    // ── 1. 버튼 5상태
    const tipSet = (id) => () => this.setState({ tip: id });
    const tipOff = () => this.setState({ tip: null });
    const btnDefs = [
      { id: 'ok', text: '모듈 목록', cap: '사용 가능', kind: 'ok' },
      { id: 'lock', text: '모듈 재스캔', cap: grant ? '잠김 → 풀림' : '잠김 · 권한 모자람', kind: grant ? 'ok' : 'lock', tip: 'module.manage 권한 필요 · 관리자에게 요청' },
      { id: 'off', text: '모듈 시작', cap: '비활성 · 조건', kind: 'off', tip: '노드 오프라인 — 연결되면 다시 켜짐' },
      { id: 'danger', text: '롤백', cap: '위험 · 확인 창', kind: grant ? 'danger' : 'dlock', tip: 'module.manage 권한 필요 · 위험 동작' },
      { id: 'hide', text: '카탈로그에 없음', cap: '숨김 · 그리지 않음', kind: 'hide' }
    ];
    const btns = btnDefs.map((b) => {
      const k = b.kind, locked = k === 'lock' || k === 'dlock';
      return {
        text: b.text, cap: b.cap, capGap: 0,
        border: k === 'hide' ? '1px dashed #c3cad5' : k === 'danger' ? '1px solid #d33d52' : k === 'dlock' ? '1px solid #efc2c9' : '1px solid #d8dde5',
        bg: k === 'hide' ? 'transparent' : k === 'off' || locked ? '#f4f6f9' : '#ffffff',
        fg: k === 'hide' ? '#b6bfcc' : k === 'danger' ? '#d33d52' : k === 'dlock' ? '#e3a0aa' : k === 'off' || locked ? '#8b95a6' : '#16191f',
        fw: k === 'danger' || k === 'dlock' ? 600 : 400,
        cursor: k === 'ok' || k === 'danger' ? 'pointer' : 'default',
        dis: k === 'ok' || k === 'danger' ? 'false' : 'true',
        badgeS: locked ? 1 : 0.2, badgeO: locked ? 1 : 0,
        tipOn: S.tip === b.id && !!b.tip && (locked || k === 'off'), tip: b.tip || '',
        enter: tipSet(b.id), leave: tipOff
      };
    });

    // 원형 메뉴 미니
    const icons = {
      list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
      scan: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
      play: 'M6 4l14 8-14 8z',
      undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
      log: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
      stop: 'M6 6h12v12H6z'
    };
    const rmDefs = [
      { k: 'ok', icon: icons.list, hover: true, label: '모듈 목록' },
      { k: grant ? 'ok' : 'lock', icon: icons.scan },
      { k: 'off', icon: icons.play },
      { k: grant ? 'danger' : 'lock', icon: icons.undo },
      { k: 'ok', icon: icons.log },
      { k: grant ? 'ok' : 'lock', icon: icons.stop }
    ];
    const rmItems = rmDefs.map((d, i) => {
      const a = (i * 60 - 90) * Math.PI / 180, on = !!d.hover, R = 70;
      const locked = d.k === 'lock';
      return {
        x: Math.round(118 + Math.cos(a) * R), y: Math.round(118 + Math.sin(a) * R), size: on ? 50 : 44,
        bg: on ? '#2563eb' : locked || d.k === 'off' ? '#f4f6f9' : '#ffffff',
        fg: on ? '#ffffff' : d.k === 'danger' ? '#d33d52' : locked ? '#8b95a6' : d.k === 'off' ? '#b6bfcc' : '#16191f',
        border: on ? '0' : d.k === 'danger' ? '1px solid #d33d52' : '1px solid #d8dde5',
        shadow: on ? '0 4px 14px rgba(37,99,235,0.35)' : '0 2px 8px rgba(22,25,31,0.14)',
        icon: d.icon, badgeBg: '#a65f00', badgeIcon: lockIcon, badgeS: locked ? 1 : 0.2, badgeO: locked ? 1 : 0
      };
    });

    const P = (name, ok, star) => {
      const lockedP = star && !ok;
      return {
        name: name + (star ? ' ★' : ''),
        border: lockedP ? '#f0d9a8' : '#c7d7f5', bg: lockedP ? '#fff7e8' : '#f3f7ff', fg: lockedP ? '#a65f00' : '#2563eb',
        icon: lockedP ? lockIcon : 'M5 12l5 5L20 7'
      };
    };
    const perms = [P('node.read', true), P('node.control', true), P('process.execute', true), P('module.manage', grant, true), P('node.config', false, true), P('core.publish', false, true)];

    // ── 3. 작업 링
    const rings = [
      Object.assign(this.ring('accepted', 0, 26), { say: '작업 id를 받음 · 줄이 흐른다' }),
      Object.assign(this.ring('running', 0.42, 26), { say: '진행률이 오면 호로, 없으면 도는 호' }),
      Object.assign(this.ring('done', 1, 26), { say: '초록 원 · 알림 줄에 남김' }),
      Object.assign(this.ring('failed', 1, 26), { say: '빨간 원 · 로그로 이어짐' }),
      Object.assign(this.ring('canceled', 0, 26), { say: '회색 점선 · 멈춘 자리 유지' })
    ];
    const J = S.job, jr = this.ring(J.phase, J.pct, 30);
    const job = Object.assign({}, jr, {
      say: {
        idle: '실행하면 접수 → 진행 → 완료/실패 순으로 링이 바뀐다',
        accepted: 'Daemon이 Task를 만들었다 — 아직 시작 전',
        running: 'tasks.by-task-id.get 폴링 · 1초마다',
        done: '끝난 작업은 알림 줄에 한 줄로 남는다',
        failed: '실패 사유와 로그 보기 링크를 같이 남긴다',
        canceled: '취소도 작업 — 취소 요청이 접수되면 회색'
      }[J.phase],
      runLabel: J.phase === 'accepted' || J.phase === 'running' ? '진행 중…' : J.phase === 'idle' ? '실행해 보기' : '다시 실행',
      cancelDisp: J.phase === 'accepted' || J.phase === 'running' ? 'block' : 'none'
    });
    const chip = (ph, pct, id, t) => { const r = this.ring(ph, pct, 6); return { c: r.c, track: r.track, dash: r.dash, march: r.march, id, t }; };
    const chips = [chip('accepted', 0, '#J-2031', '접수됨'), chip('running', 0.66, '#J-2029', '66%'), chip('done', 1, '#J-2027', '완료'), chip('failed', 1, '#J-2024', '실패')];

    // ── 2. 확인 창
    const dRows = (target, change, undoOk, undo) => [
      { k: '대상', g: '', gc: '', v: target },
      { k: '바뀌는 것', g: '', gc: '', v: change },
      { k: '되돌리기', g: undoOk ? '●' : '■', gc: undoOk ? '#1f7a4d' : '#d33d52', v: undo },
      { k: '응답', g: '◇', gc: '#2563eb', v: '작업 접수 → 진행 링' }
    ];
    const H = S.hold;
    const dialogs = [
      { mode: '확인 한 번', when: '위험 · 되돌릴 수 있음', title: 'agent 모듈 정지', action: '정지', iconBg: '#a65f00', isA: true, isB: false, isC: false,
        rows: dRows('agent 1.4.2 · leaf-desk-01', '멈춘 동안 이 모듈의 화면과 명령이 메뉴에서 빠짐', true, '가능 — 다시 시작하면 됨'),
        boxH: 292, delay: '0ms', accepted: S.acceptedA,
        go: () => { this.setState({ acceptedA: true }); clearTimeout(this._at); this._at = setTimeout(() => this.setState({ acceptedA: false }), 1800); } },
      { mode: '이름 입력', when: '위험 · 되돌리기 어려움', title: 'agent 롤백', action: '롤백', iconBg: '#d33d52', isA: false, isB: true, isC: false,
        rows: dRows('agent 1.4.2 → 1.3.9', '재시작 동안 화면·명령이 잠시 빠짐', true, '가능 — 1.4.2로 다시 올릴 수 있음'),
        boxH: 372, delay: '80ms' },
      { mode: '누르고 있기', when: '위험 · 되돌릴 수 없음', title: 'WireGuard 키 교체', action: '교체', iconBg: '#d33d52', isA: false, isB: false, isC: true,
        rows: dRows('wg0 · leaf-desk-01', '기존 키로 맺은 peer 연결이 모두 끊김', false, '불가 — 이전 키는 지워짐'),
        boxH: 318, delay: '160ms' }
    ];
    const typedOk = S.typed === 'agent';

    // ── 4. 빈 상태
    const E = (o) => Object.assign({ lineStyle: 'solid', line: '#eef1f5', bg: '#ffffff', hexFill: 'none', hexDash: '0', btnDisp: 'inline-block', btnFg: '#16191f' }, o);
    const empties = [
      E({ title: '비어 있음', code: '200 · 0건', c: '#8b95a6', hexDash: '4 4', lineStyle: 'dashed', line: '#d8dde5', icon: 'M12 5v14M5 12h14', say: '아직 열린 터널이 없습니다', btn: '터널 열기', btnFg: '#2563eb' }),
      E({ title: '모듈 내려감', code: '503 · io.terra.file', c: '#a65f00', hexFill: '#fff7e8', icon: 'M12 7v6M12 17h.01', say: '파일 모듈이 멈춰 있어 목록을 못 읽습니다', btn: '모듈 시작' }),
      E({ title: '이 노드엔 없음', code: '501 · 파일 경계 없음', c: '#8b95a6', icon: 'M5 5l14 14M9 4h10v10M5 9v10h10', say: '파일 경계 없이 조립된 노드 — 여기선 쓸 수 없는 기능', btnDisp: 'none' }),
      E({ title: 'Master 연결 없음', code: 'upstream 없음', c: '#8b95a6', hexFill: '#f4f6f9', icon: 'M4 4l16 16M9 5.5A9 9 0 0 1 21 9M3 9a9 9 0 0 1 3-2M7 13a5 5 0 0 1 3-1.5M17 13a5 5 0 0 0-1.5-1M12 18h.01', say: '노드 요약은 Master를 거쳐 옵니다 — 이 장치만 보입니다', btn: '다시 연결' }),
      E({ title: '권한 없음', code: 'node.config ★', c: '#a65f00', hexFill: '#fff7e8', icon: lockIcon, say: '설정을 바꾸려면 node.config 권한이 필요합니다', btn: '권한 요청 방법' }),
      E({ title: '불러오지 못함', code: '네트워크 · 18:59:04', c: '#d33d52', hexFill: '#fcf1f2', icon: 'M12 7v6M12 17h.01', say: '직전 값은 흐리게 두고, 다시 시도를 붙인다', btn: '다시 시도' })
    ];

    // ── 5. 자동 폼
    const F = S.form, D = this.formDefaults(), err = S.touched ? this.validate(F) : {};
    const liveErr = this.validate(F);
    const setF = (k, v) => this.setState({ form: Object.assign({}, this.state.form, { [k]: v }), step: 1, applyAsk: false });
    const changed = (k) => JSON.stringify(F[k]) !== JSON.stringify(D[k]);
    const bar = (k) => err[k] ? '#d33d52' : changed(k) ? '#2563eb' : 'transparent';
    const nChanged = ['name', 'port', 'level', 'auto', 'hosts'].filter(changed).length;
    const nErr = Object.keys(liveErr).length;
    const step = S.step;
    const stepNames = ['편집', '검증', '저장', '적용'];
    const f = {
      changedTxt: nChanged ? '● ' + nChanged + '칸 바뀜 · 아직 저장 안 됨' : step >= 3 ? '저장됨' : '바뀐 칸 없음',
      changedC: nChanged && step < 3 ? '#2563eb' : '#5b6472',
      name: { v: F.name, set: (e) => setF('name', e.target.value), bar: bar('name'), border: err.name ? '#d33d52' : '#c3cad5',
        msg: err.name || '노드 목록과 필드 타일에 보이는 이름', msgC: err.name ? '#d33d52' : '#5b6472' },
      port: { v: F.port, set: (e) => setF('port', e.target.value.replace(/[^\d]/g, '')), bar: bar('port'), border: err.port ? '#d33d52' : '#c3cad5',
        dec: () => setF('port', String(Math.max(0, (Number(this.state.form.port) || 0) - 1))),
        inc: () => setF('port', String((Number(this.state.form.port) || 0) + 1)),
        reset: () => setF('port', D.port), resetDisp: changed('port') ? 'inline-block' : 'none',
        msg: err.port || (changed('port') ? '바뀜 — 저장 전까지 이 폼에만 있음' : 'integer · 기본값 7780'), msgC: err.port ? '#d33d52' : changed('port') ? '#2563eb' : '#5b6472' },
      level: { bar: bar('level'), opts: ['debug', 'info', 'warn', 'error'].map((v) => ({ v, on: F.level === v ? 'true' : 'false', bg: F.level === v ? '#ffffff' : 'transparent', fg: F.level === v ? '#16191f' : '#5b6472', fw: F.level === v ? 600 : 400, sh: F.level === v ? '0 1px 3px rgba(22,25,31,0.14)' : 'none', pick: () => setF('level', v) })) },
      auto: { bar: bar('auto'), on: F.auto ? 'true' : 'false', bg: F.auto ? '#2563eb' : '#c3cad5', x: F.auto ? 21 : 3, txt: F.auto ? '켜짐 — 끊기면 15초마다 다시 붙음' : '꺼짐', toggle: () => setF('auto', !this.state.form.auto) },
      hosts: { bar: bar('hosts'), items: F.hosts.map((v, i) => ({ v, rm: () => setF('hosts', this.state.form.hosts.filter((_, j) => j !== i)) })),
        draft: S.draft, setDraft: (e) => this.setState({ draft: e.target.value }),
        key: (e) => { if (e.key === 'Enter' && this.state.draft.trim()) { e.preventDefault(); const v = this.state.draft.trim(); this.setState({ draft: '' }); setF('hosts', this.state.form.hosts.concat([v])); } } },
      secret: { v: S.reveal ? 'tre_9f2c…a71d' : '••••••••••••', ls: S.reveal ? '0' : '0.1em', btn: S.reveal ? '가리기' : '보기', toggle: () => this.setState({ reveal: !this.state.reveal }) },
      steps: stepNames.map((label, i) => {
        const n = i + 1, done = n < step || (n === step && n > 1), cur = n === step;
        return { n: done && !cur ? '✓' : String(n), label, fg: cur ? '#16191f' : done ? '#1f7a4d' : '#8b95a6', fw: cur ? 600 : 400,
          dotBg: cur ? '#16191f' : done ? '#e3f1e8' : '#ffffff', dotFg: cur ? '#ffffff' : done ? '#1f7a4d' : '#8b95a6', dotLine: cur ? '#16191f' : done ? '#bfe0cb' : '#c3cad5', sepDisp: i < 3 ? 'inline' : 'none' };
      }),
      revert: () => this.setState({ form: this.formDefaults(), touched: false, step: 1, applyAsk: false, draft: '' }),
      validate: () => this.setState({ touched: true, step: nErr ? 1 : 2 }),
      saveOp: step >= 2 && step < 3 ? 1 : 0.45, saveDis: step === 2 ? 'false' : 'true',
      save: () => { if (this.state.step === 2) this.setState({ step: 3 }); },
      applyOp: step === 3 ? 1 : 0.45, applyDis: step === 3 ? 'false' : 'true',
      apply: () => { if (this.state.step === 3) this.setState({ applyAsk: true }); },
      applyAsk: S.applyAsk,
      applyNo: () => this.setState({ applyAsk: false }),
      applyYes: () => this.setState({ applyAsk: false, step: 4 })
    };
    if (step === 4) { f.changedTxt = '● 적용됨 — 런타임 반영'; f.changedC = '#1f7a4d'; }

    return {
      swatches: [
        { n: '글자', c: '#16191f' }, { n: '보조', c: '#5b6472' }, { n: '선', c: '#d8dde5' },
        { n: '강조', c: '#2563eb' }, { n: '잠김', c: '#a65f00' }, { n: '위험', c: '#d33d52' }, { n: '완료', c: '#1f7a4d' }
      ],
      grantLabel: grant ? '있음' : '없음 (눌러서 받기)', grantBg: grant ? '#f3f7ff' : '#fff7e8', grantBorder: grant ? '#c7d7f5' : '#f0d9a8', grantFg: grant ? '#2563eb' : '#a65f00', grantDot: grant ? '#2563eb' : '#a65f00',
      toggleGrant: () => this.setState({ grant: !this.state.grant, tip: null }),
      btns, rmItems, rmLabel: grant ? '모듈 목록 · 재스캔·롤백 열림' : '모듈 목록 · 자물쇠 3개는 module.manage',
      perms,
      lockRules: [
        { k: '숨김', c: '#8b95a6', v: '카탈로그에 operation이 없음 — 자리도 남기지 않는다' },
        { k: '잠김', c: '#a65f00', v: '있지만 권한 모자람(★) — 호박색 자물쇠 + 필요한 권한 이름' },
        { k: '비활성', c: '#8b95a6', v: '권한은 있지만 지금은 못 함 — 흐린 글자 + 이유 한 줄' },
        { k: '위험', c: '#d33d52', v: '빨간 테두리 — 누르면 2번 확인 창' }
      ],
      rings, job, chips, log: S.log,
      runJob: () => this.runJob(), cancelJob: () => this.cancelJob(),
      toggleFail: () => this.setState({ failNext: !this.state.failNext }),
      failLabel: S.failNext ? '결과: 실패로' : '결과: 성공으로', failFg: S.failNext ? '#d33d52' : '#1f7a4d',

      dialogs, popClass: S.popKey % 2 ? 'cp-pop' : 'cp-pop ',
      replayPop: () => {
        const els = document.querySelectorAll('[role=dialog].cp-pop');
        els.forEach((el) => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
      },
      typed: S.typed, setTyped: (e) => this.setState({ typed: e.target.value }),
      typedBorder: typedOk ? '#1f7a4d' : '#c3cad5', typedOp: typedOk ? 1 : 0.45, typedDis: typedOk ? 'false' : 'true', typedCursor: typedOk ? 'pointer' : 'default',
      holdDown: () => { if (this.state.hold === 'done') { this.setState({ hold: 'idle' }); return; } this.setState({ hold: 'holding' }); clearTimeout(this._ht); this._ht = setTimeout(() => this.setState({ hold: 'done' }), 1200); },
      holdUp: () => { if (this.state.hold === 'holding') { clearTimeout(this._ht); this.setState({ hold: 'idle' }); } },
      holdW: H === 'idle' ? '0%' : '100%', holdTrans: H === 'holding' ? 'width 1200ms linear' : H === 'done' ? 'none' : 'width 200ms ease-out',
      holdFg: H === 'idle' ? '#d33d52' : '#ffffff', holdText: H === 'done' ? '교체 접수됨 — 다시 누르면 처음으로' : H === 'holding' ? '계속 누르고 있기…' : '누르고 있으면 교체 (1.2초)',
      confirmRules: [
        { k: '대상', v: '무엇을 · 어느 노드에서 — 버전이 바뀌면 전→후' },
        { k: '바뀌는 것', v: '누르면 사용자가 바로 느끼는 결과 한 줄' },
        { k: '되돌리기', v: '● 가능 / ■ 불가 — 불가면 확인이 한 단계 무거워짐' },
        { k: '응답', v: '즉시 / ◇ 작업 — 작업이면 3번 진행 링으로 넘어감' }
      ],

      empties, f,
      schemaMap: [
        { k: 'string', v: '입력칸 — pattern이 있으면 즉시 검사' },
        { k: 'integer · min/max', v: '− 숫자 + 단계 버튼, 범위를 옆에' },
        { k: 'enum (≤ 4)', v: '세그먼트 — 5개 이상이면 선택 목록' },
        { k: 'boolean', v: '스위치 + 지금 뜻 한 줄' },
        { k: 'array<string>', v: '태그 — Enter로 더하고 ×로 뺌' },
        { k: 'writeOnly · secret', v: '가림 · 보기 · 새로 쓰기(값은 되읽지 않음)' },
        { k: 'object', v: '묶음 테두리 + 키 이름' },
        { k: 'readOnly', v: '점선 칸 · 누가 정하는지 적음' },
        { k: 'default · example', v: '바뀌면 “기본값으로” 링크' }
      ],
      marks: [
        { k: '변경됨', c: '#2563eb', v: '왼쪽 파란 막대' },
        { k: '오류', c: '#d33d52', v: '빨간 막대 + 테두리 + 이유' },
        { k: '필수', c: '#d33d52', v: '이름 옆 *' },
        { k: '읽기 전용', c: '#c3cad5', v: '점선 칸' },
        { k: '잠김', c: '#a65f00', v: '자물쇠 배지 (1번)' },
        { k: '위험 적용', c: '#d33d52', v: '빨간 테두리 버튼 → 확인 줄' }
      ]
    };
  }
}
