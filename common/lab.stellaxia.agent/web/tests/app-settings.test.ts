// @vitest-environment jsdom
// 화면 6 — 설정(읽기 전용) + 자격 거두기 3단계 (G3, DC-20). 앱 통합: 가짜 세계 위에서 실제 화면을 돌린다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reply } from '../src/transport';
import { mountApp, type Mounted } from './dom-helpers';

let m: Mounted | null = null;
afterEach(() => {
  m?.dispose();
  m = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function openSettings(setup: Parameters<typeof mountApp>[0] = () => {}): Promise<Mounted> {
  m = mountApp(setup);
  await m.refresh();
  m.app.navigate({ name: 'settings' });
  await m.settle();
  return m;
}

const dialogOf = (app: Mounted): HTMLElement => app.q('[data-role=revoke-overlay] [role=dialog]');
const click = (el: Element): void => (el as HTMLElement).click();
const calls = (app: Mounted, method: string, path: string): number => app.transport.calls.filter((c) => c.method === method && c.path.includes(path)).length;

/** 거두기 대화창을 연다. */
async function openRevoke(app: Mounted): Promise<void> {
  click(app.q('[data-role=revoke-open]'));
  await app.settle();
}

describe('설정 — 진입', () => {
  it('사이드바의 설정 자리가 켜진 링크다(aria-disabled·"아직 없음" 없음) — #/settings 로 간다', async () => {
    m = mountApp();
    await m.refresh();
    const link = m.q('[data-role=settings-link]');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('#/settings');
    expect(link.hasAttribute('aria-disabled')).toBe(false);
    expect(link.textContent).not.toContain('아직 없음');
    expect(link.textContent).toContain('설정');
    expect(link.hasAttribute('aria-current')).toBe(false);
  });

  it('주소가 #/settings 면 설정 화면이 서고 링크가 aria-current=page 다. 다른 화면은 숨는다', async () => {
    const app = await openSettings();
    expect(app.root.dataset['route']).toBe('settings');
    expect(app.q('[data-role=settings]').hidden).toBe(false);
    expect(app.q('[data-role=readiness-guide]').hidden).toBe(true);
    expect(app.q('[data-role=settings-link]').getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#/settings');
  });

  it('들어오면 초점이 설정 제목으로 간다 — 키보드·스크린 리더가 화면이 바뀐 것을 안다', async () => {
    const app = await openSettings();
    const heading = app.q('#settings-title');
    expect(heading.tagName).toBe('H2');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
  });

  it('이름 있는 구역 넷(모델·자격·MCP 서버·한도 기본값)이 제목에 이어져 있다', async () => {
    const app = await openSettings();
    for (const role of ['settings-models', 'settings-credential', 'settings-mcp', 'settings-limits']) {
      const section = app.q(`[data-role=${role}]`);
      const labelled = section.getAttribute('aria-labelledby');
      expect(labelled, role).toBeTruthy();
      expect(app.q(`#${labelled}`).textContent?.trim().length, role).toBeGreaterThan(0);
    }
    expect(app.qa('[data-role=settings] h3').map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['등록된 모델', '한도 기본값 · 새 세션을 열 때 채워지는 값', '위임 자격', 'MCP 서버 · 읽기 전용']);
  });

  it('돌아가기 링크는 #/ 로 간다', async () => {
    const app = await openSettings();
    expect(app.q('[data-role=settings-back]').getAttribute('href')).toBe('#/');
  });
});

describe('설정 — 모델 목록(읽기 전용, 키는 보이지 않는다)', () => {
  it('provider · model · base url · 기본 · 등록 여부를 표로 보인다', async () => {
    const app = await openSettings((w) => {
      w.modelProviders = [
        { provider: 'anthropic', model: 'test-model', base_url: '', registered: true, default: true },
        { provider: 'other', model: 'm2', base_url: 'https://gw.example.test/v1', registered: false, default: false },
      ];
    });
    const rows = app.qa('[data-role=settings-models] tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('anthropic');
    expect(rows[0]?.textContent).toContain('test-model');
    expect(rows[0]?.textContent).toContain('기본값'); // 주소가 비면 "기본값"
    expect(rows[0]?.textContent).toContain('기본');
    expect(rows[0]?.textContent).toContain('등록됨');
    expect(rows[1]?.textContent).toContain('https://gw.example.test/v1');
    expect(rows[1]?.textContent).toContain('키 없음');
    expect(app.qa('[data-role=settings-models] th').map((h) => h.textContent)).toEqual(['제공자', '모델', 'base url', '상태']);
  });

  it('노드 전역 안내가 항상 위에 있고, 등록·교체·삭제는 앱에 없다고 말한다 — 입력칸·삭제 단추가 없다', async () => {
    const app = await openSettings();
    const models = app.q('[data-role=settings-models]');
    expect(app.text('[data-role=settings-node-wide]')).toContain('이 노드의 모든 사람에게 적용됩니다');
    expect(models.textContent).toContain('terra agent model add');
    expect(app.qa('[data-role=settings] input[type=password], [data-role=settings] input[type=text], [data-role=settings] textarea')).toEqual([]);
    expect(app.qa('[data-role=settings-models] button')).toEqual([]);
  });

  it('주소의 사용자 정보·쿼리는 가려서 보인다', async () => {
    const app = await openSettings((w) => {
      w.modelProviders = [{ provider: 'p', model: 'm', base_url: 'https://u:pw-SECRET@gw.example.test/v1?key=SECRET', registered: true, default: true }];
    });
    const row = app.q('[data-role=settings-models] tbody tr');
    expect(row.textContent).toContain('https://gw.example.test/v1');
    expect(row.textContent).toContain('일부 가림');
    expect(app.root.innerHTML).not.toContain('SECRET');
  });

  it('등록된 모델이 없으면 그렇게 말하고 터미널 안내를 준다', async () => {
    const app = await openSettings((w) => {
      w.modelProviders = [];
    });
    expect(app.q('[data-role=settings-models] tbody').children).toHaveLength(0);
    expect(app.text('[data-role=settings-models]')).toContain('등록된 모델이 없습니다');
  });
});

describe('설정 — 비밀은 어디에도 없다(I1·I19)', () => {
  const KEY = 'sk-ant-api03-SETTINGS-LEAK-77';
  const TSA = 'tsa_SETTINGS_LEAK_TOKEN';
  const ENV = 'mcp-env-SETTINGS-LEAK-VALUE';

  it('서버가 계약을 어기고 키·자격·env 값을 실어 보내도 DOM·주소·저장소에 나오지 않고, 쓰기 호출은 하나도 없다', async () => {
    const app = await openSettings((w) => {
      w.modelProviders = [{ provider: 'anthropic', model: 'test-model', base_url: '', registered: true, default: true, api_key: KEY, key_hint: 'sk-…77' }];
      w.credentialFacts = { registered: true, principal: 'alice', delegate: 'agent:agn_1', permissions: ['node.read'], reach: 'node', expires_at: '2030-01-01T00:00:00Z', expired: false, unattended: false, credential: TSA, token: TSA };
      w.mcpServers = [{ name: 'fs', command: 'fs-mcp', args: ['--stdio'], env: { ROOT_TOKEN: ENV }, tools: [{ name: 'read', read_only: true }] }];
    });
    const haystack = [app.root.outerHTML, document.documentElement.outerHTML, document.title, window.location.href];
    try {
      haystack.push(JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }));
    } catch {
      /* 저장소를 못 읽는 환경이면 건너뛴다 */
    }
    for (const needle of [KEY, TSA, ENV, 'sk-ant', 'tsa_', 'SETTINGS-LEAK', 'key_hint']) {
      for (const [i, text] of haystack.entries()) expect(text.includes(needle), `${needle} @${i}`).toBe(false);
    }
    // env 는 이름만 있다
    expect(app.text('[data-role=settings-mcp]')).toContain('ROOT_TOKEN');
    // 설정 화면은 읽기만 한다 — GET 말고는 나간 요청이 없다(거두기 대화창을 열기 전까지)
    expect(app.transport.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('설정 — 자격 상태(credentials.get 의 사실만)', () => {
  it('등록·만료 전: 주체·권한·도달 범위·무인·대리인·만료를 보이고 "폐기 여부는 확인하지 못함"을 쓴다(R-10) — "유효"라고 하지 않는다', async () => {
    const app = await openSettings((w) => {
      w.credentialFacts = { registered: true, principal: 'alice', delegate: 'agent:agn_7f3a91c2', permissions: ['node.read', 'file.read'], reach: 'node', expires_at: '2030-01-01T00:00:00Z', expired: false, unattended: false };
    });
    const card = app.q('[data-role=settings-credential]');
    expect(app.text('[data-role=credential-state]')).toBe('만료 시각 전');
    expect(card.textContent).toContain('alice');
    expect(card.textContent).toContain('node.read');
    expect(card.textContent).toContain('file.read');
    expect(card.textContent).toContain('node (이 노드)');
    expect(card.textContent).toContain('agent:agn_7f3a91c2');
    expect(card.textContent).toContain('아님'); // 무인
    expect(card.textContent).toContain('폐기 여부는 확인하지 못함');
    expect(card.textContent).not.toMatch(/자격 유효|유효합니다/);
    expect(app.q('[data-role=revoke-open]').hasAttribute('disabled')).toBe(false);
  });

  it('무인 자격이면 사전 승인 목록을 보인다', async () => {
    const app = await openSettings((w) => {
      w.credentialFacts = { registered: true, principal: 'alice', delegate: 'agent:agn_1', permissions: ['node.read'], reach: 'node', expires_at: '2030-01-01T00:00:00Z', expired: false, unattended: true, pre_approved: ['terra.daemon.modules.by-module-id.restart.post'] };
    });
    const text = app.text('[data-role=settings-credential]');
    expect(text).toContain('무인');
    expect(text).toContain('terra.daemon.modules.by-module-id.restart.post');
  });

  it('만료됨: 그렇게 말하고, 정리(거두기)는 여전히 할 수 있다', async () => {
    const app = await openSettings((w) => {
      w.credentialExpired = true;
    });
    expect(app.text('[data-role=credential-state]')).toBe('만료됨');
    expect(app.text('[data-role=settings-credential]')).not.toContain('폐기 여부는 확인하지 못함');
    expect(app.q('[data-role=revoke-open]')).toBeTruthy();
  });

  it('미등록: 맡겨진 자격이 없다고 말하고 거두기 단추가 없다', async () => {
    const app = await openSettings((w) => {
      w.credentialRegistered = false;
    });
    expect(app.text('[data-role=credential-state]')).toBe('미등록');
    expect(app.text('[data-role=settings-credential]')).toContain('맡겨진 자격이 없습니다');
    expect(app.qa('[data-role=revoke-open]')).toEqual([]);
  });

  it('거두기 순서(1 열린 세션 취소 → 2 Gateway 폐기 → 3 자격 삭제)와 폐기 명령을 카드에 보인다 — 2단계는 터미널이다', async () => {
    const app = await openSettings((w) => {
      w.addSession('s-a', { state: 'idle' });
      w.addSession('s-b', { state: 'running' });
    });
    await app.refresh();
    const steps = app.qa('[data-role=revoke-steps] li');
    expect(steps).toHaveLength(3);
    expect(steps[0]?.textContent).toContain('열린 세션 취소');
    expect(steps[0]?.textContent).toContain('열린 세션 2개');
    expect(steps[1]?.textContent).toContain('Gateway 폐기');
    expect(steps[1]?.textContent).toContain('터미널');
    expect(steps[2]?.textContent).toContain('맡긴 자격 삭제');
    expect(app.text('[data-role=settings-credential] [data-role=revoke-command]')).toBe('terra agent revoke agn_7f3a91c2');
    expect(app.text('[data-role=settings-credential]')).toContain('GATEWAY_UNREACHABLE');
  });
});

describe('설정 — MCP 서버(읽기 전용, D-4)', () => {
  it('이름·명령·도구 수·읽기 전용 수·env 이름을 보이고 값은 표시하지 않는다고 쓴다', async () => {
    const app = await openSettings();
    const text = app.text('[data-role=settings-mcp]');
    expect(text).toContain('filesystem');
    expect(text).toContain('/usr/bin/fs-mcp');
    expect(text).toContain('도구 3 · 읽기 전용 2');
    expect(text).toContain('env: FS_ROOT');
    expect(text).toContain('값은 표시하지 않음');
    expect(text).toContain('weather');
    expect(text).toContain('도구 1 · 읽기 전용 1');
  });

  it('등록·삭제 단추가 없고, 터미널에서 하라고 안내한다 — mcp.put·mcp.delete 는 부르지 않는다', async () => {
    const app = await openSettings();
    const section = app.q('[data-role=settings-mcp]');
    expect(section.querySelectorAll('button, input, textarea, select, a[href]')).toHaveLength(0);
    expect(section.textContent).toContain('이 앱에 두지 않습니다');
    expect(section.textContent).toContain('터미널');
    expect(app.transport.calls.some((c) => c.path.includes('/mcp/servers') && c.method !== 'GET')).toBe(false);
  });

  it('서버가 없으면 그렇게 말한다', async () => {
    const app = await openSettings((w) => {
      w.mcpServers = [];
    });
    expect(app.text('[data-role=settings-mcp]')).toContain('등록된 외부 서버가 없습니다');
  });
});

describe('설정 — 한도 기본값', () => {
  it('새 세션 폼이 채우는 값(24 · 900 · 무제한)과 범위를 보이고, 고치는 칸은 없다', async () => {
    const app = await openSettings();
    const text = app.text('[data-role=settings-limits]');
    expect(text).toContain('24');
    expect(text).toContain('1 ~ 100');
    expect(text).toContain('900');
    expect(text).toContain('1 ~ 7200');
    expect(text).toContain('무제한');
    expect(text).toContain('승인 대기 포함');
    expect(app.qa('[data-role=settings-limits] input, [data-role=settings-limits] button')).toEqual([]);
  });
});

describe('설정 — 읽기 실패는 구역마다 따로, role=alert 로', () => {
  it('모델 목록만 실패해도 다른 구역은 그대로 서고, 실패는 사전 문구로 알린다', async () => {
    const app = await openSettings((w) => {
      w.modelsReply = reply.fail(503, 'AGENT_UNAVAILABLE', 'raw english failure');
    });
    const alert = app.q('[data-role=settings-models] [role=alert]');
    expect(alert.textContent).toContain('에이전트 모듈이 지금 처리할 수 없습니다');
    expect(app.text('[data-role=settings-credential]')).toContain('alice');
    expect(app.text('[data-role=settings-mcp]')).toContain('filesystem');
  });

  it('읽기가 권한 없음(403)이면 사전의 권한 안내를 쓴다. 영어 원문은 접힌 상세에만 있다', async () => {
    const app = await openSettings((w) => {
      w.credentialsReply = reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED', 'permission denied RAW');
    });
    const alert = app.q('[data-role=settings-credential] [role=alert]');
    expect(alert.textContent).toContain('agent.use 권한이 없거나');
    const details = alert.querySelector('details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain('permission denied RAW');
  });

  it('"다시 읽기"는 세 목록을 다시 읽고 실패가 풀리면 알림이 사라진다', async () => {
    const app = await openSettings((w) => {
      w.modelsReply = reply.fail(503, 'AGENT_UNAVAILABLE');
    });
    expect(app.qa('[data-role=settings-models] [role=alert]')).toHaveLength(1);
    app.world.modelsReply = null;
    const before = calls(app, 'GET', '/mcp/servers');
    click(app.q('[data-role=settings-reload]'));
    await app.settle();
    expect(app.qa('[data-role=settings-models] [role=alert]')).toEqual([]);
    expect(calls(app, 'GET', '/mcp/servers')).toBe(before + 1);
    expect(app.qa('[data-role=settings-models] tbody tr')).toHaveLength(1);
  });

  it('읽는 중에는 "읽는 중입니다"를 role=status 로 말한다', async () => {
    m = mountApp((w) => {
      w.mcpReply = reply.hang();
    });
    await m.refresh();
    m.app.navigate({ name: 'settings' });
    await new Promise((r) => setTimeout(r, 5));
    const status = m.q('[data-role=settings-mcp] [role=status]');
    expect(status.textContent).toContain('읽는 중');
  });
});

describe('자격 거두기 — 확인 단계(DC-20, R-10)', () => {
  it('대화창을 연다: role=dialog · aria-modal · 이름·설명, 초점은 안전한 "닫기", 바깥 화면은 inert', async () => {
    const app = await openSettings();
    const opener = app.q('[data-role=revoke-open]');
    opener.focus();
    await openRevoke(app);
    const dlg = dialogOf(app);
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(app.q(`#${dlg.getAttribute('aria-labelledby')}`).textContent).toContain('위임 자격을 거둘까요?');
    expect(app.q(`#${dlg.getAttribute('aria-describedby')}`).textContent?.length).toBeGreaterThan(20);
    expect(app.q('[data-role=revoke-overlay]').hidden).toBe(false);
    expect(document.activeElement).toBe(app.q('[data-role=revoke-close]'));
    expect(app.q('[data-role=app]').hasAttribute('inert')).toBe(true);
  });

  it('확인 단계에 "폐기 여부는 확인하지 못함"(R-10)과 턴 도중 GATEWAY_UNREACHABLE 안내(HTTP 오류 없음)와 폐기 명령이 있다', async () => {
    const app = await openSettings();
    await openRevoke(app);
    const text = dialogOf(app).textContent ?? '';
    expect(text).toContain('폐기 여부는 확인하지 못합니다');
    expect(text).toContain('GATEWAY_UNREACHABLE');
    expect(text).toContain('HTTP 오류');
    expect(text).toContain('사람 세션만');
    expect(app.text('[data-role=revoke-overlay] [data-role=revoke-command]')).toBe('terra agent revoke agn_7f3a91c2');
  });

  it('삭제는 잠겨 있다: aria-disabled 이고 눌러도 아무 호출도 나가지 않는다 — 열린 세션 취소·폐기 확인 전', async () => {
    const app = await openSettings((w) => {
      w.addSession('s-a', { state: 'idle' });
    });
    await app.refresh();
    await openRevoke(app);
    const del = app.q('[data-role=revoke-delete]');
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(app.q(`#${del.getAttribute('aria-describedby')}`).textContent).toContain('세션');
    click(del);
    await app.settle();
    expect(app.world.credentialDeletes).toBe(0);
  });

  it('열린 세션이 없고 "폐기를 마쳤습니다"를 확인하면 삭제가 풀린다 — 둘 중 하나라도 빠지면 잠겨 있다', async () => {
    const app = await openSettings();
    await openRevoke(app);
    const del = app.q('[data-role=revoke-delete]');
    expect(app.text('[data-role=revoke-open-count]')).toContain('열린 세션이 없습니다');
    expect(del.getAttribute('aria-disabled')).toBe('true'); // 폐기 확인 전
    const box = app.q<HTMLInputElement>('[data-role=revoke-confirmed]');
    expect(box.type).toBe('checkbox');
    expect(app.root.querySelector(`label[for="${box.id}"]`)?.textContent).toContain('폐기를 마쳤습니다');
    box.click();
    await app.settle();
    expect(del.getAttribute('aria-disabled')).toBe('false');
    box.click();
    await app.settle();
    expect(del.getAttribute('aria-disabled')).toBe('true');
  });

  it('1단계: 열린 세션을 모두 취소하면 개수가 0이 되고 삭제 조건이 하나 풀린다 — 이미 끝난 세션은 건드리지 않는다', async () => {
    const app = await openSettings((w) => {
      w.addSession('s-a', { state: 'idle' });
      w.addSession('s-b', { state: 'running' });
      w.addSession('s-done', { state: 'done' });
    });
    await app.refresh();
    await openRevoke(app);
    expect(app.text('[data-role=revoke-open-count]')).toContain('열린 세션 2개');
    click(app.q('[data-role=revoke-cancel-sessions]'));
    await app.settle();
    expect([...app.world.cancelled].sort()).toEqual(['s-a', 's-b']);
    expect(app.text('[data-role=revoke-open-count]')).toContain('열린 세션이 없습니다');
    expect(app.qa('[data-role=revoke-cancel-sessions]')).toEqual([]);
    expect(app.q('[data-role=revoke-delete]').getAttribute('aria-disabled')).toBe('true'); // 폐기 확인이 남았다
  });

  it('세션 취소가 일부 실패하면 role=alert 로 알리고 남은 개수를 보인다. 삭제는 잠긴 채다', async () => {
    const app = await openSettings((w) => {
      w.addSession('s-a', { state: 'idle' });
    });
    await app.refresh();
    app.transport.on({ method: 'POST', path: /\/sessions\/s-a\/cancel/ }, reply.fail(503, 'AGENT_UNAVAILABLE', 'raw'));
    await openRevoke(app);
    click(app.q('[data-role=revoke-cancel-sessions]'));
    await app.settle();
    expect(app.q('[data-role=revoke-error]').getAttribute('role')).toBe('alert');
    expect(app.text('[data-role=revoke-error]')).toContain('에이전트 모듈이 지금 처리할 수 없습니다');
    expect(app.text('[data-role=revoke-open-count]')).toContain('열린 세션 1개');
    expect(app.q('[data-role=revoke-delete]').getAttribute('aria-disabled')).toBe('true');
  });

  it('닫혀 있을 때는 이 대화창이 DOM 에 없다 — 세션 취소 확인창과 둘째 대화창으로 겹치지 않고, 단추·글이 다른 화면의 탐색에 끼지 않는다', async () => {
    const app = await openSettings();
    const mine = (): Element[] => app.qa('[data-role=revoke-overlay] *');
    expect(mine()).toEqual([]);
    const others = app.qa('[role=dialog]').length; // 세션 취소 확인창(닫혀 있어도 DOM 에 있다)
    await openRevoke(app);
    expect(app.qa('[data-role=revoke-overlay] [role=dialog]')).toHaveLength(1);
    expect(app.qa('[role=dialog]')).toHaveLength(others + 1);
    dialogOf(app).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await app.settle();
    expect(mine()).toEqual([]);
    expect(app.qa('[role=dialog]')).toHaveLength(others);
    // 다시 열면 상태가 처음 값이다
    await openRevoke(app);
    expect(app.qa<HTMLInputElement>('[data-role=revoke-confirmed]')[0]?.checked).toBe(false);
  });

  it('Esc 로 닫으면 대화창은 닫히고 초점은 연 단추로 돌아온다. 아무것도 지워지지 않는다', async () => {
    const app = await openSettings();
    const opener = app.q('[data-role=revoke-open]');
    opener.focus();
    await openRevoke(app);
    dialogOf(app).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await app.settle();
    expect(app.q('[data-role=revoke-overlay]').hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(app.q('[data-role=app]').hasAttribute('inert')).toBe(false);
    expect(app.world.credentialDeletes).toBe(0);
  });

  it('Tab 은 대화창 안에서만 돈다', async () => {
    const app = await openSettings();
    await openRevoke(app);
    const stops = ['[data-role=revoke-close]', '[data-role=revoke-copy]', '[data-role=revoke-confirmed]', '[data-role=revoke-delete]'].map((s) => app.q(s));
    // DOM 순서가 곧 Tab 순서다: 닫기 → 폐기 명령 복사 → 폐기 확인 → 삭제
    for (let i = 1; i < stops.length; i += 1) expect((stops[i - 1] as HTMLElement).compareDocumentPosition(stops[i] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING, `stop ${i}`).toBeTruthy();
    stops[stops.length - 1]?.focus();
    dialogOf(app).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(stops[0]);
    stops[0]?.focus();
    dialogOf(app).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });

  it('2단계: 폐기 명령 복사 — 복사되면 role=status 로 알린다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const app = await openSettings();
    await openRevoke(app);
    click(app.q('[data-role=revoke-copy]'));
    await app.settle();
    expect(writeText).toHaveBeenCalledWith('terra agent revoke agn_7f3a91c2');
    expect(app.q('[data-role=revoke-copy-note]').getAttribute('role')).toBe('status');
    expect(app.text('[data-role=revoke-copy-note]')).toContain('복사했습니다');
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('복사가 막힌 환경(sandbox)이면 명령을 선택해 두고 직접 복사하라고 말한다', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    const app = await openSettings();
    await openRevoke(app);
    click(app.q('[data-role=revoke-copy]'));
    await app.settle();
    expect(app.text('[data-role=revoke-copy-note]')).toContain('복사하지 못했습니다');
    expect(app.text('[data-role=revoke-copy-note]')).toContain('직접 복사');
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('대리인 id 를 알아볼 수 없으면 명령을 만들지 않고 그렇게 말한다(셸에 붙이는 글이라 걸러 낸다)', async () => {
    const app = await openSettings((w) => {
      w.credentialFacts = { registered: true, principal: 'alice', delegate: 'agent:agn_1; rm -rf /', permissions: [], reach: 'node', expires_at: '2030-01-01T00:00:00Z', expired: false, unattended: false };
    });
    await openRevoke(app);
    expect(app.qa('[data-role=revoke-command]')).toEqual([]);
    expect(dialogOf(app).textContent).toContain('대리인 id 를 확인하지 못해 명령을 만들지 못했습니다');
    expect(app.qa('[data-role=revoke-copy]')).toEqual([]);
    expect(app.root.innerHTML).not.toContain('rm -rf');
  });
});

describe('자격 거두기 — 3단계 삭제', () => {
  async function ready(app: Mounted): Promise<void> {
    await openRevoke(app);
    click(app.q('[data-role=revoke-confirmed]'));
    await app.settle();
  }

  it('모두 갖추고 누르면 DELETE /credentials 가 정확히 한 번 나가고, 결과에 "Gateway 폐기는 아직입니다"와 명령이 남는다', async () => {
    const app = await openSettings();
    await ready(app);
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    expect(app.world.credentialDeletes).toBe(1);
    const result = app.q('[data-role=revoke-result]');
    expect(result.getAttribute('role')).toBe('status');
    expect(result.textContent).toContain('맡긴 자격을 삭제했습니다');
    expect(result.textContent).toContain('Gateway 폐기는 아직입니다');
    expect(result.textContent).toContain('폐기 여부는 확인하지 못합니다');
    expect(app.text('[data-role=revoke-overlay] [data-role=revoke-command]')).toBe('terra agent revoke agn_7f3a91c2');
    // 결과 화면: 삭제·폐기 확인 칸은 사라지고 복사·닫기만 남는다
    expect(app.qa('[data-role=revoke-delete]')).toEqual([]);
    expect(app.qa('[data-role=revoke-copy]')).toHaveLength(1);
    // 초점은 결과 제목으로
    expect(document.activeElement).toBe(app.q('[data-role=revoke-overlay] [data-role=revoke-title]'));
  });

  it('삭제 뒤: 설정의 자격 카드는 "미등록", 준비 상태는 막히고 세션 목록은 비는다. 닫으면 초점이 제자리로 돌아온다', async () => {
    const app = await openSettings((w) => {
      w.addSession('s-a', { state: 'done' });
    });
    await app.refresh();
    await ready(app);
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    click(app.q('[data-role=revoke-close]'));
    await app.settle();
    expect(app.q('[data-role=revoke-overlay]').hidden).toBe(true);
    expect(app.text('[data-role=credential-state]')).toBe('미등록');
    expect(app.qa('[data-role=revoke-open]')).toEqual([]);
    expect(app.text('[data-role=readiness-chip]')).toContain('준비 안 됨');
    expect(app.q('[data-role=new-session]').getAttribute('aria-disabled')).toBe('true');
    expect(app.qa('a.sess')).toEqual([]);
    // 연 단추가 사라졌으므로 초점은 설정 제목에 안착한다
    expect(document.activeElement).toBe(app.q('#settings-title'));
  });

  it('연타해도 DELETE 는 한 번이다(처리 중 가드)', async () => {
    const app = await openSettings();
    await ready(app);
    app.world.deleteReply = (() => {
      return new Promise((resolve) => setTimeout(() => resolve(reply.ok({ removed: true })), 10));
    }) as never;
    const del = app.q('[data-role=revoke-delete]');
    click(del);
    click(del);
    click(del);
    await app.settle();
    await new Promise((r) => setTimeout(r, 30));
    await app.settle();
    expect(app.world.credentialDeletes).toBe(1);
  });

  it('처리 중에는 모든 단추가 잠기고 "삭제하는 중…" 이다. Esc 로도 닫히지 않는다', async () => {
    const app = await openSettings();
    await ready(app);
    let release: () => void = () => {};
    app.world.deleteReply = (() =>
      new Promise((resolve) => {
        release = () => resolve(reply.ok({ removed: true }));
      })) as never;
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    expect(app.text('[data-role=revoke-delete]')).toContain('삭제하는 중');
    expect(app.q('[data-role=revoke-close]').hasAttribute('disabled')).toBe(true);
    dialogOf(app).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await app.settle();
    expect(app.q('[data-role=revoke-overlay]').hidden).toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 5));
    await app.settle();
    expect(app.text('[data-role=revoke-result]')).toContain('삭제했습니다');
  });

  it('이미 지워져 있었다면(removed:false) 그렇게 말한다', async () => {
    const app = await openSettings();
    await ready(app);
    app.world.deleteReply = reply.ok({ removed: false });
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    expect(app.text('[data-role=revoke-result]')).toContain('이미 맡겨진 자격이 없었습니다');
  });

  it('실패(403 등)는 대화창 안에 role=alert 로 사전 문구를 쓰고 원문은 접는다. 대화창은 열려 있고 다시 누를 수 있다', async () => {
    const app = await openSettings();
    await ready(app);
    app.world.deleteReply = reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED', 'RAW english denial');
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    const alert = app.q('[data-role=revoke-error]');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('agent.use 권한이 없거나');
    expect(alert.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(alert.querySelector('details')?.textContent).toContain('RAW english denial');
    expect(app.q('[data-role=revoke-overlay]').hidden).toBe(false);
    expect(app.q('[data-role=revoke-delete]').getAttribute('aria-disabled')).toBe('false');
    expect(app.world.credentialDeletes).toBe(1); // 자동 재전송 없음
  });
});

describe('자격 거두기 — 응답 유실(outcomeUnknown, 재시도 never)', () => {
  async function ready(app: Mounted): Promise<void> {
    await openRevoke(app);
    click(app.q('[data-role=revoke-confirmed]'));
    await app.settle();
  }

  it('응답을 못 받으면 다시 보내지 않고 자격을 다시 읽어 확인한다: 지워졌으면 "응답은 못 받았지만 삭제를 확인"', async () => {
    const app = await openSettings();
    await ready(app);
    app.world.deleteReply = (() => {
      app.world.credentialRegistered = false; // 서버는 처리했고 응답만 잃었다
      return reply.networkError('connection reset');
    }) as never;
    const reads = calls(app, 'GET', '/credentials');
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    expect(app.world.credentialDeletes).toBe(1);
    expect(calls(app, 'GET', '/credentials')).toBeGreaterThan(reads); // 자격을 다시 읽었다
    const result = app.q('[data-role=revoke-result]');
    expect(result.textContent).toContain('응답은 받지 못했지만');
    expect(result.textContent).toContain('삭제된 것을 확인했습니다');
    expect(result.textContent).toContain('Gateway 폐기는 아직입니다');
  });

  it('응답을 못 받았고 자격이 아직 남아 있으면 "삭제되지 않았습니다"를 role=alert 로 알린다 — 자동 재전송 없이 사람이 다시 누른다', async () => {
    const app = await openSettings();
    await ready(app);
    app.world.deleteReply = reply.networkError('connection reset');
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    const alert = app.q('[data-role=revoke-error]');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('응답을 받지 못했습니다');
    expect(alert.textContent).toContain('아직 남아 있습니다');
    expect(alert.textContent).toContain('자동으로 다시 보내지 않았습니다');
    expect(app.world.credentialDeletes).toBe(1);
    expect(app.q('[data-role=revoke-overlay]').hidden).toBe(false);
    // 사람이 다시 누르면 그때 한 번 더 나간다
    app.world.deleteReply = null;
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    expect(app.world.credentialDeletes).toBe(2);
    expect(app.text('[data-role=revoke-result]')).toContain('삭제했습니다');
  });

  it('응답도 못 받고 확인 읽기도 실패하면 결과를 모른다고 말한다', async () => {
    const app = await openSettings();
    await ready(app);
    app.world.deleteReply = (() => {
      app.world.credentialsReply = reply.networkError('still down');
      return reply.networkError('connection reset');
    }) as never;
    click(app.q('[data-role=revoke-delete]'));
    await app.settle();
    const alert = app.q('[data-role=revoke-error]');
    expect(alert.textContent).toContain('삭제됐는지 확인하지 못했습니다');
    expect(app.world.credentialDeletes).toBe(1);
  });
});

describe('설정 — 쓰기 범위 밖(이번 범위에서 하지 않는 것)', () => {
  it('모델 등록·교체·삭제, MCP 등록·삭제의 요청은 어떤 조작으로도 나가지 않는다', async () => {
    const app = await openSettings();
    for (const b of app.qa<HTMLButtonElement>('[data-role=settings] button')) {
      expect(b.textContent, '모델/MCP 쓰기 단추가 있다').not.toMatch(/모델 (등록|교체|삭제)|MCP (등록|삭제)|서버 (등록|삭제)/);
    }
    await openRevoke(app);
    expect(app.transport.calls.filter((c) => /\/(models|mcp)\b/.test(c.path) && c.method !== 'GET')).toEqual([]);
  });
});
