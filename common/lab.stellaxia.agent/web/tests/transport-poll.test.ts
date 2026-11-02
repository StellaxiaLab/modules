import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindVisibility, DEFAULT_POLL_INTERVALS, isDocumentHidden, PollScheduler } from '../src/transport/poll';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(options: Partial<ConstructorParameters<typeof PollScheduler>[0]> = {}) {
  const ticks: number[] = [];
  const tick = vi.fn(async () => {
    ticks.push(Date.now());
  });
  const scheduler = new PollScheduler({ tick, ...options });
  return { scheduler, tick, ticks };
}

describe('기본 간격', () => {
  it('값: running 1초 · 대기 5초 · 유휴 5초 · 숨김 15초', () => {
    expect(DEFAULT_POLL_INTERVALS).toEqual({ running: 1000, waitingApproval: 5000, idle: 5000, hidden: 15000 });
  });

  it('start 는 곧바로 한 번 부르고, running 이면 1초마다', async () => {
    const { scheduler, tick } = make({ mode: 'running' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it('waiting-approval 은 5초', async () => {
    const { scheduler, tick } = make({ mode: 'waiting-approval' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(4999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('idle(기본 모드)도 5초', async () => {
    const { scheduler, tick } = make();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('start 를 두 번 불러도 한 줄기만 돈다', async () => {
    const { scheduler, tick } = make({ mode: 'running' });
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});

describe('모드와 가시성 전환', () => {
  it('idle → running: 남은 대기가 새 간격으로 줄어든다', async () => {
    const { scheduler, tick } = make({ mode: 'idle' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000); // tick1 후 2초 지남
    scheduler.setMode('running');
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2); // 이미 1초를 넘겼으니 곧바로
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('running → idle: 늦어진다', async () => {
    const { scheduler, tick } = make({ mode: 'running' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.setMode('idle');
    await vi.advanceTimersByTimeAsync(4999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('숨겨지면 모드와 무관하게 15초로 늦춘다', async () => {
    const { scheduler, tick } = make({ mode: 'running' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.setHidden(true);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('다시 보이면 밀린 만큼 곧바로, 그 뒤엔 모드 간격으로', async () => {
    const { scheduler, tick } = make({ mode: 'running', hidden: true });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(8000);
    expect(tick).toHaveBeenCalledTimes(1);
    scheduler.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('bindVisibility: visibilitychange 를 이어 주고 풀 수 있다', async () => {
    const listeners = new Set<() => void>();
    const doc = {
      hidden: false,
      visibilityState: 'visible',
      addEventListener: (_: 'visibilitychange', l: () => void) => void listeners.add(l),
      removeEventListener: (_: 'visibilitychange', l: () => void) => void listeners.delete(l),
    };
    const { scheduler } = make({ mode: 'running' });
    const unbind = bindVisibility(scheduler, doc);
    expect(scheduler.getState().hidden).toBe(false);
    doc.hidden = true;
    doc.visibilityState = 'hidden';
    listeners.forEach(l => l());
    expect(scheduler.getState().hidden).toBe(true);
    expect(isDocumentHidden(doc)).toBe(true);
    unbind();
    expect(listeners.size).toBe(0);
  });
});

describe('겹치지 않는다', () => {
  it('tick 이 오래 걸리면 다음 tick 은 끝난 뒤에 예약된다', async () => {
    let release!: () => void;
    let calls = 0;
    const tick = vi.fn(
      () =>
        new Promise<void>(resolve => {
          calls += 1;
          release = resolve;
        }),
    );
    const scheduler = new PollScheduler({ tick, mode: 'running' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1); // 10초가 지나도 첫 호출이 안 끝났으니 겹치지 않는다
    expect(scheduler.getState().inFlight).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    release();
  });

  it('진행 중 refreshNow 여러 번은 끝난 직후 한 번으로 합쳐진다', async () => {
    let release!: () => void;
    let calls = 0;
    const tick = vi.fn(
      () =>
        new Promise<void>(resolve => {
          calls += 1;
          release = resolve;
        }),
    );
    const scheduler = new PollScheduler({ tick, mode: 'idle' });
    scheduler.start();
    scheduler.refreshNow();
    scheduler.refreshNow();
    scheduler.refreshNow();
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
  });

  it('유휴 중 refreshNow 는 기다리지 않고 바로, 그 뒤 간격은 다시 센다', async () => {
    const { scheduler, tick } = make({ mode: 'idle' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(3000);
    scheduler.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4999);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});

describe('정지·재개', () => {
  it('stop 하면 더는 부르지 않고 타이머도 없다', async () => {
    const { scheduler, tick } = make({ mode: 'running' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.stop();
    const n = tick.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(tick).toHaveBeenCalledTimes(n);
    expect(vi.getTimerCount()).toBe(0);
    expect(scheduler.getState().active).toBe(false);
  });

  it('stop 상태의 refreshNow 는 아무것도 하지 않는다', async () => {
    const { scheduler, tick } = make();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
    scheduler.refreshNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('resume 은 곧바로 한 번 부르고 이어 간다', async () => {
    const { scheduler, tick } = make({ mode: 'running' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('진행 중 stop → 그 tick 의 늦은 결과는 예약을 만들지 않는다', async () => {
    let release!: () => void;
    const tick = vi.fn(() => new Promise<void>(resolve => (release = resolve)));
    const scheduler = new PollScheduler({ tick, mode: 'running' });
    scheduler.start();
    scheduler.stop();
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('진행 중 stop 뒤 resume: 옛 tick 의 결과가 새 줄기를 흔들지 않는다', async () => {
    const releases: (() => void)[] = [];
    const tick = vi.fn(() => new Promise<void>(resolve => void releases.push(resolve)));
    const scheduler = new PollScheduler({ tick, mode: 'running' });
    scheduler.start();
    scheduler.stop();
    scheduler.resume(); // inFlight 인 옛 tick 때문에 새 tick 은 아직 못 부른다
    releases[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick.mock.calls.length).toBeLessThanOrEqual(2);
    expect(scheduler.getState().inFlight).toBe(false);
  });
});

describe('오류 백오프', () => {
  it('실패할 때마다 2초 · 4초 · 8초 … 최대 30초, 성공하면 풀린다', async () => {
    let fail = true;
    const times: number[] = [];
    const tick = vi.fn(async () => {
      times.push(Date.now());
      if (fail) throw new Error('down');
    });
    const errors: number[] = [];
    const scheduler = new PollScheduler({ tick, mode: 'running', onError: (_c, n) => errors.push(n) });
    const t0 = Date.now();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(100_000);
    const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
    expect(gaps.slice(0, 6)).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000]);
    expect(errors.slice(0, 3)).toEqual([1, 2, 3]);
    expect(times[0]).toBe(t0);
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scheduler.getState().consecutiveFailures).toBe(0);
    const before = tick.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick.mock.calls.length - before).toBe(3); // running 1초 간격으로 돌아왔다
  });

  it('{ok:false} 를 돌려줘도 실패로 센다', async () => {
    const tick = vi.fn(async () => ({ ok: false }));
    const scheduler = new PollScheduler({ tick, mode: 'running' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.getState().consecutiveFailures).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('백오프는 기본 간격보다 짧아지지 않는다(유휴 5초 > 백오프 2초)', async () => {
    const tick = vi.fn(async () => ({ ok: false }));
    const scheduler = new PollScheduler({ tick, mode: 'idle' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(4999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('동기 tick 도 다룬다', async () => {
    const tick = vi.fn(() => undefined);
    const scheduler = new PollScheduler({ tick, mode: 'running' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});
