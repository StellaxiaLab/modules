// 원래 상태값 → 배지 다섯(정상 · 진행 중 · 꺼짐·대기 · 문제 · 끝남). 원래 값은 툴팁(raw)으로 남긴다.
// 화면(src/screens/node.js의 hbVals)과 같은 규칙. 색은 BADGE_COLORS.

/** @type {Record<import('./types.js').BadgeTone, [string, string]>} [배경, 글자] */
export const BADGE_COLORS = {
  ok: ['#e3f4ea', '#1f7a4d'], run: ['#e6efff', '#2563eb'], wait: ['#fbf0cc', '#a65f00'],
  off: ['#eef1f5', '#5b6472'], bad: ['#fde1e5', '#d33d52'], end: ['#f4f6f8', '#8b95a6']
};

const b = (label, tone, raw) => ({ label, tone, raw });

/** @param {import('./types.js').IoDevice} d */
export function ioBadge(d) {
  const raw = `presence ${d.presence} · approval ${d.approval} · ${d.enabled ? 'enabled' : 'disabled'}`;
  if (d.presence === 'missing') return b('사라짐', 'bad', raw);
  if (d.approval === 'denied') return b('거부됨', 'bad', raw);
  if (d.approval === 'pending') return b('승인 대기', 'wait', raw);
  return d.enabled ? b('켜짐', 'ok', raw) : b('꺼짐', 'off', raw);
}

const TABLE = {
  svi: { available: ['쓸 수 있음', 'ok'], busy: ['사용 중', 'run'], disabled: ['꺼짐', 'off'], unavailable: ['보고 끊김', 'bad'], unsupported: ['지원 안 함', 'end'] },
  decl: { applied: ['적용됨', 'ok'], shadowed: ['가려짐', 'wait'], refused_by_policy: ['울타리 밖', 'bad'], retired: ['퇴역', 'end'] },
  bind: { active: ['흐르는 중', 'run'], requested: ['요청됨', 'wait'], validating: ['확인 중', 'run'], preparing: ['준비 중', 'run'], degraded: ['저하', 'wait'], failed: ['실패 · 재시도', 'bad'], closing: ['닫는 중', 'off'], closed: ['닫힘', 'end'] },
  xfer: { prepared: ['준비', 'wait'], transferring: ['전송 중', 'run'], verifying: ['검사 중', 'run'], completed: ['끝남', 'end'], aborted: ['중단됨', 'off'], failed: ['어긋남', 'bad'] },
  tunnel: { listening: ['대기 중', 'ok'], active: ['연결 중', 'run'], failed: ['실패', 'bad'], draining: ['닫는 중', 'off'] },
  wg: { healthy: ['정상', 'ok'], stale: ['오래됨', 'wait'], never: ['본 적 없음', 'off'] },
  job: { queued: ['대기', 'wait'], sent: ['보냄', 'run'], running: ['실행 중', 'run'], success: ['성공', 'ok'], failed: ['실패', 'bad'] },
  mod: { running: ['실행 중', 'ok'], degraded: ['저하', 'wait'], failed: ['실패', 'bad'], stopped: ['멈춤', 'off'] }
};

/**
 * 영역별 상태 → 배지
 * @param {keyof TABLE} area
 * @param {string} state
 * @returns {import('./types.js').Badge}
 */
export function badge(area, state) {
  const row = (TABLE[area] || {})[state];
  return row ? b(row[0], row[1], state) : b(state, 'off', state);
}
