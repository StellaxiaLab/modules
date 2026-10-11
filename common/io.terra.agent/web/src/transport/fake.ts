// FakeTransport — 시험·시연용 전송. 네트워크도 셸도 없이, 프로그래밍한 답을 돌려준다.
// 진짜 전송과 같은 파이프라인(검증·시간 제한·중단·오류 정규화·재시도 never 가드)을 지나므로
// 이것으로 돌린 시험은 화면 코드가 보는 TransportResult 를 그대로 본다.
//
// 쓰는 법:
//   const t = new FakeTransport();
//   t.on('GET /api/modules/io.terra.agent/v1/status', reply.ok({ version: '0.1.0' }));
//   t.queue('POST /api/modules/io.terra.agent/v1/sessions/s1/messages', reply.fail(409, 'SESSION_BUSY', 'busy'), reply.ok({ seq: 4 }));
//   await t.request({ method: 'GET', path: '/api/modules/io.terra.agent/v1/status' });
//   t.expectOrder('GET /…/status', 'POST /…/messages');

import { pathOnly } from './retry-guard';
import { execute, type PipelineOptions } from './pipeline';
import { realTimers, type AgentTransport, type HttpMethod, type Timers, type TransportRequest, type TransportResult } from './types';

/** 답 한 건. 서버가 줄 법한 raw 모양을 만들어 정상 경로와 같은 정규화를 거친다. */
export type FakeReply =
  | { kind: 'raw'; raw: { ok: boolean; status: number; data?: unknown; error?: unknown }; delayMs?: number }
  /** 응답 없이 멈춘다 — 시간 제한·중단 시험용. */
  | { kind: 'hang' }
  /** 전송이 예외를 던진다(네트워크 끊김). */
  | { kind: 'throw'; message: string; delayMs?: number };

export const reply = {
  ok(data?: unknown, status = 200, delayMs?: number): FakeReply {
    return { kind: 'raw', raw: { ok: true, status, data }, ...(delayMs !== undefined ? { delayMs } : {}) };
  },
  /** 모듈 오류 봉투 `{error:{code,message}}`. Gateway 모양은 `gatewayFail`. */
  fail(status: number, code: string, message = code, delayMs?: number): FakeReply {
    return { kind: 'raw', raw: { ok: false, status, data: { error: { code, message } } }, ...(delayMs !== undefined ? { delayMs } : {}) };
  },
  /** Gateway 오류 봉투 `{ok:false,error:{code,message,retryable},meta}`. */
  gatewayFail(status: number, code: string, message = code, retryable = false): FakeReply {
    return { kind: 'raw', raw: { ok: false, status, data: { ok: false, error: { code, message, retryable }, meta: { request_id: 'fake' } } } };
  },
  /** 셸 브리지가 만드는 오류 응답(data 없이 error). */
  bridgeFail(status: number, code: string, message = code): FakeReply {
    return { kind: 'raw', raw: { ok: false, status, error: { code, message } } };
  },
  /** 아무 모양이나 — 정규화가 죽지 않는지 시험한다. */
  rawBody(status: number, data: unknown, ok = false): FakeReply {
    return { kind: 'raw', raw: { ok, status, data } };
  },
  networkError(message = 'fake: connection reset', delayMs?: number): FakeReply {
    return { kind: 'throw', message, ...(delayMs !== undefined ? { delayMs } : {}) };
  },
  hang(): FakeReply {
    return { kind: 'hang' };
  },
};

export interface MatchSpec {
  method?: HttpMethod;
  /** 문자열은 쿼리를 뗀 경로와 정확히 같아야 하고, 정규식은 쿼리 포함 전체 경로에 맞춘다. */
  path?: string | RegExp;
  /** 본문까지 맞춰야 할 때. */
  body?: (body: unknown) => boolean;
}
/** `'GET /path'` 줄임 · 정규식(경로) · 상세 조건 · 함수. */
export type FakeMatch = string | RegExp | MatchSpec | ((req: TransportRequest) => boolean);

export type FakeResponder = FakeReply | ((call: RecordedCall) => FakeReply | Promise<FakeReply>);

export interface RecordedCall {
  /** 1 부터, 시도 단위(재시도하면 늘어난다). */
  seq: number;
  method: HttpMethod;
  path: string;
  body?: unknown;
}

const METHOD_HEAD = /^(GET|POST|PUT|PATCH|DELETE)\s+(.*)$/;

function toMatcher(match: FakeMatch): (req: { method: HttpMethod; path: string; body?: unknown }) => boolean {
  if (typeof match === 'function') return req => match(req as TransportRequest);
  if (match instanceof RegExp) return req => match.test(req.path);
  if (typeof match === 'string') {
    const head = METHOD_HEAD.exec(match);
    const method = head ? (head[1] as HttpMethod) : undefined;
    const path = head ? (head[2] as string) : match;
    return req => (method === undefined || req.method === method) && pathOnly(req.path) === pathOnly(path);
  }
  return req => {
    if (match.method && req.method !== match.method) return false;
    if (match.path !== undefined) {
      const ok = typeof match.path === 'string' ? pathOnly(req.path) === pathOnly(match.path) : match.path.test(req.path);
      if (!ok) return false;
    }
    return match.body ? match.body(req.body) : true;
  };
}

interface Rule {
  test: (req: { method: HttpMethod; path: string; body?: unknown }) => boolean;
  queued: FakeResponder[];
  handler?: FakeResponder;
}

export interface FakeTransportOptions extends PipelineOptions {
  timers?: Timers;
}

export class FakeTransport implements AgentTransport {
  readonly kind = 'fake' as const;

  /** 보낸 시도의 기록(재시도 포함). 읽기 전용으로 쓴다. */
  readonly calls: RecordedCall[] = [];
  /** 어느 규칙에도 맞지 않은 호출. 시험이 "예상 못 한 호출 없음"을 확인한다. */
  readonly unmatched: RecordedCall[] = [];

  private readonly rules: Rule[] = [];
  private fallback: FakeResponder | undefined;
  private readonly timers: Timers;
  private readonly options: FakeTransportOptions;
  private seq = 0;

  constructor(options: FakeTransportOptions = {}) {
    this.options = options;
    this.timers = options.timers ?? realTimers;
  }

  /** 조건에 맞는 호출에 늘 이 답을 준다(큐가 비었을 때). */
  on(match: FakeMatch, responder: FakeResponder): this {
    this.ruleFor(match).handler = responder;
    return this;
  }

  /** 조건에 맞는 호출에 차례로 한 번씩 답한다. 다 쓰면 `on` 의 답, 그것도 없으면 맞는 규칙 없음. */
  queue(match: FakeMatch, ...responders: FakeResponder[]): this {
    this.ruleFor(match).queued.push(...responders);
    return this;
  }

  /** 어느 규칙에도 안 맞을 때의 답. 기본은 404 `UNKNOWN` — 예상 못 한 호출이 눈에 띈다. */
  otherwise(responder: FakeResponder | undefined): this {
    this.fallback = responder;
    return this;
  }

  request<T = unknown>(req: TransportRequest): Promise<TransportResult<T>> {
    return execute<T>((r, signal) => this.send(r, signal), req, this.options);
  }

  // --- 호출 기록 · 순서 검증 ---

  callsMatching(match: FakeMatch): RecordedCall[] {
    const test = toMatcher(match);
    return this.calls.filter(test);
  }

  callCount(match?: FakeMatch): number {
    return match === undefined ? this.calls.length : this.callsMatching(match).length;
  }

  lastCall(match?: FakeMatch): RecordedCall | undefined {
    const list = match === undefined ? this.calls : this.callsMatching(match);
    return list[list.length - 1];
  }

  /** 주어진 호출들이 이 순서로(사이에 다른 호출이 있어도 된다) 일어났는지. 어긋나면 어디서 틀렸는지 적어 던진다. */
  expectOrder(...matches: FakeMatch[]): void {
    let from = 0;
    matches.forEach((match, index) => {
      const test = toMatcher(match);
      const found = this.calls.findIndex((call, i) => i >= from && test(call));
      if (found === -1) {
        throw new Error(
          `호출 순서 어긋남: ${index + 1}번째 기대(${describe(match)})가 ${from + 1}번째 호출 이후에 없다. 실제 호출: ${this.describeCalls()}`,
        );
      }
      from = found + 1;
    });
  }

  /** 정확히 이 호출들만, 이 순서로 일어났는지. */
  expectExactly(...matches: FakeMatch[]): void {
    const ok = matches.length === this.calls.length && matches.every((m, i) => toMatcher(m)(this.calls[i] as RecordedCall));
    if (!ok) throw new Error(`호출이 기대와 다르다. 기대: ${matches.map(describe).join(' → ')} / 실제: ${this.describeCalls()}`);
  }

  /** 이 호출이 한 번도 없었는지. */
  expectNever(match: FakeMatch): void {
    const hits = this.callsMatching(match);
    if (hits.length > 0) throw new Error(`없어야 할 호출이 ${hits.length}번 있었다: ${describe(match)}`);
  }

  reset(): void {
    this.calls.length = 0;
    this.unmatched.length = 0;
    this.rules.length = 0;
    this.fallback = undefined;
    this.seq = 0;
  }

  // --- 내부 ---

  private ruleFor(match: FakeMatch): Rule {
    const rule: Rule = { test: toMatcher(match), queued: [] };
    this.rules.push(rule);
    return rule;
  }

  private describeCalls(): string {
    return this.calls.length ? this.calls.map(c => `${c.method} ${c.path}`).join(' → ') : '(없음)';
  }

  private async send(req: TransportRequest, signal: AbortSignal): Promise<unknown> {
    this.seq += 1;
    const call: RecordedCall = { seq: this.seq, method: req.method, path: req.path };
    if (req.body !== undefined) call.body = clone(req.body);
    this.calls.push(call);

    const responder = this.pick(call);
    if (!responder) {
      this.unmatched.push(call);
      return { ok: false, status: 404, data: { error: { code: 'FAKE_NO_RULE', message: `fake: ${req.method} ${req.path} 에 맞는 답이 없다` } } };
    }
    const decided = typeof responder === 'function' ? await responder(call) : responder;
    if (decided.kind === 'hang') {
      await new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    if (decided.kind === 'throw') {
      await this.wait(decided.delayMs, signal);
      throw new Error(decided.message);
    }
    if (decided.kind === 'raw') {
      await this.wait(decided.delayMs, signal);
      return decided.raw;
    }
    return undefined;
  }

  private pick(call: RecordedCall): FakeResponder | undefined {
    for (const rule of this.rules) {
      if (!rule.test(call)) continue;
      const next = rule.queued.shift();
      if (next) return next;
      if (rule.handler) return rule.handler;
    }
    return this.fallback;
  }

  private wait(ms: number | undefined, signal: AbortSignal): Promise<void> {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const handle = this.timers.setTimeout(() => resolve(), ms);
      signal.addEventListener(
        'abort',
        () => {
          this.timers.clearTimeout(handle);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  }
}

function describe(match: FakeMatch): string {
  if (typeof match === 'string') return match;
  if (match instanceof RegExp) return String(match);
  if (typeof match === 'function') return '(함수 조건)';
  return `${match.method ?? '*'} ${match.path === undefined ? '*' : String(match.path)}`;
}

function clone(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}
