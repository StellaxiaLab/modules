// 취소 확인창 — role=dialog · aria-modal. 취소는 되돌릴 수 없다(I16). 초점은 안전한 쪽("그대로 두기")에 놓고,
// Tab 은 창 안에서만 돈다. Esc 로 닫으면 초점은 연 버튼으로 돌아간다.
import { h, icon, setText } from '../app/dom';
import type { View } from './types';

export interface CancelDialogModel {
  open: boolean;
  title: string;
  busy: boolean;
  error: string | null;
}

export interface CancelDialogHandlers {
  onKeep(): void;
  onConfirm(): void;
}

export function createCancelDialog(handlers: CancelDialogHandlers, inertTarget: HTMLElement | null): View<CancelDialogModel> {
  const heading = h('h4', { attrs: { id: 'cancel-title' } }, icon('stop', 'l'), '세션을 취소할까요?');
  const sessionTitle = h('b', {});
  const error = h('p', { class: 'dlg-error', attrs: { role: 'alert', hidden: true } });
  const keep = h('button', { class: 'btn', attrs: { type: 'button', 'data-role': 'cancel-keep' }, on: { click: () => handlers.onKeep() } }, '그대로 두기');
  const confirm = h('button', { class: 'btn dng', attrs: { type: 'button', 'data-role': 'cancel-confirm' }, on: { click: () => handlers.onConfirm() } }, '세션 취소');
  const dialog = h(
    'div',
    { class: 'dlg', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cancel-title', 'aria-describedby': 'cancel-desc' } },
    heading,
    h('div', { class: 'dlg-body', attrs: { id: 'cancel-desc' } }, sessionTitle, h('br'), '취소는 되돌릴 수 없습니다. 진행 중인 호출은 멈추지 않을 수 있고, 취소된 세션에는 새 글을 보낼 수 없습니다.'),
    error,
    h('div', { class: 'dlg-actions' }, keep, confirm),
  );
  const el = h('div', { class: 'ovl', attrs: { hidden: true, 'data-role': 'cancel-overlay' } }, dialog);
  let opener: Element | null = null;
  let wasOpen = false;

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handlers.onKeep();
    } else if (e.key === 'Tab') {
      const stops = [keep, confirm].filter((b) => !b.disabled);
      if (stops.length === 0) return;
      const first = stops[0] as HTMLElement;
      const last = stops[stops.length - 1] as HTMLElement;
      const active = el.ownerDocument.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  // 창 밖(어두운 면)을 눌러도 닫는다 — 안전한 쪽이다.
  el.addEventListener('mousedown', (e) => {
    if (e.target === el) handlers.onKeep();
  });

  return {
    el,
    update(model) {
      setText(sessionTitle, model.title);
      keep.disabled = model.busy;
      confirm.disabled = model.busy;
      setText(confirm, model.busy ? '취소하는 중…' : '세션 취소');
      error.hidden = model.error === null;
      setText(error, model.error ?? '');
      if (model.open && !wasOpen) {
        opener = el.ownerDocument.activeElement;
        el.hidden = false;
        inertTarget?.setAttribute('inert', '');
        keep.focus();
      } else if (!model.open && wasOpen) {
        el.hidden = true;
        inertTarget?.removeAttribute('inert');
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        opener = null;
      }
      wasOpen = model.open;
    },
  };
}
