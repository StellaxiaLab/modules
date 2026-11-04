// 밀어 받기 — 로컬 Daemon 이벤트 스트림(terra.daemon.events.get, 이 노드에서만)을 노드 데이터 층에 잇는다.
// 이벤트가 오면 그 이벤트가 건드린 자원의 사본을 낡은 것으로 쳐서 곧바로 다시 받는다(TTL 을 기다리지 않음). 원격 노드는 스트림이 열리지 않으므로 TTL 그대로.
// 스트림이 끊기면 5초 · 10초 · 20초 … (최대 60초) 뒤 다시 연다. 그 사이는 TTL(EL)로 돈다.
// 길: Daemon /events 는 SSE(Accept: text/event-stream)와 WebSocket 을 내는데 Gateway 는 SSE 만 나른다(계약 설명) — terra.sse 가 있으면 그것으로,
//   다시 붙을 때 마지막 id(last_event_id)를 실어 그 사이 이벤트를 먼저 받는다. 보관 범위 밖이면 Daemon 이 'reset' 을 보낸다 → 사본 전부 다시.

// 이벤트 이름 → 다시 받을 자원. 모르는 이벤트는 desk(제어기 묶음)만
export function resourcesFor(ev) {
  const t = String((ev && (ev.type || ev.event || ev.signal || ev.kind)) || '').toLowerCase(), out = new Set(['desk']);
  if (/module/.test(t)) out.add('modules');
  if (/task|job|process/.test(t)) out.add('tasks');
  if (/device|io\./.test(t)) out.add('devices');
  if (/config/.test(t)) out.add('config');
  if (/svi|declar|resource/.test(t)) out.add('svi');
  if (/status|enroll|heartbeat|^daemon\./.test(t)) out.add('status');
  if (/tunnel/.test(t)) out.add('tunnels');
  if (/wireguard/.test(t)) out.add('wg');
  return [...out];
}

/**
 * @param {{ terra: ReturnType<import('./terra.js').createTerra>, store: () => any, delayMs?: number, onEvent?: (ev: object) => void }} o
 * @returns {{ stop(): void, state(): string }}
 */
export function startPush(o) {
  let close = null, stopped = false, wait = 5000, timer = 0, flush = 0, st = 'idle', last = '', all = false;
  const pend = new Set();
  const kick = (ev) => {
    if (ev && ev.event === 'reset') all = true;   // 그 사이 이벤트를 다 받지 못했다 — 사본을 전부 다시
    for (const r of resourcesFor(ev)) pend.add(r);
    clearTimeout(flush); flush = setTimeout(() => {   // 몰려오는 이벤트는 한 번에(0.3초)
      const S = o.store(); if (!S) return; const n = S.t.localId();
      if (all) { for (const k of S.cache.keys()) { const [kn, r, inp] = k.split('|'); if (kn === n && !inp) pend.add(r); } all = false; }
      for (const r of pend) if (S.cache.has(n + '|' + r)) S.refresh(n, r); pend.clear();
    }, o.delayMs ?? 300);
  };
  const got = (ev) => { st = 'open'; wait = 5000; if (ev && ev.id) last = String(ev.id); kick(ev); if (o.onEvent) try { o.onEvent(ev); } catch {} };
  const lost = () => { close = null; st = 'closed'; again(); };
  const open = () => {
    if (stopped) return; st = 'opening';
    const p = o.terra.sse ? o.terra.sse('terra.daemon.events.get', last ? { last_event_id: last } : {}, { onEvent: got, onClose: lost })
      : o.terra.stream('terra.daemon.events.get', {}, got, lost);
    p.then((c) => { if (stopped) c(); else { close = c; st = 'open'; } }, () => { st = 'failed'; again(); });
  };
  const again = () => { if (stopped) return; clearTimeout(timer); timer = setTimeout(open, wait); wait = Math.min(60000, wait * 2); };
  open();
  return { stop() { stopped = true; clearTimeout(timer); clearTimeout(flush); if (close) close(); close = null; st = 'stopped'; }, state: () => st };
}
