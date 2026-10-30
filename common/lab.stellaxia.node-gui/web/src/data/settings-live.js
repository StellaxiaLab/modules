// 설정 보드의 실데이터 층 — 예시 노드(edge-01)의 런타임 값 · 기준선 차이 · 계정 · 위임 자격 · 로컬 자원 · 클러스터 사용자를 지우고
// 이 노드의 게이트웨이에서 읽은 값만 보인다.
//
// 보드(src/screens/settings.js)는 디자인 캔버스에서 생성된다. 고치지 않고 이어받는다.
//   키 표(GROUPS 135키)  Daemon 설정 스키마를 옮긴 자산이다 — 실제 terra.daemon.config.schema.get 과 키 · 소유 · 반영이 같다.
//                       읽으면 소유 · 반영을 스키마 값으로 다시 맞춘다(어긋나도 실제가 이긴다).
//   값               terra.daemon.config.get (중첩 → 점 키). 기준선 차이는 그 응답의 deviations[]
//   저장             terra.daemon.config.patch { set, save: true } — 키 하나씩, 켜기 키는 마지막(화면의 order)
//   계정             terra.gateway.agent.whoami.get · 로그아웃은 셸(terra.emit('logout'))
//   로컬 자원         files.list · svi.declarations · io.devices · modules.offers (Daemon)
//   클러스터 · 서버    Master 의 것 — 이 화면의 토큰은 닿지 않는다
//   Terra ID         Master admin.external-issuers.* (클러스터 탭 · master_admin) · users.by-user-id.external-identities.* (계정 탭) — terra-id.js

import { connectLive, absenceText } from './live-host.js';
import { resultText } from '../api/client.js';
import { roleOf } from './network-live.js';
import { invokeIfModule, MODULE_OF } from '../api/module-gate.js';
import { userIdOf } from '../api/link-apply.js';
import { TERRA_ID_OPS as TID, EXCHANGE_PATH, TRUST_EMPTY_TEXT, issuersView, identitiesView, linkStatusTag, externalErrorText, issuerAddBody, tokenPeek, audIsTree } from './terra-id.js';

const D = (op) => 'terra.daemon.' + op;
const ok = (r) => r && r.kind === 'ok';
const OWN = { operator: '운영자', installer: '설치기', derived: '파생', secret: '비밀' };

/** 목록 한 칸 → 글. 객체 칸(공유 폴더 { name, path } 등)은 이름=경로 */
const itemText = (x) => (x && typeof x === 'object' ? (x.name != null && x.path != null ? x.name + '=' + x.path : JSON.stringify(x)) : String(x));

/** 중첩 설정 → 점 키. 목록은 쉼표로 잇는다(화면의 입력 칸 모양). objects 에는 객체 목록인 키를 모은다 */
export function flatten(obj, prefix = '', out = {}, objects = null) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out, objects);
    else {
      out[key] = Array.isArray(v) ? v.map(itemText).join(', ') : v;
      if (objects && Array.isArray(v) && v.some((x) => x && typeof x === 'object')) objects.add(key);
    }
  }
  return out;
}

/** 화면 값 → PATCH 값. 타입은 스키마의 것 */
export function toWire(type, v) {
  if (type === 'bool' || type === '켜기/끄기') return v === true || v === 'true';
  if (type === 'int' || type === '정수') return Number(v);
  if (type === 'string_list' || type === '목록') return String(v).split(',').map((x) => x.trim()).filter(Boolean);
  return String(v == null ? '' : v);
}

/** 이 기계의 등록 상태(O-6) — Daemon enrollment.status.get 응답을 화면 값으로. 못 받으면(tree만 · 길 없음) 말없이 '없음' (maingui boot/service.js loadEnrollment 와 같다) */
export function enrollmentState(r) {
  if (!r || r.kind !== 'ok' || !r.data) return { state: 'none' };
  const d = r.data, at = d.registered_at ? new Date(d.registered_at) : null, p2 = (n) => String(n).padStart(2, '0');
  const f = d.fleet && (d.fleet.fleet_id || d.fleet.slot_id) ? [d.fleet.fleet_id, d.fleet.slot_id].filter(Boolean).join(' · ') : '';
  return { state: 'ok', registered: !!d.registered, nodeId: d.node_id || '', deviceId: d.device_id || '', masterUrl: d.master_url || '',
    registeredAt: at && !isNaN(at) ? at.getFullYear() + '-' + p2(at.getMonth() + 1) + '-' + p2(at.getDate()) + ' ' + p2(at.getHours()) + ':' + p2(at.getMinutes()) : '',
    credentialReady: !!d.credential_ready, fleet: f };
}

export function realSettings(Screen) {
  return class RealSettings extends Screen {
    constructor(props) {
      super(props);
      // 예시 런타임 값 · 기준선 차이 · 위임 자격을 지운다. 값은 config.get 이 채운다
      this.DEV = {};
      const cur = {};
      Object.keys(this.KEY).forEach((k) => { cur[k] = this.KEY[k].type === '켜기/끄기' ? false : ''; });
      Object.assign(this.state, {
        role: null, perm: false, demo: 'ok', cur, draft: {}, pending: {}, errors: {}, grants: [],
        users: [], me: '', usersState: 'error', uf: null, enrSt: { state: 'none' },
        live: null, why: null, loading: true, loadErr: '', nodeName: '', principal: '', who: null, configPath: '', schemaN: null, operatorN: null,
        res: { roots: null, decls: null, envelope: null, devices: null, offers: null, errs: {} },
        // Terra ID — 보기 모델(terra-id.js) · 열린 폼. null = 아직 안 읽음
        tidIss: null, tidLinks: null, tidUser: '', tidAf: null, tidLf: null
      });
    }

    componentDidMount() {
      super.componentDidMount();
      this._offLive = connectLive((live, why) => this.onLive(live, why));
    }

    componentWillUnmount() {
      super.componentWillUnmount();
      if (this._offLive) this._offLive();
    }

    onLive(live, why) {
      this.__live = live;
      if (!live) {
        this.DEV = {};
        this.setState({ live: false, why, loading: false, users: [], me: '', usersState: 'error', enrSt: { state: 'none' }, role: null, perm: false, who: null, principal: '', nodeName: '', draft: {}, pending: {}, errors: {},
          tidIss: null, tidLinks: null, tidUser: '', tidAf: null, tidLf: null });
        return;
      }
      const role = roleOf(live.client.catalog);
      this.setState({ live: true, why: null, loading: true, role, perm: (live.permissions || []).indexOf('node.config') >= 0, principal: live.principal || '',
        tab: role === 'leaf' ? this.state.tab : (['node', 'res'].indexOf(this.state.tab) >= 0 ? 'account' : this.state.tab) });
      void this.load();
    }

    /** 사용자 관리(M-1)는 Master operation(terra.master.admin.users.*)이다 — 앱 토큰은 Master에 닿지 않는다(Q-2 · PF-1). 화면 안에서만 바꾸는 예시 동작을 쓰지 않는다 */
    async userApi() { return { ok: false, msg: 'Master operation — 이 화면(앱 토큰)에서는 닿지 않는다. 사용자 관리는 tree의 관리 화면에서 한다' }; }

    can(p) { const L = this.__live; return !!L && (L.permissions || []).indexOf(p) >= 0; }

    /**
     * Daemon 재시작 — 원본의 두 번 누르기(restartDaemon)가 부른다. terra.daemon.restart.post 202 뒤 Daemon 은 정상 종료하고
     * 서비스 관리자(systemd · 작업 스케줄러 · launchd)가 다시 띄운다. 관리자가 없으면 501 RESTART_UNSUPPORTED.
     * Daemon 이 다시 띄운 게이트웨이는 앞 앱 토큰을 모른다 — 돌아오면 셸에서 다시 로그인한다.
     * 돌아오는 것은 공개 경로 /api/v1/health 로 본다(토큰 없이 답한다)
     */
    async doRestart() {
      const L = this.__live;
      if (!L) return { ok: false, msg: 'Terra에 연결되지 않았다' };
      const r = await L.client.invoke(D('restart.post'), {});
      if (r.kind !== 'ok' && r.kind !== 'accepted') {
        return { ok: false, msg: r.reason === 'RESTART_UNSUPPORTED' || r.status === 501 ? '다시 띄울 서비스 관리자가 없다 — 그 기기에서 Daemon을 손으로 다시 띄운다' : resultText(r) };
      }
      const t0 = Date.now();
      let gone = false;
      while (Date.now() - t0 < 90000) {
        await new Promise((done) => setTimeout(done, 1500));
        const h = await L.client.get('/api/v1/health');
        if (h.kind !== 'ok') gone = true;
        else if (gone || Date.now() - t0 > 8000) return { ok: true };   // 내려갔다 돌아왔다 · 너무 빨라 내려간 것을 못 봤다
      }
      return { ok: false, msg: '90초 안에 돌아오지 않았다 — 그 기기의 서비스 상태를 본다' };
    }

    /** 이 노드에서 읽을 수 있는 것을 모두 다시 읽는다 */
    async load() {
      const L = this.__live;
      if (!L) return;
      const c = L.client, leaf = this.state.role === 'leaf';
      const none = Promise.resolve(null);
      const [who, node, cfg, schema, roots, decls, devs, offers, enr] = await Promise.all([
        c.get('/api/v1/agent/whoami'),   // 경로로 — invoke 로는 호출자가 빠진다(client.get)
        leaf ? c.invoke(D('node.get'), {}) : none,
        leaf ? c.invoke(D('config.get'), {}) : none,
        leaf ? c.invoke(D('config.schema.get'), {}) : none,
        leaf ? invokeIfModule(c, MODULE_OF['terra.daemon.files.list.get'], D('files.list.get'), {}) : none,
        leaf ? c.invoke(D('svi.declarations.get'), {}) : none,
        leaf ? invokeIfModule(c, MODULE_OF['terra.daemon.io.devices.get'], D('io.devices.get'), {}) : none,
        leaf ? c.invoke(D('modules.offers.get'), {}) : none,
        leaf ? c.invoke(D('enrollment.status.get'), {}) : none
      ]);
      if (this.__live !== L) return;
      const patch = { loading: false };
      patch.enrSt = enrollmentState(enr);
      if (ok(who) && who.data) patch.who = who.data;
      if (ok(node) && node.data) patch.nodeName = node.data.device_name || node.data.node_id || '';
      if (ok(schema) && schema.data && schema.data.fields) {
        const f = schema.data.fields, keys = Object.keys(f);
        keys.forEach((k) => { const K = this.KEY[k]; if (K) { K.owner = OWN[f[k].owner] || K.owner; K.apply = f[k].restart_required ? '재시작' : '즉시'; } });
        patch.schemaN = keys.length;
        patch.operatorN = keys.filter((k) => f[k].owner === 'operator').length;
      }
      if (ok(cfg) && cfg.data && cfg.data.config) {
        this._objKeys = new Set();
        const flat = flatten(cfg.data.config, '', {}, this._objKeys), cur = {};
        Object.keys(this.KEY).forEach((k) => {
          const v = flat[k];
          cur[k] = this.KEY[k].type === '켜기/끄기' ? v === true : v == null ? '' : String(v);
        });
        patch.cur = cur;
        patch.configPath = cfg.data.config_path || '';
        this.DEV = {};
        (Array.isArray(cfg.data.deviations) ? cfg.data.deviations : []).forEach((d) => { if (d && d.key && this.KEY[d.key]) this.DEV[d.key] = Array.isArray(d.baseline) ? d.baseline.join(', ') : String(d.baseline); });
        patch.loadErr = '';
      } else if (leaf) patch.loadErr = cfg ? resultText(cfg) : '응답 없음';
      const errs = {};
      const take = (r, name, key) => { if (!r) return null; if (ok(r) && r.data) return r.data[key] || []; errs[name] = resultText(r); return null; };
      patch.res = { roots: take(roots, 'roots', 'roots'), decls: take(decls, 'decls', 'declarations'), envelope: ok(decls) && decls.data ? decls.data.envelope || null : null,
        devices: take(devs, 'devices', 'devices'), offers: take(offers, 'offers', 'offers'), errs };
      this.setState(patch);
      void this.loadTerraId(patch.who);
    }

    // 객체 목록 키(공유 폴더 { name, path } 등)는 입력 칸 하나로 고칠 수 없다 — 읽기만
    keyRow(k) {
      const r = super.keyRow(k);
      if (!this._objKeys || !this._objKeys.has(k)) return r;
      return Object.assign(r, { isToggle: false, isSelect: false, isInput: false, isMulti: false, isRO: true, val: String(this.val(k)) || '(비어 있음)',
        roIcon: '▤', roTip: '항목이 객체인 목록', sub: '객체 목록 — 설정 파일에서 고친다', subDisp: 'inline', subFg: '#8b95a6', actDisp: 'none' });
    }

    // 저장 — 화면의 검사 · 위험 확인은 그대로, 보내기만 진짜 PATCH 로
    save(force) {
      const S = this.state, keys = Object.keys(S.draft), E = this.check(), L = this.__live;
      if (!L) return;
      if (Object.keys(E).length) { this.setState({ errors: E }); this.toast('■', '#ff6b81', '저장하지 않았습니다 — 초안 검사 ' + Object.keys(E).length + '건', '키 옆의 빨간 문장을 고치세요. 최종 판정은 데몬이 합니다(PATCH 400).'); return; }
      const danger = keys.filter((k) => this.DANGER[k] && (this.DANGER[k][0] === null || this.DANGER[k][0] === S.draft[k]));
      if (danger.length && !force) {
        this.setState({ dlg: { title: '저장 시 현재 화면의 접속 경로가 끊길 수 있습니다', op: 'terra.daemon.config.patch · save: true', rows: danger.map((k) => [k, String(S.draft[k])]), warn: danger.map((k) => this.DANGER[k][1]).join(' '), okLabel: '그래도 저장', ok: () => this.save(true) } });
        return;
      }
      const ord = this.order(keys);
      this.setState({ saving: true, errors: {} });
      void (async () => {
        const pending = Object.assign({}, this.state.pending), now = [], done = [];
        let fail = null;
        for (const k of ord) {
          const r = await L.client.invoke(D('config.patch'), { set: { [k]: toWire(this.KEY[k].type, S.draft[k]) }, save: true });
          if (!ok(r)) { fail = { k, r }; break; }
          done.push(k);
          if (r.data && r.data.restart_required) pending[k] = { from: S.cur[k], to: S.draft[k] }; else now.push(k);
        }
        const draft = Object.assign({}, this.state.draft);
        done.forEach((k) => { delete draft[k]; });
        this.setState({ saving: false, pending, draft, errors: fail ? { [fail.k]: resultText(fail.r) } : {} });
        if (fail) this.toast('■', '#ff6b81', fail.k + ' 저장 실패', resultText(fail.r) + (done.length ? ' · 앞의 ' + done.length + '키는 저장됨' : ''));
        else this.toast('●', '#4ade80', '저장됨 — PATCH ' + done.length + '번 (save: true)', (now.length ? '즉시 반영: ' + now.join(', ') + '. ' : '') + (done.length - now.length ? '재시작 대기 ' + (done.length - now.length) + '키' : ''));
        void this.load();
      })();
    }

    // 로컬 자원 탭의 동작 — 장치 승인 · 모듈 동의
    act(op, input, label) {
      const L = this.__live;
      if (!L) return;
      void L.client.invoke(op, input).then((r) => {
        const good = r.kind === 'ok' || r.kind === 'accepted';
        this.toast(good ? '●' : '■', good ? '#4ade80' : '#ff6b81', label + (good ? '' : ' — 실패'), good ? op : resultText(r));
        void this.load();
      });
    }

    resCards() {
      const S = this.state, R = S.res, ctl = this.can('node.control'), why = ctl ? '' : 'node.control 권한이 없다';
      const err = (k) => (R.errs && R.errs[k] ? [this.row('읽지 못함', R.errs[k], '', { vc: '#b4283c' })] : []);
      const roots = R.roots || [], decls = R.decls || [], devs = R.devices || [], offers = R.offers || [];
      return [
        this.card({ span: 6, title: '공유 폴더', sub: 'files.list.get — 이 노드가 io.terra.file에 연 루트 · 설정 키 storage.shared_dirs', acts: [this.btn('로컬 노드 › 저장소에서 보기', () => this.setState({ tab: 'node', group: 0, q: '' }))],
          rows: err('roots').concat(roots.length ? roots.map((r) => this.row(r.name, r.path || '', '', { tmono: true })) : R.roots ? [this.row('없음', '공유 폴더가 없다 — modules.shared_roots', '', { vc: '#8b95a6' })] : []) }),
        this.card({ span: 6, title: 'SVI 자원 선언', sub: 'svi.declarations.get' + (R.envelope ? ' · 울타리 process ' + R.envelope.process + ' · 상한 ' + R.envelope.max_declarations : ''),
          rows: err('decls').concat(decls.length ? decls.map((x) => this.row(x.family + '/' + x.name, x.direction + ' · ' + (x.origin === 'file' ? '설정 파일' : '런타임') + (x.reason ? ' · ' + x.reason : ''), x.state, { mono: true, badges: [this.tag(x.state, x.state === 'applied' ? 'ok' : x.state === 'shadowed' ? 'warn' : 'bad')] }))
            : R.decls ? [this.row('없음', '선언된 자원이 없다 — 바꾸기는 node.config★(조타륜 › 자원 선언)', '', { vc: '#8b95a6' })] : []) }),
        this.card({ span: 7, title: 'I/O 장치', sub: 'io.devices.* · io.terra.io-inventory 모듈이 없으면 503',
          rows: err('devices').concat(devs.length ? devs.map((d) => {
            const btns = d.approval === 'pending' ? [this.btn('승인', () => this.act(D('io.devices.by-device-id.approve.post'), { device_id: d.id }, d.name + ' 승인'), { dis: !ctl, tip: why }), this.btn('거부', () => this.act(D('io.devices.by-device-id.deny.post'), { device_id: d.id }, d.name + ' 거부'), { danger: true, dis: !ctl, tip: why })]
              : d.approval === 'approved' ? [d.enabled ? this.btn('끄기', () => this.act(D('io.devices.by-device-id.disable.post'), { device_id: d.id }, d.name + ' 끔'), { dis: !ctl, tip: why }) : this.btn('켜기', () => this.act(D('io.devices.by-device-id.enable.post'), { device_id: d.id }, d.name + ' 켬'), { dis: !ctl, tip: why })]
              : [this.btn('승인', () => this.act(D('io.devices.by-device-id.approve.post'), { device_id: d.id }, d.name + ' 승인'), { dis: !ctl, tip: why })];
            return this.row(d.alias || d.name || d.id, d.kind + ' · ' + d.presence + ' · ' + d.approval, d.enabled ? 'enabled' : 'disabled', { badges: [this.tag(d.approval, d.approval === 'approved' ? 'ok' : d.approval === 'denied' ? 'bad' : 'info')], btns });
          }) : R.devices ? [this.row('없음', '보이는 장치가 없다', '', { vc: '#8b95a6' })] : []) }),
        this.card({ span: 5, title: '모듈 설치 동의', sub: 'modules.offers.* — Tree가 제안한 모듈',
          rows: err('offers').concat(offers.length ? offers.map((o) => {
            // state: offered · accepted · stale(새 버전이 더 많은 권한을 원한다) · managed(노드 관리자가 고정) · pinned(이미지가 고정)
            const id = o.module_id, st = o.state || 'offered', tone = { accepted: 'ok', offered: 'info', stale: 'warn', managed: 'off', pinned: 'off' }[st] || 'off';
            const btns = st === 'accepted' ? [this.btn('철회', () => this.act(D('modules.offers.by-module-id.withdraw.post'), { module_id: id }, id + ' 동의 철회'), { danger: true, dis: !ctl, tip: why })]
              : st === 'offered' || st === 'stale' ? [this.btn('동의', () => this.act(D('modules.offers.by-module-id.consent.post'), { module_id: id }, id + ' 동의'), { dis: !ctl, tip: why })] : [];
            const note = [o.version ? 'v' + o.version : '', o.policy || '', o.added && o.added.length ? '더 원하는 권한 ' + o.added.join(' · ') : '', o.pinned_by ? '고정: ' + o.pinned_by : ''].filter(Boolean).join(' · ');
            return this.row(id, note, st, { mono: true, tmono: true, badges: [this.tag(st, tone)], btns });
          }) : R.offers ? [this.row('없음', 'Tree가 제안한 모듈이 없다', '', { vc: '#8b95a6' })] : []) }),
        this.card({ span: 12, text: 'WireGuard 관리형 키 · 설정은 설정이라기보다 동작(위험 · 확인 필요)이라 네트워크 화면의 "로컬 WireGuard"에 둡니다. SVI의 목록형 선언과 런타임 상한(svi.runtime)은 스키마 밖 — 파일로만 편집합니다.' })
      ];
    }

    accountCards() {
      const S = this.state, W = S.who || {}, L = this.__live;
      const perms = Array.isArray(W.permissions) ? W.permissions : (L && L.permissions) || [];
      const logout = L && L.terra && L.terra.emit ? () => L.terra.emit('logout') : null;
      return [
        this.card({ span: 7, title: '세션 정보', sub: 'whoami — 이 화면이 받은 토큰이 실제로 쥔 것', acts: logout ? [this.btn('로그아웃', logout, { danger: true, tip: '셸이 로그아웃한다 (terra.emit logout)' })] : [], rows: [
          this.row(S.principal || W.principal || '—', 'principal' + (W.principal && W.principal !== S.principal ? ' · ' + W.principal : '') + (W.delegate ? ' · 위임 앱 ' + W.delegate : ''), W.expiresAt ? '화면 토큰 만료 ' + W.expiresAt.slice(11, 16) + ' UTC' : '', { tmono: true, mono: true }),
          this.row('권한', perms.join(' · ') || '없음', perms.length + '개', { mono: true, badges: perms.indexOf('node.config') >= 0 ? [this.tag('node.config★ 있음', 'ok')] : [this.tag('node.config★ 없음', 'warn', 'Daemon 설정 쓰기는 권한 목록에 명시해야 열린다 — 사용자 권한 ∩ 이 앱이 선언한 권한')] }),
          this.row('reach', '현재 세션이 닿는 노드', W.reachLimited ? W.reach : '제한 없음', { mono: true, help: true }),
          this.row('비밀번호 변경', '자기 비밀번호를 바꾸는 operation이 없다 — 관리자 재설정만', '없음', { help: true, vc: '#8b95a6', badges: [this.tag('API 없음', 'off')] })
        ] }),
        this.card({ span: 5, title: '에이전트 위임 자격', sub: 'agent.grants.* — 목록 operation이 없다', acts: [this.btn('+ 발급', () => {}, { dis: true, tip: 'agent.grant — 이 화면의 앱 권한 밖' })],
          rows: [this.row('목록 없음', '발급한 자격을 다시 읽는 operation이 없다 — 발급한 화면만 안다', '', { vc: '#8b95a6', badges: [this.tag('API 없음', 'off')] })] }),
        this.linkCard()
      ];
    }

    // ── Terra ID (P2 외부 신원 입구) ── 신뢰는 기본 꺼짐. 목록이 빈 Tree는 비밀번호 로그인만 받는다
    /** 내 연결 목록(누구나) · 신뢰 목록(tree 게이트웨이 — 클러스터 탭)을 읽는다. 못 받으면 '못 봤음'으로 남긴다 */
    async loadTerraId(who) {
      const L = this.__live;
      if (!L) return;
      const c = L.client, W = who || this.state.who || {}, tree = this.state.role === 'tree';
      const uid = userIdOf(W.principal || L.principal || '');
      const [iss, links] = await Promise.all([
        tree ? c.invoke(TID.issuers, {}) : Promise.resolve(null),
        uid ? c.invoke(TID.links, { user_id: uid }) : Promise.resolve(null)
      ]);
      if (this.__live !== L) return;
      this.setState({ tidUser: uid, tidIss: tree ? issuersView(iss) : null,
        tidLinks: uid ? identitiesView(links) : { state: 'unseen', identities: [], why: '내 신원(whoami principal)을 모릅니다 — 다시 로그인하세요' } });
    }

    /** Terra ID op 하나 — 성공이면 알리고 다시 읽는다. 실패 글은 외부 신원 코드를 풀어 쓴다 */
    async tidCall(op, input, label) {
      const L = this.__live;
      if (!L) return { ok: false, msg: 'Terra에 연결되지 않았다' };
      const r = await L.client.invoke(op, input);
      const good = r.kind === 'ok' || r.kind === 'accepted';
      if (good) this.toast('●', '#3ecf8e', label, op);
      void this.loadTerraId();
      return good ? { ok: true } : { ok: false, msg: externalErrorText(r) };
    }

    tidToggle(x) {
      const to = !x.enabled;
      const run = async () => { const r = await this.tidCall(TID.issuerPatch, { issuer: x.issuer, enabled: to }, to ? 'Terra ID 신뢰를 켰습니다' : 'Terra ID 신뢰를 껐습니다'); if (!r.ok) this.toast('■', '#ff6b81', '하지 못했습니다', r.msg); };
      this.setState({ dlg: to
        ? { title: (x.name || x.issuer) + '을(를) 신뢰할까요?', op: TID.issuerPatch + ' { enabled: true }',
          rows: [['발급자', x.issuer], ['대상(aud)', x.audience || '(비어 있음 — 켤 수 없습니다)'], ['2단계 인증 요구', x.mfa ? '예' : '아니오'], ['열리는 문', EXCHANGE_PATH]],
          warn: '켜면 교환 문(' + EXCHANGE_PATH + ')이 열리고, 이 발급자가 서명한 이 Tree용 토큰으로 로그인할 수 있게 됩니다. 로그인할 수 있는 것은 이 Tree의 사용자에 미리 연결한 Terra ID 계정뿐입니다 — 연결 없는 계정은 받지 않습니다. 비밀번호 로그인은 그대로입니다.',
          okLabel: '신뢰 켜기', ok: run }
        : { title: (x.name || x.issuer) + ' 신뢰를 끌까요?', op: TID.issuerPatch + ' { enabled: false }',
          rows: [['발급자', x.issuer]],
          warn: '끄면 이 발급자의 토큰으로는 로그인할 수 없습니다. 이미 열린 세션은 다음 갱신(refresh)에서 끊깁니다. 연결 기록은 지워지지 않습니다. 켠 발급자가 하나도 남지 않으면 교환 문이 닫힙니다(404).',
          okLabel: '끄기', ok: run } });
    }

    tidMfa(x) {
      void this.tidCall(TID.issuerPatch, { issuer: x.issuer, require_mfa: !x.mfa }, x.mfa ? '2단계 인증 요구를 껐습니다' : '2단계 인증을 요구합니다').then((r) => { if (!r.ok) this.toast('■', '#ff6b81', '하지 못했습니다', r.msg); });
    }

    tidDelete(x) {
      this.setState({ dlg: { title: (x.name || x.issuer) + '을(를) 지울까요?', op: TID.issuerDelete, rows: [['발급자', x.issuer], ['지금', x.enabled ? '켜짐' : '꺼짐']],
        warn: '신뢰 목록에서 지웁니다. 사용자 연결 기록은 남고, 이 발급자로 연 세션은 다음 갱신(refresh)에서 끊깁니다. 다시 쓰려면 새로 추가하고 켜야 합니다.', okLabel: '지우기',
        ok: async () => { const r = await this.tidCall(TID.issuerDelete, { issuer: x.issuer }, '발급자를 지웠습니다'); if (!r.ok) this.toast('■', '#ff6b81', '하지 못했습니다', r.msg); } } });
    }

    tidAfSet(p) { this.setState({ tidAf: Object.assign({}, this.state.tidAf, p, { msg: p.msg != null ? p.msg : '' }) }); }
    async tidAddSubmit() {
      const f = this.state.tidAf; if (!f || f.busy) return;
      const b = issuerAddBody(f);
      if (!b.ok) { this.tidAfSet({ msg: b.msg }); return; }
      this.tidAfSet({ busy: true });
      const r = await this.tidCall(TID.issuerAdd, b.body, '발급자를 추가했습니다 — 꺼진 채로');
      if (!r.ok) { this.setState({ tidAf: Object.assign({}, this.state.tidAf, { busy: false, msg: r.msg }) }); return; }
      this.setState({ tidAf: null });
    }
    tidAddForm() {
      const f = this.state.tidAf; if (!f) return {};
      const set = (k) => (e) => this.tidAfSet({ [k]: e.target.value });
      return { hasForm: true, formId: 'tid-issuer', formTitle: '발급자 추가 — 꺼진 채로 추가된다', fields: [
        { key: 'issuer', label: '발급자 주소 (issuer) *', span: 1, isIn: true, type: 'url', v: f.issuer, ph: 'https://id.terra.example', set: set('issuer') },
        { key: 'name', label: '표시 이름', span: 1, isIn: true, type: 'text', v: f.name, ph: 'Terra ID', set: set('name') },
        { key: 'jwks', label: 'JWKS 주소 (비우면 discovery)', span: 2, isIn: true, type: 'url', v: f.jwks, ph: 'https://id.terra.example/.well-known/jwks.json', set: set('jwks') },
        { key: 'pinned', label: '고정 키 묶음 JSON (선택 — 발급자에 닿지 못할 때 쓰는 키)', span: 2, isIn: true, type: 'text', v: f.pinned, ph: '{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"…","x":"…"}]}', set: set('pinned') }],
        fmsg: f.msg, fmsgDisp: f.msg ? 'block' : 'none', fcancel: () => this.setState({ tidAf: null }), fok: () => this.tidAddSubmit(),
        fokLabel: f.busy ? '보내는 중…' : '추가', fbusy: f.busy ? 'true' : 'false', fop: f.busy ? 0.6 : 1 };
    }

    /** Terra ID 신뢰 카드 — master_admin만(목록이 403이면 그리지 않는다). 없음(빈 목록)과 못 봤음(오류 · 길 없음)을 가른다 */
    trustCard() {
      const V = this.state.tidIss;
      if (!V) return this.stateCard('rotate', '#9aa1ab', 'Terra ID 신뢰 목록을 불러오는 중…', '잠시만 기다리세요.');
      if (V.state === 'denied') return null;
      if (V.state === 'unseen') return this.stateCard('lock', '#ff6b81', 'Terra ID 신뢰 목록을 받지 못했습니다', 'Master에 닿지 않았거나 이 Gateway에 외부 발급자 관리 길(terra.master.admin.external-issuers.*)이 없습니다 — 신뢰가 꺼져 있다는 뜻이 아닙니다. ' + V.why);
      const add = this.btn('+ 발급자', () => this.setState({ tidAf: { issuer: '', name: '', jwks: '', pinned: '', busy: false, msg: '' } }), { primary: !V.issuers.length });
      const rows = V.issuers.length ? V.issuers.map((x) => {
        const badges = [this.tag(x.enabled ? '신뢰 켜짐' : '꺼짐', x.enabled ? 'ok' : 'off', x.enabled ? '교환 문으로 이 발급자의 토큰을 받는다 — 연결한 사용자만' : '이 발급자의 토큰을 받지 않는다 (기본)')];
        if (x.mfa) badges.push(this.tag('2단계 인증 요구', 'info'));
        if (!x.audienceSet) badges.push(this.tag('aud 없음', 'warn', '실효 대상(aud)이 비어 있으면 켤 수 없다 (400)'));
        const d = [x.audience ? 'aud ' + x.audience : '', x.jwksUri ? 'JWKS ' + x.jwksUri : 'JWKS discovery', x.kids.length ? '키 ' + x.kids.join(', ') : '키 없음', x.cachedAt ? '받은 때 ' + x.cachedAt : ''].filter(Boolean).join(' · ');
        return this.row(x.name ? x.name + ' — ' + x.issuer : x.issuer, d, x.enabled ? '켜짐' : '꺼짐', { tmono: !x.name, badges, op: x.enabled ? 1 : 0.85,
          btns: [this.btn(x.enabled ? '끄기' : '켜기', () => this.tidToggle(x), { primary: !x.enabled && x.audienceSet, dis: !x.enabled && !x.audienceSet, tip: !x.enabled && !x.audienceSet ? '실효 aud가 비어 있다' : '' }),
            this.btn(x.mfa ? '2단계 요구 끄기' : '2단계 요구', () => this.tidMfa(x)),
            this.btn('지우기', () => this.tidDelete(x), { danger: true })] });
      }) : [this.row('신뢰 없음', TRUST_EMPTY_TEXT, '꺼짐', { vc: '#9aa1ab', badges: [this.tag('기본', 'off')] })];
      return this.card(Object.assign({ span: 12, title: 'Terra ID 신뢰', sub: 'admin.external-issuers.* · master_admin 유형만 · ' + (V.on ? '켜짐 ' + V.on + ' · 교환 문 열림' : '교환 문 닫힘'), acts: [add], rows }, this.tidAddForm()));
    }

    tidLfSet(p) { this.setState({ tidLf: Object.assign({}, this.state.tidLf, p, { msg: p.msg != null ? p.msg : '' }) }); }
    async tidLinkSubmit() {
      const f = this.state.tidLf, uid = this.state.tidUser; if (!f || f.busy) return;
      if (!uid) { this.tidLfSet({ msg: '내 신원을 모릅니다 — 다시 로그인하세요' }); return; }
      const t = tokenPeek(f.token);
      if (!t.ok) { this.tidLfSet({ msg: t.msg }); return; }
      if (!audIsTree(t.aud) && !f.force) { this.tidLfSet({ msg: '토큰의 대상(aud)이 tree:<id>가 아닙니다 (' + (t.aud.join(', ') || '없음') + ') — 이 Tree용 로그인 토큰인지 보세요. 그래도 보내려면 한 번 더 누르세요.', force: true }); return; }
      this.tidLfSet({ busy: true });
      const r = await this.tidCall(TID.link, { user_id: uid, token: t.token }, 'Terra ID를 연결했습니다');
      if (!r.ok) { this.setState({ tidLf: Object.assign({}, this.state.tidLf, { busy: false, force: false, msg: r.msg }) }); return; }
      this.setState({ tidLf: null });
    }
    tidLinkForm() {
      const f = this.state.tidLf; if (!f) return {};
      return { hasForm: true, formId: 'tid-link', formTitle: 'Terra ID 로그인 토큰으로 연결', fields: [
        { key: 'token', label: 'Terra ID 로그인 토큰 (aud = tree:<이 Tree id>) — Terra ID에서 이 Tree로 오는 화면이 붙기 전까지는 붙여 넣는다', span: 2, isIn: true, type: 'text', v: f.token, ph: 'eyJhbGciOiJFZERTQSIs…', set: (e) => this.tidLfSet({ token: e.target.value, force: false }) }],
        fmsg: f.msg, fmsgDisp: f.msg ? 'block' : 'none', fcancel: () => this.setState({ tidLf: null }), fok: () => this.tidLinkSubmit(),
        fokLabel: f.busy ? '보내는 중…' : '연결', fbusy: f.busy ? 'true' : 'false', fop: f.busy ? 0.6 : 1 };
    }
    tidUnlink(x) {
      const uid = this.state.tidUser;
      this.setState({ dlg: { title: '이 Terra ID 연결을 풀까요?', op: TID.unlink, rows: [['발급자', x.issuer], ['subject', x.subject], ['상태', linkStatusTag(x.status)[0]]],
        warn: '풀면 이 Terra ID 계정으로는 이 Tree에 로그인할 수 없습니다. 비밀번호 로그인은 그대로입니다. 다시 쓰려면 새 토큰으로 다시 연결합니다.', okLabel: '연결 풀기',
        ok: async () => { const r = await this.tidCall(TID.unlink, { user_id: uid, issuer: x.issuer, subject: x.subject }, '연결을 풀었습니다'); if (!r.ok) this.toast('■', '#ff6b81', '하지 못했습니다', r.msg); } } });
    }

    /** Terra ID로 연결 카드 — 로그인한 사람 누구나. 내 연결만 보인다 */
    linkCard() {
      const V = this.state.tidLinks;
      const open = this.btn('연결', () => this.setState({ tidLf: { token: '', busy: false, msg: '', force: false } }), { primary: true });
      let rows;
      if (!V) rows = [this.row('불러오는 중…', '', '', { vc: '#9aa1ab' })];
      else if (V.state === 'unseen') rows = [this.row('읽지 못함', '내 Terra ID 연결 목록을 받지 못했습니다 — 연결이 없다는 뜻이 아닙니다. Master에 닿지 않았거나 이 Gateway에 길(terra.master.users.by-user-id.external-identities.*)이 없습니다. ' + V.why, '', { vc: '#b4283c' })];
      else if (V.state === 'empty') rows = [this.row('연결 없음', '이 계정에 연결한 Terra ID가 없습니다 — 비밀번호로만 로그인합니다', '', { vc: '#9aa1ab' })];
      else rows = V.identities.map((x) => {
        const [t, tone] = linkStatusTag(x.status);
        return this.row(x.issuer, 'subject ' + x.subject + (x.linkedAt ? ' · 연결한 때 ' + x.linkedAt : ''), t, { tmono: true, badges: [this.tag(t, tone, x.status === 'suspended' ? '정지된 연결로는 로그인할 수 없다 — Tree 관리자가 푼다' : '')], op: x.status === 'suspended' ? 0.7 : 1,
          btns: [this.btn('연결 풀기', () => this.tidUnlink(x), { danger: true })] });
      });
      return this.card(Object.assign({ span: 12, title: 'Terra ID로 연결', sub: 'users.by-user-id.external-identities.* · 이 Tree가 신뢰를 켠 발급자만', acts: [open], rows }, this.tidLinkForm()));
    }

    renderVals() {
      const S = this.state, v = super.renderVals();
      const name = S.nodeName || '이 노드';
      const leaf = S.role === 'leaf';
      v.hdr = Object.assign({}, v.hdr, {
        roleText: S.live ? (S.role ? name + ' · ' + S.role + ' GUI' : name + ' · 역할 모름') : '연결 안 됨',
        gwTip: S.live ? '이 노드의 게이트웨이' + (S.configPath ? ' · ' + S.configPath : '') : absenceText(S.why),
        who: S.live ? (S.principal || '로그인됨') : '로그인 전'
      });
      const n = S.schemaN || Object.keys(this.KEY).length, ed = S.operatorN || Object.keys(this.KEY).filter((k) => this.KEY[k].owner === '운영자').length;
      v.tabs = v.tabs.map((t) => (t.label === '로컬 노드' && t.sub.indexOf('Daemon 설정') === 0 ? Object.assign({}, t, { sub: 'Daemon 설정 ' + n + '키 · ' + this.GROUPS.length + '분류' }) : t));
      v.grp.filters = v.grp.filters.map((f) => Object.assign({}, f, { n: f.label === '모두' ? n : f.label === '편집 가능' ? ed : f.n }));
      const tab = S.tab;
      const only = (cards) => { v.cards = cards; v.keys = Object.assign({}, v.keys, { show: false, rows: [], empty: false }); v.grp = Object.assign({}, v.grp, { disp: 'none' }); v.bar = Object.assign({}, v.bar, { disp: 'none' }); v.page.chips = []; };
      if (tab === 'general') {
        const C = v.cards[0];
        if (C && Array.isArray(C.rows)) C.rows = C.rows.map((r) => (r.t === '연결 대상' ? Object.assign({}, r, { v: S.live ? '이 노드의 게이트웨이' : '—' }) : r));
        return v;
      }
      if (!S.live) { only([this.stateCard('🔑', '#dde8fd', S.why === 'STANDALONE' ? 'Terra 밖에서 열었습니다' : '로그인이 필요합니다', absenceText(S.why) + ' "일반" 탭의 이 브라우저 선호만 바꿀 수 있습니다.')]); return v; }
      if (S.loading) { only([this.stateCard('⟳', '#dde8fd', '불러오는 중', '이 노드의 게이트웨이에서 값을 읽고 있습니다.')]); return v; }
      if (tab === 'account') { only(this.accountCards()); v.page.sub = 'terra.gateway.agent.whoami.get'; return v; }
      if (tab === 'cluster' && !leaf) {
        // Terra ID 신뢰만 이 화면에서 다룬다 — master_admin이 아니면(403) 카드가 없다. 나머지 클러스터 레코드는 여전히 닿지 않는다
        const tc = this.trustCard();
        only((tc ? [tc] : []).concat([this.stateCard('⛓', '#eef1f5', '사용자 · 클러스터 · 네트워크 정책은 이 화면에서 닿지 않습니다',
          '이것들은 Master(terra.master.*)의 레코드입니다. 이 화면이 받은 앱 토큰은 Master에 닿지 않습니다 — tree 쪽 관리 화면이나 terra CLI에서 봅니다.')]));
        return v;
      }
      if (tab === 'cluster' || tab === 'server') {
        only([this.stateCard('⛓', '#eef1f5', (tab === 'cluster' ? '클러스터' : '서버') + ' 탭은 이 화면에서 닿지 않습니다', tab === 'cluster'
          ? '사용자 · 클러스터 · 네트워크 정책은 Master(terra.master.*)의 레코드입니다. 이 화면이 받은 앱 토큰은 Master에 닿지 않습니다 — tree 쪽 관리 화면이나 terra CLI에서 봅니다.'
          : 'Master 설정에는 HTTP API가 없습니다 — tree 기계에서 terra master config show · schema · set · save로 봅니다.')]);
        return v;
      }
      if (!leaf) { only([this.stateCard('🔒', '#eef1f5', (tab === 'node' ? '로컬 노드' : '로컬 자원') + ' 탭은 이 게이트웨이에서 서지 않습니다', '카탈로그에 terra.daemon.*가 없습니다 — 해당 노드의 GUI에서 엽니다.')]); return v; }
      if (tab === 'res') { only(this.resCards()); return v; }
      if (tab === 'node') {
        if (S.loadErr) { only([this.stateCard('⚠', '#fde1e5', 'Daemon 설정을 읽지 못했습니다', 'terra.daemon.config.get — ' + S.loadErr)]); return v; }
        v.page.sub = 'terra.daemon.config.* · ' + name + (S.configPath ? ' · ' + S.configPath : '');
        v.page.subDisp = S.help ? 'inline' : 'none';
        // 재시작 대기 배너의 단추는 원본의 두 번 누르기(restartDaemon) → doRestart 그대로 쓴다
      }
      return v;
    }
  };
}
