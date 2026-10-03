// 편집기(자재 · 필드)의 실데이터 층 — 사용자가 만든 것처럼 보이는 예시를 뺀다.
//
// 편집기의 기본 라이브러리(자재 m1–m22 · 필드 스킨 · 설계도 묶음)는 렌더러가 기대는 자산이라 남긴다.
// 빼는 것은 "사용자 작품" 예시 둘이다 — 저장소(AssetStore)가 아직 없어 사용자 것은 원래 비어 있어야 한다.
//   자재 편집기  커스텀 자재 c1 나무 울타리 · c2 삽 · c3 횃불
//   필드 편집기  금속 판의 예시 전용 부모 디자인(청록 띠 · 흰 테두리) — 부모 디자인은 기본을 따른다

/** 자재 편집기 — 예시 커스텀 자재(8³) 없이 연다. 새 커스텀 자재는 화면의 [새 커스텀 자재]로 만든다 */
export function realMaterial(Screen) {
  return class RealMaterial extends Screen {
    customMats() { return []; }
  };
}

/** 필드 편집기 — 금속 판의 예시 전용 부모 디자인을 뺀다 */
export function realField(Screen) {
  return class RealField extends Screen {
    fieldSkins() { return super.fieldSkins().map((sk) => (sk.id === 'metal' && sk.parent ? Object.assign({}, sk, { parent: null }) : sk)); }
  };
}
