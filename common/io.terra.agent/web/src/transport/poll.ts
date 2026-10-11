// PollScheduler — 브리지는 응답 한 번뿐이라 스트림이 없다(함정 3). 그래서 `messages.list?after_seq` 를 폴링한다.
// 이 파일은 "언제 다음 호출을 하는가"만 정한다(순수 논리, 시계·타이머 주입). 무엇을 부르는지는 tick 이 안다.
//
// 규칙
//  - running 1초 · waiting-approval 5초 · idle 5초. 문서가 숨겨지면 모드와 무관하게 15초로 늦춘다.
//  - 이전 tick 이 끝나기 전에는 다음 tick 을 부르지 않는다(setInterval 이 아니라 끝난 뒤 예약).
//  - 실패(예외 또는 {ok:false})하면 백오프: 2초 · 4초 · 8초 … 최대 30초(기본 간격보다 짧아지지 않는다). 성공하면 풀린다.
//  - stop / resume / refreshNow. 진행 중에 refreshNow 가 오면 겹쳐 부르지 않고 끝난 즉시 한 번 더(여러 번은 하나로).

import { realTimers, type Timers } from './types';

export type PollMode = 'running' | 'waiting-approval' | 'idle';

export interface PollIntervals {
  running: number;
  waitingApproval: number;
  idle: number;
  hidden: number;
}

export const DEFAULT_POLL_INTERVALS: PollIntervals = { running: 1_000, waitingApproval: 5_000, idle: 5_000, hidden: 15_000 };

export interface PollBackoff {
  baseMs: number;
  factor: number;
  maxMs: number;
}

export const DEFAULT_POLL_BACKOFF: PollBackoff = { baseMs: 2_000, factor: 2, maxMs: 30_000 };

/** tick 의 결과. 아무것도 안 돌려주면(void) 성공이다. */
export type PollTickResult = void | { ok: boolean };

export interface PollSchedulerOptions {
  tick: () => Promise<PollTickResult> | PollTickResult;
  mode?: PollMode;
  hidden?: boolean;
  intervals?: Partial<PollIntervals>;
  backoff?: Partial<PollBackoff>;
  timers?: Timers;
  now?: () => number;
  onError?: (cause: unknown, consecutiveFailures: number) => void;
}

export interface PollState {
  active: boolean;
  mode: PollMode;
  hidden: boolean;
  inFlight: boolean;
  consecutiveFailures: number;
}

export class PollScheduler {
  private readonly tick: PollSchedulerOptions['tick'];
  private readonly intervals: PollIntervals;
  private readonly backoff: PollBackoff;
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly onError: PollSchedulerOptions['onError'];

  private mode: PollMode;
  private hidden: boolean;
  private active = false;
  private inFlight = false;
  private failures = 0;
  private refreshQueued = false;
  private timer: unknown;
  private hasTimer = false;
  /** 마지막 tick 이 끝난 시각. 다음 시각 계산의 기준. */
  private lastEnd: number | undefined;
  /** 시작/재개마다 올라간다 — 정지 전에 시작한 tick 의 늦은 결과를 버린다. */
  private epoch = 0;

  constructor(options: PollSchedulerOptions) {
    this.tick = options.tick;
    this.mode = options.mode ?? 'idle';
    this.hidden = options.hidden ?? false;
    this.intervals = { ...DEFAULT_POLL_INTERVALS, ...options.intervals };
    this.backoff = { ...DEFAULT_POLL_BACKOFF, ...options.backoff };
    this.timers = options.timers ?? realTimers;
    this.now = options.now ?? Date.now;
    this.onError = options.onError;
  }

  /** 시작한다. 곧바로 한 번 부르고 이어서 간격대로. 이미 돌고 있으면 아무 일도 없다. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.epoch += 1;
    this.lastEnd = undefined;
    this.failures = 0;
    void this.runTick();
  }

  /** 멈춘다. 진행 중인 tick 의 결과는 버려지고 더는 예약하지 않는다. */
  stop(): void {
    this.active = false;
    this.epoch += 1;
    this.refreshQueued = false;
    this.clearTimer();
  }

  /** 멈춘 것을 다시 시작한다(= start). 돌고 있으면 아무 일도 없다. */
  resume(): void {
    this.start();
  }

  /** 지금 바로 한 번. 진행 중이면 끝난 직후 한 번(겹치지 않는다). 멈춰 있으면 아무것도 안 한다. */
  refreshNow(): void {
    if (!this.active) return;
    if (this.inFlight) {
      this.refreshQueued = true;
      return;
    }
    this.clearTimer();
    void this.runTick();
  }

  setMode(mode: PollMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.reschedule();
  }

  /** 문서 가시성. 숨겨지면 늦추고, 다시 보이면 밀린 만큼 곧 부른다. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.reschedule();
  }

  /** 지금 모드·가시성·실패 횟수에서의 다음 간격(ms). */
  currentDelayMs(): number {
    const base = this.hidden
      ? this.intervals.hidden
      : this.mode === 'running'
        ? this.intervals.running
        : this.mode === 'waiting-approval'
          ? this.intervals.waitingApproval
          : this.intervals.idle;
    if (this.failures === 0) return base;
    const grown = this.backoff.baseMs * this.backoff.factor ** (this.failures - 1);
    return Math.max(base, Math.min(this.backoff.maxMs, grown));
  }

  getState(): PollState {
    return { active: this.active, mode: this.mode, hidden: this.hidden, inFlight: this.inFlight, consecutiveFailures: this.failures };
  }

  // --- 내부 ---

  private clearTimer(): void {
    if (this.hasTimer) this.timers.clearTimeout(this.timer);
    this.hasTimer = false;
    this.timer = undefined;
  }

  /** 대기 중인 예약을 새 간격으로 다시 잡는다. 마지막 tick 끝 시각을 기준으로 해서, 간격이 짧아지면 바로 가깝게 당겨진다. */
  private reschedule(): void {
    if (!this.active || this.inFlight) return; // 진행 중이면 끝난 뒤 새 간격으로 잡힌다
    this.clearTimer();
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (!this.active) return;
    const base = this.lastEnd ?? this.now();
    const wait = Math.max(0, base + this.currentDelayMs() - this.now());
    this.hasTimer = true;
    this.timer = this.timers.setTimeout(() => {
      this.hasTimer = false;
      this.timer = undefined;
      void this.runTick();
    }, wait);
  }

  private async runTick(): Promise<void> {
    if (!this.active || this.inFlight) return;
    const epoch = this.epoch;
    this.inFlight = true;
    let ok = true;
    try {
      const result = await this.tick();
      if (result && result.ok === false) ok = false;
    } catch (cause: unknown) {
      ok = false;
      if (epoch === this.epoch) this.onError?.(cause, this.failures + 1);
    }
    this.inFlight = false;
    if (epoch !== this.epoch || !this.active) return; // 그 사이 멈췄거나 다시 시작했다
    this.failures = ok ? 0 : this.failures + 1;
    this.lastEnd = this.now();
    if (this.refreshQueued) {
      this.refreshQueued = false;
      void this.runTick();
      return;
    }
    this.scheduleNext();
  }
}

/** `document` 의 필요한 부분만 — DOM 없이 시험한다. */
export interface VisibilitySource {
  readonly hidden?: boolean;
  readonly visibilityState?: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export function isDocumentHidden(doc: Pick<VisibilitySource, 'hidden' | 'visibilityState'>): boolean {
  return doc.hidden === true || doc.visibilityState === 'hidden';
}

/** 가시성 변화를 스케줄러에 이어 준다. 돌려받은 함수를 부르면 풀린다. */
export function bindVisibility(scheduler: PollScheduler, doc: VisibilitySource): () => void {
  const sync = (): void => scheduler.setHidden(isDocumentHidden(doc));
  doc.addEventListener('visibilitychange', sync);
  sync();
  return () => doc.removeEventListener('visibilitychange', sync);
}
