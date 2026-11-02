// 기록(transcript)의 이음새 — seq 가 정본이다.
// 스트림은 구독 이후 줄만 보내고 놓친 줄을 다시 주지 않는다. 목록은 limit 을 안 주면 500줄에서 끊는다(함정 8).
// 그래서: ① after_seq 로 쪽을 넘겨 끝까지 읽고 ② 이미 본 seq 는 버리고(중복) ③ seq 가 lastSeq+1 보다 크면 구멍이라
// 그 줄을 보이는 목록에 넣지 않고 붙들어 둔 채 after_seq=lastSeq 로 다시 읽는다 ④ 실패하면 받은 데까지 남기고 다음에 이어 읽는다(재개).
// 순수하다 — 상태는 값이고, 읽기는 주입받은 fetchPage 로만 한다.

import type { CallFailure, CallResult } from '../api/client';
import type { AgentClient } from '../api/client';
import { parseEntry, type Entry, type MessagesListResponse } from '../api/types';

/** 한 쪽의 줄 수. 모듈 기본값과 같다(생략하면 500). 항상 명시해서 보낸다. */
export const PAGE_LIMIT = 500;
/** 한 번의 syncLedger 가 읽을 쪽 수의 상한 — 서버가 이상해도 끝없이 읽지 않는다. */
export const DEFAULT_MAX_PAGES = 200;

export interface LedgerState {
  readonly sessionId: string;
  /** seq 1..lastSeq 가 빠짐없이 이어진 줄. 화면은 이것만 그린다. */
  readonly entries: readonly Entry[];
  readonly lastSeq: number;
  /** 구멍 뒤에서 온 줄(seq > lastSeq+1). 구멍이 메워지면 이어 붙는다. */
  readonly held: readonly Entry[];
}

export function emptyLedger(sessionId: string): LedgerState {
  return { sessionId, entries: [], lastSeq: 0, held: [] };
}

export interface IngestResult {
  state: LedgerState;
  /** 이번에 보이는 목록에 새로 붙은 줄. */
  added: Entry[];
  /** 이미 본 seq 라서 버린 줄 수. */
  duplicates: number;
  /** seq 가 없어 읽을 수 없던 줄 수. */
  invalid: number;
  /** 붙들어 둔 줄이 남아 있다 — after_seq=lastSeq 로 다시 읽어야 한다. */
  hole: boolean;
}

/** 서버(목록·스트림)가 준 줄들을 합친다. 입력 상태는 바꾸지 않는다. */
export function ingest(state: LedgerState, incoming: readonly unknown[]): IngestResult {
  let invalid = 0;
  let duplicates = 0;
  const heldBySeq = new Map<number, Entry>(state.held.map((e) => [e.seq, e]));
  const fresh: Entry[] = [];
  for (const rawLine of incoming) {
    const parsed = parseEntry(rawLine);
    if (!parsed) {
      invalid += 1;
      continue;
    }
    // 목록이 정본이다 — 먼저 들어온 줄을 지키고 같은 seq 는 버린다.
    if (parsed.seq <= state.lastSeq || heldBySeq.has(parsed.seq)) {
      duplicates += 1;
      continue;
    }
    heldBySeq.set(parsed.seq, parsed);
    fresh.push(parsed);
  }
  const entries = state.entries.slice();
  const added: Entry[] = [];
  let lastSeq = state.lastSeq;
  for (let next = heldBySeq.get(lastSeq + 1); next; next = heldBySeq.get(lastSeq + 1)) {
    entries.push(next);
    added.push(next);
    heldBySeq.delete(next.seq);
    lastSeq = next.seq;
  }
  const held = [...heldBySeq.values()].sort((a, b) => a.seq - b.seq);
  return {
    state: { sessionId: state.sessionId, entries, lastSeq, held },
    added,
    duplicates,
    invalid,
    hole: held.length > 0,
  };
}

export type FetchPage = (afterSeq: number, limit: number) => Promise<CallResult<MessagesListResponse>>;

/** messages.list 를 한 세션에 묶는다. */
export function makeFetchPage(client: Pick<AgentClient, 'messagesList'>, sessionId: string): FetchPage {
  return (afterSeq, limit) => client.messagesList(sessionId, { after_seq: afterSeq, limit });
}

export interface SyncOptions {
  limit?: number;
  maxPages?: number;
  signal?: AbortSignal;
}

export type SyncResult =
  | { ok: true; state: LedgerState; added: Entry[]; pages: number; duplicates: number; hole: { afterSeq: number; nextSeq: number } | null }
  | { ok: false; state: LedgerState; added: Entry[]; pages: number; failure: CallFailure };

/**
 * lastSeq 이후를 끝까지 읽어 합친다. 항상 현재 lastSeq 에서 시작하므로 그대로 "재개"다.
 * - 쪽이 가득 찼으면(길이 ≥ limit) 다음 쪽을 읽는다. 정확히 limit 줄이면 빈 쪽 하나를 더 읽어 끝을 확인한다.
 * - 진전이 없는데 붙들어 둔 줄이 남아 있으면 서버에도 구멍이 있다 — 끝없이 읽지 않고 `hole` 로 알린다.
 */
export async function syncLedger(start: LedgerState, fetchPage: FetchPage, options: SyncOptions = {}): Promise<SyncResult> {
  const limit = options.limit ?? PAGE_LIMIT;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  let state = start;
  const added: Entry[] = [];
  let duplicates = 0;
  let pages = 0;
  while (pages < maxPages) {
    if (options.signal?.aborted) break;
    const response = await fetchPage(state.lastSeq, limit);
    pages += 1;
    if (!response.ok) return { ok: false, state, added, pages, failure: response };
    const lines = response.data?.entries;
    if (!Array.isArray(lines)) {
      return { ok: false, state, added, pages, failure: { ok: false, status: response.status, code: 'INVALID_RESPONSE', message: 'messages.list: entries 가 배열이 아니다' } };
    }
    const before = state.lastSeq;
    const result = ingest(state, lines);
    state = result.state;
    added.push(...result.added);
    duplicates += result.duplicates;
    const advanced = state.lastSeq > before;
    if (!advanced) break; // 빈 쪽(끝) 이거나, 구멍을 다시 읽어도 안 메워진다.
    if (lines.length < limit && !result.hole) break; // 끝까지 읽었다.
    // 가득 찬 쪽이거나 구멍이 남았다 — lastSeq 부터 다시 읽는다.
  }
  const first = state.held[0];
  return { ok: true, state, added, pages, duplicates, hole: first ? { afterSeq: state.lastSeq, nextSeq: first.seq } : null };
}
