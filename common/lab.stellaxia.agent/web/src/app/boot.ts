// 부트스트랩 — 어디서 열렸는가에 따라 전송을 고르고 앱을 세운다.
//   · 개발 서버에서 VITE_TERRA_DEV_TOKEN 이 있으면 토큰 전송(createDevTokenTransport) — 프로덕션 빌드에서는 코드째 사라진다.
//   · 셸 안(부모 창이 있다)이면 BridgeTransport.
//   · 그 밖(셸 밖 직접 열람)은 지원하지 않는다(결정 Q-1) — "이 앱은 Terra 셸 안에서 여세요." 안내만 보인다.
// 토큰은 메모리에만 있고 이 파일은 그것을 읽지도 저장하지도 않는다.

import { createAgentClient } from '../api/client';
import { BridgeTransport, createDevTokenTransport, type AgentTransport, type BridgeWindow } from '../transport';
import { detectHost } from '../env';
import { createApp, type App, type AppDeps } from './app';
import { callFromTransport } from './call-adapter';
import { h } from './dom';

export const STANDALONE_NOTICE = '이 앱은 Terra 셸 안에서 여세요.';

export type BootWindow = AppDeps['win'] & { parent?: unknown; self?: unknown };

export interface BootOptions {
  win?: BootWindow;
  doc?: Document;
  /** 개발 토큰 전송을 만든다. 기본은 createDevTokenTransport(프로덕션에서는 늘 undefined). */
  devTransport?: () => AgentTransport | undefined;
  /** 시험이 전송을 직접 넣는다(FakeTransport). 있으면 셸 판별을 건너뛴다. */
  transport?: AgentTransport;
  now?: () => number;
  random?: () => number;
  poll?: AppDeps['poll'];
  readinessEveryMs?: number;
  listEveryMs?: number;
  /** true 면 앱을 만들기만 하고 폴링은 시작하지 않는다(시험). */
  manual?: boolean;
}

export interface Booted {
  app: App;
  transport: AgentTransport;
}

/** 셸 밖 안내만 그린다. */
export function renderStandalone(root: HTMLElement): void {
  root.replaceChildren(
    h(
      'main',
      { class: 'standalone', attrs: { 'data-role': 'standalone' } },
      h('h1', {}, 'Terra Agent'),
      h('p', { attrs: { role: 'status' } }, STANDALONE_NOTICE),
      h('p', { class: 'dim' }, 'Terra 의 앱 런처(Terra Apps)에서 열면 셸이 로그인과 권한을 이어 줍니다. 브라우저 주소창으로 직접 여는 길은 지원하지 않습니다.'),
    ),
  );
}

export function boot(root: HTMLElement, options: BootOptions = {}): Booted | null {
  const win = options.win ?? (window as unknown as BootWindow);
  const doc = options.doc ?? document;

  let transport: AgentTransport | undefined = options.transport;
  if (!transport) {
    transport = (options.devTransport ?? (() => createDevTokenTransport()))();
  }
  if (!transport) {
    if (detectHost(win) !== 'shell') {
      renderStandalone(root);
      return null;
    }
    transport = new BridgeTransport(win as unknown as BridgeWindow);
  }

  const client = createAgentClient(callFromTransport(transport));
  const app = createApp({
    root,
    win,
    doc,
    client,
    ...(options.now ? { now: options.now } : {}),
    ...(options.random ? { random: options.random } : {}),
    ...(options.poll ? { poll: options.poll } : {}),
    ...(options.readinessEveryMs !== undefined ? { readinessEveryMs: options.readinessEveryMs } : {}),
    ...(options.listEveryMs !== undefined ? { listEveryMs: options.listEveryMs } : {}),
  });
  if (!options.manual) app.start();
  return { app, transport };
}
