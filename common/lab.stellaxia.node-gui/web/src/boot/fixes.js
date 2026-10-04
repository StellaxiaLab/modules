// 두 변형이 함께 쓰는 보정 — 디자인 원본이 예시 데이터로만 돌아 드러나지 않던 빈 상태 오류를 막는다
export function applyFixes(name, Screen) {
  const P = Screen.prototype;
  if (Object.prototype.hasOwnProperty.call(P, '__fixed')) return;   // 같은 클래스에 두 번 끼우지 않는다
  Object.defineProperty(P, '__fixed', { value: true });
  if (name === 'node') {
    // 필드가 하나도 없는 맵(처음 · 빈 Gateway)에서 해안선 고리가 비어 있다
    const ce = P.coastEngine;
    if (ce) P.coastEngine = function () { const C = this._coast; if (!C || !C.loops || !C.loops.length) return null; return ce.call(this); };

    // [모듈에서 더함 · 원본에 올릴 것] leaf 맵의 자기 칸(self)은 nodes 에 없다. 그래서 연결하기가 그 칸을 빈 필드로 보고
    // 노드 위에 도로를 깔고, 자원도 그 칸에 설치된다. 예시 세계는 tree 맵에서 시작해 드러나지 않았지만,
    // 모듈은 이 노드 자신의 leaf 맵에서 시작한다. 자기 칸을 노드 칸으로 본다 — 지나가지 못하고, 연결 대상이 되고, 자원을 놓지 못한다.
    const pass = P.connPass, target = P.connTarget, place = P.placeAt;
    const isSelf = (s, k) => !!k && k === s.state.self && !s.state.nodes[k];
    if (pass) P.connPass = function (k) { return isSelf(this, k) ? false : pass.call(this, k); };
    if (target) P.connTarget = function (k, C) { return isSelf(this, k) && C && k !== C.from && k !== C.start ? true : target.call(this, k, C); };
    if (place) P.placeAt = function (key, gnd, nd, P0) { return place.call(this, key, gnd, nd || (isSelf(this, key) ? { name: this.state.map, self: true } : nd), P0); };
  }
}
