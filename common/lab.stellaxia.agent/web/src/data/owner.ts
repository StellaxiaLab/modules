// 소유자 필터 — R-2(서버가 sessions.list 를 호출자의 owner 로 거르는 일, M-1) 전의 임시 방어다.
//
// 주의: 이것은 **노출을 막지 못한다.** 모듈은 지금 모든 소유자의 세션 전부를 전체 스냅샷
// (`answer`·`pending_approvals.input` 포함)으로 응답에 싣는다. 이 함수가 걸러 내기 전에 이미 응답은
// 이 브라우저(와 브리지·Gateway 구간)에 도착해 있다. 여기서 하는 일은 화면과 저장소 상태에 남의 것이 섞이지 않게
// 하는 것뿐이다 — 그래서 M-1 이 병합·배포되기 전에는 이 앱을 배포하지 않는다(D-6).
//
// viewer 를 모르면 아무것도 보이지 않는다 — 모르는 쪽이 "모두 보임"이 되면 안 된다.
// 소유자는 합성 principal 일 수 있다(`alice via <앱 id>` — 요구 §9). 정확히 같을 때만 내 것이다.

import type { PendingApproval, SessionSnapshot } from '../api/types';

export function ownsSession(session: Pick<SessionSnapshot, 'owner'>, viewer: string | null | undefined): boolean {
  return typeof viewer === 'string' && viewer !== '' && session.owner === viewer;
}

export function filterOwned<T extends Pick<SessionSnapshot, 'owner'>>(sessions: readonly T[], viewer: string | null | undefined): T[] {
  return sessions.filter((session) => ownsSession(session, viewer));
}

export interface InboxItem {
  sessionId: string;
  topic: string | undefined;
  approval: PendingApproval;
}

/** 인박스 — 세션 목록의 pending_approvals 모음. 반드시 filterOwned 를 거친 목록을 넘긴다. */
export function inboxOf(sessions: readonly SessionSnapshot[]): InboxItem[] {
  const items: InboxItem[] = [];
  for (const session of sessions) {
    for (const approval of session.pending_approvals ?? []) items.push({ sessionId: session.session_id, topic: session.topic, approval });
  }
  return items;
}
