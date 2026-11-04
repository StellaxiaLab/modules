// 세션 상태 → 화면 규칙(요구 §6.1). 상태 7종 각각이 입력창·버튼·표시를 정한다.
// 종료 판정은 done · cancelled · failed · archived 넷이다(GAP-1) — 시연은 failed·cancelled 만 봤다.
// archived 는 모듈이 재시작하면 done·cancelled·failed 가 아닌 모든 상태(idle 포함)에 붙는다(함정 4, session.go:564).

import type { SessionSnapshot, SessionState } from '../api/types';

export const TERMINAL_STATES = ['done', 'cancelled', 'failed', 'archived'] as const;
const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_STATES);

export function isTerminal(state: string): boolean {
  return TERMINAL_SET.has(state);
}

/** 목록 탭: "내 세션"(진행 중) / "종료됨". */
export type SessionTab = 'mine' | 'ended';

export function sessionTab(state: string): SessionTab {
  return isTerminal(state) ? 'ended' : 'mine';
}

export type InputLock = 'running' | 'waiting-approval' | 'finished' | 'unknown';
export type StateTone = 'idle' | 'busy' | 'attention' | 'ended' | 'error';

export interface StateRule {
  state: string;
  known: boolean;
  label: string;
  tone: StateTone;
  /** 입력창을 켜는가. */
  inputEnabled: boolean;
  /** 꺼져 있다면 왜. */
  inputLock: InputLock | null;
  /** 입력창을 잠갔을 때 보이는 문구. */
  inputHint: string | null;
  /** 취소 버튼. 종료 상태에는 줄이 또 쌓이므로 숨긴다(요구 §4.1). */
  canCancel: boolean;
  /** "새 세션" 버튼을 앞에 둔다. */
  canStartNew: boolean;
  /** 마지막 오류를 상태 옆에 보인다(I20) — 한도·거절·모델 장애는 여기서 읽힌다. */
  showLastError: boolean;
  /** 승인 카드는 pending_approvals 가 있을 때만 켠다. */
  cardsNeedPending: boolean;
  tab: SessionTab;
  /** 어떤 상태도 성공을 뜻하지 않는다(I20) — idle·done 을 초록 체크로 그리지 않는다. */
  impliesSuccess: false;
  note: string;
}

const RULES: Record<SessionState, StateRule> = {
  idle: {
    state: 'idle', known: true, label: '대기', tone: 'idle',
    inputEnabled: true, inputLock: null, inputHint: null,
    canCancel: true, canStartNew: false, showLastError: true, cardsNeedPending: false, tab: 'mine', impliesSuccess: false,
    note: '한도·거절로 멈췄다면 마지막 오류를 상태 옆에 보인다.',
  },
  running: {
    state: 'running', known: true, label: '진행 중', tone: 'busy',
    inputEnabled: false, inputLock: 'running', inputHint: '모델이 답하는 중',
    canCancel: true, canStartNew: false, showLastError: false, cardsNeedPending: false, tab: 'mine', impliesSuccess: false,
    note: '승인이 오면 승인 대기로 바뀐다.',
  },
  'waiting-approval': {
    state: 'waiting-approval', known: true, label: '승인 대기', tone: 'attention',
    inputEnabled: false, inputLock: 'waiting-approval', inputHint: '승인 카드에 답해 주세요',
    canCancel: true, canStartNew: false, showLastError: false, cardsNeedPending: true, tab: 'mine', impliesSuccess: false,
    note: '카드는 pending_approvals 가 있을 때만 켠다. 질문이 시간 초과로 끝나도 이 상태에 pending 이 빈 채 모델이 도는 구간이 생긴다.',
  },
  done: {
    state: 'done', known: true, label: '끝남', tone: 'ended',
    inputEnabled: false, inputLock: 'finished', inputHint: '끝난 세션입니다. 새 세션을 여세요',
    canCancel: false, canStartNew: true, showLastError: true, cardsNeedPending: false, tab: 'ended', impliesSuccess: false,
    note: '한 번 실행의 종료다. 성공이 아니다 — 마지막 오류를 본다.',
  },
  cancelled: {
    state: 'cancelled', known: true, label: '취소됨', tone: 'ended',
    inputEnabled: false, inputLock: 'finished', inputHint: '취소된 세션입니다. 새 세션을 여세요',
    canCancel: false, canStartNew: true, showLastError: false, cardsNeedPending: false, tab: 'ended', impliesSuccess: false,
    note: '종료 상태다.',
  },
  failed: {
    state: 'failed', known: true, label: '실패', tone: 'error',
    inputEnabled: false, inputLock: 'finished', inputHint: '실패한 세션입니다. 새 세션을 여세요',
    canCancel: false, canStartNew: true, showLastError: true, cardsNeedPending: false, tab: 'ended', impliesSuccess: false,
    note: '일시적 모델 장애(529 등)도 chat 세션을 영구 failed 로 만든다 — 복구 operation 이 없다(R-14). 사유를 보인다.',
  },
  archived: {
    state: 'archived', known: true, label: '보관됨', tone: 'ended',
    inputEnabled: false, inputLock: 'finished', inputHint: '모듈이 다시 시작되어 기록만 남은 세션입니다. 새 세션을 여세요',
    canCancel: false, canStartNew: true, showLastError: true, cardsNeedPending: false, tab: 'ended', impliesSuccess: false,
    note: '모듈 재시작 뒤 남은 기록뿐이다. done·cancelled·failed 이외의 모든 상태에서 된다.',
  },
};

const UNKNOWN_RULE = (state: string): StateRule => ({
  state, known: false, label: '알 수 없는 상태', tone: 'attention',
  inputEnabled: false, inputLock: 'unknown', inputHint: '알 수 없는 상태입니다',
  canCancel: false, canStartNew: false, showLastError: true, cardsNeedPending: false, tab: 'mine', impliesSuccess: false,
  note: '이 층이 모르는 상태 — 보수적으로 입력을 잠근다.',
});

export function stateRule(state: string): StateRule {
  return (RULES as Record<string, StateRule | undefined>)[state] ?? UNKNOWN_RULE(state);
}

export type Activity = 'idle' | 'model-working' | 'awaiting-approval' | 'ended' | 'unknown';

export interface ScreenView extends StateRule {
  /** 승인 카드를 켜는가 — 대기 중인 pending_approvals 가 있고 종료 상태가 아닐 때. */
  showApprovalCards: boolean;
  activity: Activity;
  pendingCount: number;
}

/**
 * 스냅샷 하나가 화면에 요구하는 것. 상태 규칙에 대기 승인을 더한다.
 * - waiting-approval 인데 pending 이 비면 모델이 도는 중이다(카드 없음, 입력 잠금).
 * - 스냅샷이 낡아 상태는 idle 인데 pending 이 있으면 입력을 잠그고 카드를 켠다(보내기 가드와 같은 쪽으로 기운다).
 */
export function screenFor(snapshot: Pick<SessionSnapshot, 'state' | 'pending_approvals'>): ScreenView {
  const rule = stateRule(snapshot.state);
  const pendingCount = snapshot.pending_approvals?.length ?? 0;
  const terminal = isTerminal(snapshot.state);
  const showApprovalCards = !terminal && pendingCount > 0;
  let activity: Activity;
  if (!rule.known) activity = 'unknown';
  else if (terminal) activity = 'ended';
  else if (pendingCount > 0) activity = 'awaiting-approval';
  else if (snapshot.state === 'running' || snapshot.state === 'waiting-approval') activity = 'model-working';
  else activity = 'idle';
  const view: ScreenView = { ...rule, showApprovalCards, activity, pendingCount };
  if (!terminal && pendingCount > 0 && rule.inputEnabled) {
    view.inputEnabled = false;
    view.inputLock = 'waiting-approval';
    view.inputHint = '승인 카드에 답해 주세요';
  }
  return view;
}
