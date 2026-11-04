// 화면 1 — 준비 상태. 왼쪽 위의 작은 카드(항상)와 가운데의 단계별 안내(홈 화면).
import { h, icon, reconcile, setClass, setText } from '../app/dom';
import type { ReadinessPresentation, StepPresentation, Tone } from '../app/readiness-model';
import type { View } from './types';

const TONE_STATE: Record<Tone, string> = { ok: '정상', warn: '주의', bad: '문제', wait: '확인 중' };
const TONE_COLOR: Record<Tone, string> = { ok: 'ok', warn: 'warn', bad: 'err', wait: 'wait' };

function chipClass(tone: Tone): string {
  return `chip ${tone === 'ok' ? 'ok' : tone === 'bad' ? 'warn' : tone === 'warn' ? 'warn' : 'mut'}`;
}

// ── 사이드바 카드 ───────────────────────────────────────────────────────

export function createReadinessCard(): View<ReadinessPresentation> {
  const chip = h('span', { class: 'chip mut', attrs: { 'data-role': 'readiness-chip' } });
  const dots = h('div', { class: 'dots', attrs: { 'data-role': 'readiness-dots' } });
  const el = h(
    'section',
    { class: 'card readiness-card', attrs: { 'aria-label': '준비 상태', 'data-role': 'readiness-card' } },
    h('div', { class: 'row' }, h('span', { class: 'cap' }, '준비 상태'), chip),
    dots,
  );
  return {
    el,
    update(model) {
      chip.replaceChildren(model.tone === 'ok' ? icon('check', 's') : model.tone === 'bad' ? icon('warn', 's') : icon('clock', 's'), model.chip);
      setClass(chip, chipClass(model.tone));
      const shown = model.steps.filter((s) => s.id !== 'expiry' && s.id !== 'door');
      reconcile<StepPresentation>(dots, shown, {
        key: (s) => s.id,
        create: (s) => {
          const item = h('span', { class: 'dot-item' }, h('i', { class: 'dot' }), h('span', { class: 'lbl-t' }, s.label), h('span', { class: 'sr-only' }));
          return item;
        },
        update: (item, s) => {
          setClass(item.querySelector('.dot') as HTMLElement, `dot ${TONE_COLOR[s.tone]}`);
          setText(item.querySelector('.sr-only') as HTMLElement, ` ${TONE_STATE[s.tone]}`);
        },
      });
    },
  };
}

// ── 가운데 안내 ─────────────────────────────────────────────────────────

export interface ReadinessGuideModel {
  presentation: ReadinessPresentation;
  /** 세션이 하나도 없을 때의 안내를 보이는가. */
  hasSessions: boolean;
  checking: boolean;
}

export interface ReadinessGuideHandlers {
  onRecheck(): void;
}

function stepMark(step: StepPresentation): string {
  return step.tone === 'ok' ? '✓' : step.tone === 'bad' ? '!' : step.tone === 'warn' ? '!' : '…';
}

export function createReadinessGuide(handlers: ReadinessGuideHandlers): View<ReadinessGuideModel> {
  const title = h('h2', { class: 'pane-title', attrs: { id: 'guide-title' } }, '준비 상태');
  const chip = h('span', { class: 'chip mut' });
  const headline = h('p', { class: 'guide-headline', attrs: { role: 'status' } });
  const list = h('ol', { class: 'steps', attrs: { 'aria-labelledby': 'guide-title' } });
  const proposal = h('div', { class: 'note proposal', attrs: { hidden: true } }, icon('info', 's'), h('span', {}));
  const caveat = h('div', { class: 'note', attrs: { hidden: true } }, icon('warn', 's'), h('span', {}));
  const hint = h('p', { class: 'guide-hint' });
  const recheck = h('button', { class: 'btn sm', attrs: { type: 'button' }, on: { click: () => handlers.onRecheck() } }, '다시 확인');
  const el = h(
    'section',
    { class: 'guide', attrs: { 'aria-labelledby': 'guide-title', 'data-role': 'readiness-guide' } },
    h('header', { class: 'pane-head' }, title, chip, h('span', { class: 'grow' }), recheck),
    headline,
    list,
    proposal,
    caveat,
    hint,
  );
  return {
    el,
    update({ presentation: p, hasSessions, checking }) {
      chip.replaceChildren(p.chip);
      setClass(chip, chipClass(p.tone));
      setText(headline, p.headline);
      (recheck as HTMLButtonElement).disabled = checking;
      reconcile<StepPresentation>(list, p.steps, {
        key: (s) => s.id,
        create: () =>
          h(
            'li',
            { class: 'step' },
            h('span', { class: 'n', attrs: { 'aria-hidden': 'true' } }),
            h('div', { class: 'st-body' }, h('b', { class: 'st-title' }), h('span', { class: 'st-detail' })),
            h('span', { class: 'chip mut st-badge', attrs: { hidden: true } }),
          ),
        update: (li, s) => {
          setClass(li, `step ${s.tone === 'ok' ? 'ok' : s.tone === 'wait' ? 'wait' : 'bad'}`);
          setText(li.querySelector('.n') as HTMLElement, stepMark(s));
          setText(li.querySelector('.st-title') as HTMLElement, `${s.label} · ${s.title}`);
          const detail = li.querySelector('.st-detail') as HTMLElement;
          setText(detail, s.detail);
          detail.hidden = s.detail === '';
          const badge = li.querySelector('.st-badge') as HTMLElement;
          setText(badge, s.badge ?? '');
          badge.hidden = !s.badge;
        },
      });
      proposal.hidden = !p.delegateProposal;
      setText(proposal.querySelector('span') as HTMLElement, '제안 · 아직 없음 — ' + '위임 자격을 한 동작으로 맡기는 기능은 아직 없습니다(요구 §8.1). 자격이 맡겨지면 이 앱이 사실(권한·범위·만료)만 읽어 보여 줍니다.');
      caveat.hidden = p.caveat === null;
      if (p.caveat) setText(caveat.querySelector('span') as HTMLElement, p.caveat);
      hint.hidden = !p.canOpenSession;
      setText(hint, hasSessions ? '왼쪽에서 세션을 고르거나 새 세션을 여세요.' : '열린 세션이 없습니다. 왼쪽의 "새 세션"으로 시작하세요.');
    },
  };
}
