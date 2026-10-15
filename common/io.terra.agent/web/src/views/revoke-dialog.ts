// 위임 자격 거두기 대화창 — 3단계(DC-20, 보드 ⑧). role=dialog · aria-modal.
//   1 열린 세션 취소 [앱]  →  2 Gateway 폐기 [터미널 — 명령 복사]  →  3 자격 삭제 [앱]
// 삭제는 열린 세션이 없고 사람이 "폐기를 마쳤습니다"를 확인해야 풀린다. 잠긴 단추는 `disabled` 가 아니라 `aria-disabled` 로 두어
// 키보드·스크린 리더가 단추에 닿고 이유(aria-describedby)를 들을 수 있게 한다. 초점은 안전한 쪽("닫기")에서 시작한다.
import { h, icon, setText } from '../app/dom';
import type { Note, RevokePhase, RevokeResult } from '../app/settings';
import type { View } from './types';

export interface RevokeDialogModel {
  open: boolean;
  phase: RevokePhase;
  result: RevokeResult | null;
  command: string | null;
  commandUnreadable: boolean;
  openCount: number;
  cancelling: boolean;
  cancelError: Note | null;
  confirmed: boolean;
  /** 삭제가 막힌 이유. 풀려 있으면 null. */
  blocked: string | null;
  error: Note | null;
  copyNote: string | null;
  selectCommand: number;
}

export interface RevokeDialogHandlers {
  onClose(): void;
  onCancelSessions(): void;
  onCopy(): void;
  onConfirm(checked: boolean): void;
  onDelete(): void;
}

const RESULT_TEXT: Record<RevokeResult, string> = {
  deleted: '맡긴 자격을 삭제했습니다.',
  'already-gone': '이미 맡겨진 자격이 없었습니다.',
  'confirmed-after-lost': '삭제 요청의 응답은 받지 못했지만, 자격을 다시 읽어 삭제된 것을 확인했습니다.',
};

export const GATEWAY_REVOKE_PENDING =
  'Gateway 폐기는 아직입니다. 이 앱은 폐기하지 못하고, 폐기 여부는 확인하지 못합니다. 아직이라면 아래 명령을 사람 세션(터미널)에서 실행하세요.';

export function createRevokeDialog(handlers: RevokeDialogHandlers, inertTarget: HTMLElement | null, fallbackFocus: () => HTMLElement | null): View<RevokeDialogModel> {
  const title = h('h4', { attrs: { id: 'revoke-title', tabindex: -1, 'data-role': 'revoke-title' } }, icon('key', 'l'));
  const titleText = h('span', {});
  title.append(titleText);
  const close = h('button', { class: 'btn sm', attrs: { type: 'button', 'data-role': 'revoke-close' }, on: { click: () => handlers.onClose() } }, '닫기');

  // ── 설명 ──
  const intro = h(
    'p',
    { class: 'dlg-body', attrs: { id: 'revoke-desc' } },
    '거두기는 세 단계입니다: 세션 취소 → Gateway 폐기 → 자격 삭제. ',
    h('b', {}, '턴 도중에 자격이 사라지면'),
    ' HTTP 오류 없이 호출 줄(',
    h('span', { class: 'mono' }, 'call'),
    ')에 ',
    h('span', { class: 'mono' }, 'GATEWAY_UNREACHABLE'),
    ' 만 쌓일 수 있습니다. 그래서 먼저 열린 세션을 취소하세요.',
  );
  const notice = h(
    'div',
    { class: 'note' },
    icon('lock', 's'),
    h('span', {}, 'Gateway 폐기는 사람 세션만 합니다. 앱은 폐기 여부를 확인하지 못합니다(R-10) — 폐기 여부는 확인하지 못합니다. 그래서 사람이 “폐기를 마쳤습니다”를 확인해야 삭제가 풀립니다. 삭제한 뒤에도 “Gateway 폐기는 아직입니다”와 명령이 결과 화면에 남습니다.'),
  );

  // ── 1 단계 ──
  const openCount = h('span', { attrs: { 'data-role': 'revoke-open-count' } });
  const cancelSessions = h('button', { class: 'btn sm dng', attrs: { type: 'button', 'data-role': 'revoke-cancel-sessions' }, on: { click: () => handlers.onCancelSessions() } });
  const step1 = h(
    'div',
    { class: 'rv-step', attrs: { role: 'group', 'aria-labelledby': 'rv1' } },
    h('div', { class: 'rv-head' }, h('span', { class: 'chip mut mono' }, '1'), h('b', { attrs: { id: 'rv1' } }, '열린 세션 취소'), h('span', { class: 'chip leaf' }, '앱')),
    h('div', { class: 'rv-row' }, openCount, cancelSessions),
    h('p', { class: 'hint' }, '취소는 되돌릴 수 없습니다. 진행 중인 호출은 멈추지 않을 수 있고, 취소된 세션에는 새 글을 보낼 수 없습니다.'),
  );

  // ── 2 단계 ──
  const commandText = h('span', { class: 'mono', attrs: { 'data-role': 'revoke-command' } });
  const codeLine = h('div', { class: 'code' }, h('i', { attrs: { 'aria-hidden': 'true' } }, '$ '), commandText);
  const copy = h('button', { class: 'btn sm', attrs: { type: 'button', 'data-role': 'revoke-copy' }, on: { click: () => handlers.onCopy() } }, '2 · 폐기 명령 복사');
  const unreadable = h('p', { class: 'hint', attrs: { 'data-role': 'revoke-no-command' } }, '대리인 id 를 확인하지 못해 명령을 만들지 못했습니다. 사람 세션에서 폐기할 대리인을 직접 확인해 폐기하세요.');
  const copyNote = h('p', { class: 'hint', attrs: { role: 'status', 'data-role': 'revoke-copy-note' } });
  const checkbox = h('input', { attrs: { type: 'checkbox', id: 'revoke-confirmed', 'data-role': 'revoke-confirmed' }, on: { change: () => handlers.onConfirm(checkbox.checked) } });
  const confirmRow = h('label', { class: 'rv-check', attrs: { for: 'revoke-confirmed' } }, checkbox, h('span', {}, 'Gateway 폐기를 마쳤습니다 (사람 세션에서 위 명령을 실행했습니다)'));
  const step2 = h(
    'div',
    { class: 'rv-step', attrs: { role: 'group', 'aria-labelledby': 'rv2' } },
    h('div', { class: 'rv-head' }, h('span', { class: 'chip mut mono' }, '2'), h('b', { attrs: { id: 'rv2' } }, 'Gateway 폐기'), h('span', { class: 'chip warn' }, '터미널')),
  );

  // ── 3 단계 ──
  const blockedHint = h('p', { class: 'hint', attrs: { id: 'revoke-delete-hint', 'data-role': 'revoke-delete-hint' } });
  const del = h('button', {
    class: 'btn sm dng',
    attrs: { type: 'button', 'data-role': 'revoke-delete', 'aria-disabled': 'true', 'aria-describedby': 'revoke-delete-hint' },
    on: {
      click: () => {
        if (del.getAttribute('aria-disabled') === 'true') return; // 잠긴 단추: 눌러도 아무 일도 없다
        handlers.onDelete();
      },
    },
  });
  const step3 = h(
    'div',
    { class: 'rv-step', attrs: { role: 'group', 'aria-labelledby': 'rv3' } },
    h('div', { class: 'rv-head' }, h('span', { class: 'chip mut mono' }, '3'), h('b', { attrs: { id: 'rv3' } }, '맡긴 자격 삭제'), h('span', { class: 'chip leaf' }, '앱')),
    h('div', { class: 'rv-row' }, del),
    blockedHint,
  );

  // ── 결과 · 오류 ──
  const errorMessage = h('span', {});
  const errorDetail = h('details', { class: 'ev-detail' }, h('summary', {}, '원문'), h('div', { class: 'mono-wrap' }));
  const error = h('div', { class: 'dlg-error', attrs: { role: 'alert', hidden: true, 'data-role': 'revoke-error' } }, errorMessage, errorDetail);
  const resultText = h('p', {});
  const result = h('div', { class: 'rv-result', attrs: { role: 'status', hidden: true, 'data-role': 'revoke-result' } }, resultText, h('p', {}, GATEWAY_REVOKE_PENDING));

  const steps = h('div', { class: 'rv-steps' }, step1, step2, step3);
  const dialog = h(
    'div',
    { class: 'dlg dlg-wide', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'revoke-title', 'aria-describedby': 'revoke-desc', tabindex: -1 } },
    h('div', { class: 'rv-top' }, title, close),
    intro,
    steps,
    notice,
    result,
    error,
  );
  // 대화창 본체는 열려 있는 동안만 DOM 에 붙인다 — 닫힌 창의 단추·글이 접근성 트리와 다른 화면의 `[role=dialog]`·글 탐색에 끼지 않게(둘째 대화창이 되지 않게).
  const el = h('div', { class: 'ovl', attrs: { hidden: true, 'data-role': 'revoke-overlay' } });

  let opener: Element | null = null;
  let wasOpen = false;
  let lastPhase: RevokePhase = 'steps';
  let lastSelect = 0;

  /** 지금 Tab 으로 닿는 것들(보이고 `disabled` 가 아닌 것) — 순서는 DOM 순서다. */
  const stops = (): HTMLElement[] =>
    Array.from(dialog.querySelectorAll<HTMLElement>('button, input, summary')).filter((n) => !(n as HTMLButtonElement).disabled && n.closest('[hidden]') === null && n.isConnected);

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handlers.onClose();
    } else if (e.key === 'Tab') {
      const list = stops();
      if (list.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = list[0] as HTMLElement;
      const last = list[list.length - 1] as HTMLElement;
      const active = el.ownerDocument.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  // 어두운 면을 눌러도 닫는다 — 안전한 쪽이다(처리 중이면 앱이 무시한다).
  el.addEventListener('mousedown', (e) => {
    if (e.target === el) handlers.onClose();
  });

  function show(node: HTMLElement, on: boolean, parent: HTMLElement, before?: Node | null): void {
    if (on && node.parentNode !== parent) parent.insertBefore(node, before ?? null);
    else if (!on && node.parentNode) node.remove();
  }

  function setNote(slot: HTMLElement, message: HTMLElement, detail: HTMLElement, note: Note | null): void {
    slot.hidden = note === null;
    setText(message, note?.message ?? '');
    const body = detail.querySelector('.mono-wrap') as HTMLElement;
    setText(body, note?.raw ?? '');
    detail.hidden = !note || note.raw === '';
  }

  /** 초점이 사라졌거나(분리·비활성) 창 밖이면 안전한 곳으로 돌려놓는다. */
  function settleFocus(busy: boolean, done: boolean): void {
    const active = el.ownerDocument.activeElement;
    const usable = active instanceof HTMLElement && dialog.contains(active) && active !== dialog && !(active as HTMLButtonElement).disabled && active.closest('[hidden]') === null;
    if (usable) return;
    if (busy) {
      dialog.focus();
      return;
    }
    if (done) {
      title.focus();
      return;
    }
    (checkbox.isConnected && !checkbox.disabled ? checkbox : close).focus();
  }

  return {
    el,
    update(model) {
      const busy = model.cancelling || model.phase === 'deleting' || model.phase === 'verifying';
      const done = model.phase === 'done';
      setText(titleText, done ? '위임 자격을 거뒀습니다' : '위임 자격을 거둘까요?');
      close.disabled = busy;

      // 1 단계
      setText(openCount, model.openCount > 0 ? `열린 세션 ${model.openCount}개` : '열린 세션이 없습니다');
      show(cancelSessions, model.openCount > 0, step1.querySelector('.rv-row') as HTMLElement);
      setText(cancelSessions, model.cancelling ? '취소하는 중…' : `1 · 세션 ${model.openCount}개 취소`);
      cancelSessions.disabled = busy;

      // 2 단계
      const hasCommand = model.command !== null;
      setText(commandText, model.command ?? '');
      // 2 단계의 DOM 순서(= Tab 순서): 명령 → 복사 → 복사 결과 → 폐기 확인. 폐기 확인 칸은 맨 끝에 두고 나머지를 그 앞에 끼운다.
      show(confirmRow, !done, step2);
      show(codeLine, hasCommand, step2, confirmRow.parentNode === step2 ? confirmRow : null);
      show(copy, hasCommand, step2, confirmRow.parentNode === step2 ? confirmRow : null);
      show(copyNote, hasCommand, step2, confirmRow.parentNode === step2 ? confirmRow : null);
      show(unreadable, !hasCommand && model.commandUnreadable && !done, step2, confirmRow.parentNode === step2 ? confirmRow : null);
      setText(copyNote, model.copyNote ?? '');
      checkbox.checked = model.confirmed;
      checkbox.disabled = busy || done;

      // 3 단계
      const blocked = model.blocked !== null;
      del.setAttribute('aria-disabled', String(blocked));
      setText(del, model.phase === 'deleting' ? '삭제하는 중…' : model.phase === 'verifying' ? '삭제됐는지 확인하는 중…' : '3 · 자격 삭제');
      setText(blockedHint, model.blocked ?? '');

      // 결과 · 오류
      if (done) {
        show(step1, false, steps);
        show(step3, false, steps);
        // 결과 화면에는 2 단계(명령 · 복사)만 남긴다 — 삭제한 뒤에도 사람이 폐기를 마칠 수 있게.
        step2.querySelector('.rv-head')?.setAttribute('hidden', '');
      } else {
        show(step1, true, steps, step2);
        show(step3, true, steps);
        step2.querySelector('.rv-head')?.removeAttribute('hidden');
      }
      show(notice, !done, dialog, result);
      show(intro, !done, dialog, steps);
      result.hidden = !done || model.result === null;
      setText(resultText, model.result ? RESULT_TEXT[model.result] : '');
      setNote(error, errorMessage, errorDetail, model.cancelError ?? model.error);

      if (model.selectCommand !== lastSelect) {
        lastSelect = model.selectCommand;
        const selection = el.ownerDocument.getSelection();
        if (selection && commandText.isConnected) selection.selectAllChildren(commandText);
      }

      // 열림·닫힘 · 초점
      if (model.open && !wasOpen) {
        opener = el.ownerDocument.activeElement;
        el.append(dialog);
        el.hidden = false;
        inertTarget?.setAttribute('inert', '');
        close.focus();
      } else if (!model.open && wasOpen) {
        el.hidden = true;
        dialog.remove();
        inertTarget?.removeAttribute('inert');
        const back = opener;
        opener = null;
        if (back instanceof HTMLElement && back.isConnected) back.focus();
        if (!(back instanceof HTMLElement) || el.ownerDocument.activeElement !== back) fallbackFocus()?.focus();
      } else if (model.open) {
        if (done && lastPhase !== 'done') title.focus();
        else settleFocus(busy, done);
      }
      wasOpen = model.open;
      lastPhase = model.phase;
    },
  };
}
