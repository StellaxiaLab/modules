// 앱이 어디서 열렸는가 — 셸 안(브리지가 있다)인가 밖인가.
// 결정 Q-1: 셸 밖 직접 열람은 지원하지 않는다. 브리지가 없으면 "셸 안에서 여세요" 안내를 보인다
// (그 화면은 후속 작업이다 — 여기서는 갈림길만 둔다).
// 브리지: 셸이 앱을 iframe 으로 올리고 postMessage 로 hello → ready → request/response 를 주고받는다.

export type HostKind = 'shell' | 'standalone';

/** 브리지가 있을 수 있는 환경인가 — 최상위 창이면 셸에 올라온 것이 아니다. */
export function detectHost(win: { parent?: unknown; self?: unknown } | undefined): HostKind {
  if (!win || win.parent === undefined || win.parent === win.self) return 'standalone';
  return 'shell';
}
