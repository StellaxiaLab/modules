// 보내기 직전 가드 (함정 6).
//
// `y`·`n`·`yes`·`no`·`approve`·`deny`(+ 둘째 토큰 하나)는 승인 답으로 읽힌다 — 대기 승인이 있으면 일반 글로 보내도
// 가장 오래된 대기 승인에 답한다(loop.go answerText, api.go messagePost). 폴링 지연 사이에 사용자가 "y" 를 보내면 승인이 된다.
// 그래서 보내기 직전에 sessions.get 으로 pending_approvals 가 비었는지 **확인**한다. 확인하지 못하면 보내지 않는다.
// 승인은 approvals.post 로만 답한다(I8) — 채팅 입력의 승인 경로를 쓰지 않는다.

import { MESSAGE_MAX_CHARS, charLength, type AgentClient, type CallFailure } from '../api/client';
import type { MessagePosted, SessionSnapshot } from '../api/types';
import { isTerminal } from './status';

const ANSWER_WORDS: ReadonlySet<string> = new Set(['approve', 'yes', 'y', 'deny', 'no', 'n']);

/** 모듈이 승인 답으로 읽는 글인가 — answerText 와 같은 규칙(공백으로 나눈 1~2토큰, 첫 토큰이 답 낱말, 대소문자 무시). */
export function looksLikeApprovalAnswer(text: string): boolean {
  const fields = text.trim().toLowerCase().split(/\s+/).filter((f) => f !== '');
  if (fields.length === 0 || fields.length > 2) return false;
  return ANSWER_WORDS.has(fields[0] ?? '');
}

export type BlockReason = 'empty' | 'too-long' | 'unverified' | 'pending-approval' | 'waiting-approval' | 'busy' | 'finished' | 'unknown-state';

export type SendVerdict = { allow: true; answerLike: boolean } | { allow: false; reason: BlockReason; message: string };

const MESSAGES: Record<BlockReason, string> = {
  empty: '보낼 글이 비어 있습니다.',
  'too-long': `글은 ${MESSAGE_MAX_CHARS}자 이하여야 합니다.`,
  unverified: '세션 상태를 확인하지 못해 보내지 않았습니다.',
  'pending-approval': '대기 중인 승인이 있습니다. 승인 카드에 먼저 답해 주세요 — 지금 보내면 글이 승인 답으로 읽힐 수 있습니다.',
  'waiting-approval': '승인 대기 중입니다.',
  busy: '모델이 답하는 중입니다.',
  finished: '끝난 세션에는 보낼 수 없습니다.',
  'unknown-state': '알 수 없는 상태의 세션에는 보내지 않습니다.',
};

const block = (reason: BlockReason): SendVerdict => ({ allow: false, reason, message: MESSAGES[reason] });

/**
 * 순수 판정. `fresh` 는 **방금** sessions.get 으로 읽은 스냅샷이어야 한다 — 목록·폴링 캐시를 넘기지 않는다.
 * 보내도 되는 때는 idle 이고 대기 승인이 없을 때뿐이다. 대기 승인은 돌고 있는 차례에서만 생기고 차례는
 * messages.post 로만 시작하므로, idle + pending 없음이면 "y" 도 일반 글로 읽힌다.
 */
export function evaluateSend(text: string, fresh: SessionSnapshot | null | undefined): SendVerdict {
  if (text.trim() === '') return block('empty');
  if (charLength(text) > MESSAGE_MAX_CHARS) return block('too-long');
  if (!fresh) return block('unverified');
  if ((fresh.pending_approvals?.length ?? 0) > 0) return block('pending-approval');
  const state: string = fresh.state;
  if (state === 'waiting-approval') return block('waiting-approval');
  if (state === 'running') return block('busy');
  if (isTerminal(state)) return block('finished');
  if (state !== 'idle') return block('unknown-state');
  return { allow: true, answerLike: looksLikeApprovalAnswer(text) };
}

export type GuardedSendResult =
  | { sent: true; entry: MessagePosted['entry']; answerLike: boolean }
  | { sent: false; reason: BlockReason; message: string }
  | { sent: false; reason: 'verify-failed'; failure: CallFailure }
  | { sent: false; reason: 'post-failed'; failure: CallFailure };

/**
 * sessions.get → 판정 → messages.post. get 이 실패하면 보내지 않는다. post 는 재시도 never(I17) — 실패해도 다시 보내지 않고
 * `failure.outcomeUnknown` 이면 호출한 쪽이 messages.list 로 확인하고 사람이 다시 누르게 한다.
 */
export async function guardedSend(client: Pick<AgentClient, 'sessionsGet' | 'messagesPost'>, sessionId: string, text: string, signal?: AbortSignal): Promise<GuardedSendResult> {
  const opts = signal ? { signal } : undefined;
  const fresh = await client.sessionsGet(sessionId, opts);
  if (!fresh.ok) return { sent: false, reason: 'verify-failed', failure: fresh };
  const verdict = evaluateSend(text, fresh.data);
  if (!verdict.allow) return { sent: false, reason: verdict.reason, message: verdict.message };
  const posted = await client.messagesPost(sessionId, text, opts);
  if (!posted.ok) return { sent: false, reason: 'post-failed', failure: posted };
  return { sent: true, entry: posted.data.entry, answerLike: verdict.answerLike };
}
