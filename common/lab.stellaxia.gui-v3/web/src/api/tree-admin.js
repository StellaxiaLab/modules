// Tree 관리 창(읽기) · 기록 창(이력 · 경보) · 핀 · 탐침 · 세션 닫기 단추의 값과 동작 — 계획 §3.1 · §3.13 · §3.2 (P11-5).
//
// 보드(디자인 세션 22 Tree 관리 · 30 기록 창)는 이 모듈이 내는 값만 그린다. 읽기는 모두 위임으로 열려 있고(node.read),
// 쓰기 셋 — 핀 세우기 · 지우기, 탐침 보내기, 경로 세션 닫기 — 는 node.control 이다. 단추가 열릴지는 gates.js 의 gate 가 정한다
// (위임 표 · 계정 권한). 닫기는 T2 라 호출 전에 앱 확인 창이 한 줄씩 보여 줄 문구(confirmOf)를 준다.
// 응답 모양은 계약이 봉투만 정해 두어 필드를 너그럽게 읽는다 — 없는 값은 지어내지 않고 빈 칸으로 둔다.

import { gate } from './gates.js';

export const OPS = {
  nodes: 'terra.master.nodes.get', node: 'terra.master.nodes.by-node-id.get', core: 'terra.master.nodes.by-node-id.core.get',
  nodeOps: 'terra.master.nodes.by-node-id.operations.get', modules: 'terra.master.nodes.by-node-id.modules.get',
  fleets: 'terra.master.fleets.get', fleet: 'terra.master.fleets.by-fleet-id.get', fleetReleases: 'terra.master.fleets.by-fleet-id.releases.get',
  alerts: 'terra.master.monitor.alerts.get', ack: 'terra.master.monitor.alerts.ack.post', snapshot: 'terra.master.monitor.snapshot.get',
  probeHistory: 'terra.master.network.probe-history.get', probe: 'terra.master.network.probes.post',
  sessions: 'terra.master.route.sessions.get', closeSession: 'terra.master.route.sessions.by-session-id.close.post',
  pin: 'terra.master.nodes.by-node-id.modules.pins.post', unpin: 'terra.master.nodes.by-node-id.modules.pins.by-module-id.delete',
  logs: 'terra.daemon.logs.get',
};

const arr = (d, ...ks) => { if (Array.isArray(d)) return d; for (const k of ks) if (d && Array.isArray(d[k])) return d[k]; return []; };
const str = (v) => (v == null ? '' : String(v));
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) || /^0001-/.test(str(iso)) ? 0 : t; };

/** 심각도 → 화면 등급(색은 보드가 입힌다) */
export function sevOf(s) { const v = str(s).toLowerCase(); return /crit|fatal|error|bad|fail/.test(v) ? 'bad' : /warn/.test(v) ? 'warn' : 'info'; }

/** 노드 목록 → Tree 관리 창 › 노드 줄 (3이름 · 연결 · 마지막 하트비트 · 역할 · 부모) */
export function nodeRows(data, now = Date.now()) {
  return arr(data, 'nodes').map((n) => {
    const hb = ms(n.last_heartbeat_at || n.last_seen_at || n.heartbeat_at);
    return { id: str(n.node_id), name: str(n.display_name || n.node_id), clusterAddress: str(n.cluster_address), role: str(n.role), parent: str(n.parent_node_id || n.parent),
      online: /online|connected|ready/i.test(str(n.status)) || n.relay_connected === true, status: str(n.status), heartbeat: hb, heartbeatAgo: hb ? Math.max(0, Math.round((now - hb) / 1000)) : null, tags: arr(n.tags) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** 경보 → 기록 창 줄. 최신순, 같은 때면 확인 안 한 것이 위 */
export function alertRows(data) {
  return arr(data, 'alerts').map((a) => ({ id: str(a.alert_id || a.id), node: str(a.node_id), rule: str(a.rule || a.rule_id), sev: sevOf(a.severity), msg: str(a.message || a.summary),
    at: ms(a.updated_at || a.raised_at || a.at || a.created_at), acked: !!(a.acknowledged || a.acked || a.acknowledged_at) }))
    .sort((a, b) => b.at - a.at || Number(a.acked) - Number(b.acked));
}

/** 탐침 이력 → 줄. 최신순 */
export function probeRows(data) {
  return arr(data, 'probes', 'history', 'entries').map((p) => ({ from: str(p.source_node_id), to: str(p.target_node_id), adapter: str(p.adapter),
    ok: p.reachable != null ? !!p.reachable : !!(p.result && p.result.reachable),
    latency: p.latency_ms != null ? p.latency_ms : ((p.result && p.result.candidate && p.result.candidate.latency_ms) ?? null),
    at: ms(p.observed_at || p.at || (p.result && p.result.observed_at)) })).sort((a, b) => b.at - a.at);
}

/** 경로 세션 → 줄 */
export function sessionRows(data) {
  return arr(data, 'sessions').map((s) => ({ id: str(s.session_id || s.id), from: str(s.source_node_id), to: str(s.target_node_id), channel: str(s.channel), route: str(s.route_type), state: str(s.state) }));
}

/** Daemon 로그 → 마지막 n줄 */
export function logLines(data, n = 200) {
  const L = arr(data, 'lines', 'entries', 'logs').map((l) => (typeof l === 'string' ? l : str(l.line || l.message || l.msg)));
  return L.slice(-n);
}

/** 앱 확인 창(T2) 문구 — 무엇을 · 어느 노드에서 · 되돌릴 수 있나 (§2.2) */
export function confirmOf(kind, o = {}) {
  if (kind === 'closeSession') return { what: '경로 세션 ' + (o.id || '') + ' 닫기 — ' + (o.from || '?') + ' → ' + (o.to || '?'), where: 'Master', undo: '되돌릴 수 있음 — 다시 맺어진다', pick: '' };
  if (kind === 'unpin') return { what: '버전 핀 지우기 — ' + (o.module || ''), where: o.node || '', undo: '되돌릴 수 있음 — 핀을 다시 세운다', pick: o.module || '' };
  return null;
}

/**
 * 읽기 · 단추 묶음. terra 는 createTerra() 결과, who 는 () => whoami(권한 목록).
 * 모든 호출은 실패해도 던지지 않고 { ok:false, err } 로 돌려준다 — "없음"과 "못 봤음"을 가른다.
 */
export function createTreeAdmin(terra, who = () => null) {
  const run = async (op, input, at) => { try { return { ok: true, data: await terra.invoke(op, input || {}, at || {}) }; } catch (e) { return { ok: false, err: { code: (e && e.code) || 'ERROR', message: (e && e.message) || str(e) } }; } };
  const opened = (op) => gate(op, { who: who() });
  const read = async (op, input, map, at) => { const g = opened(op); if (!g.open) return { ok: false, locked: g, rows: [] }; const r = await run(op, input, at); return r.ok ? { ok: true, rows: map(r.data), raw: r.data } : { ok: false, err: r.err, rows: [] }; };
  const write = async (op, input) => { const g = opened(op); if (!g.open) return { ok: false, locked: g }; const r = await run(op, input); return r.ok ? { ok: true, data: r.data } : { ok: false, err: r.err }; };
  return {
    gate: opened,
    nodes: () => read(OPS.nodes, {}, nodeRows),
    node: (id) => run(OPS.node, { node_id: id }),
    core: (id) => run(OPS.core, { node_id: id }),
    nodeOps: (id) => run(OPS.nodeOps, { node_id: id }),
    fleets: () => read(OPS.fleets, {}, (d) => arr(d, 'fleets')),
    alerts: () => read(OPS.alerts, {}, alertRows),
    snapshot: () => run(OPS.snapshot, {}),
    probeHistory: (q = {}) => read(OPS.probeHistory, q, probeRows),
    sessions: () => read(OPS.sessions, {}, sessionRows),
    /** 이 노드 Daemon 로그 — 원격은 P15 라 이 화면은 이 노드만 */
    logs: (n = 200) => read(OPS.logs, { lines: n }, (d) => logLines(d, n)),
    ack: (id) => write(OPS.ack, { alert_id: id }),
    pin: (node, module, version) => write(OPS.pin, { node_id: node, module_id: module, version }),
    unpin: (node, module) => write(OPS.unpin, { node_id: node, module_id: module }),
    probe: (input = {}) => write(OPS.probe, input),
    closeSession: (id) => write(OPS.closeSession, { session_id: id }),
  };
}
