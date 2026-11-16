// 오류 문구 표 — GUI 전 기능 계획 §2.5 (서버 코드 → 화면 문구). 서버 문장을 그대로 두지 않고 이 표를 쓴다.
//   errorHint(op, err, ctx)   표에 있으면 화면 문구, 없으면 ''(호출한 쪽이 서버 문장 + 코드를 쓴다)
//   errorSilent(err)          토스트 없이 끝낼 오류(사람이 거절함)
//   errorLine(op, err, ctx)   표 문구 · 없으면 서버 문장 + 코드. 조용한 오류는 ''
// ctx = { node?: 노드 이름 }  — 문구의 <노드>
import { denyHint } from './gates.js';

const nodeOf = (ctx) => (ctx && ctx.node ? String(ctx.node) + ' 의' : '이 노드의');

/** Retry-After 초 — 오류가 실어 온 것(retryAfter · details.retry_after_seconds). 없으면 0 */
export function retryAfterOf(err) {
  const d = (err && err.details) || {};
  const n = Number((err && err.retryAfter) ?? d.retry_after_seconds ?? d.retryAfter ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

const TABLE = {
  MODULE_REACH_DENIED: () => '이 자격의 도달 범위 밖 — 다른 노드에 닿을 수 없음',
  DELEGATION_NOT_OPEN: () => '앱에 위임 안 됨 — 승인 문으로 하거나 터미널(terra CLI)에서',
  OPERATION_NOT_REMOTE: () => '그 노드에서만 되는 동작',
  REMOTE_MANAGEMENT_DISABLED: (c) => nodeOf(c) + ' 원격 관리가 꺼져 있음 — 그 노드의 위험 영역에서 켜기',
  SERVICE_TUNNEL_DISABLED: (c) => nodeOf(c) + ' \'서비스 터널 열기\'가 꺼져 있음',
  APP_COMMAND_EXECUTION_DISABLED: (c) => nodeOf(c) + ' \'웹 앱 명령 실행\'이 꺼져 있음',
  APPROVAL_EXPIRED: () => '승인 요청이 만료됨(5분) — 다시 누르기',
  REMOTE_MANAGEMENT_APP_REFUSED: () => '원격 관리는 사람만 — 승인 문으로',
  APPROVAL_RATE_LIMITED: () => '승인 요청이 너무 잦음 — 잠시 뒤',
  APPROVAL_UNAVAILABLE: () => '승인 문 없음 — Terra 셸 안에서 열기',
  RECENT_AUTH_REQUIRED: () => '비밀번호를 다시 입력해야 함',
  AUTH_EXPIRED: () => '로그인이 끝남 — 다시 로그인',
  GATEWAY_UNAVAILABLE: () => '이 노드의 Gateway가 응답하지 않음',
  PACKAGE_QUARANTINED: () => '서명 없는 패키지 — 개발 모드 노드에서만',
  INSTALL_IN_PROGRESS: () => '이 모듈을 다른 설치가 진행 중',
  MODULE_REQUIRED: () => 'Tree가 필수로 배포한 모듈 — 여기서 바꿀 수 없음',
  STREAM_NOT_SUPPORTED: () => '실시간으로 볼 수 없음 — 새로 고침으로',
  STREAM_LIMIT: () => '실시간으로 볼 수 없음 — 새로 고침으로',
  SVI_DECLARATION_OUTSIDE_ENVELOPE: () => '파일 울타리 밖 — 그 노드에서 울타리를 넓혀야 함',
  COMMAND_NOT_AVAILABLE: () => '이 Terra에 없는 기능',
};

/** 사람이 거절한 것 — 토스트를 띄우지 않는다 */
export const errorSilent = (err) => !!err && err.code === 'APPROVAL_DECLINED';

/**
 * @param {string} op
 * @param {{ code?: string, status?: number, message?: string, details?: any, retryAfter?: number } | null | undefined} err
 * @param {{ node?: string }} [ctx]
 * @returns {string}  표에 없으면 ''
 */
export function errorHint(op, err, ctx = {}) {
  if (!err || errorSilent(err)) return '';
  const code = String(err.code || '');
  if (TABLE[code]) return TABLE[code](ctx);
  if (code === 'RATE_LIMITED' || code === 'QUOTA_EXCEEDED' || err.status === 429) {
    const s = retryAfterOf(err); return '너무 잦음 — ' + (s ? s + '초 뒤 ' : '') + '다시';
  }
  if (err.status === 503 && retryAfterOf(err)) return 'Master에 닿지 않아 세션을 확인 못 함 — 잠시 뒤';   // "다시 로그인"이라 하지 않는다
  if (code === 'PACKAGE_INCOMPATIBLE') return '이 노드와 맞지 않는 패키지' + (err.message ? ' : ' + err.message : '');
  return denyHint(op, err);   // MODULE_PERMISSION_DENIED · 표 없는 403 — 필요 권한은 op-scope 표에서
}

/** 표 문구, 없으면 서버 문장 + 코드(표에 없는 코드 규칙). 조용한 오류는 '' */
export function errorLine(op, err, ctx = {}) {
  if (errorSilent(err)) return '';
  const h = errorHint(op, err, ctx);
  if (h) return h;
  const code = (err && (err.code || err.status)) || 'ERROR', msg = err && err.message ? String(err.message) : '';
  return msg && msg !== code ? msg + ' (' + code + ')' : String(code);
}
