import { describe, expect, it } from 'vitest';
import { createAgentClient } from '../src/api/client';
import { createDataStore } from '../src/data/store';
import { failResult, fakeCall, okResult, pend, raw, snap } from './helpers';
import type { CallRequest, CallResult } from '../src/api/client';
import type { SessionSnapshot } from '../src/api/types';

interface World {
  sessions: Record<string, SessionSnapshot>;
  entries: Record<string, Array<Record<string, unknown>>>;
  answered: string[];
}

function server(world: World) {
  return fakeCall((req: CallRequest): CallResult<unknown> => {
    const url = new URL(req.path, 'http://x');
    const path = url.pathname.replace('/api/modules/io.terra.agent/v1', '');
    if (req.method === 'GET' && path === '/sessions') return okResult({ sessions: Object.values(world.sessions) });
    const m = /^\/sessions\/([^/]+)(\/messages|\/cancel)?$/.exec(path);
    if (m) {
      const id = m[1] ?? '';
      const session = world.sessions[id];
      if (!session) return failResult(404, 'SESSION_NOT_FOUND');
      if (session.owner !== 'alice') return failResult(403, 'SESSION_NOT_OWNED');
      if (req.method === 'GET' && !m[2]) return okResult(session);
      if (req.method === 'GET' && m[2] === '/messages') {
        const after = Number(url.searchParams.get('after_seq') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 500);
        return okResult({ session_id: id, entries: (world.entries[id] ?? []).filter((e) => (e['seq'] as number) > after).slice(0, limit) });
      }
      if (req.method === 'POST' && m[2] === '/messages') return okResult({ entry: raw(99, 'user') }, 201);
      if (req.method === 'POST' && m[2] === '/cancel') return okResult({ session_id: id, state: 'cancelled' });
    }
    const a = /^\/approvals\/([^/]+)$/.exec(path);
    if (a && req.method === 'POST') {
      const rid = a[1] ?? '';
      if (world.answered.includes(rid)) return failResult(404, 'APPROVAL_NOT_FOUND');
      world.answered.push(rid);
      return okResult({ request_id: rid, session_id: 'mine', operation_id: 'op', decision: 'approved' });
    }
    return failResult(500, 'AGENT_UNAVAILABLE', `unrouted ${req.method} ${req.path}`);
  });
}

function world(): World {
  return {
    sessions: {
      mine: snap({ session_id: 'mine', state: 'waiting-approval', max_seconds: 900, pending_approvals: [pend('apr_1', 'io.terra.node.modules.restart', { input: { module: 'chat' } })] }),
      bobs: snap({ session_id: 'bobs', owner: 'bob', answer: '밥의 비밀 답', pending_approvals: [pend('apr_bob', 'op', { input: { secret: 'x' } })] }),
      ended: snap({ session_id: 'ended', state: 'archived' }),
    },
    entries: {
      mine: [raw(1, 'user', { text: '재시작해줘' }), raw(2, 'model', { sent_bytes: 2048 }), raw(3, 'approval', { request_id: 'apr_1', operation_id: 'io.terra.node.modules.restart' })],
      ended: [raw(1, 'user'), raw(2, 'error', { error_code: 'MODEL_UNAVAILABLE', text: 'x' })],
    },
    answered: [],
  };
}

const setup = (w = world(), viewer: string | null = 'alice') => {
  const s = server(w);
  const store = createDataStore({ client: createAgentClient(s.call), now: () => 1_000_000 + 10_000 });
  if (viewer) store.setViewer(viewer);
  return { store, calls: s.calls, w };
};

describe('데이터 저장소', () => {
  it('목록은 내 세션만 보관한다 — 남의 세션 내용은 상태 어디에도 남지 않는다', async () => {
    const { store } = setup();
    const r = await store.refreshList();
    expect(r.ok).toBe(true);
    expect(store.getState().owned.map((s) => s.session_id).sort()).toEqual(['ended', 'mine']);
    const json = JSON.stringify(store.getState());
    expect(json).not.toContain('밥의 비밀 답');
    expect(json).not.toContain('apr_bob');
  });
  it('viewer 를 모르면 아무것도 보관하지 않는다', async () => {
    const { store } = setup(world(), null);
    await store.refreshList();
    expect(store.getState().owned).toEqual([]);
  });
  it('인박스는 내 세션의 대기 승인이다', async () => {
    const { store } = setup();
    await store.refreshList();
    expect(store.inbox().map((i) => i.approval.request_id)).toEqual(['apr_1']);
  });
  it('세션을 읽으면 스냅샷과 기록이 들어오고 파생 값이 계산된다', async () => {
    const { store } = setup();
    await store.refreshList();
    const r = await store.refreshSession('mine');
    expect(r.ok).toBe(true);
    const view = store.viewOf('mine');
    expect(view?.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(view?.turnCalls).toBe(1);
    expect(view?.sentKB).toBe(2);
    expect(view?.cards.map((c) => [c.requestId, c.state])).toEqual([['apr_1', 'pending']]);
    expect(view?.screen.showApprovalCards).toBe(true);
    expect(view?.screen.inputEnabled).toBe(false);
    expect(view?.cards[0]?.deadline?.approximate).toBe(true);
  });
  it('기록 읽기가 실패해도 스냅샷은 남고 다음에 이어 읽는다(재개)', async () => {
    const w = world();
    const s = server(w);
    let failNext = true;
    const flaky = createAgentClient(async (req) => {
      if (failNext && req.path.includes('/messages')) {
        failNext = false;
        return failResult(504, 'MODULE_INVOCATION_TIMEOUT');
      }
      return s.call(req);
    });
    const store = createDataStore({ client: flaky, now: () => 0 });
    store.setViewer('alice');
    const first = await store.refreshSession('mine');
    expect(first.ok).toBe(false);
    expect(store.viewOf('mine')?.snapshot.session_id).toBe('mine');
    expect(store.viewOf('mine')?.entries).toEqual([]);
    const second = await store.refreshSession('mine');
    expect(second.ok).toBe(true);
    expect(store.viewOf('mine')?.entries).toHaveLength(3);
  });
  it('남의 세션(403 SESSION_NOT_OWNED)은 보관하지 않고 실패를 돌려준다', async () => {
    const { store } = setup();
    const r = await store.refreshSession('bobs');
    expect(r).toMatchObject({ ok: false });
    expect(store.viewOf('bobs')).toBeNull();
  });
  it('응답의 owner 가 viewer 와 다르면(서버가 거르기 전의 방어) 보관하지 않는다', async () => {
    const w = world();
    w.sessions['mine'] = snap({ session_id: 'mine', owner: 'mallory', answer: '새는 답' });
    const s = fakeCall(() => okResult(w.sessions['mine']));
    const store = createDataStore({ client: createAgentClient(s.call), now: () => 0 });
    store.setViewer('alice');
    expect((await store.refreshSession('mine')).ok).toBe(false);
    expect(JSON.stringify(store.getState())).not.toContain('새는 답');
  });
  it('승인을 두 번 누르면 두 번째 404 는 이미 처리됨으로 조용히 받는다', async () => {
    const { store } = setup();
    await store.refreshSession('mine');
    const first = await store.answerApproval('mine', 'apr_1', 'approve');
    expect(first.ok).toBe(true);
    const second = await store.answerApproval('mine', 'apr_1', 'approve');
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.quiet).toBe(true);
  });
  it('대기 승인이 아닌 카드에는 승인 요청을 보내지 않는다(I9)', async () => {
    const w = world();
    w.sessions['mine'] = snap({ session_id: 'mine', state: 'idle', pending_approvals: [] });
    w.entries['mine'] = [raw(1, 'approval', { request_id: 'apr_1' }), raw(2, 'approved', { request_id: 'apr_1' })];
    const { store, calls } = setup(w);
    await store.refreshSession('mine');
    const before = calls.length;
    const r = await store.answerApproval('mine', 'apr_1', 'approve');
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(before);
  });
  it('보내기는 가드를 거친다 — 대기 승인이 있으면 post 하지 않는다', async () => {
    const { store, calls } = setup();
    const r = await store.send('mine', 'y');
    expect(r).toMatchObject({ sent: false, reason: 'pending-approval' });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('종료 상태에서는 취소를 부르지 않는다', async () => {
    const { store, calls } = setup();
    await store.refreshSession('ended');
    const before = calls.length;
    const r = await store.cancel('ended');
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(before);
  });
  it('진행 중 세션은 취소를 부르고 다시 읽는다', async () => {
    const { store, calls } = setup();
    await store.refreshSession('mine');
    const r = await store.cancel('mine');
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/mine/cancel'))).toBe(true);
  });
  it('구독자에게 변화를 알린다', async () => {
    const { store } = setup();
    let n = 0;
    const off = store.subscribe(() => (n += 1));
    await store.refreshList();
    expect(n).toBeGreaterThan(0);
    off();
    const after = n;
    await store.refreshList();
    expect(n).toBe(after);
  });
  it('끝난 세션의 마지막 오류 코드는 기록에서 읽는다', async () => {
    const { store } = setup();
    await store.refreshSession('ended');
    expect(store.viewOf('ended')?.lastError).toMatchObject({ code: 'MODEL_UNAVAILABLE', source: 'record' });
    expect(store.viewOf('ended')?.screen.tab).toBe('ended');
  });
});
