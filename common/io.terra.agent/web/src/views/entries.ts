// 화면 3 — 기록 줄 렌더. entry 12종 + 모르는 종류(unknown)를 한 줄씩 그린다(계획서 §3.2, 요구 §5.2).
// 규칙: `text` 가 있으면 발화, 없으면 사건. 모든 동적 텍스트는 텍스트 노드로만 들어간다(I1·I7) — 모델이 쓴 "승인하겠습니다"는
// 평문 말풍선일 뿐 버튼처럼 그리지 않는다. 링크를 만들지 않는다.
//
// 확장 지점(WP-5): defaultEntryRenderers 의 `approval` 을 승인 카드로 바꿔 끼운다. 카드가 시간에 따라 변하면(카운트다운)
// signature 를 돌려 줄을 다시 그리게 한다. 컨텍스트(EntryContext)에 합성된 카드(ApprovalCard)가 들어 있다.

import type {
  ApprovalEntry,
  ApprovedEntry,
  AssistantEntry,
  CallEntry,
  CancelledEntry,
  DeniedEntry,
  DoneEntry,
  Entry,
  ErrorEntry,
  ExternalEntry,
  ModelEntry,
  PlannedEntry,
  UnknownEntry,
  UserEntry,
} from '../api/types';
import { formatCount, formatKB, formatTokens } from '../app/format';
import { h, icon } from '../app/dom';
import type { ApprovalCard, CardState } from '../data/cards';
import { describeCallCode, describeCode } from '../data/errors';
import { approvalCardSignature, previousDeniedChips, renderPendingCard, updateApprovalCard, type ApprovalUi } from './approval-card';

export interface EntryContext {
  /** 소유자 principal. 본인의 user 줄은 오른쪽 말풍선. */
  viewer: string | null;
  /** model 줄 seq → 차례 안 순번(#n). */
  ordinals: ReadonlyMap<number, number>;
  /** request_id → 합성된 승인 카드. */
  cards: ReadonlyMap<string, ApprovalCard>;
  /** done 줄 seq → 그 차례의 모델 호출 수. */
  turnCalls: ReadonlyMap<number, number>;
  /** 가장 마지막 done 줄의 seq — 세션 누적 토큰은 이 줄에만 붙인다(차례별 토큰 값은 없다). */
  lastDoneSeq: number | null;
  /** 세션 누적 입력+출력 토큰. */
  tokens: number;
  /** 승인 카드가 앱에서 받는 시계·답하는 길. 없으면 카드는 답할 길이 없어 컨트롤을 그리지 않는다. */
  approvals?: ApprovalUi;
}

export interface EntryRenderer<E extends Entry> {
  render(entry: E, ctx: EntryContext): HTMLElement;
  /** 줄을 다시 그려야 하는지 가르는 값. 바뀌지 않는 줄은 없음(빈 문자열). */
  signature?(entry: E, ctx: EntryContext): string;
  /** 서명이 같아 노드를 그대로 둘 때 불린다 — 초점을 잃지 않게 글자만 맞춘다(카운트다운). */
  update?(el: HTMLElement, entry: E, ctx: EntryContext): void;
}

export type EntryRenderers = { [K in Entry['kind']]: EntryRenderer<Extract<Entry, { kind: K }>> };

const text = (value: string | undefined): string => (typeof value === 'string' ? value : '');

function chip(kind: string, label: string, extra = ''): HTMLElement {
  return h('span', { class: `chip ${kind}${extra ? ` ${extra}` : ''}` }, label);
}

/** 접힌 상세. 항목이 없으면 null. */
function details(summary: string, rows: ReadonlyArray<[string, string | null]>, className = ''): HTMLElement | null {
  const shown = rows.filter((r): r is [string, string] => r[1] !== null && r[1] !== '');
  if (shown.length === 0) return null;
  return h(
    'details',
    { class: `ev-detail ${className}`.trim() },
    h('summary', {}, summary),
    h('dl', { class: 'kv' }, ...shown.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'mono-wrap' }, v)])),
  );
}

function line(entry: Entry, ...children: Array<HTMLElement | null>): HTMLElement {
  return h('div', { class: 'line', attrs: { 'data-seq': entry.seq, 'data-kind': entry.kind } }, ...children);
}

// ── 발화 ────────────────────────────────────────────────────────────────

function renderUser(entry: UserEntry, ctx: EntryContext): HTMLElement {
  const mine = ctx.viewer !== null && entry.author === ctx.viewer;
  return line(
    entry,
    h(
      'div',
      { class: mine ? 'me' : 'other' },
      mine ? null : h('span', { class: 'author' }, entry.author_label || entry.author),
      h('div', { class: 'body' }, text(entry.text)),
    ),
  );
}

function renderAssistant(entry: AssistantEntry): HTMLElement {
  return line(
    entry,
    h('div', { class: 'ai' }, h('div', { class: 'av' }, icon('spark', 's')), h('div', { class: 'tx' }, h('div', { class: 'body' }, text(entry.text)))),
  );
}

// ── 사건 ────────────────────────────────────────────────────────────────

function renderModel(entry: ModelEntry, ctx: EntryContext): HTMLElement {
  const n = ctx.ordinals.get(entry.seq);
  const who = [entry.provider, entry.model].filter((v): v is string => typeof v === 'string' && v !== '').join('/');
  return line(
    entry,
    h(
      'div',
      { class: 'ev' },
      icon('cube', 's'),
      h('span', {}, '모델을 불렀습니다', entry.note ? h('span', { class: 'mono dim' }, ` · ${entry.note}`) : null, who ? h('span', { class: 'mono dim' }, ` · ${who}`) : null),
      typeof entry.sent_bytes === 'number' ? h('span', { class: 'mono' }, `${formatKB(entry.sent_bytes)} KB 노드 밖으로`) : null,
      n !== undefined ? h('span', { class: 'r' }, h('span', { class: 'mono dim' }, `#${n}`)) : null,
    ),
  );
}

type CallLike = CallEntry | PlannedEntry | ExternalEntry;

function callStatus(entry: CallLike): { icon: string; tone: string; label: string; iconTone: string } {
  if (entry.kind === 'planned') return { icon: 'eye', tone: 'warn', label: '제안 · 실행 안 됨', iconTone: 'warn' };
  const status = text(entry.status);
  if (status === 'ok') return { icon: 'check', tone: 'ok', label: 'ok', iconTone: 'ok' };
  if (status === 'error') return { icon: 'warn', tone: 'err', label: 'error', iconTone: 'err' };
  if (status === 'refused') {
    // 거절은 오류가 아니다 — plan 의 제안이거나 정책의 거절이다.
    return text(entry.decision) === 'plan'
      ? { icon: 'eye', tone: 'warn', label: '제안 · 실행 안 됨', iconTone: 'warn' }
      : { icon: 'x', tone: 'warn', label: '거절됨 · 실행 안 됨', iconTone: 'warn' };
  }
  return { icon: 'info', tone: 'mut', label: status || '알 수 없음', iconTone: 'mut' };
}

function callDetails(entry: CallLike): HTMLElement | null {
  const code = text((entry as CallEntry).error_code);
  const info = code ? describeCallCode(code) : null;
  return details('상세', [
    ['판정', text(entry.decision) || null],
    ['오류', code ? `${code} — ${info?.message ?? ''}` : null],
    ['모델이 말한 이유 (주장이며 근거가 아닙니다)', text((entry as CallEntry).reason) || null],
    ['모듈의 판정 근거', text((entry as CallEntry).judgement) || null],
    ['trace id', text((entry as CallEntry).trace_id) || null],
    ['메모', text(entry.note) || null],
  ]);
}

function renderCall(entry: CallEntry): HTMLElement {
  const s = callStatus(entry);
  const op = text(entry.subject) || text(entry.operation_id) || '(이름 없음)';
  return line(
    entry,
    h(
      'div',
      { class: 'ev call', attrs: { 'data-status': text(entry.status) } },
      h('span', { class: `ev-ic ${s.iconTone}` }, icon(s.icon, 's')),
      h('span', { class: 'mono op' }, op),
      h('span', { class: 'r' }, chip(s.tone, s.label), entry.error_code ? chip('mut', entry.error_code, 'mono') : null),
    ),
    callDetails(entry),
  );
}

function renderPlanned(entry: PlannedEntry): HTMLElement {
  const op = text(entry.subject) || text(entry.operation_id) || '(이름 없음)';
  return line(
    entry,
    h(
      'div',
      { class: 'ev plan' },
      h('span', { class: 'ev-ic warn' }, icon('eye', 's')),
      h('span', {}, '호출 예정 (시뮬레이션) — ', h('b', {}, '실행되지 않았습니다'), ' · '),
      h('span', { class: 'mono op' }, op),
      h('span', { class: 'r' }, chip('warn', '실행 안 됨')),
    ),
    callDetails(entry),
  );
}

function renderExternal(entry: ExternalEntry): HTMLElement {
  const s = callStatus(entry);
  const op = text(entry.subject) || '(이름 없음)';
  return line(
    entry,
    h(
      'div',
      { class: 'ev external' },
      h('span', { class: `ev-ic ${s.iconTone}` }, icon(s.icon, 's')),
      h('span', {}, '외부 도구 호출 — ', h('b', {}, 'Gateway 감사에 없습니다'), ' · '),
      entry.server ? h('span', { class: 'mono' }, `${entry.server} · `) : null,
      h('span', { class: 'mono op' }, op),
      h('span', { class: 'r' }, typeof entry.result_bytes === 'number' ? h('span', { class: 'mono dim' }, `${formatCount(entry.result_bytes)} B`) : null, chip(s.tone, s.label)),
    ),
    callDetails(entry),
  );
}

// ── 승인 (대기 카드는 approval-card.ts, 끝난 카드는 한 줄) ───────────────────────────────────

const CARD_TEXT: Record<CardState, { label: string; tone: string; text: string }> = {
  pending: { label: '승인 대기', tone: 'warn', text: '승인이 필요합니다' },
  approved: { label: '승인함', tone: 'ok', text: '승인함 — Gateway 판정 대기 (실행됨이 아닙니다)' },
  denied: { label: '거부함', tone: 'err', text: '거부했습니다' },
  'no-answer': { label: '무응답 거부', tone: 'err', text: '응답이 없어 거부되었습니다' },
  'timed-out': { label: '시간 초과', tone: 'err', text: '한 차례 시간이 끝나 승인 질문이 닫혔습니다' },
  cancelled: { label: '취소됨', tone: 'mut', text: '세션이 취소되어 승인 질문이 닫혔습니다' },
  'already-handled': { label: '이미 처리됨', tone: 'mut', text: '이미 처리된 승인입니다' },
};

function renderApproval(entry: ApprovalEntry, ctx: EntryContext): HTMLElement {
  const card = entry.request_id ? ctx.cards.get(entry.request_id) : undefined;
  const state: CardState = card?.state ?? 'already-handled';
  const t = CARD_TEXT[state];
  const op = text(entry.operation_id) || text(entry.subject) || card?.operationId || '';
  if (card && state === 'pending' && ctx.approvals) return line(entry, renderPendingCard(card, ctx.approvals));
  return line(
    entry,
    h(
      'div',
      { class: `ev approval-slot${state === 'pending' ? ' pending' : ''}`, attrs: { 'data-request-id': entry.request_id ?? '', 'data-card-state': state } },
      h('span', { class: `ev-ic ${t.tone}` }, icon('shield', 's')),
      h('span', {}, h('b', {}, t.text), op ? ' · ' : null, op ? h('span', { class: 'mono op' }, op) : null),
      h('span', { class: 'r' }, ...(card ? previousDeniedChips(card) : []), chip(t.tone, t.label)),
    ),
    state === 'pending' ? h('p', { class: 'slot-note' }, '이 화면에서는 이 승인에 답할 수 없습니다. 질문은 한 차례 시간 안에 닫힙니다.') : null,
  );
}

function renderApproved(entry: ApprovedEntry): HTMLElement {
  return line(entry, h('div', { class: 'ev' }, h('span', { class: 'ev-ic ok' }, icon('check', 's')), h('span', {}, '승인했습니다 — Gateway 판정 대기 (실행됨이 아닙니다)')));
}

function renderDenied(entry: DeniedEntry): HTMLElement {
  const noAnswer = text(entry.note).startsWith('no answer within');
  return line(
    entry,
    h('div', { class: 'ev' }, h('span', { class: 'ev-ic err' }, icon('x', 's')), h('span', {}, noAnswer ? '응답이 없어 거부되었습니다' : '거부했습니다')),
  );
}

// ── 차례·오류·취소 ──────────────────────────────────────────────────────

function renderDone(entry: DoneEntry, ctx: EntryContext): HTMLElement {
  const calls = ctx.turnCalls.get(entry.seq);
  const parts = ['차례가 끝났습니다'];
  if (calls !== undefined) parts.push(`모델 호출 ${calls}회`);
  if (entry.seq === ctx.lastDoneSeq) parts.push(`세션 누적 ${formatTokens(ctx.tokens)} 토큰`);
  return line(entry, h('div', { class: 'ev done' }, h('span', {}, parts.join(' · '), h('span', { class: 'dim' }, ' (성공을 뜻하지 않음)'))));
}

function renderError(entry: ErrorEntry): HTMLElement {
  const code = text(entry.error_code);
  const info = code ? describeCode(code) : null;
  const headline = info?.known ? info.message : text(entry.text) || '오류가 났습니다';
  return line(
    entry,
    h(
      'div',
      { class: 'ai error' },
      h('div', { class: 'av err' }, icon('warn', 's')),
      h(
        'div',
        { class: 'tx err' },
        h('span', { class: 'err-head' }, h('b', {}, headline), code ? chip('err', code, 'mono') : null),
        info?.known && text(entry.text) ? h('details', { class: 'ev-detail' }, h('summary', {}, '원문'), h('div', { class: 'mono-wrap' }, text(entry.text))) : null,
      ),
    ),
  );
}

function renderCancelled(entry: CancelledEntry): HTMLElement {
  return line(entry, h('div', { class: 'ev done' }, h('span', {}, '세션이 취소되었습니다 · 입력 불가')));
}

function renderUnknown(entry: UnknownEntry): HTMLElement {
  let raw = '';
  try {
    raw = JSON.stringify(entry.raw, null, 2);
  } catch {
    raw = '(표시할 수 없는 줄)';
  }
  return line(
    entry,
    h(
      'div',
      { class: 'ev unknown' },
      icon('info', 's'),
      h('span', {}, '알 수 없는 종류의 줄입니다', h('span', { class: 'mono dim' }, ` · kind: ${entry.raw_kind || '(없음)'}`)),
      entry.text ? h('span', { class: 'body' }, entry.text) : null,
    ),
    h('details', { class: 'ev-detail' }, h('summary', {}, '원본 보기'), h('pre', { class: 'mono-wrap raw' }, raw)),
  );
}

export const defaultEntryRenderers: EntryRenderers = {
  user: { render: renderUser },
  assistant: { render: renderAssistant },
  model: { render: renderModel },
  call: { render: renderCall },
  planned: { render: renderPlanned },
  external: { render: renderExternal },
  approval: {
    render: renderApproval,
    signature: (entry, ctx) => {
      const card = entry.request_id ? ctx.cards.get(entry.request_id) : undefined;
      return card ? approvalCardSignature(card, ctx.approvals) : 'none';
    },
    update: (el, entry, ctx) => {
      const card = entry.request_id ? ctx.cards.get(entry.request_id) : undefined;
      const section = el.querySelector<HTMLElement>('section.appr');
      if (card && ctx.approvals && section) updateApprovalCard(section, card, ctx.approvals);
    },
  },
  approved: { render: renderApproved },
  denied: { render: renderDenied },
  done: {
    render: renderDone,
    signature: (entry, ctx) => `${ctx.turnCalls.get(entry.seq) ?? '-'}:${entry.seq === ctx.lastDoneSeq ? ctx.tokens : ''}`,
  },
  error: { render: renderError },
  cancelled: { render: renderCancelled },
  unknown: { render: renderUnknown },
};

export function renderEntry(entry: Entry, ctx: EntryContext, renderers: EntryRenderers = defaultEntryRenderers): HTMLElement {
  const r = renderers[entry.kind] as EntryRenderer<Entry>;
  return r.render(entry, ctx);
}

export function entrySignature(entry: Entry, ctx: EntryContext, renderers: EntryRenderers = defaultEntryRenderers): string {
  const r = renderers[entry.kind] as EntryRenderer<Entry>;
  return r.signature ? r.signature(entry, ctx) : '';
}

/** 서명이 같아 노드를 그대로 둘 때 호출한다. */
export function entryUpdate(el: HTMLElement, entry: Entry, ctx: EntryContext, renderers: EntryRenderers = defaultEntryRenderers): void {
  const r = renderers[entry.kind] as EntryRenderer<Entry>;
  r.update?.(el, entry, ctx);
}
