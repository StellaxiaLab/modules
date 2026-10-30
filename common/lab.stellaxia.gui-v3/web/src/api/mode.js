// 실행 모드 — 같은 웹 빌드가 어디서 열렸는지 보고 Terra 에 닿는 길을 고른다.
//
//   demo  주소 뒤 ?demo — Terra 없이 시안의 목업(캔버스와 같은 값)
//   app   A 모드 — 다른 셸(terra.web/frame)이 모듈 앱으로 감쌌다. 셸이 준 앱 스코프 토큰(Bearer tsa_)으로 부르고, 로그인 화면은 건너뛴다(셸이 이미 로그인했다).
//         Master 는 위임 문 37개만, 보기 상태 문서는 app:<앱 id> 이름공간
//   shell B 모드 — 제품 셸의 첫 화면(단독으로 열림). 로그인 화면이 스스로 로그인(자격 핸들), 사용자 권한 전부
// 주소 뒤 ?mode=app|shell 로 고를 수 있다(시험 · 개발).

import { connectTerra } from './terra-frame-client.js';
import { singleFlightFrame } from './frame-token.js';

/** @returns {'standalone'|'frame'} */
export function frameRole(win = globalThis.window) {
  if (!win || win.parent === win) return 'standalone';
  try { return win.parent.document ? 'standalone' : 'frame'; } catch { return 'frame'; }   // 같은 origin 부모(보드 미리보기)는 셸이 아니다
}

/** @param {URLSearchParams} q */
export function pickMode(q, win = globalThis.window) {
  if (q.has('demo')) return 'demo';
  const m = q.get('mode'); if (m === 'app' || m === 'shell') return m;
  return frameRole(win) === 'frame' ? 'app' : 'shell';
}

/**
 * A 모드 — 셸에 hello 를 보내고 init(앱 토큰 · 앱 id)을 받는다. 못 받으면 null(그때는 B 모드로 돈다)
 * @returns {Promise<null | { token: () => string|undefined, refresh: () => Promise<string|undefined>, appId: string, permissions: () => string[], onToken: Function }>}
 */
export function connectApp(o = {}) {
  return connectTerra({ timeoutMs: o.timeoutMs ?? 15000, window: o.window }).then((f) => singleFlightFrame(f), () => null);
}
