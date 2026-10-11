// 표시용 서식 — 순수 함수. 상대 시각은 앱이 계산한다(계획서 §3.1).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(thenMs: number, nowMs: number): string {
  if (!Number.isFinite(thenMs) || thenMs <= 0) return '';
  const diff = nowMs - thenMs;
  if (diff < MINUTE) return '방금';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < 2 * DAY) return '어제';
  return `${Math.floor(diff / DAY)}일 전`;
}

/** 18200 → "18.2k". 통화로 환산하지 않는다(I14). */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n));
}

export function formatCount(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

export function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

/** 남은 시간 "m:ss". */
export function formatRemaining(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
