// 화면 테마 — 이 브라우저의 보기 설정(노드 데이터가 아니다). 기본은 다크, 고르면 localStorage 에 남는다.
//   <html data-theme="dark|light"> — 색은 base.css 의 --t-* 토큰이 받는다
//   글자 장 · 지도는 라이트에서도 어두운 화면 그대로 — 창과 상단 줄만 밝아진다
export const THEME_KEY = 'terra.theme';

export function createTheme({ root, storage, emit }) {
  const norm = (v) => (v === 'light' ? 'light' : 'dark');
  const read = () => { try { return norm(storage && storage.getItem(THEME_KEY)); } catch { return 'dark'; } };
  let cur = read();
  const paint = () => { root.dataset.theme = cur; };
  const set = (v) => { cur = norm(v); paint(); try { if (storage) storage.setItem(THEME_KEY, cur); } catch {} if (emit) emit(); };
  paint();
  return { get: () => cur, set, toggle: () => set(cur === 'light' ? 'dark' : 'light') };
}
