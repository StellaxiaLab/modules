// Gateway 응답 → 화면 데이터 모양(src/model/types.js). 앱마다 한 함수.
// ⚠ 응답 필드 이름은 자원 목록 문서(terra-gui-resource-inventory)의 필드 표를 따랐다 — 실제 응답으로 확인할 것

const arr = (d, ...keys) => { for (const k of keys) if (d && Array.isArray(d[k])) return d[k]; return Array.isArray(d) ? d : []; };

export const ADAPT = {
  /** @returns {import('../model/types.js').SviResource[]} */
  svi: (d, ctx) => arr(d, 'resources', 'items').map((r) => {
    const ep = (r.endpoints || [])[0] || {};
    const g = (ctx.grants || []).find((x) => x.resource_id === r.resource_id);
    return { id: r.resource_id, kind: r.kind, name: r.display_name || r.canonical_name || r.resource_id, status: r.status,
      ep: [ep.endpoint_id, ep.direction, ep.interaction].filter(Boolean).join(' · '),
      grant: ctx.local ? 'own' : g ? g.operations : null, last: r.expires_at };
  }),
  decl: (d) => arr(d, 'declarations').map((x) => ({ id: x.family + '/' + x.name, fam: x.family, name: x.name, dir: x.direction, origin: x.origin, state: x.state, what: x.command || x.path || x.address || '', reason: x.reason }))
    .concat(arr(d, 'retired').map((x) => ({ id: x.family + '/' + x.name, fam: x.family, name: x.name, dir: x.direction, origin: 'runtime', state: 'retired', what: '퇴역 원장' }))),
  grant: (d, ctx) => arr(d, 'grants').map((g) => ({ id: g.grant_id, type: 'grant', who: g.subject_id, res: g.resource_id, ops: (g.operations || []).join(' · '), ttl: g.expires_at || '', alive: !g.expired }))
    .concat((ctx.bindings || []).map((b) => ({ id: b.binding_id, type: 'bind', from: b.source_resource_id, to: b.target_node_id + ' · ' + b.target_resource_id, state: b.observed_state, qos: b.qos_profile, reason: b.reason }))),
  io: (d) => arr(d, 'devices').map((x) => ({ id: x.id, kind: x.kind, name: x.alias || x.name, presence: x.presence, approval: x.approval, enabled: !!x.enabled })),
  folder: (d) => arr(d, 'roots').map((r) => ({ id: r.name, parent: '', name: r.name, dir: true, root: true, info: r.path }))
    .concat(arr(d, 'entries').map((e) => ({ id: e.path, parent: e.path.split('/').slice(0, -1).join('/'), name: e.name, dir: e.is_dir, size: e.is_dir ? undefined : fmtSize(e.size), info: e.modified_at }))),
  xfer: (d) => arr(d, 'transfers').map((t) => ({ id: t.id, dir: t.direction, name: (t.path || '').split('/').pop(), total: (t.size_bytes || 0) / 1e6, off: t.size_bytes ? t.offset / t.size_bytes : 0, state: t.state })),
  tunnel: (d, ctx) => (ctx.declarations || []).map((x) => ({ id: x.id, type: 'decl', name: (x.service_id || '').split('.').pop() + ' → ' + x.target_node_id, to: x.target_node_id + ':' + x.target_port, bind: x.local_bind_host + ':' + x.local_port, on: !x.disabled }))
    .concat(arr(d, 'tunnels').map((t) => ({ id: t.tunnel_id, type: 'tun', name: (t.service_id || '') + ' → ' + t.target_node_id, to: t.target_node_id + ':' + t.target_port, bind: t.local_address, state: t.state, conn: (t.active_connections || 0) + ' / ' + (t.max_connections || 16), err: t.last_error }))),
  wg: (d) => arr(d, 'peers').map((p) => ({ id: p.node_id || p.public_key, ip: (p.allowed_ips || [])[0] || '', ep: p.endpoint || '—', hs: p.last_handshake || '없음', health: p.never_seen ? 'never' : p.stale ? 'stale' : 'healthy' })),
  job: (d) => arr(d, 'jobs', 'tasks').map((j) => ({ id: j.job_id || j.task_id, cmd: [j.command || (j.payload && j.payload.command), ...((j.payload && j.payload.args) || [])].filter(Boolean).join(' '), state: j.status, code: j.result && j.result.exit_code, out: j.result && (j.result.stdout || '').slice(-200) })),
  mod: (d) => arr(d, 'modules').map((m) => ({ id: m.id || m.module_id, name: m.name || m.id, ver: m.version || '', state: m.state || m.status, svi: m.svi_resources || 0, trust: m.trust || 'local', note: m.last_error || '' }))
};

function fmtSize(n) { if (n == null) return ''; return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
