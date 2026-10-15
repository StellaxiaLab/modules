// 새 세션 열기 (GAP-9, 보드 ⑤). 열 때 고정되는 값을 모은다 — 열린 뒤에는 바꾸는 컨트롤이 없다(I10).
//   · 자율성: plan(기본, D-7) · ask · auto 는 열린다. unattended 는 G4 까지 꺼진 채 이유를 쓴다.
//   · 시뮬레이션 · 모델 provider(models.list 의 등록된 것) · 외부 MCP 서버(mcp.list, 읽기 전용 목록) · 한도 셋.
//   · 값 검증은 data/new-session-form 의 순수 함수가 한다. 이 화면은 값을 모으고, 틀린 칸에 오류를 이어 붙이고, 첫 오류 칸으로 초점을 옮긴다.
// session_id 는 앱이 만들고 이 화면을 연 동안 하나다 — 같은 id 로 다시 눌러도 모듈이 `created:false` 로 답한다(멱등, 함정 9).
import { AUTONOMIES, type Autonomy } from '../api/types';
import { DEFAULT_MAX_SECONDS, DEFAULT_MAX_STEPS, MAX_SECONDS_RANGE, MAX_STEPS_RANGE, TOPIC_MAX_CHARS } from '../api/client';
import { h, icon, reconcile, setChildren, setText } from '../app/dom';
import {
  OPENABLE_AUTONOMIES,
  UNATTENDED_OFF_REASON,
  validateNewSession,
  type FieldKey,
  type NewSessionContext,
  type NewSessionInput,
  type NewSessionValues,
  type ProviderChoice,
} from '../data/new-session-form';
import type { View } from './types';

export interface McpChoice {
  name: string;
  tools: number;
  readOnly: number;
}

export type McpState = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; servers: readonly McpChoice[] };

/** 열기 호출이 돌려준 실패 — 문구는 오류 사전, 원문은 접어서 보인다. */
export interface NewSessionError {
  message: string;
  code?: string;
  raw?: string;
}

export interface NewSessionModel {
  sessionId: string;
  /** 폼을 새로 열 때마다 바뀐다 — 바뀌면 칸을 처음 값으로 돌린다(나갔다 들어온 폼에 지난 값이 남지 않게). */
  formKey: number;
  creating: boolean;
  canOpen: boolean;
  /** 열 수 없는 이유(준비 상태). */
  blockedReason: string | null;
  error: NewSessionError | null;
  /** 응답을 못 받은 열기 — 같은 id 로 같은 값을 다시 보내도록 값 칸을 잠근다. */
  frozen: boolean;
  /** 고를 수 있는(등록된) provider. 목록을 못 읽었으면 null. */
  providers: readonly ProviderChoice[] | null;
  defaultProvider: string | null;
  mcp: McpState;
}

export interface NewSessionHandlers {
  onSubmit(input: NewSessionInput): void;
  onClose(): void;
  onReloadMcp(): void;
}

const DESC: Record<Autonomy, string> = {
  plan: '읽기만 하고 제안한다. 실행하지 않는다',
  ask: '쓰기 전에 사람에게 묻는다',
  auto: '읽기와 되돌릴 수 있는 쓰기는 묻지 않는다. 위험한 호출은 여전히 묻는다',
  unattended: '읽기와 사전 승인한 호출만 실행하고 나머지는 거절한다',
};

const MCP_NOTE = '외부 서버가 돌려주는 글은 제3자 데이터입니다. 사람이 읽기 전용으로 표시하지 않은 도구는 묻지 않고 실행되지 않습니다.';

const providerLabel = (p: ProviderChoice): string => `${p.provider} · ${p.model}${p.default ? ' (기본)' : ''}`;

export function createNewSession(handlers: NewSessionHandlers): View<NewSessionModel> {
  let current: NewSessionModel | null = null;
  let formKey: number | null = null;
  const errorEls = new Map<FieldKey, HTMLElement>();
  const controls = new Map<FieldKey, () => HTMLElement | null>();

  /** 칸마다 오류 자리를 하나 둔다 — 비어 있어도 aria-describedby 로 이어 두면 오류가 생길 때 바로 읽힌다. */
  function errorSlot(key: FieldKey): HTMLElement {
    const el = h('p', { class: 'field-error', attrs: { id: `err-${key}`, 'data-error-for': key } });
    errorEls.set(key, el);
    return el;
  }
  function setFieldError(key: FieldKey, message: string | null): void {
    const el = errorEls.get(key);
    if (el) setText(el, message ?? '');
    const control = controls.get(key)?.();
    if (control && (control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
      if (message === null) control.removeAttribute('aria-invalid');
      else control.setAttribute('aria-invalid', 'true');
    }
  }
  const clearOnInput = (key: FieldKey) => (): void => setFieldError(key, null);

  // ── 제목 ──
  const sid = h('span', { class: 'chip mut mono' });
  const topic = h('input', {
    attrs: { type: 'text', id: 'new-topic', name: 'topic', maxlength: TOPIC_MAX_CHARS, autocomplete: 'off', 'aria-describedby': 'hint-topic err-topic' },
    on: { input: clearOnInput('topic') },
  });
  controls.set('topic', () => topic);

  // ── 자율성 ──
  const optEls: HTMLElement[] = [];
  const radios = AUTONOMIES.map((a) => {
    const openable = OPENABLE_AUTONOMIES.includes(a);
    const input = h('input', {
      attrs: { type: 'radio', name: 'autonomy', value: a, disabled: !openable, checked: a === 'plan', ...(openable ? {} : { 'aria-describedby': `opt-off-${a}` }) },
      on: {
        change: () => {
          syncOpts();
          setFieldError('autonomy', null);
        },
      },
    });
    const label = h(
      'label',
      { class: `opt${openable ? '' : ' off'}` },
      input,
      h('b', {}, a),
      h('span', {}, DESC[a]),
      openable ? null : h('span', { class: 'opt-off', attrs: { id: `opt-off-${a}` } }, UNATTENDED_OFF_REASON),
    );
    optEls.push(label);
    return input;
  });
  function syncOpts(): void {
    radios.forEach((r, i) => optEls[i]?.classList.toggle('on', r.checked));
  }
  syncOpts();
  controls.set('autonomy', () => radios.find((r) => r.checked) ?? radios[0] ?? null);

  // ── 시뮬레이션 ──
  const simRadios = (['off', 'on'] as const).map((v) =>
    h('input', { attrs: { type: 'radio', name: 'simulate', value: v, checked: v === 'off' } }),
  );
  const simulateGroup = h(
    'fieldset',
    { class: 'grp' },
    h('legend', { class: 'cap' }, '시뮬레이션'),
    h(
      'div',
      { class: 'seg-radio' },
      h('label', {}, simRadios[0], h('span', {}, '끔')),
      h('label', {}, simRadios[1], h('span', {}, '켬')),
    ),
    h('span', { class: 'hint' }, '켜면 호출이 0건입니다 — 모든 호출이 “실행되지 않았다”로 보입니다.'),
  );

  // ── provider ──
  const provider = h('select', { attrs: { id: 'new-provider', name: 'provider', 'aria-describedby': 'hint-provider err-provider' }, on: { change: clearOnInput('provider') } });
  const providerNote = h('span', { class: 'hint', attrs: { id: 'hint-provider', 'data-role': 'provider-note' } });
  controls.set('provider', () => provider);
  let providerSig = '';

  // ── 한도 ──
  const limit = (key: FieldKey, id: string, label: string, value: string, hint: string, placeholder?: string) => {
    const input = h('input', {
      attrs: { type: 'text', inputmode: 'numeric', autocomplete: 'off', id, name: key, value, 'aria-describedby': `hint-${key} err-${key}`, ...(placeholder ? { placeholder } : {}) },
      on: { input: clearOnInput(key) },
    });
    controls.set(key, () => input);
    return { input, el: h('div', { class: 'field' }, h('label', { attrs: { for: id } }, label), input, h('span', { class: 'hint', attrs: { id: `hint-${key}` } }, hint), errorSlot(key)) };
  };
  const steps = limit('maxSteps', 'new-max-steps', '차례당 호출', String(DEFAULT_MAX_STEPS), `모델을 부를 최대 횟수 · ${MAX_STEPS_RANGE.min}~${MAX_STEPS_RANGE.max} · 기본 ${DEFAULT_MAX_STEPS}`);
  const seconds = limit('maxSeconds', 'new-max-seconds', '시간(초)', String(DEFAULT_MAX_SECONDS), `한 차례의 벽시계, 승인 대기 포함 · ${MAX_SECONDS_RANGE.min}~${MAX_SECONDS_RANGE.max} · 기본 ${DEFAULT_MAX_SECONDS}`);
  const tokens = limit('tokenBudget', 'new-token-budget', '토큰 예산', '', '세션이 누적으로 쓸 입력+출력 토큰 · 1 이상 · 비우면 제한 없음', '무제한');
  steps.input.value = String(DEFAULT_MAX_STEPS);
  seconds.input.value = String(DEFAULT_MAX_SECONDS);

  // ── 외부 MCP ──
  const mcpState = h('p', { class: 'hint', attrs: { 'data-role': 'mcp-state', role: 'status' } });
  const mcpReload = h('button', { class: 'btn sm', attrs: { type: 'button', 'data-role': 'mcp-reload' }, on: { click: () => handlers.onReloadMcp() } }, '다시 읽기');
  const mcpList = h('div', { class: 'mcp-list' });
  const mcpGroup = h(
    'fieldset',
    { class: 'grp', attrs: { 'aria-describedby': 'mcp-note err-mcp' } },
    h('legend', { class: 'cap' }, '외부 MCP 서버 ', h('span', { class: 'cap-sub' }, '· 읽기 전용 목록 · 등록은 앱 밖')),
    mcpState,
    mcpReload,
    mcpList,
    h('p', { class: 'hint', attrs: { id: 'mcp-note', 'data-role': 'mcp-note' } }, MCP_NOTE),
    errorSlot('mcp'),
  );
  controls.set('mcp', () => mcpList.querySelector<HTMLInputElement>('input') ?? mcpReload);
  const mcpBoxes = (): HTMLInputElement[] => Array.from(mcpList.querySelectorAll<HTMLInputElement>('input[name=mcp]'));

  // ── 알림·버튼 ──
  const banner = h('div', { class: 'ban err', attrs: { role: 'alert', hidden: true, 'data-role': 'open-error' } }, icon('warn'), h('div', { class: 'ban-body' }));
  const blocked = h('div', { class: 'ban warn', attrs: { hidden: true } }, icon('info'), h('span', {}));
  const frozenNote = h('div', { class: 'ban info', attrs: { hidden: true, 'data-role': 'frozen-note' } }, icon('info'), h('span', {}, '응답을 받지 못했습니다. 세션이 이미 열렸을 수 있어 같은 id 로 같은 값을 다시 보냅니다 — 값은 바꿀 수 없습니다. 이미 열렸다면 처음 값이 유지되고, 실제 값은 세션 정보에 보입니다.'));
  const submit = h('button', { class: 'btn pri', attrs: { type: 'submit', 'data-role': 'open-session' } }, '세션 열기');
  const close = h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => handlers.onClose() } }, '닫기');

  function collect(): NewSessionValues {
    return {
      topic: (topic as HTMLInputElement).value,
      autonomy: ((radios.find((r) => r.checked)?.value ?? 'plan') as Autonomy),
      simulate: simRadios[1]?.checked === true,
      provider: (provider as HTMLSelectElement).value,
      mcp: mcpBoxes().filter((b) => b.checked).map((b) => b.value),
      maxSteps: steps.input.value,
      maxSeconds: seconds.input.value,
      tokenBudget: tokens.input.value,
    };
  }
  function context(): NewSessionContext {
    const m = current;
    return {
      providers: m?.providers ?? null,
      defaultProvider: m?.defaultProvider ?? null,
      mcpNames: m?.mcp.status === 'ready' ? m.mcp.servers.map((s) => s.name) : null,
    };
  }

  const form = h(
    'form',
    {
      class: 'newform',
      attrs: { novalidate: true, 'aria-labelledby': 'new-title' },
      on: {
        submit: (e) => {
          e.preventDefault();
          // 더블클릭·Enter 연타: 만드는 중이거나 열 수 없으면 아무것도 하지 않는다(앱도 한 번 더 막는다).
          if (!current || !current.canOpen || current.creating) return;
          const result = validateNewSession(collect(), context());
          for (const key of errorEls.keys()) setFieldError(key, null);
          if (!result.ok) {
            for (const [key, message] of Object.entries(result.errors)) setFieldError(key as FieldKey, message ?? null);
            controls.get(result.first)?.()?.focus();
            return;
          }
          handlers.onSubmit(result.input);
        },
      },
    },
    blocked,
    h('div', { class: 'field' }, h('label', { attrs: { for: 'new-topic' } }, '제목 (선택)'), topic, h('span', { class: 'hint', attrs: { id: 'hint-topic' } }, `${TOPIC_MAX_CHARS}자 이하. 비워 두면 session_id 로 보입니다.`), errorSlot('topic')),
    h('fieldset', { class: 'autonomy', attrs: { 'aria-describedby': 'err-autonomy' } }, h('legend', { class: 'cap' }, '자율성 · 열 때 고정 · 기본값은 plan (D-7)'), h('div', { class: 'opts' }, ...optEls), errorSlot('autonomy')),
    h(
      'div',
      { class: 'two' },
      h(
        'div',
        { class: 'card grp-card' },
        h('span', { class: 'cap' }, '모델 · 시뮬레이션'),
        h('div', { class: 'field' }, h('label', { attrs: { for: 'new-provider' } }, '제공자'), provider, providerNote, errorSlot('provider')),
        simulateGroup,
      ),
      h(
        'div',
        { class: 'card grp-card', attrs: { role: 'group', 'aria-labelledby': 'limits-cap' } },
        h('span', { class: 'cap', attrs: { id: 'limits-cap' } }, '한도 ', h('span', { class: 'cap-sub' }, '· 기본값이 채워짐')),
        h('div', { class: 'limits-grid' }, steps.el, seconds.el, tokens.el),
      ),
    ),
    mcpGroup,
    frozenNote,
    banner,
    h('div', { class: 'form-actions' }, h('span', { class: 'dim' }, '열린 뒤에는 자율성·시뮬레이션·모델·MCP·한도를 바꿀 수 없습니다. 올리려면 새 세션입니다.'), submit),
  );

  const el = h(
    'section',
    { class: 'c2 newses', attrs: { 'aria-labelledby': 'new-title', 'data-role': 'new-session-pane' } },
    h('header', { class: 'pane-head' }, h('h2', { class: 'pane-title', attrs: { id: 'new-title' } }, '새 세션 열기'), sid, h('span', { class: 'grow' }), close),
    form,
  );

  function updateProviders(m: NewSessionModel): void {
    const select = provider as HTMLSelectElement;
    const list = m.providers;
    const sig = list === null ? 'none' : JSON.stringify([list.map((p) => [p.provider, p.model, p.default]), m.defaultProvider]);
    if (sig !== providerSig) {
      providerSig = sig;
      const previous = select.value;
      if (list === null) {
        setChildren(select, [h('option', { attrs: { value: '' } }, '모듈 기본 모델')]);
        select.value = '';
      } else {
        setChildren(select, list.map((p) => h('option', { attrs: { value: p.provider } }, providerLabel(p))));
        const fallback = m.defaultProvider !== null && list.some((p) => p.provider === m.defaultProvider) ? m.defaultProvider : (list[0]?.provider ?? '');
        select.value = list.some((p) => p.provider === previous) ? previous : fallback;
      }
    }
    select.disabled = list === null || m.frozen;
    providerNote.hidden = list !== null;
    setText(providerNote, list === null ? '모델 목록을 읽지 못해 고를 수 없습니다. 모듈 기본 모델로 엽니다.' : '');
  }

  function updateMcp(m: NewSessionModel): void {
    const state = m.mcp;
    mcpReload.hidden = state.status !== 'failed';
    if (state.status === 'ready') {
      mcpState.hidden = state.servers.length > 0;
      setText(mcpState, state.servers.length > 0 ? '' : '등록된 외부 MCP 서버가 없습니다. 서버 등록은 이 앱 밖에서 합니다.');
      reconcile(mcpList, state.servers, {
        key: (s) => s.name,
        create: (s) => {
          const input = h('input', { attrs: { type: 'checkbox', name: 'mcp', value: s.name }, on: { change: clearOnInput('mcp') } });
          return h('label', { class: 'mcp-item', attrs: { 'data-role': 'mcp-item' } }, input, h('b', { class: 'mono' }, s.name), h('span', { class: 'sub' }));
        },
        update: (item, s) => {
          setText(item.querySelector('.sub') as HTMLElement, `도구 ${s.tools} · 읽기 전용 ${s.readOnly}`);
        },
      });
    } else {
      mcpList.replaceChildren();
      mcpState.hidden = false;
      setText(mcpState, state.status === 'loading' ? '등록된 외부 MCP 서버를 읽는 중입니다.' : `서버 목록을 읽지 못했습니다 — ${state.message} 서버 없이 열 수 있습니다.`);
    }
    for (const box of mcpBoxes()) box.disabled = m.frozen;
  }

  function resetValues(): void {
    (topic as HTMLInputElement).value = '';
    radios.forEach((r) => (r.checked = r.value === 'plan'));
    syncOpts();
    simRadios.forEach((r) => (r.checked = r.value === 'off'));
    steps.input.value = String(DEFAULT_MAX_STEPS);
    seconds.input.value = String(DEFAULT_MAX_SECONDS);
    tokens.input.value = '';
    for (const box of mcpBoxes()) box.checked = false;
    providerSig = ''; // 다음 updateProviders 가 기본 provider 를 다시 고른다
    (provider as HTMLSelectElement).value = '';
    for (const key of errorEls.keys()) setFieldError(key, null);
  }

  let errorSig = '';
  function updateError(m: NewSessionModel): void {
    const e = m.error;
    banner.hidden = e === null;
    const sig = e === null ? '' : JSON.stringify(e);
    if (sig === errorSig) return;
    errorSig = sig;
    const body = banner.querySelector('.ban-body') as HTMLElement;
    if (e === null) {
      body.replaceChildren();
      return;
    }
    setChildren(body, [
      h('span', {}, e.message),
      e.code ? h('span', { class: 'chip mut mono' }, e.code) : null,
      e.raw ? h('details', { class: 'ev-detail' }, h('summary', {}, '원문'), h('div', { class: 'mono-wrap' }, e.raw)) : null,
    ]);
  }

  return {
    el,
    update(model) {
      current = model;
      if (formKey !== model.formKey) {
        if (formKey !== null) resetValues();
        formKey = model.formKey;
      }
      setText(sid, `session_id 자동 · ${model.sessionId}`);
      (submit as HTMLButtonElement).disabled = !model.canOpen || model.creating;
      submit.setAttribute('aria-busy', model.creating ? 'true' : 'false');
      if (!model.creating) submit.removeAttribute('aria-busy');
      setText(submit, model.creating ? '여는 중…' : '세션 열기');
      blocked.hidden = model.blockedReason === null || model.canOpen;
      setText(blocked.querySelector('span') as HTMLElement, model.blockedReason ?? '');
      frozenNote.hidden = !model.frozen;

      const locked = model.frozen;
      (topic as HTMLInputElement).disabled = locked;
      radios.forEach((r) => (r.disabled = locked || !OPENABLE_AUTONOMIES.includes(r.value as Autonomy)));
      simRadios.forEach((r) => (r.disabled = locked));
      for (const l of [steps, seconds, tokens]) l.input.disabled = locked;
      updateProviders(model);
      updateMcp(model);
      updateError(model);
    },
  };
}
