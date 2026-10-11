// 전송 시험 공용 도구 — 가짜 셸(부모 창) 하나.
import type { BridgeMessageEvent, BridgeWindow } from '../src/transport/bridge';

export interface ShellOptions {
  /** hello 에 ready 로 답할 때의 권한. undefined 면 답하지 않는다(셸이 없거나 느리다). */
  permissions?: string[];
  /** 요청마다 응답을 만든다. undefined 를 돌려주면 답하지 않는다. */
  respond?: (message: Record<string, unknown>) => Record<string, unknown> | undefined;
  /** hello 를 몇 번째에 받았을 때부터 답할지(1 = 즉시). */
  answerHelloFrom?: number;
}

export interface FakeShell {
  win: BridgeWindow;
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  /** 앱이 부모로 보낸 메시지와 targetOrigin. */
  posted: { message: Record<string, unknown>; targetOrigin: string }[];
  listenerCount(): number;
  /** 부모가(또는 source 를 바꿔 다른 창이) 앱으로 메시지를 보낸다. */
  emit(data: unknown, source?: unknown): void;
  hellos(): number;
  requests(): Record<string, unknown>[];
}

export function makeShell(options: ShellOptions = {}): FakeShell {
  const listeners = new Set<(event: BridgeMessageEvent) => void>();
  const posted: FakeShell['posted'] = [];
  let hellos = 0;
  const parent = {
    postMessage(message: unknown, targetOrigin: string): void {
      const msg = message as Record<string, unknown>;
      posted.push({ message: msg, targetOrigin });
      if (msg.type === 'terra.webapp.hello') {
        hellos += 1;
        if (options.permissions && hellos >= (options.answerHelloFrom ?? 1)) {
          queueMicrotask(() => emit({ type: 'terra.webapp.ready', appId: 'io.terra.agent', permissions: options.permissions }));
        }
      } else if (msg.type === 'terra.webapp.request' && options.respond) {
        const out = options.respond(msg);
        if (out) queueMicrotask(() => emit({ type: 'terra.webapp.response', id: msg.id, ...out }));
      }
    },
  };
  const self = {};
  const win: BridgeWindow = {
    parent,
    self,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
  function emit(data: unknown, source: unknown = parent): void {
    for (const listener of [...listeners]) listener({ source, data, origin: 'https://gateway.example' });
  }
  return {
    win,
    parent,
    posted,
    listenerCount: () => listeners.size,
    emit,
    hellos: () => hellos,
    requests: () => posted.map(p => p.message).filter(m => m.type === 'terra.webapp.request'),
  };
}

export const AGENT = '/api/modules/io.terra.agent/v1';
