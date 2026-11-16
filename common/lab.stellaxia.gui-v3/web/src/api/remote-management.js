// 원격 관리 — 다른 노드의 사람이 이 노드의 설정 · 재시작 · WireGuard · 장치를 승인 문으로 쓰게 하는 스위치(ADR-GW-014 Q3 · D2, 계획 §1.3 · P15).
//
//   읽기   terra.daemon.danger-zone.remote-management.get → { enabled, duration: '1h'|'24h'|'always'|'', expires_at, changed_at, changed_by, unavailable? }
//          다른 노드에서도 읽을 수 있다(읽기 전용) — 원격 제어기의 잠금 칩이 그 노드의 스위치를 본다.
//   쓰기   이 페이지는 .post 를 부르지 않는다(앱 토큰은 DELEGATION_NOT_OPEN). 켜기 · 끄기 · 기간 고르기는 Scene 호스트의 확인 화면(P15-1 짝).
//          터미널 : REMOTE_SET_HINT.
//   원격 쓰기  승인 문 대상 중 execution.approval.switch = "remote-manage" 인 op(op-scope.json 의 switch)를 다른 노드에 하려면
//          그 노드의 스위치가 켜져 있어야 하고, 앱 토큰이 아니라 승인 문을 거친 사람 호출만 받는다(REMOTE_MANAGEMENT_APP_REFUSED).

import SCOPE from './op-scope.json' with { type: 'json' };

export const REMOTE_GET = 'terra.daemon.danger-zone.remote-management.get';
export const REMOTE_SET = 'terra.daemon.danger-zone.remote-management.post';
export const REMOTE_LABEL = '원격 관리';
export const REMOTE_SUB = '다른 노드의 사람이 이 노드의 설정 · 재시작 · WireGuard · 장치를 승인 문으로 · 기본 꺼짐 · 켤 때 기간을 고름';
export const REMOTE_BANNER = '⚠ 원격 관리 허용 중 — 위험 영역';
export const REMOTE_SET_HINT = "terra module call " + REMOTE_SET + " --input '{\"enabled\":true,\"duration\":\"1h\"}'";
export const DURATION_TEXT = { '1h': '1시간', '24h': '하루', always: '계속' };

/** 원격 관리 스위치 뒤에 있는 op — 계약(execution.approval.switch)에서 뽑은 op-scope.json 이 원본 */
export const REMOTE_MANAGE_OPS = new Set(Object.keys(SCOPE.operations).filter((k) => SCOPE.operations[k].switch === 'remote-manage'));
export const needsRemoteManage = (op) => REMOTE_MANAGE_OPS.has(op);

// 이 op 를 모르는 이전 Terra 의 답 — 화면을 깨지 않고 '이 Terra 판 미지원'으로
const UNSUPPORTED = /NOT_FOUND|NOT_SUPPORTED|UNKNOWN_OP|NO_SUCH_OP/i;
const isSw = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && 'enabled' in x;
const body = (raw) => (isSw(raw && raw.data) ? raw.data : isSw(raw && raw.data && raw.data.data) ? raw.data.data : raw);   // 답 · 봉투 { data } · 이중 봉투 모두

/** 남은 시간 한 줄 — 기간이 계속이면 '계속', 끝났으면 '' */
export function remainText(d, now = Date.now()) {
  if (!d || d.enabled !== true) return '';
  if (d.duration === 'always' || (!d.expires_at && d.duration !== '1h' && d.duration !== '24h')) return '계속';
  const t = Date.parse(d.expires_at);
  if (!Number.isFinite(t)) return DURATION_TEXT[d.duration] ? DURATION_TEXT[d.duration] + ' 기간' : '';
  const s = Math.floor((t - now) / 1000);
  if (s <= 0) return '곧 꺼짐';
  if (s < 60) return '1분 미만 남음';
  const m = Math.floor(s / 60);
  if (m < 60) return m + '분 남음';
  const h = Math.floor(m / 60), r = m % 60;
  return h + '시간' + (r ? ' ' + r + '분' : '') + ' 남음';
}

/**
 * 스위치 상태 — 설정 › 위험 영역 줄과 원격 제어기 칩이 함께 쓴다.
 * @param {{ data?: any, err?: { code?: string, msg?: string } | null, loading?: boolean } | null | undefined} rd  TerraNodes.read 의 답(없으면 시안)
 * @param {{ remote?: boolean, canAsk?: boolean, now?: number }} [o]
 * @returns {{ state: 'sim'|'loading'|'unsupported'|'error'|'ok', on: boolean, off: boolean, known: boolean, banner: string, status: string, statusCls: 'ok'|'warn'|'', remain: string, note: string, changed: string, btn: string, btnOff: boolean, why: string, hint: string, label: string, sub: string }}
 */
export function remoteMgmtView(rd, o = {}) {
  const remote = !!o.remote, now = o.now ?? Date.now();
  const base = { on: false, off: false, known: false, banner: '', remain: '', note: '', changed: '', hint: REMOTE_SET_HINT, label: REMOTE_LABEL, sub: REMOTE_SUB };
  // 확인 화면(기간 고르기)은 Scene 호스트 쪽 — 이 앱은 그 결과(.get)만 쓴다. 그 화면이 올 때까지 단추는 닫고 터미널 문구를 보인다
  const btn = (st) => {
    if (st === 'unsupported') return { btn: '변경 ›', btnOff: true, why: '이 Terra 판 미지원 — 스위치 없음' };
    if (remote) return { btn: '이 노드에서만 변경', btnOff: true, why: '잠김 : 이 노드에서만 (원격 제어기) · 그 노드의 제어기에서 변경' };
    if (st === 'sim') return { btn: '변경 ›', btnOff: true, why: '시안(캔버스) — 실제 Terra 에서만 · 터미널 : ' + REMOTE_SET_HINT };
    if (!o.canAsk) return { btn: '변경 ›', btnOff: true, why: '이 Terra 셸에는 기간을 고르는 확인 화면이 아직 없음 · 터미널 : ' + REMOTE_SET_HINT };
    return { btn: '변경 ›', btnOff: false, why: '확인 화면으로 이동 — 거기서 기간(1시간 · 하루 · 계속)을 골라 켜기 · 끄기' };
  };
  if (!rd) return Object.assign(base, { state: 'sim', status: '꺼짐 (시안)', statusCls: '' }, btn('sim'));
  const d = body(rd.data);
  if (!isSw(d)) {
    const code = rd.err && rd.err.code;
    if (code && UNSUPPORTED.test(code)) return Object.assign(base, { state: 'unsupported', status: '이 Terra 판 미지원', statusCls: '', note: '스위치 없음 — 이 Terra 는 원격 관리 스위치가 없어 다른 노드의 쓰기를 받지 않음' }, btn('unsupported'));
    if (rd.err) return Object.assign(base, { state: 'error', status: '읽지 못함', statusCls: 'warn', note: '상태 읽기 실패 : ' + (code || 'ERROR') + (rd.err.msg ? ' — ' + rd.err.msg : '') }, btn('error'));
    if (rd.data != null) return Object.assign(base, { state: 'error', status: '읽지 못함', statusCls: 'warn', note: '상태 읽기 실패 : 낯선 응답 (BAD_RESPONSE)' }, btn('error'));
    return Object.assign(base, { state: 'loading', status: '읽는 중…', statusCls: '' }, btn('loading'));
  }
  const unavail = d.unavailable != null && d.unavailable !== false && d.unavailable !== '';
  const remain = remainText(d, now);
  const ended = d.duration !== 'always' && !!d.expires_at && Date.parse(d.expires_at) <= now;   // 끝난 기간은 꺼진 것 — 서버가 스스로 끈 뒤의 상태를 답하지만 시계 차이를 한 번 더 막는다
  const on = d.enabled === true && !unavail && !ended;
  const note = unavail ? '스위치 파일 읽기 불가 — 꺼진 것으로 처리' + (typeof d.unavailable === 'string' ? ' (' + d.unavailable + ')' : '') : '';
  const by = d.changed_by ? String(d.changed_by) : '', at = d.changed_at ? String(d.changed_at) : '';
  const changed = at || by ? '마지막 변경 : ' + (at || '—') + (by ? ' · ' + by : '') : '마지막 변경 : 없음 (기본값)';
  const dur = DURATION_TEXT[d.duration] || '';
  const status = on ? '허용 중 · ' + (remain === '계속' ? '계속' : remain || dur) : '꺼짐';
  return Object.assign(base, { state: 'ok', known: true, on, off: !on, remain: on ? remain : '', banner: on ? REMOTE_BANNER : '', status, statusCls: on ? 'warn' : 'ok', note, changed }, btn('ok'));
}

/**
 * 원격 제어기의 칩 — 이 원격 노드에 쓰기를 하려 할 때 그 노드의 스위치가 어떤가.
 *   읽지 못했거나 이 Terra 에 스위치가 없으면 잠그지 않는다(서버가 REMOTE_MANAGEMENT_DISABLED 로 가른다) — 모르는 것을 꺼짐으로 단정하지 않는다.
 * @returns {{ lock: boolean, why: string, on: boolean, chip: string, cls: 'ok'|'warn'|'' }}
 */
export function remoteChip(view, nodeName = '') {
  const of = nodeName ? nodeName + ' 의' : '이 노드의';
  if (!view || !view.known) return { lock: false, why: '', on: false, chip: '', cls: '' };
  if (view.off) return { lock: true, why: '잠김 : ' + of + ' 원격 관리가 꺼져 있음 — 그 노드의 위험 영역에서 켜기', on: false, chip: '원격 관리 꺼짐', cls: '' };
  return { lock: false, why: '', on: true, chip: '원격 관리 켜짐' + (view.remain ? ' · ' + view.remain : ''), cls: 'warn' };
}
