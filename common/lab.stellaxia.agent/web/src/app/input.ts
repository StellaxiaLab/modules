// 화면 7 — 입력 규칙. 순수 함수.
//   - 한글 조합 중 Enter 는 전송이 아니다(DC-22): isComposing 또는 keyCode 229.
//   - Shift+Enter 는 줄바꿈. 20000자 제한은 문자(코드 포인트) 수로 센다 — 모듈의 maxLength 와 같다.
//   - 높이는 내용에 따라 자라되 120px 까지(GAP-3).

import { MESSAGE_MAX_CHARS, charLength } from '../api/client';

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** IME 조합 중인가. 크롬은 조합 확정 Enter 에 isComposing=true, 사파리는 keyCode 229 를 낸다. */
export function isImeKey(e: Pick<KeyLike, 'isComposing' | 'keyCode'>): boolean {
  return e.isComposing === true || e.keyCode === 229;
}

/** 이 키 입력이 "보내기"인가. Shift+Enter 와 조합 중 Enter 는 아니다. */
export function shouldSubmitOnKey(e: KeyLike, composing = false): boolean {
  if (e.key !== 'Enter') return false;
  if (composing || isImeKey(e)) return false;
  if (e.shiftKey || e.altKey) return false;
  return true;
}

export interface DraftStatus {
  length: number;
  max: number;
  over: boolean;
  blank: boolean;
  /** "123 / 20000" */
  label: string;
  /** 보낼 수 있는 글인가(비어 있지 않고 한도 안). 잠금은 따로 본다. */
  sendable: boolean;
}

export function draftStatus(text: string): DraftStatus {
  const length = charLength(text);
  const over = length > MESSAGE_MAX_CHARS;
  const blank = text.trim() === '';
  return { length, max: MESSAGE_MAX_CHARS, over, blank, label: `${length} / ${MESSAGE_MAX_CHARS}`, sendable: !over && !blank };
}

export const COMPOSER_MIN_HEIGHT_PX = 32;
export const COMPOSER_MAX_HEIGHT_PX = 120;

/** scrollHeight 로 입력칸 높이를 정한다 — 한 줄은 32px, 최대 120px. */
export function composerHeight(scrollHeight: number): number {
  return Math.max(COMPOSER_MIN_HEIGHT_PX, Math.min(COMPOSER_MAX_HEIGHT_PX, Math.ceil(scrollHeight)));
}
