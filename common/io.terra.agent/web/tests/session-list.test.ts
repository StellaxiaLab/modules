// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { presentReadiness } from '../src/app/readiness-model';
import { buildInbox, buildRows, tabCounts } from '../src/app/session-rows';
import { composeReadiness } from '../src/data/readiness';
import { emptyLedger, ingest } from '../src/data/ledger';
import { emptyMemory } from '../src/data/cards';
import type { DataState } from '../src/data/store';
import { createNewSession } from '../src/views/new-session';
import { createSidebar, type SidebarModel } from '../src/views/sidebar';
import { pend, raw, snap } from './helpers';

const NOW = 1_700_000_000_000;

function state(...snaps: ReturnType<typeof snap>[]): DataState {
  return { viewer: 'alice', owned: snaps, sessions: {}, listFailure: null };
}

const ALL_STATES = ['idle', 'running', 'waiting-approval', 'done', 'cancelled', 'failed', 'archived'] as const;

describe('화면 2 — 세션 목록 행', () => {
  it('종료 탭은 done·cancelled·failed·archived 이다 (GAP-1)', () => {
    const s = state(...ALL_STATES.map((st) => snap({ session_id: `s-${st}`, state: st })));
    expect(buildRows(s, 'mine', null, NOW).map((r) => r.state)).toEqual(['idle', 'running', 'waiting-approval']);
    expect(buildRows(s, 'ended', null, NOW).map((r) => r.state)).toEqual(['done', 'cancelled', 'failed', 'archived']);
    expect(tabCounts(s)).toEqual({ mine: 3, ended: 4 });
  });

  it('행: 주제(없으면 id) · 상태 · 자율성 · 상대 시각 · 선택 표시', () => {
    const s = state(snap({ session_id: 'a', topic: '로그 정리', updated_ms: NOW - 12 * 60_000 }), snap({ session_id: 'b' }));
    const rows = buildRows(s, 'mine', 'b', NOW);
    expect(rows[0]).toMatchObject({ id: 'a', title: '로그 정리', stateLabel: '대기', autonomy: 'plan', time: '12분 전', selected: false });
    expect(rows[1]).toMatchObject({ id: 'b', title: 'b', selected: true });
  });

  it('마지막 오류 코드 칩: 스냅샷의 last_error_code, 없으면 이미 읽은 기록의 error 줄 — 영어 문장에서 추측하지 않는다 (GAP-7)', () => {
    const withCode = snap({ session_id: 'c1', state: 'failed', last_error: 'model call failed', last_error_code: 'MODEL_UNAVAILABLE' });
    const sentenceOnly = snap({ session_id: 'c2', state: 'idle', last_error: 'stopped: this turn ran past its limit of 900s' });
    const fromRecord = snap({ session_id: 'c3', state: 'idle', last_error: 'stopped: step limit' });
    const ledger = ingest(emptyLedger('c3'), [raw(1, 'user'), raw(2, 'error', { text: 'step limit', error_code: 'STEP_LIMIT' })]).state;
    const s: DataState = {
      viewer: 'alice',
      owned: [withCode, sentenceOnly, fromRecord],
      sessions: { c3: { snapshot: fromRecord, ledger, memory: emptyMemory(), handled: new Set() } },
      listFailure: null,
    };
    const codes = Object.fromEntries([...buildRows(s, 'mine', null, NOW), ...buildRows(s, 'ended', null, NOW)].map((r) => [r.id, r.errorCode]));
    expect(codes).toEqual({ c1: 'MODEL_UNAVAILABLE', c2: null, c3: 'STEP_LIMIT' });
  });

  it('진행 중·승인 대기에서는 오류 칩을 보이지 않는다', () => {
    const s = state(snap({ session_id: 'r', state: 'running', last_error_code: 'TIME_LIMIT' }));
    expect(buildRows(s, 'mine', null, NOW)[0]?.errorCode).toBeNull();
  });
});

describe('인박스 — 다른 세션의 대기 승인', () => {
  it('열어 둔 세션의 것은 빼고 나머지를 모은다', () => {
    const s = state(
      snap({ session_id: 'x', topic: 'X', state: 'waiting-approval', pending_approvals: [pend('r1', 'io.terra.node.modules.restart', { expires_ms: NOW + 270_000 })] }),
      snap({ session_id: 'y', state: 'waiting-approval', pending_approvals: [pend('r2', 'op.two')] }),
    );
    // 모듈 소유 필터는 store 가 한다 — 여기서는 owned 만 받는다
    const items = s.owned.flatMap((x) => (x.pending_approvals ?? []).map((approval) => ({ sessionId: x.session_id, topic: x.topic, approval })));
    const rows = buildInbox(items, 'y', NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 'x', title: 'X', operation: 'io.terra.node.modules.restart', left: '4:30 남음' });
    expect(buildInbox(items, null, NOW)[1]?.left).toBeNull(); // expires_ms(M-3)가 없으면 근사하지 않는다
  });
});

function sidebarModel(over: Partial<SidebarModel> = {}): SidebarModel {
  return {
    readiness: presentReadiness(
      composeReadiness({
        status: { ok: true, status: 200, data: { status: 'ok', version: '0.1.0', delegate_door: true } },
        models: { ok: true, status: 200, data: { default: 'a', providers: [{ provider: 'a', model: 'm', registered: true, default: true }] } },
        credentials: { ok: true, status: 200, data: { registered: true, principal: 'alice', expired: false } },
      }),
    ),
    inbox: [],
    tab: 'mine',
    rows: [],
    counts: { mine: 0, ended: 0 },
    canOpenNew: true,
    newingActive: false,
    listProblem: null,
    loading: false,
    ...over,
  };
}

describe('화면 2 — 사이드바', () => {
  it('탭은 role=tablist/tab 이고 aria-selected 가 따라간다, 화살표로 옮긴다', () => {
    const tabs: string[] = [];
    const sb = createSidebar({ onTab: (t) => tabs.push(t) });
    document.body.append(sb.el);
    sb.update(sidebarModel());
    const list = sb.el.querySelector('[role=tablist]');
    expect(list?.getAttribute('aria-label')).toBe('세션 목록');
    const [mine, ended] = Array.from(sb.el.querySelectorAll<HTMLButtonElement>('[role=tab]'));
    expect(mine?.getAttribute('aria-selected')).toBe('true');
    expect(ended?.getAttribute('aria-selected')).toBe('false');
    expect(mine?.tabIndex).toBe(0);
    expect(ended?.tabIndex).toBe(-1);
    ended?.click();
    mine?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs).toEqual(['ended', 'ended']);
    expect(sb.el.querySelector('[role=tabpanel]')).not.toBeNull();
  });

  it('행은 링크(#/s/id)이고 같은 세션이면 노드를 다시 만들지 않는다 (초점 유지)', () => {
    const sb = createSidebar({ onTab: () => {} });
    document.body.append(sb.el);
    const row = { id: 'abc', title: '제목', state: 'idle', stateLabel: '대기', tone: 'idle' as const, autonomy: 'plan', errorCode: null, time: '방금', selected: false };
    sb.update(sidebarModel({ rows: [row] }));
    const a = sb.el.querySelector<HTMLAnchorElement>('a.sess');
    expect(a?.getAttribute('href')).toBe('#/s/abc');
    a?.focus();
    expect(document.activeElement).toBe(a);
    sb.update(sidebarModel({ rows: [{ ...row, selected: true, time: '1분 전', errorCode: 'STEP_LIMIT' }] }));
    expect(sb.el.querySelector('a.sess')).toBe(a);
    expect(document.activeElement).toBe(a);
    expect(a?.getAttribute('aria-current')).toBe('page');
    expect(a?.textContent).toContain('STEP_LIMIT');
    expect(a?.textContent).toContain('1분 전');
  });

  it('행 순서가 바뀌어도 노드가 따라 움직인다', () => {
    const sb = createSidebar({ onTab: () => {} });
    document.body.append(sb.el);
    const mk = (id: string) => ({ id, title: id, state: 'idle', stateLabel: '대기', tone: 'idle' as const, autonomy: 'plan', errorCode: null, time: '', selected: false });
    sb.update(sidebarModel({ rows: [mk('a'), mk('b'), mk('c')] }));
    const nodes = Array.from(sb.el.querySelectorAll('a.sess'));
    sb.update(sidebarModel({ rows: [mk('c'), mk('a')] }));
    const after = Array.from(sb.el.querySelectorAll('a.sess'));
    expect(after).toEqual([nodes[2], nodes[0]]);
  });

  it('빈 목록 안내는 탭마다 다르고, 목록을 못 읽으면 그 이유를 말한다', () => {
    const sb = createSidebar({ onTab: () => {} });
    document.body.append(sb.el);
    sb.update(sidebarModel());
    expect(sb.el.querySelector('.list-note')?.textContent).toBe('열린 세션이 없습니다. 새 세션을 여세요.');
    sb.update(sidebarModel({ tab: 'ended' }));
    expect(sb.el.querySelector('.list-note')?.textContent).toBe('종료된 세션이 없습니다.');
    sb.update(sidebarModel({ listProblem: '연결할 수 없습니다.' }));
    expect(sb.el.querySelector('.list-note')?.textContent).toBe('연결할 수 없습니다.');
  });

  it('인박스: 다른 세션의 승인 대기를 "승인이 필요합니다"로 알리고 그 세션으로 잇는다', () => {
    const sb = createSidebar({ onTab: () => {} });
    document.body.append(sb.el);
    sb.update(sidebarModel({ inbox: [{ key: 'x:r1', sessionId: 'x', title: '재시작', operation: 'op.restart', left: '4:30 남음' }] }));
    const inbox = sb.el.querySelector<HTMLElement>('[data-role=inbox]');
    expect(inbox?.hidden).toBe(false);
    const link = inbox?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('#/s/x');
    expect(link?.textContent).toContain('승인이 필요합니다');
    expect(link?.textContent).toContain('op.restart');
    sb.update(sidebarModel());
    expect(inbox?.hidden).toBe(true);
  });

  it('세션 제목의 HTML·{{…}} 는 글자로 나온다', () => {
    const sb = createSidebar({ onTab: () => {} });
    document.body.append(sb.el);
    const evil = '<img src=x onerror=alert(1)> {{constructor}} <b>굵게</b>';
    sb.update(sidebarModel({ rows: [{ id: 'e', title: evil, state: 'idle', stateLabel: '대기', tone: 'idle', autonomy: 'plan', errorCode: null, time: '', selected: false }] }));
    expect(sb.el.querySelector('.sess-title')?.textContent).toBe(evil);
    expect(sb.el.querySelector('img')).toBeNull();
    expect(sb.el.querySelector('.sess-title b')).toBeNull();
  });

  it('준비가 안 되면 새 세션 링크가 꺼진다 (aria-disabled)', () => {
    const sb = createSidebar({ onTab: () => {} });
    document.body.append(sb.el);
    sb.update(sidebarModel({ canOpenNew: false }));
    const link = sb.el.querySelector<HTMLElement>('[data-role=new-session]');
    expect(link?.getAttribute('aria-disabled')).toBe('true');
    expect(link?.tabIndex).toBe(-1);
  });
});

describe('새 세션 열기 (GAP-9, G1)', () => {
  it('자율성은 plan 만 켜진다 (D-7) — 나머지는 이유와 함께 꺼져 있다', () => {
    const view = createNewSession({ onSubmit: () => {}, onClose: () => {} });
    document.body.append(view.el);
    view.update({ sessionId: 's-abc', creating: false, canOpen: true, blockedReason: null, error: null });
    const radios = Array.from(view.el.querySelectorAll<HTMLInputElement>('input[type=radio]'));
    expect(radios.map((r) => [r.value, r.disabled, r.checked])).toEqual([
      ['plan', false, true],
      ['ask', true, false],
      ['auto', true, false],
      ['unattended', true, false],
    ]);
    expect(view.el.textContent).toContain('session_id 자동 · s-abc');
    expect(view.el.querySelector('fieldset legend')?.textContent).toContain('열 때 고정');
  });

  it('제목(topic)을 실어 보내고, 만드는 중에는 버튼이 꺼진다', () => {
    const seen: Array<{ topic: string }> = [];
    const view = createNewSession({ onSubmit: (i) => seen.push(i), onClose: () => {} });
    document.body.append(view.el);
    view.update({ sessionId: 's-1', creating: false, canOpen: true, blockedReason: null, error: null });
    const topic = view.el.querySelector<HTMLInputElement>('#new-topic') as HTMLInputElement;
    expect(topic.maxLength).toBe(200);
    topic.value = '  새벽 로그 정리  ';
    view.el.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(seen).toEqual([{ topic: '새벽 로그 정리' }]);
    view.update({ sessionId: 's-1', creating: true, canOpen: true, blockedReason: null, error: null });
    expect(view.el.querySelector<HTMLButtonElement>('[data-role=open-session]')?.disabled).toBe(true);
  });

  it('준비가 안 됐으면 이유를 보이고 열 수 없다, 실패하면 그 문구를 보인다', () => {
    const view = createNewSession({ onSubmit: () => {}, onClose: () => {} });
    document.body.append(view.el);
    view.update({ sessionId: 's-1', creating: false, canOpen: false, blockedReason: '새 세션을 열 수 없습니다 — 모델: 등록된 기본 모델이 없습니다', error: null });
    expect(view.el.querySelector<HTMLButtonElement>('[data-role=open-session]')?.disabled).toBe(true);
    expect(view.el.textContent).toContain('등록된 기본 모델이 없습니다');
    view.update({ sessionId: 's-1', creating: false, canOpen: true, blockedReason: null, error: '모델이 없습니다' });
    expect(view.el.querySelector('[role=alert]')?.textContent).toBe('모델이 없습니다');
  });
});

