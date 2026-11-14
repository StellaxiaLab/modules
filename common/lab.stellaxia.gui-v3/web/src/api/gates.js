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

/** 앱 토큰에 닫힌 Daemon 위임 문(daemon_delegation.go) — 선언 적용 · 은퇴 잊기는 위임 호출자에게 닫혀 있다. 호출하지 않고 잠근다 */
const DAEMON_CLOSED = {
  'terra.daemon.svi.declarations.apply.post': '잠김 : 앱 토큰에 닫힘 — 선언 적용은 터미널(terra svi apply)에서',
  'terra.daemon.svi.declarations.retired.by-family.by-name.forget.post': '잠김 : 앱 토큰에 닫힘 — 은퇴 선언 잊기는 터미널에서',
};
/** 선언 계열(declare · undeclare)은 앱 토큰에 module · file 패밀리만 열려 있고, 다른 노드로는 전부 닫힌다 */
const DECLARE_OPS = new Set(['terra.daemon.svi.declarations.post', 'terra.daemon.svi.declarations.by-family.by-name.undeclare.post']);
const DECLARE_FAMILIES = ['module', 'file'];
/** Gateway 에 게시만 되어 있고 Daemon 백엔드가 늘 501 인 op — Terra 에 구현 없음(영구 끄기 · 켜기 · 롤백). 프로세스 정지는 modules.by-module-id.stop */
const NOT_IMPLEMENTED = {
  'terra.gateway.modules.by-id.disable.post': '잠김 : Terra 에 구현 없음 — 영구 끄기 필요(Daemon). 프로세스 정지는 멈춤 단추로',
  'terra.gateway.modules.by-id.enable.post': '잠김 : Terra 에 구현 없음 — 영구 켜기 필요(Daemon). 프로세스 시작은 시작 단추로',
  'terra.gateway.modules.by-id.rollback.post': '잠김 : Terra 에 구현 없음 — 롤백 필요(Daemon)',
};
/** 위임 표에는 있으나 Master 가 앱 선언에 없는 권한을 요구하는 op(rerun 은 process.execute.delegated) */
const APP_LACKS = { 'terra.master.jobs.by-job-id.rerun.post': 'process.execute.delegated' };

/**
 * @param {string} op
 * @param {{ remote?: boolean, who?: { permissions?: string[] } | null }} [o]
 * @returns {{ open: boolean, needs: '' | 'core' | 'app-perm' | 'user-perm' | 'local', why: string, op: string }}
 */
export function gate(op, o = {}) {
  const shut = (needs, why) => ({ open: false, needs, why, op });
  if (NOT_IMPLEMENTED[op]) return shut('core', NOT_IMPLEMENTED[op]);
  if (APP_LACKS[op]) return shut('app-perm', '잠김 : 앱 토큰에 없는 권한 — ' + APP_LACKS[op]);
  if (DAEMON_CLOSED[op]) return shut('core', DAEMON_CLOSED[op]);
  if (DECLARE_OPS.has(op)) {
    if (o.replace && o.app) return shut('core', '잠김 : 앱 토큰에 닫힘 — 같은 이름 자원 교체(replace)는 터미널에서');   // daemon_delegation.go — 앱(스코프) 토큰 호출자의 replace 는 늘 DELEGATION_NOT_OPEN — 셸(B) 모드의 핸들 로그인은 위임이 아니라 열려 있다(o.app 은 A 모드만)
    if (o.remote) return shut('local', '잠김 : 다른 노드의 선언은 앱 토큰에 닫힘 — 이 노드에서만');
    if (o.family && !DECLARE_FAMILIES.includes(o.family)) return shut('core', '잠김 : 앱 토큰은 module · file 패밀리만 선언 — ' + o.family + ' 는 터미널에서');
  }
  // 사람의 권한을 모르면(whoami 실패 · 아직 못 받음) 열지 않는다 — who 키를 준 호출만(없으면 권한 조회를 하지 않는 시안 · 시험)
  const whoAll = !!(o.who && o.who.allPermissions);   // 전체 권한 계정 — 사람 권한 검사를 건너뛴다(권한 목록이 없어도)
  const whoUnknown = !whoAll && 'who' in o && !(o.who && Array.isArray(o.who.permissions));
  if (op.startsWith('terra.master.')) {
    if (!MD.operations[op]) return shut('core', '잠김 : 위임 없음 — ' + op);
    if (whoUnknown && (MD.operations[op].permissions || []).length) return shut('user-perm', '잠김 : 계정 권한을 알 수 없음 — whoami 못 받음');
    const need = whoAll ? [] : (MD.operations[op].permissions || []).filter((p) => o.who && Array.isArray(o.who.permissions) && !o.who.permissions.includes(p));
    if (need.length) return shut('user-perm', '잠김 : 계정 권한 없음 — ' + need.join(' · '));
    return { open: true, needs: '', why: '', op };
  }
  const S = SCOPE.operations[op];
  if (!S) return op.startsWith('terra.daemon.') ? shut('core', '잠김 : 계약 없음 — ' + op) : { open: true, needs: '', why: '', op };
  const app = S.permissions.filter((p) => !APP_PERMS.includes(p));
  if (app.length) return shut('app-perm', '잠김 : 앱 권한 없음 — ' + app.join(' · '));
  if (o.remote && !S.scopes.includes('cluster')) return shut('local', '잠김 : 이 노드에서만');
  if (whoUnknown && S.permissions.some((p) => p !== 'node.read')) return shut('user-perm', '잠김 : 계정 권한을 알 수 없음 — whoami 못 받음');   // 읽기는 열어 둔다(서버가 가른다) · 쓰기는 닫는다
  const user = whoAll ? [] : S.permissions.filter((p) => o.who && Array.isArray(o.who.permissions) && !o.who.permissions.includes(p));
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
  const msg = (err && typeof err.message === 'string') ? err.message : '';
  const account = code === 'MODULE_PERMISSION_DENIED' || (code === 'FORBIDDEN' && msg.startsWith('permission ')) || (err && err.status === 403 && (!code || String(code).startsWith('HTTP_')));
  if (account) {
    const row = (SCOPE.operations[op] && SCOPE.operations[op].permissions) || (MD.operations[op] && MD.operations[op].permissions) || [];
    if (row.length) return '계정 권한 없음 : ' + row.join(' · ') + ' — Tree 관리자에게 요청';
  }
  return '';
}
