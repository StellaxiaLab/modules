// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../src/app/boot';
import { FakeTransport, reply, type Timers } from '../src/transport';
import { mountApp, tick, type Mounted } from './dom-helpers';
import { AGENT, T0, World } from './world';

let m: Mounted | null = null;
afterEach(() => {
  m?.dispose();
  m = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const SENT = (t: FakeTransport) => t.callsMatching({ method: 'POST', path: /\/messages$/ });

async function openSession(world: (w: World) => void, id = 's-1'): Promise<Mounted> {
  m = mountApp(world, `#/s/${id}`);
  await m.refresh();
  return m;
}

function type(app: Mounted, text: string): void {
  const ta = app.q<HTMLTextAreaElement>('.inp textarea');
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('앱 통합 — 부팅과 목록·대화', () => {
  it('FakeTransport 로 앱 전체를 부팅한다: 준비 → 목록 → 세션 열기 → 기록 렌더', async () => {
    const world = new World();
    world.addSession('s-1', { topic: '로그 정리', autonomy: 'plan', state: 'idle', usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 } }, [
      ['user', { text: '상태를 알려줘' }],
      ['model', { sent_bytes: 2048 }],
      ['call', { subject: 'terra.gateway.agent.whoami.get', status: 'ok' }],
      ['assistant', { text: '모듈 5개 중 하나가 멈췄습니다.' }],
      ['done', {}],
    ]);
    world.addSession('s-old', { state: 'archived', topic: '지난 세션' });
    world.addSession('s-bob', { owner: 'bob', topic: '밥의 비밀' });
    const transport = world.install(new FakeTransport());
    document.body.innerHTML = '<div id="app"></div>'; // 시험 준비용(앱 소스가 아니다)
    const root = document.getElementById('app') as HTMLElement;
    const booted = boot(root, { transport, manual: true, now: () => T0 });
    expect(booted).not.toBeNull();
    const app = booted!.app;
    await app.refreshOnce();
    await app.flush();

    // 준비 상태 → 헤더의 버전, 사이드바의 칩
    expect(root.textContent).toContain('io.terra.agent 0.1.0');
    expect(root.querySelector('[data-role=readiness-chip]')?.textContent).toContain('준비됨');
    // 목록: 내 세션 탭에는 s-1 만, 남의 세션은 어디에도 없다
    const rows = Array.from(root.querySelectorAll('a.sess')).map((a) => a.querySelector('.sess-title')?.textContent);
    expect(rows).toEqual(['로그 정리']);
    expect(root.textContent).not.toContain('밥의 비밀');

    // 세션 열기
    app.navigate({ name: 'session', id: 's-1' });
    await app.refreshOnce();
    await app.flush();
    expect(root.querySelector('[data-role=log]')?.getAttribute('role')).toBe('log');
    expect(Array.from(root.querySelectorAll('[data-role=log] .line')).map((l) => l.getAttribute('data-kind'))).toEqual(['user', 'model', 'call', 'assistant', 'done']);
    expect(root.querySelector('.ses-title')?.textContent).toBe('로그 정리');
    expect(root.querySelector('[data-role=session-info]')?.textContent).toContain('2 / 24'.slice(0, 1)); // 정보 열이 그려졌다
    expect(transport.unmatched).toEqual([]);
    app.stop();
  });

  it('종료됨 탭: done·cancelled·failed·archived 가 모이고 열면 입력이 잠긴다 (GAP-1)', async () => {
    m = mountApp((w) => {
      for (const state of ['idle', 'running', 'done', 'cancelled', 'failed', 'archived'] as const) w.addSession(`s-${state}`, { state, topic: state });
    });
    await m.refresh();
    expect(m.qa('a.sess .sess-title').map((e) => e.textContent)).toEqual(['idle', 'running']);
    m.q<HTMLButtonElement>('#tab-ended').click();
    await m.settle();
    expect(m.qa('a.sess .sess-title').map((e) => e.textContent)).toEqual(['done', 'cancelled', 'failed', 'archived']);
    expect(m.q('#tab-ended').getAttribute('aria-selected')).toBe('true');
    // 종료된 세션을 열면 입력이 잠기고 취소 버튼이 없다
    m.app.navigate({ name: 'session', id: 's-archived' });
    await m.refresh();
    expect(m.q<HTMLTextAreaElement>('.inp textarea').disabled).toBe(true);
    expect(m.q('[data-role=cancel]').hidden).toBe(true);
    expect(m.q<HTMLTextAreaElement>('.inp textarea').placeholder).toContain('새 세션을 여세요');
  });

  it('세션으로 바로 들어오면 그 세션이 속한 탭이 선택된다', async () => {
    m = mountApp((w) => w.addSession('s-1', { state: 'failed' }), '#/s/s-1');
    await m.refresh();
    expect(m.q('#tab-ended').getAttribute('aria-selected')).toBe('true');
    expect(m.q('a.sess').getAttribute('aria-current')).toBe('page');
  });

  it('권한이 없으면 목록을 부르지 않는다 (viewer 를 모르면 아무것도 보이지 않는다)', async () => {
    m = mountApp((w) => {
      w.modelsReply = reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED');
      w.credentialsReply = reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED');
      w.addSession('s-1');
    });
    await m.refresh();
    m.transport.expectNever({ method: 'GET', path: `${AGENT}/sessions` });
    expect(m.qa('a.sess')).toHaveLength(0);
    expect(m.text('.list-note')).toContain('열린 세션이 없습니다');
  });

  it('인박스: 다른 세션의 승인 대기가 뜨고 누르면 그 세션이 열린다', async () => {
    m = mountApp((w) => {
      w.addSession('s-here', { topic: '여기' });
      w.addSession('s-wait', { topic: '재시작 건', state: 'waiting-approval', pending_approvals: [{ request_id: 'r1', operation_id: 'io.terra.node.modules.restart', created_ms: T0 }] });
    }, '#/s/s-here');
    await m.refresh();
    const inbox = m.q('[data-role=inbox]');
    expect(inbox.hidden).toBe(false);
    expect(inbox.textContent).toContain('승인이 필요합니다');
    expect(inbox.textContent).toContain('io.terra.node.modules.restart');
    expect(m.q('[data-role=pending-chip]').textContent).toContain('승인 대기 1');
    m.q<HTMLAnchorElement>('[data-role=inbox] a').click();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    m.app.navigate({ name: 'session', id: 's-wait' });
    await m.refresh();
    // 지금 연 세션의 대기 승인은 인박스에서 빠진다(대화 안에 있다)
    expect(m.q('[data-role=inbox]').hidden).toBe(true);
    expect(m.q('.ses-title').textContent).toBe('재시작 건');
  });

  it('세션 안의 HTML·{{…}} 는 글자로 나온다 (제목·기록 모두)', async () => {
    const evil = '<img src=x onerror=alert(1)> {{7*7}} <script>alert(2)</script>';
    const app = await openSession((w) => {
      w.addSession('s-1', { topic: evil }, [['user', { text: evil }], ['assistant', { text: evil }], ['error', { text: evil, error_code: 'STEP_LIMIT' }]]);
    });
    expect(app.text('.ses-title')).toBe(evil);
    expect(app.root.querySelector('img')).toBeNull();
    expect(app.root.querySelector('[onerror]')).toBeNull();
    expect(app.qa('script')).toHaveLength(0);
    expect(app.text('[data-kind=user] .me')).toBe(evil);
    expect(app.text('[data-kind=assistant] .tx')).toBe(evil);
  });
});

describe('앱 통합 — 보내기 (화면 7)', () => {
  it('보내기는 store.send 를 지난다: 보내기 직전 sessions.get 으로 확인한 뒤 messages.post, 그리고 새로 읽는다', async () => {
    const app = await openSession((w) => w.addSession('s-1'));
    app.transport.calls.length = 0;
    type(app, '안녕하세요');
    app.q<HTMLButtonElement>('[data-role=send]').click();
    await app.settle();
    app.transport.expectOrder(
      { method: 'GET', path: `${AGENT}/sessions/s-1` },
      { method: 'POST', path: `${AGENT}/sessions/s-1/messages` },
      { method: 'GET', path: /\/sessions\/s-1\/messages\?after_seq/ },
    );
    expect(app.world.posted).toEqual([{ id: 's-1', text: '안녕하세요' }]);
    // 보낸 뒤: 초안이 비고, 상태는 진행 중이라 입력이 잠긴다
    expect(app.q<HTMLTextAreaElement>('.inp textarea').value).toBe('');
    expect(app.q<HTMLTextAreaElement>('.inp textarea').disabled).toBe(true);
    expect(app.q('[data-kind=user]').textContent).toContain('안녕하세요');
  });

  it('연타해도 한 번만 보낸다', async () => {
    const app = await openSession((w) => w.addSession('s-1'));
    type(app, '한 번만');
    const btn = app.q<HTMLButtonElement>('[data-role=send]');
    btn.click();
    btn.click();
    app.q<HTMLTextAreaElement>('.inp textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await app.settle();
    expect(SENT(app.transport)).toHaveLength(1);
  });

  it('승인 대기가 남아 있으면 "y" 가 승인 답으로 읽히지 않게 보내지 않는다 (함정 6)', async () => {
    // 목록·폴링은 낡아 idle 로 보이는데 서버에는 대기 승인이 있다 — 보내기 직전 sessions.get 이 잡는다.
    const app = await openSession((w) => w.addSession('s-1', { state: 'idle' }));
    app.world.setPending('s-1', [{ request_id: 'r1', operation_id: 'op.restart', created_ms: T0 }]);
    app.world.setState('s-1', 'idle', { pending_approvals: [{ request_id: 'r1', operation_id: 'op.restart', created_ms: T0 }] });
    type(app, 'y');
    app.q<HTMLButtonElement>('[data-role=send]').click();
    await app.settle();
    expect(SENT(app.transport)).toHaveLength(0);
    expect(app.text('[data-role=composer-notice]')).toContain('대기 중인 승인이 있습니다');
    expect(app.q<HTMLTextAreaElement>('.inp textarea').value).toBe('y'); // 글은 지우지 않는다
  });

  it('진행 중·승인 대기에서는 입력이 잠긴다', async () => {
    const app = await openSession((w) => w.addSession('s-1', { state: 'running' }));
    expect(app.q<HTMLTextAreaElement>('.inp textarea').disabled).toBe(true);
    expect(app.q<HTMLTextAreaElement>('.inp textarea').placeholder).toBe('모델이 답하는 중');
    app.world.setState('s-1', 'waiting-approval', { pending_approvals: [{ request_id: 'r1', operation_id: 'op', created_ms: T0 }] });
    await app.refresh();
    expect(app.q<HTMLTextAreaElement>('.inp textarea').disabled).toBe(true);
    expect(app.q<HTMLTextAreaElement>('.inp textarea').placeholder).toBe('승인 카드에 답해 주세요');
  });

  it('응답을 못 받은 보내기(outcomeUnknown)는 자동으로 다시 보내지 않고 기록을 읽어 확인하라고 안내한다 (I17)', async () => {
    const app = await openSession((w) => w.addSession('s-1'));
    app.world.postReply = reply.networkError('connection reset');
    app.transport.calls.length = 0;
    type(app, '중요한 글');
    app.q<HTMLButtonElement>('[data-role=send]').click();
    await app.settle();
    await tick();
    expect(SENT(app.transport)).toHaveLength(1); // 재전송 없음
    const note = app.text('[data-role=composer-notice]');
    expect(note).toContain('처리됐는지 알 수 없습니다');
    expect(note).toContain('다시 보내 주세요');
    expect(app.q<HTMLTextAreaElement>('.inp textarea').value).toBe('중요한 글'); // 사람이 다시 누른다
    // 확인을 위해 messages.list 를 읽었다
    const postIndex = app.transport.calls.findIndex((c) => c.method === 'POST');
    expect(app.transport.calls.slice(postIndex + 1).some((c) => c.method === 'GET' && /\/messages\?after_seq/.test(c.path))).toBe(true);
    // 사람이 다시 누르면 그때 한 번 더 간다
    app.world.postReply = null;
    app.q<HTMLButtonElement>('[data-role=send]').click();
    await app.settle();
    expect(SENT(app.transport)).toHaveLength(2);
  });

  it('모듈이 답한 실패(SESSION_BUSY 등)는 사전 문구로 알린다', async () => {
    const app = await openSession((w) => w.addSession('s-1'));
    app.world.postReply = reply.fail(409, 'SESSION_BUSY', 'turn in progress');
    type(app, '글');
    app.q<HTMLButtonElement>('[data-role=send]').click();
    await app.settle();
    expect(app.text('[data-role=composer-notice]')).toContain('모델이 답하는 중입니다');
  });
});

describe('앱 통합 — 취소', () => {
  it('확인창을 거쳐 취소한다: 그대로 두기는 아무것도 부르지 않고, 확정은 한 번 부른다', async () => {
    const app = await openSession((w) => w.addSession('s-1', { state: 'running', topic: '긴 작업' }));
    app.q<HTMLButtonElement>('[data-role=cancel]').click();
    await app.settle();
    const dialog = app.q('[role=dialog]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(app.q('[data-role=cancel-overlay]').hidden).toBe(false);
    expect(dialog.textContent).toContain('긴 작업');
    app.q<HTMLButtonElement>('[data-role=cancel-keep]').click();
    await app.settle();
    expect(app.q('[data-role=cancel-overlay]').hidden).toBe(true);
    expect(app.world.cancelled).toEqual([]);

    app.q<HTMLButtonElement>('[data-role=cancel]').click();
    await app.settle();
    const confirm = app.q<HTMLButtonElement>('[data-role=cancel-confirm]');
    confirm.click();
    confirm.click();
    await app.settle();
    await tick();
    expect(app.world.cancelled).toEqual(['s-1']);
    expect(app.q('[data-role=cancel-overlay]').hidden).toBe(true);
    await app.refresh();
    expect(app.text('[data-role=state-chip]')).toBe('취소됨');
    expect(app.q<HTMLTextAreaElement>('.inp textarea').disabled).toBe(true);
    expect(app.q('[data-role=cancel]').hidden).toBe(true);
  });

  it('종료 상태에서는 취소를 부르지 않는다', async () => {
    const app = await openSession((w) => w.addSession('s-1', { state: 'done' }));
    expect(app.q('[data-role=cancel]').hidden).toBe(true);
    const result = await app.app.store.cancel('s-1');
    expect(result).toEqual({ ok: false, reason: 'terminal' });
    app.transport.expectNever({ method: 'POST', path: /\/cancel$/ });
  });

  it('취소가 실패하면 창이 열린 채 이유를 알린다', async () => {
    const app = await openSession((w) => w.addSession('s-1', { state: 'running' }));
    app.transport.on({ method: 'POST', path: /\/cancel$/ }, reply.fail(404, 'SESSION_NOT_FOUND', 'gone'));
    app.q<HTMLButtonElement>('[data-role=cancel]').click();
    await app.settle();
    app.q<HTMLButtonElement>('[data-role=cancel-confirm]').click();
    await app.settle();
    await tick();
    expect(app.q('[data-role=cancel-overlay]').hidden).toBe(false);
    expect(app.text('.dlg-error')).toContain('세션을 찾을 수 없습니다');
  });
});

describe('앱 통합 — 새 세션 (화면 2)', () => {
  it('plan 으로 멱등 id 를 실어 열고 그 세션으로 이동한다', async () => {
    m = mountApp((w) => void w, '#/new');
    await m.refresh();
    expect(m.q('[data-role=new-session-pane]').hidden).toBe(false);
    const sid = m.text('[data-role=new-session-pane] .pane-head .chip');
    const match = /s-[0-9a-z]+-[0-9a-f]{6}/.exec(sid);
    expect(match).not.toBeNull();
    m.q<HTMLInputElement>('#new-topic').value = '새벽 점검';
    m.q<HTMLButtonElement>('[data-role=open-session]').click();
    m.q<HTMLButtonElement>('[data-role=open-session]').click(); // 두 번 눌러도 한 번
    await m.settle();
    await tick();
    expect(m.world.opened).toHaveLength(1);
    expect(m.world.opened[0]).toEqual({ session_id: match![0], autonomy: 'plan', topic: '새벽 점검' });
    expect(window.location.hash).toBe(`#/s/${match![0]}`);
    expect(m.app.ui().route).toEqual({ name: 'session', id: match![0] });
  });

  it('실패하면 같은 id 로 다시 시도할 수 있다 (멱등)', async () => {
    m = mountApp((w) => void w, '#/new');
    await m.refresh();
    m.transport.queue({ method: 'POST', path: `${AGENT}/sessions` }, reply.fail(409, 'MODEL_NOT_CONFIGURED', 'no model'));
    m.q<HTMLButtonElement>('[data-role=open-session]').click();
    await m.settle();
    await tick();
    expect(m.text('.ban.err')).toContain('등록된 모델이 없습니다');
    m.q<HTMLButtonElement>('[data-role=open-session]').click();
    await m.settle();
    await tick();
    const ids = m.transport.callsMatching({ method: 'POST', path: `${AGENT}/sessions` }).map((c) => (c.body as { session_id: string }).session_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('준비가 안 됐으면 열 수 없다', async () => {
    m = mountApp((w) => {
      w.modelRegistered = false;
    }, '#/new');
    await m.refresh();
    expect(m.q<HTMLButtonElement>('[data-role=open-session]').disabled).toBe(true);
    m.q<HTMLButtonElement>('[data-role=open-session]').click();
    m.q('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await m.settle();
    m.transport.expectNever({ method: 'POST', path: `${AGENT}/sessions` });
  });
});

describe('앱 통합 — 새 세션 폼 (GAP-9)', () => {
  const POST_SESSIONS = { method: 'POST', path: `${AGENT}/sessions` } as const;
  const GET_MCP = { method: 'GET', path: `${AGENT}/mcp/servers` } as const;
  const twoProviders = reply.ok({
    default: 'anthropic',
    providers: [
      { provider: 'anthropic', model: 'test-model', registered: true, default: true },
      { provider: 'other', model: 'm2', registered: true, default: false },
      { provider: 'draft', model: 'm3', registered: false, default: false },
    ],
  });
  const radio = (name: string, value: string): void => {
    const el = (m as Mounted).q<HTMLInputElement>(`input[name=${name}][value=${value}]`);
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const type = (selector: string, value: string): void => {
    const el = (m as Mounted).q<HTMLInputElement>(selector);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const press = async (): Promise<void> => {
    (m as Mounted).q<HTMLButtonElement>('[data-role=open-session]').click();
    await (m as Mounted).settle();
    await tick();
  };

  it('ask·auto 를 열 수 있고 모든 칸이 열기 호출에 실린다 — provider 는 models.list 의 등록된 것에서 고른다', async () => {
    m = mountApp((w) => {
      w.modelsReply = twoProviders;
    }, '#/new');
    await m.refresh();
    const select = m.q<HTMLSelectElement>('#new-provider');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['anthropic', 'other']); // 등록 안 된 draft 는 없다
    expect(m.q<HTMLInputElement>('input[name=autonomy][value=ask]').disabled).toBe(false);
    expect(m.q<HTMLInputElement>('input[name=autonomy][value=unattended]').disabled).toBe(true);
    radio('autonomy', 'ask');
    radio('simulate', 'on');
    type('#new-topic', '점검');
    select.value = 'other';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const box = m.q<HTMLInputElement>('input[name=mcp][value=filesystem]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    type('#new-max-steps', '40');
    type('#new-max-seconds', '1800');
    type('#new-token-budget', '50000');
    await press();
    expect(m.world.opened).toHaveLength(1);
    expect(m.world.opened[0]).toEqual({
      session_id: expect.stringMatching(/^s-/),
      autonomy: 'ask',
      simulate: true,
      topic: '점검',
      provider: 'other',
      mcp_servers: ['filesystem'],
      max_steps: 40,
      max_seconds: 1800,
      token_budget: 50000,
    });
    expect(m.app.ui().route.name).toBe('session');
  });

  it('새 세션 화면에 들어올 때 mcp.list 를 한 번 읽고, 모델 목록은 준비 상태가 읽은 것을 쓴다', async () => {
    m = mountApp(() => {}, '#/new');
    await m.refresh();
    expect(m.transport.callsMatching(GET_MCP)).toHaveLength(1);
    expect(m.qa('[data-role=mcp-item]').map((e) => e.textContent)).toEqual(['filesystem도구 3 · 읽기 전용 2', 'weather도구 1 · 읽기 전용 1']);
  });

  it('mcp.list 가 실패해도 서버 없이 열 수 있고, 다시 읽기로 되살린다', async () => {
    m = mountApp((w) => {
      w.mcpReply = reply.fail(503, 'AGENT_UNAVAILABLE', 'down');
    }, '#/new');
    await m.refresh();
    expect(m.text('[data-role=mcp-state]')).toContain('에이전트 모듈이 지금 처리할 수 없습니다');
    expect(m.qa('[data-role=mcp-item]')).toHaveLength(0);
    m.world.mcpReply = null;
    m.q<HTMLButtonElement>('[data-role=mcp-reload]').click();
    await m.settle();
    await tick();
    expect(m.qa('[data-role=mcp-item]')).toHaveLength(2);
    await press();
    expect(m.world.opened[0]).toEqual({ session_id: expect.stringMatching(/^s-/), autonomy: 'plan' });
  });

  it('틀린 한도는 호출 없이 칸에서 막는다', async () => {
    m = mountApp(() => {}, '#/new');
    await m.refresh();
    type('#new-max-seconds', '9999');
    await press();
    m.transport.expectNever(POST_SESSIONS);
    expect(m.q('#new-max-seconds').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(m.q('#new-max-seconds'));
    expect(m.app.ui().route.name).toBe('new');
  });

  it('MCP_SERVER_UNKNOWN 이면 사전 문구를 보이고 서버 목록을 새로 읽는다 (refresh-servers)', async () => {
    m = mountApp(() => {}, '#/new');
    await m.refresh();
    m.transport.queue(POST_SESSIONS, reply.fail(404, 'MCP_SERVER_UNKNOWN', 'unknown server "x"'));
    const box = m.q<HTMLInputElement>('input[name=mcp][value=weather]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await press();
    expect(m.text('.ban.err')).toContain('등록되지 않은 외부 서버입니다');
    expect(m.text('.ban.err')).toContain('MCP_SERVER_UNKNOWN');
    expect(m.text('.ban.err')).toContain('unknown server "x"'); // 원문은 접힌 상세에 있다
    expect(m.transport.callsMatching(GET_MCP)).toHaveLength(2);
  });

  it('응답을 못 받으면(outcomeUnknown) 값 칸을 잠그고, 같은 id·같은 본문으로만 다시 보낸다', async () => {
    m = mountApp(() => {}, '#/new');
    await m.refresh();
    radio('autonomy', 'auto');
    type('#new-max-steps', '10');
    m.transport.queue(POST_SESSIONS, reply.networkError());
    await press();
    expect(m.text('.ban.err')).toContain('OUTCOME_UNKNOWN');
    expect(m.q('[data-role=frozen-note]').hidden).toBe(false);
    expect(m.q<HTMLInputElement>('#new-max-steps').disabled).toBe(true);
    expect(m.app.ui().route.name).toBe('new');
    await press(); // 세션 열기 다시
    const bodies = m.transport.callsMatching(POST_SESSIONS).map((c) => c.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0]).toMatchObject({ autonomy: 'auto', max_steps: 10 });
    expect(m.app.ui().route.name).toBe('session');
  });

  it('이미 열려 있던 세션이면 처음 값이 유지된다고 알린다 (created:false, I10)', async () => {
    m = mountApp((w) => {
      w.addSession('s-dup', { autonomy: 'plan' });
    }, '#/new');
    await m.refresh();
    m.transport.queue(POST_SESSIONS, reply.ok({ session_id: 's-dup', viewer: 'alice', state: 'idle', autonomy: 'plan', simulate: false, created: false }));
    radio('autonomy', 'auto');
    await press();
    await m.refresh();
    expect(m.app.ui().route).toEqual({ name: 'session', id: 's-dup' });
    expect(m.root.textContent).toContain('이미 열려 있던 세션');
    expect(m.root.textContent).toContain('plan');
  });

  it('두 번 눌러도 한 번만 나간다 (ask)', async () => {
    m = mountApp(() => {}, '#/new');
    await m.refresh();
    radio('autonomy', 'ask');
    m.q<HTMLButtonElement>('[data-role=open-session]').click();
    m.q('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await m.settle();
    await tick();
    expect(m.world.opened).toHaveLength(1);
  });

  it('나갔다 들어오면 폼이 처음 값으로 돌아오고 id 도 새로 만든다', async () => {
    m = mountApp(() => {}, '#/new');
    await m.refresh();
    const first = m.text('[data-role=new-session-pane] .pane-head .chip');
    radio('autonomy', 'auto');
    m.app.navigate({ name: 'home' });
    m.app.navigate({ name: 'new' });
    await m.settle();
    expect(m.q<HTMLInputElement>('input[name=autonomy][value=plan]').checked).toBe(true);
    expect(m.text('[data-role=new-session-pane] .pane-head .chip')).toBeTruthy();
    expect(first).toBeTruthy();
  });
});

describe('앱 통합 — 폴링', () => {
  function manualTimers(): Timers & { pending(): number; fire(): void; lastDelay(): number } {
    const q: Array<{ id: number; fn: () => void; ms: number }> = [];
    let n = 0;
    let last = 0;
    return {
      setTimeout: (fn, ms) => {
        n += 1;
        last = ms;
        q.push({ id: n, fn, ms });
        return n;
      },
      clearTimeout: (h) => {
        const i = q.findIndex((x) => x.id === h);
        if (i >= 0) q.splice(i, 1);
      },
      pending: () => q.length,
      fire: () => q.shift()?.fn(),
      lastDelay: () => last,
    };
  }

  it('상태에 따라 간격이 바뀐다: running 1초 · 승인 대기·유휴 5초', async () => {
    const timers = manualTimers();
    const world = new World();
    world.addSession('s-1', { state: 'running' });
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.append(root);
    window.location.hash = '#/s/s-1';
    const transport = world.install(new FakeTransport());
    const booted = boot(root, { transport, poll: { timers, now: () => T0 }, now: () => T0 });
    const app = booted!.app;
    await tick(6);
    expect(app.scheduler.getState().mode).toBe('running');
    expect(timers.lastDelay()).toBe(1000);
    world.setState('s-1', 'waiting-approval', { pending_approvals: [{ request_id: 'r', operation_id: 'op', created_ms: T0 }] });
    timers.fire();
    await tick(6);
    expect(app.scheduler.getState().mode).toBe('waiting-approval');
    expect(timers.lastDelay()).toBe(5000);
    world.setState('s-1', 'idle', { pending_approvals: [] });
    timers.fire();
    await tick(6);
    expect(app.scheduler.getState().mode).toBe('idle');
    expect(timers.lastDelay()).toBe(5000);
    app.stop();
  });

  it('보이지 않는 탭은 늦춘다 (visibilitychange)', async () => {
    const timers = manualTimers();
    const world = new World();
    world.addSession('s-1');
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.append(root);
    const transport = world.install(new FakeTransport());
    const booted = boot(root, { transport, poll: { timers, now: () => T0 }, now: () => T0 });
    const app = booted!.app;
    await tick(6);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(app.scheduler.getState().hidden).toBe(true);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(app.scheduler.getState().hidden).toBe(false);
    app.stop();
  });

  it('보낸 직후와 취소 직후에 곧바로 새로 읽는다 (refreshNow)', async () => {
    const app = await openSession((w) => w.addSession('s-1'));
    const spy = vi.spyOn(app.app.scheduler, 'refreshNow');
    type(app, '안녕');
    app.q<HTMLButtonElement>('[data-role=send]').click();
    await app.settle();
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    app.q<HTMLButtonElement>('[data-role=cancel]').click();
    await app.settle();
    app.q<HTMLButtonElement>('[data-role=cancel-confirm]').click();
    await app.settle();
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('hash 가 바뀌면 화면이 따라간다', async () => {
    m = mountApp((w) => {
      w.addSession('s-1', { topic: '하나' });
      w.addSession('s-2', { topic: '둘' });
    });
    m.app.start();
    await tick(6);
    window.location.hash = '#/s/s-2';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await tick(6);
    expect(m.app.ui().route).toEqual({ name: 'session', id: 's-2' });
    expect(m.text('.ses-title')).toBe('둘');
  });
});
