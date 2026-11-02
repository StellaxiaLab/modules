// DOM 시험 도우미 (jsdom).
import { createAgentClient } from '../src/api/client';
import { createApp, type App } from '../src/app/app';
import { callFromTransport } from '../src/app/call-adapter';
import { FakeTransport, type Timers } from '../src/transport';
import { T0, World } from './world';

/** 손으로 돌리는 타이머 — 실제 시간에 기대지 않는다. */
export class ManualTimers implements Timers {
  private next = 1;
  private readonly items = new Map<number, () => void>();
  setTimeout(fn: () => void): unknown {
    const id = this.next++;
    this.items.set(id, fn);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.items.delete(handle as number);
  }
  /** 예약된 타이머 수. */
  get pending(): number {
    return this.items.size;
  }
  /** 지금 예약된 것을 한 번씩 실행한다(실행 중 새로 예약된 것은 다음 호출에서). */
  fire(): void {
    const due = [...this.items.entries()];
    for (const [id, fn] of due) {
      if (this.items.delete(id)) fn();
    }
  }
}

export interface MountOptions {
  /** true 면 폴링·카운트다운 타이머를 손 타이머로 바꾸고 앱을 start() 한다. */
  manualTimers?: boolean;
}

export interface Mounted {
  app: App;
  root: HTMLElement;
  world: World;
  transport: FakeTransport;
  clock: { now: number };
  pollTimers: ManualTimers;
  clockTimers: ManualTimers;
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

export function mountApp(setup: (world: World) => void = () => {}, hash = '', options: MountOptions = {}): Mounted {
  document.body.replaceChildren();
  window.location.hash = hash;
  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  const world = new World();
  setup(world);
  const transport = world.install(new FakeTransport());
  const clock = { now: T0 };
  const pollTimers = new ManualTimers();
  const clockTimers = new ManualTimers();
  const app = createApp({
    root,
    win: window,
    doc: document,
    client: createAgentClient(callFromTransport(transport)),
    now: () => clock.now,
    random: () => 0.123456,
    ...(options.manualTimers ? { poll: { timers: pollTimers, now: () => clock.now }, countdown: { timers: clockTimers } } : {}),
  });
  const mounted: Mounted = {
    app,
    root,
    world,
    transport,
    clock,
    pollTimers,
    clockTimers,
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
