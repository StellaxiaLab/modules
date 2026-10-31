// 노드 데스크톱(보드 NodeDesktopEmbed)의 실제 응답 → 보드 모양. 보드는 window.TerraDesk 가 있으면 이것을 쓰고, 없으면(캔버스) 시안 씨앗 그대로.
//   모르는 칸은 비운다 — 지어내지 않는다.
//
//   tunnels   terra.daemon.service-tunnels.get   { tunnels: [{ id|tunnel_id, service_id, target_node_id, target_port, local_address | local_bind_host+local_port, status, opened_at }] }
//   enroll    terra.daemon.enrollment.status.get { enabled, registered, node_id, master_url, registered_at, credential_ready }
//   logLines  terra.daemon.modules.by-module-id.logs.get { module_id, lines: [{ at, stream, text }], truncated }
//   offers    terra.daemon.modules.offers.get    { offers: [{ module_id, version, state: offered|accepted|stale|managed|pinned, permissions, installed_version, published_by, pinned_by }] }
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
