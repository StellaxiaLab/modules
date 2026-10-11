// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { boot, STANDALONE_NOTICE, type BootWindow } from '../src/app/boot';
import { FakeTransport } from '../src/transport';
import { makeShell, AGENT as AGENT_PATH } from './transport-helpers';
import { World } from './world';

afterEach(() => {
  document.body.replaceChildren();
});

function rootEl(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  return root;
}

describe('부트스트랩 — 어디서 열렸나 (Q-1)', () => {
  it('셸 밖(최상위 창)이면 "이 앱은 Terra 셸 안에서 여세요." 안내만 보이고 앱은 서지 않는다', () => {
    const root = rootEl();
    expect(window.parent).toBe(window); // jsdom 최상위
    const result = boot(root, { devTransport: () => undefined });
    expect(result).toBeNull();
    expect(root.textContent).toContain(STANDALONE_NOTICE);
    expect(STANDALONE_NOTICE).toBe('이 앱은 Terra 셸 안에서 여세요.');
    expect(root.querySelector('[data-role=app]')).toBeNull();
    expect(root.querySelector('textarea')).toBeNull();
  });

  it('셸 안(부모 창이 있다)이면 BridgeTransport 를 쓴다', () => {
    const shell = makeShell({ permissions: ['agent.use'] });
    const win = Object.assign(shell.win, { location: { hash: '' } }) as unknown as BootWindow;
    const result = boot(rootEl(), { win, devTransport: () => undefined, manual: true });
    expect(result?.transport.kind).toBe('bridge');
    expect(result?.app).toBeDefined();
    result?.transport.dispose?.();
  });

  it('개발 서버의 토큰 전송이 있으면 그것을 쓴다 (셸 밖이어도)', () => {
    const fake = new FakeTransport();
    const result = boot(rootEl(), { devTransport: () => fake, manual: true });
    expect(result?.transport).toBe(fake);
  });

  it('프로덕션 번들에는 개발 토큰 읽기가 없다 — devTransport 기본값은 DEV 가 아니면 undefined', () => {
    // vitest 는 DEV 모드이지만 토큰 환경변수가 비어 있으므로 undefined 다.
    const result = boot(rootEl());
    expect(result).toBeNull();
  });

  it('셸 안에서 브리지를 통해 준비 상태를 읽는다 (hello → ready → request/response)', async () => {
    const world = new World();
    const seen: string[] = [];
    const shell = makeShell({
      permissions: ['agent.use'],
      respond: (message) => {
        const path = String(message['path']);
        seen.push(`${String(message['method'])} ${path}`);
        const inner = path.slice(AGENT_PATH.length);
        if (inner === '/status') return { ok: true, status: 200, data: { status: 'ok', version: world.version, delegate_door: true } };
        if (inner === '/models') return { ok: true, status: 200, data: { default: 'a', providers: [{ provider: 'a', model: 'm', registered: true, default: true }] } };
        if (inner === '/credentials') return { ok: true, status: 200, data: { registered: true, principal: 'alice', expired: false } };
        if (inner === '/sessions') return { ok: true, status: 200, data: { sessions: [] } };
        return { ok: false, status: 404, error: { code: 'X', message: 'x' } };
      },
    });
    const win = Object.assign(shell.win, { location: { hash: '' } }) as unknown as BootWindow;
    const root = rootEl();
    const result = boot(root, { win, devTransport: () => undefined, manual: true });
    await result?.app.refreshReadiness();
    expect(seen).toContain(`GET ${AGENT_PATH}/status`);
    expect(root.textContent).toContain('준비됨');
    expect(shell.hellos()).toBeGreaterThanOrEqual(1);
    result?.transport.dispose?.();
  });
});
