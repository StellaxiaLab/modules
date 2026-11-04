// 밀어 받기 반영 — 다시 읽은 목록에서 이전과 달라진 줄 찾기. 제어기(NodeDesktopEmbed)가 작업 · 모듈 · 파일 목록 줄에 짧은 깜박임과 '새로' · '바뀜' 배지를 단다.
//   데이터 층(TerraNodes)은 고치지 않는다 — 사본이 바뀌면 이미 subscribe 로 다시 그리므로, 보드가 그릴 때 이전 목록(서명)과 견준다.
//   처음 보는 목록(이전이 없음)은 아무것도 깜박이지 않는다 — 창을 열 때 전부 '새로' 가 되지 않게.
//   보드에 같은 함수가 들어 있다(캔버스에는 이 파일이 없다) — tests/desk-files-jobs.test.mjs 가 둘이 같게 답하는지 본다.

/** 줄 → 서명 맵. id(row) 가 빈 줄은 뺀다 @returns {Map<string, string>} */
export function signMap(rows, id, sig) {
  const m = new Map();
  for (const r of rows || []) { const k = id(r); if (k === '' || k === null || k === undefined) continue; m.set(String(k), sig(r)); }
  return m;
}

/** 이전 서명 맵 vs 지금 서명 맵 → { added, changed, removed } (id 집합). prev 가 null 이면 모두 빈 집합 */
export function diffSigns(prev, next) {
  const added = new Set(), changed = new Set(), removed = new Set();
  if (!prev) return { added, changed, removed };
  for (const [k, v] of next) { if (!prev.has(k)) added.add(k); else if (prev.get(k) !== v) changed.add(k); }
  for (const k of prev.keys()) if (!next.has(k)) removed.add(k);
  return { added, changed, removed };
}

/** 한 번에 — 이전 줄 목록 vs 지금 줄 목록 */
export function diffRows(prevRows, nextRows, id, sig) {
  return diffSigns(prevRows ? signMap(prevRows, id, sig) : null, signMap(nextRows, id, sig));
}

export const FLASH_MS = 1200;
