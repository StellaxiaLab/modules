// 제어기의 두 터미널 — 노드 터미널(그 노드의 OS 셸) · Terra 터미널(terra shell 을 닮은 Terra 명령 해석기).
//
// 노드 터미널   terra.daemon.commands.execute.post { command, working_dir, timeout_sec } → { task_id } →
//               terra.daemon.tasks.by-task-id.output.get { task_id, tail } 을 끝날 때까지 읽는다(새 조각만 넘긴다). Ctrl+C = tasks.by-task-id.cancel.post
//               commands.execute 는 계약상 scope local — **이 GUI 를 띄운 노드에서만** 열린다(다른 노드는 Master 중계 밖, LOCAL_ONLY).
//               명령줄은 시스템 기본 셸(/bin/sh -c · cmd /C)에 한 줄로 넘어간다. 한 줄마다 새 셸이라 cd 는 화면이 기억해 working_dir 로 싣는다
// Terra 터미널  Terra CLI 의 `terra shell`(docs/reference/cli/terra-cli-command-reference.ko.md)과 같은 낱말 — help · status · whoami · clear · history ·
//               !! · !<n> · set var · use(현재 노드) 와 node · network · route · session · probe · module · task · daemon · api.
//               CLI 프로세스를 띄우지 않고 같은 이름의 operation 을 Gateway 로 부른다 — 그래서 어느 노드에서나(다른 노드는 Master 중계) 쓴다.
//               `api <operation-id> [--input <json>]` 은 CLI 의 `terra api` 와 같이 계약의 operation 을 바로 부른다(권한은 앱 선언 ∩ 사용자)

import { TerraError, canRemote } from './terra.js';
import { netProps, ROUTE } from './net-props.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const pad = (s, n) => { s = String(s ?? '—'); let w = 0; for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/.test(ch) ? 2 : 1; return s + ' '.repeat(Math.max(1, n - w)); };
const table = (cols, rows) => { const W = cols.map((c, i) => Math.min(28, Math.max(String(c[1] ?? c).length + 2, ...rows.map((r) => String(r[i] ?? '—').length + 2)))); return [cols.map((c, i) => pad(c, W[i])).join('').trimEnd(), ...rows.map((r) => r.map((v, i) => pad(v ?? '—', W[i])).join('').trimEnd())]; };
const when = (iso) => { const t = Date.parse(iso || ''); if (Number.isNaN(t) || /^0001-/.test(String(iso))) return '—'; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };

/** 한 줄 → 낱말. 큰따옴표 · 작은따옴표로 묶고, $이름 은 변수로 바꾼다(작은따옴표 안은 그대로) */
export function tokenize(line, vars = {}) {
  const out = []; let cur = '', q = '', has = false;
  const flush = () => { if (has) out.push(cur); cur = ''; has = false; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) { q = ''; continue; } if (c === '$' && q === '"') { const m = /^\$([A-Za-z_]\w*)/.exec(line.slice(i)); if (m) { cur += vars[m[1]] ?? ''; i += m[0].length - 1; continue; } } cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { flush(); continue; }
    if (c === '$') { const m = /^\$([A-Za-z_]\w*)/.exec(line.slice(i)); if (m) { cur += vars[m[1]] ?? ''; i += m[0].length - 1; has = true; continue; } }
    cur += c; has = true;
  }
  if (q) throw new TerraError('BAD_INPUT', '따옴표가 닫히지 않았다', 0);
  flush(); return out;
}

/** 히스토리 펼치기 — !! · !<번호>. 펼친 줄(없으면 null) */
export function expandHistory(line, hist) {
  const t = line.trim();
  if (t === '!!') return hist.length ? hist[hist.length - 1] : null;
  const m = /^!(\d+)$/.exec(t); if (m) { const h = hist[Number(m[1]) - 1]; return h ?? null; }
  return line;
}

export const TERRA_HELP = [
  'Terra 터미널 — terra shell 과 같은 낱말. 명령 앞의 terra 는 써도 되고 안 써도 된다',
  '  help · clear · history · !! · !<번호>         셸',
  '  set var <이름> <값> · vars                     변수 — 명령에서 $이름',
  '  use <노드>                                    현재 노드(노드 이름 · node_id 앞부분 · .terra · 클러스터 주소)',
  '  status · whoami                               연결 · 로그인 주체와 권한',
  '  node list · node get [노드]                   Master 노드 기록',
  '  network status · network node [노드]          광고 전송 · 주소 · 노드 간 경로',
  '  route graph · route candidates <가> <나>       경로 후보 · 거부 사유  (route diagnose 도 같음)',
  '  session list · probe list                     라우트 세션 · 연결 진단 기록',
  '  module list [노드] · task list [노드]          그 노드의 모듈 · 작업(Daemon — 다른 노드는 중계)',
  '  task get <id> · daemon status [노드]',
  '  api <operation-id> [--input <json>]           계약의 operation 을 현재 노드에서 바로 (terra api)',
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

  // ── 노드 터미널 ──
  const node = {
    /** 이 노드에서 열 수 있나 — commands.execute 는 scope local */
    can(rid) { return !rid || rid === localId(); },
    /**
     * @param {string} rid 그 노드(빈 칸 = 로컬)
     * @param {string} line 셸 한 줄
     * @param {{ cwd?: string, timeoutSec?: number, onChunk?: (c: { stream: string, text: string }) => void, signal?: { stop?: boolean, taskId?: string }, pollMs?: number, sleep?: (ms: number) => Promise<void> }} [o]
     */
    async run(rid, line, o = {}) {
      if (!node.can(rid)) throw new TerraError('LOCAL_ONLY', '노드 셸은 이 GUI 를 띄운 노드에서만 — Terra 의 명령 실행(commands.execute)은 다른 노드로 중계되지 않는다. Terra 터미널은 어느 노드에서나 된다', 0);
      const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))), input = { command: line, timeout_sec: o.timeoutSec ?? 120 };
      if (o.cwd) input.working_dir = o.cwd;
      const acc = await terra.invoke('terra.daemon.commands.execute.post', input), id = acc && (acc.task_id || acc.id);
      if (!id) throw new TerraError('BAD_RESPONSE', '작업 id 를 받지 못했다', 0);
      if (o.signal) o.signal.taskId = id;
      let seq = -1, state = '', guard = 0;
      for (;;) {
        const d = await terra.invoke('terra.daemon.tasks.by-task-id.output.get', { task_id: id, tail: 400 });
        for (const c of arr(d && d.chunks)) { const s = c.seq ?? -1; if (s > seq) { seq = s; if (o.onChunk) o.onChunk({ stream: c.stream || 'stdout', text: String(c.text ?? '') }); } }
        state = (d && d.state) || state;
        if (d && (d.complete || d.captured === false)) break;
        if (o.signal && o.signal.stop) { await terra.invoke('terra.daemon.tasks.by-task-id.cancel.post', { task_id: id }).catch(() => {}); state = 'cancelled'; break; }
        if (++guard > 2000) break;
        await sleep(o.pollMs ?? 600);
      }
      let exit = null; try { const t = await terra.invoke('terra.daemon.tasks.by-task-id.get', { task_id: id }); exit = t && (t.exit_code ?? (t.result && t.result.exit_code)); state = (t && (t.state || t.status)) || state; } catch (e) { /* 상태를 못 읽어도 출력은 이미 보였다 */ }
      return { taskId: id, state, exit };
    },
    /** cd — 한 줄마다 새 셸이라 화면이 cwd 를 기억한다. 그 노드에서 cd 한 뒤의 pwd 를 받아 온다 */
    async cd(rid, dir, cwd) {
      let out = '';
      const r = await node.run(rid, 'cd ' + (dir || '~') + ' && pwd', { cwd, timeoutSec: 10, onChunk: (c) => { if (c.stream !== 'stderr') out += c.text; } });
      const p = out.trim().split('\n').pop();
      if (!p || (r.exit != null && r.exit !== 0)) throw new TerraError('NOT_FOUND', 'cd: ' + dir + ' — 그런 폴더가 없다', 0);
      return p;
    },
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
      const op = a[0]; if (!op) throw new TerraError('BAD_INPUT', 'api <operation-id> [--input <json>]', 0);
      const i = a.indexOf('--input'); let input = {}; if (i >= 0) { try { input = JSON.parse(a[i + 1] || '{}'); } catch { throw new TerraError('BAD_INPUT', '--input 은 JSON 객체', 0); } }
      if (cx.cur && cx.cur !== localId() && !canRemote(op)) throw new TerraError('LOCAL_ONLY', op + ' 은 그 노드에서만 — 현재 노드가 다른 노드라 부를 수 없다(use 로 이 노드로)', 0);
      const d = await terra.invoke(op, input, op.startsWith('terra.master.') ? {} : at(cx.cur));
      return say(JSON.stringify(d, null, 2).split('\n').slice(0, 400));
    },
  };
  terraCmd.sessions = terraCmd.session; terraCmd.probes = terraCmd.probe; terraCmd.modules = terraCmd.module; terraCmd.tasks = terraCmd.task; terraCmd.nodes = terraCmd.node;

  /**
   * Terra 터미널 한 줄. 셸 낱말(help · clear · history · set var · use)은 화면이 상태를 들고 있어 여기서는 결과만 돌려준다
   * @param {string} line
   * @param {{ cur?: string, curName?: string, vars?: Record<string,string>, hist?: string[] }} cx
   * @returns {Promise<{ lines: { t: string, c: string }[], clear?: boolean, cur?: string, curName?: string, vars?: Record<string,string> }>}
   */
  const terraRun = async (line, cx = {}) => {
    const words = tokenize(line, cx.vars || {}); if (words[0] === 'terra') words.shift();
    const [cmd, ...a] = words;
    if (!cmd) return { lines: [] };
    if (cmd === 'help' || cmd === '?') return { lines: say(TERRA_HELP, 'dim') };
    if (cmd === 'clear') return { lines: [], clear: true };
    if (cmd === 'history') return { lines: say((cx.hist || []).map((h, i) => String(i + 1).padStart(4) + '  ' + h), 'dim') };
    if (cmd === 'vars') return { lines: say(Object.entries(cx.vars || {}).map(([k, v]) => k + '=' + v)) };
    if (cmd === 'set') { if (a[0] !== 'var' || !a[1]) throw new TerraError('BAD_INPUT', 'set var <이름> <값>', 0); return { lines: [], vars: Object.assign({}, cx.vars, { [a[1]]: a.slice(2).join(' ') }) }; }
    if (cmd === 'use') { if (!a[0] || a[0] === '.' || a[0] === 'self') return { lines: say(['현재 노드 = 이 노드'], 'dim'), cur: '', curName: '' }; const id = await resolve(a[0]), list = await nodes(); return { lines: say(['현재 노드 = ' + nameOf(list, id) + ' (' + id + ')'], 'dim'), cur: id, curName: nameOf(list, id) }; }
    const f = terraCmd[cmd];
    if (!f) throw new TerraError('NOT_FOUND', cmd + ' — 모르는 명령 (help)', 0);
    return { lines: await f(a, cx) };
  };

  return { node, terra: { run: terraRun, resolve } };
}
