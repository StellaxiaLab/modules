// 승인 문 길 — 영역별 B 단추가 앱 토큰이 아니라 사람의 승인(호스트 화면)으로 나가게 한다 (ADR-GW-014 P13-4).
//
// 표(approval-ops.json)는 Terra 계약의 execution.approval 에서 뽑은 것이다. 이 앱이 승인 문으로 보내는 것은 그중
//   · 원격 관리 스위치 뒤의 op 가 아닌 것(스위치 뒤의 op 는 이 노드면 앱 토큰으로 · 다른 노드면 transport 의 approveRemote 가 이미 승인 문으로 보낸다)
//   · Daemon 이 앱 토큰에 닫아 둔 것(SVI 선언 적용 · 잊기 — 스위치 뒤지만 이 노드에서도 닫힘)
//   · 이 PR 의 몫이 아닌 것은 뺀다 — /admin(P13-3 호스트 화면) · 모듈 배포 · 승격 · Master 설정(P14)
// 사람의 세션으로 부르는 B 모드(단독 웹 · 자격 핸들)는 승인 문이 필요 없다 — 사람이 곧 호출자다. 앱(A) 모드만 승인 문을 거친다.
import APPROVAL from './approval-ops.json' with { type: 'json' };
import { approveOp } from './approve.js';

const T = APPROVAL.operations;

/** 스위치 뒤인데도 이 노드의 앱 토큰에 닫혀 있는 것 — 이 노드에서도 승인 문으로(gates.js DAEMON_CLOSED 와 같은 목록) */
const CLOSED_LOCAL = new Set([
  'terra.daemon.svi.declarations.apply.post',
  'terra.daemon.svi.declarations.retired.by-family.by-name.forget.post',
]);
/** 승인 문 밖 접두 — /admin 은 호스트 화면(P13-3). 모듈 배포 · 승격 · Master 설정은 P14-4(#226)로 이 문에 올라와 여기 없다(남겨 두면 gate() 가 위임 표로 떨어져 '위임 없음' 으로 잠겼다 — D7) */
const OTHER_PHASE = ['admin'].map((x) => 'terra.master.' + x + '.');

/**
 * 승인 문 op 의 '사람 권한' — whoami 가 앱(위임) 토큰이면(delegate 가 있다) 그 permissions 는 앱 토큰의 교집합이지 승인하는 사람의 권한이 아니다.
 * 그래서 module.publish · master.admin 을 가진 관리자도 whoami 로는 없어 보여 승인 문 단추가 '계정 권한 없음' 으로 잠겼다(D7). 앱 토큰 whoami 면 알 수 없음(null) —
 * 승인해도 거절될지는 승인 문 · Master 가 가린다(미리보기가 '알 수 없음' 으로 알린다). 사람 세션 whoami(delegate 없음)만 그대로 쓴다.
 */
export const humanWho = (who) => (who && who.delegate ? null : who);

/** 계약이 이 op 에 승인 문을 요구하나(표에 있나) */
export const hasApproval = (op) => !!T[op];
export const approvalOf = (op) => T[op] || null;
export const tierOf = (op) => (T[op] && T[op].tier) || '';

/** 이 앱이 이 op 를 승인 문으로 보내는가 */
export function viaDoor(op) {
  const a = T[op]; if (!a) return false;
  if (OTHER_PHASE.some((p) => op.startsWith(p))) return false;
  if (a.switch === 'remote-manage') return CLOSED_LOCAL.has(op);
  return true;
}

/** 모든 승인 문 대상 단추 — 시험 · 문서용 */
export const doorOps = () => Object.keys(T).filter(viaDoor);

export const TIER_TEXT = { T3: '승인 필요', T4: '승인 필요 · 비밀번호 다시 입력' };
export const IMPACT_TEXT = { node: '이 노드 하나', cluster: '클러스터 전체', trust: '신뢰 · 자격' };

/**
 * 단추를 누르기 전에 사람에게 미리 알릴 것 — 권한 없는 사람에겐 승인 문을 열지 않고 이유를 보인다(계획 §2.3).
 * @param {string} op
 * @param {{ who?: { permissions?: string[], allPermissions?: boolean } | null, app?: boolean, canApprove?: boolean }} [o]
 * @returns {{ door: boolean, tier: string, tierText: string, impact: string, missing: string[], ok: boolean, why: string }}
 */
export function approvalPreview(op, o = {}) {
  const a = T[op];
  if (!a || !viaDoor(op)) return { door: false, tier: '', tierText: '', impact: '', missing: [], ok: true, why: '' };
  const delegated = !!(o.who && o.who.delegate), who = humanWho(o.who), all = !!(who && who.allPermissions);
  const known = all || !!(who && Array.isArray(who.permissions));
  const missing = all || !known ? [] : a.permissions.filter((p) => !who.permissions.includes(p));
  let why = '';
  if (o.app && o.canApprove === false) why = '승인 문 없음 — Terra 셸 안에서 열기';
  else if (delegated) why = '';   // 앱 토큰 whoami — 사람 권한은 승인 문이 가린다
  else if (!known) why = '계정 권한을 알 수 없음 — 승인해도 거절될 수 있음';
  else if (missing.length) why = '계정 권한 없음 : ' + missing.join(' · ') + ' — 승인해도 거절됩니다';
  return { door: true, tier: a.tier, tierText: TIER_TEXT[a.tier] || '승인 필요', impact: IMPACT_TEXT[a.impact] || a.impact, missing, ok: !why || !missing.length && known, why };
}

/**
 * createTerra 의 approveFor 훅 — 앱(A) 모드에서 표에 있는 op 를 승인 문으로 보낸다. 아니면 null(그냥 부른다).
 * 실패는 { ok:false, code, message, status } 로 — createTerra 가 TerraError 로 던지고 화면이 §2.5 문구로 말한다.
 * @param {{ frame: () => any, mode: () => string }} d
 */
export function makeApproveFor(d) {
  return (op, input, at) => {
    if (d.mode() !== 'app' || !viaDoor(op)) return null;
    const node = at && at.node ? at.node : '';
    const f = d.frame();
    return approveOp(f && typeof f.approve === 'function' ? { approve: (r) => f.approve(node ? { ...r, node } : r) } : null, op, input || {}, {});
  };
}
