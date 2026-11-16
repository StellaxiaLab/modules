// terra file sync 와 같은 규칙의 계획 — 로컬 폴더가 기준이고, 방향은 로컬 → 노드 하나뿐이다.
//   노드에 없거나, 크기가 다르거나, 로컬이 더 최신이면 보낸다.
//   노드에만 있는 파일은 remove 를 켰을 때만 지운다. 심볼릭 링크는 따라가지 않는다(브라우저는 애초에 못 본다).
// 체크섬 비교(--checksum)는 하지 않는다: 노드에서 파일 전체를 읽어야 해서 이 화면은 크기 · 시각만 비교한다.

/**
 * @param {{ path: string, size: number, mtime: number }[]} local  mtime 은 ms
 * @param {{ path: string, size: number, modified_at: string, is_dir?: boolean }[]} remote 파일만 넘긴다
 * @param {{ remove?: boolean }} [o]
 */
export function planSync(local, remote, o = {}) {
  const have = new Map((remote || []).filter((r) => !r.is_dir).map((r) => [r.path, r]));
  const out = { add: [], change: [], remove: [], same: 0 };
  const seen = new Set();
  for (const f of local || []) {
    seen.add(f.path);
    const r = have.get(f.path);
    if (!r) { out.add.push(f); continue; }
    const rt = Date.parse(r.modified_at) || 0;
    if (Number(r.size) !== f.size || f.mtime > rt) out.change.push(f); else out.same++;
  }
  if (o.remove) for (const r of have.values()) if (!seen.has(r.path)) out.remove.push(r);
  return out;
}

export const planTotal = (p) => p.add.length + p.change.length + p.remove.length;

/** 한 줄 요약 — 계획 화면 위쪽 숫자 */
export function planSummary(p) {
  return { add: p.add.length, change: p.change.length, remove: p.remove.length, same: p.same, bytes: [...p.add, ...p.change].reduce((s, f) => s + f.size, 0) };
}
