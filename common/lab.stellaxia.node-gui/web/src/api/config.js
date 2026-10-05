// 실행 설정 — public/config.json (빌드 결과 ui/config.json. 이 파일만 바꾸면 다시 빌드할 필요 없다)
//   variant     : module — tools/gen-pages.py 가 이 값으로 페이지를 만든다 (빌드 뒤 바꾸면 안 맞는다)
//   layoutStore : server = 맵 배치 · 노드 모습 · 메모를 이 브라우저(앱 origin)에 바로, Terra 사용자 문서 저장소에 뒤따라
//                          (다른 기기 · 브라우저에서 같은 맵. 게이트웨이에 저장소가 없거나 막히면 브라우저에만) ·
//                 local = 이 브라우저에만 · none = 저장 안 함(공용 화면)
//   pollSec     : 조타륜 앱 · 설치한 노드 자원을 다시 받는 간격(초)
// 짝 프로젝트(service)의 gateway 키는 없다 — 모듈은 Terra 셸이 frame 으로 건네는 게이트웨이에만 닿는다.
let cached = null;
const DEFAULTS = { variant: 'module', appTitle: 'Terra', layoutStore: 'server', pollSec: 10 };
const STORES = ['server', 'local', 'none'];

/** @returns {Promise<{ variant: string, appTitle: string, layoutStore: 'server'|'local'|'none', pollSec: number }>} */
export async function loadConfig() {
  if (cached) return cached;
  let c = {};
  try { const r = await fetch('./config.json', { cache: 'no-store' }); if (r.ok) c = await r.json(); } catch { /* 없으면 기본값 */ }
  cached = Object.assign({}, DEFAULTS, c && typeof c === 'object' ? c : {});
  if (STORES.indexOf(cached.layoutStore) < 0) cached.layoutStore = DEFAULTS.layoutStore;
  cached.pollSec = Math.max(5, Number(cached.pollSec) || DEFAULTS.pollSec);
  return cached;
}

/** 시험용 — 받아 둔 설정을 버린다 */
export function resetConfig() { cached = null; }
