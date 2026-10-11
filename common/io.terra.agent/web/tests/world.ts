// 시험용 가짜 Gateway·모듈 세계 — FakeTransport 위에 operation 을 흉내 낸다. 시험 파일이 아니다(include 는 *.test.ts).
// 실제 모듈의 응답 모양(contracts/api/terra-api.json)을 따르되 필요한 것만 구현한다. 모델 식별자 대신 'test-model' 을 쓴다.
import type { ApprovalContract, PendingApproval, SessionSnapshot, SessionState } from '../src/api/types';
import { FakeTransport, reply, type FakeReply, type RecordedCall } from '../src/transport';

export const AGENT = '/api/modules/io.terra.agent/v1';
export const T0 = 1_700_000_000_000;

export interface WorldSession {
  snap: SessionSnapshot;
  entries: Record<string, unknown>[];
}

export class World {
  viewer = 'alice';
  statusReply: FakeReply | null = null;
  modelsReply: FakeReply | null = null;
  credentialsReply: FakeReply | null = null;
  listReply: FakeReply | null = null;
  /** messages.post 의 답을 덮는다(실패 시험). */
  postReply: FakeReply | null = null;
  version = '0.1.0';
  delegateDoor = true;
  modelRegistered = true;
  credentialRegistered = true;
  credentialExpired = false;
  sessions = new Map<string, WorldSession>();
  private nextSeq = new Map<string, number>();
  now = T0;
  posted: Array<{ id: string; text: string }> = [];
  opened: Array<Record<string, unknown>> = [];
  cancelled: string[] = [];

  addSession(id: string, over: Partial<SessionSnapshot> = {}, entries: Array<[string, Record<string, unknown>?]> = []): WorldSession {
    const snap: SessionSnapshot = {
      session_id: id,
      state: 'idle',
      autonomy: 'plan',
      simulate: false,
      owner: this.viewer,
      steps: 0,
      max_steps: 24,
      max_seconds: 900,
      created_ms: this.now - 60_000,
      updated_ms: this.now - 5_000,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
      ...over,
    };
    const s: WorldSession = { snap, entries: [] };
    this.sessions.set(id, s);
    for (const [kind, extra] of entries) this.push(id, kind, extra);
    return s;
  }

  push(id: string, kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no session ${id}`);
    const seq = (this.nextSeq.get(id) ?? 0) + 1;
    this.nextSeq.set(id, seq);
    const line = { seq, kind, author: kind === 'user' ? this.viewer : 'terra', author_label: kind === 'user' ? this.viewer : 'terra', time_ms: this.now + seq * 1000, ...extra };
    s.entries.push(line);
    return line;
  }

  setState(id: string, state: SessionState, extra: Partial<SessionSnapshot> = {}): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no session ${id}`);
    s.snap = { ...s.snap, state, ...extra };
  }

  setPending(id: string, pending: PendingApproval[], contract?: ApprovalContract): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no session ${id}`);
    s.snap = { ...s.snap, state: pending.length ? 'waiting-approval' : s.snap.state, pending_approvals: pending.map((p) => ({ ...p, ...(contract ? { contract } : {}) })) };
  }

  /** FakeTransport 에 이 세계의 모든 호출을 건다. */
  install(transport: FakeTransport): FakeTransport {
    transport.otherwise((call) => this.handle(call));
    return transport;
  }

  private handle(call: RecordedCall): FakeReply {
    const url = new URL(call.path, 'http://x');
    const path = url.pathname.slice(AGENT.length);
    if (call.method === 'GET' && path === '/status') {
      return this.statusReply ?? reply.ok({ status: 'ok', version: this.version, sessions: this.sessions.size, delegate_door: this.delegateDoor });
    }
    if (call.method === 'GET' && path === '/models') {
      return (
        this.modelsReply ??
        reply.ok({ default: 'anthropic', providers: [{ provider: 'anthropic', model: 'test-model', registered: this.modelRegistered, default: true }] })
      );
    }
    if (call.method === 'GET' && path === '/credentials') {
      if (this.credentialsReply) return this.credentialsReply;
      return this.credentialRegistered
        ? reply.ok({ registered: true, principal: this.viewer, permissions: ['node.read'], reach: 'node', expires_at: '2030-01-01T00:00:00Z', expired: this.credentialExpired })
        : reply.ok({ registered: false });
    }
    if (call.method === 'GET' && path === '/sessions') return this.listReply ?? reply.ok({ sessions: [...this.sessions.values()].map((s) => s.snap) });
    if (call.method === 'POST' && path === '/sessions') {
      const body = (call.body ?? {}) as Record<string, unknown>;
      this.opened.push(body);
      const id = String(body['session_id'] ?? 'auto');
      const existed = this.sessions.has(id);
      if (!existed) this.addSession(id, { autonomy: (body['autonomy'] as 'plan') ?? 'plan', ...(typeof body['topic'] === 'string' ? { topic: body['topic'] } : {}), owner: this.viewer });
      const snap = (this.sessions.get(id) as WorldSession).snap;
      return reply.ok({ session_id: id, viewer: this.viewer, state: snap.state, autonomy: snap.autonomy, simulate: false, created: !existed }, existed ? 200 : 201);
    }
    const m = /^\/sessions\/([^/]+)(\/messages|\/cancel)?$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1] ?? '');
      const s = this.sessions.get(id);
      if (!s) return reply.fail(404, 'SESSION_NOT_FOUND', 'no such session');
      if (call.method === 'GET' && !m[2]) return reply.ok(s.snap);
      if (call.method === 'GET' && m[2] === '/messages') {
        const after = Number(url.searchParams.get('after_seq') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 500);
        return reply.ok({ session_id: id, entries: s.entries.filter((e) => (e['seq'] as number) > after).slice(0, limit) });
      }
      if (call.method === 'POST' && m[2] === '/messages') {
        if (this.postReply) return this.postReply;
        const text = String((call.body as { text?: string } | undefined)?.text ?? '');
        this.posted.push({ id, text });
        const line = this.push(id, 'user', { text });
        this.setState(id, 'running');
        return reply.ok({ entry: line }, 201);
      }
      if (call.method === 'POST' && m[2] === '/cancel') {
        this.cancelled.push(id);
        this.push(id, 'cancelled');
        this.setState(id, 'cancelled');
        return reply.ok({ session_id: id, state: 'cancelled' });
      }
    }
    return reply.fail(500, 'AGENT_UNAVAILABLE', `unrouted ${call.method} ${call.path}`);
  }
}
