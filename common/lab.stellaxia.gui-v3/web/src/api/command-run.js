// 명령 실행 — 제어기 › 작업 관리자 › 새 명령 (ADR-GW-014 P13-4, 계획 §3 · 명령 실행)
//
//   이 노드      terra.daemon.commands.execute.post (T2)   gui-v3 가 확인 창을 그린다. 이 노드의 '웹 앱 명령 실행' 스위치가 켜져 있어야 한다(꺼져 있으면 잠금).
//   다른 노드    terra.master.commands.post (T3)          승인 문(호스트 화면). 대상 노드의 스위치도 켜져 있어야 한다. 계정 process.execute 필요.
//                 options.require_confirmation 을 켜면 Master 가 명령을 붙잡고(confirmation_required) 확인 대기 목록에 오른다(confirmations.js).
// 두 길 모두 이 파일은 계획만 세운다(순수) — 확인 창 · 승인 문 · 호출은 호출한 쪽이 한다.

import { shellArg } from './terra.js';

export const LOCAL_OP = 'terra.daemon.commands.execute.post';
export const REMOTE_OP = 'terra.master.commands.post';
/** Master 명령 type — Daemon 의 process 실행 요청 */
export const EXEC_TYPE = 'process.execute.request';
export const SWITCH_NAME = '웹 앱 명령 실행';

/**
 * 입력 한 줄 → { command, args }. 첫 낱말이 명령, 나머지가 인자. 따옴표(' ")는 한 낱말로 묶는다.
 * 빈 줄 · 닫히지 않은 따옴표는 error.
 * @returns {{ command: string, args: string[], error: string }}
 */
export function parseLine(line) {
  const src = String(line ?? '').trim();
  if (!src) return { command: '', args: [], error: '명령을 입력' };
  const out = [];
  let cur = '', q = '', has = false;
  for (const ch of src) {
    if (q) { if (ch === q) q = ''; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch;
  }
  if (q) return { command: '', args: [], error: '닫히지 않은 따옴표' };
  if (cur || has) out.push(cur);
  return { command: out[0] || '', args: out.slice(1), error: '' };
}

/**
 * @param {{ line: string, local: boolean, nodeName?: string, nodeId?: string, switchState?: 'on'|'off'|'unknown', who?: { permissions?: string[], allPermissions?: boolean } | null, canApprove?: boolean, timeoutSec?: number, hold?: boolean }} o
 *   switchState : 대상 노드의 '웹 앱 명령 실행' 스위치(읽기 .get) · hold : 다른 노드에서 Master 가 확인을 붙잡게(require_confirmation)
 * @returns {{ kind: 'confirm'|'approve'|'locked', op: string, tier: 'T2'|'T3', input: object|null, summary: string, where: string, reversible: string, why: string }}
 */
export function planCommand(o) {
  const p = parseLine(o.line), node = o.nodeName || (o.local ? '이 노드' : '다른 노드');
  const lock = (why) => ({ kind: 'locked', op: o.local ? LOCAL_OP : REMOTE_OP, tier: o.local ? 'T2' : 'T3', input: null, summary: p.command ? [p.command, ...p.args].join(' ') : '', where: node, reversible: '', why });
  if (p.error) return lock(p.error);
  const who = o.who, all = !!(who && who.allPermissions);
  if (who && !all && Array.isArray(who.permissions) && !who.permissions.includes('process.execute')) return lock('계정 권한 없음 : process.execute — Tree 관리자에게 요청');
  if (o.switchState === 'off') return lock(node + " 의 '" + SWITCH_NAME + "'이 꺼져 있음 — 그 노드의 위험 영역에서 켜기");
  if (o.switchState === 'unknown' && !o.local) return lock(node + " 의 '" + SWITCH_NAME + "' 스위치를 알 수 없음 — 그 노드가 읽히지 않음");
  const summary = [p.command, ...p.args].join(' '), timeout = o.timeoutSec || 60;
  const reversible = '되돌릴 수 없음 — 명령이 한 일은 그대로 남습니다';
  if (o.local) return { kind: 'confirm', op: LOCAL_OP, tier: 'T2', input: { command: p.command, args: p.args, timeout_sec: timeout }, summary, where: node, reversible, why: '' };
  if (!o.nodeId) return lock('대상 노드를 모름');
  if (o.canApprove === false) return lock('승인 문 없음 — Terra 셸 안에서 열기');
  return { kind: 'approve', op: REMOTE_OP, tier: 'T3', input: { target_node_id: o.nodeId, type: EXEC_TYPE, payload: { command: p.command, args: p.args, timeout_sec: timeout }, ...(o.hold ? { options: { require_confirmation: true } } : {}) }, summary, where: node, reversible, why: '' };
}

/** 빈칸 · 셸 문자가 든 인자를 감싼 한 줄(터미널에 붙여 줄 때) */
export const quoteLine = (command, args, os) => [command, ...(args || []).map((a) => shellArg(a, os))].join(' ');

/**
 * 호출 — plan 이 confirm 이면 사용자가 확인 창에서 [실행] 한 뒤에, approve 면 곧바로(승인 문은 호스트가 띄운다) 부른다.
 * @param {ReturnType<typeof planCommand>} plan @param {(op: string, input: object) => Promise<any>} invoke
 * @returns {Promise<{ ok: true, held: boolean, confirmationId: string, jobId: string, taskId: string, data: any } | { ok: false, code: string, message: string }>}
 */
export async function runPlan(plan, invoke) {
  if (plan.kind === 'locked' || !plan.input) return { ok: false, code: 'LOCKED', message: plan.why };
  try {
    const d = await invoke(plan.op, plan.input);
    const x = (d && d.data && typeof d.data === 'object' ? d.data : d) || {};
    return { ok: true, held: x.status === 'confirmation_required', confirmationId: String(x.confirmation_id || ''), jobId: String(x.job_id || ''), taskId: String(x.task_id || x.id || ''), data: d };
  } catch (e) { return { ok: false, code: (e && e.code) || 'ERROR', message: (e && e.message) || '' }; }
}
