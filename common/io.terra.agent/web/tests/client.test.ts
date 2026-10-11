import { describe, expect, it } from 'vitest';
import { API_PREFIX } from '../src/api/types';
import { OPERATIONS, createAgentClient, generateSessionId, isValidSessionId } from '../src/api/client';
import { failResult, fakeCall, loadContract, okResult } from './helpers';

describe('operation 표 = 계약', () => {
  const contract = loadContract();
  it('계약 operation 19건과 표가 양방향으로 같다', () => {
    const contractIds = Object.keys(contract.operations).sort();
    expect(contractIds).toHaveLength(19);
    expect(OPERATIONS.map((o) => o.id).sort()).toEqual(contractIds);
  });
  it('메서드와 경로가 계약의 gateway-http binding 과 한 줄씩 같다', () => {
    for (const op of OPERATIONS) {
      const binding = contract.operations[op.id]?.bindings.find((b) => b.type === 'gateway-http');
      expect(binding, op.id).toBeDefined();
      expect(binding?.method, op.id).toBe(op.method);
      expect(binding?.path, op.id).toBe(API_PREFIX + op.path);
    }
  });
});

describe('요청 모양', () => {
  const setup = (data: unknown = {}) => {
    const f = fakeCall(() => okResult(data));
    return { client: createAgentClient(f.call), calls: f.calls };
  };

  it('statusGet · credentialsGet · modelsList · mcpList · sessionsList 는 본문 없는 GET', async () => {
    const { client, calls } = setup();
    await client.statusGet();
    await client.credentialsGet();
    await client.modelsList();
    await client.mcpList();
    await client.sessionsList();
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', `${API_PREFIX}/status`, undefined],
      ['GET', `${API_PREFIX}/credentials`, undefined],
      ['GET', `${API_PREFIX}/models`, undefined],
      ['GET', `${API_PREFIX}/mcp/servers`, undefined],
      ['GET', `${API_PREFIX}/sessions`, undefined],
    ]);
  });
  it('sessionsGet · sessionsCancel', async () => {
    const { client, calls } = setup();
    await client.sessionsGet('fix-node-3');
    await client.sessionsCancel('fix-node-3');
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['GET', `${API_PREFIX}/sessions/fix-node-3`],
      ['POST', `${API_PREFIX}/sessions/fix-node-3/cancel`],
    ]);
  });
  it('messagesList 는 after_seq·limit 을 쿼리로 보낸다(없으면 쿼리 없음)', async () => {
    const { client, calls } = setup();
    await client.messagesList('s-1');
    await client.messagesList('s-1', { after_seq: 0, limit: 500 });
    await client.messagesList('s-1', { after_seq: 1203 });
    expect(calls.map((c) => c.path)).toEqual([
      `${API_PREFIX}/sessions/s-1/messages`,
      `${API_PREFIX}/sessions/s-1/messages?after_seq=0&limit=500`,
      `${API_PREFIX}/sessions/s-1/messages?after_seq=1203`,
    ]);
  });
  it('messagesPost 는 text 만 본문으로', async () => {
    const { client, calls } = setup();
    await client.messagesPost('s-1', '그 모듈 재시작해줘');
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${API_PREFIX}/sessions/s-1/messages`, body: { text: '그 모듈 재시작해줘' } });
  });
  it('approvalsPost 는 request_id 가 경로, 거부만 본문에 deny:true', async () => {
    const { client, calls } = setup();
    await client.approvalsPost('apr_01', 'approve');
    await client.approvalsPost('apr_01', 'deny');
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${API_PREFIX}/approvals/apr_01`, body: {} });
    expect(calls[1]).toMatchObject({ method: 'POST', path: `${API_PREFIX}/approvals/apr_01`, body: { deny: true } });
  });
  it('sessionsOpen 은 정의된 칸만 보낸다(엄격한 본문)', async () => {
    const { client, calls } = setup();
    await client.sessionsOpen({ session_id: 'a1', autonomy: 'plan', topic: '제목', max_steps: 10, simulate: false });
    expect(calls[0]).toMatchObject({ method: 'POST', path: `${API_PREFIX}/sessions` });
    expect(calls[0]?.body).toEqual({ session_id: 'a1', autonomy: 'plan', topic: '제목', max_steps: 10, simulate: false });
  });
  it('credentialsPut · modelsPut 은 비밀을 본문으로만 보낸다(I2)', async () => {
    const { client, calls } = setup();
    await client.credentialsPut('tsa_example-value-from-terra-agent-grant');
    await client.modelsPut('anthropic', { api_key: 'sk-ant-example-key', default: true });
    expect(calls[0]).toMatchObject({ method: 'PUT', path: `${API_PREFIX}/credentials`, body: { credential: 'tsa_example-value-from-terra-agent-grant' } });
    expect(calls[1]).toMatchObject({ method: 'PUT', path: `${API_PREFIX}/models/anthropic`, body: { api_key: 'sk-ant-example-key', default: true } });
    for (const c of calls) expect(c.path).not.toMatch(/tsa_|sk-ant/);
  });
  it('credentialsDelete · modelsDelete · mcpDelete · mcpPut', async () => {
    const { client, calls } = setup();
    await client.credentialsDelete();
    await client.modelsDelete('anthropic');
    await client.mcpDelete('weather');
    await client.mcpPut('weather', { command: '/usr/local/bin/weather-mcp', args: ['--stdio'] });
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['DELETE', `${API_PREFIX}/credentials`],
      ['DELETE', `${API_PREFIX}/models/anthropic`],
      ['DELETE', `${API_PREFIX}/mcp/servers/weather`],
      ['PUT', `${API_PREFIX}/mcp/servers/weather`],
    ]);
  });
  it('signal 을 전송에 넘긴다', async () => {
    const { client, calls } = setup();
    const ctrl = new AbortController();
    await client.statusGet({ signal: ctrl.signal });
    expect(calls[0]?.signal).toBe(ctrl.signal);
  });
  it('prefix 를 바꿀 수 있다', async () => {
    const f = fakeCall(() => okResult({}));
    await createAgentClient(f.call, { prefix: '/x' }).statusGet();
    expect(f.calls[0]?.path).toBe('/x/status');
  });
  it('전송의 결과를 그대로 돌려준다(성공·실패 모두)', async () => {
    const ok = createAgentClient(fakeCall(() => okResult({ status: 'ok', version: '0.1.0' })).call);
    expect(await ok.statusGet()).toEqual({ ok: true, status: 200, data: { status: 'ok', version: '0.1.0' } });
    const bad = createAgentClient(fakeCall(() => failResult(403, 'MODULE_PERMISSION_DENIED', 'no')).call);
    expect(await bad.sessionsList()).toMatchObject({ ok: false, status: 403, code: 'MODULE_PERMISSION_DENIED' });
  });
});

describe('보내기 전 검증 — 전송을 부르지 않고 INVALID_REQUEST 로 답한다', () => {
  const setup = () => {
    const f = fakeCall(() => okResult({}));
    return { client: createAgentClient(f.call), calls: f.calls };
  };
  it('세션 id 패턴', async () => {
    const { client, calls } = setup();
    for (const id of ['', '-x', '.x', 'a/b', 'a b', 'x'.repeat(129)]) {
      expect(await client.sessionsGet(id)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    }
    expect(await client.sessionsOpen({ session_id: '../etc' })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(calls).toHaveLength(0);
    expect(isValidSessionId('a')).toBe(true);
    expect(isValidSessionId('x'.repeat(128))).toBe(true);
    expect(isValidSessionId('A.b_c-1')).toBe(true);
  });
  it('messagesPost: 빈 글·20000자 초과', async () => {
    const { client, calls } = setup();
    expect(await client.messagesPost('s-1', '  ')).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(await client.messagesPost('s-1', 'a'.repeat(20001))).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(calls).toHaveLength(0);
    await client.messagesPost('s-1', 'a'.repeat(20000));
    expect(calls).toHaveLength(1);
  });
  it('sessionsOpen 범위: max_steps 1~100, max_seconds 1~7200, token_budget ≥ 1, topic ≤ 200', async () => {
    const { client, calls } = setup();
    for (const bad of [{ max_steps: 0 }, { max_steps: 101 }, { max_seconds: 0 }, { max_seconds: 7201 }, { token_budget: 0 }, { topic: 'x'.repeat(201) }, { max_steps: 1.5 }]) {
      expect(await client.sessionsOpen(bad)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    }
    expect(calls).toHaveLength(0);
  });
  it('messagesList 인자 범위', async () => {
    const { client, calls } = setup();
    expect(await client.messagesList('s-1', { after_seq: -1 })).toMatchObject({ ok: false });
    expect(await client.messagesList('s-1', { limit: 0 })).toMatchObject({ ok: false });
    expect(await client.messagesList('s-1', { limit: 5001 })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
  it('짧은 비밀은 보내지 않는다', async () => {
    const { client, calls } = setup();
    expect(await client.credentialsPut('short')).toMatchObject({ ok: false });
    expect(await client.modelsPut('anthropic', { api_key: 'short' })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});

describe('generateSessionId', () => {
  it('패턴을 지키고 호출마다 다르다', () => {
    let n = 0.1;
    const rnd = () => (n = (n * 7.3) % 1);
    const a = generateSessionId(1_700_000_000_000, rnd);
    const b = generateSessionId(1_700_000_000_000, rnd);
    expect(isValidSessionId(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it('난수가 경계값(0, 1)이어도 패턴을 지킨다', () => {
    expect(isValidSessionId(generateSessionId(0, () => 0))).toBe(true);
    expect(isValidSessionId(generateSessionId(1e15, () => 1))).toBe(true);
  });
});
