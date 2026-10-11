// 새 세션 열기(GAP-9, G1 몫). 자율성은 `plan` 만 켠다(D-7) — 나머지는 G2 이후라 꺼 두고 이유를 쓴다.
// session_id 는 앱이 만들고 이 화면을 연 동안 하나다 — 같은 id 로 다시 눌러도 모듈이 `created:false` 로 답한다(멱등, 함정 9).
import { AUTONOMIES, type Autonomy } from '../api/types';
import { TOPIC_MAX_CHARS } from '../api/client';
import { h, icon, setText } from '../app/dom';
import type { View } from './types';

export interface NewSessionModel {
  sessionId: string;
  creating: boolean;
  canOpen: boolean;
  /** 열 수 없는 이유(준비 상태). */
  blockedReason: string | null;
  error: string | null;
}

export interface NewSessionHandlers {
  onSubmit(input: { topic: string }): void;
  onClose(): void;
}

const DESC: Record<Autonomy, string> = {
  plan: '읽기만 하고 제안한다. 실행하지 않는다',
  ask: '쓰기 전에 사람에게 묻는다',
  auto: '읽기와 되돌릴 수 있는 쓰기는 묻지 않는다. 위험한 호출은 여전히 묻는다',
  unattended: '읽기와 사전 승인한 호출만 실행하고 나머지는 거절한다',
};
const OFF_REASON: Record<Autonomy, string> = {
  plan: '',
  ask: '승인 카드가 서는 다음 단계(G2)에서 열립니다',
  auto: '승인 카드가 서는 다음 단계(G2)에서 열립니다',
  unattended: '무인 세션은 G4에서 열립니다',
};

export function createNewSession(handlers: NewSessionHandlers): View<NewSessionModel> {
  const sid = h('span', { class: 'chip mut mono' });
  const topic = h('input', { attrs: { type: 'text', id: 'new-topic', maxlength: TOPIC_MAX_CHARS, autocomplete: 'off' } });
  const options = AUTONOMIES.map((a) => {
    const input = h('input', { attrs: { type: 'radio', name: 'autonomy', value: a, disabled: a !== 'plan', checked: a === 'plan' } });
    const label = h(
      'label',
      { class: `opt${a === 'plan' ? ' on' : ' off'}` },
      input,
      h('b', {}, a),
      h('span', {}, DESC[a]),
      a === 'plan' ? null : h('span', { class: 'opt-off' }, OFF_REASON[a]),
    );
    return label;
  });
  const banner = h('div', { class: 'ban err', attrs: { role: 'alert', hidden: true } }, icon('warn'), h('span', {}));
  const blocked = h('div', { class: 'ban warn', attrs: { hidden: true } }, icon('info'), h('span', {}));
  const submit = h('button', { class: 'btn pri', attrs: { type: 'submit', 'data-role': 'open-session' } }, '세션 열기');
  const close = h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => handlers.onClose() } }, '닫기');

  const el = h(
    'section',
    { class: 'c2 newses', attrs: { 'aria-labelledby': 'new-title', 'data-role': 'new-session-pane' } },
    h('header', { class: 'pane-head' }, h('h2', { class: 'pane-title', attrs: { id: 'new-title' } }, '새 세션 열기'), sid, h('span', { class: 'grow' }), close),
    h(
      'form',
      {
        class: 'newform',
        attrs: { novalidate: true },
        on: {
          submit: (e) => {
            e.preventDefault();
            handlers.onSubmit({ topic: (topic as HTMLInputElement).value.trim() });
          },
        },
      },
      blocked,
      h('div', { class: 'field' }, h('label', { attrs: { for: 'new-topic' } }, '제목 (선택)'), topic, h('span', { class: 'hint' }, `${TOPIC_MAX_CHARS}자 이하. 비워 두면 session_id 로 보입니다.`)),
      h('fieldset', { class: 'autonomy' }, h('legend', { class: 'cap' }, '자율성 · 열 때 고정 · 기본값은 plan (D-7)'), h('div', { class: 'opts' }, ...options)),
      h(
        'div',
        { class: 'card limits' },
        h('span', { class: 'cap' }, '한도 · 기본값'),
        h('span', { class: 'mono' }, '차례당 호출 24 · 시간 900초(승인 대기 포함) · 토큰 무제한'),
        h('span', { class: 'dim' }, '열린 뒤의 값은 세션 정보에서 모듈이 답한 값으로 확인합니다.'),
      ),
      banner,
      h('div', { class: 'form-actions' }, h('span', { class: 'dim' }, '열린 뒤에는 자율성을 바꿀 수 없습니다. 올리려면 새 세션입니다.'), submit),
    ),
  );
  return {
    el,
    update(model) {
      setText(sid, `session_id 자동 · ${model.sessionId}`);
      (submit as HTMLButtonElement).disabled = !model.canOpen || model.creating;
      setText(submit, model.creating ? '여는 중…' : '세션 열기');
      blocked.hidden = model.blockedReason === null || model.canOpen;
      setText(blocked.querySelector('span') as HTMLElement, model.blockedReason ?? '');
      banner.hidden = model.error === null;
      setText(banner.querySelector('span') as HTMLElement, model.error ?? '');
    },
  };
}
