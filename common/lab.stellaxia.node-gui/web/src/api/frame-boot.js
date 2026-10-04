// terra.web/frame 안에서 도는지 가려내고, 그렇다면 **가장 먼저** hello를 보낸다.
//
// 모든 페이지가 이 파일을 첫 import로 싣는다(tools/gen-pages.py). 화면 마운트는 무거운 동기
// 작업이라(노드 화면은 헤드리스에서 수 초) 그 뒤에 hello를 보내면 frame이 10초를 기다리다
// WEB_FRAME_HANDSHAKE_TIMEOUT을 낸다. 모듈 평가는 import 순서대로이므로 여기서 보낸 hello는
// mount보다 앞선다. 답(init)은 마운트가 끝난 뒤 이벤트 루프가 비면 처리된다.
//
// 세 가지 자리:
//   단독 실행     window.parent === window — npm run dev · 정적 서버. frame이 없다
//   frame 안      부모가 다른 origin — 셸(호스트 origin)이 앱별 origin의 이 문서를 감쌌다
//   보드 안       부모가 같은 origin — 이 앱의 다른 화면이 srcdoc 창에 이 문서를 띄웠다
//                 (노드 화면의 전체 화면 보드 · 시작 화면이 구름 뒤에 미리 읽는 노드 화면).
//                 hello는 부모가 이미 보냈다. 여기서 또 보내면 셸이 아니라 부모 창으로 가서 버려진다.
//                 그래서 보내지 않고 부모의 연결을 빌린다(아래 __terraFrameReady)
import { connectTerra } from './terra-frame-client.js';

/** @returns {'standalone' | 'frame' | 'board'} */
export function frameRole(win = globalThis.window) {
  if (!win || win.parent === win) return 'standalone';
  try {
    // 같은 origin이면 부모 문서에 닿는다. 다른 origin이면 SecurityError.
    return win.parent.document ? 'board' : 'frame';
  } catch {
    return 'frame';
  }
}

export const role = frameRole();

/** 같은 origin 부모가 내놓은 frame 연결(Promise) — 없으면 null */
export function borrowFrame(win = globalThis.window) {
  try {
    const p = win && win.parent && win.parent !== win ? win.parent.__terraFrameReady : null;
    return p && typeof p.then === 'function' ? p : null;
  } catch {
    return null;
  }
}

/**
 * frame이 init을 주면 TerraFrame, 아니면 null.
 *   frame 안  이 문서가 hello를 보낸다. 대기는 15초 — 기본 5초는 마운트가 이벤트 루프를 붙잡고 있는 동안 지나갈 수 있다.
 *   보드 안   부모의 연결을 그대로 쓴다(같은 TerraFrame — 토큰 · 갱신 · emit 이 하나로 돈다). 부모가 frame 밖이면 null.
 * @type {Promise<import('./terra-frame-client.js').TerraFrame | null>}
 */
export const frameReady = role === 'frame'
  ? connectTerra({ timeoutMs: 15000 }).catch((error) => {
    console.warn('[terra] frame의 init을 받지 못했다 — 데이터 없이 연다', error);
    return null;
  })
  : role === 'board'
    ? (borrowFrame() || Promise.resolve(null))
    : Promise.resolve(null);

// 같은 origin 의 자식(srcdoc 창)이 빌려 갈 수 있게 내놓는다 — 시작 화면 → 노드 화면 → 보드로 이어진다
if (role !== 'standalone') {
  try { globalThis.window.__terraFrameReady = frameReady; } catch { /* 창이 없는 시험 환경 */ }
}
