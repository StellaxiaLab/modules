// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { reply } from '../src/transport';
import { mountApp, type Mounted } from './dom-helpers';

let m: Mounted | null = null;
afterEach(() => {
  m?.dispose();
  m = null;
});

async function open(setup: Parameters<typeof mountApp>[0]): Promise<Mounted> {
  m = mountApp(setup);
  await m.refresh();
  return m;
}

describe('화면 1 — 준비 상태 (앱 통합)', () => {
  it('준비됨: 칩과 점 셋(모듈·권한·모델·자격), 새 세션이 열린다', async () => {
    const app = await open(() => {});
    expect(app.text('[data-role=readiness-chip]')).toContain('준비됨');
    expect(app.qa('[data-role=readiness-dots] .dot-item').map((e) => e.querySelector('.lbl-t')?.textContent)).toEqual(['모듈', '권한', '모델', '위임 자격']);
    expect(app.q('[data-role=new-session]').getAttribute('aria-disabled')).toBe('false');
    expect(app.text('[data-role=readiness-guide]')).toContain('에이전트를 쓸 준비가 되었습니다');
  });

  it('권한 없음(GAP-2): agent.use 가 없으면 단계로 말하고 새 세션을 막는다', async () => {
    const app = await open((w) => {
      w.modelsReply = reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED', 'permission denied');
      w.credentialsReply = reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED', 'permission denied');
    });
    const guide = app.text('[data-role=readiness-guide]');
    expect(guide).toContain('이 계정에 agent.use 권한이 없습니다');
    expect(guide).toContain('관리자에게 agent.use 부여를 요청');
    expect(app.text('[data-role=readiness-chip]')).toContain('준비 안 됨');
    expect(app.q('[data-role=new-session]').getAttribute('aria-disabled')).toBe('true');
    // 권한이 없으면 뒤 단계는 판정하지 않는다
    expect(guide).toContain('앞 단계를 먼저 해결해 주세요');
  });

  it('만료·무효 토큰(실제 Gateway: 403 MODULE_PERMISSION_DENIED + 로그인 필요 문구)은 권한 부족이 아니라 로그인 끝으로 보인다(B1)', async () => {
    const app = await open((w) => {
      w.statusReply = reply.loginRequired();
      w.modelsReply = reply.loginRequired('io.terra.agent.models.list');
      w.credentialsReply = reply.loginRequired('io.terra.agent.credentials.get');
    });
    const guide = app.text('[data-role=readiness-guide]');
    expect(guide).toContain('로그인 세션이 끝났습니다');
    expect(guide).not.toContain('agent.use');
    expect(app.q('[data-role=new-session]').getAttribute('aria-disabled')).toBe('true');
  });

  it('같은 403 이라도 진짜 권한 부족 문구면 여전히 agent.use 안내다(B1 대조)', async () => {
    const app = await open((w) => {
      w.statusReply = reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED', '호출에 필요한 권한이 없습니다: io.terra.agent.status.get');
    });
    expect(app.text('[data-role=readiness-guide]')).toContain('agent.use');
    expect(app.text('[data-role=readiness-guide]')).not.toContain('로그인 세션이 끝났습니다');
  });

  it('모델 미등록: 등록된 기본 모델이 없다고 말한다', async () => {
    const app = await open((w) => {
      w.modelRegistered = false;
    });
    expect(app.text('[data-role=readiness-guide]')).toContain('등록된 기본 모델이 없습니다');
    expect(app.q('[data-role=new-session]').getAttribute('aria-disabled')).toBe('true');
  });

  it('위임 자격 없음: "제안 · 아직 없음"(C-1 전)을 단계 표지와 안내로 보인다', async () => {
    const app = await open((w) => {
      w.credentialRegistered = false;
    });
    const badge = app.qa('.st-badge').find((e) => !e.hidden);
    expect(badge?.textContent).toBe('제안 · 아직 없음');
    expect(app.text('[data-role=readiness-guide]')).toContain('위임 자격이 아직 맡겨져 있지 않습니다');
    expect(app.text('.proposal')).toContain('제안 · 아직 없음');
    expect(app.q('.proposal').hidden).toBe(false);
  });

  it('위임 자격 만료: 다시 맡기라고 안내한다', async () => {
    const app = await open((w) => {
      w.credentialExpired = true;
    });
    expect(app.text('[data-role=readiness-guide]')).toContain('위임 자격이 만료되었습니다');
    expect(app.q('.proposal').hidden).toBe(false);
  });

  it('모듈이 꺼져 있으면 코어 GUI 의 모듈 화면으로 안내한다', async () => {
    const app = await open((w) => {
      w.statusReply = reply.gatewayFail(503, 'MODULE_UNAVAILABLE', 'module stopped');
    });
    expect(app.text('[data-role=readiness-guide]')).toContain('에이전트 모듈이 꺼져 있습니다');
  });

  it('위임 관문이 없으면 읽기만 한다', async () => {
    const app = await open((w) => {
      w.delegateDoor = false;
    });
    expect(app.text('[data-role=readiness-guide]')).toContain('위임 관문이 없습니다');
    expect(app.q('[data-role=new-session]').getAttribute('aria-disabled')).toBe('true');
  });

  it('"다시 확인"은 준비 상태를 다시 읽는다', async () => {
    const app = await open((w) => {
      w.credentialRegistered = false;
    });
    app.world.credentialRegistered = true;
    const before = app.transport.callCount(/\/credentials$/);
    app.q<HTMLButtonElement>('.guide .pane-head button').click();
    await app.settle();
    expect(app.transport.callCount(/\/credentials$/)).toBeGreaterThan(before);
    expect(app.text('[data-role=readiness-chip]')).toContain('준비됨');
  });
});
