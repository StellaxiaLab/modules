// frame 안의 세션 — 로그인 띠.
//
// 웹 안에는 로그인 화면을 두지 않는다(웹 프로그램 감싸기 설계 §3.3.1). 웹이 비밀번호를 받으면 모듈 JS가
// 사용자의 Terra 비밀번호를 보게 되고, 그 JS는 비밀번호를 들고 토큰의 교집합을 우회할 수 있다. 그래서
//   로그인    웹은 terra.emit('login')만 보낸다 → Scene의 /login Route(내장 엘리먼트 카드)가 받는다
//   로그아웃  terra.emit('logout') → Scene의 signout Function. 이 Scene이 쥔 Handle이 있을 때만(session.state)
// frame이 건네는 값(terra.value())은 Scene의 session Store다: { state: 'signedIn' | 'signedOut', principal }.
// tree 전환은 여기서 다루지 않는다 — 실데이터 층(src/data/node-live.js beginSwitch)이 다른 tree로 가지 않게 막는다.
//
// 띠는 생성되는 화면(#stage) 밖, body에 붙인다 — dc.js는 #stage의 자식 중 템플릿에 없는 것을 지운다.
// 자리는 오버헤드 패널 가운데 띠 바로 아래이고, 화면 맞춤(fitScreen)이 [data-node-root]를 줄이면 따라 줄어든다.

const W = 1447;

/**
 * @param {any} screen  mount()가 돌려준 노드 화면
 * @param {import('./terra-frame-client.js').TerraFrame} terra
 */
export function wireFrameSession(screen, terra, doc = document) {
  // ── 로그인 띠 ───────────────────────────────────────────
  const bar = doc.createElement('div');
  bar.setAttribute('data-terra-session', '');
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed', 'z-index:2147483000', 'display:none', 'align-items:center', 'gap:10px',
    'padding:6px 8px 6px 14px', 'border-radius:999px', 'background:#ffffff', 'border:1.5px solid #1f2a37',
    'box-shadow:0 6px 18px rgba(22,25,31,0.18)', "font:600 12.5px/1.4 'Noto Sans KR','Noto Sans',system-ui,'Segoe UI',sans-serif",
    'color:#16191f', 'white-space:nowrap', 'transform-origin:top center'
  ].join(';');
  doc.body.appendChild(bar);

  let dismissed = '';
  const button = (label, onClick, primary) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'border-radius:999px;padding:4px 12px;cursor:pointer;font:inherit;font-weight:700;' +
      (primary ? 'background:#1f2a37;color:#ffffff;border:1.5px solid #1f2a37' : 'background:#f4f6f9;color:#1f2a37;border:1.5px solid #d8dde5');
    b.addEventListener('click', onClick);
    return b;
  };
  const text = (t, color) => {
    const s = doc.createElement('span');
    s.textContent = t;
    if (color) s.style.color = color;
    return s;
  };

  /** 지금 상태에 맞는 띠 내용. null 이면 띠를 숨긴다 */
  const view = () => {
    const token = terra.token();
    const value = terra.value();
    const session = value && typeof value === 'object' ? value : {};
    if (!token) {
      const reason = terra.absence() || 'NO_SESSION';
      if (reason === 'NO_SESSION') {
        return { key: reason, parts: [text('●', '#a65f00'), text('Terra에 로그인하지 않았습니다 — 로그인하면 이 노드의 데이터가 보입니다'),
          button('로그인', () => terra.emit('login'), true)] };
      }
      if (reason === 'SCOPE_TOKEN_DENIED') {
        return { key: reason, parts: [text('●', '#d33d52'), text('이 계정에는 이 화면이 쓰는 권한이 없습니다'),
          button('다른 계정으로', () => terra.emit('login'), false)] };
      }
      return { key: reason, parts: [text('●', '#d33d52'), text('게이트웨이에서 화면 토큰을 받지 못했습니다 (' + reason + ')')] };
    }
    if (session.state === 'signedIn') {
      return { key: 'signedIn:' + session.principal, compact: true,
        parts: [text('●', '#1f7a4d'), text(session.principal || '로그인됨'), button('로그아웃', () => terra.emit('logout'), false)] };
    }
    return null;   // 셸의 세션으로 토큰을 받았다 — 이 Scene이 쥔 로그인이 아니므로 로그아웃도 셸의 몫이다
  };

  const place = () => {
    const root = doc.querySelector('[data-node-root]');
    const r = root ? root.getBoundingClientRect() : { left: 0, top: 0, width: W };
    const k = Math.min(1, (r.width || W) / W);
    bar.style.left = Math.round(r.left + (r.width || W) / 2) + 'px';
    bar.style.top = Math.round(r.top + 54 * k) + 'px';
    bar.style.transform = 'translateX(-50%) scale(' + k + ')';
  };

  const update = () => {
    const v = view();
    if (!v || v.key === dismissed) { bar.style.display = 'none'; return; }
    const close = v.compact ? [] : [button('×', () => { dismissed = v.key; update(); }, false)];
    bar.replaceChildren(...v.parts, ...close);
    bar.style.display = 'flex';
    place();
  };

  const offToken = terra.onToken(update);
  const offValue = terra.onValue(update);
  const win = doc.defaultView;
  win.addEventListener('resize', place);
  update();

  return {
    update,
    dispose() {
      offToken(); offValue();
      win.removeEventListener('resize', place);
      bar.remove();
    }
  };
}
