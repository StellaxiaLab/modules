import { rebuildLinks, screenLinkCtx } from '../model/link-io.js';

// 두 변형이 함께 쓰는 보정 — 디자인 원본이 예시 데이터로만 돌아 드러나지 않던 빈 상태 오류를 막는다
export function applyFixes(name, Screen) {
  const P = Screen.prototype;
  if (Object.prototype.hasOwnProperty.call(P, '__fixed')) return;   // 같은 클래스에 두 번 끼우지 않는다
  Object.defineProperty(P, '__fixed', { value: true });
  if (name === 'node') {
    // 필드가 하나도 없는 맵(처음 · 빈 Gateway)에서 해안선 고리가 비어 있다
    const ce = P.coastEngine;
    if (ce) P.coastEngine = function () { const C = this._coast; if (!C || !C.loops || !C.loops.length) return null; return ce.call(this); };

    // [모듈에서 더함 · 원본에 올릴 것] leaf 맵의 자기 칸(self)은 nodes 에 없다. 원본(maingui f24c3bc)은 nodeAt() 으로
    // 연결하기(지나가지 못함 · 대상이 됨)와 상태 창은 자기 칸을 노드로 보게 됐지만, 설치(placeAt)는 칸의 nodes 만 보고
    // 자기 칸에 자원을 놓는다. 자기 칸이면 노드가 있는 필드로 넘긴다.
    const place = P.placeAt;
    if (place) P.placeAt = function (key, gnd, nd, P0) {
      const self = !nd && !!key && key === this.state.self && !(this.state.nodes || {})[key];
      return place.call(this, key, gnd, self ? { name: this.state.map, self: true } : nd, P0);
    };

    // [모듈에서 더함 · 원본에 올릴 것 — UP-28] 연결(links)의 입출력 `io`(MD-27). 연결을 놓거나 노드가 내보낼 자원을 고르면
    // 그 연결의 종류(binding · share · screen) · 끝점 · 쌍을 풀어 `io` 로 붙인다. 서버는 부르지 않는다(MD-28이 적용한다).
    // 연결 모양(from · to · start · path · road)과 도로 그림은 그대로다 — 예전 저장본은 io 없이도 화면 전용 연결로 읽힌다.
    const withIO = (name, pick) => {
      const orig = P[name];
      if (!orig) return;
      P[name] = function (...a) {
        const before = this.state.links || [], r = orig.apply(this, a), after = this.state.links || [];
        if (after !== before) {
          const added = new Set(after.filter((l) => before.indexOf(l) < 0));
          const next = rebuildLinks(after, screenLinkCtx(this), pick(a, added));
          if (next !== after) this.setState({ links: next });
        }
        return r;
      };
    };
    withIO('connEnd', (a, added) => (l) => added.has(l));   // 새 연결만 — 다른 연결의 쌍은 읽을 때 다시 푼다(합류가 바뀌어도)
    withIO('nodeSelToggle', (a) => (l) => l.id === a[0]);   // 노드가 내보낼 자원을 고르면 그 연결의 쌍이 바뀐다
  }
}
