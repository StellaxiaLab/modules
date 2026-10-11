// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { presentReadiness } from '../src/app/readiness-model';
import { composeReadiness, type ReadinessInput } from '../src/data/readiness';
import { createReadinessCard, createReadinessGuide } from '../src/views/readiness';

const ok = <T>(data: T) => ({ ok: true as const, status: 200, data });
const fail = (status: number, code?: string) => ({ ok: false as const, status, message: 'x', ...(code ? { code } : {}) });

const READY: ReadinessInput = {
  status: ok({ status: 'ok' as const, version: '0.1.0', delegate_door: true }),
  models: ok({ default: 'a', providers: [{ provider: 'a', model: 'm', registered: true, default: true }] }),
  credentials: ok({ registered: true, principal: 'alice', expired: false }),
};

describe('화면 1 — 준비 상태 모델', () => {
  it('아직 못 읽었으면 "확인 중"이고 새 세션을 열 수 없다', () => {
    const p = presentReadiness(null);
    expect(p.chip).toBe('확인 중');
    expect(p.canOpenSession).toBe(false);
  });

  it('모두 통과하면 준비됨 + 폐기 여부를 모른다는 주의', () => {
    const p = presentReadiness(composeReadiness(READY));
    expect(p.tone).toBe('ok');
    expect(p.chip).toBe('준비됨');
    expect(p.canOpenSession).toBe(true);
    expect(p.caveat).toBe('만료 시각 전 — 폐기 여부는 확인하지 못함');
    expect(p.delegateProposal).toBe(false);
    expect(p.version).toBe('0.1.0');
  });

  it('권한 없음(GAP-2): MODULE_PERMISSION_DENIED 를 권한 단계로 말하고 뒤 단계는 건너뛴다', () => {
    const p = presentReadiness(composeReadiness({ ...READY, models: fail(403, 'MODULE_PERMISSION_DENIED'), credentials: fail(403, 'MODULE_PERMISSION_DENIED') }));
    expect(p.canOpenSession).toBe(false);
    expect(p.headline).toContain('agent.use 권한이 없습니다');
    const byId = Object.fromEntries(p.steps.map((s) => [s.id, s]));
    expect(byId['permission']?.tone).toBe('bad');
    expect(byId['model']?.status).toBe('skipped');
    expect(byId['credential']?.status).toBe('skipped');
  });

  it('모델 미등록', () => {
    const p = presentReadiness(composeReadiness({ ...READY, models: ok({ default: 'a', providers: [{ provider: 'a', model: 'm', registered: false, default: true }] }) }));
    expect(p.headline).toContain('등록된 기본 모델이 없습니다');
  });

  it('위임 자격 없음 · 만료: "제안 · 아직 없음"(C-1 전)', () => {
    const none = presentReadiness(composeReadiness({ ...READY, credentials: ok({ registered: false }) }));
    expect(none.delegateProposal).toBe(true);
    expect(none.steps.find((s) => s.id === 'credential')?.badge).toBe('제안 · 아직 없음');
    const expired = presentReadiness(composeReadiness({ ...READY, credentials: ok({ registered: true, principal: 'alice', expired: true }) }));
    expect(expired.delegateProposal).toBe(true);
    expect(expired.headline).toContain('만료');
  });

  it('모듈이 꺼졌거나 로그인이 끝났거나 연결이 안 되면 각각 다른 말을 한다', () => {
    const down = presentReadiness(composeReadiness({ status: fail(503, 'MODULE_UNAVAILABLE') }));
    expect(down.headline).toContain('꺼져 있습니다');
    const ended = presentReadiness(composeReadiness({ status: fail(401, 'UNAUTHORIZED') }));
    expect(ended.headline).toContain('로그인 세션이 끝났습니다');
    const net = presentReadiness(composeReadiness({ status: fail(0) }));
    expect(net.headline).toContain('연결할 수 없습니다');
  });

  it('위임 관문이 없으면 읽기만(새 세션 불가)', () => {
    const p = presentReadiness(composeReadiness({ ...READY, status: ok({ status: 'ok' as const, version: '0.1.0', delegate_door: false }) }));
    expect(p.canOpenSession).toBe(false);
    expect(p.headline).toContain('위임 관문이 없습니다');
  });
});

describe('화면 1 — 조각', () => {
  it('카드: 칩과 점이 같은 자리에서 갱신된다(노드를 다시 만들지 않는다)', () => {
    const card = createReadinessCard();
    document.body.append(card.el);
    card.update(presentReadiness(composeReadiness(READY)));
    const firstDot = card.el.querySelector('.dot-item');
    expect(card.el.textContent).toContain('준비됨');
    card.update(presentReadiness(composeReadiness({ ...READY, models: ok({ default: 'a', providers: [] }) })));
    expect(card.el.textContent).toContain('준비 안 됨');
    expect(card.el.querySelector('.dot-item')).toBe(firstDot);
    // 색만으로 말하지 않는다 — 점마다 상태 글자(스크린 리더용)가 있다
    expect(card.el.querySelector('.sr-only')?.textContent?.trim()).toBeTruthy();
  });

  it('안내: 단계가 목록(ol)이고, 다시 확인 버튼이 핸들러를 부른다', () => {
    let rechecked = 0;
    const guide = createReadinessGuide({ onRecheck: () => (rechecked += 1) });
    document.body.append(guide.el);
    guide.update({ presentation: presentReadiness(composeReadiness({ ...READY, credentials: ok({ registered: false }) })), hasSessions: false, checking: false });
    expect(guide.el.querySelector('ol.steps')).not.toBeNull();
    expect(guide.el.querySelectorAll('li.step').length).toBe(6);
    guide.el.querySelector<HTMLButtonElement>('button')?.click();
    expect(rechecked).toBe(1);
    guide.update({ presentation: presentReadiness(composeReadiness(READY)), hasSessions: false, checking: true });
    expect(guide.el.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    expect(guide.el.textContent).toContain('열린 세션이 없습니다');
  });
});
