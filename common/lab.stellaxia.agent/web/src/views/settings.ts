// 화면 6 — 설정(읽기 전용, 보드 ④). 모델 목록 · 위임 자격 · MCP 서버 · 한도 기본값.
//   · 키·자격 문자열·env 값은 어디에도 없다(I1·I19) — 이 화면은 data/settings 가 허용 목록으로 옮긴 사실만 받는다.
//   · 모델 등록·교체·삭제와 MCP 등록·삭제는 이 앱에 없다(R-9·R-11 선행, D-4). 입력칸·쓰기 단추가 없고 터미널로 안내한다.
//   · 자격은 읽기 + "자격 거두기…" 한 단추(대화창은 views/revoke-dialog). 폐기 여부는 모른다(R-10).
// 모든 글은 textContent 로만 넣는다(I7) — 모델 이름·명령·인자에 든 `<b>` 는 글자 그대로 나온다.
import { h, icon, reconcile, setClass, setText } from '../app/dom';
import type { Load, Note, SettingsData } from '../app/settings';
import { CREDENTIAL_CAVEAT } from '../data/readiness';
import { LIMIT_DEFAULTS, expiryText, type CredentialView, type McpRow, type ModelRow } from '../data/settings';
import type { View } from './types';

export interface SettingsModel {
  data: SettingsData;
  nowMs: number;
  /** 아직 끝나지 않은 내 세션 수 — 거두기 1단계의 사실. */
  openCount: number;
  /** 폐기 명령(대리인 id 를 알아볼 수 있을 때만). */
  command: string | null;
}

export interface SettingsHandlers {
  onReload(): void;
  onRevoke(): void;
}

export interface SettingsView extends View<SettingsModel> {
  /** 화면에 들어올 때 초점을 받는 제목. */
  readonly heading: HTMLElement;
  /** 거두기 대화창을 연 단추 — 닫을 때 초점이 돌아간다. */
  readonly revokeButton: HTMLElement;
}

const TERMINAL_MODEL_NOTE =
  '모델 등록·교체·삭제는 이 앱에서 아직 하지 않습니다 — 저장할 때 키를 제공자에 시험하지 않고(R-11) base_url 도 검증하지 않아서(R-9) 노드 전체에 영향이 가는 일을 앱이 안전하게 받칠 수 없습니다. 터미널에서 terra agent model add <provider> --api-key-stdin 으로 하세요. 키는 어디에도 표시하지 않습니다.';
const MCP_TERMINAL_NOTE = '등록·삭제는 노드에 명령 한 줄을 실행할 권한을 주는 일이라 이 앱에 두지 않습니다. 터미널에서 하세요.';

/** 구역 하나의 읽기 상태 — 읽는 중(role=status) / 실패(role=alert, 원문은 접음). 준비되면 null 을 돌려 본문을 그리게 한다. */
function stateSlot(): { el: HTMLElement; set(load: Load<unknown>): boolean } {
  const el = h('div', { class: 'set-state' });
  return {
    el,
    set(load) {
      if (load.status === 'ready') {
        el.replaceChildren();
        return true;
      }
      if (load.status === 'loading') {
        if (el.dataset['kind'] !== 'loading') el.replaceChildren(h('p', { class: 'hint', attrs: { role: 'status' } }, '읽는 중입니다.'));
        el.dataset['kind'] = 'loading';
        return false;
      }
      el.dataset['kind'] = 'failed';
      el.replaceChildren(failureBanner(load.note));
      return false;
    },
  };
}

function failureBanner(note: Note): HTMLElement {
  return h(
    'div',
    { class: 'ban err', attrs: { role: 'alert' } },
    icon('warn'),
    h('div', { class: 'ban-body' }, h('span', {}, note.message), note.raw !== '' ? h('details', { class: 'ev-detail' }, h('summary', {}, '원문'), h('div', { class: 'mono-wrap' }, note.raw)) : null),
  );
}

const sec = (role: string, headingId: string, heading: Array<Node | string>, ...body: Array<Node | null>): HTMLElement =>
  h('section', { class: 'set-sec', attrs: { 'data-role': role, 'aria-labelledby': headingId } }, h('h3', { class: 'cap', attrs: { id: headingId } }, ...heading), ...body);

const sub = (text: string): HTMLElement => h('span', { class: 'cap-sub' }, text);

export function createSettingsView(handlers: SettingsHandlers): SettingsView {
  const heading = h('h2', { class: 'pane-title', attrs: { id: 'settings-title', tabindex: -1 } }, '설정');
  const reload = h('button', { class: 'btn sm', attrs: { type: 'button', 'data-role': 'settings-reload' }, on: { click: () => handlers.onReload() } }, '다시 읽기');
  const back = h('a', { class: 'btn sm', attrs: { href: '#/', 'data-role': 'settings-back' } }, '돌아가기');

  // ── 모델 ──
  const modelState = stateSlot();
  const modelBody = h('tbody', {});
  const modelTable = h(
    'table',
    { class: 'tbl', attrs: { 'aria-labelledby': 'set-models-h' } },
    h('thead', {}, h('tr', {}, ...['제공자', '모델', 'base url', '상태'].map((t) => h('th', { attrs: { scope: 'col' } }, t)))),
    modelBody,
  );
  const modelEmpty = h('p', { class: 'hint', attrs: { hidden: true } }, '등록된 모델이 없습니다.');
  const nodeWide = h(
    'div',
    { class: 'ban warn', attrs: { 'data-role': 'settings-node-wide' } },
    icon('warn'),
    h('span', {}, h('b', {}, '이 노드의 모든 사람에게 적용됩니다.'), ' 모델은 개인 설정이 아니라 노드 설정입니다.'),
  );
  const tableCard = h('div', { class: 'card tbl-card' }, modelTable, modelEmpty);
  const models = sec(
    'settings-models',
    'set-models-h',
    ['등록된 모델'],
    modelState.el,
    tableCard,
    h('div', { class: 'note' }, icon('lock', 's'), h('span', {}, TERMINAL_MODEL_NOTE)),
  );

  // ── 한도 기본값 ──
  const limitItem = (label: string, value: string, hint: string): HTMLElement =>
    h('div', { class: 'limit' }, h('dt', {}, label), h('dd', { class: 'mono big' }, value), h('dd', { class: 'hint' }, hint));
  const limits = sec(
    'settings-limits',
    'set-limits-h',
    ['한도 기본값 ', sub('· 새 세션을 열 때 채워지는 값')],
    h(
      'dl',
      { class: 'card limits-row' },
      limitItem('모델 호출 · 한 차례', String(LIMIT_DEFAULTS.maxSteps), `${LIMIT_DEFAULTS.stepsRange.min} ~ ${LIMIT_DEFAULTS.stepsRange.max}`),
      limitItem('시간 (초)', String(LIMIT_DEFAULTS.maxSeconds), `${LIMIT_DEFAULTS.secondsRange.min} ~ ${LIMIT_DEFAULTS.secondsRange.max} · 승인 대기 포함`),
      limitItem('토큰 예산', LIMIT_DEFAULTS.tokenBudget === null ? '무제한' : String(LIMIT_DEFAULTS.tokenBudget), '입력+출력 누적 · 1 이상'),
    ),
    h('div', { class: 'note' }, icon('info', 's'), h('span', {}, '모듈이 정하는 기본값을 보기만 합니다. 열 때 정한 한도는 그 세션에서 바꿀 수 없고, 올리려면 새 세션입니다.')),
  );

  // ── 자격 ──
  const credState = stateSlot();
  const stateChip = h('span', { class: 'chip mut', attrs: { 'data-role': 'credential-state' } });
  const principal = h('span', { class: 'mono dim' });
  const kv = h('dl', { class: 'kv kv-wide' });
  const caveat = h('div', { class: 'note', attrs: { hidden: true } }, icon('warn', 's'), h('span', {}));
  const none = h('p', { class: 'hint', attrs: { hidden: true } }, '맡겨진 자격이 없습니다. 자격은 사람이 직접 등급과 수명을 정해 맡깁니다 — 준비 상태 화면의 안내를 보세요.');
  const stepCount = h('span', { class: 'dim' });
  const cardCommand = h('span', { class: 'mono', attrs: { 'data-role': 'revoke-command' } });
  const cardCode = h('div', { class: 'code' }, h('i', { attrs: { 'aria-hidden': 'true' } }, '$ '), cardCommand);
  const revokeButton = h('button', { class: 'btn sm dng', attrs: { type: 'button', 'data-role': 'revoke-open', 'aria-haspopup': 'dialog' }, on: { click: () => handlers.onRevoke() } }, icon('key', 's'), '자격 거두기…');
  const stepLi = (n: string, label: string, tag: string, tagClass: string, extra?: Node): HTMLElement =>
    h('li', { class: 'rv-li' }, h('span', { class: 'chip mut mono' }, n), h('span', {}, label), extra ?? null, h('span', { class: `chip ${tagClass} rv-tag` }, tag));
  const steps = h(
    'div',
    { class: 'rv-card', attrs: { hidden: true } },
    h('span', { class: 'sub-cap' }, '거두기 — 이 순서로'),
    h(
      'ol',
      { class: 'rv-list', attrs: { 'data-role': 'revoke-steps' } },
      stepLi('1', '열린 세션 취소', '앱', 'leaf', stepCount),
      stepLi('2', 'Gateway 폐기 — 사람 세션만 할 수 있음', '터미널', 'warn'),
      stepLi('3', '맡긴 자격 삭제', '앱', 'leaf'),
    ),
    cardCode,
    h('div', { class: 'note' }, icon('warn', 's'), h('span', {}, '턴 도중에 거두면 HTTP 오류 없이 호출 줄(call)에 GATEWAY_UNREACHABLE 만 쌓일 수 있습니다. 먼저 세션을 취소하세요.')),
    h('div', { class: 'rv-actions' }, revokeButton),
  );
  const credential = sec(
    'settings-credential',
    'set-cred-h',
    ['위임 자격'],
    credState.el,
    h('div', { class: 'card cred-card' }, h('div', { class: 'rv-row' }, stateChip, principal), kv, caveat, none, steps),
  );

  // ── MCP ──
  const mcpState = stateSlot();
  const mcpList = h('ul', { class: 'mcp-cards' });
  const mcpEmpty = h('p', { class: 'hint', attrs: { hidden: true } }, '등록된 외부 서버가 없습니다.');
  const mcp = sec(
    'settings-mcp',
    'set-mcp-h',
    ['MCP 서버 ', sub('· 읽기 전용')],
    mcpState.el,
    mcpList,
    mcpEmpty,
    h('div', { class: 'note' }, icon('term', 's'), h('span', {}, MCP_TERMINAL_NOTE)),
  );

  const el = h(
    'section',
    { class: 'settings', attrs: { 'aria-labelledby': 'settings-title', 'data-role': 'settings', hidden: true } },
    h('header', { class: 'pane-head' }, heading, h('span', { class: 'chip mut' }, '읽기 전용'), h('span', { class: 'grow' }), reload, back),
    h('div', { class: 'settings-body' }, h('div', { class: 'settings-col' }, nodeWide, models, limits), h('div', { class: 'settings-col' }, credential, mcp)),
  );

  const kvRow = (label: string, ...value: Array<Node | string>): Node[] => [h('dt', {}, label), h('dd', {}, ...value)];
  const chips = (values: readonly string[]): HTMLElement => h('span', { class: 'chips' }, ...values.map((v) => h('span', { class: 'chip mut mono' }, v)));

  function renderModels(rows: readonly ModelRow[]): void {
    reconcile<ModelRow>(modelBody, rows, {
      key: (r) => r.provider,
      create: () =>
        h(
          'tr',
          {},
          h('td', { class: 'mono' }, h('span', { class: 'm-provider' }), ' ', h('span', { class: 'chip ok m-default', attrs: { hidden: true } }, '기본')),
          h('td', { class: 'mono m-model' }),
          h('td', { class: 'mono m-url' }),
          h('td', {}, h('span', { class: 'chip m-reg' })),
        ),
      update: (tr, r) => {
        setText(tr.querySelector('.m-provider') as HTMLElement, r.provider);
        (tr.querySelector('.m-default') as HTMLElement).hidden = !r.isDefault;
        setText(tr.querySelector('.m-model') as HTMLElement, r.model);
        const url = tr.querySelector('.m-url') as HTMLElement;
        setText(url, r.baseUrl === null ? '기본값' : `${r.baseUrl}${r.baseUrlMasked ? ' (일부 가림)' : ''}`);
        url.classList.toggle('dim', r.baseUrl === null);
        const reg = tr.querySelector('.m-reg') as HTMLElement;
        setText(reg, r.registered ? '등록됨' : '키 없음');
        setClass(reg, `chip m-reg ${r.registered ? 'ok' : 'warn'}`);
      },
    });
  }

  function renderMcp(rows: readonly McpRow[]): void {
    reconcile<McpRow>(mcpList, rows, {
      key: (r) => r.name,
      create: () =>
        h(
          'li',
          { class: 'card mcp-card' },
          h('div', { class: 'rv-row' }, icon('cube', 's'), h('b', { class: 'mono mcp-name' }), h('span', { class: 'chip mut mcp-tools' })),
          h('span', { class: 'mono mcp-cmd' }),
          h('div', { class: 'chips mcp-env' }),
        ),
      update: (li, r) => {
        setText(li.querySelector('.mcp-name') as HTMLElement, r.name);
        setText(li.querySelector('.mcp-tools') as HTMLElement, `도구 ${r.tools} · 읽기 전용 ${r.readOnly}`);
        const cmd = li.querySelector('.mcp-cmd') as HTMLElement;
        setText(cmd, r.commandLine);
        cmd.hidden = r.commandLine === '';
        const env = li.querySelector('.mcp-env') as HTMLElement;
        env.replaceChildren(
          ...r.envNames.map((n) => h('span', { class: 'chip mut mono' }, `env: ${n}`)),
          ...(r.envNames.length > 0 ? [h('span', { class: 'chip mut' }, '값은 표시하지 않음')] : []),
          ...(r.dropped > 0 ? [h('span', { class: 'chip warn' }, `제외된 도구 ${r.dropped}`)] : []),
        );
        env.hidden = env.childElementCount === 0;
      },
    });
  }

  function renderCredential(view: CredentialView, model: SettingsModel): void {
    const registered = view.state !== 'none';
    setText(stateChip, view.state === 'none' ? '미등록' : view.state === 'expired' ? '만료됨' : '만료 시각 전');
    setClass(stateChip, `chip ${view.state === 'none' ? 'warn' : view.state === 'expired' ? 'err' : 'ok'}`);
    setText(principal, view.principal ?? '');
    none.hidden = registered;
    kv.hidden = !registered;
    const relative = expiryText(view, model.nowMs);
    kv.replaceChildren(
      ...(registered
        ? [
            ...kvRow('권한', view.permissions.length > 0 ? chips(view.permissions) : '없음'),
            ...kvRow('도달 범위', view.reach === null ? '알 수 없음' : view.reach === 'node' ? 'node (이 노드)' : view.reach),
            ...kvRow('무인', view.unattended ? '무인' : '아님', view.unattended ? (view.preApproved.length > 0 ? chips(view.preApproved) : ' · 사전 승인 없음') : ' · 사전 승인 없음'),
            ...kvRow('대리인', view.delegate ?? (view.delegateUnreadable ? '알아볼 수 없는 형식' : '알 수 없음')),
            ...kvRow('만료', [relative, view.expiresAt ?? '알 수 없음'].filter((t) => t !== '').join(' · ')),
          ]
        : []),
    );
    // 만료 판정은 서버의 expired 다. 만료 전이면 "폐기 여부는 확인하지 못함"을 붙인다(R-10) — "유효"라고 말하지 않는다.
    caveat.hidden = view.state === 'none';
    setText(caveat.querySelector('span') as HTMLElement, view.state === 'active' ? `${CREDENTIAL_CAVEAT}. 폐기·Gateway 재시작은 알 수 없습니다.` : '자격이 만료되었습니다. 다시 맡기려면 사람이 발급해 맡겨야 합니다.');
    steps.hidden = !registered;
    setText(stepCount, model.openCount > 0 ? `열린 세션 ${model.openCount}개` : '열린 세션 없음');
    setText(cardCommand, model.command ?? '');
    // 명령은 대리인 id 를 알아볼 수 있을 때만 DOM 에 둔다. 연 단추는 한 번만 만들어 옮겨 붙인다(초점 유지) — 미등록이면 뗀다.
    if (model.command === null) cardCode.remove();
    else if (!cardCode.parentNode) (steps.querySelector('.rv-list') as HTMLElement).after(cardCode);
    if (!registered && revokeButton.parentNode) revokeButton.remove();
    else if (registered && !revokeButton.parentNode) (steps.querySelector('.rv-actions') as HTMLElement).append(revokeButton);
  }

  return {
    el,
    heading,
    revokeButton,
    update(model) {
      const { data } = model;
      if (modelState.set(data.models)) {
        const ready = data.models.status === 'ready' ? data.models.data : null;
        renderModels(ready?.rows ?? []);
        modelEmpty.hidden = (ready?.rows.length ?? 0) > 0;
        modelTable.hidden = (ready?.rows.length ?? 0) === 0;
        tableCard.hidden = false;
      } else {
        renderModels([]);
        tableCard.hidden = true;
      }
      if (credState.set(data.credential) && data.credential.status === 'ready') {
        renderCredential(data.credential.data, model);
        (credential.querySelector('.cred-card') as HTMLElement).hidden = false;
      } else {
        (credential.querySelector('.cred-card') as HTMLElement).hidden = true;
        if (revokeButton.parentNode) revokeButton.remove();
      }
      if (mcpState.set(data.mcp)) {
        const rows = data.mcp.status === 'ready' ? data.mcp.data : [];
        renderMcp(rows);
        mcpEmpty.hidden = rows.length > 0;
      } else {
        renderMcp([]);
        mcpEmpty.hidden = true;
      }
    },
  };
}
