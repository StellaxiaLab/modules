// 기록과 스냅샷에서 파생하는 값 — 차례 호출 수 · 나간 바이트 · 마지막 오류 코드 · 토큰.
// 영어로 적힌 `note`·`last_error` 문장은 파싱하지 않는다(요구 §3.2). 값은 구조 필드에서만 읽는다.

import type { Entry, SessionSnapshot } from '../api/types';

/** 마지막 `user` 줄 이후 `model` 줄의 수 — 그 차례의 모델 호출. `steps` 는 세션 누적이라 이것과 다르다(요구 §14.3 ①). */
export function turnCallCount(entries: readonly Entry[]): number {
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.kind === 'user') break;
    if (entry.kind === 'model') count += 1;
  }
  return count;
}

/** `model` 줄의 차례 안 순번(#n). seq → 순번. 새 `user` 줄이 오면 1부터 다시 센다. */
export function modelOrdinals(entries: readonly Entry[]): Map<number, number> {
  const map = new Map<number, number>();
  let n = 0;
  for (const entry of entries) {
    if (entry.kind === 'user') n = 0;
    else if (entry.kind === 'model') {
      n += 1;
      map.set(entry.seq, n);
    }
  }
  return map;
}

/** 노드 밖으로 나간 양 — 모든 `model` 줄의 `sent_bytes` 합(I15). */
export function totalSentBytes(entries: readonly Entry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.kind === 'model' && typeof entry.sent_bytes === 'number') total += entry.sent_bytes;
  }
  return total;
}

export function bytesToKB(bytes: number): number {
  return bytes / 1024;
}

export interface LastError {
  /** 코드를 아는 경우만. 영어 문장에서 추측하지 않는다(GAP-7). */
  code: string | null;
  /** 영어 문장(원문). 화면은 코드로 자기 문구를 고르고 이것은 접는다. */
  text: string | null;
  hasError: boolean;
  /** snapshot: M-6 `last_error_code` · record: 기록의 마지막 `error` 줄 · sentence: 문장만 있고 코드를 모른다 · none */
  source: 'snapshot' | 'record' | 'sentence' | 'none';
}

/**
 * 마지막 오류. 코드의 출처 순서: M-6 `last_error_code` → 기록의 마지막 `error` 줄의 `error_code`.
 * 둘 다 없고 `last_error` 문장만 있으면 코드는 모른다(목록 행에서는 이 경우가 된다).
 */
export function lastErrorOf(snapshot: SessionSnapshot, entries: readonly Entry[]): LastError {
  const sentence = typeof snapshot.last_error === 'string' && snapshot.last_error !== '' ? snapshot.last_error : null;
  const snapshotCode = typeof snapshot.last_error_code === 'string' && snapshot.last_error_code !== '' ? snapshot.last_error_code : null;
  if (snapshotCode) return { code: snapshotCode, text: sentence, hasError: true, source: 'snapshot' };
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.kind === 'error') {
      return { code: entry.error_code ?? null, text: entry.text ?? sentence, hasError: true, source: 'record' };
    }
  }
  if (sentence) return { code: null, text: sentence, hasError: true, source: 'sentence' };
  return { code: null, text: null, hasError: false, source: 'none' };
}

/** 입력+출력 토큰. 캐시 토큰은 제외한다(`token_budget` 규칙, 요구 §5.4). 통화로 환산하지 않는다(I14). */
export function tokenTotal(snapshot: SessionSnapshot): number {
  const usage = snapshot.usage;
  return usage ? usage.input_tokens + usage.output_tokens : 0;
}
