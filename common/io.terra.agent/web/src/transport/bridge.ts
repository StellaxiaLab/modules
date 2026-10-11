// BridgeTransport — 셸 iframe 브리지 (WebApp Host 설계 W-M2).
//
//   앱 ──terra.webapp.hello──▶ 셸
//   앱 ◀─terra.webapp.ready {permissions}── 셸
//   앱 ──terra.webapp.request {id,method,path,body}──▶ 셸 ──▶ Gateway
//   앱 ◀─terra.webapp.response {id,ok,status,data|error}── 셸      (응답은 요청마다 한 번뿐 — 스트림 없음)
//
// 참조: io.terra.webapp-host/ui/launcher.js(핸드셰이크), Terra 의 webAppBridge.ts·WebAppDock.tsx(셸 쪽).
// 셸은 메시지 출처를 "정확한 Gateway origin + 그 iframe 의 contentWindow" 두 겹으로 거른다.
// 앱 쪽에서는 셸 origin 을 알 수 없으므로(샌드박스) 참조 구현처럼 `source === window.parent` 만 본다.

import { detectHost } from '../env';
import { execute, type PipelineOptions } from './pipeline';
import { realTimers, type AgentTransport, type Timers, type TransportRequest, type TransportResult } from './types';

export const BRIDGE_HELLO = 'terra.webapp.hello';
export const BRIDGE_READY = 'terra.webapp.ready';
export const BRIDGE_REQUEST = 'terra.webapp.request';
export const BRIDGE_RESPONSE = 'terra.webapp.response';

/** `window` 의 필요한 부분만. 시험이 가짜를 끼운다. */
export interface BridgeWindow {
  parent?: { postMessage(message: unknown, targetOrigin: string): void } | null;
  self?: unknown;
  addEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: BridgeMessageEvent) => void): void;
}

export interface BridgeMessageEvent {
  source: unknown;
  data: unknown;
  origin?: string;
}

export interface BridgeOptions extends PipelineOptions {
  /** hello 에 ready 가 올 때까지. 기본 5초. */
  handshakeTimeoutMs?: number;
  /** ready 가 아직이면 hello 를 다시 보내는 간격(셸 리스너가 늦게 서는 경우). 기본 1초. */
  helloIntervalMs?: number;
  /** 보내는 메시지의 targetOrigin. 기본 '*' — 참조 구현과 같다(요청에 비밀이 없다. 토큰은 셸에만 있다). */
  targetOrigin?: string;
  newId?: () => string;
}

type ConnectOutcome = { ok: true; permissions: readonly string[] } | { ok: false; code: 'BRIDGE_HANDSHAKE_TIMEOUT' | 'BRIDGE_UNAVAILABLE'; message: string };

interface RawBridgeResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class BridgeTransport implements AgentTransport {
  readonly kind = 'bridge' as const;

  private readonly win: BridgeWindow;
  private readonly timers: Timers;
  private readonly options: BridgeOptions;
  private readonly pending = new Map<string, (raw: RawBridgeResponse) => void>();
  private readonly listener = (event: BridgeMessageEvent): void => this.onMessage(event);
  private grants: readonly string[] | undefined;
  private connecting: Promise<ConnectOutcome> | undefined;
  private settleConnect: ((outcome: ConnectOutcome) => void) | undefined;
  private disposed = false;
  private counter = 0;

  constructor(win: BridgeWindow, options: BridgeOptions = {}) {
    this.win = win;
    this.options = options;
    this.timers = options.timers ?? realTimers;
    win.addEventListener('message', this.listener);
  }

  /** 핸드셰이크가 끝난 뒤 셸이 알려 준 부여 권한. 아직이면 undefined. */
  get permissions(): readonly string[] | undefined {
    return this.grants;
  }

  /** 핸드셰이크를 한다(요청이 오면 저절로 한다). 성공하면 이후 호출은 즉시 돌려준다. */
  connect(): Promise<ConnectOutcome> {
    if (this.disposed) {
      return Promise.resolve({ ok: false, code: 'BRIDGE_UNAVAILABLE', message: '브리지가 닫혔습니다' });
    }
    if (this.grants) return Promise.resolve({ ok: true, permissions: this.grants });
    if (this.connecting) return this.connecting;
    const parent = this.win.parent;
    if (!parent || detectHost(this.win) === 'standalone') {
      return Promise.resolve({ ok: false, code: 'BRIDGE_UNAVAILABLE', message: '셸 브리지가 없습니다 — 이 앱은 Terra 셸 안에서 여세요' });
    }
    const targetOrigin = this.options.targetOrigin ?? '*';
    const handshakeMs = this.options.handshakeTimeoutMs ?? 5_000;
    const intervalMs = this.options.helloIntervalMs ?? 1_000;
    this.connecting = new Promise<ConnectOutcome>(resolve => {
      let resend: unknown;
      let giveUp: unknown;
      const done = (outcome: ConnectOutcome): void => {
        this.timers.clearTimeout(resend);
        this.timers.clearTimeout(giveUp);
        this.settleConnect = undefined;
        if (!outcome.ok) this.connecting = undefined; // 다음 호출이 다시 시도한다
        resolve(outcome);
      };
      this.settleConnect = done;
      const hello = (): void => {
        try {
          parent.postMessage({ type: BRIDGE_HELLO }, targetOrigin);
        } catch {
          // 보내지 못해도 시간 제한이 결론을 낸다
        }
        resend = this.timers.setTimeout(hello, intervalMs);
      };
      giveUp = this.timers.setTimeout(
        () => done({ ok: false, code: 'BRIDGE_HANDSHAKE_TIMEOUT', message: '셸이 브리지 hello 에 답하지 않았습니다 — 셸 안에서 열었는지 확인하세요' }),
        handshakeMs,
      );
      hello();
    });
    return this.connecting;
  }

  request<T = unknown>(req: TransportRequest): Promise<TransportResult<T>> {
    return execute<T>((r, signal) => this.send(r, signal), req, this.options);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.win.removeEventListener('message', this.listener);
    this.settleConnect?.({ ok: false, code: 'BRIDGE_UNAVAILABLE', message: '브리지가 닫혔습니다' });
    for (const settle of [...this.pending.values()]) {
      settle({ ok: false, status: 0, error: { code: 'BRIDGE_UNAVAILABLE', message: '브리지가 닫혔습니다' } });
    }
    this.pending.clear();
  }

  private async send(req: TransportRequest, signal: AbortSignal): Promise<RawBridgeResponse> {
    const link = await this.connect();
    if (!link.ok) return { ok: false, status: 0, error: { code: link.code, message: link.message } };
    if (signal.aborted) return { ok: false, status: 0, error: { code: 'ABORTED', message: '취소되었습니다' } };
    if (link.permissions.length === 0) {
      // 선언 권한이 비면 셸이 어차피 BRIDGE_NO_PERMISSIONS 로 거절한다 — 보내지 않고 같은 답을 준다.
      return {
        ok: false,
        status: 403,
        error: { code: 'BRIDGE_NO_PERMISSIONS', message: 'this app declared no permissions, so the bridge carries nothing for it' },
      };
    }
    const parent = this.win.parent;
    if (!parent) return { ok: false, status: 0, error: { code: 'BRIDGE_UNAVAILABLE', message: '셸 브리지가 없습니다' } };
    const id = this.nextId();
    return new Promise<RawBridgeResponse>(resolve => {
      this.pending.set(id, resolve);
      signal.addEventListener('abort', () => this.pending.delete(id), { once: true });
      const message: Record<string, unknown> = { type: BRIDGE_REQUEST, id, method: req.method, path: req.path };
      if (req.body !== undefined && req.method !== 'GET') message.body = req.body;
      try {
        parent.postMessage(message, this.options.targetOrigin ?? '*');
      } catch (cause: unknown) {
        this.pending.delete(id);
        // 직렬화 실패 등 — 보내기 전에 막혔다
        resolve({ ok: false, status: 0, error: { code: 'BRIDGE_INVALID_REQUEST', message: cause instanceof Error ? cause.message : String(cause) } });
      }
    });
  }

  private nextId(): string {
    if (this.options.newId) return this.options.newId();
    this.counter += 1;
    return `agent-${this.counter}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private onMessage(event: BridgeMessageEvent): void {
    // 신뢰: 우리 부모 창에서 온 메시지만. 다른 창·프레임의 메시지는 조용히 버린다.
    if (!this.win.parent || event.source !== this.win.parent) return;
    const data = event.data;
    if (!isRecord(data) || typeof data.type !== 'string') return;
    if (data.type === BRIDGE_READY) {
      const permissions = Array.isArray(data.permissions)
        ? data.permissions.filter((p): p is string => typeof p === 'string')
        : [];
      this.grants = permissions;
      this.settleConnect?.({ ok: true, permissions });
      return;
    }
    if (data.type === BRIDGE_RESPONSE && typeof data.id === 'string') {
      const settle = this.pending.get(data.id);
      if (!settle) return; // 모르는 id · 이미 시간 초과/취소된 요청의 늦은 응답
      this.pending.delete(data.id);
      settle({ ok: data.ok === true, status: typeof data.status === 'number' ? data.status : 0, data: data.data, error: data.error });
    }
  }
}
