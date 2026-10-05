// Gateway 응답 → 화면 데이터 모양(src/model/types.js). 앱마다 한 함수.
// 필드 이름은 실제 응답(Daemon local API · io.terra.file 계약 · 게이트웨이)으로 맞췄다 — 모듈 README "실데이터 확인".
//
// 화면(src/screens/node.js hbVals)은 상태 값마다 표(ST)를 두고 ST[state][0] 을 읽는다. 표에 없는 값이 오면
// 렌더 전체가 멈춘다. 그래서 상태는 여기서 화면의 낱말로 옮기고, 원래 값은 note · raw 에 남긴다.

import { entryItems } from '../data/files.js';

const arr = (d, ...keys) => { for (const k of keys) if (d && Array.isArray(d[k])) return d[k]; return Array.isArray(d) ? d : []; };

/** 화면의 상태 낱말로 — 모르는 값은 fallback */
const pick = (table, fallback) => (v) => table[v] || fallback;

/** SVI 자원 상태 (화면: available · busy · disabled · unavailable · unsupported) */
export const sviState = pick({ available: 'available', busy: 'busy', disabled: 'disabled', unavailable: 'unavailable', unsupported: 'unsupported' }, 'unavailable');
/** 선언 상태 (화면: applied · shadowed · refused_by_policy · retired) — Daemon 값과 같다 */
export const declState = pick({ applied: 'applied', shadowed: 'shadowed', refused_by_policy: 'refused_by_policy', retired: 'retired' }, 'refused_by_policy');
/** 작업 상태 (화면: queued · sent · running · success · failed) */
export const jobState = pick({
  queued: 'queued', pending: 'queued', sent: 'sent', running: 'running',
  success: 'success', succeeded: 'success', completed: 'success',
  failed: 'failed', dead_letter: 'failed', timed_out: 'failed', canceled: 'failed', cancelled: 'failed'
}, 'failed');
/** 모듈 상태 (화면: running · degraded · failed · stopped). Scene 모듈은 프로세스가 없어 discovered 로 머문다 */
export const modState = pick({
  running: 'running', starting: 'degraded', stopping: 'degraded', restarting: 'degraded', degraded: 'degraded',
  failed: 'failed', crashed: 'failed', error: 'failed',
  stopped: 'stopped', exited: 'stopped', discovered: 'stopped', installed: 'stopped', disabled: 'stopped', unavailable: 'stopped'
}, 'stopped');
/** 전송 카드의 덧글 — 서버가 사유를 적지 않았을 때. 부분 파일을 남기고 중단한 올리기는 같은 파일을 다시 올리면 잇는다(MD-21) */
const xferNote = (t) => (t.state === 'prepared' ? '준비됨 — 청크를 기다린다'
  : t.state === 'aborted' && t.direction === 'push' && t.offset > 0 ? '중단 · ' + Math.floor(t.offset / Math.max(1, t.size_bytes) * 100) + '% 남겨 둠 — 같은 파일을 다시 올리면 거기서부터' : '');
/** 전송 상태 (화면: transferring · verifying · completed · aborted · 그 밖 = 어긋남). prepared = 아직 0% */
export const xferState = pick({ prepared: 'transferring', transferring: 'transferring', verifying: 'verifying', completed: 'completed', aborted: 'aborted', failed: 'failed' }, 'failed');
/** 터널 상태 (화면: active · listening · draining · 그 밖 = 실패) */
export const tunnelState = pick({ active: 'active', listening: 'listening', draining: 'draining', closed: 'draining', failed: 'failed' }, 'failed');

const ago = (sec) => (sec == null ? '없음' : sec < 60 ? sec + '초 전' : sec < 3600 ? Math.round(sec / 60) + '분 전' : Math.round(sec / 3600) + '시간 전');

export const ADAPT = {
  /** @returns {import('../model/types.js').SviResource[]} */
  svi: (d, ctx) => arr(d, 'resources', 'items').map((r) => {
    const ep = (r.endpoints || [])[0] || {};
    const g = (ctx.grants || []).find((x) => x.resource_id === r.resource_id);
    return { id: r.resource_id, kind: r.kind || '', name: r.display_name || r.canonical_name || r.resource_id, status: sviState(r.status),
      ep: [ep.endpoint_id, ep.direction, ep.interaction].filter(Boolean).join(' · '),
      grant: ctx.local ? 'own' : g ? [].concat(g.operations || []) : null, last: r.expires_at };
  }),
  decl: (d) => {
    const out = arr(d, 'declarations').map((x) => ({ id: x.family + '/' + x.name, fam: x.family, name: x.name, dir: x.direction || '—', origin: x.origin, state: declState(x.state),
      what: x.command ? [x.command].concat(x.args || []).join(' ') : x.path || x.address || '', reason: x.reason || (x.state !== declState(x.state) ? 'state ' + x.state : '') }))
      .concat(arr(d, 'retired').map((x) => ({ id: x.family + '/' + x.name, fam: x.family, name: x.name, dir: '—', origin: 'runtime', state: 'retired', what: '퇴역 원장' })));
    // 울타리(envelope) — 조타륜 앱 바의 요약 줄이 읽는다(node-live.js hbVals)
    return Object.assign(out, { envelope: d && d.envelope ? d.envelope : null });
  },
  grant: (d, ctx) => arr(d, 'grants').map((g) => ({ id: g.grant_id, type: 'grant', who: g.subject_id, res: g.resource_id, ops: (g.operations || []).join(' · '), ttl: g.expires_at || '', alive: !g.expired }))
    .concat((ctx.bindings || []).map((b) => ({ id: b.binding_id, type: 'bind', from: b.source_resource_id, to: b.target_node_id + ' · ' + b.target_resource_id, state: b.observed_state, qos: b.qos_profile, reason: b.reason }))),
  io: (d) => arr(d, 'devices').map((x) => ({ id: x.id, kind: x.kind, name: x.alias || x.name || x.id, presence: x.presence || 'unknown', approval: x.approval || 'pending', enabled: !!x.enabled })),
  /** 공유 폴더(맨 위 칸). 그 안의 항목은 source.js folderLevels 가 folderEntries 로 붙인다 */
  folder: (d) => arr(d, 'roots').map((r) => ({ id: r.name, parent: '', name: r.name, dir: true, root: true, info: r.path || '' })),
  folderEntries: (root, path, d) => entryItems(root, path, d && d.entries),
  // root · path · bytes · sha · mode · at · exp — 멈춘 전송을 가리고(source.js markStalled) 이어서 다시 열 때(resume_id) 쓴다
  xfer: (d) => arr(d, 'transfers').map((t) => ({ id: t.transfer_id || t.id, dir: t.direction, name: (t.path || '').split('/').pop() || t.path || '', total: (t.size_bytes || 0) / 1e6,
    off: t.size_bytes ? Math.min(1, (t.offset || 0) / t.size_bytes) : 0, state: xferState(t.state), reason: t.reason || xferNote(t),
    root: t.root || '', path: t.path || '', bytes: t.size_bytes || 0, sha: t.checksum_sha256 || '', mode: t.mode || '', at: Date.parse(t.updated_at) || 0, exp: Date.parse(t.expires_at) || 0 })),
  tunnel: (d, ctx) => (ctx.declarations || []).map((x) => ({ id: x.id, type: 'decl', name: (x.service_id || '').split('.').pop() + ' → ' + x.target_node_id, to: x.target_node_id + ':' + x.target_port, bind: x.local_bind_host + ':' + x.local_port, on: !x.disabled }))
    .concat(arr(d, 'tunnels').map((t) => ({ id: t.id || t.tunnel_id, type: 'tun', name: (t.service_id || t.id || '') + ' → ' + (t.target_node_id || ''), to: (t.target_host || t.target_node_id || '') + ':' + t.target_port,
      bind: t.local_address || (t.local_bind_host + ':' + t.local_port), state: tunnelState(t.status || t.state),
      conn: (t.active_sessions != null ? t.active_sessions : t.active_connections || 0) + ' / ' + (t.max_connections || 16), err: t.last_error }))),
  wg: (d) => arr(d, 'peers').map((p) => ({ id: p.node_id || p.public_key, ip: (p.allowed_ips || [])[0] || '', ep: p.endpoint || '—',
    hs: p.never_seen ? '없음' : ago(p.seconds_since_handshake), health: p.never_seen ? 'never' : p.stale ? 'stale' : 'healthy' })),
  job: (d) => arr(d, 'jobs', 'tasks').map((j) => ({ id: j.job_id || j.task_id || j.id, cmd: [j.command || (j.payload && j.payload.command), ...((j.payload && j.payload.args) || [])].filter(Boolean).join(' ') || j.type || '작업',
    state: jobState(j.status || j.state), code: j.result && j.result.exit_code, out: (j.status || j.state) === 'canceled' ? 'canceled' : j.result && (j.result.stdout || '').slice(-200) })),
  /** 이 노드의 Daemon 작업(terra.daemon.tasks.get) — 명령 · 출력은 오지 않는다. 종류(type)와 상태만 */
  jobLocal: (d) => arr(d, 'tasks').map((t) => ({ id: t.id, cmd: t.type || t.kind || '작업', state: jobState(t.state), code: null,
    out: t.state === 'canceled' || t.state === 'cancelled' ? 'canceled' : '', t: t.started_at && !t.finished_at ? (Date.now() - Date.parse(t.started_at)) / 1000 : 0 })),
  mod: (d) => arr(d, 'modules').map((m) => {
    const raw = m.state || m.status || '';
    const st = modState(raw);
    const note = m.last_error || (m.kind === 'scene' && raw === 'discovered' ? 'Scene 모듈 — 프로세스 없이 화면만 기여한다' : raw && raw !== st ? 'state ' + raw : '');
    // 빈 값은 싣지 않는다 — 상태 화면이 키마다 줄을 그린다(빈 '메모' 줄)
    return { id: m.id || m.module_id, name: m.name || m.id, ver: m.version || '', state: st, svi: m.svi_resources || 0, trust: m.trust || 'local', note: note || undefined, kind: m.kind || undefined, gui: false };
  })
};

/**
 * 모듈 목록에 GUI 표시를 붙인다 — 게이트웨이의 설치된 앱(/api/v1/gui/apps)에 그 모듈의 앱이 있으면 gui · ui(앱 경로 route).
 * 앱 목록을 못 읽었으면(null) 그대로 둔다 — GUI 가 없다고 단정하지 않는다
 * @param {any[]} items  ADAPT.mod 의 결과
 * @param {any[]|null} apps
 */
export function withGui(items, apps) {
  if (!Array.isArray(apps)) return items;
  return items.map((m) => {
    const mine = apps.filter((a) => a && a.moduleId === m.id);
    return mine.length ? Object.assign({}, m, { gui: true, ui: mine[0].route || '', apps: mine.map((a) => ({ id: a.id, name: a.name || a.id, route: a.route || '', embed: a.embed || '' })) }) : m;
  });
}
