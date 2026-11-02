// @vitest-environment jsdom
// 헤더의 대상 노드 이름 — status.get 의 선택 필드 node_name 이 있을 때만 보인다(GAP-13).
// 없으면(이전 모듈·코어 면 없는 호스트) 자리 자체가 없고, 꾸민 이름("tree-home" 등)도 없다.
import { afterEach, describe, expect, it } from 'vitest';
import { composeReadiness } from '../src/data/readiness';
import { presentReadiness } from '../src/app/readiness-model';
import { mountApp, type Mounted } from './dom-helpers';

let m: Mounted | null = null;
afterEach(() => {
  m?.dispose();
  m = null;
  document.body.replaceChildren();
});

const NODE = '[data-role=node-name]';
const ok = <T>(data: T) => ({ ok: true as const, status: 200, data });

async function mount(nodeName?: string): Promise<Mounted> {
  m = mountApp((w) => {
    w.nodeName = nodeName;
  });
  await m.refresh();
  return m;
}

describe('헤더의 노드 이름', () => {
  it('node_name 이 있으면 헤더(banner)에 글자로 보인다', async () => {
    const app = await mount('tree-home');
    const el = app.q(NODE);
    expect(el.textContent).toBe('tree-home');
    expect(el.closest('header')).not.toBeNull();
    expect(el.hidden).toBe(false);
  });

  it('없으면 자리가 없다 — 숨김 요소도, 꾸민 문구도 남기지 않는다', async () => {
    const app = await mount(undefined);
    expect(app.root.querySelector(NODE)).toBeNull();
    expect(app.root.textContent).not.toContain('tree-home');
    expect(app.root.querySelector('header')?.textContent).toContain('TERRA AGENT');
  });

  it('빈 문자열·공백뿐인 값도 없는 것으로 본다', async () => {
    for (const empty of ['', '   ']) {
      const app = await mount(empty);
      expect(app.root.querySelector(NODE)).toBeNull();
      app.dispose();
    }
  });

  it('값은 글자로만 렌더한다 — 마크업처럼 보이는 이름도 요소가 되지 않는다(I7)', async () => {
    const app = await mount('<img src=x onerror=alert(1)>&amp;');
    expect(app.q(NODE).textContent).toBe('<img src=x onerror=alert(1)>&amp;');
    expect(app.root.querySelector('header img')).toBeNull();
  });

  it('긴 이름은 잘리지 않는다 — 글자 전체가 DOM 에 있고 접근성 이름도 전체다', async () => {
    const long = `node-${'가나다라마바사'.repeat(12)}-end`;
    const app = await mount(long);
    const el = app.q(NODE);
    expect(el.textContent).toBe(long);
    expect(el.getAttribute('title')).toBe(long);
    // 말줄임으로 자르지 않는다 — 줄을 바꾸는 표시 규칙을 쓴다.
    expect(el.className).toContain('node-name');
    expect(el.getAttribute('aria-label')).toBe(`대상 노드 ${long}`);
  });

  it('다시 읽었을 때 이름이 사라지면(모듈이 낮아짐) 자리도 사라진다', async () => {
    const app = await mount('tree-home');
    expect(app.root.querySelector(NODE)).not.toBeNull();
    app.world.nodeName = undefined;
    await app.app.refreshReadiness();
    await app.app.flush();
    expect(app.root.querySelector(NODE)).toBeNull();
  });
});

describe('준비 상태 모델의 nodeName', () => {
  const READY = {
    models: ok({ default: 'a', providers: [{ provider: 'a', model: 'm', registered: true, default: true }] }),
    credentials: ok({ registered: true, principal: 'alice', expired: false }),
  };
  it('status.get 의 node_name 을 다듬어 싣고, 없거나 비면 null', () => {
    const named = presentReadiness(composeReadiness({ ...READY, status: ok({ status: 'ok' as const, version: '0.3.0', delegate_door: true, node_name: ' tree-home ' }) }));
    expect(named.nodeName).toBe('tree-home');
    const none = presentReadiness(composeReadiness({ ...READY, status: ok({ status: 'ok' as const, version: '0.2.0', delegate_door: true }) }));
    expect(none.nodeName).toBeNull();
    expect(presentReadiness(null).nodeName).toBeNull();
  });
});
