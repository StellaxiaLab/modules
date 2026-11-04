// 알림 — 이 노드 Daemon 의 작업(terra.daemon.tasks.get)과 모듈(terra.daemon.modules.get) 상태가 바뀐 것을 알림 한 줄로.
//
// node-gui(data/alarms.js)와 같은 길: 작업 목록을 주기적으로 읽어 바뀐 것만 낸다. 처음 읽은 것은 알리지 않는다(이미 있던 것).
// 밀어 받기(push.js)가 이벤트를 받으면 poke() 로 바로 다시 읽는다. 알림 한 줄 = { at, kind, id, g, c, m, sev, st, name, key, read }.
//   sev  'ok' 완료 · 다시 돎 | 'warn' 취소 | 'bad' 실패 · 시간 초과 · 모듈 실패 — 거르기('실패만')와 색
//   name 대상 이름(작업 type · 모듈 이름) · key 알림마다 하나(읽음 · 지우기에 쓴다) · read 읽었나
// 알림 책(createAlarmBook) — 최근 keep 개를 들고 읽음 · 지우기를 한다. 목록 배열은 같은 것을 그대로 고쳐 쓴다(window.TerraAlarms 가 같은 배열을 쥔다).
//   바뀌면 onChange — main.js 가 'terra-alarms' 신호를 내 알림 창 · 전역 틀 배지가 다시 그린다. 읽음은 이 브라우저 메모리에만(새로 띄우면 알림도 처음부터)

const TASK = {
  succeeded: ['완료', '●', '#4ade80', 'ok'], success: ['완료', '●', '#4ade80', 'ok'], completed: ['완료', '●', '#4ade80', 'ok'],
  failed: ['실패', '■', '#ff6b81', 'bad'], dead_letter: ['실패', '■', '#ff6b81', 'bad'], timed_out: ['시간 초과', '■', '#ff6b81', 'bad'], timeout: ['시간 초과', '■', '#ff6b81', 'bad'],
  canceled: ['취소됨', '◐', '#fbbf24', 'warn'], cancelled: ['취소됨', '◐', '#fbbf24', 'warn']
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
    if (prev && was !== st && K) alarms.push({ at: now, kind: 'task', id, g: K[1], c: K[2], m: '작업 ' + (t.type || t.Type || id) + ' ' + K[0], sev: K[3], st, name: t.type || t.Type || id });
  }
  for (const m of arr(modsData, 'modules')) {
    const id = m.id, st = low(m.state); if (!id) continue;
    next.mods.set(id, st);
    const was = prev && prev.mods.get(id);
    if (prev && was !== undefined && was !== st && MOD_BAD.has(st)) alarms.push({ at: now, kind: 'module', id, g: '■', c: '#ff6b81', m: '모듈 ' + (m.name || id) + ' — ' + st + (m.last_error ? ' · ' + m.last_error : ''), sev: 'bad', st, name: m.name || id });
    else if (prev && MOD_BAD.has(was) && st === 'running') alarms.push({ at: now, kind: 'module', id, g: '●', c: '#4ade80', m: '모듈 ' + (m.name || id) + ' — 재가동', sev: 'ok', st, name: m.name || id });
  }
  return { next, alarms };
}

// ───── 읽음 · 지우기 · 거르기 — 순수 함수(배열을 새로 돌려준다). 알림 창 보드에 같은 사본이 있다(tests/alarms-board.test.mjs 가 맞춰 본다) ─────
/** 거르기 — [키, 이름] */
export const ALARM_FILTERS = [['all', '전체'], ['task', '작업'], ['module', '모듈'], ['bad', '실패만'], ['unread', '안 읽음']];
/** 알림마다 하나인 열쇠 — 대상 · 시각 · 상태 (같은 시각 같은 대상의 두 상태도 갈린다) */
export function alarmKey(a) { return a.key || [a.kind, a.id, a.at, a.st || a.m].join('|'); }
/** 거른 목록 */
export function filterAlarms(list, f) {
  const L = list || [];
  if (f === 'task' || f === 'module') return L.filter((a) => a.kind === f);
  if (f === 'bad') return L.filter((a) => a.sev === 'bad');
  if (f === 'unread') return L.filter((a) => !a.read);
  return L.slice();
}
/** 거르기마다의 수 · 안 읽은 수 */
export function countAlarms(list) {
  const o = {}; for (const [k] of ALARM_FILTERS) o[k] = filterAlarms(list, k).length; return o;
}
/** 읽음 — key 하나, '*' 면 모두(거른 것만 읽으려면 keys 배열) */
export function markRead(list, key) {
  const K = Array.isArray(key) ? new Set(key) : null;
  return (list || []).map((a) => (key === '*' || (K ? K.has(alarmKey(a)) : alarmKey(a) === key) ? (a.read ? a : Object.assign({}, a, { read: true })) : a));
}
/** 지우기 — key 하나, '*' 면 모두, 배열이면 그것들 */
export function clearAlarms(list, key) {
  if (key === '*') return [];
  const K = Array.isArray(key) ? new Set(key) : new Set([key]);
  return (list || []).filter((a) => !K.has(alarmKey(a)));
}
/** 새 알림을 앞에 — 열쇠를 달고 읽지 않음으로, keep 개까지 */
export function addAlarms(list, fresh, keep = 50) {
  const add = (fresh || []).map((a) => Object.assign({ read: false }, a, { key: alarmKey(a) })).reverse();
  return add.concat(list || []).slice(0, keep);
}

/**
 * 알림 책 — 목록(같은 배열을 고쳐 쓴다) + 읽음 · 지우기. 바뀌면 onChange.
 * @param {{ keep?: number, onChange?: () => void }} [o]
 */
export function createAlarmBook(o = {}) {
  const keep = o.keep ?? 50, list = [], subs = new Set();
  const put = (next) => { list.splice(0, list.length, ...next); for (const f of subs) try { f(); } catch {} if (o.onChange) try { o.onChange(); } catch {} };
  return {
    list,
    add(fresh) { if (fresh && fresh.length) put(addAlarms(list, fresh, keep)); },
    read(key) { put(markRead(list, key)); },
    clear(key) { put(clearAlarms(list, key)); },
    unread() { return list.filter((a) => !a.read).length; },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

/**
 * @param {{ terra: { invoke: Function }, onAlarm?: (a: object) => void, onChange?: () => void, intervalMs?: number, keep?: number }} o
 */
export function startAlarms(o) {
  const book = createAlarmBook({ keep: o.keep ?? 50, onChange: o.onChange }), list = book.list;
  let prev = null, timer = 0, stopped = false, busy = false;
  const tick = async () => {
    if (stopped || busy) return; busy = true;
    try {
      const [tk, md] = await Promise.allSettled([o.terra.invoke('terra.daemon.tasks.get', {}), o.terra.invoke('terra.daemon.modules.get', {})]);
      if (tk.status === 'fulfilled' || md.status === 'fulfilled') {
        const r = diff(prev, tk.status === 'fulfilled' ? tk.value : null, md.status === 'fulfilled' ? md.value : null);
        if (prev) { if (tk.status !== 'fulfilled') r.next.tasks = prev.tasks; if (md.status !== 'fulfilled') r.next.mods = prev.mods; }   // 못 받은 쪽은 앞 상태를 그대로 — 다음에 몰아서 알리지 않게
        prev = r.next;
        book.add(r.alarms);
        for (const a of r.alarms) if (o.onAlarm) try { o.onAlarm(a); } catch {}
      }
    } finally { busy = false; if (!stopped) timer = setTimeout(tick, o.intervalMs ?? 10000); }
  };
  tick();
  return { list, book, poke() { clearTimeout(timer); tick(); }, stop() { stopped = true; clearTimeout(timer); } };
}
