// 전체 화면 보드 — frame 안에서도 창 안에 띄운다.
//
// 노드 화면은 유틸 서랍의 건물 · 도로 · 필드 · 자재 편집기, 네트워크, 설정 창을 전체 화면으로 열면 그 보드를
// iframe(class="win-fs-full")으로 통째로 띄운다(node.html 템플릿). frame 안에서는 그 중첩 iframe이 src로는 막힌다 —
// 게이트웨이의 앱 자산 CSP가 frame-ancestors에 루프백 셸만 적고, 앱 자신의 origin(app-<id>.localhost)은
// 거기에 없기 때문이다. 조상인 노드 화면(또는 시작 화면)이 그 origin이다.
//
// srcdoc 문서는 응답 헤더가 없어 frame-ancestors가 걸리지 않고, 부모의 origin · CSP · 기준 URL을 물려받는다.
// 그래서 같은 보드 HTML을 받아 srcdoc으로 넣는다. 템플릿은 src 대신 data-board를 쓴다(tools/gen-pages.py) —
// src가 있으면 srcdoc이 들어가기 전에 막힐 탐색이 먼저 나가 콘솔에 CSP 거절이 남는다.
// Terra 밖(단독 실행)에서는 막는 것이 없으니 data-board를 그대로 src로 옮긴다(opts.direct).
//
// 보드 안에서 다른 페이지로 가는 길("← 노드 화면" 링크, 설정 → 네트워크)은 중첩 탐색이라 역시 막힌다.
// 그 길은 노드 화면 쪽으로 돌린다: node.html → 전체 화면 끝, 다른 보드 → 그 보드의 창.

const PAGE = /(?:^|\/)([a-z][a-z0-9-]*\.html)(?:[?#].*)?$/i;

/** 경로·URL에서 페이지 파일 이름. 이 앱의 페이지가 아니면 null */
export function pageOf(href, base) {
  if (!href) return null;
  let path = href;
  try { path = new URL(href, base || 'http://x/').pathname; } catch { /* 상대 경로 그대로 */ }
  const m = PAGE.exec(path);
  return m ? m[1] : null;
}

/**
 * @param {any} screen 노드 화면
 * @param {{ doc?: Document, fetchText?: (page: string) => Promise<string>, direct?: boolean }} [opts]
 *        direct = Terra 밖 — srcdoc 대신 src 로 연다
 */
export function wireFrameBoards(screen, opts = {}) {
  const doc = opts.doc || document;
  const stage = doc.getElementById('stage') || doc.body;
  const cache = new Map();
  const fetchText = opts.fetchText || ((page) => fetch('./' + page, { headers: { Accept: 'text/html' } })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))));
  const load = (page) => {
    if (!cache.has(page)) cache.set(page, fetchText(page).catch((e) => { cache.delete(page); throw e; }));
    return cache.get(page);
  };
  const boardId = (page) => {
    const defs = screen.WDEF();
    return Object.keys(defs).find((id) => defs[id].href === page) || null;
  };
  const note = (title, body) => '<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;' +
    "font:13px/1.6 'Noto Sans KR',system-ui,sans-serif;color:#5b6472;background:#ffffff\"><div style=\"text-align:center\"><b style=\"color:#16191f\">" +
    title + '</b><br>' + body + '</div></body>';

  /** 보드 안에서 이 앱의 다른 페이지로 가려 하면 노드 화면이 대신 받는다. 처리했으면 true */
  const route = (page) => {
    if (!page) return false;
    if (page === 'node.html') { screen.fsExit(); return true; }
    const id = boardId(page);
    if (id) { screen.fsEnter(id); return true; }
    return false;
  };

  const hook = (iframe) => {
    const win = iframe.contentWindow, inner = iframe.contentDocument;
    if (!win || !inner || inner.__terraBoardHooked) return;
    inner.__terraBoardHooked = true;
    inner.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a && route(pageOf(a.getAttribute('href'), inner.baseURI))) e.preventDefault();
    }, true);
    // 스크립트가 location.href 로 가는 길(설정 → 네트워크). Navigation API가 있는 엔진(Chromium · WebView2)에서만 잡힌다.
    if (win.navigation && win.navigation.addEventListener) {
      win.navigation.addEventListener('navigate', (e) => {
        if (e.cancelable && route(pageOf(e.destination && e.destination.url))) e.preventDefault();
      });
    }
  };

  const swap = (iframe) => {
    const src = iframe.getAttribute('data-board') || iframe.getAttribute('src');
    const page = pageOf(src);
    if (!page || iframe.dataset.boardLoaded === src) return;
    iframe.dataset.boardLoaded = src;
    if (!iframe.__terraBoardLoad) {
      iframe.__terraBoardLoad = true;
      iframe.addEventListener('load', () => hook(iframe));
    }
    if (opts.direct) { iframe.setAttribute('src', src); return; }
    // srcdoc 속성이 생기는 순간 src보다 앞선다 — 템플릿이 src를 쓰더라도 막힐 탐색을 곧장 끊는다
    iframe.srcdoc = note('보드를 불러오는 중…', page);
    load(page)
      .then((html) => { if (iframe.dataset.boardLoaded === src) iframe.srcdoc = html; })
      .catch((e) => { if (iframe.dataset.boardLoaded === src) iframe.srcdoc = note('보드를 불러오지 못했습니다', page + ' — ' + e.message); });
  };

  const scan = (root) => {
    if (root.matches && root.matches('iframe.win-fs-full')) swap(root);
    if (root.querySelectorAll) root.querySelectorAll('iframe.win-fs-full').forEach(swap);
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') scan(r.target);
      else r.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); });
    }
  });
  observer.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-board'] });
  scan(stage);
  return () => observer.disconnect();
}
