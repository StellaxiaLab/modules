// 한 세션의 화면용 파생 묶음 — 저장소 상태(스냅샷 + 기록 + 기억)에서 순수하게 계산한다.

import type { Entry, SessionSnapshot } from '../api/types';
import { synthesizeCards, type ApprovalCard, type ApprovalMemory } from './cards';
import { bytesToKB, lastErrorOf, modelOrdinals, tokenTotal, totalSentBytes, turnCallCount, type LastError } from './derive';
import type { LedgerState } from './ledger';
import { screenFor, type ScreenView } from './status';

export interface SessionViewInput {
  snapshot: SessionSnapshot;
  ledger: LedgerState;
  memory: ApprovalMemory;
  handled: ReadonlySet<string>;
  nowMs: number;
}

export interface SessionView {
  snapshot: SessionSnapshot;
  entries: readonly Entry[];
  screen: ScreenView;
  cards: ApprovalCard[];
  /** 그 차례의 모델 호출 수(마지막 user 줄 이후 model 줄). steps 는 세션 누적이다. */
  turnCalls: number;
  /** 모델 줄의 차례 안 순번(seq → #n). */
  ordinals: Map<number, number>;
  sentBytes: number;
  sentKB: number;
  lastError: LastError;
  /** 입력+출력 토큰 누적(캐시 제외). */
  tokens: number;
  /** 서버에도 구멍이 있어 일부 줄이 붙들려 있다. */
  ledgerHole: boolean;
}

export function buildSessionView(input: SessionViewInput): SessionView {
  const { snapshot, ledger, memory, handled, nowMs } = input;
  const entries = ledger.entries;
  const cardInput = { entries, pending: snapshot.pending_approvals ?? [], memory, nowMs, handled };
  const cards = synthesizeCards(typeof snapshot.max_seconds === 'number' ? { ...cardInput, maxSeconds: snapshot.max_seconds } : cardInput);
  const sentBytes = totalSentBytes(entries);
  return {
    snapshot,
    entries,
    screen: screenFor(snapshot),
    cards,
    turnCalls: turnCallCount(entries),
    ordinals: modelOrdinals(entries),
    sentBytes,
    sentKB: bytesToKB(sentBytes),
    lastError: lastErrorOf(snapshot, entries),
    tokens: tokenTotal(snapshot),
    ledgerHole: ledger.held.length > 0,
  };
}
