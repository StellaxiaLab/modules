// 승인 카드(화면 4·5, 계획서 §3.2·요구 §6.3).
// 지키는 것
//   · 계약 사실(M-2 contract + 모듈의 judgement)과 모델의 주장(reason)을 다른 칸에 갈라 그린다. 모델 글은 평문 인용일 뿐 컨트롤이 없다(I7).
//   · 계약이 적지 않은 칸(키 없음)은 "적지 않음", 적었는데 비면 "없음"(DC-17). contract 객체 자체가 없으면 "계약 사실을 읽지 못했습니다".
//   · 승인·거부는 대기(actionable)이고 마감 전일 때만 켠다(I9). 누르면 곧바로 둘 다 끈다 — 같은 승인을 두 번 보내지 않는다.
//   · 카운트다운은 DOM 노드를 바꾸지 않고 글자만 갱신한다(초점 유지). 보이는 숫자는 aria-hidden, 스크린 리더에는 임계값에서만 알린다.
//   · 승인은 "물어봤다"이지 실행이 아니다 — Gateway 가 다시 판정한다.

import type { ApprovalContract } from '../api/types';
import { formatRemaining } from '../app/format';
import { h, icon, setText } from '../app/dom';
import type { ApprovalCard } from '../data/cards';
import { APPROVAL_TEXT as T, riskTone } from './approval-strings';

export type ApprovalDecision = 'approve' | 'deny';

export interface ApprovalNotice {
  tone: 'warn' | 'err';
  text: string;
}

/** 카드가 앱에서 받는 것. 시계와 답하는 길은 앱이 쥔다. */
export interface ApprovalUi {
  /** 지금(epoch ms) — 앱의 주입된 시계. 남은 시간은 카드의 낡은 remainingMs 가 아니라 이것으로 센다. */
  nowMs: number;
  /** 답을 보내고 응답을 기다리는 request_id → 누른 쪽. */
  busy: ReadonlyMap<string, ApprovalDecision>;
  /** request_id 별 안내(재시도 never 이므로 결과를 모르면 그렇게 말한다). */
  notices: ReadonlyMap<string, ApprovalNotice>;
  onAnswer(requestId: string, decision: ApprovalDecision): void;
}

const INPUT_MAX_CHARS = 4000;

/** 마감까지 남은 ms. 대기 카드만. */
export function remainingOf(card: ApprovalCard, nowMs: number): number | null {
  return card.deadline ? card.deadline.ms - nowMs : null;
}

export function isExpired(card: ApprovalCard, nowMs: number): boolean {
  const rem = remainingOf(card, nowMs);
  return rem !== null && rem <= 0;
}

// ── 계약 칸 ─────────────────────────────────────────────────────────────

function unspecified(): HTMLElement {
  return h('span', { class: 'dim', attrs: { 'data-unspecified': '' } }, T.unspecified);
}

function modeValue(value: string | undefined): HTMLElement {
  return value === undefined ? unspecified() : h('span', { class: 'mono' }, value);
}

function sideEffects(list: ApprovalContract['side_effects']): HTMLElement {
  if (list === undefined) return unspecified();
  if (list.length === 0) return h('span', {}, T.none);
  return h(
    'span',
    { class: 'appr-effects' },
    ...list.map((fx) => h('span', { class: 'chip warn mono' }, [fx.action, fx.resource_id].filter((v) => typeof v === 'string' && v !== '').join(' · ') || '(내용 없음)')),
  );
}

function riskCell(contract: ApprovalContract): HTMLElement {
  const parts: HTMLElement[] = [];
  parts.push(contract.risk === undefined ? unspecified() : h('span', { class: `chip ${riskTone(contract.risk)} mono` }, `risk: ${contract.risk}`));
  if (contract.permissions !== undefined) {
    if (contract.permissions.length === 0) parts.push(h('span', { class: 'chip mut' }, `권한 ${T.none}`));
    else for (const p of contract.permissions) parts.push(h('span', { class: 'chip mut mono' }, p));
  }
  return h('span', { class: 'appr-chips' }, ...parts);
}

function outputCell(mode: string | undefined): HTMLElement {
  if (mode === undefined) return unspecified();
  return h('span', {}, h('span', { class: `chip ${mode === 'accepted-job' ? 'info' : 'mut'} mono` }, mode), mode === 'accepted-job' ? h('span', { class: 'appr-hint' }, ` ${T.acceptedJob}`) : null);
}

function factsColumn(card: ApprovalCard): HTMLElement {
  const contract = card.contract;
  const judgement = h('p', { class: 'appr-judge' }, h('span', { class: 'dim' }, `${T.judgement} · `), card.judgement ? card.judgement : h('span', { class: 'dim' }, T.noJudgement));
  if (contract === undefined) {
    return h(
      'div',
      { class: 'appr-col facts', attrs: { 'data-contract': 'unreadable' } },
      h('h4', { class: 'cap' }, T.factsHeading),
      h('p', { class: 'appr-unreadable' }, h('b', {}, T.contractUnreadable)),
      h('p', { class: 'appr-hint' }, T.contractUnreadableHint),
      judgement,
    );
  }
  const L = T.rowLabels;
  const rows: Array<[string, HTMLElement | string]> = [
    [L.risk, riskCell(contract)],
    [L.confirmation, modeValue(contract.confirmation_mode)],
    [L.sideEffects, sideEffects(contract.side_effects)],
    [L.retry, modeValue(contract.retry_mode)],
    [L.idempotency, modeValue(contract.idempotency_mode)],
    [L.output, outputCell(contract.output_mode)],
    [L.target, T.target],
  ];
  return h(
    'div',
    { class: 'appr-col facts', attrs: { 'data-contract': 'known' } },
    h('h4', { class: 'cap' }, T.factsHeading),
    h('dl', { class: 'kv appr-kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    judgement,
  );
}

function claimColumn(card: ApprovalCard): HTMLElement {
  return h(
    'div',
    { class: 'appr-col claim' },
    h('h4', { class: 'cap' }, T.claimHeading),
    h('blockquote', { class: 'claim-text' }, card.reason ? card.reason : h('span', { class: 'dim' }, T.noReason)),
    h('p', { class: 'appr-hint' }, T.claimCaveat, ' ', h('b', {}, T.claimCaveatBold)),
  );
}

function inputDetails(input: unknown): HTMLElement | null {
  if (input === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(input, null, 2) ?? String(input);
  } catch {
    text = '(표시할 수 없는 입력)';
  }
  const cut = text.length > INPUT_MAX_CHARS;
  return h('details', { class: 'ev-detail appr-input' }, h('summary', {}, T.inputSummary), h('pre', { class: 'mono-wrap raw' }, cut ? `${text.slice(0, INPUT_MAX_CHARS)}\n${T.inputTruncated}` : text));
}

// ── 마감 ────────────────────────────────────────────────────────────────

function clockText(card: ApprovalCard, rem: number): string {
  const body = formatRemaining(rem);
  return card.deadline?.approximate ? `약 ${body}` : body;
}

/** 스크린 리더 알림이 바뀌어야 하는 구간 키. 같은 키면 글을 다시 쓰지 않는다. */
function srBucket(rem: number): string {
  if (rem <= 0) return 'x';
  if (rem <= 10_000) return '10';
  if (rem <= 30_000) return '30';
  if (rem <= 60_000) return '60';
  return `m${Math.ceil(rem / 60_000)}`;
}

function clockEl(card: ApprovalCard, rem: number): HTMLElement {
  const approx = card.deadline?.approximate === true;
  return h(
    'span',
    {
      class: `chip warn mono appr-clock${rem <= 60_000 ? ' tick' : ''}`,
      attrs: { role: 'timer', 'aria-live': 'off', 'data-role': 'clock', 'data-approximate': approx ? '' : null, title: approx ? T.clockApprox : T.clockExact },
    },
    icon('clock', 's'),
    h('span', { attrs: { 'aria-hidden': 'true', 'data-role': 'clock-vis' } }, clockText(card, rem)),
    h('span', { class: 'sr-only', attrs: { 'data-role': 'clock-sr', 'data-bucket': srBucket(rem) } }, T.clockSr(rem)),
  );
}

/** 초가 흘렀을 때 노드를 그대로 두고 글자만 맞춘다. */
export function updateApprovalCard(el: HTMLElement, card: ApprovalCard, ui: ApprovalUi): void {
  const rem = remainingOf(card, ui.nowMs);
  if (rem === null) return;
  const clock = el.querySelector<HTMLElement>('[data-role=clock]');
  if (!clock) return;
  const vis = clock.querySelector<HTMLElement>('[data-role=clock-vis]');
  if (vis) setText(vis, clockText(card, rem));
  clock.classList.toggle('tick', rem <= 60_000);
  const sr = clock.querySelector<HTMLElement>('[data-role=clock-sr]');
  const bucket = srBucket(rem);
  if (sr && sr.dataset['bucket'] !== bucket) {
    sr.dataset['bucket'] = bucket;
    setText(sr, T.clockSr(rem));
  }
}

// ── 카드 ────────────────────────────────────────────────────────────────

export function renderPendingCard(card: ApprovalCard, ui: ApprovalUi): HTMLElement {
  const rem = remainingOf(card, ui.nowMs);
  const expired = rem !== null && rem <= 0;
  const busy = ui.busy.get(card.requestId);
  const notice = ui.notices.get(card.requestId);
  const titleId = `appr-${card.requestId}-t`;
  const op = card.operationId || '(이름 없음)';

  const approve = h('button', { class: 'btn pri appr-approve', attrs: { type: 'button', 'data-role': 'approve', 'aria-label': T.actionLabel(T.approve, op) }, props: { disabled: busy !== undefined || expired } }, busy === 'approve' ? T.working : T.approve);
  const deny = h('button', { class: 'btn appr-deny', attrs: { type: 'button', 'data-role': 'deny', 'aria-label': T.actionLabel(T.deny, op) }, props: { disabled: busy !== undefined || expired } }, busy === 'deny' ? T.working : T.deny);
  // 누르면 곧바로 끈다 — 앱이 다시 그리기 전의 두 번째 클릭도 막는다.
  const press = (decision: ApprovalDecision) => (): void => {
    if (approve.disabled || deny.disabled) return;
    approve.disabled = true;
    deny.disabled = true;
    ui.onAnswer(card.requestId, decision);
  };
  approve.addEventListener('click', press('approve'));
  deny.addEventListener('click', press('deny'));

  return h(
    'section',
    {
      class: 'appr pending',
      attrs: {
        role: 'group',
        'aria-labelledby': titleId,
        tabindex: -1,
        'aria-busy': busy !== undefined ? 'true' : null,
        'data-refocus': '',
        'data-request-id': card.requestId,
        'data-card-state': 'pending',
        'data-expired': expired ? 'true' : null,
      },
    },
    h(
      'header',
      { class: 'appr-head' },
      h('span', { class: 'ev-ic warn' }, icon('shield', 'l')),
      h('div', { class: 'appr-title' }, h('span', { class: 'cap warn-cap' }, T.title), h('b', { class: 'mono op', attrs: { id: titleId } }, op)),
      h(
        'div',
        { class: 'appr-marks' },
        card.deniedBefore > 0 ? h('span', { class: 'chip err', attrs: { 'data-role': 'prev-denied' } }, T.prevDenied(card.deniedBefore)) : null,
        card.deniedBeforeUnknownInput > 0 ? h('span', { class: 'chip warn', attrs: { 'data-role': 'prev-denied-unknown' } }, T.prevDeniedUnknown(card.deniedBeforeUnknownInput)) : null,
        rem !== null ? (expired ? h('span', { class: 'chip err', attrs: { 'data-role': 'expired' } }, '마감') : clockEl(card, rem)) : null,
      ),
    ),
    h('div', { class: 'appr-body' }, factsColumn(card), claimColumn(card)),
    inputDetails(card.input),
    h(
      'footer',
      { class: 'appr-foot' },
      h('div', { class: 'appr-foot-text' }, h('span', { class: 'appr-hint' }, T.gatewayAgain), expired ? h('span', { class: 'appr-expired', attrs: { role: 'status' } }, T.expired) : null),
      h('div', { class: 'appr-actions' }, deny, approve),
    ),
    notice ? h('p', { class: `appr-notice ${notice.tone}`, attrs: { role: notice.tone === 'err' ? 'alert' : 'status', 'data-role': 'notice' } }, notice.text) : null,
  );
}

/** 끝난 카드에 붙는 "이전에 거부함" 표식. */
export function previousDeniedChips(card: ApprovalCard): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (card.deniedBefore > 0) out.push(h('span', { class: 'chip err', attrs: { 'data-role': 'prev-denied' } }, T.prevDenied(card.deniedBefore)));
  if (card.deniedBeforeUnknownInput > 0) out.push(h('span', { class: 'chip warn', attrs: { 'data-role': 'prev-denied-unknown' } }, T.prevDeniedUnknown(card.deniedBeforeUnknownInput)));
  return out;
}

/** 카드를 다시 그려야 하는지 가르는 값. 초가 흐르는 것은 넣지 않는다(update 가 글자만 바꾼다). */
export function approvalCardSignature(card: ApprovalCard, ui: ApprovalUi | undefined): string {
  const base = `${card.state}:${card.actionable ? 1 : 0}:${card.deniedBefore}:${card.deniedBeforeUnknownInput}`;
  if (!ui || card.state !== 'pending') return base;
  const notice = ui.notices.get(card.requestId);
  const facts = JSON.stringify([card.reason, card.judgement, card.contract, card.operationId, card.deadline?.approximate ?? null, card.deadline === null]);
  return `${base}:ui:${ui.busy.get(card.requestId) ?? '-'}:${isExpired(card, ui.nowMs) ? 'x' : 'o'}:${notice ? `${notice.tone}/${notice.text}` : '-'}:${facts}`;
}
