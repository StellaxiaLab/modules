// 알림 — 이 노드 Daemon 의 진짜 작업(terra.daemon.tasks.get)에서 만든다.
//
// Daemon 의 이벤트 스트림(GET /events)은 WebSocket 이라 frame 안의 웹이 스코프 토큰을 실어 열 수 없다
// (WebSocket 은 Authorization 헤더를 싣지 못한다). 그래서 작업 목록을 주기적으로 읽어 상태가 바뀐 것을
// 알림으로 바꾼다. 화면의 알림 한 줄 모양 { t, g, c, m } 을 그대로 쓴다.

const STATE = {
  succeeded: { label: '완료', g: '●', c: '#4ade80' },
  success: { label: '완료', g: '●', c: '#4ade80' },
  completed: { label: '완료', g: '●', c: '#4ade80' },
  failed: { label: '실패', g: '■', c: '#ff6b81' },
  dead_letter: { label: '실패', g: '■', c: '#ff6b81' },
  timed_out: { label: '시간 초과', g: '■', c: '#ff6b81' },
  canceled: { label: '취소됨', g: '◐', c: '#fbbf24' },
  cancelled: { label: '취소됨', g: '◐', c: '#fbbf24' },
  running: { label: '실행 중', g: '◇', c: '#60a5fa' },
  pending: { label: '대기', g: '◇', c: '#60a5fa' },
  queued: { label: '대기', g: '◇', c: '#60a5fa' }
};

const pad = (n) => String(n).padStart(2, '0');
/** 'HH:MM' (로컬 시각). 읽을 수 없으면 '' */
export function clock(iso, now = Date.now()) {
  const d = new Date(iso || now);
  return Number.isNaN(d.getTime()) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 작업 하나 → 알림 한 줄 */
export function taskAlarm(task) {
  const s = STATE[task.state] || { label: task.state || '알 수 없음', g: '◐', c: '#fbbf24' };
  const when = task.finished_at || task.started_at || task.created_at;
  return { t: clock(when), g: s.g, c: s.c, m: (task.type || task.kind || '작업') + ' · ' + s.label + ' — #' + String(task.id || '').slice(-6), id: task.id, at: when || '' };
}

/**
 * 작업 목록에서 새로 생겼거나 상태가 바뀐 것만 알림으로 낸다.
 * @param {Map<string, string>} seen  작업 id → 지난번에 본 상태 (호출이 갱신한다)
 * @param {any[]} tasks               terra.daemon.tasks.get 의 tasks
 * @param {{ first?: boolean, limit?: number }} [opts]  first = 처음 읽기 — 최근 것 limit 개만 알림으로
 * @returns {{ t: string, g: string, c: string, m: string }[]} 새 알림 (최근 것이 앞)
 */
export function taskAlarms(seen, tasks, opts = {}) {
  const list = (Array.isArray(tasks) ? tasks : []).filter((t) => t && t.id);
  const at = (t) => Date.parse(t.finished_at || t.started_at || t.created_at || '') || 0;
  list.sort((a, b) => at(b) - at(a));
  const out = [];
  for (const t of list) {
    if (seen.get(t.id) === t.state) continue;
    seen.set(t.id, t.state);
    out.push(taskAlarm(t));
  }
  return opts.first ? out.slice(0, opts.limit || 10) : out;
}
