// 문(gate) — 이 버튼이 지금 열릴 수 있나, 아니면 누가 무엇을 열어 줘야 하나.
//
// 화면은 모두 그리되(디자인 → 구현), 코어가 앱 토큰에 열지 않은 operation 은 단추를 잠그고 그 이유를 적는다.
// 코어가 열면(위임 표 · 권한이 바뀌면) 화면을 고치지 않고 단추가 저절로 열린다 — 표를 다시 뽑기만 하면 된다.
//
//   terra.master.*   Master 위임 표(master-delegated.json — tools/gen-master-delegated.mjs 가 Terra 계약에서 뽑음)에 있어야 앱 토큰으로 닿는다
//   terra.daemon.*   Daemon 계약 표(op-scope.json)의 권한이 이 앱의 권한(APP_PERMS — module.json 과 같게, 시험이 지킨다)에 있어야 한다.
//                    다른 노드면 scopes 에 cluster 가 있어야 한다(local 전용은 이 노드에서만)
//   그 밖(모듈 op)    막지 않는다 — 모듈이 없으면 Gateway 가 MODULE_NOT_FOUND 로 답하고 화면이 그대로 옮긴다
//
// 사람의 권한(whoami.permissions)을 주면 그것도 본다 — 앱이 가진 권한이라도 사람에게 없으면 Gateway 가 403 이다.

import SCOPE from './op-scope.json' with { type: 'json' };
import MD from './master-delegated.json' with { type: 'json' };

/** 이 앱(lab.stellaxia.gui-v3.web)이 module.json 에 선언한 권한 — tests 가 module.json 과 같은지 본다 */
export const APP_PERMS = ['session.identity', 'node.read', 'node.control', 'node.config', 'file.read', 'file.write', 'process.execute', 'module.manage'];


/**
 * @param {string} op
 * @param {{ remote?: boolean, who?: { permissions?: string[] } | null }} [o]
 * @returns {{ open: boolean, needs: '' | 'core' | 'app-perm' | 'user-perm' | 'local', why: string, op: string }}
 */
export function gate(op, o = {}) {
  const shut = (needs, why) => ({ open: false, needs, why, op });
  if (op.startsWith('terra.master.')) {
    if (!MD.operations[op]) return shut('core', '잠김 : 위임 없음 — ' + op);
    const need = (MD.operations[op].permissions || []).filter((p) => o.who && Array.isArray(o.who.permissions) && !o.who.permissions.includes(p));
    if (need.length) return shut('user-perm', '잠김 : 계정 권한 없음 — ' + need.join(' · '));
    return { open: true, needs: '', why: '', op };
  }
  const S = SCOPE.operations[op];
  if (!S) return op.startsWith('terra.daemon.') ? shut('core', '잠김 : 계약 없음 — ' + op) : { open: true, needs: '', why: '', op };
  const app = S.permissions.filter((p) => !APP_PERMS.includes(p));
  if (app.length) return shut('app-perm', '잠김 : 앱 권한 없음 — ' + app.join(' · '));
  if (o.remote && !S.scopes.includes('cluster')) return shut('local', '잠김 : 이 노드에서만');
  const user = S.permissions.filter((p) => o.who && Array.isArray(o.who.permissions) && !o.who.permissions.includes(p));
  if (user.length) return shut('user-perm', '잠김 : 계정 권한 없음 — ' + user.join(' · '));
  return { open: true, needs: '', why: '', op };
}

/** 여러 op 가 모두 열려야 하는 단추 — 처음 닫힌 것의 이유 */
export function gateAll(ops, o = {}) {
  for (const op of ops) { const g = gate(op, o); if (!g.open) return g; }
  return { open: true, needs: '', why: '', op: ops.join(' · ') };
}

/** 위험도 — 확인 단계의 문구를 고를 때(read · write · dangerous). 표에 없으면 '' */
export const riskOf = (op) => (SCOPE.operations[op] && SCOPE.operations[op].risk) || (MD.operations[op] && MD.operations[op].risk) || '';

/**
 * 거부 사유 한 줄 — Gateway 가 403 / DELEGATION_NOT_OPEN 으로 답했을 때 화면이 이유를 말하게 한다.
 * 필요한 권한을 표(op-scope → master-delegated)에서 못 찾으면 지어내지 않고 '' (호출한 쪽이 서버 문장을 그대로 쓴다).
 * @param {string} op
 * @param {{ code?: string, status?: number } | null | undefined} err
 * @returns {string}
 */
export function denyHint(op, err) {
  const code = err && err.code;
  if (code === 'DELEGATION_NOT_OPEN') return '앱에 위임 안 됨 — 터미널(terra CLI)에서 가능';
  if (code === 'MODULE_PERMISSION_DENIED' || code === 'FORBIDDEN' || (err && err.status === 403)) {
    const row = (SCOPE.operations[op] && SCOPE.operations[op].permissions) || (MD.operations[op] && MD.operations[op].permissions) || [];
    if (row.length) return '계정 권한 없음 : ' + row.join(' · ') + ' — Tree 관리자에게 요청';
  }
  return '';
}
