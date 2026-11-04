// A 모드의 디자인 로그인 — 호스트 비밀번호 칸(Terra PR #301 · 웹 프로그램 감싸기 설계 §4.9).
//
// 로그인 화면은 이 웹의 Login 보드가 그대로 그린다(글자 비 · 여는 연출 · TREE/LEAF · auto · New Tree · enter·tab·esc).
// 비밀번호 칸 하나만 셸 문서(다른 origin)에 있다 — frame 이 그 칸을 보드의 password 자리 위에 겹친다. 이 웹은 그 값을 볼 수 없다:
// 셸이 알려 주는 것은 칸의 상태(보임 · 포커스 · 비었는지)와 칸에서 눌린 키뿐이다.
//   제출   frame.secret.submit({ email, auto, node, attempt }) → 셸이 칸의 값을 더해 Scene 의 signin 이벤트로 → gui-v3.signin.host(credential.login)
//   기억   auto 를 켜고 제출하면 Gateway 가 기억한다. 다음에는 frame.remember.remembered() 의 id 를 채우고 고정 점을 보이며,
//          로그인은 frame.remember.resume({ email, attempt }) — 비밀번호 없이(셸이 resume: true 를 실어 같은 signin 이벤트로). auto 를 끄면 forget
//   결과   성공 = 새 토큰(onToken) · 실패 = session Store 의 error { message, attempt } 이면서 state 가 signedIn 이 아님(onValue) — attempt 로 내 시도의 답인지 안다
// 셸이 이 칸을 모르면(이전 Terra) frame.secret 이 없다 → 지금까지처럼 emit('login') 으로 Scene 의 /login 카드에 맡긴다.

const FORM = 'form[aria-label="Terra 로그인"]';
export const HOST_LOGIN_TIMEOUT_MS = 15000;

/** 셸이 호스트 비밀번호 칸을 쓸 수 있다고 말했나(init.features). @returns {object|null} */
export function hostSecretOf(frame) {
  return (frame && frame.secret) || null;
}

/**
 * 제출한 시도의 답을 기다린다. 성공은 토큰이 오는 것, 실패는 session 의 error.attempt 가 이 시도와 같아지는 것이다.
 * 단 gui-v3.signin.host 는 성공할 때도 error { message: '', attempt } 를 적는다(내 시도의 답이라는 표시) — 그 값은 state 가 signedIn 이고,
 * 셸이 토큰을 받아 오는 것(fetch)보다 먼저 온다. 그것을 실패로 읽으면 서버가 맞다고 한 로그인을 "로그인 못 함"으로 보이고, 늦게 온 토큰이
 * 비밀번호 칸을 걷어 다음 누르기가 입력과 상관없이 워프한다. 그래서 signedIn 인 답은 실패가 아니라 "토큰을 기다려라"다.
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export function waitHostLogin(frame, attempt, timeoutMs = HOST_LOGIN_TIMEOUT_MS) {
  return new Promise((done) => {
    let offToken = null, offValue = null, timer = 0, ended = false, accepted = false;
    const end = (result) => { if (ended) return; ended = true; if (offToken) offToken(); if (offValue) offValue(); clearTimeout(timer); done(result); };
    offToken = frame.onToken((token) => {
      if (token) end({ ok: true });
      else if (accepted) end({ ok: false, message: '로그인 완료 · 앱 토큰 없음' });   // 셸이 토큰 대신 signedOut 을 보냈다
    });
    offValue = frame.onValue((value) => {
      const error = value && value.error;
      if (!error || error.attempt !== attempt) return;
      if (value.state === 'signedIn') { accepted = true; return; }   // 성공의 답 — 토큰이 뒤따른다
      end({ ok: false, message: (typeof error.message === 'string' && error.message) || '로그인 실패' });
    });
    timer = setTimeout(() => end({ ok: false, message: '응답 지연 — 재시도' }), timeoutMs);
  });
}

/**
 * 기억된 로그인(auto) — 셸이 이 Scene 에 기억한 id. 셸이 기억을 모르거나(이전 Terra) 기억이 없으면 null.
 * 기억하는 것은 Gateway 다(Master refresh token 을 OS 보호 저장소로 봉한다). 이 웹은 id 만 안다 — 비밀번호도 토큰도 아니다.
 * @returns {{ email: string } | null}
 */
export function rememberedOf(frame) {
  const R = frame && frame.remember;
  return (R && R.remembered && R.remembered()) || null;
}

/**
 * 지금 기억으로 들어갈 자리인가 — 기억이 있고, 보드의 id 가 그 id 그대로이고, auto 가 켜져 있고, 아직 토큰이 없다.
 * id 를 고치거나 auto 를 끄면 일반 로그인(셸 비밀번호 칸)으로 돌아간다.
 */
export function rememberedMode(frame, state) {
  const R = rememberedOf(frame), S = state || {};
  return !!(R && S.autoOn !== false && (S.va || '') === R.email && !(frame.token && frame.token()));
}

/** 기억으로 들어갈 때 보드의 password 줄 — 고정 점(길이는 실제 비밀번호와 상관없다). 셸 칸은 두지 않는다 */
export const REMEMBERED_DOTS = '••••••••';
export function rememberedRowItems(items) {
  return items.map((it) => {
    if (it.k === 'pV') return Object.assign({}, it, { t: REMEMBERED_DOTS });
    if (it.k === 'pD') return Object.assign({}, it, { t: it.t.slice(REMEMBERED_DOTS.length), c: it.c + REMEMBERED_DOTS.length });
    return it;
  });
}

/** 시도 번호 — 다시 적재돼도 앞 문서의 답(memory Store 에 남은 error)과 겹치지 않게 시각에서 뽑는다 */
let lastAttempt = 0;
export function nextAttempt(now = Date.now()) { lastAttempt = Math.max(now, lastAttempt + 1); return lastAttempt; }

/**
 * 셸 칸의 모양 — 보드의 글자 칸(cw × ch)에 점이 한 칸씩 앉도록. 셸 문서에는 이 웹의 글꼴이 없으므로 양쪽에 다 있는 monospace 를 쓰고,
 * 그 글꼴의 '•' 너비(advance)를 재어 남는 만큼 글자 사이를 띄운다(첫 점은 칸 가운데로 반만큼 민다).
 */
export function secretStyle(cw, ch, advance) {
  const fontSize = Math.max(10, Math.round(ch * 0.78)), adv = advance(fontSize), gap = Math.max(0, +(cw - adv).toFixed(2));
  return { fontFamily: 'monospace', fontSize, color: '#f2f4fc', caret: '#f2f4fc', letterSpacing: gap, padding: `0 0 0 ${+(gap / 2).toFixed(2)}px` };
}

/** 보드의 password 줄 — 셸 칸에 글자가 있으면 보드는 그 줄의 점 · 남은 자리를 비운다(점은 셸 칸이 그린다). 비었으면 시안 그대로 */
export function passwordRowItems(items, empty) {
  if (empty) return items;
  return items.map((it) => (it.k === 'pV' || it.k === 'pD' ? Object.assign({}, it, { t: '' }) : it));
}

/**
 * 셸 칸을 보드에 잇는다. 매 프레임 보드의 password 자리를 재어 바뀌었을 때만 놓는다(여는 연출 · 창 크기 · 칸 크기를 따라간다).
 * 로그인이 열려 입력을 받는 동안에만 칸이 있다 — 닫힘 · 전환(워프) · 로그인 층이 내려간 뒤에는 걷는다(셸이 값도 지운다).
 * `wanted` 가 false 를 돌려주면(이미 로그인 — 폼을 받지 않고 워프할 때) 칸을 두지 않는다.
 * @param {{ secret: object, login: () => any, scene: () => any, wanted?: () => boolean, doc?: Document, raf?: Function, caf?: Function, advance?: (px: number) => number }} o
 * @returns {{ stop(): void }}
 */
export function bindHostSecret(o) {
  const doc = o.doc || document, raf = o.raf || ((f) => requestAnimationFrame(f)), caf = o.caf || ((id) => cancelAnimationFrame(id));
  const sec = o.secret, advance = o.advance || canvasAdvance(doc);
  let placed = '', id = 0, stopped = false;
  const q = (sel) => doc.querySelector(FORM + ' ' + sel);
  const tick = () => {
    if (stopped) return;
    id = raf(tick);
    const lg = o.login(), S = (lg && lg.state) || {}, sc = o.scene();
    const on = !!(lg && S.open && S.ready && !lg._WP && (!sc || !sc.loginOn || sc.loginOn()) && (!o.wanted || o.wanted()));
    const el = on ? q('input[name="password"]') : null, r = el && el.getBoundingClientRect();
    if (!r || !(r.width > 0) || !(r.height > 0)) { if (placed) { sec.hide(); placed = ''; } return; }
    const cw = lg._cw || 10, ch = lg._ch || 18, key = [r.left, r.top, r.width, r.height, cw, ch].join();
    if (key === placed) return;
    placed = key;
    sec.place({ x: r.left, y: r.top, width: r.width, height: r.height }, { label: 'password', style: secretStyle(cw, ch, advance) });
  };
  // 칸 상태 → 보드의 커서: 비어 있으면 보드가 첫 칸에 커서를 그린다(시안 그대로), 글자가 있으면 셸 칸의 캐럿이 맡는다
  const offState = sec.onState((st) => {
    const lg = o.login(); if (!lg || !lg.setState) return;
    const foc = (lg.state || {}).foc;
    if (st.focused && st.empty) { if (foc !== 'p') lg.setState({ foc: 'p', focAt: performance.now() }); }
    else if (foc === 'p') lg.setState({ foc: null });
  });
  // 칸에서 눌린 키 — 셸은 기본 동작을 막고 여기에 맡긴다(Tab 이면 포커스는 이미 이 iframe 에 돌아와 있다)
  const offKey = sec.onKey((k) => {
    const lg = o.login(); if (!lg) return;
    if (k === 'Enter') lg.login();
    else if (k === 'Escape') { if (lg.closeLogin) lg.closeLogin(); }
    else { const t = k === 'Tab' ? q('button[aria-label^="auto"]') : q('input[name="admin"]'); if (t) t.focus({ preventScroll: true }); }
  });
  id = raf(tick);
  return { stop() { stopped = true; caf(id); offState(); offKey(); if (placed) sec.hide(); placed = ''; } };
}

/** monospace '•' 의 너비 — 셸 칸과 같은 엔진 · 같은 OS 글꼴이라 이 웹에서 잰 값이 셸에서도 맞는다 */
function canvasAdvance(doc) {
  const memo = new Map();
  return (px) => {
    if (memo.has(px)) return memo.get(px);
    let w = px * 0.6;
    try { const ctx = doc.createElement('canvas').getContext('2d'); if (ctx) { ctx.font = px + 'px monospace'; w = ctx.measureText('•').width || w; } } catch {}
    memo.set(px, w); return w;
  };
}
