// 노드 데스크톱(보드 NodeDesktopEmbed)의 실제 응답 → 보드 모양. 보드는 window.TerraDesk 가 있으면 이것을 쓰고, 없으면(캔버스) 시안 씨앗 그대로.
//   모르는 칸은 비운다 — 지어내지 않는다.
//
//   tunnels   terra.daemon.service-tunnels.get   { tunnels: [{ id|tunnel_id, service_id, target_node_id, target_port, local_address | local_bind_host+local_port, status, opened_at }] }
//   enroll    terra.daemon.enrollment.status.get { enabled, registered, node_id, master_url, registered_at, credential_ready }
//   logLines  terra.daemon.modules.by-module-id.logs.get { module_id, lines: [{ at, stream, text }], truncated }
//   offers    terra.daemon.modules.offers.get    { offers: [{ module_id, version, state: offered|accepted|stale|managed|pinned, permissions, installed_version, published_by, pinned_by }] }
//   cfgFields terra.daemon.modules.by-module-id.config.schema.get { schema, secret_keys } + config.get { values, revision, restart_pending }
//   taskOutput terra.daemon.tasks.by-task-id.output.get { captured, state, chunks: [{ seq, stream, text }], dropped: { bytes }, complete, truncated } — process.execute
//   moduleApps  Gateway 앱 목록(GET /api/v1/gui/apps)의 그 모듈 것 — embed 앱(Scene 안에서만 뜬다)은 뺀다

const arr = (d, k) => (Array.isArray(d) ? d : (d && Array.isArray(d[k]) ? d[k] : []));
const pad = (n) => String(n).padStart(2, '0');

/** ISO 시각 → 'N분 전' 꼴(없으면 '') */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || ''); if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  return s < 60 ? '방금' : s < 3600 ? Math.round(s / 60) + '분 전' : s < 86400 ? Math.round(s / 3600) + '시간 전' : Math.round(s / 86400) + '일 전';
}

/** @returns {{ id: string, svc: string, port: number, peer: string, since: string, st: string }[]} */
export function tunnels(d, now) {
  return arr(d, 'tunnels').map((t) => {
    const local = t.local_address || (t.local_bind_host ? t.local_bind_host + ':' + t.local_port : '');
    return { id: t.id || t.tunnel_id || '', svc: t.service_id || t.service || 'tcp', port: Number(t.local_port) || Number(String(local).split(':').pop()) || 0,
      peer: (t.target_node_id || t.target_host || '') + (t.target_port ? ':' + t.target_port : ''), since: ago(t.opened_at || t.created_at, now), st: t.status || t.state || '' };
  });
}

/** @returns {{ st: string, parent: string, id: string, at: string, real: true, registered: boolean, cred: string }} */
export function enroll(d) {
  const e = d || {};
  const st = e.enabled === false ? '등록 꺼짐' : e.registered ? '등록됨' : '등록 안 됨';
  return { st, parent: e.master_url || '', id: e.node_id || e.device_id || '', at: String(e.registered_at || '').slice(0, 10), real: true, registered: !!e.registered, cred: e.credential_ready ? '준비됨' : '없음' };
}

const LEVEL = /\b(error|fatal|panic)\b/i, WARN = /\bwarn(ing)?\b/i;
/** @returns {{ t: string, cls: 'info'|'warn'|'err', msg: string }[]} */
export function logLines(d) {
  return arr(d, 'lines').concat(arr(d, 'logs')).map((x) => {
    const text = typeof x === 'string' ? x : String(x.text ?? '');
    const at = typeof x === 'string' ? '' : x.at, dt = new Date(at || '');
    const t = Number.isNaN(dt.getTime()) ? '' : pad(dt.getHours()) + ':' + pad(dt.getMinutes()) + ':' + pad(dt.getSeconds());
    const cls = LEVEL.test(text) ? 'err' : WARN.test(text) ? 'warn' : 'info';
    return { t, cls, msg: text };
  });
}

/** 앱 상태는 목록에 없다 — 모듈이 돌면 '정상', 아니면 '멈춤'(모듈 상태에서) @returns {{ id: string, name: string, health: string, full: true }[]} */
export function moduleApps(list, moduleId, running) {
  return arr(list, 'apps').filter((a) => a && a.moduleId === moduleId && !a.embed).map((a) => ({ id: a.id, name: a.name || a.id, health: running ? '정상' : '멈춤', full: true }));
}

// 동의 상태 → 보드의 세 칸(동의 대기 · 받는 중 · 설치됨). managed · pinned 는 정책이 이미 정했다(동의 단추 없음)
const OFFER_ST = { offered: 'wait', stale: 'wait', accepted: 'consent', managed: 'done', pinned: 'done' };
/** @returns {{ id: string, name: string, ver: string, size: string, by: string, perms: string[], st: 'wait'|'consent'|'done', state: string }[]} */
export function offers(d) {
  return arr(d, 'offers').map((f) => ({ id: f.module_id, name: f.module_id, ver: f.version || '', size: '', by: f.pinned_by || f.published_by || f.policy || '',
    perms: Array.isArray(f.permissions) ? f.permissions : [], st: OFFER_ST[f.state] || 'wait', state: f.state || '' }));
}

/**
 * 모듈 설정 스키마 · 값 → 보드의 칸 [키, 이름, 'bool'|'sel'|'text', 값, 고르기|null, 저장하면 재시작, json 형]
 *   칸 = configuration.schema 의 최상위 키(node-gui cfgForm 과 같은 규칙). 비밀(x-terra-secret · secret_keys)은 칸에 내지 않는다 — 값을 보이지 않는다
 *   값은 글로 들고(입력칸), 저장할 때 castCfg 로 스키마 형에 맞춘다
 * @returns {{ fields: any[][], secrets: string[], revision: number|null, restartPending: boolean }}
 */
export function cfgFields(schemaData, cfgData) {
  const sc = (schemaData && schemaData.schema) || {}, props = sc.properties || {}, vals = (cfgData && cfgData.values) || {};
  const secrets = [...new Set([].concat((schemaData && schemaData.secret_keys) || [], Object.keys(props).filter((k) => props[k] && props[k]['x-terra-secret'])))];
  const fields = Object.keys(props).filter((k) => !secrets.includes(k)).map((k) => {
    const p = props[k] || {}, v = k in vals ? vals[k] : p.default, jt = Array.isArray(p.type) ? p.type.find((x) => x !== 'null') : p.type;
    const kind = Array.isArray(p.enum) ? 'sel' : jt === 'boolean' ? 'bool' : 'text';
    const shown = kind === 'bool' ? !!v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return [k, p.title || k, kind, shown, kind === 'sel' ? p.enum.map(String) : null, !!p['x-terra-restart'], jt === 'integer' || jt === 'number' ? jt : jt === 'array' || jt === 'object' ? 'json' : jt || 'string'];
  });
  return { fields, secrets, revision: cfgData && cfgData.revision != null ? cfgData.revision : null, restartPending: !!(cfgData && cfgData.restart_pending) };
}

/** 입력칸의 글 → 스키마 형. 못 바꾸면 Error(화면 말) */
export function castCfg(field, v) {
  const jt = field && field[6];
  if (jt === 'integer' || jt === 'number') { const n = Number(v); if (v === '' || !Number.isFinite(n) || (jt === 'integer' && !Number.isInteger(n))) throw new Error((field[1] || field[0]) + ' — ' + (jt === 'integer' ? '정수' : '수') + '를 적어야 해요'); return n; }
  if (jt === 'json') { try { return JSON.parse(v); } catch { throw new Error((field[1] || field[0]) + ' — JSON 꼴이 아니에요'); } }
  return v;
}

/** 작업 출력 → 출력 칸의 글 + 머리 말. 따라가기(SSE)는 하지 않는다 — 도는 작업은 보드가 몇 초마다 다시 읽는다 */
export function taskOutput(d) {
  const p = d || {}, chunks = Array.isArray(p.chunks) ? p.chunks : [];
  const text = chunks.map((c) => (c.stream === 'stderr' ? '! ' : '') + String(c.text ?? '').replace(/\n$/, '')).join('\n');
  const notes = [];
  if (p.captured === false) notes.push('이 작업은 출력을 남기지 않는다');
  if (p.dropped && p.dropped.bytes) notes.push('앞 ' + p.dropped.bytes + '바이트는 버려졌다(보관 한도)');
  if (p.truncated || p.more) notes.push('끝 부분만');
  return { text, note: notes.join(' · '), done: !!p.complete, state: p.state || '' };
}
