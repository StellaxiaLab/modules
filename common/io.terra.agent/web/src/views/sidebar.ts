// 왼쪽 열 — 준비 상태 카드, 인박스, 새 세션, 탭, 세션 목록.
import { h, icon, reconcile, setClass, setText } from '../app/dom';
import type { InboxRow, SessionRow } from '../app/session-rows';
import type { ReadinessPresentation } from '../app/readiness-model';
import type { SessionTab } from '../data/status';
import { routeHash } from '../app/router';
import { createReadinessCard } from './readiness';
import type { View } from './types';

export interface SidebarModel {
  readiness: ReadinessPresentation;
  inbox: InboxRow[];
  tab: SessionTab;
  rows: SessionRow[];
  counts: Record<SessionTab, number>;
  /** 새 세션 버튼을 켜는가. */
  canOpenNew: boolean;
  newingActive: boolean;
  /** 목록을 읽지 못했을 때의 안내. */
  listProblem: string | null;
  loading: boolean;
}

export interface SidebarHandlers {
  onTab(tab: SessionTab): void;
}

const TABS: ReadonlyArray<{ id: SessionTab; label: string }> = [
  { id: 'mine', label: '내 세션' },
  { id: 'ended', label: '종료됨' },
];

const EMPTY: Record<SessionTab, string> = { mine: '열린 세션이 없습니다. 새 세션을 여세요.', ended: '종료된 세션이 없습니다.' };

export function createSidebar(handlers: SidebarHandlers): View<SidebarModel> {
  const card = createReadinessCard();

  const inboxCount = h('span', { class: 'chip warn mono' });
  const inboxList = h('div', { class: 'inbox-list' });
  const inbox = h(
    'section',
    { class: 'card inbox', attrs: { 'aria-label': '승인 인박스', 'data-role': 'inbox', hidden: true } },
    h('div', { class: 'row' }, h('span', { class: 'cap' }, '승인 인박스'), inboxCount),
    inboxList,
  );

  const newLink = h('a', { class: 'btn pri newbtn', attrs: { href: routeHash({ name: 'new' }), 'data-role': 'new-session' } }, icon('plus'), '새 세션');

  const tabButtons = new Map<SessionTab, HTMLButtonElement>();
  const seg = h('div', { class: 'seg', attrs: { role: 'tablist', 'aria-label': '세션 목록' } });
  for (const t of TABS) {
    const b = h(
      'button',
      {
        attrs: { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'session-panel', 'aria-selected': 'false', tabindex: -1 },
        on: {
          click: () => handlers.onTab(t.id),
          keydown: (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next = t.id === 'mine' ? 'ended' : 'mine';
            handlers.onTab(next);
            tabButtons.get(next)?.focus();
          },
        },
      },
      t.label,
    );
    tabButtons.set(t.id, b);
    seg.appendChild(b);
  }

  const status = h('div', { class: 'list-note', attrs: { role: 'status' } });
  const list = h('div', { class: 'sess-list' });
  const panel = h('div', { class: 'sess-panel', attrs: { role: 'tabpanel', id: 'session-panel', 'aria-labelledby': 'tab-mine' } }, status, list);

  const settings = h('div', { class: 'settings-stub', attrs: { 'aria-disabled': 'true' } }, icon('gear', 's'), '설정 · 모델 · 자격 (아직 없음)', icon('chevr', 's'));

  const el = h(
    'nav',
    { class: 'c1', attrs: { 'aria-label': '세션' } },
    h('div', { class: 'c1-top' }, card.el, inbox, newLink, seg),
    panel,
    settings,
  );

  return {
    el,
    update(model) {
      card.update(model.readiness);

      inbox.hidden = model.inbox.length === 0;
      setText(inboxCount, String(model.inbox.length));
      reconcile<InboxRow>(inboxList, model.inbox, {
        key: (r) => r.key,
        create: (r) =>
          h(
            'a',
            { class: 'chipb inbox-item', attrs: { href: routeHash({ name: 'session', id: r.sessionId }) } },
            h('b', { class: 'ib-title' }),
            h('span', { class: 'mono ib-op' }),
          ),
        update: (a, r) => {
          setText(a.querySelector('.ib-title') as HTMLElement, r.title);
          setText(a.querySelector('.ib-op') as HTMLElement, `승인이 필요합니다 · ${r.operation}${r.left ? ` · ${r.left}` : ''}`);
        },
      });

      (newLink as HTMLElement).setAttribute('aria-disabled', model.canOpenNew ? 'false' : 'true');
      newLink.tabIndex = model.canOpenNew ? 0 : -1;
      newLink.classList.toggle('off', !model.canOpenNew);
      newLink.classList.toggle('active', model.newingActive);

      for (const t of TABS) {
        const b = tabButtons.get(t.id) as HTMLButtonElement;
        const on = t.id === model.tab;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        setClass(b, on ? 'on' : '');
        setText(b, `${t.label}${model.counts[t.id] > 0 ? ` ${model.counts[t.id]}` : ''}`);
      }
      panel.setAttribute('aria-labelledby', `tab-${model.tab}`);

      const note = model.listProblem ?? (model.rows.length === 0 ? (model.loading ? '목록을 읽는 중입니다.' : EMPTY[model.tab]) : '');
      setText(status, note);
      status.hidden = note === '';

      reconcile<SessionRow>(list, model.rows, {
        key: (r) => r.id,
        create: (r) =>
          h(
            'a',
            { class: 'sess', attrs: { href: routeHash({ name: 'session', id: r.id }) } },
            h('b', { class: 'sess-title' }),
            h(
              'span',
              { class: 'm' },
              h('i', { class: 'dot' }),
              h('span', { class: 'sess-state' }),
              h('span', { class: 'chip mut sess-auto' }),
              h('span', { class: 'chip err mono sess-err' }),
              h('span', { class: 'mono sess-time' }),
            ),
          ),
        update: (a, r) => {
          setClass(a, r.selected ? 'sess on' : 'sess');
          if (r.selected) a.setAttribute('aria-current', 'page');
          else a.removeAttribute('aria-current');
          setText(a.querySelector('.sess-title') as HTMLElement, r.title);
          setClass(a.querySelector('.dot') as HTMLElement, `dot t-${r.tone}`);
          setText(a.querySelector('.sess-state') as HTMLElement, r.stateLabel);
          setText(a.querySelector('.sess-auto') as HTMLElement, r.autonomy);
          const err = a.querySelector('.sess-err') as HTMLElement;
          setText(err, r.errorCode ?? '');
          err.hidden = r.errorCode === null;
          err.title = r.errorCode ? '마지막 오류' : '';
          setText(a.querySelector('.sess-time') as HTMLElement, r.time);
        },
      });
    },
  };
}
