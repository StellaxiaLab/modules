// 화면 2 — 세션 목록과 인박스의 행을 저장소 상태에서 뽑는다. 순수 함수.
// 탭: "내 세션"(진행 중) / "종료됨"(done·cancelled·failed·archived — GAP-1). 판정은 data/status 한 곳이다.
// 마지막 오류 코드 칩: 스냅샷의 last_error_code(M-6)가 있으면 그것, 없으면 기록을 이미 읽은 세션에 한해 error 줄에서 읽는다.
// 영어 문장(last_error)에서 코드를 추측하지 않는다(GAP-7) — 목록 행에서 코드를 모르면 칩을 보이지 않는다.

import type { DataState } from '../data/store';
import type { InboxItem } from '../data/owner';
import { lastErrorOf } from '../data/derive';
import { sessionTab, stateRule, type SessionTab, type StateTone } from '../data/status';
import { formatRemaining, relativeTime } from './format';

export interface SessionRow {
  id: string;
  title: string;
  state: string;
  stateLabel: string;
  tone: StateTone;
  autonomy: string;
  /** 마지막 오류 코드 — 모르면 null. 성공처럼 보이지 않게 idle·done 옆에도 보인다(I20). */
  errorCode: string | null;
  time: string;
  selected: boolean;
}

export function sessionTitle(topic: string | undefined, sessionId: string): string {
  const t = typeof topic === 'string' ? topic.trim() : '';
  return t !== '' ? t : sessionId;
}

export function buildRows(state: DataState, tab: SessionTab, selectedId: string | null, nowMs: number): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const snapshot of state.owned) {
    if (sessionTab(snapshot.state) !== tab) continue;
    const rule = stateRule(snapshot.state);
    let errorCode: string | null = null;
    if (rule.showLastError) {
      const slot = state.sessions[snapshot.session_id];
      const last = lastErrorOf(snapshot, slot ? slot.ledger.entries : []);
      errorCode = last.code;
    }
    rows.push({
      id: snapshot.session_id,
      title: sessionTitle(snapshot.topic, snapshot.session_id),
      state: snapshot.state,
      stateLabel: rule.label,
      tone: rule.tone,
      autonomy: snapshot.autonomy,
      errorCode,
      time: relativeTime(snapshot.updated_ms, nowMs),
      selected: snapshot.session_id === selectedId,
    });
  }
  return rows;
}

export function tabCounts(state: DataState): Record<SessionTab, number> {
  const counts: Record<SessionTab, number> = { mine: 0, ended: 0 };
  for (const s of state.owned) counts[sessionTab(s.state)] += 1;
  return counts;
}

export interface InboxRow {
  key: string;
  sessionId: string;
  title: string;
  operation: string;
  /** M-3 의 expires_ms 가 있을 때만. 없으면 근사하지 않는다 — 카드(G2)가 근사를 표시한다. */
  left: string | null;
}

/** 다른 세션의 대기 승인. 지금 열어 둔 세션의 것은 대화 안에 있으므로 뺀다. */
export function buildInbox(items: readonly InboxItem[], selectedId: string | null, nowMs: number): InboxRow[] {
  return items
    .filter((item) => item.sessionId !== selectedId)
    .map((item) => ({
      key: `${item.sessionId}:${item.approval.request_id}`,
      sessionId: item.sessionId,
      title: sessionTitle(item.topic, item.sessionId),
      operation: item.approval.operation_id,
      left: typeof item.approval.expires_ms === 'number' ? `${formatRemaining(item.approval.expires_ms - nowMs)} 남음` : null,
    }));
}
