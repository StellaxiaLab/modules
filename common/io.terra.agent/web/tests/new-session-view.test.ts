// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { NewSessionInput } from '../src/data/new-session-form';
import { createNewSession, type McpChoice, type NewSessionModel } from '../src/views/new-session';

afterEach(() => document.body.replaceChildren());

const providers = [
  { provider: 'anthropic', model: 'test-model', default: true },
  { provider: 'other', model: 'm2', default: false },
];
const servers: McpChoice[] = [
  { name: 'filesystem', tools: 4, readOnly: 3 },
  { name: 'weather', tools: 1, readOnly: 1 },
];

function model(over: Partial<NewSessionModel> = {}): NewSessionModel {
  return {
    sessionId: 's-1',
    formKey: 1,
    creating: false,
    canOpen: true,
    blockedReason: null,
    error: null,
    frozen: false,
    providers,
    defaultProvider: 'anthropic',
    mcp: { status: 'ready', servers },
    ...over,
  };
}

function mount(over: Partial<NewSessionModel> = {}) {
  const submitted: NewSessionInput[] = [];
  const log = { reload: 0, close: 0 };
  const view = createNewSession({ onSubmit: (i) => submitted.push(i), onClose: () => log.close++, onReloadMcp: () => log.reload++ });
  document.body.append(view.el);
  view.update(model(over));
  const q = <T extends Element = HTMLInputElement>(s: string): T => view.el.querySelector<T>(s) as T;
  const submit = (): void => {
    view.el.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  };
  const type = (selector: string, value: string): void => {
    const el = q(selector);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const radio = (name: string, value: string): void => {
    const el = view.el.querySelector<HTMLInputElement>(`input[name=${name}][value=${value}]`) as HTMLInputElement;
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { view, submitted, log, q, submit, type, radio };
}

describe('새 세션 폼 — 자율성', () => {
  it('plan 이 기본이고 ask·auto 는 열린다. unattended 는 G4 까지 꺼진 채 이유를 말한다 (D-7)', () => {
    const { view } = mount();
    const radios = Array.from(view.el.querySelectorAll<HTMLInputElement>('input[name=autonomy]'));
    expect(radios.map((r) => [r.value, r.disabled, r.checked])).toEqual([
      ['plan', false, true],
      ['ask', false, false],
      ['auto', false, false],
      ['unattended', true, false],
    ]);
    const off = radios[3] as HTMLInputElement;
    const reason = view.el.querySelector(`#${off.getAttribute('aria-describedby')}`);
    expect(reason?.textContent).toBe('무인 세션은 G4에서 열립니다');
    expect(view.el.textContent).not.toContain('G2');
  });

  it('고른 자율성이 그대로 나간다', () => {
    const t = mount();
    t.radio('autonomy', 'ask');
    t.submit();
    expect(t.submitted).toEqual([{ autonomy: 'ask' }]);
    t.radio('autonomy', 'auto');
    t.submit();
    expect(t.submitted[1]).toEqual({ autonomy: 'auto' });
  });
});

describe('새 세션 폼 — 값 모으기', () => {
  it('아무것도 안 건드리면 autonomy 만 간다', () => {
    const t = mount();
    t.submit();
    expect(t.submitted).toEqual([{ autonomy: 'plan' }]);
  });

  it('topic · simulate · provider · MCP · 한도 셋을 모두 싣는다', () => {
    const t = mount();
    t.type('#new-topic', '  새벽 점검 ');
    t.radio('autonomy', 'ask');
    t.radio('simulate', 'on');
    const select = t.q<HTMLSelectElement>('#new-provider');
    select.value = 'other';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    for (const name of ['weather', 'filesystem']) {
      const box = t.q(`input[name=mcp][value=${name}]`);
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    t.type('#new-max-steps', '40');
    t.type('#new-max-seconds', '1800');
    t.type('#new-token-budget', '50000');
    t.submit();
    expect(t.submitted).toEqual([
      { autonomy: 'ask', topic: '새벽 점검', simulate: true, provider: 'other', mcp_servers: ['filesystem', 'weather'], max_steps: 40, max_seconds: 1800, token_budget: 50000 },
    ]);
  });

  it('한도 칸은 기본값이 채워져 있고 토큰은 비어 있다 (무제한)', () => {
    const { q } = mount();
    expect([q('#new-max-steps').value, q('#new-max-seconds').value, q('#new-token-budget').value]).toEqual(['24', '900', '']);
    expect(q('#new-token-budget').placeholder).toBe('무제한');
  });
});

describe('새 세션 폼 — 값 검증과 접근성', () => {
  it('틀린 값은 보내지 않고, 칸에 오류를 이어 붙이고, 초점을 첫 오류 칸으로 옮긴다', () => {
    const t = mount();
    t.type('#new-max-seconds', '0');
    t.type('#new-token-budget', '1.5');
    t.submit();
    expect(t.submitted).toEqual([]);
    const seconds = t.q('#new-max-seconds');
    const tokens = t.q('#new-token-budget');
    expect(seconds.getAttribute('aria-invalid')).toBe('true');
    expect(tokens.getAttribute('aria-invalid')).toBe('true');
    expect(t.q('#new-max-steps').getAttribute('aria-invalid')).toBeNull();
    const describedBy = (el: Element): string => (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(describedBy(seconds)).toContain('1~7200');
    expect(describedBy(tokens)).toContain('1 이상');
    expect(document.activeElement).toBe(seconds);
  });

  it('고쳐 쓰기 시작하면 그 칸의 오류가 사라지고 다시 보낼 수 있다', () => {
    const t = mount();
    t.type('#new-max-steps', '101');
    t.submit();
    expect(t.q('#new-max-steps').getAttribute('aria-invalid')).toBe('true');
    t.type('#new-max-steps', '100');
    expect(t.q('#new-max-steps').getAttribute('aria-invalid')).toBeNull();
    expect(t.view.el.querySelector('[data-error-for=maxSteps]')?.textContent).toBe('');
    t.submit();
    expect(t.submitted).toEqual([{ autonomy: 'plan', max_steps: 100 }]);
  });

  it('제목이 200자를 넘으면 거절한다', () => {
    const t = mount();
    const topic = t.q('#new-topic');
    topic.removeAttribute('maxlength'); // 붙여넣기로 넘친 경우를 흉내 낸다
    t.type('#new-topic', 'x'.repeat(201));
    t.submit();
    expect(t.submitted).toEqual([]);
    expect(topic.getAttribute('aria-invalid')).toBe('true');
  });

  it('모든 입력 칸에 이름이 있다 (label · 묶음의 legend)', () => {
    const { view } = mount();
    const unnamed: string[] = [];
    for (const el of Array.from(view.el.querySelectorAll<HTMLElement>('input, select, textarea'))) {
      const labelled = el.getAttribute('aria-label') !== null || (el.id !== '' && view.el.querySelector(`label[for="${el.id}"]`) !== null) || el.closest('label') !== null;
      if (!labelled) unnamed.push(`${el.tagName}#${el.id}[${el.getAttribute('name')}]`);
    }
    expect(unnamed).toEqual([]);
    for (const group of Array.from(view.el.querySelectorAll('fieldset'))) expect(group.querySelector(':scope > legend')?.textContent, '묶음 이름').toBeTruthy();
  });

  it('열 때 고정이라는 안내가 있고 변경 컨트롤을 두지 않는다 (I10)', () => {
    const { view } = mount();
    expect(view.el.textContent).toContain('열 때 고정');
  });
});

describe('새 세션 폼 — 새로 열기', () => {
  it('formKey 가 바뀌면 칸이 처음 값으로 돌아오고 오류도 사라진다', () => {
    const t = mount();
    t.type('#new-topic', '지난 제목');
    t.radio('autonomy', 'auto');
    t.radio('simulate', 'on');
    t.type('#new-max-steps', '999');
    const box = t.q('input[name=mcp][value=weather]');
    box.checked = true;
    t.submit();
    expect(t.q('#new-max-steps').getAttribute('aria-invalid')).toBe('true');
    t.view.update(model({ formKey: 1 })); // 같은 키: 그대로
    expect(t.q('#new-topic').value).toBe('지난 제목');
    t.view.update(model({ formKey: 2 }));
    expect(t.q('#new-topic').value).toBe('');
    expect(t.q('input[name=autonomy][value=plan]').checked).toBe(true);
    expect(t.q('input[name=simulate][value=off]').checked).toBe(true);
    expect(t.q('#new-max-steps').value).toBe('24');
    expect(t.q('#new-max-steps').getAttribute('aria-invalid')).toBeNull();
    expect(t.q('input[name=mcp][value=weather]').checked).toBe(false);
    expect(t.q<HTMLSelectElement>('#new-provider').value).toBe('anthropic');
    t.submit();
    expect(t.submitted).toEqual([{ autonomy: 'plan' }]);
  });
});

describe('새 세션 폼 — 모델 provider', () => {
  it('등록된 provider 를 고른다. 기본이 미리 골라져 있고 "기본" 표시가 붙는다', () => {
    const { q } = mount();
    const select = q<HTMLSelectElement>('#new-provider');
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ['anthropic', 'anthropic · test-model (기본)'],
      ['other', 'other · m2'],
    ]);
    expect(select.value).toBe('anthropic');
  });

  it('목록을 못 읽었으면 칸을 닫고 모듈 기본 모델로 연다고 말한다', () => {
    const t = mount({ providers: null, defaultProvider: null });
    expect(t.q<HTMLSelectElement>('#new-provider').disabled).toBe(true);
    expect(t.view.el.querySelector('[data-role=provider-note]')?.textContent).toContain('모듈 기본');
    t.submit();
    expect(t.submitted).toEqual([{ autonomy: 'plan' }]);
  });

  it('고른 provider 가 목록에서 사라지면 기본으로 돌아간다', () => {
    const t = mount();
    const select = t.q<HTMLSelectElement>('#new-provider');
    select.value = 'other';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    t.view.update(model({ providers: [providers[0] as (typeof providers)[0]] }));
    expect(select.value).toBe('anthropic');
  });
});

describe('새 세션 폼 — 외부 MCP 서버 (읽기 전용 목록)', () => {
  it('서버마다 도구 수와 읽기 전용 수를 보이고, 등록 화면은 앱 밖이라고 말한다', () => {
    const { view } = mount();
    const rows = Array.from(view.el.querySelectorAll('[data-role=mcp-item]')).map((r) => r.textContent);
    expect(rows[0]).toContain('filesystem');
    expect(rows[0]).toContain('도구 4 · 읽기 전용 3');
    expect(rows[1]).toContain('도구 1 · 읽기 전용 1');
    expect(view.el.textContent).toContain('등록은 앱 밖');
  });

  it('목록을 읽는 중 · 못 읽음 · 비어 있음을 가른다. 못 읽어도 폼은 열 수 있다', () => {
    const t = mount({ mcp: { status: 'loading' } });
    expect(t.view.el.querySelector('[data-role=mcp-state]')?.textContent).toContain('읽는 중');
    t.view.update(model({ mcp: { status: 'failed', message: '에이전트 모듈이 지금 처리할 수 없습니다.' } }));
    expect(t.view.el.querySelector('[data-role=mcp-state]')?.textContent).toContain('에이전트 모듈이 지금 처리할 수 없습니다.');
    (t.view.el.querySelector('[data-role=mcp-reload]') as HTMLButtonElement).click();
    expect(t.log.reload).toBe(1);
    t.submit();
    expect(t.submitted).toEqual([{ autonomy: 'plan' }]);
    t.view.update(model({ mcp: { status: 'ready', servers: [] } }));
    expect(t.view.el.querySelector('[data-role=mcp-state]')?.textContent).toContain('등록된 외부 MCP 서버가 없습니다');
  });

  it('고른 서버는 다시 그려도 유지되고, 목록에서 사라진 서버는 선택에서 빠진다', () => {
    const t = mount();
    const box = t.q('input[name=mcp][value=weather]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    t.view.update(model());
    expect(t.q('input[name=mcp][value=weather]').checked).toBe(true);
    t.view.update(model({ mcp: { status: 'ready', servers: [servers[0] as McpChoice] } }));
    t.submit();
    expect(t.submitted).toEqual([{ autonomy: 'plan' }]);
  });

  it('서버 이름의 HTML 은 글자로 나온다', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { view } = mount({ mcp: { status: 'ready', servers: [{ name: evil, tools: 0, readOnly: 0 }] } });
    expect(view.el.querySelector('img')).toBeNull();
    expect(view.el.querySelector('[data-role=mcp-item]')?.textContent).toContain(evil);
  });

  it('외부 서버 결과는 제3자 데이터이고 읽기 전용이 아닌 도구는 묻지 않고 실행되지 않는다고 알린다', () => {
    const { view } = mount();
    expect(view.el.querySelector('[data-role=mcp-note]')?.textContent).toContain('읽기 전용');
  });
});

describe('새 세션 폼 — 열기 호출의 상태', () => {
  it('만드는 중에는 버튼이 꺼진다', () => {
    const { view } = mount({ creating: true });
    const button = view.el.querySelector<HTMLButtonElement>('[data-role=open-session]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('여는 중…');
  });

  it('준비가 안 됐으면 이유를 보이고 열 수 없다', () => {
    const t = mount({ canOpen: false, blockedReason: '새 세션을 열 수 없습니다 — 모델: 등록된 기본 모델이 없습니다' });
    expect(t.q<HTMLButtonElement>('[data-role=open-session]').disabled).toBe(true);
    expect(t.view.el.textContent).toContain('등록된 기본 모델이 없습니다');
    t.submit();
    expect(t.submitted).toEqual([]);
  });

  it('만드는 중에 제출 이벤트가 또 와도 한 번만 나간다 (더블클릭 가드)', () => {
    const t = mount();
    t.submit();
    t.view.update(model({ creating: true }));
    t.submit();
    expect(t.submitted).toHaveLength(1);
  });

  it('실패 문구와 코드를 보이고 원문은 접어 둔다', () => {
    const t = mount({ error: { message: '등록된 모델이 없습니다. 모델을 먼저 등록해 주세요.', code: 'MODEL_NOT_CONFIGURED', raw: 'no model' } });
    const alert = t.view.el.querySelector('[role=alert]') as HTMLElement;
    expect(alert.textContent).toContain('등록된 모델이 없습니다');
    expect(alert.textContent).toContain('MODEL_NOT_CONFIGURED');
    expect(alert.querySelector('details')?.textContent).toContain('no model');
    expect(alert.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('응답을 못 받았으면(frozen) 값 칸을 잠가 같은 id 로 같은 값을 다시 보내게 한다', () => {
    const t = mount({ frozen: true });
    const locked = Array.from(t.view.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form input, form select')).filter((el) => !el.disabled);
    expect(locked).toEqual([]);
    expect(t.view.el.querySelector('[data-role=frozen-note]')?.textContent).toContain('같은 id');
    expect(t.q<HTMLButtonElement>('[data-role=open-session]').disabled).toBe(false);
    t.submit();
    expect(t.submitted).toEqual([{ autonomy: 'plan' }]);
  });
});
