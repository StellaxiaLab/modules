// DOM 시험 도우미 (jsdom).
import { createAgentClient } from '../src/api/client';
import { createApp, type App } from '../src/app/app';
import { callFromTransport } from '../src/app/call-adapter';
import { FakeTransport } from '../src/transport';
import { T0, World } from './world';

export interface Mounted {
  app: App;
  root: HTMLElement;
  world: World;
  transport: FakeTransport;
  clock: { now: number };
  q<T extends Element = HTMLElement>(selector: string): T;
  qa<T extends Element = HTMLElement>(selector: string): T[];
  text(selector: string): string;
  settle(): Promise<void>;
  /** 한 번 읽고 그린다. */
  refresh(): Promise<void>;
  dispose(): void;
}

export async function tick(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function mountApp(setup: (world: World) => void = () => {}, hash = ''): Mounted {
  document.body.replaceChildren();
  window.location.hash = hash;
  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  const world = new World();
  setup(world);
  const transport = world.install(new FakeTransport());
  const clock = { now: T0 };
  const app = createApp({
    root,
    win: window,
    doc: document,
    client: createAgentClient(callFromTransport(transport)),
    now: () => clock.now,
    random: () => 0.123456,
  });
  const mounted: Mounted = {
    app,
    root,
    world,
    transport,
    clock,
    q: <T extends Element = HTMLElement>(selector: string) => {
      const el = root.querySelector<T>(selector);
      if (!el) throw new Error(`요소를 찾지 못했다: ${selector}`);
      return el;
    },
    qa: <T extends Element = HTMLElement>(selector: string) => Array.from(root.querySelectorAll<T>(selector)),
    text: (selector) => root.querySelector(selector)?.textContent ?? '',
    settle: async () => {
      await tick();
      await app.flush();
    },
    refresh: async () => {
      await app.refreshOnce();
      await app.flush();
    },
    dispose: () => app.stop(),
  };
  return mounted;
}
