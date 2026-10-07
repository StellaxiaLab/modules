// 노드 화면의 실데이터 층 — 예시 데이터를 지우고, 진짜 출처로만 채운다.
//
// 화면(src/screens/node.js)은 디자인 캔버스에서 생성되고 예시 세계(노드 · tree · 알림 · 메모 · 장치 …)를 품고 있다.
// 그 파일은 고치지 않는다 — 다시 생성되면 사라지기 때문이다. 대신 그 클래스를 이어받아:
//   1) 생성자에서 예시 상태를 지운다. 첫 렌더 전이라 예시가 한 번도 보이지 않는다.
//   2) 예시를 돌려주던 메서드(hbSeed · FBDATA · hbPerm · utilInfo …)를 진짜 데이터나 빈 값으로 바꾼다.
//   3) loadWorld 가 Terra 에서 진짜 노드 · tree · 자원을 읽어 상태를 채운다(wire.js 가 토큰을 얻으면 부른다).
//   4) API 에 자리가 없는 사용자 데이터(맵 배치 · 노드 모습 · 설치한 노드 자원 · 연결 · 표시 설정 · 메모)는
//      이 브라우저의 LayoutStore(src/store/layout.js)에 노드 · 주체마다 둔다 — 처음엔 비어 있고, 사용자가 만든 것만 쌓인다.
// 진짜 출처가 없는 것(다른 tree 목록 · 로컬 파일 탐색)은 비워 둔다 — 예시로 채우지 않는다.
// 템플릿에 박힌 예시 문구(세션 띠의 admin · 21:40 등)는 tools/gen-pages.py 가 생성 때 바인딩(who)으로 바꾼다.

import { treeFromMaster, nameNodes, buildNet, resourceSummary } from './world.js';
import { taskAlarms } from './alarms.js';
import { rootItems, entryItems, splitId, localRootItems, localEntryItems } from './files.js';
import { reviveOrphans } from '../api/link-sync.js';
import { layoutKey, loadLayout, saveLayout, bindLayout, pickLayout, reviveMaps, reviveWins, reviveMemos, remapNodes } from '../store/layout.js';
import { DocStore, newerDoc, pullAssets, watchAssets } from '../store/docs.js';
import { loadConfig } from '../api/config.js';
import { HELM_APPS, HELM_CRUD, CRUD_TEXT } from '../api/operations.js';
import { SIGNAL_APPS } from '../api/events.js';
import { resultText, reasonText } from '../api/client.js';

/** 로그인 전 · 노드를 아직 모를 때 로컬 노드 자리에 쓰는 이름. 데이터가 아니라 화면 글이다 */
export const LOCAL_PLACEHOLDER = '이 노드';

const ok = (r) => r && r.kind === 'ok';
const hhmm = (d = new Date()) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const OK = '#4ade80', WARN = '#fbbf24', BAD = '#ff6b81', INK = '#16191f', BLUE = '#60a5fa', MUTE = '#8b95a6';

/** 이 화면이 쓰는 권한 — 유틸 카드의 "잠긴 권한"이 이것과 견준다 */
const SCREEN_PERMS = ['node.read', 'node.control', 'node.config', 'process.execute', 'process.cancel', 'file.read', 'file.write', 'module.manage'];

/** 이 화면을 싣고 있는 모듈 — 모듈 앱의 GUI 창이 "지금 보는 이 화면"을 알아본다(module.json id) */
const SELF_MODULE = 'lab.stellaxia.node-gui';

/** operationId 처럼 보이는 낱말 — API 줄에서 이 노드의 게이트웨이에 있는지 견준다 */
const OPID = /\b(?:terra\.(?:daemon|master|gateway)|io\.terra\.file)\.[a-z0-9_.-]*[a-z0-9]/g;

/** 폼 칸 — 화면(HBCRUD)의 것과 같은 모양 */
const TX = (k, label, ph) => ({ k, label, type: 'text', ph: ph || '' });
const SEL = (k, label, opts) => ({ k, label, type: 'sel', opts });
const BO = (k, label) => ({ k, label, type: 'bool' });

/** 비어 있는 실데이터 보관소 — 로그아웃하면 이것으로 돌아간다 */
function freshReal() {
  return {
    perms: null, principal: '', fb: { repo: [], local: [] }, loaded: new Set(), seen: new Map(), localFs: null,
    modules: null, wg: null, configKeys: null,
    layoutKey: null, unbindLayout: null,   // LayoutStore — 로그인한 동안만 저장한다
    docs: null, unwatchAssets: null,       // 사용자 문서(서버) — 로그인한 동안만 뒤따라 쓴다
    events: '', sigs: new Set(), sigT: 0   // 실시간 이벤트(B-5) — '' · open · retry · off, 모아 둔 신호
  };
}

/**
 * 빈 세계 — 로컬 노드 하나의 맵(가운데 칸이 자신, 장식 없음). defaultMap 은 화면의 것을 그대로 쓴다.
 * @param {any} screen  realNode 인스턴스 (NET 을 바꾼다)
 * @param {{ name: string, id?: string|null }} local
 */
export function emptyWorld(screen, local) {
  screen.NET = { [local.name]: { role: 'Leaf', kids: [], res: [], id: local.id || null, status: 'unknown' } };
  const localNode = { name: local.name, role: 'Leaf', local: true, id: local.id || null };
  return Object.assign(screen.defaultMap(local.name), {
    map: local.name, maps: {}, looks: {}, pending: [], localNode, shown: localNode,
    curTree: { name: '', role: 'Tree', bid: null }, trees: [],
    memos: [], io: [], alarms: [], netTunnels: [], netPolled: '', notif: {}, hbd: {}, hbMsg: null, hbPath: '', hbArm: null, hbBusy: null,
    // 자원 설치 · 연결하기 · 설정 창 · 상태 화면 · 자원 폼 · 모듈 GUI 창 · 그래프 고름의 진행 중 상태 (defaultMap 이 rsrc · links 를 비운다)
    place: null, placeMsg: '', rcfgKey: null, conn: null, pillOpen: null, pillSrc: null, evView: 'real',
    rst: null, hbForm: null, mgui: null, netSel: null,
    // 상태 화면의 출력 칸 · 노드 관리 폼 · 크기 바꾸는 중인 창 · 전체 화면 전 화면 — 앞 세션의 것을 남기지 않는다
    hbOut: null, nodeAdm: null, wrz: null, fsPrev: {},
    // 표시 설정은 사용자마다 LayoutStore 에 있다 — 로그아웃하면 앞 사용자의 것을 남기지 않는다
    roadsOn: true, markStyle: 'flag', roadPick: 'stone', ovhHide: false, linkOrphans: []
  });
}

/** Master 를 부를 수 없는 이유 — 앱 토큰은 Master op 에 닿지 않는다(구현해야 할 것 PF-1). 닿으면 '' */
export function masterWhy(client, op) {
  if (!client) return 'Terra에 연결되지 않았다';
  if (client.masterBlocked || !known(client, op)) return '이 화면(앱 토큰)은 Master에 닿지 않는다 — tree 쪽 관리 화면이나 terra CLI에서 한다';
  return '';
}

/** 카탈로그에 그 op 가 있나 — 카탈로그를 아직 못 받았으면(비어 있으면) 막지 않는다 */
const known = (client, op) => !client.catalog || client.catalog.size === 0 || client.has(op);

/** 다른 노드에 노드 주소 호출(B-1)로 닿나 */
const relays = (client) => !!(client && client.canRelay && client.canRelay());

/** 저장을 끊는다 — 빈 세계 · 다른 계정의 세계가 앞 저장본을 덮지 않게. 서버로 모아 둔 쓰기도 버린다(브라우저 저장본이 다음 로그인에 다시 올린다) */
function unbindLayout(screen) {
  const R = screen.__real;
  if (!R) return;
  if (R.unbindLayout) { R.unbindLayout(); R.unbindLayout = null; R.layoutKey = null; }
  if (R.unwatchAssets) { R.unwatchAssets(); R.unwatchAssets = null; }
  if (R.docs) { R.docs.stop(); R.docs = null; }
}

/** 노드 화면 클래스를 이어받아 예시를 지운 클래스를 돌려준다 */
export function realNode(Screen) {
  return class RealNode extends Screen {
    constructor(props) {
      super(props);
      this.__real = freshReal();
      this.__client = null;
      Object.assign(this.state, emptyWorld(this, { name: LOCAL_PLACEHOLDER }));
    }

    // 조타륜 앱의 예시 자원 — 진짜 목록은 wire.js(wireHelm)가 넣는다. 없으면 빈 목록이다
    hbSeed() { return []; }

    // 전송 진행 · 작업 실행을 흉내 내던 0.5초 박자 — 진짜 목록은 폴링이 바꾼다
    hbTick() {}

    // SVI 흐름 칸 · 맵 도로의 예시 흐름(maingui A-28) — 진짜 흐름은 svi-live.js 가 핸들 SSE 로 state.sviStream · state.sviFlow 에 넣는다
    sviDemoTick() {}

    // 로그인 전의 동작은 아무것도 바꾸지 않는다. 연결되면 wire.js 가 진짜 동작으로 바꿔 낀다.
    // 폴더 들어가기(화면 이동)와 피어 회수의 첫 누름(확인 대기)은 데이터가 아니라 화면 동작이라 그대로 둔다
    hbAct(app, id, op) {
      if ((app === 'folder' && op === 'open') || (app === 'wg' && op === 'revoke' && this.state.hbArm !== id)) return super.hbAct(app, id, op);
      this.hbSay('Terra에 로그인해야 쓸 수 있다', BAD);
    }

    // ───── 자원 추가 · 수정 · 삭제 (조타륜 앱 창 · 상태 화면) ─────
    // 화면은 폼을 저장하면 자기 목록에 항목을 지어 넣는다(디자인 시연). 실데이터 층은 지어내지 않는다 —
    // 연결되면 wire.js 가 진짜 동작(operations.js HELM_CRUD)으로 바꿔 끼우고, 서버에 길이 없는 것은 폼을 열기 전에 그렇다고 말한다.

    /** 이 앱 · 이 동작에 서버 길이 없으면 그 글(⚠ 제안 · 이유), 있으면 '' */
    crudWhy(app, mode, node) {
      const C = HELM_CRUD[app];
      if (!C) return '';
      // Daemon 쪽 대응(local)은 이 노드 · 노드 주소 호출로 닿는 다른 노드에 쓴다(source.js daemonView 와 같은 규칙)
      const local = node === this.state.localNode.name || relays(this.__client);
      const spec = local && C.local && C.local[mode] !== undefined ? C.local[mode] : C[mode];
      if (spec === null) return '⚠ ' + String((CRUD_TEXT[app] || {})[{ create: 'add', update: 'edit', del: 'del' }[mode]] || '서버에 길이 없다').replace(/^⚠\s*/, '');
      if (spec && typeof spec === 'object' && spec.none) return resultText({ kind: 'unavailable', reason: spec.none });
      return '';
    }

    // 폼 칸 · API 줄 — 원본 설계의 글은 실제와 다른 곳이 있고(장치 이름 바꾸기 · 터널 · 피어 회수 본문) 자리 표시자에 예시 이름이 있다.
    // API 줄은 이 모듈이 실제로 부르는 것(CRUD_TEXT)으로, 이 노드의 게이트웨이에 없는 op 는 ⚠ 로 적는다
    HBCRUD() {
      const C = super.HBCRUD(), cl = this.__client;
      const mark = (t) => {
        const ops = String(t).match(OPID) || [], miss = cl ? ops.filter((o) => !cl.has(o)) : [];
        if (!miss.length) return t;
        return t + (miss.length === ops.length ? ' ⚠ 이 노드의 게이트웨이에 없다' : ' ⚠ 없음: ' + miss.map((o) => o.replace(/^terra\.(daemon|master|gateway)\./, '')).join(' · '));
      };
      Object.keys(C).forEach((app) => {
        const T = CRUD_TEXT[app];
        if (T) C[app] = Object.assign({}, C[app], { api: { list: T.list, add: mark(T.add), edit: mark(T.edit), del: mark(T.del) } });
      });
      if (C.grant) C.grant = Object.assign({}, C.grant, { bind: [TX('from', '보내는 자원', 'process.metrics'), TX('to', '받는 곳', '노드 · 자원'), SEL('qos', 'QoS', ['reliable_ordered', 'best_effort'])] });
      if (C.folder) C.folder = Object.assign({}, C.folder, { fields: [TX('name', '이름', '새 폴더'), BO('dir', '폴더')] });   // 크기 · 메모는 서버가 정한다
      if (C.tunnel) C.tunnel = Object.assign({}, C.tunnel, { key: 'to', fields: [SEL('type', '유형', ['decl', 'tun']), TX('to', '대상 (노드이름:포트)', '노드이름:22'), TX('bind', '로컬 주소', '127.0.0.1:2222')] });   // 이름은 서버가 짓는다(service_id)
      if (C.wg) C.wg = Object.assign({}, C.wg, { fields: [TX('id', '피어 노드', '노드 id'), TX('ip', '주소', '피어 주소'), TX('ep', '끝점', '호스트:51820')] });
      return C;
    }

    // I/O 장치 추가 = 손 등록(카메라 주소) — 종류 · 승인 · 켜기는 장치와 Daemon 이 정한다.
    // 고칠 때는 원본의 칸에서 주소를 뺀다 — 등록한 장치의 주소를 바꾸는 op 는 없다(지우고 다시 등록)
    hbFields(app, it) {
      if (app === 'io' && !it) return [TX('name', '이름', '카메라 이름'), TX('addr', '주소 (비우면 스캔)', 'rtsp://… · http://… (카메라)')];
      if (app === 'io') return super.hbFields(app, it).filter((f) => f.k !== 'addr');
      return super.hbFields(app, it);
    }

    hbFormOpen(app, mode, id, node, where) {
      const nd = node || this.hbNode(), why = this.hbCan(app, nd).ok ? this.crudWhy(app, mode === 'add' ? 'create' : 'update', nd) : '';
      if (why) { this.hbSay((mode === 'add' ? '추가' : '수정') + ' — ' + why, WARN); return; }
      return super.hbFormOpen(app, mode, id, node, where);
    }

    // 연결 전(wire.js 가 바꿔 끼우기 전)의 저장 — 지어내지 않는다
    hbFormSave() {
      const F = this.state.hbForm;
      if (!F) return;
      const can = this.hbCan(F.app, F.node);
      this.setState({ hbForm: Object.assign({}, F, { err: can.ok ? 'Terra에 연결되지 않았다 — 저장할 곳이 없다' : '🔒 ' + can.why }) });
    }

    // 삭제 — 서버에 길이 없으면 확인 대기(첫 누름)도 걸지 않는다. 연결 전의 두 번째 누름은 지우지 않는다.
    // 연결되면 wire.js 가 서버가 받은 뒤에만 이것(화면의 두 번째 누름 처리 — 목록 · 맵 자리 · 연결 걷기)을 부른다
    hbDel(app, id, node) {
      const nd = node || this.hbNode();
      if (this.hbCan(app, nd).ok) {
        const why = this.crudWhy(app, 'del', nd);
        if (why) { this.setState({ hbArm: null }); this.hbSay('삭제 — ' + why, WARN); return; }
        if (!this.__client && this.state.hbArm === 'del:' + id) { this.setState({ hbArm: null }); this.hbSay('Terra에 연결되지 않았다 — 지울 곳이 없다', BAD); return; }
      }
      return super.hbDel(app, id, node);
    }

    // 모듈 GUI 창 — 다른 모듈의 앱은 이 창(iframe) 안에 띄울 수 없다: 앱마다 origin · 스코프 토큰이 따로고
    // terra.web/frame 은 자기 모듈의 앱만 감싼다. 무엇을 할 수 있는지 그대로 적는다
    mguiVals() {
      const v = super.mguiVals();
      if (!v || !v.on || !v.id) return v;
      const it = (this.hbItems(v.node, 'mod') || []).find((x) => x.id === v.id) || {};
      const app = (it.apps || [])[0];
      const msg = !it.gui ? '이 모듈은 GUI를 제공하지 않는다 — 기능만 있다'
        : it.id === SELF_MODULE ? '지금 보고 있는 이 화면이 이 모듈의 GUI다'
          : '이 창 안에는 띄울 수 없다 — Terra는 앱마다 origin · 토큰을 따로 주고, 셸이 연다. 셸의 앱 목록에서 ' + ((app && app.name) || it.name) + '을(를) 연다';
      // Scene 모듈은 프로세스가 없어 Daemon 이 discovered(→ 멈춤)로 본다 — 화면을 기여하는 모듈이라고 적는다
      const scene = it.kind === 'scene' ? { state: '화면 모듈', sc: MUTE } : {};
      // live · src — 원본은 실제 주소가 있으면 iframe 을 띄운다. 이 화면은 다른 앱의 토큰을 받지 못한다(구현해야 할 것 PF-15)
      return Object.assign(v, scene, {
        url: it.ui || '—', live: false, src: '', runDisp: 'none', stopDisp: 'flex', stopMsg: msg, hint: msg,
        reload: () => this.hbAct('mod', null, 'check', v.node)
      });
    }

    // 노드 관리(상태 화면 · 노드) — 이름 · 부모 바꾸기 · 삭제는 Master nodes.by-node-id.{patch,delete} 다
    async nodeAdmDo(kind, name, arg) {
      const cl = this.__client, op = 'terra.master.nodes.by-node-id.' + (kind === 'delete' ? 'delete' : 'patch');
      const why = masterWhy(cl, op);
      if (why) return { ok: false, msg: why };
      const id = ((this.NET || {})[name] || {}).id;
      if (!id) return { ok: false, msg: name + '의 node_id를 모른다' };
      const body = { node_id: id };
      if (kind !== 'delete') {
        if (arg.name !== name) body.display_name = arg.name;
        if (arg.parent !== (this.parentOfNode(name) || '')) body.parent_node_id = arg.parent ? ((this.NET[arg.parent] || {}).id || '') : '';
      }
      const r = await cl.invoke(op, body);
      return r.kind === 'ok' ? { ok: true } : { ok: false, msg: resultText(r) };
    }

    // 상태 화면 — 노드 칸의 "로그인" 줄은 원본 설계가 tree 로그인(비밀번호 · 오프라인)을 그린다. 이 화면이 닿는 것은
    // 이 노드의 세션뿐이다 — 로그인 전 · 이 노드 · 닿지 않는 노드(오프라인)로 적는다. 조회 API 는 게이트웨이 경로다
    rstVals() {
      const v = super.rstVals();
      if (!v || !v.isNode) return v;
      const S = this.state, nd = this.nodeAt(S.rst.key), name = nd ? nd.name : '', net = (this.NET || {})[name] || {};
      const login = !this.__real.perms ? '로그인 전' : name === S.localNode.name ? '로그인됨 — 이 화면의 세션'
        : net.auth === 'offline' || net.status === 'offline' ? '오프라인' : '이 화면은 닿지 않는다';
      v.kv = (v.kv || []).map((r) => (r.k === '로그인' ? { k: r.k, v: login } : r));
      if (Array.isArray(v.api) && v.api[0]) v.api = [Object.assign({}, v.api[0], { op: 'GET /api/v1/agent/whoami · /api/v1/agent/nodes (게이트웨이 경로)' })].concat(v.api.slice(1));
      // 노드 관리 폼 — Master 에 닿지 않으면 누르기 전에 잠근다(원본은 node.control 만 본다)
      const why = v.adm ? masterWhy(this.__client, 'terra.master.nodes.by-node-id.patch') : '';
      if (why) v.adm = Object.assign({}, v.adm, { lock: '🔒 ' + why, lockDisp: 'block', dis: true, delDisp: 'none', save: () => {}, del: () => {} });
      return v;
    }

    // 메모장 — 메모는 LayoutStore(이 브라우저 · 사용자 문서)에 있다. 원본의 경로 글(예시 ~/.terra/memos · 07d5739부터 FBMODES().memo.root = memos)은 이 모듈에서 '메모/'다
    memoVals() {
      const v = super.memoVals();
      if (v && typeof v.path === 'string') v.path = v.path.replace(/^(~\/\.terra\/memos|memos)\//, '메모/');
      return v;
    }

    // 다른 tree 로 가는 길이 없다 — 이 화면은 이 노드의 게이트웨이에만 닿는다(로그인 창도 띄우지 않는다)
    beginSwitch(pick) {
      this._navTree = null;
      this.setState({ tlNote: (pick && pick.name ? pick.name + ' — ' : '') + '다른 tree로는 이 화면이 닿지 않는다' });
    }

    // 조타륜을 내렸을 때 갈 곳 — 부모 tree 를 모르면(등록 전) 이 노드 맵에 그대로 있는다
    helmDest() {
      const d = super.helmDest();
      return d && d.name ? d : { name: this.state.localNode.name, local: true };
    }

    // 기본 맵 — tree 의 자식이 가운데 둘레 두 겹(18칸)을 넘으면 바깥 겹에 잇고, 그래도 넘치면 "새 노드"(pending)에 둔다.
    // 화면의 기본 맵은 18을 넘는 자식을 말없이 버린다
    defaultMap(name) {
      const m = super.defaultMap(name);
      const net = this.NET[name];
      if (!net || !this.isTree(net.role)) return m;
      const placed = new Set(Object.values(m.nodes).map((n) => n.name));
      const rest = net.kids.filter((k) => !placed.has(k));
      if (!rest.length) return m;
      const free = m.fields.filter((k) => !m.nodes[k]).map((k) => { const p = this.cellXY(k), c = this.cellXY('4-4'); return { k, d: Math.hypot(p.cx - c.cx, p.cy - c.cy), a: Math.atan2(p.cx - c.cx, c.cy - p.cy) }; })
        .sort((u, v) => (Math.round(u.d) - Math.round(v.d)) || (((u.a + 2 * Math.PI) % (2 * Math.PI)) - ((v.a + 2 * Math.PI) % (2 * Math.PI))));
      const nodes = Object.assign({}, m.nodes), pending = [];
      rest.forEach((kid, i) => {
        const spot = free[i];
        const role = (this.NET[kid] || { role: 'Leaf' }).role;
        if (spot) nodes[spot.k] = { name: kid, role }; else pending.push({ name: kid, role, at: '—' });
      });
      return Object.assign(m, { nodes, pending });
    }

    // 폴더 보관함 — Terra 저장소 = 이 노드의 진짜 공유 폴더(io.terra.file) · 폴더 탐색기 = Daemon 로컬 탐색(local-fs, 읽기만)
    FBDATA() { return this.__real.fb; }

    FBMODES() {
      const M = super.FBMODES(), R = this.__real;
      return Object.assign({}, M, {
        repo: Object.assign({}, M.repo, { desc: '이 노드의 공유 폴더 (io.terra.file) — 읽기만', os: '' }),
        local: Object.assign({}, M.local, { os: '',
          desc: R.localFs === false ? '이 노드의 Daemon에 로컬 탐색(local-fs)이 없다 — 또는 file.read 권한이 없다' : '이 노드의 로컬 최상위 루트 (Daemon local-fs) — 읽기만' }),
        memo: Object.assign({}, M.memo, { root: 'memos', rootLabel: '메모', os: '',
          desc: R.docs ? '이 브라우저와 Terra 사용자 문서에 저장 — 다른 기기 · 브라우저에서도 같은 메모'
            : R.layoutKey ? '이 브라우저에만 저장 — 다른 기기에는 없다(이 게이트웨이에서 사용자 문서 저장소를 쓸 수 없다 · 또는 설정이 local)'
            : '로그인 전에는 이 화면 안에만 둔다 — 로그인하면 저장된다' })
      });
    }

    fbOpenItem(d) {
      const F = this.state.fb, cl = this.__client;
      if (d.locked) { this.fbSay('🔒 ' + d.name + ' — ' + String(d.info || '읽을 수 없음').replace(/^🔒 /, ''), WARN); return; }
      if (d.dir || d.lock || F.mode === 'memo') {
        super.fbOpenItem(d);
        if (d.dir && cl && F.mode === 'repo') void loadFolder(this, cl, d.id);
        if (d.dir && cl && F.mode === 'local') void loadLocalFolder(this, cl, d.id);
        return;
      }
      void deskOpen(this, F.mode, d, 'open');   // 파일 = 그 노드의 로컬 프로그램으로
    }

    // 파일 관리자로 = 지금 들어가 있는 폴더를 그 노드의 파일 관리자로(desktop.open reveal)
    fbOS() {
      const F = this.state.fb;
      if (!F.path || F.mode === 'memo') { this.fbSay('폴더에 들어가서 누른다 — 그 폴더를 파일 관리자로 연다', MUTE); return; }
      void deskOpen(this, F.mode, { id: F.path, name: F.path.split('/').pop() }, 'reveal');
    }

    // 필드 스킨 — 금속 판의 "예시 전용 부모 디자인"을 뺀다(부모 디자인은 기본을 따른다)
    fieldSkins() { return super.fieldSkins().map((sk) => (sk.id === 'metal' && sk.parent ? Object.assign({}, sk, { parent: null }) : sk)); }

    // 노드 권한 — 이 노드는 스코프 토큰이 실제로 쥔 권한(사용자 ∩ 이 앱).
    // 다른 노드는 노드 주소 호출(B-1)로 그 Daemon 에 닿을 때 같은 권한이다 — Master 가 그 노드 접근으로 한 번 더 좁히고, 대상 Daemon 이 다시 판정한다.
    // 모듈 수명 · 작업 취소는 Daemon 경로(node.control)로 간다 — 화면의 "모듈 관리★ · 취소" 자물쇠를 node.control 로 푼다
    hbPerm(node) {
      const perms = this.__real.perms;
      if (!perms) return { role: '로그인 필요', rc: BAD, has: [], why: 'Terra에 로그인하지 않았다' };
      const grant = (via) => {
        const has = perms.slice();
        if (has.indexOf('node.control') >= 0) ['module.manage', 'process.cancel'].forEach((p) => { if (has.indexOf(p) < 0) has.push(p); });
        const admin = has.indexOf('node.control') >= 0;
        return { role: (admin ? '관리자' : '읽기 전용') + via, rc: admin ? BLUE : WARN, has };
      };
      if (node === this.state.localNode.name) return grant('');
      const net = this.NET[node];
      if (!net || !net.id) return { role: '닿지 않음', rc: MUTE, has: [], why: '그 노드의 node_id 를 모른다 — Master 노드 목록에 있는 노드만 다룬다' };
      if (!relays(this.__client)) return { role: '닿지 않음', rc: MUTE, has: [], why: '이 노드의 게이트웨이에 노드 주소 호출이 없다 — 그 노드의 화면에서 다룬다' };
      return grant(' · 중계');
    }

    // 조타륜 앱 바의 요약 줄 — 예시 문구(울타리 allowlist · wg0 100.80.0.3)를 진짜 값으로
    hbVals(...args) {
      const v = super.hbVals(...args);
      if (!v || !v.on || this.state.hbMsg || typeof v.msg !== 'string') return v;
      if (v.app === 'decl') {
        const env = (this.hbItems(v.node, 'decl') || {}).envelope;
        v.msg = v.msg.replace(/^울타리 process allowlist · (\d+)\/256$/, (_, n) => (env ? '울타리 process ' + env.process + ' · ' + n + '/' + env.max_declarations : '런타임 선언 ' + n));
      } else if (v.app === 'wg') {
        v.msg = v.msg.replace(/^wg0 · [\d.]+ · 피어 (\d+)$/, (_, n) => wgLine(v.isLocal ? this.__real.wg : null, n));
      }
      return v;
    }

    // 유틸 카드 · 서랍 카드의 요약 — 예시 수치를 진짜 값(없으면 '—')으로
    utilInfo() {
      const r = super.utilInfo(), I = r.INFO, R = this.__real, S = this.state;
      const live = !!R.perms;
      const tunnels = (S.netTunnels || []).length;
      I.net = Object.assign({}, I.net, {
        chip: '', tone: 'off',
        stats: [[live ? String(tunnels) : '—', '로컬 터널', INK], [live ? wgState(R.wg) : '—', 'WireGuard', INK],
          R.events === 'open' ? ['실시간', '이벤트', OK] : [S.netPolled || '—', '확인', INK]],
        foot: ['◇', MUTE, live ? '이 노드의 터널 · WireGuard — mesh · 경로는 Master 쪽 화면에서' : 'Terra에 로그인하면 이 노드의 네트워크가 보인다']
      });
      const mods = R.modules || [];
      const run = mods.filter((m) => m.state === 'running').length, bad = mods.filter((m) => m.state === 'failed').length;
      I.mod = Object.assign({}, I.mod, {
        chip: bad ? '실패 ' + bad : '', tone: bad ? 'bad' : 'off',
        stats: R.modules ? [[String(run), '실행', OK], [String(mods.length - run - bad), '그 밖', INK], [String(bad), '실패', bad ? BAD : INK]] : [['—', '실행', INK], ['—', '그 밖', INK], ['—', '실패', INK]],
        foot: R.modules ? (bad ? ['■', BAD, mods.filter((m) => m.state === 'failed').map((m) => m.name).join(' · ') + ' — 로그 보기'] : ['●', OK, '모듈 ' + mods.length + '개']) : ['○', MUTE, '로그인하면 이 노드의 모듈이 보인다']
      });
      I.set = Object.assign({}, I.set, {
        stats: [[R.configKeys ? String(R.configKeys.total) : '—', 'Daemon 키', INK], [R.configKeys ? String(R.configKeys.operator) : '—', '운영자 키', INK], [live ? (R.perms.indexOf('node.config') >= 0 ? '있음' : '없음') : '—', 'node.config', live && R.perms.indexOf('node.config') < 0 ? WARN : INK]]
      });
      const locked = live ? SCREEN_PERMS.filter((p) => R.perms.indexOf(p) < 0) : [];
      I.user = Object.assign({}, I.user, {
        chip: live ? '로그인' : '', tone: live ? 'ok' : 'off',
        stats: [[live ? short(R.principal) : '—', '계정', INK], [live ? String(R.perms.length) : '—', '권한', INK], [live ? String(locked.length) : '—', '잠긴 권한', locked.length ? WARN : INK]],
        foot: live ? (locked.length ? ['★', WARN, locked.join(' · ') + ' 잠김'] : ['✓', OK, '이 화면이 쓰는 권한이 다 있다']) : ['○', MUTE, 'Terra에 로그인하지 않았다']
      });
      I.mat = Object.assign({}, I.mat, { foot: ['▤', '#6d28d9', (this.MATS || []).map((m) => m.name).filter(Boolean).slice(0, 8).join(' · ')] });
      return r;
    }

    // 렌더 값 — 창 요약 문구를 진짜 값으로, 템플릿의 세션 띠(gen-pages 가 바인딩으로 바꾼 자리)에 who 를 싣는다
    renderVals() {
      const v = super.renderVals(), R = this.__real, S = this.state;
      const live = !!R.perms;
      const mods = R.modules || [];
      const SUM = {
        net: '이 노드의 서비스 터널 · 로컬 WireGuard — mesh · 경로 · 배포는 Master 쪽 화면에서',
        bld: '설계도 ' + (this.buildings || []).length,
        fld: '필드 스킨 ' + (this.FSK || []).length,
        set: live ? S.localNode.name + ' Daemon 설정' + (R.configKeys ? ' ' + R.configKeys.total + '키' : '') + ' · node.config★ ' + (R.perms.indexOf('node.config') >= 0 ? '있음' : '없음') : 'Terra에 로그인하면 이 노드의 설정이 보인다',
        mat: '자재 ' + (this.MATS || []).length + '종',
        mod: R.modules ? '설치 ' + mods.length + ' · 실행 ' + mods.filter((m) => m.state === 'running').length + ' · 실패 ' + mods.filter((m) => m.state === 'failed').length : '로그인하면 이 노드의 모듈이 보인다',
        user: live ? short(R.principal) + ' · 권한 ' + R.perms.length : 'Terra에 로그인하지 않았다'
      };
      if (Array.isArray(v.wins)) v.wins = v.wins.map((w) => (SUM[w.id] != null ? Object.assign({}, w, { sum: SUM[w.id] }) : w));
      v.who = live
        ? { name: short(R.principal) || '로그인됨', sub: '권한: ' + (R.perms.join(' · ') || '없음'), dotC: OK }
        : { name: '로그인 전', sub: 'Terra에 로그인하면 이 노드의 데이터가 보인다', dotC: WARN };
      return v;
    }
  };
}

/** 주체 문자열은 길다(이메일 · user_…). 앞쪽만 */
function short(s) { const t = String(s || ''); return t.length > 24 ? t.slice(0, 23) + '…' : t; }

/** WireGuard 상태(terra.daemon.wireguard.status.get) → 한 낱말 */
function wgState(wg) { return !wg ? '—' : !wg.enabled ? '꺼짐' : wg.ready ? '켜짐' : '준비 안 됨'; }

/** 조타륜 WireGuard 앱의 요약 줄 — 인터페이스 · 주소 · 켜짐 · 피어 수 */
export function wgLine(wg, peers) {
  if (!wg) return '피어 ' + peers;
  return [wg.interface_name || 'wg', wg.address_cidr, wg.enabled ? null : '꺼짐'].filter(Boolean).join(' · ') + ' · 피어 ' + peers;
}

/**
 * 진짜 세계를 읽어 화면에 넣는다. 실패한 출처는 비워 두고 나머지는 채운다.
 * @param {any} screen   realNode 인스턴스
 * @param {import('../api/client.js').TerraClient} client  frame 토큰으로 부르는 클라이언트
 * @param {{ permissions: string[], principal?: string, appId?: string }} session  appId — 사용자 문서 이름공간(app:<appId>)
 */
export async function loadWorld(screen, client, session) {
  const R = screen.__real;
  unbindLayout(screen);   // 앞 세션(다른 계정 · 다른 권한)의 저장을 끊고 시작한다
  R.perms = (session.permissions || []).slice();
  R.principal = session.principal || '';
  screen.__client = client;
  // 기다리는 사이 로그아웃 · 토큰을 잃으면(resetWorld 가 __real 을 갈아 끼운다) 여기서 멈춘다 — 빈 세계를 다시 채우지 않는다
  const gone = () => screen.__real !== R;
  const [node, enroll] = await Promise.all([
    client.invoke('terra.daemon.node.get', {}),
    client.invoke('terra.daemon.enrollment.status.get', {})
  ]);
  if (gone()) return;
  const local = ok(node) && node.data
    ? { id: node.data.node_id || null, name: node.data.device_name || node.data.node_id || LOCAL_PLACEHOLDER }
    : { id: null, name: LOCAL_PLACEHOLDER };
  const tree = ok(enroll) && enroll.data && enroll.data.registered ? treeFromMaster(enroll.data.master_url) : null;
  let visible = [];
  if (tree) {
    const res = await client.get('/api/v1/agent/nodes');   // 못 읽으면 로컬 노드만 둔다
    if (gone()) return;
    if (ok(res) && res.data) visible = nameNodes(res.data.nodes);
  }
  const { NET, localName } = buildNet({ tree, nodes: visible, local });
  screen.NET = NET;
  // 처음 맵은 이 노드 자신의 맵이다 — 조타륜이 이 노드의 자원을 다룬다. 조타륜을 내리면 부모 tree 맵으로 간다
  const localNode = { name: localName, role: 'Leaf', local: true, id: local.id };
  screen._mapGoal = null;   // 로그인 전에 고른 맵 이동은 버린다 — 이 노드 맵에서 시작한다
  // 저장된 배치(LayoutStore) — 노드 · 주체마다. 없으면 기본 맵. 사라진 노드는 칸에서 빼고, 칸 없는 tree 자식은 새 노드로.
  // 저장본 안의 노드는 이름이 키다 — 저장 때 적어 둔 node_id 로 이름이 바뀐 노드를 지금 이름으로 옮긴다(remapNodes)
  const cfg = await loadConfig();
  if (gone()) return;
  const key = cfg.layoutStore === 'none' ? null : layoutKey(local.id || localName, R.principal);
  const stored = (key && loadLayout(key)) || {};
  // 서버 문서(사용자 문서 저장소 · layoutStore server) — 다른 기기 · 브라우저에서 더 나중에 고친 배치면 그것을 쓴다
  const docKey = 'layout/' + (local.id || localName);
  const docs = key && cfg.layoutStore === 'server' && session.appId ? new DocStore(client, session.appId) : null;
  let fromDoc = null;
  if (docs && docs.available()) {
    const doc = await docs.read(docKey);
    if (gone()) return;
    fromDoc = newerDoc(stored, doc);
    if (fromDoc) saveLayout(key, fromDoc, Number(doc.savedAt));   // 브라우저 저장본도 그 시각으로 맞춘다 — 다음엔 같은 것이라 다시 올리지 않는다
  }
  const saved = remapNodes(fromDoc || stored, NET);
  const maps = reviveMaps(saved.maps, NET, (role) => screen.isTree(role));
  const map = Object.assign({}, maps[localName] || screen.defaultMap(localName));
  screen.setState(Object.assign(map, {
    map: localName, maps, looks: saved.looks && typeof saved.looks === 'object' ? saved.looks : {}, localNode, shown: localNode,
    curTree: tree ? { name: tree.name, role: tree.role, bid: tree.bid } : { name: '', role: 'Tree', bid: null },
    trees: [], hbd: {}, io: [],
    roadsOn: saved.roadsOn !== false,
    markStyle: ['flag', 'flat', 'none'].indexOf(saved.markStyle) >= 0 ? saved.markStyle : 'flag',
    roadPick: typeof saved.roadPick === 'string' && saved.roadPick ? saved.roadPick : 'stone',
    memos: reviveMemos(saved.memos),
    wins: reviveWins(screen.state.wins, saved.wins),
    ovhHide: !!saved.ovhHide,
    linkOrphans: reviveOrphans(saved.linkOrphans),   // 못 닫은 바인딩 — 다음 맞추기에서 다시(MD-30)
    place: null, placeMsg: '', rcfgKey: null, conn: null, pillOpen: null, pillSrc: null,
    rst: null, hbForm: null, mgui: null, netSel: null, hbArm: null, hbOut: null, nodeAdm: null
  }));
  if (key) {
    const live = docs && docs.available() && docs.state !== 'off' ? docs : null;
    R.layoutKey = key;
    R.unbindLayout = bindLayout(screen, key, globalThis.window, live ? (d) => live.later(docKey, () => d) : null);
    if (live) {
      R.docs = live;
      live.onNote = (t, c) => screen.pushAlarm('◇', c, t);
      // 브라우저 것이 더 새로우면(서버가 없던 때 · 다른 기기보다 나중에 고쳤다) 한 번 올린다
      if (!fromDoc && Object.keys(stored).length) live.later(docKey, () => pickLayout(screen), DocStore.WAIT / 2);
      R.unwatchAssets = watchAssets(live);
      void pullAssets(live, (k, v) => { if (screen.__real === R && screen._onStore) screen._onStore({ key: k, newValue: v }); });
    }
  }
  await Promise.all([loadResources(screen, client, localName), loadAlarms(screen, client, true), loadRoots(screen, client), loadNet(screen, client), loadConfigKeys(screen, client)]);
}

/** 로컬 노드의 자원 요약(진짜 개수)과 모듈 목록 */
async function loadResources(screen, client, localName) {
  const [io, roots, mods] = await Promise.all([
    client.invoke('terra.daemon.io.devices.get', {}),
    client.invoke('terra.daemon.files.list.get', {}),
    client.invoke('terra.daemon.modules.get', {})
  ]);
  const count = (r, key) => (ok(r) && r.data && Array.isArray(r.data[key]) ? r.data[key].length : undefined);
  const entry = screen.NET[localName];
  if (entry) entry.res = resourceSummary({ devices: count(io, 'devices'), roots: count(roots, 'roots'), modules: count(mods, 'modules') });
  screen.__real.modules = ok(mods) && mods.data && Array.isArray(mods.data.modules)
    ? mods.data.modules.map((m) => ({ id: m.id, name: m.name || m.id, state: m.state || m.status || '' }))
    : null;
  screen.setState({});
}

/** 알림 — Daemon 작업의 상태 변화. first 면 최근 것으로 목록을 세운다 */
export async function loadAlarms(screen, client, first = false) {
  const r = await client.invoke('terra.daemon.tasks.get', {});
  if (!ok(r) || !r.data) return;
  const fresh = taskAlarms(screen.__real.seen, r.data.tasks, { first, limit: 10 });
  if (!fresh.length) return;
  const alarms = fresh.map(({ t, g, c, m }) => ({ t, g, c, m })).concat(first ? [] : screen.state.alarms || []).slice(0, 50);
  const notif = Object.assign({}, screen.state.notif);
  if (!first) notif.alarm = (notif.alarm || 0) + fresh.length;
  screen.setState({ alarms, notif });
}

/** 폴더 보관함 — 공유 폴더(맨 위 칸) · 폴더 탐색기의 로컬 최상위 루트 */
async function loadRoots(screen, client) {
  const LFS = 'terra.daemon.local-fs.roots.get', haveLocal = known(client, LFS);
  const [r, l] = await Promise.all([client.invoke('io.terra.file.roots.list', {}), haveLocal ? client.invoke(LFS, {}) : null]);
  const roots = ok(r) && r.data ? r.data.roots : [];
  screen.__real.fb = { repo: rootItems(roots), local: ok(l) && l.data ? localRootItems(l.data.roots) : [] };
  screen.__real.localFs = ok(l);
  screen.__real.loaded = new Set();
  screen.setState({});
}

/** 폴더 탐색기 — 들어간 로컬 폴더의 항목을 아직 안 읽었으면 읽는다(한 쪽 500개) */
export async function loadLocalFolder(screen, client, id) {
  const { root, rel } = splitId(id), key = 'local:' + id;
  if (!root || screen.__real.loaded.has(key)) return;
  screen.__real.loaded.add(key);
  const r = await client.invoke('terra.daemon.local-fs.entries.get', rel ? { root, path: rel, limit: 500 } : { root, limit: 500 });
  if (!ok(r) || !r.data) { screen.__real.loaded.delete(key); screen.fbSay('⚠ ' + id + ' — ' + (reasonText(r) || resultText(r)), BAD); return; }
  const fb = screen.__real.fb;
  fb.local = fb.local.filter((x) => x.parent !== id).concat(localEntryItems(root, rel, r.data.entries));
  screen.setState({});
}

/**
 * 그 노드의 바탕화면에서 열기 — terra.daemon.desktop.open.post { root, path, action: open | reveal }.
 * 공유 폴더는 'shared:<이름>', 폴더 탐색기는 로컬 루트 이름. 그 컴퓨터 앞에서 이 화면을 볼 때만 뜻이 있다(Daemon 이 연다)
 */
export async function deskOpen(screen, mode, d, action) {
  const cl = screen.__client, op = 'terra.daemon.desktop.open.post';
  if (!cl) { screen.fbSay('Terra에 로그인해야 연다', BAD); return null; }
  if (!known(cl, op)) { screen.fbSay('이 노드의 Daemon에 열기(desktop.open)가 없다 — 또는 node.control 권한이 없다', WARN); return null; }
  if (!onThisMachine()) { screen.fbSay('이 노드의 바탕화면에 열린다 — 그 컴퓨터에서 이 화면을 볼 때만 쓴다', WARN); return null; }
  const { root, rel } = splitId(d.id);
  const r = await cl.invoke(op, Object.assign({ root: mode === 'repo' ? 'shared:' + root : root, action }, rel ? { path: rel } : {}));
  const good = r.kind === 'ok' || r.kind === 'accepted';
  screen.fbSay(good ? (action === 'reveal' ? '📂 파일 관리자로 열었다 — ' : '↗ 열었다 — ') + d.name
    : d.name + ' — ' + (r.status === 409 && !r.reason ? '실행 파일은 열지 않는다 — 파일 관리자로만 보인다' : reasonText(r) || resultText(r)), good ? OK : BAD);
  return r;
}

/** 이 화면을 그 노드 컴퓨터에서 보고 있나 — 앱 origin app-<id>.localhost 는 같은 기계에서만 풀린다(RFC 6761).
 *  노드 화면은 srcdoc 안이라 location 이 about:srcdoc 이다 — 물려받은 origin 으로 본다 */
export function onThisMachine(origin) {
  let host = '';
  try { host = new URL(origin || (window.origin && window.origin !== 'null' ? window.origin : document.baseURI)).hostname; } catch { return false; }
  return host === 'localhost' || /\.localhost$/.test(host) || /^127\./.test(host) || host === '[::1]' || host === '::1';
}

/** 폴더 보관함 — 들어간 폴더의 항목을 아직 안 읽었으면 읽는다 */
export async function loadFolder(screen, client, id) {
  const { root, rel } = splitId(id);
  if (!root || screen.__real.loaded.has(id)) return;
  screen.__real.loaded.add(id);
  const r = await client.invoke('io.terra.file.entries.list', rel ? { root, path: rel } : { root });
  if (!ok(r) || !r.data) { screen.__real.loaded.delete(id); return; }
  const fb = screen.__real.fb;
  fb.repo = fb.repo.filter((x) => x.parent !== id).concat(entryItems(root, rel, r.data.entries));
  screen.setState({});
}

/** 네트워크 — 이 노드의 진짜 서비스 터널 · WireGuard 상태 */
export async function loadNet(screen, client) {
  const [tun, wg] = await Promise.all([
    client.invoke('terra.daemon.service-tunnels.get', {}),
    client.invoke('terra.daemon.wireguard.status.get', {})
  ]);
  const list = ok(tun) && tun.data && Array.isArray(tun.data.tunnels) ? tun.data.tunnels : [];
  const local = screen.state.localNode.name;
  const netTunnels = list.map((t) => ({
    id: t.id, name: t.service_id || t.id, node: local, port: Number(t.local_port) || Number(String(t.local_address || '').split(':').pop()) || 0,
    to: t.target_node_id || '', proto: 'tcp', open: t.status === 'active' || t.status === 'listening', busy: false
  }));
  screen.__real.wg = ok(wg) && wg.data ? wg.data : null;
  screen.setState({ netTunnels, netPolled: hhmm() });
}

/** 설정 — Daemon 설정 스키마의 키 수 (fields 는 키 → { type, owner, restart_required }) */
async function loadConfigKeys(screen, client) {
  const r = await client.invoke('terra.daemon.config.schema.get', {});
  const f = ok(r) && r.data && r.data.fields;
  const keys = f && typeof f === 'object' ? Object.keys(f) : null;
  screen.__real.configKeys = keys ? { total: keys.length, operator: keys.filter((k) => f[k] && f[k].owner === 'operator').length } : null;
  screen.setState({});
}

/**
 * 실시간 신호(B-5) — Daemon 신호는 알림뿐이다(무엇이 바뀌었는지 id 만). 0.25초 모아서 그 목록을 다시 읽는다:
 *   작업 → 알림 · 장치 · 모듈 → 노드 자원 요약 · 터널 · WireGuard → 네트워크 · 설정 → 설정 키 · 조타륜 앱 목록(wire.js _hbRefresh)
 *   reset(이어 받을 자리를 놓쳤다) → 다 다시 읽는다
 * @param {{ signal: string, data?: any }} ev
 */
export function applySignal(screen, client, ev, wait = 250) {
  const R = screen.__real;
  if (!R || !R.perms || !ev || !ev.signal) return;
  R.sigs.add(ev.signal);
  if (R.sigT) return;
  R.sigT = setTimeout(() => {
    R.sigT = 0;
    const sigs = [...R.sigs];
    R.sigs.clear();
    if (screen.__real === R) runSignals(screen, client, sigs);
  }, wait);
}

function runSignals(screen, client, sigs) {
  const all = sigs.indexOf('reset') >= 0, on = (...xs) => all || xs.some((x) => sigs.indexOf(x) >= 0);
  const local = screen.state.localNode.name;
  if (on('terra.tasks.changed', 'terra.jobs.changed')) void loadAlarms(screen, client);
  if (on('terra.io.devices.changed', 'terra.modules.changed')) void loadResources(screen, client, local);
  if (on('terra.service-tunnels.changed', 'terra.wireguard.changed', 'terra.network.changed')) void loadNet(screen, client);
  if (on('terra.config.changed')) void loadConfigKeys(screen, client);
  const apps = new Set(all ? Object.keys(HELM_APPS) : []);
  sigs.forEach((x) => (SIGNAL_APPS[x] || []).forEach((a) => apps.add(a)));
  if (apps.size && screen._hbRefresh) screen._hbRefresh([...apps], local);
}

/** 로그아웃 · 토큰을 잃었을 때 — 빈 세계로 돌아간다(예시로 돌아가지 않는다) */
export function resetWorld(screen) {
  unbindLayout(screen);   // 저장본은 그대로 둔다 — 다시 로그인하면 되살린다
  if (screen.__real && screen.__real.sigT) clearTimeout(screen.__real.sigT);
  screen.__real = freshReal();
  screen.__client = null;
  screen._mapGoal = null;
  screen.setState(emptyWorld(screen, { name: LOCAL_PLACEHOLDER }));
}
