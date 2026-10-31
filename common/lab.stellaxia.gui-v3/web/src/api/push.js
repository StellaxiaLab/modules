// 밀어 받기 — 로컬 Daemon 이벤트 스트림(terra.daemon.events.get, 이 노드에서만)을 노드 데이터 층에 잇는다.
// 이벤트가 오면 그 이벤트가 건드린 자원의 사본을 낡은 것으로 쳐서 곧바로 다시 받는다(TTL 을 기다리지 않음). 원격 노드는 스트림이 열리지 않으므로 TTL 그대로.
// 스트림이 끊기면 5초 · 10초 · 20초 … (최대 60초) 뒤 다시 연다. 그 사이는 TTL(EL)로 돈다.

// 이벤트 이름 → 다시 받을 자원. 모르는 이벤트는 desk(제어기 묶음)만
export function resourcesFor(ev) {
  const t = String((ev && (ev.type || ev.event || ev.signal || ev.kind)) || '').toLowerCase(), out = new Set(['desk']);
  if (/module/.test(t)) out.add('modules');
  if (/task|job|process/.test(t)) out.add('tasks');
  if (/device|io\./.test(t)) out.add('devices');
  if (/config/.test(t)) out.add('config');
  if (/svi|declar|resource/.test(t)) out.add('svi');
  if (/status|enroll|heartbeat|^daemon\./.test(t)) out.add('status');
  return [...out];
}

/**
 * @param {{ terra: ReturnType<import('./terra.js').createTerra>, store: () => any, delayMs?: number, onEvent?: (ev: object) => void }} o
 * @returns {{ stop(): void, state(): string }}
 */
export function startPush(o) {
  let close = null, stopped = false, wait = 5000, timer = 0, flush = 0, st = 'idle';
  const pend = new Set();
  const kick = (ev) => {
    for (const r of resourcesFor(ev)) pend.add(r);
    clearTimeout(flush); flush = setTimeout(() => {   // 몰려오는 이벤트는 한 번에(0.3초)
      const S = o.store(); if (!S) return; const n = S.t.localId(); for (const r of pend) if (S.cache.has(n + '|' + r)) S.refresh(n, r); pend.clear();
    }, o.delayMs ?? 300);
  };
  const open = () => {
    if (stopped) return; st = 'opening';
    o.terra.stream('terra.daemon.events.get', {}, (ev) => { st = 'open'; wait = 5000; kick(ev); if (o.onEvent) try { o.onEvent(ev); } catch {} }, () => { close = null; st = 'closed'; again(); })
      .then((c) => { if (stopped) c(); else { close = c; st = 'open'; } }, () => { st = 'failed'; again(); });
  };
  const again = () => { if (stopped) return; clearTimeout(timer); timer = setTimeout(open, wait); wait = Math.min(60000, wait * 2); };
  open();
  return { stop() { stopped = true; clearTimeout(timer); clearTimeout(flush); if (close) close(); close = null; st = 'stopped'; }, state: () => st };
}
