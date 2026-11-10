// 이 PC(브라우저)에만 남는 제어기 상태 — 노드의 것이 아니다(설계 docs/design/node-owned-desk.md §4 · §5 · §14).
//   terra.pc.desk.<node_id>                  창 · 순서 · 전체화면 · 탭 · 위치. 지우지 않는다
//   terra.pc.term.<principal>.<node_id>      Terra 터미널 기록(tterm · ttHist). 로그아웃 때 그 계정 것을 지운다
//   terra.pc.migrated                        이행 표시 — 처음 한 번 옛 키(terra.view.desk.* · terra.wall.*)를 지운다
// 키 모양은 design/TerraNodes.dc.html 의 pcDesk · pcTerm 과 같다(tests/pc-state.test.mjs 가 둘이 같은지 본다).

export const PC = 'terra.pc.';
/** principal 은 키 조각으로 안전하게 — '.' 까지 바꿔 한 계정의 접두사가 다른 계정 것과 겹치지 않게 */
export const encPrincipal = (p) => encodeURIComponent(String(p)).replace(/\./g, '%2E');
export const deskKey = (rid) => PC + 'desk.' + rid;
export const termPrefix = (principal) => PC + 'term.' + encPrincipal(principal) + '.';

const keysOf = (st) => { const out = []; try { for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k != null) out.push(k); } } catch { /* 저장소 없음 */ } return out; };

/** 그 계정의 터미널 기록을 지운다. principal 을 모르면 아무것도 지우지 않는다(다른 사람 것을 건드리지 않게). 지운 개수 */
export function clearTerm(storage, principal) {
  if (!storage || !principal) return 0;
  const pre = termPrefix(principal); let n = 0;
  for (const k of keysOf(storage)) if (k.startsWith(pre)) { try { storage.removeItem(k); n++; } catch { /* 무시 */ } }
  return n;
}

const OLD = ['terra.view.desk.', 'terra.wall.'];
/** 새 GUI 가 처음 돌 때 한 번 — 옛 키를 지우고 표시한다(§14). 이미 했으면 false */
export function migratePc(storage) {
  if (!storage) return false;
  try { if (storage.getItem(PC + 'migrated')) return false; } catch { return false; }
  for (const k of keysOf(storage)) if (OLD.some((p) => k.startsWith(p))) { try { storage.removeItem(k); } catch { /* 무시 */ } }
  try { storage.setItem(PC + 'migrated', '1'); } catch { /* 무시 */ }
  return true;
}

/**
 * 로그아웃 공용 — 세 길(sceneLogout · appLogout · onToken(null))이 이것을 부른다. 순서가 중요하다:
 *  1) 'terra-pc-logout' — 제어기가 저장 타이머를 취소하고 메모리의 터미널 기록을 초기값으로 되돌린다(삭제보다 먼저 — 지운 뒤 타이머가 다시 쓰지 않게)
 *  2) 지금 계정의 터미널 기록 삭제
 *  3) window.TerraWho = null
 * 토큰 갱신(같은 계정이 이어짐)은 이것을 부르지 않는다 — 기록을 지우면 안 된다.
 */
export function pcLogout(win, storage) {
  try { win.dispatchEvent(new Event('terra-pc-logout')); } catch { /* 이벤트 없는 환경 */ }
  clearTerm(storage, win.TerraWho && win.TerraWho.principal);
  win.TerraWho = null;
}
