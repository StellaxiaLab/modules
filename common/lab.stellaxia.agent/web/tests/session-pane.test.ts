// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../src/api/types';
import { emptyMemory } from '../src/data/cards';
import { emptyLedger, ingest } from '../src/data/ledger';
import { SESSION_STATES } from '../src/api/types';
import { buildSessionView } from '../src/data/view';
import type { ComposerModel } from '../src/views/composer';
import { RENDER_WINDOW, createSessionPane, type SessionPane, type SessionPaneModel } from '../src/views/session-pane';
import { createSessionInfo } from '../src/views/session-info';
import { pend, raw, snap } from './helpers';

const NOW = 1_700_000_000_000;

function viewOf(snapshot: SessionSnapshot, lines: Array<Record<string, unknown>> = []) {
  const ledger = ingest(emptyLedger(snapshot.session_id), lines).state;
  return buildSessionView({ snapshot, ledger, memory: emptyMemory(), handled: new Set(), nowMs: NOW });
}

function composer(over: Partial<ComposerModel> = {}): ComposerModel {
  return { sessionId: 's-1', draft: '', resetKey: 0, locked: false, placeholder: '이어서 물어보세요', lockReason: null, sending: false, footNote: '', notice: null, ...over };
}

function model(snapshot: SessionSnapshot, lines: Array<Record<string, unknown>> = [], over: Partial<SessionPaneModel> = {}): SessionPaneModel {
  return { sessionId: snapshot.session_id, title: snapshot.topic ?? snapshot.session_id, viewer: 'alice', view: viewOf(snapshot, lines), loadProblem: null, composer: composer({ sessionId: snapshot.session_id }), ...over };
}

function mount(): { pane: SessionPane; clicks: string[] } {
  const clicks: string[] = [];
  const pane = createSessionPane({ onSubmit: () => {}, onDraft: () => {}, onCancelClick: () => clicks.push('cancel') });
  document.body.replaceChildren(pane.el);
  return { pane, clicks };
}

/** jsdom 에는 레이아웃이 없다 — 스크롤 지표를 시험이 쥔다. */
function fakeLayout(log: HTMLElement, clientHeight = 600, perLine = 40) {
  const state = { scrollTop: 0 };
  Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => Math.max(clientHeight, log.querySelectorAll('.line').length * perLine) });
  Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => state.scrollTop, set: (v: number) => void (state.scrollTop = v) });
  return {
    state,
    scrollTo(top: number) {
      state.scrollTop = top;
      log.dispatchEvent(new Event('scroll'));
    },
  };
}

const ENTRY_KINDS: Array<[string, Record<string, unknown>]> = [
  ['user', { text: '안녕' }],
  ['model', { sent_bytes: 1024 }],
  ['call', { subject: 'op.read', status: 'ok' }],
  ['planned', { subject: 'op.restart', status: 'planned' }],
  ['external', { server: 'fs', subject: 'read', status: 'ok' }],
  ['approval', { request_id: 'r1', operation_id: 'op.restart' }],
  ['approved', { request_id: 'r1' }],
  ['denied', { request_id: 'r2' }],
  ['assistant', { text: '답' }],
  ['done', {}],
  ['error', { text: 'x', error_code: 'STEP_LIMIT' }],
  ['cancelled', {}],
  ['mystery', { text: '?' }],
];

beforeEach(() => document.body.replaceChildren());

describe('화면 3 — 대화 영역', () => {
  it('대화 영역은 role=log · aria-live=polite · tabindex=0 · 이름이 있다', () => {
    const { pane } = mount();
    pane.update(model(snap({ session_id: 's-1' })));
    expect(pane.log.getAttribute('role')).toBe('log');
    expect(pane.log.getAttribute('aria-live')).toBe('polite');
    expect(pane.log.getAttribute('tabindex')).toBe('0');
    expect(pane.log.getAttribute('aria-label')).toBe('대화 기록');
  });

  it('줄 종류 12종 + 모르는 종류를 모두 그린다', () => {
    const { pane } = mount();
    const lines = ENTRY_KINDS.map(([kind, extra], i) => raw(i + 1, kind, extra));
    pane.update(model(snap({ session_id: 's-1', pending_approvals: [] }), lines));
    expect(pane.renderedSeqs()).toHaveLength(13);
    const kinds = Array.from(pane.log.querySelectorAll('.line')).map((l) => l.getAttribute('data-kind'));
    expect(kinds).toEqual(['user', 'model', 'call', 'planned', 'external', 'approval', 'approved', 'denied', 'assistant', 'done', 'error', 'cancelled', 'unknown']);
  });

  it('빈 세션은 안내(자율성별 문구)를 보이고 기록이 오면 사라진다', () => {
    const { pane } = mount();
    pane.update(model(snap({ session_id: 's-1', autonomy: 'plan' })));
    expect(pane.el.querySelector('.empty')?.textContent).toContain('무엇을 도와드릴까요?');
    expect(pane.el.querySelector('.empty-hint')?.textContent).toContain('plan 세션은 읽기만 하고 제안합니다');
    pane.update(model(snap({ session_id: 's-1' }), [raw(1, 'user', { text: 'x' })]));
    expect((pane.el.querySelector('.empty') as HTMLElement).hidden).toBe(true);
  });

  it('머리: 제목 · session id · 상태 칩 · 자율성 "열 때 고정" · 시뮬레이션 표지', () => {
    const { pane } = mount();
    pane.update(model(snap({ session_id: 's-1', topic: '로그 정리', autonomy: 'ask', simulate: true })));
    expect(pane.el.querySelector('.ses-title')?.textContent).toBe('로그 정리');
    expect(pane.el.querySelector('.ses-sid')?.textContent).toBe('session · s-1');
    expect(pane.el.querySelector('[data-role=state-chip]')?.textContent).toBe('대기');
    expect(pane.el.querySelector('[data-role=autonomy-chip]')?.textContent).toBe('ask · 열 때 고정');
    expect(pane.el.textContent).toContain('시뮬레이션 · 호출 없음');
  });

  it('상태 7종: 취소 버튼은 종료 상태에서 숨고, 마지막 오류 칩은 상태 옆에 (I20)', () => {
    const { pane } = mount();
    const rows: Record<string, { cancel: boolean; label: string }> = {
      idle: { cancel: true, label: '대기' },
      running: { cancel: true, label: '진행 중' },
      'waiting-approval': { cancel: true, label: '승인 대기' },
      done: { cancel: false, label: '끝남' },
      cancelled: { cancel: false, label: '취소됨' },
      failed: { cancel: false, label: '실패' },
      archived: { cancel: false, label: '보관됨' },
    };
    expect(Object.keys(rows).sort()).toEqual([...SESSION_STATES].sort());
    for (const state of SESSION_STATES) {
      pane.update(model(snap({ session_id: 's-1', state }), [raw(1, 'user'), raw(2, 'error', { text: 'x', error_code: 'MODEL_UNAVAILABLE' })]));
      const want = rows[state] as { cancel: boolean; label: string };
      expect((pane.el.querySelector('[data-role=cancel]') as HTMLElement).hidden).toBe(!want.cancel);
      expect(pane.el.querySelector('[data-role=state-chip]')?.textContent).toBe(want.label);
    }
    // 오류 칩: idle·done·failed·archived 는 보이고 진행 중·승인 대기·취소됨은 숨긴다
    const chipHidden: Record<string, boolean> = {};
    for (const state of SESSION_STATES) {
      pane.update(model(snap({ session_id: 's-1', state }), [raw(1, 'error', { text: 'x', error_code: 'TIME_LIMIT' })]));
      chipHidden[state] = !!(pane.el.querySelector('[data-role=last-error]') as HTMLElement).hidden;
    }
    expect(chipHidden).toEqual({ idle: false, running: true, 'waiting-approval': true, done: false, cancelled: true, failed: false, archived: false });
    pane.update(model(snap({ session_id: 's-1', state: 'idle' }), [raw(1, 'error', { text: 'x', error_code: 'TIME_LIMIT' })]));
    expect(pane.el.querySelector('[data-role=last-error]')?.textContent).toBe('TIME_LIMIT');
  });

  it('취소 버튼을 누르면 앱에 알린다 (확인창은 앱이 연다)', () => {
    const { pane, clicks } = mount();
    pane.update(model(snap({ session_id: 's-1', state: 'running' })));
    (pane.el.querySelector('[data-role=cancel]') as HTMLButtonElement).click();
    expect(clicks).toEqual(['cancel']);
  });

  it('진행 중에는 "생각 중" 표시가 보이고 스크린 리더에는 읽히지 않는다', () => {
    const { pane } = mount();
    pane.update(model(snap({ session_id: 's-1', state: 'running' })));
    const thinking = pane.el.querySelector('.thinking') as HTMLElement;
    expect(thinking.hidden).toBe(false);
    expect(thinking.getAttribute('aria-hidden')).toBe('true');
    pane.update(model(snap({ session_id: 's-1', state: 'idle' })));
    expect(thinking.hidden).toBe(true);
  });

  it('읽지 못했으면 이유를 role=alert 로 말하고 입력을 맡기지 않는다', () => {
    const { pane } = mount();
    pane.update({ sessionId: 's-9', title: 's-9', viewer: 'alice', view: null, loadProblem: '세션을 찾을 수 없습니다.', composer: composer({ sessionId: 's-9', locked: true }) });
    expect(pane.el.querySelector('[role=alert]')?.textContent).toBe('세션을 찾을 수 없습니다.');
    expect(pane.composer.textarea.disabled).toBe(true);
  });

  it('차례 줄: 호출은 차례 몫, 토큰은 세션 누적 (DC-26)', () => {
    const { pane } = mount();
    const lines = [raw(1, 'user'), raw(2, 'model'), raw(3, 'model'), raw(4, 'done'), raw(5, 'user'), raw(6, 'model'), raw(7, 'done')];
    pane.update(model(snap({ session_id: 's-1', usage: { input_tokens: 14000, output_tokens: 4200, cache_read_tokens: 0, cache_write_tokens: 0 } }), lines));
    const dones = Array.from(pane.log.querySelectorAll('[data-kind=done]')).map((l) => l.textContent);
    expect(dones[0]).toContain('모델 호출 2회');
    expect(dones[1]).toContain('모델 호출 1회');
    expect(dones[1]).toContain('세션 누적 18.2k 토큰');
    expect(dones[0]).not.toContain('세션 누적');
  });

  it('대기 승인이 있으면 "승인이 필요합니다" 자리표시를 보인다 (카드는 G2)', () => {
    const { pane } = mount();
    const snapshot = snap({ session_id: 's-1', state: 'waiting-approval', pending_approvals: [pend('r1', 'op.restart')] });
    pane.update(model(snapshot, [raw(1, 'user'), raw(2, 'approval', { request_id: 'r1', operation_id: 'op.restart' })]));
    expect(pane.log.querySelector('.approval-slot.pending')?.textContent).toContain('승인이 필요합니다');
    // 승인이 처리되면 같은 줄이 새 상태로 바뀐다
    pane.update(model(snap({ session_id: 's-1', state: 'running' }), [raw(1, 'user'), raw(2, 'approval', { request_id: 'r1', operation_id: 'op.restart' }), raw(3, 'approved', { request_id: 'r1' })]));
    expect(pane.log.querySelector('.approval-slot')?.getAttribute('data-card-state')).toBe('approved');
  });
});

describe('스크롤 — 읽던 줄 자리 유지·바닥 따라가기 (GAP-4)', () => {
  function userLines(from: number, to: number): Array<Record<string, unknown>> {
    return Array.from({ length: to - from + 1 }, (_, i) => raw(from + i, 'user', { text: `줄 ${from + i}` }));
  }

  it('같은 seq 의 줄은 다시 만들지 않는다 (증분 갱신)', () => {
    const { pane } = mount();
    const snapshot = snap({ session_id: 's-1' });
    pane.update(model(snapshot, userLines(1, 3)));
    const first = pane.log.querySelector('[data-seq="1"]');
    pane.update(model(snapshot, userLines(1, 5)));
    expect(pane.log.querySelector('[data-seq="1"]')).toBe(first);
    expect(pane.renderedSeqs()).toEqual([1, 2, 3, 4, 5]);
  });

  it('맨 아래에 있으면 새 줄을 따라간다', () => {
    const { pane } = mount();
    const layout = fakeLayout(pane.log);
    const snapshot = snap({ session_id: 's-1' });
    pane.update(model(snapshot, userLines(1, 30)));
    expect(layout.state.scrollTop).toBe(30 * 40 - 600); // 바닥
    pane.update(model(snapshot, userLines(1, 36)));
    expect(layout.state.scrollTop).toBe(36 * 40 - 600);
    expect(pane.follower.following).toBe(true);
  });

  it('올려 읽는 중이면 새 줄이 와도 읽던 자리(scrollTop)를 건드리지 않고 "새 글 N줄"을 알린다', () => {
    const { pane } = mount();
    const layout = fakeLayout(pane.log);
    const snapshot = snap({ session_id: 's-1' });
    pane.update(model(snapshot, userLines(1, 30)));
    layout.scrollTo(200); // 위로 올려 읽는다
    expect(pane.follower.following).toBe(false);
    pane.update(model(snapshot, userLines(1, 34)));
    expect(layout.state.scrollTop).toBe(200);
    const bar = pane.el.querySelector('[data-role=newbar]') as HTMLButtonElement;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toBe('새 글 4줄 · 맨 아래로');
    pane.update(model(snapshot, userLines(1, 35)));
    expect(layout.state.scrollTop).toBe(200);
    expect(bar.textContent).toBe('새 글 5줄 · 맨 아래로');
    // 눌러서 바닥으로 — 다시 따라간다
    bar.click();
    expect(layout.state.scrollTop).toBe(35 * 40 - 600);
    expect(bar.hidden).toBe(true);
    expect(pane.follower.following).toBe(true);
  });

  it('스스로 바닥까지 내려오면 알림이 사라지고 다시 따라간다', () => {
    const { pane } = mount();
    const layout = fakeLayout(pane.log);
    const snapshot = snap({ session_id: 's-1' });
    pane.update(model(snapshot, userLines(1, 30)));
    layout.scrollTo(100);
    pane.update(model(snapshot, userLines(1, 33)));
    expect((pane.el.querySelector('[data-role=newbar]') as HTMLElement).hidden).toBe(false);
    layout.scrollTo(33 * 40 - 600 - 10);
    expect((pane.el.querySelector('[data-role=newbar]') as HTMLElement).hidden).toBe(true);
    pane.update(model(snapshot, userLines(1, 34)));
    expect(layout.state.scrollTop).toBe(34 * 40 - 600);
  });

  it('다른 세션을 열면 바닥에서 시작하고 이전 세션의 줄은 지운다', () => {
    const { pane } = mount();
    const layout = fakeLayout(pane.log);
    pane.update(model(snap({ session_id: 's-1' }), userLines(1, 30)));
    layout.scrollTo(0);
    pane.update(model(snap({ session_id: 's-2' }), userLines(1, 20)));
    expect(pane.renderedSeqs()).toHaveLength(20);
    expect(layout.state.scrollTop).toBe(20 * 40 - 600);
    expect(pane.log.textContent).not.toContain('줄 30');
  });

  it('오래된 줄은 쪽으로 접혀 있고, 더 보기를 누르면 위에 붙으며 읽던 자리가 그대로다', () => {
    const { pane } = mount();
    const layout = fakeLayout(pane.log);
    const snapshot = snap({ session_id: 's-1' });
    pane.update(model(snapshot, userLines(1, 450)));
    expect(pane.renderedSeqs()).toHaveLength(RENDER_WINDOW);
    expect(pane.renderedSeqs()[0]).toBe(251);
    const older = pane.el.querySelector('[data-role=older]') as HTMLButtonElement;
    expect(older.hidden).toBe(false);
    expect(older.textContent).toBe('이전 줄 250개 더 보기');
    layout.scrollTo(30); // 위쪽을 읽는 중
    const before = layout.state.scrollTop;
    older.click();
    expect(pane.renderedSeqs()).toHaveLength(400);
    expect(pane.renderedSeqs()[0]).toBe(51);
    // 늘어난 높이(200줄 × 40px)만큼 내려와 읽던 줄이 화면에서 움직이지 않는다
    expect(layout.state.scrollTop).toBe(before + 200 * 40);
    expect(older.textContent).toBe('이전 줄 50개 더 보기');
    older.click();
    expect(pane.renderedSeqs()).toHaveLength(450);
    expect(older.hidden).toBe(true);
  });
});

describe('세션 정보 (오른쪽)', () => {
  it('응답의 값을 보인다: 열 때 값 표시 · 토큰 · 나간 양 · 환산 없음', () => {
    const info = createSessionInfo();
    document.body.append(info.el);
    const snapshot = snap({ session_id: 's-1', autonomy: 'ask', provider: 'anthropic', model: 'test-model', usage: { input_tokens: 14060, output_tokens: 4162, cache_read_tokens: 9840, cache_write_tokens: 0 } });
    info.update({ view: viewOf(snapshot, [raw(1, 'user'), raw(2, 'model', { sent_bytes: 12698 }), raw(3, 'model', { sent_bytes: 12698 })]) });
    const text = info.el.textContent ?? '';
    expect(text).toContain('ask (열 때 고정)');
    expect(text).toContain('anthropic/test-model (열 때 값)');
    expect(text).toContain('14,060');
    expect(text).toContain('9,840');
    expect(text).toContain('2 / 24');
    expect(text).toContain('24.8');
    expect(text).toContain('토큰으로만');
    expect(text).not.toMatch(/\$|원\b|USD/);
  });
});
