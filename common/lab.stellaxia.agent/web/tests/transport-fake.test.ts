import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeTransport, reply } from '../src/transport/fake';
import type { AgentTransport } from '../src/transport/types';
import { AGENT } from './transport-helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const status = { method: 'GET', path: `${AGENT}/status` } as const;
const list = (after: number) => ({ method: 'GET', path: `${AGENT}/sessions/s1/messages?after_seq=${after}` }) as const;

describe('FakeTransport', () => {
  it('AgentTransport 로 쓸 수 있다', () => {
    const t: AgentTransport = new FakeTransport();
    expect(t.kind).toBe('fake');
  });

  it('on: 늘 같은 답, 제네릭 T 로 받는다', async () => {
    const t = new FakeTransport().on(`GET ${AGENT}/status`, reply.ok({ version: '0.1.0' }));
    const r = await t.request<{ version: string }>(status);
    expect(r.ok && r.data.version).toBe('0.1.0');
    expect((await t.request(status)).ok).toBe(true);
  });

  it('queue: 차례로 한 번씩, 다 쓰면 on, 그것도 없으면 맞는 규칙 없음', async () => {
    const t = new FakeTransport();
    t.queue(status.path, reply.ok(1), reply.ok(2));
    expect(await t.request(status)).toMatchObject({ data: 1 });
    expect(await t.request(status)).toMatchObject({ data: 2 });
    const third = await t.request(status);
    expect(third).toMatchObject({ ok: false, status: 404, error: { code: 'UNKNOWN', rawCode: 'FAKE_NO_RULE' } });
    expect(t.unmatched).toHaveLength(1);
  });

  it('queue 와 on 을 같이: 큐가 먼저', async () => {
    const t = new FakeTransport();
    t.on(status.path, reply.ok('steady')).queue(status.path, reply.ok('first'));
    // 같은 조건으로 on/queue 를 따로 만들면 규칙이 둘이다 — 먼저 만든 규칙(on)이 이긴다
    expect(await t.request(status)).toMatchObject({ data: 'steady' });
  });

  it('응답 함수는 호출 기록을 보고 답한다(본문 의존)', async () => {
    const t = new FakeTransport().on('POST ' + `${AGENT}/sessions`, call => {
      const body = call.body as { session_id: string };
      return reply.ok({ session_id: body.session_id, created: true });
    });
    const r = await t.request({ method: 'POST', path: `${AGENT}/sessions`, body: { session_id: 'abc' } });
    expect(r).toMatchObject({ ok: true, data: { session_id: 'abc', created: true } });
  });

  it('조건: 정규식 · 상세 · 본문 · 함수', async () => {
    const t = new FakeTransport();
    t.on(/after_seq=7$/, reply.ok('re'));
    t.on({ method: 'POST', path: `${AGENT}/runs`, body: b => (b as { prompt?: string }).prompt === 'go' }, reply.ok('body'));
    t.on(req => req.path.endsWith('/models'), reply.ok('fn'));
    expect(await t.request(list(7))).toMatchObject({ data: 're' });
    expect(await t.request({ method: 'POST', path: `${AGENT}/runs`, body: { prompt: 'go' } })).toMatchObject({ data: 'body' });
    expect(await t.request({ method: 'POST', path: `${AGENT}/runs`, body: { prompt: 'no' } })).toMatchObject({ ok: false });
    expect(await t.request({ method: 'GET', path: `${AGENT}/models` })).toMatchObject({ data: 'fn' });
  });

  it('문자열 경로는 쿼리를 무시하고 정확히 맞춘다', async () => {
    const t = new FakeTransport().on(`GET ${AGENT}/sessions/s1/messages`, reply.ok('hit'));
    expect(await t.request(list(3))).toMatchObject({ data: 'hit' });
    expect((await t.request({ method: 'GET', path: `${AGENT}/sessions/s1/messages/extra` })).ok).toBe(false);
  });

  it('otherwise: 맞는 규칙이 없을 때의 기본 답', async () => {
    const t = new FakeTransport().otherwise(reply.ok('default'));
    expect(await t.request(status)).toMatchObject({ data: 'default' });
    expect(t.unmatched).toHaveLength(0);
  });

  it('오류 주입: 모듈·Gateway·브리지·임의 모양이 실제와 같이 정규화된다', async () => {
    const t = new FakeTransport();
    t.queue(status.path, reply.fail(409, 'SESSION_FINISHED'), reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED'), reply.bridgeFail(403, 'BRIDGE_NO_PERMISSIONS'), reply.rawBody(502, '<html>'));
    expect(await t.request(status)).toMatchObject({ error: { code: 'SESSION_FINISHED', source: 'module' } });
    expect(await t.request(status)).toMatchObject({ error: { code: 'MODULE_PERMISSION_DENIED', source: 'gateway' } });
    expect(await t.request(status)).toMatchObject({ error: { code: 'BRIDGE_NO_PERMISSIONS' } });
    expect(await t.request(status)).toMatchObject({ error: { code: 'UNKNOWN', status: 502 } });
  });

  it('지연 주입: 가짜 타이머로 흘려보낸다', async () => {
    const t = new FakeTransport().on(status.path, reply.ok('slow', 200, 3_000));
    let done = false;
    const p = t.request(status).then(r => ((done = true), r));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ data: 'slow' });
  });

  it('시간 제한·검증은 진짜 전송과 같다', async () => {
    const t = new FakeTransport().on(/./, reply.ok(1));
    expect(await t.request({ method: 'GET', path: '/api/v1/gui/apps' })).toMatchObject({ error: { code: 'BRIDGE_PATH_NOT_ALLOWED' } });
    expect(t.callCount()).toBe(0);
  });

  it('호출 기록: 본문은 보낸 시점 값으로 복사된다', async () => {
    const t = new FakeTransport().on(/./, reply.ok(1));
    const body = { text: 'a' };
    await t.request({ method: 'POST', path: `${AGENT}/sessions/s1/messages`, body });
    body.text = 'mutated';
    expect(t.calls[0]).toMatchObject({ seq: 1, method: 'POST', path: `${AGENT}/sessions/s1/messages`, body: { text: 'a' } });
  });

  describe('순서 검증 도우미', () => {
    async function scenario(): Promise<FakeTransport> {
      const t = new FakeTransport().on(/./, reply.ok({}));
      await t.request({ method: 'GET', path: `${AGENT}/sessions/s1` });
      await t.request({ method: 'GET', path: `${AGENT}/sessions/s1/messages?after_seq=0` });
      await t.request({ method: 'POST', path: `${AGENT}/sessions/s1/messages`, body: { text: 'hi' } });
      await t.request({ method: 'GET', path: `${AGENT}/sessions/s1/messages?after_seq=1` });
      return t;
    }

    it('expectOrder: 사이에 다른 호출이 있어도 순서만 맞으면 통과', async () => {
      const t = await scenario();
      t.expectOrder(`GET ${AGENT}/sessions/s1`, `POST ${AGENT}/sessions/s1/messages`, /after_seq=1/);
    });
    it('expectOrder: 순서가 틀리면 어디가 틀렸는지 적어 던진다', async () => {
      const t = await scenario();
      expect(() => t.expectOrder(`POST ${AGENT}/sessions/s1/messages`, `GET ${AGENT}/sessions/s1`)).toThrow(/호출 순서 어긋남/);
    });
    it('expectExactly · expectNever', async () => {
      const t = await scenario();
      expect(() => t.expectExactly(/./, /./, /./, /./)).not.toThrow();
      expect(() => t.expectExactly(/./)).toThrow();
      expect(() => t.expectNever(`POST ${AGENT}/runs`)).not.toThrow();
      expect(() => t.expectNever({ method: 'POST' })).toThrow(/1번/);
    });
    it('callCount · lastCall · callsMatching', async () => {
      const t = await scenario();
      expect(t.callCount({ method: 'GET' })).toBe(3);
      expect(t.lastCall({ method: 'GET' })?.path).toContain('after_seq=1');
      expect(t.callsMatching({ method: 'POST' })).toHaveLength(1);
    });
    it('reset', async () => {
      const t = await scenario();
      t.reset();
      expect(t.calls).toHaveLength(0);
      expect((await t.request(status)).ok).toBe(false); // 규칙도 비워졌다
    });
  });
});
