// 실시간 이벤트 (Terra B-5) — 이 노드 Daemon 의 `terra.daemon.events.get` SSE 를 게이트웨이 invoke 로 연다.
//   EventSource 는 Authorization 을 실을 수 없어 fetch 스트림으로 읽는다 — frame 의 terra.fetch 가 앱 토큰을 싣는다.
//   끊기면 1 → 2 → 4 … 30초 뒤 last_event_id 로 이어 받는다(게이트웨이는 입력을 질의 문자열로 넘긴다 — 머리글은 못 넘긴다).
//   길이 없으면(401 · 403 · 404 · 406 · 501) 끄고 폴링만 쓴다. 열려 있는 동안에도 폴링은 바닥으로 남는다(느리게).
//   프레임: `id: <seq>` · `event: <signal>` · `data: {"signal","at","data":{…}}` · `event: reset`(다 다시 읽기) · `: keep-alive`
// maingui src/api/events.js 를 옮겼다 — 다른 점: 이 모듈의 클라이언트(client.fetch = terra.fetch)로 부르고, 프레임 읽기를 따로 시험한다

export const EVENTS_OP = 'terra.daemon.events.get';

/** 신호 → 다시 받을 조타륜 앱. Daemon 신호는 알림뿐이다(무엇이 바뀌었는지 id 만) — 받으면 그 목록을 다시 읽는다 */
export const SIGNAL_APPS = {
  'terra.tasks.changed': ['job'], 'terra.jobs.changed': ['job'],
  'terra.io.devices.changed': ['io'],
  'terra.modules.changed': ['mod'],
  'terra.svi.declarations.changed': ['decl', 'svi'], 'terra.svi.resources.changed': ['svi'], 'terra.svi.handles.changed': ['svi'],
  'terra.svi.grants.changed': ['grant', 'svi'], 'terra.svi.bindings.changed': ['grant'],
  'terra.service-tunnels.changed': ['tunnel'], 'terra.wireguard.changed': ['wg'], 'terra.network.changed': ['wg'],
  'terra.config.changed': []
};

/** 길이 없다는 답 — 다시 해 봐야 같다 */
const NO_ROUTE = [401, 403, 404, 406, 501];

/**
 * 받은 글에서 다 온 프레임을 떼어 낸다(빈 줄로 끝나는 덩어리). 덜 온 것은 rest 로 남긴다.
 * @param {string} buf
 * @returns {{ frames: { id: string|null, event: string, data: string }[], rest: string }}
 */
export function sseFrames(buf) {
  const frames = [];
  let i;
  while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
    const block = buf.slice(0, i);
    buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
    let id = null, event = 'message', data = '', any = false;
    block.split(/\r?\n/).forEach((ln) => {
      if (!ln || ln[0] === ':') return;   // 주석(: subscribed · : keep-alive)
      any = true;
      const k = ln.indexOf(':'), f = k < 0 ? ln : ln.slice(0, k), v = k < 0 ? '' : ln.slice(k + 1).replace(/^ /, '');
      if (f === 'id') id = v; else if (f === 'event') event = v; else if (f === 'data') data += (data ? '\n' : '') + v;
    });
    if (any) frames.push({ id, event, data });
  }
  return { frames, rest: buf };
}

/** 프레임 → 이벤트 { id, signal, nodeId?, data } */
export function frameEvent(f) {
  let d = null;
  try { d = f.data ? JSON.parse(f.data) : null; } catch { d = f.data; }
  const obj = d && typeof d === 'object';
  return { id: f.id, signal: (obj && d.signal) || f.event, nodeId: obj ? d.node_id : undefined, data: obj && d.data !== undefined ? d.data : d };
}

/**
 * @param {{ base: string, fetch: typeof fetch }} client  TerraClient (fetch = frame 의 terra.fetch)
 * @param {(ev: { id: string|null, signal: string, nodeId?: string, data: any }) => void} onEvent
 * @param {{ onState?: (s: 'open'|'retry'|'off', info?: any) => void, op?: string, input?: object, sleep?: (ms: number) => Promise<void> }} [opts]
 * @returns {() => void} 끄기
 */
export function openEvents(client, onEvent, opts = {}) {
  const op = opts.op || EVENTS_OP;
  const nap = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let stop = false, last = null, wait = 1000, ctl = null, fails = 0;
  const state = (s, i) => { if (opts.onState) opts.onState(s, i); };
  const run = async () => {
    while (!stop) {
      ctl = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        const body = Object.assign({}, opts.input || {}, last ? { last_event_id: last } : {});
        const headers = Object.assign({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }, last ? { 'Last-Event-ID': last } : {});
        const res = await client.fetch(client.base + '/api/v1/operations/' + encodeURIComponent(op) + '/invoke', { method: 'POST', headers, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
        const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
        if (!res.ok || ct.indexOf('text/event-stream') < 0 || !res.body) {
          fails++;
          if (NO_ROUTE.indexOf(res.status) >= 0 || fails > 5) { state('off', { status: res.status }); return; }
          throw new Error('HTTP ' + res.status);
        }
        state('open'); wait = 1000; fails = 0;
        const rd = res.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await rd.read();
          if (done || stop) break;
          const got = sseFrames(buf + dec.decode(value, { stream: true }));
          buf = got.rest;
          got.frames.forEach((f) => {
            if (f.id) last = f.id;
            if (!f.data && f.event === 'message') return;
            try { onEvent(frameEvent(f)); } catch (e) { console.warn('[terra] 이벤트 처리', e); }
          });
        }
      } catch {
        if (stop) return;
      }
      if (stop) return;
      state('retry', { wait });
      await nap(wait);
      wait = Math.min(30000, wait * 2);
    }
  };
  void run();
  return () => { stop = true; if (ctl) ctl.abort(); };
}
