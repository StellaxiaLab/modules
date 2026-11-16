// 승인 문 — frame 클라이언트 approve() 위의 얇은 층 (ADR-GW-014 P10-5 · P10-7).
//
// 페이지는 "이 op 를 이 입력으로 하고 싶다"고 *제안*만 한다. 호스트(Terra 셸)가 계약에서 이 op 가 승인 문 대상인지 보고,
// 사람에게 승인 화면을 띄우고, 사람이 승인하면 호스트가 사람 세션으로 부른다. 입력은 제안 때 해시로 묶여 바꿔 보낼 수 없다.
// 결과는 던지지 않고 { ok, ... } 로 돌아온다 — 거절 · 만료 · 승인 문 없음(B 모드)도 같은 모양이다.
//
//   const r = await approveOp(frame, 'terra.master.<…>.post', { cluster_id: 'c-01' });
//   r.ok ? r.data : r.text   // r.text = §2.5 표 문구('' 이면 조용히 — 사람이 거절함)
import { errorHint, errorLine } from './error-text.js';

/**
 * @param {{ approve?: (r: { operationId: string, inputs?: Record<string, unknown> }) => Promise<any> } | null | undefined} frame  connectTerra() 가 돌려준 연결(없으면 승인 문 없음)
 * @param {string} operationId
 * @param {Record<string, unknown>} [inputs]
 * @param {{ node?: string }} [ctx]
 * @returns {Promise<{ ok: true, status: number, data: any, withheld: string[] } | { ok: false, code: string, message: string, status?: number, text: string }>}
 */
export async function approveOp(frame, operationId, inputs = {}, ctx = {}) {
  let r;
  if (!frame || typeof frame.approve !== 'function') r = { ok: false, code: 'APPROVAL_UNAVAILABLE', message: '' };
  else {
    try { r = await frame.approve({ operationId, inputs: { ...inputs } }); }
    catch (e) { r = { ok: false, code: 'APPROVAL_FAILED', message: (e && e.message) || '' }; }
  }
  if (r && r.ok) return r;
  const err = { code: (r && r.code) || 'APPROVAL_FAILED', message: (r && r.message) || '', status: r && r.status };
  return { ok: false, code: err.code, message: err.message, ...(err.status ? { status: err.status } : {}), text: errorLine(operationId, err, ctx), hint: errorHint(operationId, err, ctx) };
}
