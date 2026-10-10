// 네트워크 보드의 실데이터 층 — 예시 노드 · 경로 · 세션 · 피어를 지우고, 이 노드에서 닿는 것만 진짜로 보인다.
//
// 보드(src/screens/network.js)는 디자인 캔버스에서 생성된다. 고치지 않고 이어받는다.
//   닿는 것    로컬 WireGuard(terra.daemon.wireguard.*) · 로컬 서비스 터널(terra.daemon.service-tunnels.*)
//   Master 읽기  mesh · CIDR · 라우트 그래프 · 후보 · 정책 · 세션 · probe 기록 · 조작 이력 — terra.master.* 읽기다. 앱 스코프 토큰은
//              위임 입구 1차(Terra ADR-GW-003)로 읽기에 닿는다(tree 는 op id, leaf 는 /api/upstream). 블록은 network-master.js.
//              닿지 않으면(예전 Terra · 상위 Master 없음) 그 묶음은 예시 대신 "닿지 않음"과 이유를 보인다.
//   쓰지 않는 것  Master 쓰기(조정 · 계획 · 철회 · probe · 정책 · 세션 닫기 · 연결 그룹 · 새 터널) — 위임 입구 2차
// 역할(tree · leaf)은 시연 전환이 아니라 카탈로그로 정한다. 시연 스위치는 tools/gen-pages.py 가 템플릿에서 뺐다.

import { connectLive, absenceText } from './live-host.js';
import { resultText, reaches } from '../api/client.js';
import { masterBlocks, NET_OPS, SEC_OPS, candidateRows } from './network-master.js';

const D = (op) => 'terra.daemon.' + op;
const ok = (r) => r && r.kind === 'ok';
const fmtBytes = (n) => { let v = Number(n) || 0, i = 0; const U = ['B', 'KB', 'MB', 'GB', 'TB']; while (v >= 1024 && i < U.length - 1) { v /= 1024; i += 1; } return (i ? v.toFixed(v < 10 ? 1 : 0) : String(v)) + ' ' + U[i]; };
const ago = (sec) => (sec == null ? null : sec < 60 ? sec + '초 전' : sec < 3600 ? Math.round(sec / 60) + '분 전' : Math.round(sec / 3600) + '시간 전');

/** 카탈로그로 본 이 게이트웨이의 역할 — Daemon op 이 있으면 leaf, Master op 만 있으면 tree */
export function roleOf(catalog) {
  const ids = catalog ? [...catalog.keys()] : [];
  if (ids.some((id) => id.startsWith('terra.daemon.'))) return 'leaf';
  if (ids.some((id) => id.startsWith('terra.master.'))) return 'tree';
  return null;
}

/** 이 노드의 터널(terra.daemon.service-tunnels.get) → 보드의 로컬 터널 줄 */
export function tunnelRows(d) {
  return (d && Array.isArray(d.tunnels) ? d.tunnels : []).map((t) => ({
    id: t.id, service: t.service_id || t.id, src: t.source_node_id || '—', dst: t.target_node_id || '—',
    local: t.local_address || (t.local_bind_host + ':' + t.local_port), target: (t.target_host || '127.0.0.1') + ':' + t.target_port,
    status: t.status || 'unknown', act: t.active_sessions || 0, total: t.total_sessions || 0, failed: t.failed_sessions || 0,
    sent: fmtBytes(t.bytes_sent), recv: fmtBytes(t.bytes_received), err: t.last_error || ''
  }));
}

/** 피어 스냅숏(terra.daemon.wireguard.peers.get) → 보드의 피어 줄 */
export function peerRows(d) {
  return (d && Array.isArray(d.peers) ? d.peers : []).map((p) => ({
    pub: p.public_key ? p.public_key.slice(0, 6) + '…' + p.public_key.slice(-4) : '—', ep: p.endpoint || '(없음)', allowed: (p.allowed_ips || []).join(', ') || '—',
    hs: p.never_seen ? null : p.seconds_since_handshake != null ? p.seconds_since_handshake : null, never: !!p.never_seen, stale: !!p.stale,
    rx: fmtBytes(p.transfer_rx_bytes), tx: fmtBytes(p.transfer_tx_bytes)
  }));
}

export function realNetwork(Screen) {
  const RealNetwork = class extends Screen {
    constructor(props) {
      super(props);
      this.NODES = [];
      this.EDGES = [];
      Object.assign(this.state, {
        role: null, demo: 'ok', sec: 'wg', polledAt: 0,
        reconcile: { status: 'unchanged', reason: '', at: '—', eligible: 0, updated: 0, removed: 0 },
        networks: [], pair: { src: '', dst: '', channel: 'service_tunnel' }, probes: [], m: {}, mCand: null, waitProbe: null, policies: [], sessions: [], groups: [], decls: [],
        plan: { src: '', dst: '', service: '', tport: '', lport: '0', policy: 'auto' }, planned: null,
        ltunnels: [], wg: null, peers: [], peersOn: false, peersErr: '', logs: [],
        live: null, why: null, loading: true, nodeName: '', principal: '', perms: []
      });
    }

    componentDidMount() {
      super.componentDidMount();
      this._offLive = connectLive((live, why) => this.onLive(live, why));
    }

    componentWillUnmount() {
      super.componentWillUnmount();
      clearInterval(this._poll);
      if (this._offLive) this._offLive();
    }

    onLive(live, why) {
      clearInterval(this._poll);
      this.__live = live;
      if (!live) {
        this.setState({ live: false, why, loading: false, role: null, ltunnels: [], wg: null, peers: [], peersOn: false, nodeName: '', principal: '', perms: [] });
        return;
      }
      const role = roleOf(live.client.catalog);
      this.setState({ live: true, why: null, loading: true, role, m: {}, mCand: null, principal: live.principal || '', perms: live.permissions || [],
        nodeName: live.node && live.node.name ? live.node.name : '', sec: role === 'leaf' ? (['wg', 'tunnel'].indexOf(this.state.sec) >= 0 ? this.state.sec : 'wg') : this.state.sec });
      void this.refresh();
      this._poll = setInterval(() => { void this.refresh(); }, 10000);
    }

    /** Master 읽기에 닿나 — 위임 입구 1차(tree 는 카탈로그, leaf 는 /api/upstream) */
    masterOn() { const L = this.__live; return !!(L && L.client && !L.client.masterBlocked && reaches(L.client, NET_OPS.status)); }
    mText(r) { return resultText(r); }

    /** 보고 있는 Master 묶음의 읽기 — 묶음마다 필요한 것만(SEC_OPS) */
    async refreshMaster() {
      const L = this.__live, ops = SEC_OPS[this.state.sec];
      if (!L || !ops || !this.masterOn()) return;
      const got = await Promise.all(ops.map((k) => L.client.invoke(NET_OPS[k], k === 'logs' ? { limit: 100 } : {})));
      if (this.__live !== L) return;
      const m = Object.assign({}, this.state.m);
      ops.forEach((k, i) => { m[k] = got[i]; });
      this.setState({ m, polledAt: Date.now(), loading: false });
      if (this.state.sec === 'route' && this.state.pair.src && this.state.pair.dst) void this.readCandidates();
    }

    /** 고른 쌍의 후보 — route.candidates.get */
    async readCandidates() {
      const L = this.__live, P = this.state.pair;
      if (!L || !P.src || !P.dst) return;
      const r = await L.client.invoke(NET_OPS.candidates, { source_node_id: P.src, target_node_id: P.dst, channel: P.channel || 'service_tunnel' });
      if (this.__live !== L || this.state.pair !== P) return;
      this.setState({ mCand: r.kind === 'ok' ? { kind: 'ok', data: candidateRows(r.data) } : r });
    }

    /** 그래프에서 노드를 누르면 — 처음은 source, 다음은 target, 같은 것을 다시 누르면 비운다 */
    pickPair(id) {
      const P = this.state.pair;
      const next = P.src === id ? Object.assign({}, P, { src: P.dst, dst: '' }) : P.dst === id ? Object.assign({}, P, { dst: '' })
        : !P.src ? Object.assign({}, P, { src: id }) : Object.assign({}, P, { dst: id });
      this.setState({ pair: next, mCand: null });
      if (next.src && next.dst) void this.readCandidates();
    }

    /** 이 노드에서 닿는 것을 다시 읽는다 */
    async refresh() {
      const L = this.__live;
      if (!L) return;
      const c = L.client;
      if (SEC_OPS[this.state.sec]) { await this.refreshMaster(); return; }
      if (this.state.role !== 'leaf') { this.setState({ loading: false, polledAt: Date.now() }); return; }
      const [node, st, tun] = await Promise.all([
        this.state.nodeName ? Promise.resolve(null) : c.invoke(D('node.get'), {}),
        c.invoke(D('wireguard.status.get'), {}),
        c.invoke(D('service-tunnels.get'), {})
      ]);
      // 꺼져 있으면 피어를 부르지 않는다 — 데몬이 422 를 낼 뿐이다
      const peers = ok(st) && st.data && st.data.enabled ? await c.invoke(D('wireguard.peers.get'), {}) : null;
      if (this.__live !== L) return;
      const patch = { loading: false, polledAt: Date.now() };
      if (ok(node) && node.data) patch.nodeName = node.data.device_name || node.data.node_id || '';
      patch.wg = ok(st) && st.data ? st.data : null;
      patch.peersOn = ok(peers);
      patch.peers = ok(peers) ? peerRows(peers.data) : [];
      patch.peersErr = !peers || ok(peers) ? '' : resultText(peers);
      patch.ltunnels = ok(tun) ? tunnelRows(tun.data) : [];
      this.setState(patch);
    }

    can(p) { return (this.state.perms || []).indexOf(p) >= 0; }

    /** 동작 하나 — 확인 창 → 진짜 호출 → 결과 알림 → 다시 읽기 */
    runOp(op, input, label) {
      const L = this.__live;
      if (!L) return;
      this.setState({ busy: Object.assign({}, this.state.busy, { running: label, runSince: Date.now() }) });
      void L.client.invoke(op, input || {}).then((r) => {
        this.setState({ busy: Object.assign({}, this.state.busy, { running: null }) });
        const good = r.kind === 'ok' || r.kind === 'accepted';
        this.toast(good ? '●' : '■', good ? '#4ade80' : '#ff6b81', label + ' — ' + (good ? '실행됨' : '실패'), good ? '상태를 다시 읽었습니다' : resultText(r));
        void this.refresh();
      });
    }

    // ── 로컬 WireGuard: wireguard.status.get · peers.get 그대로 ──
    wgBlocks() {
      const S = this.state, W = S.wg, out = [];
      if (!W) return { tabs: [], blocks: [this.stateBlock('⟳', 'info', S.loading ? '처음 불러오는 중' : 'WireGuard 상태를 읽지 못했습니다', S.loading ? 'terra.daemon.wireguard.status.get을 기다립니다.' : '데몬이 상태를 주지 않았습니다 — 잠시 뒤 다시 읽습니다.', [])] };
      out.push(this.kv({ span: 8, title: '로컬 WireGuard', sub: 'wireguard.status.get · 설정값은 데몬 기동 시점 값',
        tags: [this.tag(W.enabled ? 'enabled' : 'disabled', W.enabled ? 'ok' : 'off'), this.tag(W.installed ? 'installed' : '미설치', W.installed ? 'ok' : 'bad'), this.tag(W.ready ? 'ready' : 'not ready', W.ready ? 'ok' : 'warn'),
          this.tag(S.peersOn ? '인터페이스 켜짐 (간접)' : '인터페이스 꺼짐 (간접)', S.peersOn ? 'info' : 'off', '켜짐 여부 필드가 없다 — peers 조회가 되면 켜진 것으로 본다')] },
      [{ k: 'mode', v: W.mode || '—', cls: 'mono' }, { k: 'interface', v: W.interface_name || '—', cls: 'mono' }, { k: 'address_cidr', v: W.address_cidr || '—', cls: 'mono' }, { k: 'listen_port', v: W.listen_port || '—', cls: 'mono' },
        { k: 'public_key', v: W.public_key ? W.public_key.slice(0, 6) + '…' + W.public_key.slice(-4) : '—', cls: 'mono' }, { k: '권한 helper', v: W.privileged_helper_configured ? '설정됨' : '없음', c: W.privileged_helper_configured ? '#1f7a4d' : '#a65f00' },
        { k: 'install_policy', v: W.install_policy || '—', cls: 'mono' }, { k: 'mesh_vpn', v: (W.mesh_vpn_mode || '—') + ' · ' + (W.mesh_vpn_enabled ? 'on' : 'off'), cls: 'mono' }], 4));
      if (!W.enabled) {
        out.push(this.stateBlock('◌', 'off', 'WireGuard가 꺼져 있습니다', (W.reason ? '데몬: ' + W.reason + '. ' : '') + '로컬 노드 설정의 wireguard.enabled가 꺼져 있습니다. 빈 상태이지 오류가 아닙니다 — 켜려면 설정 › 로컬 노드에서 바꾸고 Daemon을 다시 시작합니다.', []));
      }
      if (!W.installed && W.install_plan && Array.isArray(W.install_plan.steps) && W.install_plan.steps.length) {
        out.push(this.block({ span: 12, title: '설치 계획', sub: 'wireguard.install-plan · ' + (W.install_plan.goos || '') + (W.install_plan.distro_id ? ' (' + W.install_plan.distro_id + ')' : '') + (W.install_plan.supported ? ' · 지원됨' : ' · 지원 안 됨') }, { isSteps: true,
          steps: W.install_plan.steps.map((st, i) => ({ n: i + 1, d: st.description || '', admin: st.requires_admin ? '관리자 권한' : '', cmd: [st.requires_admin ? 'sudo' : '', st.command].concat(st.args || []).filter(Boolean).join(' ') })),
          hasFoot: !!(W.install_plan.notes && W.install_plan.notes.length), foot: (W.install_plan.notes || []).join(' ') }));
      }
      if (W.enabled) {
        const ctl = this.can('node.control'), why = ctl ? '' : 'node.control 권한이 없다';
        const b = S.busy, el = b.running ? (S.now - b.runSince) / 1000 : 0;
        const ask = (op, input, title, rows, warn, okLabel, label) => () => this.confirm({ op, title, rows, warn, okLabel, ok: () => this.runOp(op, input, label) });
        const A = [
          ['동기화', '쓰기', 'Master의 desired를 당겨 와 설정에 반영', '동기화', false, () => this.runOp(D('wireguard.sync.post'), {}, '동기화')],
          ['보고', '쓰기', 'peer 스냅숏을 Master에 보고', '보고', false, () => this.runOp(D('wireguard.report.post'), {}, '보고')],
          [S.peersOn ? '인터페이스 내리기' : '인터페이스 올리기', '위험', S.peersOn ? '내리면 로컬 노드의 mesh 연결이 끊긴다' : '성공 = 명령이 끝남. 섰는지는 다시 읽어 확인', S.peersOn ? '내리기…' : '올리기…', true,
            S.peersOn ? ask(D('wireguard.down.post'), {}, '인터페이스를 내릴까요?', [['대상', (W.interface_name || '') + ' · ' + (W.address_cidr || '')], ['영향', '로컬 노드의 mesh 연결이 모두 끊긴다']], '현재 GUI가 mesh를 통해 열려 있었다면 연결이 끊길 수 있습니다.', '내리기', '내리기')
              : ask(D('wireguard.apply.post'), {}, '인터페이스를 올릴까요?', [['대상', (W.interface_name || '') + ' · ' + (W.address_cidr || '')]], '성공은 명령이 끝났다는 뜻입니다 — 섰는지는 상태를 다시 읽어 봅니다.', '올리기', '올리기')],
          ['관리형 키 교체', '위험', '교체 뒤 설정을 다시 적용해야 peer와 다시 붙는다', '교체…', true,
            ask(D('wireguard.managed-key.post'), { rotate: true }, '관리형 키를 교체할까요?', [['rotate', 'true'], ['지금 공개 키', W.public_key ? W.public_key.slice(0, 6) + '…' : '—']], '교체 뒤 Master 보고가 실패하면 응답 안에 bootstrap_report_error로 옵니다. 그 경우 보고를 다시 누르세요.', '교체', '관리형 키 교체')]
        ];
        out.push(this.block({ span: 4, title: '동작', sub: '데몬이 요청 안에서 끝까지 실행' }, { isActs: true, running: !!b.running, runText: (b.running || '') + ' — 실행 중 ' + Math.round(el) + '초', runPct: Math.min(100, Math.round(el / 15 * 100)),
          rows: A.map(([label, kind, desc, btn, danger, go]) => ({ label, kind, desc: why ? why + ' — ' + desc : desc, btn, kBg: danger ? '#fde1e5' : '#eef1f5', kFg: danger ? '#b4283c' : '#5b6472', line: danger ? '#f3b8c1' : '#d8dde5', fg: danger ? '#b4283c' : '#16191f',
            run: b.running || !ctl ? () => {} : go, dis: b.running || !ctl ? 'true' : 'false', cur: !ctl ? 'not-allowed' : b.running ? 'wait' : 'pointer', op: b.running || !ctl ? 0.5 : 1 })),
          hasFoot: false }));
      }
      if (!W.enabled) { /* 꺼져 있으면 피어도 없다 — 위의 상태 블록이 이유를 말한다 */ }
      else if (!S.peersOn) {
        out.push(this.stateBlock('◌', 'off', 'peer를 읽을 수 없습니다', 'wireguard.peers.get — ' + (S.peersErr || '응답 없음') + '. 인터페이스가 없을 때 데몬이 422를 냅니다 — "꺼짐"의 간접 신호입니다.', []));
      } else {
        const fresh = (p) => (p.never ? 'never_seen' : p.stale ? 'stale' : 'healthy');
        const cnt = { healthy: 0, stale: 0, never_seen: 0 }; S.peers.forEach((p) => { cnt[fresh(p)]++; });
        out.push(this.table({ span: 12, title: 'peer handshake', sub: 'wireguard.peers.get', tags: [this.tag('healthy ' + cnt.healthy, 'ok'), this.tag('stale ' + cnt.stale, cnt.stale ? 'warn' : 'off'), this.tag('never_seen ' + cnt.never_seen, cnt.never_seen ? 'bad' : 'off')],
          cols: '1.1fr 1.4fr 1.5fr 1.2fr 1.2fr', head: ['public_key', 'endpoint', 'allowed_ips', '마지막 handshake', '받음 / 보냄'],
          rows: S.peers.map((p) => { const f = fresh(p); return { op: f === 'never_seen' ? 0.7 : 1, hl: f === 'stale' ? '#fffbf0' : 'transparent', cells: [
            this.cM(p.pub, { fw: 700 }), this.cM(p.ep), this.cM(p.allowed, { c: '#3a4049' }),
            this.cB(f === 'never_seen' ? '본 적 없음' : ago(p.hs) || '—', f === 'healthy' ? 'ok' : f === 'stale' ? 'warn' : 'bad', { sub: f }), this.cM(p.rx + ' / ' + p.tx, { c: '#3a4049' })] }; }),
          empty: 'peer가 없습니다', foot: '응답에는 public_key만 온다 — peer의 노드 이름은 Master의 mesh 계획에 있다.' }));
      }
      return { tabs: [], blocks: out };
    }

    // ── 서비스 터널: leaf 는 이 노드에서 열린 터널 — 닫기만 여기서 ──
    tunnelBlocks() {
      const S = this.state;
      if (S.role !== 'leaf') return { tabs: [], blocks: [this.unreach('서비스 터널')] };
      const stTone = { listening: 'info', active: 'ok', failed: 'bad', draining: 'warn' };
      const ctl = this.can('node.control');
      const out = [this.table({ span: 12, title: '로컬 터널', sub: 'terra.daemon.service-tunnels.get — 순서가 매번 달라 화면이 이름순으로 정렬',
        cols: '1.3fr 2fr 1.2fr 0.9fr 1.1fr 1.1fr 0.6fr', head: ['service_id', 'local → target', '상대', '상태', '세션 (활성/전체/실패)', '보냄 / 받음', ''],
        rows: S.ltunnels.slice().sort((a, b) => (a.service < b.service ? -1 : 1)).map((t) => ({ cells: [
          this.cM(t.service, { fw: 700, sub: t.id }), this.cM(t.local + ' → ' + t.target), this.cM(t.src + ' → ' + t.dst, { c: '#5b6472' }), this.cB(t.status, stTone[t.status] || 'off', { sub: t.err }),
          this.cM(t.act + ' / ' + t.total + ' / ' + t.failed, { c: t.failed ? '#a65f00' : '#16191f' }), this.cM(t.sent + ' / ' + t.recv, { c: '#3a4049' }),
          this.cBtn([{ label: '닫기', danger: true, dis: ctl ? 'false' : 'true', tip: ctl ? '' : 'node.control 권한이 없다', run: ctl ? () => this.confirm({ op: D('service-tunnels.by-tunnel-id.close.post'), title: t.service + ' 터널을 닫을까요?',
            rows: [['터널', t.id + ' · ' + t.local], ['활성 세션', t.act + '개 — 끊긴다']], warn: '선언된 터널이면 약 60초 안에 다시 열립니다 — 선언을 지워야 닫힙니다.', okLabel: '닫기',
            ok: () => this.runOp(D('service-tunnels.by-tunnel-id.close.post'), { tunnel_id: t.id }, t.service + ' 닫기') }) : () => {} }])] })),
        empty: S.loading ? '불러오는 중…' : '열린 터널이 없습니다', foot: '터널 status: listening · active · failed · draining.' })];
      out.push(this.banner('info', 'ⓘ', '새 터널은 tree 쪽에서 엽니다.', '터널 계획 · 열기는 Master operation입니다. 이 화면의 토큰은 Master에 닿지 않아 여기서는 이 노드에 열린 터널을 보고 닫기만 합니다.'));
      return { tabs: [], blocks: out };
    }

    /** Master 를 거치는 묶음 — 이 화면에서는 닿지 않는다 */
    unreach(label) {
      return this.stateBlock('⛓', 'off', label + '은(는) 이 화면에서 닿지 않습니다',
        'Master(terra.master.*) operation입니다. 이 화면이 받은 앱 토큰은 Master에 닿지 않습니다(위임 경계) — 같은 내용은 Master를 직접 부르는 화면 · terra CLI에서 봅니다.', []);
    }

    renderVals() {
      const S = this.state, v = super.renderVals();
      const name = S.nodeName || '이 노드';
      const leaf = S.role === 'leaf';
      // 머리 — 역할 · 게이트웨이 · 폴링 · 세션은 진짜 값으로
      Object.assign(v.hdr, {
        roleText: S.live ? (S.role ? name + ' · ' + S.role + ' GUI' : name + ' · 역할 모름') : '연결 안 됨',
        gwTip: S.live ? '이 노드의 게이트웨이 — 카탈로그 ' + this.__live.client.catalog.size + '개 op' : absenceText(S.why),
        refresh: () => { void this.refresh(); }
      });
      if (!S.live) Object.assign(v.hdr, { pollText: absenceText(S.why), pollFg: '#8a5a00', pollDot: '#e0a53a', pollCls: '' });
      else if (S.loading || !S.polledAt) Object.assign(v.hdr, { pollText: '처음 불러오는 중', pollDot: '#2563eb', pollCls: 'pulse' });
      const mark = (p) => p + (this.can(p) ? ' ✓' : ' ✗');
      v.sess = { who: S.live ? (S.principal || '로그인됨') + ' · ' + (S.role || '역할 모름') : '로그인 전', perm: S.live ? '권한 ' + mark('node.read') + ' · ' + mark('node.control') : '권한 —' };
      // 본문 — 연결 전이면 이유, 닿지 않는 묶음은 이유를 보인다
      const T = ['mesh', 'route', 'log'], mOn = S.live && this.masterOn();
      if (!S.live) v.blocks = [this.stateBlock('🔑', 'off', S.why === 'STANDALONE' ? 'Terra 밖에서 열었습니다' : 'Terra에 연결되지 않았습니다', absenceText(S.why), [])];
      else if (T.indexOf(S.sec) >= 0 && mOn) {
        // 위임 입구 1차 — Master 읽기를 진짜 값으로(network-master.js). 보드 원본의 블록은 시연 값이라 쓰지 않는다
        const view = S.sec === 'mesh' ? this.realMesh() : S.sec === 'route' ? this.realRoute() : this.realLog();
        const tabKey = S.sec === 'log' ? 'log' : S.sec === 'route' ? 'route' : null, curTab = tabKey === 'log' ? S.logFilter : tabKey ? S.sub[tabKey] : null;
        v.blocks = view.blocks.filter(Boolean);
        v.page.tabDisp = view.tabs.length ? 'flex' : 'none';
        v.page.tabs = view.tabs.map(([k, label]) => ({ label, on: curTab === k ? 'true' : 'false', bg: curTab === k ? '#ede9e1' : 'transparent', fg: curTab === k ? '#111111' : '#9aa1ab', sh: curTab === k ? '0 1px 2px rgba(0,0,0,0.35)' : 'none',
          pick: () => (tabKey === 'log' ? this.setState({ logFilter: k }) : this.setState({ sub: Object.assign({}, S.sub, { [tabKey]: k }) })) }));
      }
      else if (T.indexOf(S.sec) >= 0 || (S.sec === 'tunnel' && !leaf)) { v.blocks = [this.unreach(v.page.title)]; v.page.tabDisp = 'none'; }
      else if (S.sec === 'wg' && !leaf) v.blocks = [this.stateBlock('🔒', 'off', '로컬 WireGuard는 leaf 데몬의 것입니다', '이 게이트웨이의 카탈로그에 terra.daemon.wireguard.*가 없습니다 — 해당 노드의 GUI에서 엽니다.', [])];
      if (S.sec === 'tunnel' && leaf) v.page.sub = S.help ? name + '에서 열린 터널 — 닫기만 여기서, 열기는 tree에서' : '';
      if (S.sec === 'wg' && leaf) v.page.sub = S.help ? name + ' · 데몬이 직접 실행하는 동작은 응답이 올 때까지 기다린다' : '';
      if (T.indexOf(S.sec) >= 0) v.page.sub = mOn && S.help ? 'Master 읽기 — 위임 입구 1차(보기만)' : '';
      v.page.subDisp = S.help && v.page.sub ? 'inline' : 'none';
      // 왼쪽 묶음 — Master 묶음은 닿으면 열고(묶음을 바꾸면 그 묶음의 읽기를 바로 부른다), 닿지 않으면 회색 · 이유 "닿지 않음"
      const IDS = ['mesh', 'route', 'tunnel', 'wg', 'log'];
      v.nav = v.nav.map((n, i) => {
        const id = IDS[i], pick = () => { this.setState({ sec: id }); if (SEC_OPS[id]) void this.refreshMaster(); };
        if (T.indexOf(id) < 0) return Object.assign({}, n, { pick });
        if (mOn) return Object.assign({}, n, { pick, sub: n.sub && /Operation|operation/.test(n.sub) ? 'Master 읽기 — 보기만' : n.sub, fg: '#ede9e1', subFg: '#9aa1ab', gray: 'none' });
        return Object.assign({}, n, { pick, sub: 'Master operation — 이 화면에서 닿지 않음', fg: '#8b95a6', subFg: '#a0a8b5', gray: 'grayscale(1)', subDisp: 'block' });
      });
      return v;
    }
  };
  Object.assign(RealNetwork.prototype, masterBlocks);
  return RealNetwork;
}
