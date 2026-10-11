// 대화 영역의 스크롤 규칙(GAP-4). 순수 함수 + 얇은 컨트롤러.
//   - 맨 아래에 있을 때(40px 안)만 새 줄을 따라간다.
//   - 올려 읽는 중이면 읽던 줄 자리를 지킨다: 새 줄은 아래에 붙기만 하므로 scrollTop 을 건드리지 않는다.
//   - 오래된 줄을 위에 붙일 때는 늘어난 높이만큼 scrollTop 을 더해 읽던 줄이 그대로 있게 한다.
// 시연은 스크롤 위치를 바닥 기준으로 고정해 새 차례(331px)만큼 읽던 줄이 밀렸다.

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export const FOLLOW_THRESHOLD_PX = 40;

export function distanceFromBottom(m: ScrollMetrics): number {
  return m.scrollHeight - m.clientHeight - m.scrollTop;
}

export function isFollowing(m: ScrollMetrics, threshold = FOLLOW_THRESHOLD_PX): boolean {
  return distanceFromBottom(m) <= threshold;
}

/** 새 줄이 아래에 붙은 뒤의 scrollTop. 따라가는 중이면 바닥, 아니면 그대로. */
export function scrollTopAfterAppend(following: boolean, before: ScrollMetrics, after: ScrollMetrics): number {
  return following ? Math.max(0, after.scrollHeight - after.clientHeight) : before.scrollTop;
}

/** 오래된 줄이 위에 붙은 뒤의 scrollTop — 읽던 줄이 화면에서 움직이지 않게. */
export function scrollTopAfterPrepend(before: ScrollMetrics, after: ScrollMetrics): number {
  return before.scrollTop + (after.scrollHeight - before.scrollHeight);
}

function metricsOf(el: HTMLElement): ScrollMetrics {
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
}

/** 스크롤 영역 하나를 지켜본다. `following` 은 사용자의 스크롤 이벤트로만 바뀐다(DOM 변경 자체로는 바뀌지 않는다). */
export class ScrollFollower {
  following = true;
  private readonly listener = (): void => {
    this.following = isFollowing(metricsOf(this.el));
    this.onChange?.(this.following);
  };

  constructor(
    private readonly el: HTMLElement,
    private readonly onChange?: (following: boolean) => void,
  ) {
    el.addEventListener('scroll', this.listener, { passive: true });
  }

  dispose(): void {
    this.el.removeEventListener('scroll', this.listener);
  }

  /** 다른 세션을 열었다 — 바닥에서 시작한다. */
  reset(): void {
    this.following = true;
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    this.el.scrollTop = Math.max(0, this.el.scrollHeight - this.el.clientHeight);
    this.following = true;
    this.onChange?.(true);
  }

  /** DOM 에 새 줄을 붙인 직후에 부른다. */
  afterAppend(before: ScrollMetrics): void {
    const after = metricsOf(this.el);
    const next = scrollTopAfterAppend(this.following, before, after);
    if (this.following) this.el.scrollTop = next;
  }

  measure(): ScrollMetrics {
    return metricsOf(this.el);
  }

  /** 오래된 줄을 위에 붙인 직후에 부른다. */
  afterPrepend(before: ScrollMetrics): void {
    this.el.scrollTop = scrollTopAfterPrepend(before, metricsOf(this.el));
  }
}
