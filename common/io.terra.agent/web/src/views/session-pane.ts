// 화면 3 — 대화. 머리(제목·상태·마지막 오류·자율성·취소) + 기록 + 입력(화면 7).
// 기록은 role=log · aria-live=polite · tabindex=0. 줄은 seq 로 한 번만 그리고, 바뀌는 줄(승인 자리표시·차례 줄)만 다시 그린다.
// 올려 읽는 중에는 새 줄이 와도 읽던 자리를 지키고, 맨 아래에서는 따라간다(GAP-4). 오래된 줄은 쪽 단위로 위에 붙인다.

import type { Entry } from '../api/types';
import { h, icon, setClass, setText } from '../app/dom';
import { ScrollFollower } from '../app/scroll';
import { lastSeqOfKind, turnCallsByDone } from '../app/turns';
import type { SessionView } from '../data/view';
import type { ApprovalUi } from './approval-card';
import { defaultEntryRenderers, entrySignature, entryUpdate, renderEntry, type EntryContext, type EntryRenderers } from './entries';
import { createComposer, type ComposerHandlers, type ComposerModel, type ComposerView } from './composer';
import type { View } from './types';

/** 처음 그리는 줄 수와 "이전 줄 더 보기" 한 번에 붙이는 줄 수. 전체 기록은 data/ledger 가 after_seq 로 쪽을 넘겨 이미 읽어 두었다. */
export const RENDER_WINDOW = 200;

export interface SessionPaneModel {
  sessionId: string;
  title: string;
  viewer: string | null;
  /** null 이면 아직 읽지 못했다(읽는 중이거나 실패). */
  view: SessionView | null;
  loadProblem: string | null;
  composer: ComposerModel;
  /** 승인 카드가 쓰는 시계·답하는 길. 없으면 카드는 답할 컨트롤을 그리지 않는다. */
  approvals?: ApprovalUi;
}

export interface SessionPaneHandlers extends ComposerHandlers {
  onCancelClick(): void;
}

export interface SessionPane extends View<SessionPaneModel> {
  readonly composer: ComposerView;
  readonly log: HTMLElement;
  readonly follower: ScrollFollower;
  /** 지금 그려진 줄의 seq 들(시험·확장용). */
  renderedSeqs(): number[];
}

const DOT_TONE: Record<string, string> = { idle: 't-idle', busy: 't-busy', attention: 't-attention', ended: 't-ended', error: 't-error' };
const CHIP_TONE: Record<string, string> = { idle: 'chip', busy: 'chip info', attention: 'chip warn', ended: 'chip mut', error: 'chip err' };

export function createSessionPane(handlers: SessionPaneHandlers, renderers: EntryRenderers = defaultEntryRenderers): SessionPane {
  // ── 머리 ──
  const titleEl = h('b', { class: 'ses-title' });
  const sidEl = h('span', { class: 'mono dim ses-sid' });
  const stateChip = h('span', { class: 'chip', attrs: { 'data-role': 'state-chip' } }, h('i', { class: 'dot' }), h('span', {}));
  const errChip = h('span', { class: 'chip err mono', attrs: { hidden: true, title: '마지막 오류', 'data-role': 'last-error' } });
  const autoChip = h('span', { class: 'chip mut', attrs: { 'data-role': 'autonomy-chip' } }, icon('lock', 's'), h('span', {}));
  const simChip = h('span', { class: 'chip warn', attrs: { hidden: true } }, '시뮬레이션 · 호출 없음');
  const cancelBtn = h('button', { class: 'btn sm dng', attrs: { type: 'button', 'data-role': 'cancel', hidden: true }, on: { click: () => handlers.onCancelClick() } }, icon('stop', 's'), '취소');
  const header = h(
    'header',
    { class: 'ses-head' },
    h('div', { class: 'ses-id' }, titleEl, sidEl),
    stateChip,
    errChip,
    h('div', { class: 'ses-actions' }, simChip, autoChip, cancelBtn),
  );

  // ── 기록 ──
  const older = h('button', { class: 'btn sm older', attrs: { type: 'button', hidden: true, 'data-role': 'older' } });
  const lines = h('div', { class: 'lines' });
  const empty = h('div', { class: 'empty', attrs: { hidden: true } }, icon('spark', 'l'), h('b', {}, '무엇을 도와드릴까요?'), h('span', { class: 'empty-hint' }));
  const problem = h('div', { class: 'empty problem', attrs: { hidden: true, role: 'alert' } });
  const thinking = h('div', { class: 'ai thinking', attrs: { 'aria-hidden': 'true', hidden: true } }, h('div', { class: 'av' }, icon('spark', 's')), h('div', { class: 'tx' }, h('span', { class: 'think' }, h('i'), h('i'), h('i'))));
  const inner = h('div', { class: 'in' }, older, lines, empty, problem, thinking);
  const log = h('div', { class: 'msgs', attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': '대화 기록', tabindex: 0, 'data-role': 'log' } }, inner);
  const newBar = h('button', { class: 'btn sm newbar', attrs: { type: 'button', hidden: true, 'data-role': 'newbar' } });
  const logWrap = h('div', { class: 'log-wrap' }, log, newBar);

  const composer = createComposer(handlers);
  const el = h('section', { class: 'c2', attrs: { 'aria-label': '대화', 'data-role': 'session-pane' } }, header, logWrap, composer.el);

  // ── 상태 ──
  let currentSession: string | null = null;
  let firstSeq = 0;
  let windowStart: number | null = null; // 그리기 시작하는 seq(이보다 오래된 줄은 접는다)
  const rendered = new Map<number, { el: HTMLElement; sig: string }>();
  let unseen = 0;
  let lastSeenSeq = 0;
  let lastModel: SessionPaneModel | null = null;

  const follower = new ScrollFollower(log, (following) => {
    if (following) {
      unseen = 0;
      newBar.hidden = true;
    }
  });

  newBar.addEventListener('click', () => {
    follower.scrollToBottom();
    log.focus();
  });
  older.addEventListener('click', () => {
    if (!lastModel?.view || windowStart === null) return;
    const entries = lastModel.view.entries;
    const index = entries.findIndex((e) => e.seq >= (windowStart as number));
    const nextIndex = Math.max(0, (index < 0 ? entries.length : index) - RENDER_WINDOW);
    windowStart = entries[nextIndex]?.seq ?? firstSeq;
    const before = follower.measure();
    syncLines(lastModel);
    follower.afterPrepend(before);
    updateOlder(lastModel.view.entries);
  });

  function entryContext(model: SessionPaneModel, view: SessionView): EntryContext {
    return {
      viewer: model.viewer,
      ordinals: view.ordinals,
      cards: new Map(view.cards.map((c) => [c.requestId, c])),
      turnCalls: turnCallsByDone(view.entries),
      lastDoneSeq: lastSeqOfKind(view.entries, 'done'),
      tokens: view.tokens,
      ...(model.approvals ? { approvals: model.approvals } : {}),
    };
  }

  /** 보여 줄 줄을 DOM 에 맞춘다. 새 줄은 위치에 맞춰 끼우고, 서명이 바뀐 줄만 다시 그린다. */
  function syncLines(model: SessionPaneModel): number {
    const view = model.view;
    if (!view) return 0;
    const ctx = entryContext(model, view);
    const visible: Entry[] = windowStart === null ? [] : view.entries.filter((e) => e.seq >= (windowStart as number));
    const visibleSeqs = new Set(visible.map((e) => e.seq));
    for (const [seq, item] of rendered) {
      if (!visibleSeqs.has(seq)) {
        item.el.remove();
        rendered.delete(seq);
      }
    }
    let added = 0;
    let prev: HTMLElement | null = null;
    for (const entry of visible) {
      const sig = entrySignature(entry, ctx, renderers);
      const existing = rendered.get(entry.seq);
      if (existing && existing.sig === sig) {
        entryUpdate(existing.el, entry, ctx, renderers); // 노드는 그대로 — 카운트다운 글자만 맞춘다
        prev = existing.el;
        continue;
      }
      const node = renderEntry(entry, ctx, renderers);
      if (existing) {
        // 다시 그리는 줄 안에 키보드 초점이 있었다면(방금 누른 승인 버튼) 카드로 옮겨 자리를 잃지 않게 한다.
        const hadFocus = existing.el.contains(document.activeElement);
        existing.el.replaceWith(node);
        if (hadFocus) node.querySelector<HTMLElement>('[data-refocus]')?.focus({ preventScroll: true });
      } else {
        if (prev) prev.after(node);
        else lines.prepend(node);
        if (entry.seq > lastSeenSeq) added += 1;
      }
      rendered.set(entry.seq, { el: node, sig });
      prev = node;
    }
    return added;
  }

  function updateOlder(entries: readonly Entry[]): void {
    const hidden = windowStart === null ? 0 : entries.filter((e) => e.seq < (windowStart as number)).length;
    older.hidden = hidden === 0;
    if (hidden > 0) setText(older, `이전 줄 ${hidden}개 더 보기`);
  }

  function resetForSession(sessionId: string): void {
    currentSession = sessionId;
    rendered.clear();
    lines.replaceChildren();
    windowStart = null;
    firstSeq = 0;
    unseen = 0;
    lastSeenSeq = 0;
    newBar.hidden = true;
    follower.reset();
  }

  return {
    el,
    composer,
    log,
    follower,
    renderedSeqs: () => [...rendered.keys()].sort((a, b) => a - b),
    update(model) {
      lastModel = model;
      if (model.sessionId !== currentSession) resetForSession(model.sessionId);
      const view = model.view;

      setText(titleEl, model.title);
      setText(sidEl, `session · ${model.sessionId}`);

      if (view) {
        const screen = view.screen;
        setClass(stateChip, `${CHIP_TONE[screen.tone] ?? 'chip'}`);
        setClass(stateChip.querySelector('.dot') as HTMLElement, `dot ${DOT_TONE[screen.tone] ?? ''}`);
        setText(stateChip.querySelector('span') as HTMLElement, screen.label);
        // 마지막 오류는 상태 옆에 — 한도·거절·모델 장애는 여기서 읽힌다(I20). 성공처럼 보이게 그리지 않는다.
        const code = screen.showLastError ? view.lastError.code : null;
        errChip.hidden = code === null;
        setText(errChip, code ?? '');
        setText(autoChip.querySelector('span') as HTMLElement, `${view.snapshot.autonomy} · 열 때 고정`);
        simChip.hidden = !view.snapshot.simulate;
        cancelBtn.hidden = !screen.canCancel;
      } else {
        setText(stateChip.querySelector('span') as HTMLElement, model.loadProblem ? '읽지 못함' : '읽는 중');
        setClass(stateChip, 'chip mut');
        errChip.hidden = true;
        cancelBtn.hidden = true;
        simChip.hidden = true;
      }

      problem.hidden = model.loadProblem === null || view !== null;
      setText(problem, model.loadProblem ?? '');

      if (view) {
        if (windowStart === null) {
          const start = Math.max(0, view.entries.length - RENDER_WINDOW);
          windowStart = view.entries[start]?.seq ?? 0;
          firstSeq = view.entries[0]?.seq ?? 0;
        }
        const before = follower.measure();
        const added = syncLines(model);
        const maxSeq = view.entries.length ? (view.entries[view.entries.length - 1] as Entry).seq : 0;
        if (added > 0) {
          follower.afterAppend(before);
          if (!follower.following) {
            unseen += added;
            setText(newBar, `새 글 ${unseen}줄 · 맨 아래로`);
            newBar.hidden = false;
          }
        } else if (follower.following) {
          follower.afterAppend(before);
        }
        lastSeenSeq = Math.max(lastSeenSeq, maxSeq);
        updateOlder(view.entries);
        const isEmpty = view.entries.length === 0 && !view.screen.activity.startsWith('ended');
        empty.hidden = !isEmpty;
        if (isEmpty) setText(empty.querySelector('.empty-hint') as HTMLElement, hintFor(view.snapshot.autonomy));
        thinking.hidden = view.screen.activity !== 'model-working';
      } else {
        empty.hidden = true;
        thinking.hidden = true;
      }

      composer.update(model.composer);
    },
  };
}

function hintFor(autonomy: string): string {
  if (autonomy === 'plan') return 'plan 세션은 읽기만 하고 제안합니다. 실행하지 않습니다.';
  if (autonomy === 'ask') return 'ask 세션은 쓰기 전에 사람에게 승인을 묻습니다.';
  if (autonomy === 'auto') return 'auto 세션은 읽기와 되돌릴 수 있는 쓰기는 묻지 않지만, 위험한 호출은 여전히 묻습니다.';
  return 'unattended 세션은 읽기와 사전 승인한 호출만 실행하고 나머지는 거절합니다.';
}
