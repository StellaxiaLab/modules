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
//   보드 안       부모가 같은 origin — 노드 화면이 전체 화면 창에 이 보드를 띄웠다(frame-boards.js).
//                 hello는 노드 화면이 이미 보냈다. 여기서 또 보내면 노드 화면 창으로 가서 버려진다
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

/**
 * frame이 init을 주면 TerraFrame, 아니면 null.
 * 대기는 15초 — 기본 5초는 마운트가 이벤트 루프를 붙잡고 있는 동안 지나갈 수 있다.
 * @type {Promise<import('./terra-frame-client.js').TerraFrame | null>}
 */
export const frameReady = role === 'frame'
  ? connectTerra({ timeoutMs: 15000 }).catch((error) => {
    console.warn('[terra] frame의 init을 받지 못했다 — 예시 데이터로 연다', error);
    return null;
  })
  : Promise.resolve(null);
