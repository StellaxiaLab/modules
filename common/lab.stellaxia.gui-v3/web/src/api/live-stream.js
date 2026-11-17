// 실시간 갱신 — Master 이벤트 스트림(terra.master.events.get, SSE)을 위임 세션으로 받는다(Terra P12-1, #421).
//
// Master 계약: 프레임 `id: <seq>` · `event: <signal>` · `data: {signal, at, node_id?, cluster_id?, data}`, 15초마다 `: keep-alive`.
//   이벤트는 "다시 읽으라"는 신호일 뿐이다 — 데이터는 REST 로 다시 읽는다. 다시 붙을 때 마지막 id(last_event_id)를 실으면 버퍼(4096개 · 10분) 안의 그 뒤 이벤트를 먼저 준다.
//   버퍼 밖이면 `event: reset` — 전부 다시 읽으라. 테넌트 필터는 Master 가 한다(관리자 전체 · 클러스터 일치 · 소유 노드).
// 신호(Master): terra.nodes.changed · terra.nodes.liveness · terra.node.signal · terra.network.changed · terra.modules.changed · terra.jobs.changed · terra.documents.changed
//   · terra.svi.resources.changed · terra.svi.grants.changed · terra.svi.bindings.changed · terra.svi.handles.changed
//
// 폴링은 이 스트림이 끊겼을 때의 대비다(main.js 가 이 상태를 본다). 상태:
//   opening 여는 중 · live 받는 중 · lost 끊김(자동으로 다시 연다) · closed 닫힘(세션 만료 · 토큰 폐기 · 위임 밖 — 다시 열지 않는다) · stopped 멈춤(로그아웃)
// "없음"과 "못 봤음"을 섞지 않는다 — 스트림이 끊겼으면 '조용함'은 '아무 일 없음'이 아니다. liveText 가 그 글을 만든다.

import { backoffMs } from './backoff.js';

export const LIVE_OP = 'terra.master.events.get';

/** 신호 이름 → 다시 읽을 것. 모르는 신호는 지도(topology)만 */
export function targetsFor(ev) {
  const t = String((ev && (ev.signal || ev.event || ev.type)) || '').toLowerCase(), out = new Set();
  if (/node|network/.test(t)) out.add('topology');
  if (/module|job/.test(t)) { out.add('alarms'); out.add('modules'); out.add('tasks'); }
  if (/svi/.test(t)) out.add('svi');
  if (/network/.test(t)) out.add('net');
  if (/document/.test(t)) out.add('documents');
  if (!out.size) out.add('topology');
  return [...out];
}

/** 열기 실패 → 다시 열 수 있나. 401(세션 만료 · 토큰 폐기) · 403(권한 밖 · DELEGATION_NOT_OPEN)은 닫힘 — 다시 열어도 같다 */
export function failKind(e) {
  const st = (e && e.status) || 0, code = String((e && e.code) || '');
  if (st === 401 || /^(UNAUTHENTICATED|SESSION_EXPIRED|TOKEN_REVOKED|INVALID_TOKEN)$/.test(code)) return { closed: true, reason: 'session', text: '세션 만료 · 토큰 폐기 — 다시 로그인' };
  if (st === 403 || code === 'DELEGATION_NOT_OPEN' || code === 'FORBIDDEN') return { closed: true, reason: 'denied', text: '이 계정 · 앱에는 이벤트 스트림이 닫혀 있음' + (code ? ' (' + code + ')' : '') };
  if (st === 429) return { closed: false, reason: 'limit', text: '스트림 한도 — 잠시 뒤 다시', slow: true };
  return { closed: false, reason: 'net', text: (e && (e.code || e.message)) || '연결 실패' };
}

/**
 * @param {{ terra: { sse: Function }, onSignal: (ev: { signal: string, id: string, reset: boolean, targets: string[], data: any }) => void, onState?: (s: { state: string, reason: string, text: string, tries: number, lastAt: number }) => void,
 *   baseMs?: number, maxMs?: number, setTimeout?: Function, clearTimeout?: Function, now?: () => number }} o
 * @returns {{ stop(): void, restart(): void, state(): object }}
 */
export function startLive(o) {
  const T = o.setTimeout || ((f, ms) => setTimeout(f, ms)), C = o.clearTimeout || ((t) => clearTimeout(t)), clock = o.now || Date.now;
  const base = o.baseMs ?? 2000, max = o.maxMs ?? 30000;
  let close = null, timer = 0, tries = 0, last = '', stopped = false, gen = 0;
  const S = { state: 'opening', reason: '', text: '', tries: 0, lastAt: 0 };
  const set = (state, reason = '', text = '') => { S.state = state; S.reason = reason; S.text = text; S.tries = tries; if (o.onState) try { o.onState(Object.assign({}, S)); } catch {} };
  const got = (my, e) => {
    if (my !== gen) return;
    if (S.state !== 'live') { tries = 0; set('live'); }
    S.lastAt = clock();
    const reset = !!e && e.event === 'reset', d = e && e.data && typeof e.data === 'object' ? e.data : {};
    if (e && e.id) last = String(e.id);
    const signal = reset ? 'reset' : String(d.signal || (e && e.event !== 'message' ? e.event : '') || '');
    if (!reset && !signal) return;   // 이름 없는 프레임은 신호가 아니다
    try { o.onSignal({ signal, id: (e && e.id) || '', reset, targets: reset ? ['topology', 'alarms', 'modules', 'tasks', 'svi', 'net', 'documents'] : targetsFor({ signal }), data: d }); } catch {}
  };
  const again = (slow) => {
    if (stopped) return; C(timer); tries++;
    timer = T(open, backoffMs(tries, base, max) * (slow ? 2 : 1));
  };
  const open = () => {
    if (stopped) return; const my = ++gen; set(S.state === 'live' || S.state === 'lost' ? 'lost' : 'opening', S.reason, S.text);
    o.terra.sse(LIVE_OP, last ? { last_event_id: last } : {}, { onEvent: (e) => got(my, e), onClose: () => { if (my !== gen || stopped) return; close = null; set('lost', 'net', '스트림 끊김 — 다시 여는 중'); again(); } })
      .then((c) => { if (stopped || my !== gen) { try { c(); } catch {} return; } close = c; }, (e) => {
        if (my !== gen || stopped) return; const k = failKind(e);
        if (k.closed) { set('closed', k.reason, k.text); return; }   // 닫힘 — 다시 열지 않는다(restart 가 새 세션에서 다시 연다)
        set('lost', k.reason, k.text); again(k.slow);
      });
  };
  open();
  return {
    stop() { stopped = true; gen++; C(timer); if (close) { try { close(); } catch {} close = null; } set('stopped'); },
    /** 새 토큰 · 다시 로그인 뒤 — 닫힘을 풀고 처음부터(마지막 id 는 이어 쓴다) */
    restart() { if (stopped) return; C(timer); if (close) { try { close(); } catch {} close = null; } gen++; tries = 0; open(); },
    state: () => Object.assign({}, S),
  };
}

/** 지금 화면 값이 얼마나 믿을 만한가 — { live: 이벤트로 갱신 중인가, cls, text }. 없음/못 봤음 글에 붙인다 */
export function liveText(st, pollSec = 30) {
  const s = (st && st.state) || 'idle';
  if (s === 'live') return { live: true, cls: 'ok', text: '실시간 · 이벤트 스트림' };
  if (s === 'opening') return { live: false, cls: 'busy', text: '실시간 연결 중 · ' + pollSec + '초 폴링' };
  if (s === 'lost') return { live: false, cls: 'warn', text: '실시간 끊김 · ' + pollSec + '초마다 다시 받는 중 — 그 사이 변화는 못 봤을 수 있음' };
  if (s === 'closed') return { live: false, cls: 'err', text: (st.text || '이벤트 스트림 닫힘') + ' · ' + pollSec + '초 폴링' };
  return { live: false, cls: 'dim', text: '실시간 아님 · ' + pollSec + '초 폴링' };
}

/** 폴링 — 스트림이 받는 중이면 안전 확인으로 SAFETY_EVERY 번에 한 번만, 아니면(끊김 · 닫힘 · 여는 중 · 없음) 매번. n 은 지금까지 지나간 틱 수(1 부터) */
export const SAFETY_EVERY = 5;
export const shouldPoll = (state, n) => (state === 'live' ? n % SAFETY_EVERY === 0 : true);

// 사본 자원 이름 → 신호 대상. 'svi' 는 terra.master.svi.* 읽기 전부, 'net' 은 terra.master.network.* 읽기
const MATCH = { svi: (r) => /^terra\.master\.svi\./.test(r), net: (r) => /^terra\.master\.network/.test(r), modules: (r) => r === 'modules', tasks: (r) => r === 'tasks', documents: (r) => /^terra\.master\.documents/.test(r) };

/**
 * 신호 → 다시 읽기 — 몰려오는 신호는 한 번에(debounceMs), 사본이 있는 자원만 다시 받는다(없는 것을 새로 부르지 않는다). reset 이면 사본 전부.
 * @param {{ refreshTopology: () => void, poke?: () => void, store: () => any, debounceMs?: number, setTimeout?: Function, clearTimeout?: Function }} d
 * @returns {(ev: { targets: string[], reset: boolean }) => void}
 */
export function routeSignals(d) {
  const T = d.setTimeout || ((f, ms) => setTimeout(f, ms)), C = d.clearTimeout || ((t) => clearTimeout(t));
  let timer = 0, pend = new Set(), all = false;
  return (ev) => {
    if (ev.reset) all = true; for (const t of ev.targets || []) pend.add(t);
    C(timer); timer = T(() => {
      const P = pend, A = all; pend = new Set(); all = false;
      if (P.has('topology') || A) { try { d.refreshTopology(); } catch {} }
      if ((P.has('alarms') || A) && d.poke) { try { d.poke(); } catch {} }
      const S = d.store(); if (!S || !S.cache) return; const n = S.t.localId();
      for (const k of [...S.cache.keys()]) {
        const [kn, r, inp] = k.split('|'); if (kn !== n) continue;
        if (A || [...P].some((t) => MATCH[t] && MATCH[t](r))) S.refresh(kn, r, inp || undefined);
      }
    }, d.debounceMs ?? 500);
  };
}
