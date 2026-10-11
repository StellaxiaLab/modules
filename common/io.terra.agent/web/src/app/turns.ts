// 차례 줄 재료 — 각 `done` 줄이 닫는 차례의 모델 호출 수. 호출은 차례 몫, 토큰은 세션 누적이다(DC-26).
// `done.note` 는 영어이고 파싱하지 않는다 — 호출 수는 `model` 줄에서 센다.

import type { Entry } from '../api/types';

export function turnCallsByDone(entries: readonly Entry[]): Map<number, number> {
  const out = new Map<number, number>();
  let calls = 0;
  for (const entry of entries) {
    if (entry.kind === 'user') calls = 0;
    else if (entry.kind === 'model') calls += 1;
    else if (entry.kind === 'done') {
      out.set(entry.seq, calls);
      calls = 0;
    }
  }
  return out;
}

export function lastSeqOfKind(entries: readonly Entry[], kind: Entry['kind']): number | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry && entry.kind === kind) return entry.seq;
  }
  return null;
}
