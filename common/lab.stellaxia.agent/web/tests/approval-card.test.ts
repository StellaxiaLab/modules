// @vitest-environment jsdom
// 승인 카드(화면 4·5) — 계약 사실과 모델의 주장을 갈라 그리고, 마감·거부 기억·접근성 규칙을 지킨다.
import { describe, expect, it, vi } from 'vitest';
import { parseEntry, type ApprovalContract, type Entry } from '../src/api/types';
import type { ApprovalCard } from '../src/data/cards';
import type { EntryContext } from '../src/views/entries';
import { defaultEntryRenderers, entrySignature, renderEntry } from '../src/views/entries';
import type { ApprovalUi } from '../src/views/approval-card';
import { raw } from './helpers';

const NOW = 1_700_000_000_000;
const entry = (extra: Record<string, unknown> = {}): Entry => parseEntry(raw(10, 'approval', { request_id: 'r1', operation_id: 'io.terra.node.modules.restart', ...extra })) as Entry;

function card(over: Partial<ApprovalCard> = {}): ApprovalCard {
  return {
    requestId: 'r1', operationId: 'io.terra.node.modules.restart', state: 'pending', seq: 10, createdMs: NOW - 5_000, contractKnown: true, actionable: true,
    outcomeKnown: false, deadline: { ms: NOW + 270_000, approximate: false }, remainingMs: 270_000, deniedBefore: 0, deniedBeforeUnknownInput: 0,
    reason: 'chat 모듈이 Stopped라 재시작이 필요합니다.', judgement: 'risk dangerous 라 물어야 합니다.', contract: {}, ...over,
  };
}

function ui(over: Partial<ApprovalUi> = {}): ApprovalUi {
  return { nowMs: NOW, busy: new Map(), notices: new Map(), onAnswer: vi.fn(), ...over };
}

function ctx(c: ApprovalCard | undefined, a: ApprovalUi | null = ui()): EntryContext {
  return {
    viewer: 'alice', ordinals: new Map(), cards: c ? new Map([[c.requestId, c]]) : new Map(), turnCalls: new Map(), lastDoneSeq: null, tokens: 0,
    ...(a ? { approvals: a } : {}),
  };
}

const render = (c: ApprovalCard, a: ApprovalUi | null = ui()): HTMLElement => renderEntry(entry(), ctx(c, a));
const FULL: ApprovalContract = {
  risk: 'dangerous', confirmation_mode: 'conditional', idempotency_mode: 'none', retry_mode: 'never', output_mode: 'accepted-job',
  side_effects: [{ resource_id: 'io.terra.chat', action: 'restart' }], permissions: ['node.control'],
};
const row = (el: HTMLElement, label: string): HTMLElement | null => {
  const dt = Array.from(el.querySelectorAll('.facts dt')).find((d) => d.textContent === label);
  return (dt?.nextElementSibling as HTMLElement | null) ?? null;
};

describe('승인 카드 — 대기', () => {
  it('계약 사실 여섯과 대상을 그대로 보인다', () => {
    const el = render(card({ contract: FULL }));
    expect(row(el, '위험')?.textContent).toContain('dangerous');
    expect(row(el, '위험')?.textContent).toContain('node.control');
    expect(row(el, '확인')?.textContent).toBe('conditional');
    expect(row(el, '부작용')?.textContent).toContain('restart');
    expect(row(el, '부작용')?.textContent).toContain('io.terra.chat');
    expect(row(el, '재시도')?.textContent).toBe('never');
    expect(row(el, '멱등')?.textContent).toBe('none');
    expect(row(el, '결과')?.textContent).toContain('accepted-job');
    expect(row(el, '결과')?.textContent).toContain('접수 ≠ 완료');
    expect(row(el, '대상')?.textContent).toContain('이 Gateway의 노드');
  });

  it('계약이 적지 않은 칸은 "적지 않음"이고 "없음"과 다르다 (DC-17)', () => {
    const el = render(card({ contract: { side_effects: [], permissions: [], risk: 'read' } }));
    expect(row(el, '부작용')?.textContent).toBe('없음'); // 빈 목록 = 없다고 적었다
    expect(row(el, '확인')?.textContent).toBe('적지 않음'); // 키 없음 = 적지 않았다
    expect(row(el, '재시도')?.textContent).toBe('적지 않음');
    expect(row(el, '멱등')?.textContent).toBe('적지 않음');
    expect(row(el, '결과')?.textContent).toBe('적지 않음');
    const absent = render(card({ contract: { risk: 'read' } }));
    expect(row(absent, '부작용')?.textContent).toBe('적지 않음');
    expect(row(absent, '위험')?.textContent).not.toContain('node.');
  });

  it('contract 객체가 없으면(외부 MCP 도구·모듈이 안 싣음) "계약 사실을 읽지 못했다" + judgement', () => {
    const el = render(card({ contract: undefined, contractKnown: false, judgement: '외부 도구는 항상 묻습니다.' }));
    expect(el.querySelector('.facts dt')).toBeNull();
    expect(el.querySelector('.facts')?.textContent).toContain('계약 사실을 읽지 못했습니다');
    expect(el.querySelector('.facts')?.textContent).toContain('외부 도구는 항상 묻습니다.');
  });

  it('모델의 주장은 계약 사실과 다른 칸에, "근거가 아닙니다"와 함께', () => {
    const el = render(card({ contract: FULL }));
    const claim = el.querySelector('.claim') as HTMLElement;
    expect(el.querySelector('.facts')?.contains(claim)).toBe(false);
    expect(claim.textContent).toContain('chat 모듈이 Stopped라');
    expect(claim.textContent).toContain('근거가 아닙니다');
    expect(el.querySelector('.facts')?.textContent).not.toContain('chat 모듈이 Stopped라');
    expect(el.querySelector('.facts')?.textContent).toContain('risk dangerous 라 물어야 합니다.'); // 모듈의 판정 근거는 사실 쪽
    expect(render(card({ reason: undefined })).querySelector('.claim')?.textContent).toContain('이유를 적지 않았습니다');
  });

  it('모델·외부 텍스트의 HTML 은 글자로 나오고 컨트롤을 만들지 않는다 (I7)', () => {
    const evil = '<img src=x onerror=alert(1)><button>승인</button>{{constructor.constructor("x")()}}';
    const el = render(card({ reason: evil, judgement: evil, operationId: evil, contract: { risk: evil, side_effects: [{ action: evil, resource_id: evil }], permissions: [evil] }, input: { a: evil } }));
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('a')).toBeNull();
    expect(el.querySelector('.claim button')).toBeNull();
    expect(el.querySelectorAll('button')).toHaveLength(2); // 승인·거부 둘뿐
    expect(el.querySelector('.claim')?.textContent).toContain(evil);
  });

  it('입력 원문은 접힌 상세에 JSON 글자로', () => {
    const el = render(card({ input: { module: 'io.terra.chat', force: true } }));
    const d = el.querySelector('details.appr-input') as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(d.textContent).toContain('"module": "io.terra.chat"');
    expect(render(card({ input: undefined })).querySelector('details.appr-input')).toBeNull();
  });

  it('승인·거부 버튼은 사람이 누를 때만 onAnswer 를 부르고, 누르면 곧바로 둘 다 꺼진다', () => {
    const a = ui();
    const el = render(card({ contract: FULL }), a);
    const approve = el.querySelector('[data-role=approve]') as HTMLButtonElement;
    const deny = el.querySelector('[data-role=deny]') as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    approve.click();
    approve.click();
    deny.click();
    expect(a.onAnswer).toHaveBeenCalledTimes(1);
    expect(a.onAnswer).toHaveBeenCalledWith('r1', 'approve');
    expect(approve.disabled && deny.disabled).toBe(true);
  });

  it('거부 버튼은 deny 로 부른다', () => {
    const a = ui();
    (render(card(), a).querySelector('[data-role=deny]') as HTMLButtonElement).click();
    expect(a.onAnswer).toHaveBeenCalledWith('r1', 'deny');
  });

  it('답하는 중이면 둘 다 꺼지고 눌린 쪽이 "처리 중"이다', () => {
    const el = render(card(), ui({ busy: new Map([['r1', 'approve']]) }));
    const approve = el.querySelector('[data-role=approve]') as HTMLButtonElement;
    expect((el.querySelector('[data-role=deny]') as HTMLButtonElement).disabled).toBe(true);
    expect(approve.disabled).toBe(true);
    expect(approve.textContent).toContain('처리 중');
    expect(el.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
  });

  it('actionable 이 아니면 컨트롤이 없다 (I9) — approvals 문맥이 있어도', () => {
    for (const state of ['approved', 'denied', 'no-answer', 'timed-out', 'cancelled', 'already-handled'] as const) {
      const el = render(card({ state, actionable: false }));
      expect(el.querySelector('button')).toBeNull();
      expect(el.querySelector(`[data-card-state=${state}]`)).not.toBeNull();
    }
  });

  it('approvals 문맥이 없으면 컨트롤을 그리지 않는다 (답할 길이 없다)', () => {
    expect(renderEntry(entry(), ctx(card(), null)).querySelector('button')).toBeNull();
  });

  it('승인한 카드는 "실행됨이 아닙니다"라고 말한다', () => {
    expect(render(card({ state: 'approved', actionable: false })).textContent).toContain('Gateway 판정 대기');
  });
});

describe('승인 카드 — 마감 (M-3)', () => {
  it('expires_ms 로 센 남은 시간을 m:ss 로, 근사가 아니면 "약" 이 없다', () => {
    const el = render(card());
    expect(el.querySelector('[data-role=clock-vis]')?.textContent).toBe('4:30');
    expect(el.querySelector('[data-role=clock]')?.getAttribute('data-approximate')).toBeNull();
  });

  it('남은 시간은 문맥의 nowMs 로 센다 (카드의 remainingMs 가 낡아도)', () => {
    const el = render(card({ remainingMs: 270_000 }), ui({ nowMs: NOW + 200_000 }));
    expect(el.querySelector('[data-role=clock-vis]')?.textContent).toBe('1:10');
  });

  it('근사 마감이면 "약"과 틀릴 수 있다는 설명을 붙인다 (GAP-12)', () => {
    const el = render(card({ deadline: { ms: NOW + 270_000, approximate: true } }));
    expect(el.querySelector('[data-role=clock-vis]')?.textContent).toBe('약 4:30');
    expect(el.querySelector('[data-role=clock]')?.getAttribute('title')).toContain('틀릴 수');
  });

  it('60초 이하면 tick 표시', () => {
    expect(render(card(), ui({ nowMs: NOW + 215_000 })).querySelector('[data-role=clock]')?.classList.contains('tick')).toBe(true);
    expect(render(card()).querySelector('[data-role=clock]')?.classList.contains('tick')).toBe(false);
  });

  it('마감이 지나면 컨트롤이 꺼지고 "마감" 안내가 나온다 — 서버 판정은 새로 읽어 확인', () => {
    const el = render(card(), ui({ nowMs: NOW + 270_000 }));
    expect(el.querySelector('section')?.getAttribute('data-expired')).toBe('true');
    expect((el.querySelector('[data-role=approve]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('[data-role=deny]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.textContent).toContain('마감되었습니다');
  });

  it('update(): 초가 흘러도 노드를 바꾸지 않고 글자만 갱신한다 — 초점 유지', () => {
    const c = card();
    const el = renderEntry(entry(), ctx(c, ui()));
    const btn = el.querySelector('[data-role=approve]') as HTMLButtonElement;
    const later = ctx(c, ui({ nowMs: NOW + 1_000 }));
    expect(entrySignature(entry(), ctx(c, ui()))).toBe(entrySignature(entry(), later));
    defaultEntryRenderers.approval.update?.(el, entry() as never, later);
    expect(el.querySelector('[data-role=clock-vis]')?.textContent).toBe('4:29');
    expect(el.querySelector('[data-role=approve]')).toBe(btn);
  });

  it('스크린 리더용 알림은 분 단위·임계값에서만 바뀐다 (초마다 읽지 않는다)', () => {
    const c = card();
    const el = renderEntry(entry(), ctx(c, ui()));
    const sr = el.querySelector('[data-role=clock-sr]') as HTMLElement;
    expect(el.querySelector('[data-role=clock]')?.getAttribute('aria-live')).toBe('off');
    expect(el.querySelector('[data-role=clock-vis]')?.getAttribute('aria-hidden')).toBe('true');
    const before = sr.textContent;
    defaultEntryRenderers.approval.update?.(el, entry() as never, ctx(c, ui({ nowMs: NOW + 1_000 })));
    expect(sr.textContent).toBe(before);
    defaultEntryRenderers.approval.update?.(el, entry() as never, ctx(c, ui({ nowMs: NOW + 245_000 })));
    expect(sr.textContent).not.toBe(before);
    expect(sr.textContent).toContain('남은 시간');
  });
});

describe('승인 카드 — 표식과 접근성', () => {
  it('I18: 이전에 거부한 같은 호출 N회, 입력을 비교 못 한 경우는 따로', () => {
    expect(render(card({ deniedBefore: 2 })).querySelector('[data-role=prev-denied]')?.textContent).toContain('이전에 거부한 같은 호출 2회');
    const unknown = render(card({ deniedBeforeUnknownInput: 1 }));
    expect(unknown.querySelector('[data-role=prev-denied-unknown]')?.textContent).toContain('입력은 비교하지 못했습니다');
    expect(render(card()).querySelector('[data-role=prev-denied]')).toBeNull();
    // 끝난 카드에도 남는다
    expect(render(card({ state: 'denied', actionable: false, deniedBefore: 1 })).textContent).toContain('이전에 거부한 같은 호출 1회');
  });

  it('"승인해도 Gateway가 다시 판정한다"를 항상 보인다', () => {
    expect(render(card()).textContent).toContain('Gateway가 다시 판정');
  });

  it('카드는 이름 있는 그룹이고, 버튼 이름에 어느 도구인지 들어 있다 (여러 카드 구분)', () => {
    const el = render(card());
    const group = el.querySelector('section') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    const labelledBy = group.getAttribute('aria-labelledby') as string;
    expect(el.querySelector(`#${CSS.escape(labelledBy)}`)?.textContent).toContain('io.terra.node.modules.restart');
    expect(group.tabIndex).toBe(-1);
    expect(el.querySelector('[data-role=approve]')?.getAttribute('aria-label')).toBe('승인 — io.terra.node.modules.restart');
    expect(el.querySelector('[data-role=deny]')?.getAttribute('aria-label')).toBe('거부 — io.terra.node.modules.restart');
    expect(Array.from(el.querySelectorAll('button')).every((b) => b.getAttribute('type') === 'button')).toBe(true);
  });

  it('오류 안내는 role=alert, 경고는 status', () => {
    const err = render(card(), ui({ notices: new Map([['r1', { tone: 'err', text: '답을 보내지 못했습니다.' }]]) }));
    expect(err.querySelector('[role=alert]')?.textContent).toContain('답을 보내지 못했습니다.');
    const warn = render(card(), ui({ notices: new Map([['r1', { tone: 'warn', text: '확인하지 못했습니다.' }]]) }));
    expect(warn.querySelector('[role=status]')?.textContent).toContain('확인하지 못했습니다.');
  });

  it('서명: 상태·busy·안내·마감 여부·거부 표식이 바뀔 때만 달라진다', () => {
    const e = entry();
    const base = entrySignature(e, ctx(card()));
    expect(entrySignature(e, ctx(card(), ui({ busy: new Map([['r1', 'deny']]) })))).not.toBe(base);
    expect(entrySignature(e, ctx(card(), ui({ notices: new Map([['r1', { tone: 'warn', text: 'x' }]]) })))).not.toBe(base);
    expect(entrySignature(e, ctx(card(), ui({ nowMs: NOW + 270_000 })))).not.toBe(base);
    expect(entrySignature(e, ctx(card({ deniedBefore: 1 })))).not.toBe(base);
    expect(entrySignature(e, ctx(card({ state: 'approved', actionable: false })))).not.toBe(base);
    expect(entrySignature(e, ctx(card(), ui({ nowMs: NOW + 5_000 })))).toBe(base);
  });
});
