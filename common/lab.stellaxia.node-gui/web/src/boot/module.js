// 모듈 프로필 — Terra 안(terra.web/frame)에서 도는 변형. 예시 데이터를 모두 지우고 이 노드의 게이트웨이에서 받은 것만 보인다.
//   prep(name, Screen) : 화면을 띄우기 전에 — 공통 보정(fixes.js)을 끼우고, 예시를 지운 클래스(src/data/*.js)를 돌려준다
//   boot(name, screen) : 띄운 직후 — 노드 화면은 frame 토큰으로 실데이터에 붙이고(wire.js), 시작 화면은 Terra 세션을 본다
// 짝 프로젝트의 service 프로필(src/boot/service.js)과 같은 자리 · 같은 순서다. 다른 점 셋:
//   1) 프로토타입을 고치는 대신 이어받은 클래스를 돌려준다 — 생성자에서 예시를 지워 첫 그림부터 예시가 없다(페이지가 그 클래스를 띄운다)
//   2) 로그인 · 세션은 Terra 가 쥔다 — 웹은 비밀번호를 받지 않고 terra.emit('login')만 보낸다(웹 프로그램 감싸기 설계 §3.3.1)
//   3) 게이트웨이 주소는 설정이 아니라 frame 이 건넨다 — 이 노드의 게이트웨이에만 닿는다
// 화면 코드(src/screens/*.js)는 디자인 캔버스에서 생성된 그대로 둔다 — docs/guides/module-profile.md
import { applyFixes } from './fixes.js';
import { realNode } from '../data/node-live.js';
import { realNetwork } from '../data/network-live.js';
import { realSettings } from '../data/settings-live.js';
import { realMaterial, realField } from '../data/editors-live.js';
import { realIntro, bootIntro } from '../data/intro-live.js';
import { wireFromUrl } from '../api/wire.js';

/** 화면 이름 → 예시를 지운 클래스를 만드는 함수. 없는 화면(건물 · 도로 · 그라운드 편집기)은 예시가 아니라 자산 라이브러리만 품는다 */
export const REAL = { intro: realIntro, node: realNode, network: realNetwork, settings: realSettings, material: realMaterial, field: realField };

// ───── 화면 띄우기 전 ─────
export function prep(name, Screen) {
  applyFixes(name, Screen);
  const real = REAL[name];
  return real ? real(Screen) : Screen;
}

// ───── 띄운 직후 ─────
export function boot(name, screen) {
  if (name === 'node') return wireFromUrl(screen);
  if (name === 'intro') return bootIntro(screen);
  return null;   // 보드(네트워크 · 설정)는 스스로 붙는다 — componentDidMount → src/data/live-host.js connectLive
}
