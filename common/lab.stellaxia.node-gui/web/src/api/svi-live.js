// SVI 흐름 칸 · 맵 도로 애니메이션 (A-28) — 열린 핸들의 SSE를 구독해 화면 상태로 넣는다.
//   구독 = 핸들 하나에 하나. 대상:
//     · 흐름 칸: 상태 화면(자원)이 열려 있고 그 자원에 열린 핸들이 있을 때 → state.sviStream (꼬리 · 머리 줄)
//     · 맵 도로: 지금 맵에 설치돼 연결(도로)이 있는 SVI 자원에 열린 핸들이 있을 때 → state.sviFlow[자원] (초당 프레임)
//   대상에서 빠지면(창을 닫음 · 다른 자원 · 핸들 닫힘) 곧바로 끊는다 — 핸들당 구독자 한도가 32다.
//   화면 갱신은 초당 10번까지(최신 우선). 이어 받기는 없다 — 다시 붙으면 그 시점부터.
// maingui 85e28ee 의 src/api/svi-live.js 를 옮겼다(MD-24). 다른 것은 둘 — 이 모듈의 openEvents 는 op 를 opts 로 받고(events.js),
//   흐름 op 는 HELM_APPS.svi.events 에 있다(acts.stream 은 WebSocket 길 — Gateway invoke 로 닿지 않는다).
// SVI 는 Master op 다 — 앱 토큰으로는 svi.resources.get · svi.handles.get 을 받지 못해 열린 핸들이 없고, 그러면 아무 구독도 열지 않는다(PF-1).

import { openEvents } from './events.js';
import { resultText } from './client.js';
import { StreamView, TERMINAL } from './svi-stream.js';
import { HELM_APPS } from './operations.js';

const EVENTS = HELM_APPS.svi.events.op, HANDLE_GET = 'terra.master.svi.handles.by-handle-id.get';

/**
 * @param {any} screen
 * @param {import('./source.js').LiveSource & { client: import('./client.js').TerraClient }} source
 * @param {(node: string, app: string, quiet?: boolean) => void} reload 목록 다시 받기
 */
export function wireSviStreams(screen, source, reload) {
  const client = source.client, subs = new Map();   // handleId → { view, stop, purposes:Set, node, resId, poll, opens }
  if (!client || !client.has(EVENTS)) return () => {};
  screen._sviLive = true;   // 예시 흐름(sviDemoTick)을 끈다
  let dirty = false, lastFlush = 0, flushT = null, work = null;
  const done = new Set();   // 끝난 핸들 — 목록이 다시 받아질 때까지 다시 붙지 않는다

  const svi = (node) => screen.hbItems(node, 'svi') || [];
  // 지금 구독해야 할 핸들들
  const targets = () => {
    const S = screen.state, out = new Map();
    if (S.rst && S.rst.kind === 'res' && S.rst.app === 'svi' && S.winOpen && S.winOpen.rst) {
      const it = svi(S.rst.node).find((d) => d.id === S.rst.id);
      if (it && it.handle) out.set(it.handle, { node: S.rst.node, it, purpose: 'panel' });
    }
    const R = S.rsrc || {}, L = S.links || [];
    Object.keys(R).forEach((k) => {
      const o = R[k]; if (!o || o.app !== 'svi' || !L.some((l) => l.from === k || l.to === k)) return;
      const it = svi(o.node).find((d) => d.id === o.id); if (!it || !it.handle) return;
      const t = out.get(it.handle) || { node: o.node, it, purpose: 'map' }; if (t.purpose === 'panel') t.map = true; out.set(it.handle, t);
    });
    return out;
  };
  const schedule = () => {
    if (flushT) return;
    const wait = Math.max(0, 100 - (Date.now() - lastFlush));   // 초당 10번까지
    flushT = setTimeout(flush, wait);
  };
  const flush = () => {
    flushT = null; lastFlush = Date.now();
    const S = screen.state, rid = S.rst && S.rst.app === 'svi' && S.winOpen && S.winOpen.rst ? S.rst.id : null;
    const panel = [...subs.values()].find((s) => s.purposes.has('panel') || (rid && s.resId === rid));
    const patch = {}, flow = {};
    subs.forEach((s) => { flow[s.resId] = { fps: s.view.fps(), live: s.view.flowing(), state: s.view.state }; });
    patch.sviFlow = flow;
    if (panel && (panel.view.dirty || !S.sviStream || S.sviStream.handleId !== panel.view.handleId || S.sviStream.fps !== panel.view.fps())) patch.sviStream = panel.view.snapshot();
    else if (!panel && rid && kept.has(rid) && (!S.sviStream || S.sviStream.resId !== rid)) patch.sviStream = kept.get(rid);   // 끝난 흐름 (read 핸들의 결과 등)
    else if (!panel && S.sviStream && S.sviStream.live && !(S.sviStream.ended && rid === S.sviStream.resId)) patch.sviStream = null;
    const el = typeof document !== 'undefined' && document.querySelector('[data-flow-text]'), stick = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;   // 맨 아래를 보고 있었으면 따라 내려간다
    screen.setState(patch);
    if (stick && patch.sviStream && !patch.sviStream.paused) setTimeout(() => { const e2 = document.querySelector('[data-flow-text]'); if (e2) e2.scrollTop = e2.scrollHeight; }, 0);
    dirty = false;
    if ([...subs.values()].some((s) => s.view.fps() > 0)) schedule();   // fps가 0으로 내려갈 때까지 머리 줄을 고친다
  };
  // 디코딩은 시간 조각으로 (메인 스레드를 오래 잡지 않는다)
  const pump = () => {
    work = null; let more = false;
    subs.forEach((s) => { if (s.view.process(6)) more = true; });
    dirty = true; schedule();
    if (more) work = setTimeout(pump, 0);
  };
  const kick = () => { if (!work) work = setTimeout(pump, 0); };

  const start = (hid, t) => {
    const view = new StreamView({ resId: t.it.id, handleId: hid, op: t.it.handleOp || '', qos: t.it.handleQos || '', name: t.it.name });
    const s = { view, purposes: new Set([t.purpose].concat(t.map ? ['map'] : [])), node: t.node, resId: t.it.id, opens: 0, stop: null, poll: null };
    s.stop = openEvents(client, (e) => {
      view.push(e.data);
      if (e.data && e.data.kind === 'frame') kick();
      else { dirty = true; schedule(); }
      if (e.data && e.data.kind !== 'frame' && TERMINAL.test(e.data.state || '')) { end(hid); reload(t.node, 'svi', true); }
    }, { op: EVENTS, input: { handle_id: hid }, raw: true, onState: (st) => {
      if (st === 'open') s.opens++;
      view.link(st, s.opens > 1); dirty = true; schedule();
      if (st === 'off') end(hid);
    } });
    // 버린 프레임 · 쫓겨난 구독자는 핸들 보기에서 센다 (2초마다)
    const poll = async () => { const r = await client.invoke(HANDLE_GET, { handle_id: hid }).catch(() => null); if (r && r.kind === 'ok') { view.counters(r.data && (r.data.handle || r.data)); dirty = true; schedule(); } };
    if (client.has(HANDLE_GET)) { poll(); s.poll = setInterval(poll, 2000); }
    subs.set(hid, s);
  };
  // 끝난 흐름: 구독을 끊되 흐름 칸에는 마지막 모습을 남긴다 (끝난 이유와 함께)
  const end = (hid) => { done.add(hid); const s = subs.get(hid); if (!s) return; if (s.stop) s.stop(); if (s.poll) clearInterval(s.poll); s.stop = null; s.poll = null; s.ended = true;
    while (s.view.process(50));   // 마지막 프레임까지 그린 뒤 (read 핸들은 프레임 바로 뒤에 closed가 온다)
    kept.set(s.resId, s.view.snapshot()); if (kept.size > 20) kept.delete(kept.keys().next().value);
    const S = screen.state; if (s.purposes.has('panel') || (S.rst && S.rst.app === 'svi' && S.rst.id === s.resId)) screen.setState({ sviStream: kept.get(s.resId) }); subs.delete(hid); dirty = true; schedule(); };
  const stopAll = () => [...subs.keys()].forEach((h) => { const s = subs.get(h); if (s.stop) s.stop(); if (s.poll) clearInterval(s.poll); subs.delete(h); });

  // 열자마자 붙는다 (read만): read 핸들은 프레임 하나를 주고 곧 닫힌다 — 늦게 붙으면 상태만 받는다. 열린 뒤 8초는 화면이 보지 않아도 붙어 있는다
  const primed = new Map();   // handleId → { node, it, until }
  const kept = new Map();     // resId → 끝난 흐름의 마지막 모습 (상태 화면을 나중에 열어도 보인다)
  screen._sviPrime = (node, it, hid, op) => { if (!hid || op !== 'read') return;   // subscribe 핸들은 계속 흐르니 화면이 볼 때 붙어도 된다
    primed.set(hid, { node, it: Object.assign({}, it, { handle: hid, handleOp: op || it.handleOp }), until: Date.now() + 8000 }); tick(); };
  const tick = () => {
    const want = targets();
    primed.forEach((p, hid) => { if (Date.now() > p.until || done.has(hid) || want.has(hid)) primed.delete(hid); else want.set(hid, { node: p.node, it: p.it, purpose: 'primed' }); });   // 화면이 보기 시작하면 그 뒤로는 화면을 따른다
    subs.forEach((s, hid) => { if (!want.has(hid)) { if (s.stop) s.stop(); if (s.poll) clearInterval(s.poll); subs.delete(hid); dirty = true; } });   // 대상에서 빠지면 곧바로 끊는다
    want.forEach((t, hid) => {
      const s = subs.get(hid);
      if (s) { s.purposes = new Set([t.purpose].concat(t.map ? ['map'] : [])); return; }
      if (done.has(hid)) return;   // 이미 끝난 핸들은 다시 붙지 않는다
      start(hid, t); dirty = true;
    });
    const S = screen.state, rid = S.rst && S.rst.app === 'svi' && S.winOpen && S.winOpen.rst ? S.rst.id : null;
    if (rid && kept.has(rid) && (!S.sviStream || S.sviStream.resId !== rid)) dirty = true;   // 끝난 흐름을 나중에 연 상태 화면에
    if (dirty) schedule();
    screen._sviSubs = subs.size;
  };
  const T = setInterval(tick, 300);

  // 흐름 칸 손잡이: ⏸ 멈춤 · 🧹 지우기 · ⏹ 닫기 · ⬇ 저장
  const orig = screen.sviFlowCmd ? screen.sviFlowCmd.bind(screen) : null;
  screen.sviFlowCmd = (cmd) => {
    const S = screen.state, cur = S.sviStream, s = cur && subs.get(cur.handleId);
    if (cmd === 'close') {
      const it = cur && svi(S.rst.node).find((d) => d.id === cur.resId);
      if (it) return screen.hbAct('svi', it.id, 'close', S.rst.node);
      return;
    }
    if (!s) return orig ? orig(cmd) : undefined;
    if (cmd === 'pause') s.view.setPaused(!s.view.paused);
    else if (cmd === 'clear') s.view.clear();
    else if (cmd === 'save') {
      const text = s.view.saveText(), name = String(s.view.name || 'svi').replace(/[^\w.-]+/g, '_') + '-' + s.view.handleId + '.txt';
      try { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
      catch (e) { screen.hbSay('저장하지 못했다 — ' + resultText({ kind: 'error', reason: String(e) }), '#d33d52'); }
      screen._lastFlowSave = { name, lines: s.view.tail.length, bytes: text.length };
    }
    screen.setState({ sviStream: s.view.snapshot() });
  };
  return () => { clearInterval(T); stopAll(); if (flushT) clearTimeout(flushT); if (work) clearTimeout(work); };
}
