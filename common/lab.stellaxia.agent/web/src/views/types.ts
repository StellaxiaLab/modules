// 화면 조각의 공통 모양 — DOM 한 번 만들고 update 로 갱신한다(초점·IME·스크롤을 잃지 않는다).
export interface View<M> {
  readonly el: HTMLElement;
  update(model: M): void;
}
