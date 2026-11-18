// 셸이 연 모듈 웹 앱 창(예: Node Talk)의 최소화 목록을 gui-v3 의 '최소화 창'에 잇는다.
//   셸(Terra)의 terra.web/frame 이 init.features 에 'minimize' 를 실었을 때만 선다(frame.minimized). 없으면 null —
//   그러면 셸이 자기 트레이(webapp-tray)로 최소화 창을 보인다. 이 웹이 take(true)로 "목록은 내가 보인다"고 선언해야 셸 트레이가 숨는다.
//   목록은 window.TerraShellMin.list() 로 Field/Scene 의 winFind 가 읽고, 바뀌면 'terra-shell-min' 신호로 다시 그린다.
export function createShellMin(frame, { now = () => performance.now(), notify = () => {} } = {}) {
  const M = frame && frame.minimized;
  if (!M) return null;
  const seen = new Map();   // 창 id → 처음 본 시각(목록의 '방금 · 3m 전' 과 정렬)
  let list = [];
  const sync = (next) => {
    const t = now(), ids = new Set();
    list = next.map((w) => { ids.add(w.id); if (!seen.has(w.id)) seen.set(w.id, t); return { id: w.id, title: w.title, nodeName: w.nodeName || '', at: seen.get(w.id) }; });
    for (const id of [...seen.keys()]) if (!ids.has(id)) seen.delete(id);
  };
  sync(M.list());
  M.onChange((next) => { sync(next); notify(); });
  M.take(true);   // 이 웹이 목록을 보인다 — 셸 트레이를 숨긴다
  return {
    list: () => list.map((w) => ({ ...w })),
    restore: (id) => M.restore(id),
    close: (id) => M.close(id),
    release: () => M.take(false)
  };
}
