// Tree 관리 창(읽기) · 기록 창(이력 · 경보) · 핀 · 탐침 · 세션 닫기 단추의 값과 동작 — 계획 §3.1 · §3.13 · §3.2 (P11-5).
//
// 보드(디자인 세션 22 Tree 관리 · 30 기록 창)는 이 모듈이 내는 값만 그린다. 읽기는 모두 위임으로 열려 있고(node.read),
// 쓰기 셋 — 핀 세우기 · 지우기, 탐침 보내기, 경로 세션 닫기 — 는 node.control 이다. 단추가 열릴지는 gates.js 의 gate 가 정한다
// (위임 표 · 계정 권한). 닫기는 T2 라 호출 전에 앱 확인 창이 한 줄씩 보여 줄 문구(confirmOf)를 준다.
// P14-4 : 쓰기 — 모듈 게시 · 승격 심사 · 정책, 코어 롤아웃, Master 설정 — 은 모두 승인 문(approve, T3 · T4)으로만 나간다. 이 파일은 페이지가 부르지 않고
// 호스트가 사람 앞에서 부르게 *제안*만 한다(approveOp). 쓰기는 Master 에만 있어 Tree 노드가 아니면 창이 이유를 보인다(treeReason).
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
  // P14-4 읽기 — 모두 node.read(설정 셋만 master.admin)
  publications: 'terra.master.modules.publications.get', promotions: 'terra.master.modules.promotions.get', ceilingGet: 'terra.master.modules.approval-ceiling.get',
  mirrorBlocks: 'terra.master.modules.mirror-blocks.get', coreReleases: 'terra.master.core.releases.get',
  configGet: 'terra.master.config.get', configSchema: 'terra.master.config.schema.get', configValidate: 'terra.master.config.validate.post',
};

/** P14-4 쓰기 — 단추 이름 → [operation, 등급]. 등급은 Terra 계약(execution.approval.tier)과 같다(시험이 표를 맞춰 본다). 모두 승인 문 대상 */
export const WRITES = Object.freeze({
  publish: ['terra.master.modules.publications.post', 'T3'], revoke: ['terra.master.modules.publications.by-publication-id.revoke.post', 'T3'],
  rollout: ['terra.master.modules.publications.by-publication-id.rollout.post', 'T3'], promote: ['terra.master.modules.publications.by-publication-id.promote.post', 'T3'],
  approvePromo: ['terra.master.modules.promotions.by-promotion-id.approve.post', 'T3'], rejectPromo: ['terra.master.modules.promotions.by-promotion-id.reject.post', 'T3'],
  ceiling: ['terra.master.modules.approval-ceiling.post', 'T4'], mirrorBlock: ['terra.master.modules.mirror-blocks.post', 'T3'], mirrorUnblock: ['terra.master.modules.mirror-blocks.by-pattern.delete', 'T3'],
  corePublish: ['terra.master.core.releases.post', 'T4'], coreRevoke: ['terra.master.core.releases.by-release-id.revoke.post', 'T4'],
  coreApply: ['terra.master.core.releases.by-release-id.apply.post', 'T4'], coreRollout: ['terra.master.core.releases.by-release-id.rollout.post', 'T4'],
  configPatch: ['terra.master.config.patch', 'T4'],
});
export const POLICIES = ['available', 'recommended', 'required'];
export const STAGES = [1, 10, 50, 100];

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

/** 창의 탭 */
export const TABS = Object.freeze([['mod', '모듈 게시'], ['promo', '승격 심사'], ['policy', '정책'], ['core', '코어 롤아웃'], ['config', 'Master 설정']]);

const F = (k, label, kind = 'text', o = {}) => ({ k, label, kind, ...o });
const ID = (k, label, from) => F(k, label, 'text', { req: true, from });   // from : 줄을 누르면 이 칸이 그 줄의 값으로 채워진다
const POL = (req) => F('policy', '정책', 'enum', { opts: POLICIES, req: !!req });
const STG = F('stage', '단계(%)', 'enum', { opts: STAGES.map(String), req: true, num: true });
const CANARY = F('canary_node_id', '카나리아 노드 id', 'text', { reqIf: (v) => v.stage === '1', hint: '단계 1(카나리아)이면 필수' });

/** 탭별 단추 — key 는 WRITES 의 키. 칸 : k(입력 이름) · kind(text · enum · bool · int · list) · req · from(줄 값 채움) */
export const ACTIONS = Object.freeze({
  mod: [
    { key: 'publish', label: '게시', fields: [F('digest', '패키지 digest(64자)', 'text', { req: true, len: 64 }), POL(true)], hint: '올려 둔 패키지를 이 클러스터에 게시' },
    { key: 'rollout', label: '롤아웃', fields: [ID('publication_id', '게시 id', 'id'), STG, CANARY], hint: '단계 1 · 10 · 50 · 100 — 단계 1 은 카나리아 노드 하나' },
    { key: 'promote', label: '위로 승격', fields: [ID('publication_id', '게시 id', 'id'), F('up', '몇 층 위로', 'int', { min: 1 }), F('note', '메모')], hint: '한 층 위 Tree 로 심사를 올림' },
    { key: 'revoke', label: '회수', fields: [ID('publication_id', '게시 id', 'id'), F('reason', '이유'), F('security', '보안 철회(노드가 payload 를 지움)', 'bool')], hint: '보안 철회는 노드의 파일을 지웁니다' },
  ],
  promo: [
    { key: 'approvePromo', label: '승인', fields: [ID('promotion_id', '심사 id', 'id'), POL(false), F('acknowledge_permissions', '권한 diff digest', 'text', { from: 'digest', hint: '권한이 늘어나는 승격만 필수 — 줄을 누르면 채워집니다' })], hint: '심사를 통과시켜 게시합니다' },
    { key: 'rejectPromo', label: '거절', fields: [ID('promotion_id', '심사 id', 'id'), F('reason', '이유', 'text', { req: true })], hint: '이유가 올린 쪽에 남습니다' },
  ],
  policy: [
    { key: 'ceiling', label: '승인 상한', fields: [F('permissions', '넘을 수 없는 core operation(쉼표로 구분)', 'list', { req: true })], hint: '이 권한을 요구하는 승격은 사람 앞에 닿기 전에 거부 — 전체 덮어쓰기' },
    { key: 'mirrorBlock', label: '미러 거부 추가', fields: [F('pattern', '패턴', 'text', { req: true }), F('reason', '이유')], hint: '이 패턴의 모듈은 상류 미러로 들이지 않음' },
    { key: 'mirrorUnblock', label: '미러 거부 풀기', fields: [ID('pattern', '패턴', 'pattern')], hint: '' },
  ],
  core: [
    { key: 'corePublish', label: '릴리스 게시', fields: [F('role', '역할', 'enum', { opts: ['terra', 'leaf', 'tree'], req: true }), F('version', '버전', 'text', { req: true }), F('notes', '릴리스 노트(노드까지 내려감)'), F('digests', '번들 digest(쉼표로 구분)', 'list', { req: true })], hint: '올려 둔 번들로 릴리스를 만듭니다' },
    { key: 'coreRollout', label: '롤아웃', fields: [ID('release_id', '릴리스 id', 'id'), STG, CANARY], hint: '단계마다 N대가 갱신 지시를 받습니다' },
    { key: 'coreApply', label: '적용 지시', fields: [ID('release_id', '릴리스 id', 'id'), F('apply', '지시', 'enum', { opts: ['true', 'false'], req: true })], hint: 'true 적용 · false 거둠' },
    { key: 'coreRevoke', label: '회수', fields: [ID('release_id', '릴리스 id', 'id'), F('reason', '이유')], hint: '' },
  ],
});

/** 칸 값(글) → 호출 입력. { input, errors } — 빈 선택 칸은 보내지 않고, 필수 · 모양이 틀리면 칸 이름으로 이유 */
export function buildInput(action, vals = {}) {
  const input = {}, errors = {};
  for (const f of (action && action.fields) || []) {
    const raw = vals[f.k] == null ? '' : vals[f.k], t = str(raw).trim();
    if (!t) { if (f.req || (f.reqIf && f.reqIf(vals))) errors[f.k] = '필요'; continue; }
    if (f.kind === 'list') { const L = t.split(',').map((x) => x.trim()).filter(Boolean); if (!L.length) errors[f.k] = '필요'; else input[f.k] = L; }
    else if (f.kind === 'int' || f.num) { const n = Number(t); if (!Number.isInteger(n) || (f.min != null && n < f.min)) errors[f.k] = f.min != null ? f.min + ' 이상의 정수' : '정수'; else input[f.k] = n; }
    else if (f.kind === 'bool') input[f.k] = t === 'true';
    else if (f.len && t.length !== f.len) errors[f.k] = f.len + '자';
    else if (f.kind === 'enum' && f.opts && !f.opts.includes(t)) errors[f.k] = f.opts.join(' · ') + ' 중 하나';
    else input[f.k] = f.kind === 'enum' && f.opts && f.opts.every((o) => /^(true|false)$/.test(o)) ? t === 'true' : t;
  }
  return { input, errors };
}

/** 이 창의 쓰기는 Master 에만 있다 — Tree 노드가 아니면 이유를 돌려준다('' 이면 열림). kind : 지도의 노드 종류('tree' · 'leaf' · 'root'…) 또는 역할 목록 */
export function treeReason(kind, roles) {
  const ok = (Array.isArray(roles) && roles.some((r) => /tree|master/i.test(str(r)))) || /^tree$/i.test(str(kind));
  if (ok) return '';
  const k = str(kind).toLowerCase();
  return (k === 'leaf' ? '리프' : k === 'root' ? '계정' : str(kind) || '이 노드') + ' 노드에는 Master 가 없어 모듈 게시 · 코어 롤아웃 · Master 설정을 할 수 없음 — Tree 노드의 GUI 에서 열기';
}

const sub = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== '') return o[k]; return ''; };

/** 게시 목록 → 줄 (모듈 · 버전 · 정책 · 단계) */
export function pubRows(data) {
  return arr(data, 'publications', 'items').map((p) => ({ id: str(sub(p, 'publication_id', 'id')), module: str(sub(p, 'module_id', 'module')), version: str(p.version), digest: str(p.digest),
    policy: str(p.policy), stage: p.stage != null ? Number(p.stage) : (p.rollout_stage != null ? Number(p.rollout_stage) : null), state: str(sub(p, 'state', 'status')), at: ms(sub(p, 'published_at', 'created_at', 'at')) })).sort((a, b) => b.at - a.at);
}

/** 승격 심사 큐 → 줄. permissions.digest 는 권한이 늘 때 승인 입력 acknowledge_permissions 가 된다(A-1) */
export function promoRows(data) {
  return arr(data, 'promotions', 'items').map((p) => { const perm = p.permissions || {}, added = arr(perm.added || perm.added_permissions).map(str);
    return { id: str(sub(p, 'promotion_id', 'id')), module: str(sub(p, 'module_id', 'module')), version: str(p.version), from: str(sub(p, 'requested_by', 'source', 'node_id')),
      state: str(sub(p, 'state', 'status')), policy: str(p.policy), added, digest: str(perm.digest), widens: !!(perm.digest || added.length),
      at: ms(sub(p, 'requested_at', 'created_at', 'at')) }; }).sort((a, b) => b.at - a.at);
}

/** 코어 릴리스 → 줄 (역할 · 버전 · 적용 지시 · 단계) */
export function coreRows(data) {
  return arr(data, 'releases', 'items').map((r) => ({ id: str(sub(r, 'release_id', 'id')), role: str(r.role), version: str(r.version), apply: !!r.apply, stage: r.stage != null ? Number(r.stage) : (r.rollout_stage != null ? Number(r.rollout_stage) : null),
    state: str(sub(r, 'state', 'status')), notes: str(r.notes), at: ms(sub(r, 'published_at', 'created_at', 'at')) })).sort((a, b) => b.at - a.at);
}

/** 상한 · 거부 목록 읽기 */
export const ceilingOf = (data) => arr(data, 'permissions', 'ceiling').map(str);
export const mirrorBlockRows = (data) => arr(data, 'blocks', 'patterns', 'items').map((b) => (typeof b === 'string' ? { pattern: b, reason: '' } : { pattern: str(sub(b, 'pattern', 'id')), reason: str(b.reason) }));

/** 설정 스키마 + 값 → 폼 칸. 수정할 수 없는 키(editable false) · 비밀(secret)은 입력 칸이 아니라 읽기 줄로 */
export function configFields(schema, view) {
  const cfg = (view && view.config) || {}, pend = new Set(arr(view && view.pending_restart).map(str)), at = (path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), cfg);
  return arr(schema, 'fields').map((f) => { const v = at(str(f.key)), secret = !!f.secret;
    return { key: str(f.key), type: str(f.type) || 'string', owner: str(f.owner), restart: !!f.restart_required, editable: f.editable !== false && !secret, secret,
      value: secret ? '' : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v), pending: pend.has(str(f.key)) }; }).sort((a, b) => a.key.localeCompare(b.key));
}

/** 칸의 글 → 보낼 값. 틀리면 { err } (못 읽으면 막는다 — 짐작해 보내지 않는다) */
export function coerceConfig(type, text) {
  const t = str(text).trim();
  if (/^(bool|boolean)$/.test(type)) return t === 'true' ? { v: true } : t === 'false' ? { v: false } : { err: 'true 또는 false' };
  if (/^(int|integer|number|float|uint)/.test(type)) return t !== '' && Number.isFinite(Number(t)) ? { v: Number(t) } : { err: '숫자' };
  if (/^(list|array|object|map)/.test(type)) { try { return { v: JSON.parse(t) }; } catch { return { err: 'JSON' }; } }
  return { v: str(text) };
}

/** 바뀐 칸만 모은 changes. edits = { key: 글 } · 원래 값과 같으면 뺀다. { changes, errors } */
export function configChanges(fields, edits) {
  const changes = {}, errors = {};
  for (const f of fields) { if (!(f.key in edits) || !f.editable) continue; const raw = edits[f.key]; if (str(raw) === f.value) continue; const r = coerceConfig(f.type, raw); if (r.err) errors[f.key] = r.err; else changes[f.key] = r.v; }
  return { changes, errors };
}

/** 승인 뒤 결과 한 줄 — 코어 쓰기는 "N대에 적용"(affected_nodes · 없으면 지어내지 않음), 설정은 재시작이 필요한 키 */
export function resultLine(kind, data) {
  const d = data || {}, n = d.affected_nodes, all = d.cluster_nodes;
  if (/^core/.test(kind)) {
    if (typeof n === 'number') return n + '대에 적용' + (typeof all === 'number' ? ' (이 클러스터 ' + all + '대 중)' : '');
    return '완료 — 적용 대수는 Master 가 알려 주지 않음';
  }
  if (kind === 'configPatch') { const r = arr(d.restart_required).map(str); return r.length ? '저장됨 — Master 를 다시 시작해야 반영 : ' + r.join(' · ') : '저장됨 — 다시 시작 없이 반영'; }
  return '완료';
}

/** 단추 옆에 미리 적을 영향 한 줄 — 코어는 클러스터 노드에 닿고, 계산한 대수는 승인 뒤 결과 줄에 온다 */
export function impactOf(kind) {
  if (/^core/.test(kind)) return '이 클러스터의 노드에 코어 업데이트가 내려갑니다 — 적용 대수는 완료 뒤 결과 줄에 나옵니다';
  if (kind === 'configPatch') return 'Master 설정 파일이 바뀝니다 — 일부 키는 Master 재시작 뒤 반영';
  if (kind === 'ceiling') return '이 권한을 요구하는 모듈 승격은 앞으로 심사 전에 거부됩니다';
  return '';
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
export function createTreeAdmin(terra, who = () => null, deps = {}) {
  const run = async (op, input, at) => { try { return { ok: true, data: await terra.invoke(op, input || {}, at || {}) }; } catch (e) { return { ok: false, err: { code: (e && e.code) || 'ERROR', message: (e && e.message) || str(e) } }; } };
  const opened = (op) => (deps.gate ? deps.gate(op, { who: who() }) : gate(op, { who: who() }));
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
    kit: { TABS, ACTIONS, WRITES, buildInput, configFields, configChanges, treeReason, impactOf },
    // ── P14-4 읽기(위임 읽기) ──
    publications: (module) => read(OPS.publications, module ? { module_id: module } : {}, pubRows),
    promotions: (state) => read(OPS.promotions, state ? { state } : {}, promoRows),
    ceiling: () => read(OPS.ceilingGet, {}, ceilingOf),
    mirrorBlocks: () => read(OPS.mirrorBlocks, {}, mirrorBlockRows),
    coreReleases: (role) => read(OPS.coreReleases, role ? { role } : {}, coreRows),
    config: () => read(OPS.configGet, {}, (d) => d || {}),
    configSchema: () => read(OPS.configSchema, {}, (d) => arr(d, 'fields')),
    configValidate: (changes) => read(OPS.configValidate, { changes }, (d) => d || {}),
    /** 쓰기 문 — 이 페이지가 아니라 호스트가 사람 앞에서 부른다. 문(gate)이 잠겨 있으면 이유만 돌려주고 승인 화면을 띄우지 않는다 */
    canApprove: () => !!(deps.canApprove && deps.canApprove()),
    writeGate: (key) => (WRITES[key] ? opened(WRITES[key][0]) : { open: false, needs: 'core', why: '잠김 : 알 수 없는 단추 — ' + key, op: '' }),
    async act(key, input = {}) {
      const w = WRITES[key]; if (!w) return { ok: false, code: 'UNKNOWN_ACTION', text: '알 수 없는 단추 — ' + key };
      const g = opened(w[0]); if (!g.open) return { ok: false, locked: g, code: 'LOCKED', text: g.why };
      if (!(deps.canApprove && deps.canApprove()) || !deps.approve) return { ok: false, code: 'APPROVAL_UNAVAILABLE', text: '승인 문 없음 — Terra 셸 안에서만 이 단추를 쓸 수 있음(단독 실행에서는 터미널 terra CLI)' };
      const r = await deps.approve(w[0], input);
      return r && r.ok ? { ok: true, tier: w[1], data: r.data, withheld: r.withheld || [], line: resultLine(key, r.data) } : { ok: false, code: (r && r.code) || 'APPROVAL_FAILED', text: (r && r.text) || '', hint: (r && r.hint) || '', silent: !(r && r.text) };
    },
    ack: (id) => write(OPS.ack, { alert_id: id }),
    pin: (node, module, version) => write(OPS.pin, { node_id: node, module_id: module, version }),
    unpin: (node, module) => write(OPS.unpin, { node_id: node, module_id: module }),
    probe: (input = {}) => write(OPS.probe, input),
    closeSession: (id) => write(OPS.closeSession, { session_id: id }),
  };
}
