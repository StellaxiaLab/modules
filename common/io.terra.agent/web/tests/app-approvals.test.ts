// @vitest-environment jsdom
// 승인 카드 통합 — 앱 전체(FakeTransport 위의 가짜 모듈)에서 카드가 그려지고, 한 번만 답하고, 시계가 흐르는 것을 본다.
// 실제 시간에 기대지 않는다: 시계(now)와 타이머는 모두 주입한다.
import { afterEach, describe, expect, it } from 'vitest';
import type { ApprovalContract } from '../src/api/types';
import { reply } from '../src/transport';
import { mountApp, type Mounted } from './dom-helpers';
import { T0, World } from './world';

let m: Mounted | null = null;
afterEach(() => {
  m?.dispose();
  m = null;
  document.body.replaceChildren();
});

const OP = 'io.terra.node.modules.restart';
const CONTRACT: ApprovalContract = { risk: 'dangerous', confirmation_mode: 'conditional', retry_mode: 'never', output_mode: 'accepted-job', side_effects: [{ action: 'restart', resource_id: 'io.terra.chat' }], permissions: ['node.control'] };

function askWorld(w: World, over: { expires?: number | null; contract?: ApprovalContract | null } = {}): void {
  w.addSession('s-1', { topic: '재시작 건', autonomy: 'ask', state: 'waiting-approval' }, [
    ['user', { text: 'chat 모듈을 재시작해줘' }],
    ['model', { sent_bytes: 1024 }],
    ['approval', { request_id: 'r1', operation_id: OP, text: 'CLI: terra agent approve r1' }],
  ]);
  w.setPending('s-1', [
    {
      request_id: 'r1', operation_id: OP, created_ms: T0, reason: 'chat 모듈이 Stopped라 재시작이 필요합니다.', judgement: 'risk dangerous 라 확인이 필요합니다.', input: { module: 'io.terra.chat' },
      ...(over.contract === null ? {} : { contract: over.contract ?? CONTRACT }),
      ...(over.expires === null ? {} : { expires_ms: over.expires ?? T0 + 270_000 }),
    },
  ]);
}

async function open(setup: (w: World) => void = askWorld, manual = false): Promise<Mounted> {
  m = mountApp(setup, '#/s/s-1', { manualTimers: manual });
  if (manual) {
    m.app.start();
    await m.settle();
  }
  await m.refresh();
  return m;
}

const POSTS = (t: Mounted) => t.transport.callsMatching({ method: 'POST', path: /\/approvals\// });
const button = (t: Mounted, role: 'approve' | 'deny') => t.q<HTMLButtonElement>(`[data-card-state=pending] [data-role=${role}]`);

describe('승인 카드 — 앱 통합', () => {
  it('ask 세션의 대기 승인이 계약 사실·모델의 주장·마감과 함께 카드로 나오고 입력은 잠긴다', async () => {
    const t = await open();
    const card = t.q('section.appr');
    expect(card.textContent).toContain(OP);
    expect(card.textContent).toContain('dangerous');
    expect(card.textContent).toContain('chat 모듈이 Stopped라 재시작이 필요합니다.');
    expect(card.querySelector('[data-role=clock-vis]')?.textContent).toBe('4:30');
    expect(card.textContent).not.toContain('terra agent approve'); // approval 줄의 CLI 안내를 쓰지 않는다
    expect(t.q<HTMLTextAreaElement>('.inp textarea').disabled).toBe(true);
    expect(t.q('[data-role=pending-chip]').textContent).toContain('승인 대기 1');
  });

  it('contract 가 없으면(외부 MCP 도구) "읽지 못했다"와 판정 근거만 보인다', async () => {
    const t = await open((w) => askWorld(w, { contract: null }));
    expect(t.q('.facts').textContent).toContain('계약 사실을 읽지 못했습니다');
    expect(t.q('.facts').textContent).toContain('risk dangerous 라 확인이 필요합니다.');
  });

  it('승인: approvals.post 를 한 번, 본문 없이 보내고 카드가 "승인함"이 된다', async () => {
    const t = await open();
    button(t, 'approve').click();
    await t.settle();
    const posts = POSTS(t);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ method: 'POST', body: {} });
    expect(posts[0]?.path).toMatch(/\/approvals\/r1$/);
    expect(t.world.answers).toEqual([{ requestId: 'r1', deny: false }]);
    expect(t.q('[data-request-id=r1]').getAttribute('data-card-state')).toBe('approved');
    expect(t.q('[data-request-id=r1]').textContent).toContain('실행됨이 아닙니다');
    expect(t.root.querySelector('section.appr button')).toBeNull();
  });

  it('거부: deny:true 로 보내고 "거부함"이 된다', async () => {
    const t = await open();
    button(t, 'deny').click();
    await t.settle();
    expect(POSTS(t)[0]).toMatchObject({ body: { deny: true } });
    expect(t.q('[data-request-id=r1]').getAttribute('data-card-state')).toBe('denied');
  });

  it('더블클릭: 응답을 기다리는 동안 몇 번을 눌러도 한 번만 보낸다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const t = await open((w) => {
      askWorld(w);
      w.approvalReply = async () => {
        await gate;
        return null as never;
      };
    });
    const approve = button(t, 'approve');
    const deny = button(t, 'deny');
    approve.click();
    approve.click();
    deny.click();
    await t.settle();
    // 다시 그려진 뒤의 버튼도 꺼져 있다
    expect(button(t, 'approve').disabled).toBe(true);
    expect(button(t, 'deny').disabled).toBe(true);
    expect(button(t, 'approve').textContent).toContain('처리 중');
    button(t, 'approve').click();
    button(t, 'deny').click();
    release();
    await t.settle();
    expect(POSTS(t)).toHaveLength(1);
    expect(t.world.answers).toHaveLength(1);
  });

  it('누른 버튼의 초점이 카드로 옮겨져 자리를 잃지 않는다', async () => {
    const t = await open();
    button(t, 'approve').focus();
    button(t, 'approve').click();
    expect(document.activeElement?.closest('section.appr')?.getAttribute('data-request-id')).toBe('r1');
    expect(document.activeElement?.tagName).toBe('SECTION');
  });

  it('응답을 못 받으면(outcomeUnknown) 자동으로 다시 보내지 않고 세션을 새로 읽어 확인하게 한다', async () => {
    const t = await open((w) => {
      askWorld(w);
      w.approvalReply = reply.networkError();
    });
    const sessionReads = () => t.transport.callsMatching({ method: 'GET', path: /\/sessions\/s-1$/ }).length;
    const before = sessionReads();
    button(t, 'approve').click();
    await t.settle();
    await t.settle();
    expect(POSTS(t)).toHaveLength(1); // 재시도 never
    expect(sessionReads()).toBeGreaterThan(before); // 확인을 위해 새로 읽었다
    const notice = t.q('[data-role=notice]');
    expect(notice.textContent).toContain('자동으로 다시 보내지 않습니다');
    expect(notice.getAttribute('role')).toBe('status');
    // 질문이 아직 열려 있으므로 사람이 다시 누를 수 있다 — 이번엔 서버가 받는다
    t.world.approvalReply = null;
    expect(button(t, 'approve').disabled).toBe(false);
    button(t, 'approve').click();
    await t.settle();
    expect(POSTS(t)).toHaveLength(2);
    expect(t.q('[data-request-id=r1]').getAttribute('data-card-state')).toBe('approved');
  });

  it('응답을 못 받았지만 서버는 받았다면 새로 읽은 뒤 카드가 승인함이 되고 컨트롤이 사라진다', async () => {
    const t = await open(askWorld);
    // 서버는 처리했지만 응답이 유실됐다 — 앱은 아직 대기 카드를 보고 있다
    t.world.approvalReply = reply.networkError();
    const s = t.world.sessions.get('s-1')!;
    t.world.push('s-1', 'approved', { request_id: 'r1' });
    s.snap = { ...s.snap, state: 'running', pending_approvals: [] };
    button(t, 'approve').click();
    await t.settle();
    await t.settle();
    expect(POSTS(t)).toHaveLength(1);
    expect(t.q('[data-request-id=r1]').getAttribute('data-card-state')).toBe('approved');
    expect(t.root.querySelector('section.appr button')).toBeNull();
  });

  it('404 APPROVAL_NOT_FOUND 는 정상 — 조용히 "이미 처리됨"이 되고 오류 안내가 없다', async () => {
    const t = await open((w) => {
      askWorld(w);
      w.approvalReply = reply.fail(404, 'APPROVAL_NOT_FOUND', 'gone');
    });
    button(t, 'approve').click();
    await t.settle();
    expect(t.q('[data-request-id=r1]').getAttribute('data-card-state')).toBe('already-handled');
    expect(t.root.querySelector('[data-role=notice]')).toBeNull();
    expect(t.q('[data-role=log]').querySelector('[role=alert]:not([hidden])')).toBeNull();
  });

  it('그 밖의 실패는 안내를 보이고 컨트롤을 다시 켠다 (재시도는 사람이)', async () => {
    const t = await open((w) => {
      askWorld(w);
      w.approvalReply = reply.fail(403, 'MODULE_PERMISSION_DENIED', 'no');
    });
    button(t, 'approve').click();
    await t.settle();
    expect(t.q('[data-role=notice]').textContent?.length).toBeGreaterThan(0);
    expect(button(t, 'approve').disabled).toBe(false);
    expect(POSTS(t)).toHaveLength(1);
  });

  it('M-2·M-3 이전 모듈: 계약·마감이 없으면 근사 마감이라고 밝힌다', async () => {
    const t = await open((w) => askWorld(w, { contract: null, expires: null }));
    const clock = t.q('[data-role=clock]');
    expect(clock.hasAttribute('data-approximate')).toBe(true);
    expect(clock.querySelector('[data-role=clock-vis]')?.textContent).toMatch(/^약 /);
  });
});

describe('승인 카드 — 카운트다운 (주입한 시계·타이머)', () => {
  it('대기 승인이 있는 동안만 1초 타이머가 서고, 흐를 때 노드와 초점은 그대로다', async () => {
    const t = await open(askWorld, true);
    expect(t.clockTimers.pending).toBe(1);
    const approve = button(t, 'approve');
    approve.focus();
    t.clock.now += 1_000;
    t.clockTimers.fire();
    await t.settle();
    expect(t.q('[data-role=clock-vis]').textContent).toBe('4:29');
    expect(button(t, 'approve')).toBe(approve);
    expect(document.activeElement).toBe(approve);
    expect(t.clockTimers.pending).toBe(1);
    t.clock.now += 60_000;
    t.clockTimers.fire();
    expect(t.q('[data-role=clock-vis]').textContent).toBe('3:29');
  });

  it('인박스의 남은 시간도 같이 흐른다', async () => {
    const t = await open(askWorld, true);
    const inbox = () => t.root.textContent ?? '';
    t.world.addSession('s-2', { topic: '다른 건', autonomy: 'ask', state: 'waiting-approval' });
    t.world.setPending('s-2', [{ request_id: 'r2', operation_id: 'op.two', created_ms: T0, expires_ms: T0 + 130_000 }]);
    t.clock.now += 10_000; // 세션을 열어 둔 동안의 목록 읽기 간격(5초)이 지났다
    await t.app.refreshOnce();
    await t.app.flush();
    expect(inbox()).toContain('2:00 남음');
    t.clock.now += 5_000;
    t.clockTimers.fire();
    expect(inbox()).toContain('1:55 남음');
  });

  it('마감이 지나면 컨트롤이 꺼지고 모듈에 한 번 물어 본다 — 서버가 닫았다고 하면 "시간 초과"', async () => {
    const t = await open((w) => askWorld(w, { expires: T0 + 3_000 }), true);
    const reads = () => t.transport.callsMatching({ method: 'GET', path: /\/sessions\/s-1$/ }).length;
    const before = reads();
    t.clock.now += 3_000;
    t.clockTimers.fire();
    await t.settle();
    await t.settle();
    const card = t.q('section.appr');
    expect(card.getAttribute('data-expired')).toBe('true');
    expect(button(t, 'approve').disabled).toBe(true);
    expect(button(t, 'deny').disabled).toBe(true);
    expect(reads()).toBeGreaterThan(before);
    expect(t.clockTimers.pending).toBe(0); // 더는 흐를 것이 없다
    // 모듈이 질문을 닫았다(denied 줄 없이 TIME_LIMIT)
    const s = t.world.sessions.get('s-1')!;
    t.world.push('s-1', 'error', { error_code: 'TIME_LIMIT', text: 'stopped' });
    s.snap = { ...s.snap, state: 'idle', pending_approvals: [] };
    await t.app.refreshOnce();
    await t.app.flush();
    expect(t.q('[data-request-id=r1]').getAttribute('data-card-state')).toBe('timed-out');
    expect(t.root.querySelector('section.appr')).toBeNull();
  });

  it('같은 만료를 서버에 여러 번 묻지 않는다', async () => {
    const t = await open((w) => askWorld(w, { expires: T0 + 1_000 }), true);
    t.clock.now += 1_000;
    t.clockTimers.fire();
    await t.settle();
    await t.settle();
    const reads = t.transport.callsMatching({ method: 'GET', path: /\/sessions\/s-1$/ }).length;
    // 렌더만 여러 번 일어나도(서버는 계속 대기라고 답한다) 만료 확인을 따로 더 부르지 않는다
    for (let i = 0; i < 3; i += 1) {
      t.clock.now += 1_000;
      t.clockTimers.fire();
      await t.settle();
    }
    expect(t.transport.callsMatching({ method: 'GET', path: /\/sessions\/s-1$/ }).length).toBe(reads);
  });

  it('앱을 멈추면 타이머가 사라진다', async () => {
    const t = await open(askWorld, true);
    expect(t.clockTimers.pending).toBe(1);
    t.app.stop();
    expect(t.clockTimers.pending).toBe(0);
  });

  it('시작하지 않은 앱은 타이머를 세우지 않는다', async () => {
    const t = await open(askWorld, false);
    expect(t.clockTimers.pending).toBe(0);
  });
});
