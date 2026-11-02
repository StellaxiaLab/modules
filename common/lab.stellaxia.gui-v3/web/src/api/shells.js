// 제어기의 두 터미널 — 노드 터미널(그 노드의 OS 셸, 잠김) · Terra 터미널(terra shell 을 닮은 Terra 명령 해석기).
//
// 노드 터미널   잠겼다(NODE_SHELL). 설계(docs/design/node-shell.md)가 정해지기 전까지 실행하지 않는다 — 명령 한 줄을 시스템 셸로 돌리는
//               terra.daemon.commands.execute.post 를 웹에서 부르면 앱 토큰의 process.execute 하나로 그 노드의 임의 실행이 열리고,
//               managed 승격 데몬(Windows)에서는 그것이 관리자 실행이 된다. 누가 · 어느 노드에서 · 무엇이 남는가를 정한 뒤 연다.
// Terra 터미널  Terra CLI 의 `terra shell`(docs/reference/cli/terra-cli-command-reference.ko.md)과 같은 낱말 — help · status · whoami · clear · history ·
//               !! · !<n> · use(현재 노드) 와 node · network · route · session · probe · module · task · daemon · api.
//               CLI 프로세스를 띄우지 않고 같은 이름의 operation 을 Gateway 로 부른다 — 그래서 어느 노드에서나(다른 노드는 Master 중계) 쓴다.
//               셸이 아니다: 따옴표 · $변수 · ; | & < > ` \ ( ) { } * ? ! ~ 따위는 받지 않는다(낱말은 SAFE_WORD 만).
//               부르는 operation 은 모두 읽기이고, 위임표(op-scope.json · master-delegated.json)에 있는 것뿐이다(TERRA_OPS).
//               `api <operation-id> [이름=값 …]` 도 그 표에서 risk read(Master 는 GET)인 것만 — 쓰기 · 위험 operation 은 "여기서 못 함 + 대신 할 곳"으로 답한다.

import { TerraError, canRemote } from './terra.js';
import { netProps, ROUTE } from './net-props.js';
import SCOPE from './op-scope.json' with { type: 'json' };
import MASTER from './master-delegated.json' with { type: 'json' };

const arr = (v) => (Array.isArray(v) ? v : []);
const pad = (s, n) => { s = String(s ?? '—'); let w = 0; for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/.test(ch) ? 2 : 1; return s + ' '.repeat(Math.max(1, n - w)); };
const table = (cols, rows) => { const W = cols.map((c, i) => Math.min(28, Math.max(String(c[1] ?? c).length + 2, ...rows.map((r) => String(r[i] ?? '—').length + 2)))); return [cols.map((c, i) => pad(c, W[i])).join('').trimEnd(), ...rows.map((r) => r.map((v, i) => pad(v ?? '—', W[i])).join('').trimEnd())]; };
const when = (iso) => { const t = Date.parse(iso || ''); if (Number.isNaN(t) || /^0001-/.test(String(iso))) return '—'; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };

/** 노드 터미널 — 잠금과 그 이유. 설계가 정해지면 여기서 연다(보드는 이 값만 본다) */
export const NODE_SHELL = Object.freeze({
  locked: true,
  reason: '노드 셸은 잠겨 있다 — 누가 열 수 있는지 · 다른 노드 허용 · 감사 기록 · 대화형 전송(PTY)을 정하는 설계가 먼저다',
  design: 'docs/design/node-shell.md',
  instead: Object.freeze(['읽기 · 상태는 Terra 터미널(독의 >T)', '모듈 시작 · 멈춤은 모듈 창', '작업 출력 · 취소는 작업 관리자', '그 노드에서 직접: terra CLI 또는 OS 터미널']),
});

/** Gateway 자기 operation 중 Terra 터미널이 부르는 것(위임표 둘 밖 — Gateway 가 앱 토큰으로 직접 답한다) */
export const GATEWAY_READS = Object.freeze(['terra.gateway.agent.whoami.get']);

/** 명령 → 부르는 operation. 시험이 이 표의 모든 op 가 위임표에 있고 읽기인지 본다 */
export const TERRA_OPS = Object.freeze({
  status: ['terra.daemon.status.get', 'terra.gateway.agent.whoami.get', 'terra.master.nodes.get'],
  whoami: ['terra.gateway.agent.whoami.get'],
  node: ['terra.master.nodes.get'],
  use: ['terra.master.nodes.get'],
  network: ['terra.master.network.status.get', 'terra.master.network.state.get', 'terra.master.route.graph.get', 'terra.master.nodes.get'],
  route: ['terra.master.route.graph.get', 'terra.master.route.candidates.get', 'terra.master.nodes.get'],
  session: ['terra.master.route.sessions.get', 'terra.master.nodes.get'],
  probe: ['terra.master.network.probes.get', 'terra.master.nodes.get'],
  module: ['terra.daemon.modules.get', 'terra.master.nodes.get'],
  task: ['terra.daemon.tasks.get', 'terra.daemon.tasks.by-task-id.get', 'terra.master.nodes.get'],
  daemon: ['terra.daemon.status.get', 'terra.master.nodes.get'],
});

/** 낱말 하나에 허용하는 글자 — 이름 · id · 주소 · 이름=값. 이 밖의 글자가 하나라도 있으면 줄 전체를 거절한다 */
export const SAFE_WORD = /^[A-Za-z0-9가-힣._:@/=+,%-]+$/;

/** 한 줄 → 낱말. 셸 문법(따옴표 · $변수 · 메타문자)은 해석하지 않고 거절한다 */
export function tokenize(line) {
  line = String(line);
  if (/[\r\n]/.test(line)) throw new TerraError('SHELL_SYNTAX', '여러 줄은 받지 않는다 — 한 줄에 명령 하나', 0);
  const words = line.trim().split(/[ \t]+/).filter(Boolean);
  const bad = words.find((w) => !SAFE_WORD.test(w));
  if (bad) { const ch = [...bad].find((c) => !SAFE_WORD.test(c)); throw new TerraError('SHELL_SYNTAX', '셸 문법은 받지 않는다(' + JSON.stringify(ch) + ') — Terra 터미널은 셸이 아니다. 노드 셸은 잠겨 있다(' + NODE_SHELL.design + ')', 0); }
  return words;
}

/** 히스토리 펼치기 — !! · !<번호>. 펼친 줄(없으면 null) */
export function expandHistory(line, hist) {
  const t = line.trim();
  if (t === '!!') return hist.length ? hist[hist.length - 1] : null;
  const m = /^!(\d+)$/.exec(t); if (m) { const h = hist[Number(m[1]) - 1]; return h ?? null; }
  return line;
}

const LOCKED_SHELL = '노드 셸 — 잠김(' + NODE_SHELL.design + ')';
/** 위임 밖 명령 — 여기서 못 하는 것과 대신 할 곳. [첫 낱말, 둘째 낱말(null 이면 무엇이든), 대신 할 곳] */
export const ELSEWHERE = Object.freeze([
  ['module', /^(install|uninstall|start|stop|restart|enable|disable|config|scan|assign|unassign)$/, '모듈 창(제어기 독의 퍼즐) — 설치는 검토 요약을 본 뒤에'],
  ['task', /^(cancel|rerun|run|exec|output)$/, '작업 관리자'],
  ['job', null, '작업 관리자'], ['jobs', null, '작업 관리자'],
  ['config', null, '설정 창 › 노드 설정(검사 · 저장 · 적용)'],
  ['daemon', /^(restart|stop|start|config)$/, '그 노드의 terra CLI(terra daemon …)'],
  ['enroll', null, '설정 창 › 등록'],
  ['wireguard', null, '네트워크 창 · 설정 창 › 네트워크'], ['wg', null, '네트워크 창 · 설정 창 › 네트워크'],
  ['tunnel', null, '네트워크 창(서비스 터널)'],
  ['svi', null, '자원 관리 창'], ['grant', null, '자원 관리 창'], ['bind', null, '자원 관리 창'],
  ['io', null, '자원 관리 창 › 장치'], ['device', null, '자원 관리 창 › 장치'],
  ['login', null, '셸의 로그인 화면 — 웹은 비밀번호를 받지 않는다'], ['logout', null, '전역 틀의 로그아웃'],
  ['exec', null, LOCKED_SHELL], ['run', null, LOCKED_SHELL], ['shell', null, LOCKED_SHELL],
  ['sh', null, LOCKED_SHELL], ['bash', null, LOCKED_SHELL], ['cmd', null, LOCKED_SHELL], ['powershell', null, LOCKED_SHELL], ['sudo', null, LOCKED_SHELL],
  ['set', null, 'Terra 터미널에는 변수가 없다 — 값을 그대로 쓴다'], ['vars', null, 'Terra 터미널에는 변수가 없다'],
]);
const elsewhere = (cmd, sub) => { const r = ELSEWHERE.find(([a, b]) => a === cmd && (!b || b.test(sub || ''))); return r ? r[2] : null; };

function whereFor(op) {
  const R = [[/commands\.execute/, LOCKED_SHELL], [/\.modules\./, '모듈 창'], [/\.tasks\.|\.jobs\./, '작업 관리자'], [/\.config\./, '설정 창 › 노드 설정'],
    [/\.wireguard\.|\.service-tunnels/, '네트워크 창'], [/\.svi\.|\.io\./, '자원 관리 창'], [/\.enrollment\./, '설정 창 › 등록'], [/desktop\.open/, '파일 관리자 › 노드에서 열기'], [/\.restart\./, '그 노드의 terra CLI']];
  const r = R.find(([re]) => re.test(op)); return r ? r[1] : '그 기능의 창, 또는 그 노드의 terra CLI';
}

/** api 로 부를 수 있는 operation 인가 — 위임표에 있고 읽기인 것만. { ok, kind } 또는 { ok: false, code, why, where } */
export function apiAllowed(op) {
  if (GATEWAY_READS.includes(op)) return { ok: true, kind: 'gateway' };
  const D = SCOPE.operations[op];
  if (D) return D.risk === 'read' && !D.permissions.includes('process.execute') ? { ok: true, kind: 'daemon' } : { ok: false, code: 'NOT_HERE', why: op + ' — ' + D.risk + ' operation(' + D.permissions.join(' ') + ')은 Terra 터미널에서 부르지 않는다', where: whereFor(op) };
  const M = MASTER.operations[op];
  if (M) return M.method === 'GET' ? { ok: true, kind: 'master' } : { ok: false, code: 'NOT_HERE', why: op + ' — Master 쓰기(' + M.method + ')는 Terra 터미널에서 부르지 않는다', where: whereFor(op) };
  if (op.startsWith('terra.master.')) return { ok: false, code: 'DELEGATION_NOT_OPEN', why: op + ' — 앱 자격(위임 입구)으로 닿지 않는 Master operation', where: 'B 모드(단독 GUI · 자격 핸들) 또는 그 Tree 의 terra CLI' };
  return { ok: false, code: 'NOT_DELEGATED', why: op + ' — 위임표(op-scope · master-delegated)에 없는 operation', where: '그 기능의 창, 또는 그 노드의 terra CLI(terra api)' };
}
const notHere = (why, where, code) => new TerraError(code || 'NOT_HERE', why + ' — 여기서 못 함. 대신: ' + where, 0);

export const TERRA_HELP = [
  'Terra 터미널 — terra shell 과 같은 낱말(읽기만). 명령 앞의 terra 는 써도 되고 안 써도 된다 · 셸 문법은 받지 않는다',
  '  help · clear · history · !! · !<번호>         셸',
  '  use <노드>                                    현재 노드(노드 이름 · node_id 앞부분 · .terra · 클러스터 주소)',
  '  status · whoami                               연결 · 로그인 주체와 권한',
  '  node list · node get [노드]                   Master 노드 기록',
  '  network status · network node [노드]          광고 전송 · 주소 · 노드 간 경로',
  '  route graph · route candidates <가> <나>       경로 후보 · 거부 사유  (route diagnose 도 같음)',
  '  session list · probe list                     라우트 세션 · 연결 진단 기록',
  '  module list [노드] · task list [노드]          그 노드의 모듈 · 작업(Daemon — 다른 노드는 중계)',
  '  task get <id> · daemon status [노드]',
  '  api <operation-id> [이름=값 …]                위임표의 읽기 operation 을 현재 노드에서 (terra api)',
  '  쓰기(모듈 시작 · 설정 · 작업 취소 …)는 각 창에서 — 노드 셸은 잠김',
];

/**
 * @param {{ invoke: (op: string, input?: object, at?: { node?: string }) => Promise<any> }} terra
 * @param {() => any} topo 지금 지도(window.TerraTopology) — localId · node(rid)
 */
export function createShells(terra, topo) {
  let nodesP = null, nodesT = 0;
  const nodes = () => { if (!nodesP || Date.now() - nodesT > 10000) { nodesT = Date.now(); nodesP = terra.invoke('terra.master.nodes.get', {}).then((d) => (Array.isArray(d) ? d : (d && d.nodes) || []), (e) => { nodesP = null; throw e; }); } return nodesP; };
  const localId = () => { const T = topo(); return (T && T.localId) || ''; };
  const at = (rid) => (rid && rid !== localId() ? { node: rid } : {});
  const nameOf = (list, id) => { const n = list.find((x) => x.node_id === id); return (n && n.display_name) || (id ? String(id).slice(0, 10) : '—'); };
  /** 노드 이름 · id 앞부분 · .terra · 클러스터 주소 → node_id */
  const resolve = async (ref, cur) => {
    if (!ref) { if (cur) return cur; throw new TerraError('BAD_INPUT', '노드를 정하지 않았다 — use <노드> 또는 명령 뒤에 노드', 0); }
    const list = await nodes(), r = String(ref).replace(/\.terra$/, '');
    const hit = list.find((n) => n.node_id === r || n.display_name === r || n.dns_label === r || n.cluster_address === r) || list.filter((n) => String(n.node_id).startsWith(r));
    if (Array.isArray(hit)) { if (hit.length === 1) return hit[0].node_id; throw new TerraError('NOT_FOUND', hit.length ? ref + ' — 여러 노드가 맞는다(' + hit.map((n) => n.display_name || n.node_id).join(', ') + ')' : ref + ' — Master 노드 목록에 없다', 0); }
    return hit.node_id;
  };

  // ── 노드 터미널 — 잠김(NODE_SHELL). 실행 길은 두지 않는다 ──
  const node = {
    locked: NODE_SHELL.locked,
    can() { return false; },
    async run() { throw new TerraError('LOCKED', NODE_SHELL.reason + ' (' + NODE_SHELL.design + ')', 0); },
    async cd() { throw new TerraError('LOCKED', NODE_SHELL.reason, 0); },
  };

  // ── Terra 터미널 ──
  const say = (lines, c) => arr(lines).map((t) => ({ t, c: c || 'out' }));
  const terraCmd = {
    async status(a, cx) {
      const [st, who, list] = await Promise.all([terra.invoke('terra.daemon.status.get', {}).catch((e) => ({ err: e })), terra.invoke('terra.gateway.agent.whoami.get', {}).catch(() => null), nodes().catch(() => null)]);
      const d = (st && st.daemon) || {}, en = (st && st.enrollment) || {};
      return say(['Gateway   닿음' + (st && st.err ? ' · Daemon 읽기 실패 ' + (st.err.code || '') : ''), '노드      ' + (d.device_name || '—') + '  ' + (d.node_id || en.node_id || '—') + (d.runtime_state ? '  ' + d.runtime_state : ''),
        '등록      ' + (en.state || en.status || (en.node_id ? '등록됨' : '—')), 'Master    ' + (list ? '닿음 · 노드 ' + list.length + '개' : '닿지 않음'), '주체      ' + ((who && (who.principal || who.user_id)) || '—'), '현재 노드 ' + (cx.cur ? cx.curName || cx.cur : '이 노드')]);
    },
    async whoami() { const w = await terra.invoke('terra.gateway.agent.whoami.get', {}); return say(['주체      ' + (w.principal || w.user_id || '—'), '종류      ' + (w.kind || w.principal_kind || '—'), '권한      ' + (arr(w.permissions).join(' ') || '—')]); },
    async node(a, cx) {
      const sub = a[0] || 'list', list = await nodes();
      if (sub === 'list') return say(table(['이름', 'node_id', '상태', '중계', '주소', '버전', '하트비트'], list.map((n) => [n.display_name || '—', String(n.node_id).slice(0, 12), n.status, n.relay_connected ? '예' : '아니오', n.cluster_address, n.daemon_version, when(n.last_heartbeat_at)])));
      if (sub === 'get' || sub === 'status') { const id = await resolve(a[1], cx.cur), n = list.find((x) => x.node_id === id) || {}, r = n.resource || {};
        return say(['이름      ' + (n.display_name || '—'), 'node_id   ' + id, '역할      ' + (arr(n.roles).join(', ') || '—'), '부모      ' + (n.parent_node_id ? nameOf(list, n.parent_node_id) : '— (맨 위)'), '상태      ' + (n.status || '—') + ' · 중계 ' + (n.relay_connected ? '연결됨' : '끊김'),
          '주소      ' + (n.cluster_address || '—') + (n.dns_label ? '  ' + n.dns_label + '.terra' : ''), '버전      ' + (n.daemon_version || '—'), '하트비트  ' + when(n.last_heartbeat_at), '자원      CPU ' + (r.cpu_percent ?? '—') + '% · MEM ' + (r.memory_percent ?? '—') + '% · DISK ' + (r.disk_percent ?? '—') + '%']); }
      throw new TerraError('BAD_INPUT', 'node ' + sub + ' — node list · node get [노드]', 0);
    },
    async network(a, cx) {
      const sub = a[0] || 'status';
      if (sub === 'status') { const d = await terra.invoke('terra.master.network.status.get', {}), N = arr(d && d.nodes);
        return say(table(['노드', '상태', '중계', '세대', '광고 전송'], N.map((n) => [n.display_name || String(n.node_id).slice(0, 10), n.status, n.relay_connected ? '예' : '아니오', n.network_generation, arr(n.transport_capabilities).map((x) => (x.capability || x).adapter).join(', ') || '—']))); }
      if (sub === 'node') { const id = await resolve(a[1], cx.cur), [st, state, graph, list] = await Promise.all([terra.invoke('terra.master.network.status.get', {}), terra.invoke('terra.master.network.state.get', {}), terra.invoke('terra.master.route.graph.get', {}).catch(() => null), nodes()]);
        const v = netProps(list.find((n) => n.node_id === id) || { node_id: id }, { status: st, state, graph }, { id });
        return say(v.addrs.map((x) => pad(x.k, 16) + pad(x.v, 24) + (x.src || '')).concat(['', '광고 전송'], v.caps.map((c) => '  ' + pad(c.ad, 11) + pad(c.reach, 8) + c.ep), ['', '다른 노드와의 경로'], v.links.map((l) => '  ' + pad(l.peer, 14) + pad(l.via.rtT, 14) + pad(l.via.ad, 11) + (l.lat || ''))));
      }
      throw new TerraError('BAD_INPUT', 'network ' + sub + ' — network status · network node [노드]', 0);
    },
    async route(a, cx) {
      const sub = a[0] || 'graph', list = await nodes();
      if (sub === 'graph') { const d = await terra.invoke('terra.master.route.graph.get', {});
        return say(['경로 그래프 ' + (d && d.route_graph_epoch != null ? d.route_graph_epoch : '—')].concat(table(['출발', '도착', '고를 경로', 'adapter', '지연'], arr(d && d.edges).map((e) => { const c = arr(e.candidates).find((x) => x.healthy) || arr(e.candidates)[0] || {}; return [nameOf(list, e.source_node_id), nameOf(list, e.target_node_id), c.route_type ? (ROUTE[c.route_type] || {}).t || c.route_type : '없음', c.adapter, c.latency_ms != null ? c.latency_ms + 'ms' : '—']; })))); }
      if (sub === 'candidates' || sub === 'diagnose' || sub === 'explain') { const s = await resolve(a[1], cx.cur), t = await resolve(a[2]), d = await terra.invoke('terra.master.route.candidates.get', { source_node_id: s, target_node_id: t });
        const row = (c, ok) => (ok ? (c.healthy ? '✓ ' : '! ') : '× ') + pad((ROUTE[c.route_type] || {}).t || c.route_type, 13) + pad(c.adapter, 11) + pad(c.latency_ms != null ? c.latency_ms + 'ms' : '', 7) + (c.reason || '');
        return say([nameOf(list, s) + ' → ' + nameOf(list, t) + ' · 정책 ' + ((d && d.policy_source) || '—')]).concat(say(arr(d && d.candidates).map((c) => row(c, true))), say(arr(d && d.denied_candidates).map((c) => row(c, false)), 'dim')); }
      throw new TerraError('BAD_INPUT', 'route ' + sub + ' — route graph · route candidates <가> <나>', 0);
    },
    async session(a) { const [d, list] = await Promise.all([terra.invoke('terra.master.route.sessions.get', {}), nodes()]);
      return say(table(['세션', '출발', '도착', '채널', '경로', '상태'], arr(d && d.sessions).map((s) => [String(s.id).slice(0, 10), nameOf(list, s.source_node_id), nameOf(list, s.target_node_id), s.channel, (ROUTE[s.route_type] || {}).t || s.route_type, s.state]))); },
    async probe(a) { const [d, list] = await Promise.all([terra.invoke('terra.master.network.probes.get', {}), nodes()]);
      return say(table(['출발', '도착', 'adapter', '닿음', '때', '오류'], arr(d && d.probes).map((p) => { const r = p.result || {}; return [nameOf(list, p.source_node_id), nameOf(list, p.target_node_id), p.adapter, r.reachable ? '예' : '아니오', when(r.observed_at), r.error_code]; }))); },
    async module(a, cx) { const id = a[1] ? await resolve(a[1]) : cx.cur, d = await terra.invoke('terra.daemon.modules.get', {}, at(id)), M = arr(d && (d.modules || d.items || d));
      return say(table(['모듈', '버전', '상태', '켜짐'], M.map((m) => [m.id || m.module_id, m.version, m.state || m.status, m.enabled === false ? '아니오' : '예']))); },
    async task(a, cx) {
      if (a[0] === 'get') { const t = await terra.invoke('terra.daemon.tasks.by-task-id.get', { task_id: a[1] }, at(cx.cur)); return say(Object.entries(t || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => pad(k, 16) + v)); }
      const id = a[1] ? await resolve(a[1]) : cx.cur, d = await terra.invoke('terra.daemon.tasks.get', {}, at(id)), T = arr(d && (d.tasks || d.items || d));
      return say(table(['작업', '종류', '상태', '만든 때'], T.slice(0, 30).map((t) => [String(t.id || t.task_id).slice(0, 14), t.type || t.kind, t.state || t.status, when(t.created_at)]))); },
    async daemon(a, cx) { if ((a[0] || 'status') !== 'status') throw new TerraError('BAD_INPUT', 'daemon status [노드]', 0);
      const id = a[1] ? await resolve(a[1]) : cx.cur, d = await terra.invoke('terra.daemon.status.get', {}, at(id));
      return say(JSON.stringify(d, null, 2).split('\n')); },
    async api(a, cx) {
      const op = a[0]; if (!op) throw new TerraError('BAD_INPUT', 'api <operation-id> [이름=값 …]', 0);
      const ok = apiAllowed(op); if (!ok.ok) throw notHere(ok.why, ok.where, ok.code);
      const input = {}; for (const kv of a.slice(1)) { const m = /^([A-Za-z_][\w.-]*)=(.*)$/.exec(kv); if (!m) throw new TerraError('BAD_INPUT', kv + ' — 입력은 이름=값', 0); input[m[1]] = m[2]; }
      if (ok.kind === 'daemon' && cx.cur && cx.cur !== localId() && !canRemote(op)) throw new TerraError('LOCAL_ONLY', op + ' 은 그 노드에서만 — 현재 노드가 다른 노드라 부를 수 없다(use 로 이 노드로)', 0);
      const d = await terra.invoke(op, input, ok.kind === 'daemon' ? at(cx.cur) : {});
      return say(JSON.stringify(d, null, 2).split('\n').slice(0, 400));
    },
  };
  terraCmd.sessions = terraCmd.session; terraCmd.probes = terraCmd.probe; terraCmd.modules = terraCmd.module; terraCmd.tasks = terraCmd.task; terraCmd.nodes = terraCmd.node;

  /**
   * Terra 터미널 한 줄. 셸 낱말(help · clear · history · use)은 화면이 상태를 들고 있어 여기서는 결과만 돌려준다
   * @param {string} line
   * @param {{ cur?: string, curName?: string, hist?: string[] }} cx
   * @returns {Promise<{ lines: { t: string, c: string }[], clear?: boolean, cur?: string, curName?: string }>}
   */
  const terraRun = async (line, cx = {}) => {
    const words = tokenize(line); if (words[0] === 'terra') words.shift();
    const [cmd, ...a] = words;
    if (!cmd) return { lines: [] };
    if (cmd === 'help' || cmd === '?') return { lines: say(TERRA_HELP, 'dim') };
    if (cmd === 'clear') return { lines: [], clear: true };
    if (cmd === 'history') return { lines: say((cx.hist || []).map((h, i) => String(i + 1).padStart(4) + '  ' + h), 'dim') };
    const away = elsewhere(cmd, a[0]); if (away) throw notHere(words.join(' '), away);
    if (cmd === 'use') { if (!a[0] || a[0] === '.' || a[0] === 'self') return { lines: say(['현재 노드 = 이 노드'], 'dim'), cur: '', curName: '' }; const id = await resolve(a[0]), list = await nodes(); return { lines: say(['현재 노드 = ' + nameOf(list, id) + ' (' + id + ')'], 'dim'), cur: id, curName: nameOf(list, id) }; }
    const f = terraCmd[cmd];
    if (!f) throw new TerraError('NOT_FOUND', cmd + ' — 모르는 명령 (help)', 0);
    return { lines: await f(a, cx) };
  };

  return { NODE_SHELL, node, terra: { run: terraRun, resolve } };
}
