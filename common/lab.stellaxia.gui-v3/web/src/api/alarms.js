// 알림 — 이 노드 Daemon 의 작업(terra.daemon.tasks.get)과 모듈(terra.daemon.modules.get) 상태가 바뀐 것을 알림 한 줄로.
//
// node-gui(data/alarms.js)와 같은 길: 작업 목록을 주기적으로 읽어 바뀐 것만 낸다. 처음 읽은 것은 알리지 않는다(이미 있던 것).
// 밀어 받기(push.js)가 이벤트를 받으면 poke() 로 바로 다시 읽는다. 알림 한 줄 = { at, kind, id, g, c, m }.

const TASK = {
  succeeded: ['완료', '●', '#4ade80'], success: ['완료', '●', '#4ade80'], completed: ['완료', '●', '#4ade80'],
  failed: ['실패', '■', '#ff6b81'], dead_letter: ['실패', '■', '#ff6b81'], timed_out: ['시간 초과', '■', '#ff6b81'], timeout: ['시간 초과', '■', '#ff6b81'],
  canceled: ['취소됨', '◐', '#fbbf24'], cancelled: ['취소됨', '◐', '#fbbf24']
};
const MOD_BAD = new Set(['failed', 'unavailable', 'config_invalid']);
const arr = (d, k) => (Array.isArray(d) ? d : (d && Array.isArray(d[k]) ? d[k] : []));
const low = (v) => String(v || '').toLowerCase();

/**
 * 앞 상태와 지금 목록 → 새 알림들. 처음(prev 가 없는 항목)은 알리지 않는다.
 * @param {{ tasks: Map<string,string>, mods: Map<string,string> } | null} prev
 * @returns {{ next: { tasks: Map<string,string>, mods: Map<string,string> }, alarms: object[] }}
 */
export function diff(prev, tasksData, modsData, now = Date.now()) {
  const next = { tasks: new Map(), mods: new Map() }, alarms = [];
  for (const t of arr(tasksData, 'tasks')) {
    const id = t.id || t.ID, st = low(t.state || t.State); if (!id) continue;
    next.tasks.set(id, st);
    const was = prev && prev.tasks.get(id), K = TASK[st];
    if (prev && was !== st && K) alarms.push({ at: now, kind: 'task', id, g: K[1], c: K[2], m: '작업 ' + (t.type || t.Type || id) + ' ' + K[0] });
  }
  for (const m of arr(modsData, 'modules')) {
    const id = m.id, st = low(m.state); if (!id) continue;
    next.mods.set(id, st);
    const was = prev && prev.mods.get(id);
    if (prev && was !== undefined && was !== st && MOD_BAD.has(st)) alarms.push({ at: now, kind: 'module', id, g: '■', c: '#ff6b81', m: '모듈 ' + (m.name || id) + ' — ' + st + (m.last_error ? ' · ' + m.last_error : '') });
    else if (prev && MOD_BAD.has(was) && st === 'running') alarms.push({ at: now, kind: 'module', id, g: '●', c: '#4ade80', m: '모듈 ' + (m.name || id) + ' 다시 돈다' });
  }
  return { next, alarms };
}

/**
 * @param {{ terra: { invoke: Function }, onAlarm?: (a: object) => void, intervalMs?: number, keep?: number }} o
 */
export function startAlarms(o) {
  const keep = o.keep ?? 50, list = [];
  let prev = null, timer = 0, stopped = false, busy = false;
  const tick = async () => {
    if (stopped || busy) return; busy = true;
    try {
      const [tk, md] = await Promise.allSettled([o.terra.invoke('terra.daemon.tasks.get', {}), o.terra.invoke('terra.daemon.modules.get', {})]);
      if (tk.status === 'fulfilled' || md.status === 'fulfilled') {
        const r = diff(prev, tk.status === 'fulfilled' ? tk.value : null, md.status === 'fulfilled' ? md.value : null);
        if (prev) { if (tk.status !== 'fulfilled') r.next.tasks = prev.tasks; if (md.status !== 'fulfilled') r.next.mods = prev.mods; }   // 못 받은 쪽은 앞 상태를 그대로 — 다음에 몰아서 알리지 않게
        prev = r.next;
        for (const a of r.alarms) { list.unshift(a); if (o.onAlarm) try { o.onAlarm(a); } catch {} }
        list.splice(keep);
      }
    } finally { busy = false; if (!stopped) timer = setTimeout(tick, o.intervalMs ?? 10000); }
  };
  tick();
  return { list, poke() { clearTimeout(timer); tick(); }, stop() { stopped = true; clearTimeout(timer); } };
}
