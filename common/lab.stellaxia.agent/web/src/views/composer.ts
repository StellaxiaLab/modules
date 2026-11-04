// 화면 7 — 입력. <textarea> 한 번 만들고 다시 만들지 않는다(초점·한글 조합을 잃지 않는다).
// 보내기는 앱이 store.send(가드 포함)로 한다 — 이 조각은 누르는 것만 알린다. 잠금·한도·조합 규칙은 app/input.ts.

import { h, icon, setClass, setText } from '../app/dom';
import { composerHeight, draftStatus, shouldSubmitOnKey } from '../app/input';
import type { View } from './types';

export interface ComposerNotice {
  tone: 'info' | 'warn' | 'err';
  text: string;
}

export interface ComposerModel {
  /** 입력칸이 어느 세션의 것인가. 바뀌면 draft 로 값을 되돌린다. */
  sessionId: string;
  /** 세션별로 기억한 초안 — sessionId 나 resetKey 가 바뀔 때만 입력칸에 쓴다(타이핑을 덮어쓰지 않는다). */
  draft: string;
  resetKey: number;
  locked: boolean;
  placeholder: string;
  /** 잠긴 이유(스크린 리더용 설명). */
  lockReason: string | null;
  /** 보내는 중 — 연타해도 한 번이다. */
  sending: boolean;
  footNote: string;
  notice: ComposerNotice | null;
}

export interface ComposerHandlers {
  onSubmit(text: string): void;
  onDraft(sessionId: string, text: string): void;
}

export interface ComposerView extends View<ComposerModel> {
  readonly textarea: HTMLTextAreaElement;
  readonly sendButton: HTMLButtonElement;
  focus(): void;
}

export function createComposer(handlers: ComposerHandlers): ComposerView {
  let sessionId = '';
  let resetKey = -1;
  let locked = true;
  let sending = false;
  let composing = false;

  const textarea = h('textarea', {
    attrs: { rows: 1, 'aria-label': '세션에 보낼 글', 'aria-describedby': 'composer-count composer-foot', id: 'composer-input', autocomplete: 'off', spellcheck: false },
  });
  const sendButton = h('button', { class: 'btn pri sm', attrs: { type: 'button', 'data-role': 'send' } }, icon('up', 's'), '보내기');
  const box = h('div', { class: 'box' }, textarea, sendButton);
  const notice = h('div', { class: 'notice', attrs: { role: 'status', hidden: true, 'data-role': 'composer-notice' } });
  const foot = h('span', { attrs: { id: 'composer-foot' } });
  const count = h('span', { class: 'mono count', attrs: { id: 'composer-count' } });
  const el = h('div', { class: 'inp' }, notice, box, h('div', { class: 'foot' }, foot, count));

  function resize(): void {
    textarea.style.height = 'auto';
    const next = composerHeight(textarea.scrollHeight);
    textarea.style.height = `${next}px`;
    textarea.style.overflowY = textarea.scrollHeight > next ? 'auto' : 'hidden';
  }

  function refreshControls(): void {
    const status = draftStatus(textarea.value);
    setText(count, status.over ? `${status.label} — 한도를 넘어 보낼 수 없습니다` : status.label);
    setClass(count, status.over ? 'mono count over' : 'mono count');
    sendButton.disabled = locked || sending || !status.sendable;
    textarea.disabled = locked;
    box.classList.toggle('dis', locked);
    box.classList.toggle('work', sending);
  }

  function submit(): void {
    const status = draftStatus(textarea.value);
    if (locked || sending || !status.sendable) return;
    handlers.onSubmit(textarea.value);
  }

  textarea.addEventListener('input', () => {
    resize();
    refreshControls();
    handlers.onDraft(sessionId, textarea.value);
  });
  textarea.addEventListener('compositionstart', () => {
    composing = true;
  });
  textarea.addEventListener('compositionend', () => {
    composing = false;
  });
  textarea.addEventListener('keydown', (e) => {
    if (shouldSubmitOnKey(e, composing)) {
      e.preventDefault();
      submit();
    }
  });
  sendButton.addEventListener('click', submit);

  return {
    el,
    textarea,
    sendButton,
    focus: () => textarea.focus(),
    update(model) {
      if (model.sessionId !== sessionId || model.resetKey !== resetKey) {
        sessionId = model.sessionId;
        resetKey = model.resetKey;
        textarea.value = model.draft;
        resize();
      }
      locked = model.locked;
      sending = model.sending;
      textarea.placeholder = model.placeholder;
      if (model.lockReason) textarea.setAttribute('aria-description', model.lockReason);
      else textarea.removeAttribute('aria-description');
      setText(foot, model.footNote);
      refreshControls();
      notice.hidden = model.notice === null;
      if (model.notice) {
        setClass(notice, `notice ${model.notice.tone}`);
        setText(notice, model.notice.text);
      } else setText(notice, '');
    },
  };
}
