// 자원 추이 — 노드마다 Master 하트비트 자원 스냅샷을 시간 순 고리 버퍼로 쌓아 그래프 점열을 낸다.
//
// 코어에는 노드별 실시간 지표 op 가 없다. 있는 것은 Master 노드 기록(terra.master.nodes.get)의 하트비트 스냅샷뿐이다:
//   resource.cpu_percent · memory_percent · disk_percent(+ 바이트) · last_heartbeat_at. main.js 가 30초마다(탭이 보일 때만) 다시 받는다.
// 그래서 이 점열은 "실시간"이 아니다 — 점 하나 = 받은 스냅샷 하나(같은 하트비트를 두 번 받으면 하나로). 화면은 갱신 주기와 나이를 같이 적는다
//   ('하트비트 스냅샷 · 30초마다 · 12초 전'). 스냅샷에 없는 값(네트워크 처리량 등)은 만들지 않는다 — 화면이 '—' 와 까닭을 적는다.
// 점 = { at: 하트비트 시각(ms), obs: 받은 시각(ms), cpu, mem, disk } — 값은 0..1 또는 null(보고 없음).

export const METRIC_KEYS = ['cpu', 'mem', 'disk'];
export const POLL_MS = 30000;   // main.js refreshTopology 주기와 같다
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : null);

/** Master 노드 기록 하나 → 점 하나(하트비트 시각이 없으면 null — 언제 것인지 모르는 값은 쌓지 않는다) */
export function pointOf(rec, obs = Date.now()) {
  const at = Date.parse((rec && rec.last_heartbeat_at) || ''); if (Number.isNaN(at)) return null;
  const r = (rec && rec.resource) || {};
  return { at, obs, cpu: pct(r.cpu_percent), mem: pct(r.memory_percent), disk: pct(r.disk_percent) };
}

/** 버퍼에 점 하나 — 같은 하트비트(또는 더 오래된 것)면 그대로, cap 개를 넘으면 오래된 것부터 버린다. 새 배열 */
export function addPoint(buf, pt, cap = 120) {
  const B = buf || []; if (!pt) return B;
  const last = B[B.length - 1]; if (last && pt.at <= last.at) return B;
  const out = B.concat([pt]); return out.length > cap ? out.slice(out.length - cap) : out;
}

/** 점열 — [{ t, v }] (그 값을 보고한 점만) */
export function series(buf, key) { return (buf || []).filter((p) => p[key] != null).map((p) => ({ t: p.at, v: p[key] })); }

/** 글자 그래프 — 마지막 n 점을 ▁…▇ 로. 모자란 앞자리는 '·'(아직 받지 않음). 점이 없으면 '' */
export function sparkText(pts, n) {
  const B = '▁▂▃▄▅▆▇', L = (pts || []).slice(-n); if (!L.length) return '';
  return '·'.repeat(Math.max(0, n - L.length)) + L.map((p) => B[Math.min(6, Math.max(0, Math.round(p.v * 6)))]).join('');
}

const ago = (s) => (s < 60 ? Math.round(s) + '초 전' : s < 3600 ? Math.round(s / 60) + '분 전' : s < 86400 ? Math.round(s / 3600) + '시간 전' : Math.round(s / 86400) + '일 전');
/**
 * 갱신 주기 · 나이 — 화면이 '실시간인 척하지 않게' 쓰는 글.
 * @returns {{ n: number, lastAt: number|null, ageSec: number|null, everySec: number, text: string }}
 */
export function cadence(buf, now = Date.now(), pollMs = POLL_MS) {
  const B = buf || [], last = B[B.length - 1], every = Math.round(pollMs / 1000);
  if (!last) return { n: 0, lastAt: null, ageSec: null, everySec: every, text: '하트비트 스냅샷 · ' + every + '초마다 · 아직 없음' };
  const age = Math.max(0, (now - last.at) / 1000);
  return { n: B.length, lastAt: last.at, ageSec: Math.round(age), everySec: every, text: '하트비트 스냅샷 · ' + every + '초마다 · ' + ago(age) };
}

/**
 * 노드마다의 버퍼 — main.js 가 refreshTopology 로 노드 목록을 받을 때마다 ingest. window.TerraMetrics
 * @param {{ cap?: number, pollMs?: number, now?: () => number }} [o]
 */
export function createMetrics(o = {}) {
  const cap = o.cap ?? 120, pollMs = o.pollMs ?? POLL_MS, clock = o.now || Date.now, M = new Map();
  return {
    pollMs,
    /** Master 노드 기록들(nodes.get 의 노드) → 노드마다 점 하나씩. 더한 점 수 */
    ingest(records, obs = clock()) {
      let k = 0;
      for (const r of records || []) { if (!r || !r.node_id) continue; const b0 = M.get(r.node_id) || [], b1 = addPoint(b0, pointOf(r, obs), cap); if (b1 !== b0) { M.set(r.node_id, b1); k++; } }
      return k;
    },
    points(id) { return M.get(id) || []; },
    series(id, key) { return series(M.get(id), key); },
    spark(id, key, n) { return sparkText(series(M.get(id), key), n); },
    cadence(id, now = clock()) { return cadence(M.get(id), now, pollMs); },
    clear() { M.clear(); },
  };
}
