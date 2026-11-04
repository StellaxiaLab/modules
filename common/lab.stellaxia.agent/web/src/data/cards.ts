// 승인 카드 합성(계획서 §3.2). 만료된 승인 카드는 entry 가 아니다 — 기록과 스냅샷에서 파생한다.
//
// 카드의 재료: `approval` 줄(request_id) · 스냅샷의 pending_approvals(지금 답할 수 있는가) · 뒤이은 approved/denied/error/cancelled 줄.
// 판정 우선순위: 결과 줄(approved/denied) > pending > 뒤이은 error(TIME_LIMIT)/cancelled > 404 표시 > 이미 처리됨.
// 승인 컨트롤은 `actionable` 일 때만 켠다(I9) — pending_approvals 에 있고 결과 줄이 없을 때.

import type { ApprovalContract, Entry, PendingApproval } from '../api/types';

/** 승인 질문 하나가 기다리는 최대 시간(loop.go approvalTimeout). */
export const APPROVAL_WAIT_MS = 30 * 60 * 1000;

export type CardState = 'pending' | 'approved' | 'denied' | 'no-answer' | 'timed-out' | 'cancelled' | 'already-handled';

export interface Deadline {
  ms: number;
  /** true 면 GAP-12 의 근사다 — 틀릴 수 있다고 표시한다. false 면 M-3 `expires_ms`. */
  approximate: boolean;
}

export interface ApprovalCard {
  requestId: string;
  operationId: string;
  state: CardState;
  /** approval 줄의 seq. 기록이 아직 못 따라온 대기 승인(스냅샷만 있음)이면 null. */
  seq: number | null;
  createdMs: number;
  /** 모델의 주장이다 — 근거가 아니다. 계약 사실과 갈라 보인다. */
  reason?: string;
  /** 모듈이 계산한 판정 근거. */
  judgement?: string;
  input?: unknown;
  /** M-2. 없으면 contractKnown=false → "계약 사실을 읽지 못했다" 모양. */
  contract?: ApprovalContract;
  contractKnown: boolean;
  /** 승인·거부 컨트롤을 켜도 되는가 — state === 'pending' 일 때만(I9). */
  actionable: boolean;
  /** 결과를 기록의 줄이 뒷받침하는가. false 면(대기 중이거나 이미 처리됨의 추정) 결과 줄이 아직 없다. */
  outcomeKnown: boolean;
  /** 대기 카드만. */
  deadline: Deadline | null;
  remainingMs: number | null;
  /** I18 — 같은 세션에서 같은 (operation_id, input)이 이전에 거부된 횟수(입력을 본 적 있는 것만). */
  deniedBefore: number;
  /** 같은 operation 이 거부됐지만 그때의 입력을 본 적이 없어 같은 호출인지 모르는 횟수. */
  deniedBeforeUnknownInput: number;
}

// ── 입력 기억 ───────────────────────────────────────────────────────────
// 승인 질문이 끝나면 스냅샷에서 input 이 사라지고 기록(approval 줄)에는 input 이 없다(요구 §14.3 ⑥).
// I18 은 "같은 입력"을 비교해야 하므로 대기 중일 때 본 입력을 기억해 둔다.

export interface RememberedApproval {
  operationId: string;
  inputKey: string;
}
export type ApprovalMemory = ReadonlyMap<string, RememberedApproval>;

export function emptyMemory(): ApprovalMemory {
  return new Map();
}

/** 키 순서에 상관없는 입력 비교 키. 없음·null·{} 는 같다. */
export function canonicalInputKey(input: unknown): string {
  if (input === undefined || input === null) return '{}';
  return JSON.stringify(sortKeys(input));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function rememberPending(memory: ApprovalMemory, pending: readonly PendingApproval[]): ApprovalMemory {
  if (pending.length === 0) return memory;
  const next = new Map(memory);
  for (const item of pending) next.set(item.request_id, { operationId: item.operation_id, inputKey: canonicalInputKey(item.input) });
  return next;
}

// ── 합성 ────────────────────────────────────────────────────────────────

export interface SynthesizeInput {
  entries: readonly Entry[];
  pending: readonly PendingApproval[];
  memory: ApprovalMemory;
  /** 스냅샷의 max_seconds — 마감 근사에 쓴다. */
  maxSeconds?: number;
  nowMs?: number;
  /** approvals.post 가 404 APPROVAL_NOT_FOUND 를 준 request_id. */
  handled?: ReadonlySet<string>;
}

interface Draft {
  requestId: string;
  operationId: string;
  seq: number | null;
  createdMs: number;
  approvalTimeMs: number | null;
}

export function synthesizeCards(input: SynthesizeInput): ApprovalCard[] {
  const { entries, pending, memory, maxSeconds, nowMs, handled } = input;
  const pendingById = new Map(pending.map((p) => [p.request_id, p] as const));

  // 1. 카드가 설 request_id 들 — approval 줄(seq 순) + 줄이 아직 없는 대기 승인.
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'approval' || !entry.request_id || seen.has(entry.request_id)) continue;
    seen.add(entry.request_id);
    drafts.push({
      requestId: entry.request_id,
      operationId: entry.operation_id ?? entry.subject ?? pendingById.get(entry.request_id)?.operation_id ?? '',
      seq: entry.seq,
      createdMs: pendingById.get(entry.request_id)?.created_ms ?? entry.time_ms,
      approvalTimeMs: entry.time_ms,
    });
  }
  for (const item of pending) {
    if (seen.has(item.request_id)) continue;
    seen.add(item.request_id);
    drafts.push({ requestId: item.request_id, operationId: item.operation_id, seq: null, createdMs: item.created_ms, approvalTimeMs: null });
  }

  const cards: ApprovalCard[] = [];
  for (const draft of drafts) {
    const live = pendingById.get(draft.requestId);
    // 404 로 이미 처리됐다고 확인된 질문은 스냅샷이 낡아서 아직 pending 에 남아 있어도 열린 질문이 아니다.
    const open = live !== undefined && !(handled?.has(draft.requestId) ?? false);
    const { state, outcomeKnown } = classify(draft, entries, open);
    const actionable = state === 'pending';
    const deadline = actionable ? deadlineOf(draft, live, entries, maxSeconds) : null;
    const key = canonicalInputKey(live?.input ?? undefined);
    const remembered = memory.get(draft.requestId);
    const myKey = live ? key : remembered?.inputKey;

    // I18: 이 카드보다 앞선 카드 중 사람이 거부한 것만(무응답 거부·승인은 제외).
    let deniedBefore = 0;
    let deniedBeforeUnknownInput = 0;
    for (const earlier of cards) {
      if (earlier.state !== 'denied' || earlier.operationId !== draft.operationId) continue;
      const earlierKey = memory.get(earlier.requestId)?.inputKey;
      if (earlierKey === undefined || myKey === undefined) deniedBeforeUnknownInput += 1;
      else if (earlierKey === myKey) deniedBefore += 1;
    }

    const card: ApprovalCard = {
      requestId: draft.requestId,
      operationId: draft.operationId,
      state,
      seq: draft.seq,
      createdMs: draft.createdMs,
      contractKnown: live?.contract !== undefined,
      actionable,
      outcomeKnown,
      deadline,
      remainingMs: deadline && nowMs !== undefined ? deadline.ms - nowMs : null,
      deniedBefore,
      deniedBeforeUnknownInput,
    };
    if (live?.reason !== undefined) card.reason = live.reason;
    if (live?.judgement !== undefined) card.judgement = live.judgement;
    else {
      const note = entries.find((e) => e.kind === 'approval' && e.request_id === draft.requestId);
      if (note?.kind === 'approval' && note.note) card.judgement = note.note;
    }
    if (live?.input !== undefined) card.input = live.input;
    if (live?.contract !== undefined) card.contract = live.contract;
    cards.push(card);
  }
  return cards;
}

function classify(draft: Draft, entries: readonly Entry[], inPending: boolean): { state: CardState; outcomeKnown: boolean } {
  const after = draft.seq ?? 0;
  // 가장 먼저 오는 결말: 같은 request_id 의 approved/denied · 이후의 TIME_LIMIT 오류 · cancelled.
  let ending: Entry | null = null;
  for (const entry of entries) {
    if (entry.seq <= after) continue;
    if ((entry.kind === 'approved' || entry.kind === 'denied') && entry.request_id === draft.requestId) {
      ending = entry;
      break;
    }
    if (inPending) continue; // 대기 중이면 error/cancelled 는 이 카드의 결말이 아니다(낡은 줄·낡은 스냅샷 모두 pending 이 이긴다)
    if ((entry.kind === 'error' && entry.error_code === 'TIME_LIMIT') || entry.kind === 'cancelled') {
      ending = entry;
      break;
    }
  }
  if (ending?.kind === 'approved') return { state: 'approved', outcomeKnown: true };
  if (ending?.kind === 'denied') {
    return { state: typeof ending.note === 'string' && ending.note.startsWith('no answer within') ? 'no-answer' : 'denied', outcomeKnown: true };
  }
  if (inPending) return { state: 'pending', outcomeKnown: false };
  if (ending?.kind === 'error') return { state: 'timed-out', outcomeKnown: true };
  if (ending?.kind === 'cancelled') return { state: 'cancelled', outcomeKnown: true };
  // 질문은 닫혔는데 결과 줄이 없다 — 404 로 확인했거나, 답은 갔으나 줄이 늦다. 둘 다 "이미 처리됨".
  return { state: 'already-handled', outcomeKnown: false };
}

function deadlineOf(draft: Draft, live: PendingApproval | undefined, entries: readonly Entry[], maxSeconds: number | undefined): Deadline {
  if (typeof live?.expires_ms === 'number') return { ms: live.expires_ms, approximate: false };
  // GAP-12 근사: min(마지막 user 줄 + max_seconds, approval 줄 시각 + 30분).
  // 타자로 친 "y" 답도 user 줄이라 진짜 차례 시작보다 늦게 잡힐 수 있다 — 그래서 근사다.
  const askedAt = draft.approvalTimeMs ?? draft.createdMs;
  let ms = askedAt + APPROVAL_WAIT_MS;
  if (typeof maxSeconds === 'number' && maxSeconds > 0) {
    let turnStart: number | null = null;
    for (const entry of entries) {
      if (draft.seq !== null && entry.seq >= draft.seq) break;
      if (entry.kind === 'user') turnStart = entry.time_ms;
    }
    if (turnStart !== null) ms = Math.min(ms, turnStart + maxSeconds * 1000);
  }
  return { ms, approximate: true };
}
