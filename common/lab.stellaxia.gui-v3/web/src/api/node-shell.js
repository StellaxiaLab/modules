// 노드 셸 — 제어기의 "그 노드의 OS 셸" 창(ADR-GW-014 P16-4a · Terra P16-1 Daemon 터미널 · 계약 T3).
//
//   열기    terra.daemon.terminal.sessions.post  — T3 승인 문 대상(approval-ops.json). terra.invoke 가 frame.approve() 로 호스트 승인 화면을 거쳐 부른다.
//           앱 토큰으로 직접 나가지 않는다(Terra #435: 승인 표시 없으면 APPROVAL_REQUIRED · 앱 토큰 직접은 DELEGATION_NOT_OPEN).
//           스위치(danger-zone.node-shell)가 꺼져 있으면 NODE_SHELL_DISABLED — 창이 스위치로 안내한다.
//           응답 { session: { session_id, shell, cols, rows, … }, elevated, warning } — elevated 면 Daemon 이 관리자 · root 라 셸도 그렇다(창 머리 띠).
//   붙기    terra.daemon.terminal.sessions.by-session-id.stream.get — 스트림 티켓(POST /streams/tickets → WebSocket). 양방향 바이너리:
//           노드 → 창 : 바이너리 프레임 = 터미널이 그린 바이트 · 창 → 노드 : 바이너리 = 친 키, 텍스트 {"type":"resize","cols":N,"rows":N}.
//           붙지 않은 세션은 60초 뒤 노드가 닫는다. 스트림이 닫히면 세션도 닫힌다(다시 붙기 없음).
//   크기    terra.daemon.terminal.sessions.by-session-id.resize.post (실패하면 스트림 제어 프레임으로)
//   닫기    terra.daemon.terminal.sessions.by-session-id.delete
//
// 원격 노드는 열지 않는다 — 이 operation 들의 scopes 가 local 뿐이다(op-scope.json). 원격 제어기의 창은 이유만 말한다(remoteText).
// 순수 로직 — DOM 없음. 시험은 invoke · streamIO 를 흉내 낸다.

import { VtScreen } from './vt-screen.js';
import { errorLine } from './error-text.js';

export const OPS = Object.freeze({
  open: 'terra.daemon.terminal.sessions.post',
  close: 'terra.daemon.terminal.sessions.by-session-id.delete',
  resize: 'terra.daemon.terminal.sessions.by-session-id.resize.post',
  stream: 'terra.daemon.terminal.sessions.by-session-id.stream.get',
  switchGet: 'terra.daemon.danger-zone.node-shell.get',
  switchSet: 'terra.daemon.danger-zone.node-shell.post',
});

/** 원격 제어기에서 — 노드 셸은 그 노드에서만(P15 원격 관리 규칙은 op scopes 가 local 뿐인 이 셸에 닿지 않는다) */
export const remoteText = (node) => '노드 셸은 ' + (node ? node + ' 의' : '그 노드의') + ' 제어기에서만 열림 — 다른 노드에서는 열 수 없음 (원격 관리가 켜져 있어도 같다)';
export const OFF_TEXT = '노드 셸이 꺼져 있음 — 위험 영역에서 켜기';
export const NO_DOOR_TEXT = '승인 문 없음 — Terra 셸 안에서 열기';
export const ELEVATED_TEXT = '⚠ 관리자 · root 셸 — 이 노드의 Daemon 이 높은 권한으로 돌아 이 셸도 그 권한을 가짐';

/** 키 → 노드로 보낼 글자. null 이면 이 함수가 맡지 않는다(글자는 입력 칸이 받고, 복사 · 붙여넣기는 브라우저가 한다) */
export function keyBytes(e) {
  if (!e || e.isComposing || e.key === 'Process' || e.key === 'Dead') return null;
  const k = e.key;
  const FN = { ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~', Insert: '\x1b[2~', PageUp: '\x1b[5~', PageDown: '\x1b[6~',
    F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS', F5: '\x1b[15~', F6: '\x1b[17~', F7: '\x1b[18~', F8: '\x1b[19~', F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~' };
  if (e.metaKey) return null;
  if (e.ctrlKey && !e.altKey) {
    if (e.shiftKey) return null;                                  // Ctrl+Shift+C · V — 브라우저(복사 · 붙여넣기)
    if (k.length === 1) { const c = k.toLowerCase().charCodeAt(0); if (c >= 97 && c <= 122) return String.fromCharCode(c - 96); if (k === '[') return '\x1b'; if (k === '\\') return '\x1c'; if (k === ']') return '\x1d'; if (k === ' ' || k === '@') return '\x00'; }
    if (FN[k]) return FN[k].replace(/^\x1b\[([A-DHF])$/, '\x1b[1;5$1');   // Ctrl+화살표 · Home · End
    return null;
  }
  if (e.altKey && !e.ctrlKey && k.length === 1) return '\x1b' + k;
  if (k === 'Enter') return '\r'; if (k === 'Backspace') return '\x7f'; if (k === 'Tab') return e.shiftKey ? '\x1b[Z' : '\t'; if (k === 'Escape') return '\x1b';
  if (FN[k]) return FN[k];
  return null;                                                     // 보이는 글자 — 입력 칸의 input 이벤트가 받는다(한글 조합 포함)
}

const bodyOf = (r) => (r && r.session ? r : r && r.data && r.data.session ? r.data : r || {});

/**
 * @param {{ invoke: (op: string, input?: object) => Promise<any>, streamIO: (op: string, input: object, h: { onMessage?: Function, onClose?: Function, binary?: boolean }) => Promise<{ send: Function, close: Function }>,
 *   setTimeout?: Function, clearTimeout?: Function, scrollback?: number }} d
 */
export function createNodeShell(d) {
  const T = d.setTimeout || ((f, ms) => setTimeout(f, ms)), C = d.clearTimeout || ((t) => clearTimeout(t));
  const subs = new Set();
  const S = { phase: 'idle', code: '', text: '', elevated: false, warning: '', shell: '', sessionId: '', cols: 80, rows: 24, title: '', offset: 0, rev: 0, off: false };
  let screen = null, sock = null, dec = null, enc = new TextEncoder(), gen = 0, notifyT = 0, resizeT = 0, want = { cols: 80, rows: 24 }, closing = false;
  const notify = () => { S.rev++; for (const f of [...subs]) { try { f(S); } catch {} } };
  const soon = () => { if (notifyT) return; notifyT = T(() => { notifyT = 0; notify(); }, 33); };
  const set = (p) => { Object.assign(S, p); notify(); };
  const send = (bytes) => { if (!sock) return false; try { sock.send(typeof bytes === 'string' ? enc.encode(bytes) : bytes); return true; } catch { return false; } };

  const api = {
    state: () => S,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    /** 화면 줄들(없으면 빈 배열) */
    view: () => (screen ? screen.view(S.offset) : []),
    text: () => (screen ? screen.text(S.offset) : []),
    live: () => S.phase === 'live',
    busy: () => S.phase === 'opening' || S.phase === 'live',

    /**
     * 셸 열기 — 승인 문 → 세션 → 스트림. 실패는 던지지 않고 상태(phase · code · text)로 말한다.
     * @param {{ cols?: number, rows?: number, shell?: string, node?: string }} [o]
     */
    async open(o = {}) {
      if (api.busy()) return false;
      const my = ++gen; closing = false;
      want = { cols: Math.max(2, o.cols | 0 || 80), rows: Math.max(1, o.rows | 0 || 24) };
      screen = null; sock = null;
      set({ phase: 'opening', code: '', text: '승인 기다리는 중 — 호스트 화면에서 승인', elevated: false, warning: '', sessionId: '', shell: '', title: '', offset: 0, off: false });
      let r;
      try { r = await d.invoke(OPS.open, Object.assign({ cols: want.cols, rows: want.rows }, o.shell ? { shell: o.shell } : {})); }
      catch (e) { if (my !== gen) return false; return api.fail(e, OPS.open, o.node); }
      if (my !== gen) { const b = bodyOf(r), id = b.session && b.session.session_id; if (id) d.invoke(OPS.close, { session_id: id }).catch(() => {}); return false; }
      const b = bodyOf(r), ses = b.session || {}, id = String(ses.session_id || '');
      if (!id) { set({ phase: 'error', code: 'BAD_RESPONSE', text: '세션 응답에 session_id 가 없음' }); return false; }
      screen = new VtScreen(want.cols, want.rows, { scrollback: d.scrollback ?? 2000, onReply: (s) => send(s), onTitle: (t) => { S.title = t; soon(); } });
      dec = new TextDecoder('utf-8');
      set({ phase: 'opening', text: '붙는 중…', sessionId: id, shell: String(ses.shell || ''), elevated: !!b.elevated, warning: String(b.warning || '') });
      try {
        sock = await d.streamIO(OPS.stream, { session_id: id }, {
          binary: true,
          onMessage: (v) => { if (my !== gen || !screen) return; if (typeof v === 'string') return; screen.write(dec.decode(v instanceof ArrayBuffer ? new Uint8Array(v) : v, { stream: true })); if (S.offset) S.offset = 0; soon(); },
          onClose: (ev) => { if (my !== gen) return; api.ended(ev); },
        });
      } catch (e) {
        if (my !== gen) return false;
        d.invoke(OPS.close, { session_id: id }).catch(() => {});   // 붙지 못한 세션은 바로 닫는다(안 그러면 60초 뒤)
        return api.fail(e, OPS.stream, o.node);
      }
      if (my !== gen) { try { sock.close(); } catch {} return false; }
      set({ phase: 'live', text: '', cols: want.cols, rows: want.rows });
      if (Number(ses.cols) !== want.cols || Number(ses.rows) !== want.rows) api.resizeNow(want.cols, want.rows);   // 승인 문이 cols · rows 를 못 실었으면 붙은 직후 맞춘다
      return true;
    },
    fail(e, op, node) {
      const code = String((e && e.code) || 'ERROR');
      if (code === 'APPROVAL_DECLINED') { set({ phase: 'idle', code, text: '승인하지 않음 — 셸을 열지 않았음' }); return false; }
      if (code === 'NODE_SHELL_DISABLED') { set({ phase: 'off', code, text: errorLine(op, e, { node }) || OFF_TEXT, off: true }); return false; }
      set({ phase: 'error', code, text: errorLine(op, e, { node }) || code, off: false }); return false;
    },
    /** 스트림이 닫혔다 — 우리가 닫은 게 아니면 끊김 안내 */
    ended(ev) {
      if (closing || S.phase === 'idle') return;
      const why = String((ev && ev.reason) || '');
      const text = /exit/i.test(why) ? '셸이 끝남 (exit) — 세션이 닫힘' : S.phase === 'opening' ? '붙기 전에 닫힘' : '연결이 끊김 — 세션이 닫힘 (다시 붙기 없음 · 유휴 60초 · 로그아웃 · 노드 재시작 · 토큰 만료)';
      sock = null; set({ phase: 'closed', code: /exit/i.test(why) ? 'SHELL_EXITED' : 'DISCONNECTED', text });
    },
    /** 키 · 글자 보내기 */
    input(data) { if (S.phase !== 'live' || data == null || data === '') return false; if (S.offset) { S.offset = 0; soon(); } return send(typeof data === 'string' ? data : data); },
    /** 칸 수가 바뀌면(창 크기) 잠깐 모았다가 한 번 — 화면도 같이 */
    fit(cols, rows) {
      cols = Math.max(2, Math.min(500, cols | 0)); rows = Math.max(1, Math.min(500, rows | 0));
      want = { cols, rows };
      if (S.phase !== 'live' || (cols === S.cols && rows === S.rows)) return;
      C(resizeT); resizeT = T(() => { resizeT = 0; api.resizeNow(cols, rows); }, 150);
    },
    resizeNow(cols, rows) {
      if (!screen || !S.sessionId) return;
      const id = S.sessionId; screen.resize(cols, rows); S.cols = cols; S.rows = rows; notify();
      d.invoke(OPS.resize, { session_id: id, cols, rows }).catch(() => { try { if (sock) sock.send(JSON.stringify({ type: 'resize', cols, rows })); } catch {} });
    },
    /** 스크롤백 거슬러 보기(+위 · −아래, 줄 수) */
    scroll(lines) { if (!screen) return; S.offset = Math.max(0, Math.min(screen.history, S.offset + (lines | 0))); notify(); },
    /** 창을 닫을 때 — 세션을 지운다. 이미 닫혔으면 조용히 */
    async close() {
      const id = S.sessionId, had = S.phase === 'live' || S.phase === 'opening'; closing = true; gen++;
      C(resizeT); resizeT = 0; C(notifyT); notifyT = 0;
      if (sock) { try { sock.close(); } catch {} sock = null; }
      if (id && had) { try { await d.invoke(OPS.close, { session_id: id }); } catch {} }
      screen = null; set({ phase: 'idle', code: '', text: '', sessionId: '', elevated: false, warning: '', offset: 0 });
      closing = false;
    },
    /** 닫힌 · 실패한 창을 처음으로(다시 열기 단추 전) */
    reset() { if (api.busy()) return; screen = null; set({ phase: 'idle', code: '', text: '', off: false, sessionId: '', elevated: false, warning: '' }); },
  };
  return api;
}

/**
 * 창이 보여 줄 판 — 어떤 화면을 그릴지와 문구.
 * @param {{ remote?: boolean, node?: string, mode?: 'sim'|'real', canApprove?: boolean, sw?: { state?: string, on?: boolean, status?: string } | null, shell?: { phase: string, text?: string } | null }} o
 * @returns {{ kind: 'sim'|'remote'|'off'|'noDoor'|'idle'|'opening'|'live'|'closed'|'error', text: string, canOpen: boolean, toSwitch: boolean }}
 */
export function shellPanel(o = {}) {
  const sh = o.shell || { phase: 'idle', text: '' };
  if (o.mode === 'sim') return { kind: 'sim', text: '시안(캔버스) — 실제 Terra 에서만 열림 · 셸 출력을 지어내지 않음', canOpen: false, toSwitch: false };
  if (o.remote) return { kind: 'remote', text: remoteText(o.node), canOpen: false, toSwitch: false };
  if (sh.phase === 'live') return { kind: 'live', text: '', canOpen: false, toSwitch: false };
  if (sh.phase === 'opening') return { kind: 'opening', text: sh.text || '여는 중…', canOpen: false, toSwitch: false };
  if (sh.phase === 'off' || (o.sw && o.sw.state === 'ok' && o.sw.on === false && sh.phase === 'idle')) return { kind: 'off', text: (sh.phase === 'off' && sh.text) || OFF_TEXT, canOpen: false, toSwitch: true };
  if (o.canApprove === false) return { kind: 'noDoor', text: NO_DOOR_TEXT, canOpen: false, toSwitch: false };
  if (sh.phase === 'closed') return { kind: 'closed', text: sh.text, canOpen: true, toSwitch: false };
  if (sh.phase === 'error') return { kind: 'error', text: sh.text, canOpen: true, toSwitch: false };
  return { kind: 'idle', text: sh.text || '', canOpen: true, toSwitch: false };
}
