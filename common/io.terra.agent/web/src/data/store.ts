// 세션·기록 저장소 — 순수 상태 + 주입된 클라이언트·시계. DOM·fetch·window·타이머를 쓰지 않는다.
// 폴링 일정(running 1초 · 대기/유휴 5초)은 전송 쪽(WP-2/4)이 정하고 여기서는 "한 번 읽기"만 한다.
//
// 지키는 것:
// - 남의 세션은 보관하지 않는다(소유자 필터, R-2 전 임시 — 노출은 못 막는다. owner.ts 머리말).
// - 보내기는 가드(send-guard)를 거친다(함정 6). 승인은 approvals.post 로만(I8), 대기 카드에만(I9).
// - 종료 상태에서는 취소를 부르지 않는다(요구 §4.1).
// - 재시도 never 호출은 다시 보내지 않는다(I17) — 실패는 그대로 돌려준다.

import type { AgentClient, CallFailure } from '../api/client';
import type { ApprovalAnswered, SessionCancelled, SessionSnapshot } from '../api/types';
import { emptyMemory, rememberPending, type ApprovalMemory } from './cards';
import { describeFailure } from './errors';
import { emptyLedger, makeFetchPage, syncLedger, type LedgerState } from './ledger';
import { filterOwned, inboxOf, ownsSession, type InboxItem } from './owner';
import { guardedSend, type GuardedSendResult } from './send-guard';
import { isTerminal } from './status';
import { buildSessionView, type SessionView } from './view';

export interface SessionSlot {
  snapshot: SessionSnapshot;
  ledger: LedgerState;
  memory: ApprovalMemory;
  /** approvals.post 가 404 APPROVAL_NOT_FOUND 를 준 request_id. */
  handled: ReadonlySet<string>;
}

export interface DataState {
  viewer: string | null;
  /** 내 세션(created_ms 내림차순, 모듈이 그렇게 준다). 남의 것은 들어오지 않는다. */
  owned: readonly SessionSnapshot[];
  sessions: Readonly<Record<string, SessionSlot>>;
  /** 마지막 목록 읽기가 실패했다면 그 실패. */
  listFailure: CallFailure | null;
}

export interface StoreDeps {
  client: Pick<AgentClient, 'sessionsList' | 'sessionsGet' | 'sessionsCancel' | 'messagesList' | 'messagesPost' | 'approvalsPost'>;
  /** 시계 주입(epoch ms). */
  now: () => number;
}

export type RefreshResult = { ok: true } | { ok: false; failure: CallFailure };
export type AnswerResult = { ok: true; answered: ApprovalAnswered } | { ok: false; reason: 'not-actionable' | 'failed'; quiet: boolean; failure?: CallFailure };
export type CancelResult = { ok: true; cancelled: SessionCancelled } | { ok: false; reason: 'unknown-session' | 'terminal' | 'failed'; failure?: CallFailure };

export function createDataStore(deps: StoreDeps) {
  const { client, now } = deps;
  let state: DataState = { viewer: null, owned: [], sessions: {}, listFailure: null };
  const listeners = new Set<() => void>();

  function set(next: DataState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function putSlot(id: string, patch: Partial<SessionSlot> & { snapshot?: SessionSnapshot }): void {
    const current = state.sessions[id];
    const snapshot = patch.snapshot ?? current?.snapshot;
    if (!snapshot) return;
    const slot: SessionSlot = {
      snapshot,
      ledger: patch.ledger ?? current?.ledger ?? emptyLedger(id),
      memory: patch.memory ?? current?.memory ?? emptyMemory(),
      handled: patch.handled ?? current?.handled ?? new Set<string>(),
    };
    set({ ...state, sessions: { ...state.sessions, [id]: slot } });
  }

  return {
    getState: (): DataState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** 소유자 필터의 기준. 출처: credentials.get 의 principal(readiness.viewer) 또는 sessions.post 의 viewer. */
    setViewer(viewer: string | null): void {
      if (viewer === state.viewer) return;
      // viewer 가 바뀌면 이전 viewer 의 것은 모두 버린다.
      set({ viewer, owned: [], sessions: {}, listFailure: null });
    },

    /** sessions.list 를 읽어 내 것만 보관한다. 남의 세션 객체는 이 함수 밖으로 나가지 않는다. */
    async refreshList(): Promise<RefreshResult> {
      const response = await client.sessionsList();
      if (!response.ok) {
        set({ ...state, listFailure: response });
        return { ok: false, failure: response };
      }
      const owned = filterOwned(Array.isArray(response.data?.sessions) ? response.data.sessions : [], state.viewer);
      let memories = state.sessions;
      // 목록에서 본 대기 승인의 입력을 기억해 둔다(I18) — 이미 읽어 둔 세션만.
      for (const snapshot of owned) {
        const slot = memories[snapshot.session_id];
        if (slot) memories = { ...memories, [snapshot.session_id]: { ...slot, snapshot, memory: rememberPending(slot.memory, snapshot.pending_approvals ?? []) } };
      }
      set({ ...state, owned, sessions: memories, listFailure: null });
      return { ok: true };
    },

    /**
     * 세션 하나를 읽는다 — 스냅샷으로 상태를 확정하고(sessions.get), 기록을 lastSeq 이후로 끝까지 잇는다.
     * 기록 읽기가 실패해도 스냅샷은 남고 다음 호출이 이어 읽는다.
     */
    async refreshSession(sessionId: string): Promise<RefreshResult> {
      const got = await client.sessionsGet(sessionId);
      if (!got.ok) return { ok: false, failure: got };
      // 서버가 이미 소유자를 검사하지만(SESSION_NOT_OWNED), 응답을 믿고 보관하지는 않는다.
      if (!ownsSession(got.data, state.viewer)) {
        return { ok: false, failure: { ok: false, status: 403, code: 'SESSION_NOT_OWNED', message: 'owner mismatch (client-side filter)' } };
      }
      const snapshot = got.data;
      const slot = state.sessions[sessionId];
      const memory = rememberPending(slot?.memory ?? emptyMemory(), snapshot.pending_approvals ?? []);
      const synced = await syncLedger(slot?.ledger ?? emptyLedger(sessionId), makeFetchPage(client, sessionId));
      putSlot(sessionId, { snapshot, memory, ledger: synced.state });
      return synced.ok ? { ok: true } : { ok: false, failure: synced.failure };
    },

    /** 화면용 파생 묶음. 읽은 적 없으면 null. */
    viewOf(sessionId: string, nowMs: number = now()): SessionView | null {
      const slot = state.sessions[sessionId];
      return slot ? buildSessionView({ ...slot, nowMs }) : null;
    },

    /** 인박스 — 내 세션의 대기 승인. */
    inbox(): InboxItem[] {
      return inboxOf(state.owned);
    },

    /** 보내기 — 가드를 거친다. 성공하면 기록을 이어 읽는다. */
    async send(sessionId: string, text: string): Promise<GuardedSendResult> {
      const result = await guardedSend(client, sessionId, text);
      if (result.sent) await this.refreshSession(sessionId);
      return result;
    },

    /** 승인·거부. 대기 카드에만 보낸다(I9). 404 는 정상이다 — 이미 처리됨으로 표시하고 세션을 새로 읽는다. */
    async answerApproval(sessionId: string, requestId: string, decision: 'approve' | 'deny'): Promise<AnswerResult> {
      const view = this.viewOf(sessionId);
      const card = view?.cards.find((c) => c.requestId === requestId);
      if (!card?.actionable) return { ok: false, reason: 'not-actionable', quiet: true };
      const response = await client.approvalsPost(requestId, decision);
      if (response.ok) {
        await this.refreshSession(sessionId);
        return { ok: true, answered: response.data };
      }
      const described = describeFailure(response);
      if (response.code === 'APPROVAL_NOT_FOUND') {
        const slot = state.sessions[sessionId];
        if (slot) putSlot(sessionId, { handled: new Set([...slot.handled, requestId]) });
        await this.refreshSession(sessionId);
      }
      return { ok: false, reason: 'failed', quiet: described.quiet === true, failure: response };
    },

    /** 취소. 되돌릴 수 없다(확인은 화면이). 종료 상태에는 줄이 또 쌓이므로 부르지 않는다. */
    async cancel(sessionId: string): Promise<CancelResult> {
      const slot = state.sessions[sessionId];
      if (!slot) return { ok: false, reason: 'unknown-session' };
      if (isTerminal(slot.snapshot.state)) return { ok: false, reason: 'terminal' };
      const response = await client.sessionsCancel(sessionId);
      if (!response.ok) return { ok: false, reason: 'failed', failure: response };
      await this.refreshSession(sessionId);
      return { ok: true, cancelled: response.data };
    },
  };
}

export type DataStore = ReturnType<typeof createDataStore>;
