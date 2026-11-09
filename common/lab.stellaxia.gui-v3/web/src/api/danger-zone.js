// 위험 영역 — 웹 앱의 명령 실행 스위치(Terra ADR-GW-012 §6.1)를 제어기 설정창에 보이는 순수 함수.
//
//   읽기   terra.daemon.danger-zone.app-command-execution.get  → { allow, changed_at, changed_by, unavailable? }
//   쓰기   이 페이지는 .post 를 부르지 않는다. 앱 토큰이 열 수 있으면 뚫린 페이지가 스스로 켠다.
//          단추는 Scene 에 'danger' 이벤트만 보낸다(window.TerraDangerAsk → frame.emit('danger')).
//          Scene 의 /danger 확인 화면이 상수 입력의 Scene Function 으로 .post 를 부른다 — 사람 세션으로 나간다.
//          터미널 : 아래 DANGER_SET_HINT.

export const DANGER_GET = 'terra.daemon.danger-zone.app-command-execution.get';
export const DANGER_SET_HINT = "terra module call terra.daemon.danger-zone.app-command-execution.post --input '{\"allow\":true}'";
export const DANGER_LABEL = '웹 앱 명령 실행';
export const DANGER_BANNER = '⚠ 웹 앱 명령 실행 허용 중 — 위험 영역';

// 이 op 를 모르는 이전 Terra 의 답 — 화면을 깨지 않고 '이 Terra 판 미지원'으로
const UNSUPPORTED = /NOT_FOUND|NOT_SUPPORTED|UNKNOWN_OP|NO_SUCH_OP/i;

const body = (raw) => (raw && raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) && 'allow' in raw.data ? raw.data : raw);

/**
 * @param {{ data?: any, err?: { code?: string, msg?: string } | null, loading?: boolean } | null | undefined} rd  TerraNodes.read 의 답(없으면 시안)
 * @param {{ remote?: boolean, canAsk?: boolean }} [o]  remote : 다른 노드의 제어기 · canAsk : window.TerraDangerAsk 가 있다
 * @returns {{ state: 'sim'|'loading'|'unsupported'|'error'|'ok', on: boolean, banner: string, status: string, statusCls: 'ok'|'warn'|'', note: string, changed: string, btn: string, btnOff: boolean, why: string, hint: string }}
 */
export function dangerView(rd, o = {}) {
  const remote = !!o.remote, canAsk = !!o.canAsk;
  const base = { on: false, banner: '', note: '', changed: '', hint: DANGER_SET_HINT };
  const btn = (st) => {
    if (st === 'unsupported') return { btn: '변경 ›', btnOff: true, why: '이 Terra 판 미지원 — 스위치 없음' };
    if (remote) return { btn: '이 노드에서만 변경', btnOff: true, why: '잠김 : 이 노드에서만 (원격 제어기) · 그 노드의 제어기에서 변경' };
    if (st === 'sim') return { btn: '변경 ›', btnOff: true, why: '시안(캔버스) — 실제 Terra 에서만 · 터미널 : ' + DANGER_SET_HINT };
    if (!canAsk) return { btn: '변경 ›', btnOff: true, why: '이 화면에서는 확인 화면을 열 수 없음 (Terra 셸 안 앱에서만) · 터미널 : ' + DANGER_SET_HINT };
    return { btn: '변경 ›', btnOff: false, why: '확인 화면으로 이동 — 거기서 켜기 · 끄기' };
  };
  if (!rd) return Object.assign(base, { state: 'sim', status: '꺼짐 (시안)', statusCls: '' }, btn('sim'));
  const d = body(rd.data);
  if (!d || typeof d !== 'object') {
    const code = rd.err && rd.err.code;
    if (code && UNSUPPORTED.test(code)) return Object.assign(base, { state: 'unsupported', status: '이 Terra 판 미지원', statusCls: '', note: '스위치 없음 — 이 Terra 에서는 웹 앱 명령 실행을 막지 않음' }, btn('unsupported'));
    if (rd.err) return Object.assign(base, { state: 'error', status: '읽지 못함', statusCls: 'warn', note: '상태 읽기 실패 : ' + (code || 'ERROR') + (rd.err.msg ? ' — ' + rd.err.msg : '') }, btn('error'));
    return Object.assign(base, { state: 'loading', status: '읽는 중…', statusCls: '' }, btn('loading'));
  }
  const unavail = d.unavailable != null && d.unavailable !== false && d.unavailable !== '';
  const on = d.allow === true && !unavail;   // 읽을 수 없으면 꺼진 것으로 본다
  const note = unavail ? '스위치 파일 읽기 불가 — 꺼진 것으로 처리' + (typeof d.unavailable === 'string' ? ' (' + d.unavailable + ')' : '') : '';
  const by = d.changed_by ? String(d.changed_by) : '', at = d.changed_at ? String(d.changed_at) : '';
  const changed = at || by ? '마지막 변경 : ' + (at || '—') + (by ? ' · ' + by : '') : '마지막 변경 : 없음 (기본값)';
  return Object.assign(base, { state: 'ok', on, banner: on ? DANGER_BANNER : '', status: on ? '허용 중' : '꺼짐', statusCls: on ? 'warn' : 'ok', note, changed }, btn('ok'));
}
