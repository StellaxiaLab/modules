// Scene 지도의 '원격 관리 켜짐' 표시 데이터 — 노드마다 remote-management.get(다른 노드에서도 읽힘)을 느리게 돌려 사본으로 든다.
//   get(rid) 은 동기로 지금의 사본을 돌려주고, 없거나 낡았으면 뒤에서 한 번만 받는다(이름표가 프레임마다 부르므로 두드리지 않게).
//   받으면 onChange() 로 화면을 다시 그린다. 못 읽은 노드는 표시하지 않는다 — '꺼짐'이 아니라 '모름'이라 켜짐으로도 꺼짐으로도 그리지 않는다.
//   항목: { state: 'loading' } | { state: 'ok', on, remain, at } | { state: 'err', code, at }
import { remoteMgmtView } from './remote-management.js';

export const TTL_OK = 60000;
export const TTL_ERR = 120000;
const MAX_INFLIGHT = 4;   // 노드가 많아도 한꺼번에 몇 개만 — 중계 호출이다

/** @param {{ read: (rid: string) => Promise<any>, now?: () => number, onChange?: () => void }} o  read : 그 노드의 remote-management.get 답(data) */
export function createRemoteMgmtMap(o) {
  const now = o.now || Date.now, C = new Map(), inflight = new Set(), queue = [];
  const pump = () => {
    while (inflight.size < MAX_INFLIGHT && queue.length) {
      const rid = queue.shift(); if (inflight.has(rid)) continue; inflight.add(rid);
      const done = (ent) => { inflight.delete(rid); C.set(rid, ent); if (o.onChange) try { o.onChange(); } catch {} pump(); };
      Promise.resolve().then(() => o.read(rid)).then(
        (d) => { const v = remoteMgmtView({ data: d }, { remote: true, now: now() }); done(v.known ? { state: 'ok', on: v.on, remain: v.remain, at: now() } : { state: 'err', code: 'BAD_RESPONSE', at: now() }); },
        (e) => done({ state: 'err', code: (e && (e.code || e.status)) || 'ERROR', at: now() }));
    }
  };
  const fetchOne = (rid) => { if (inflight.has(rid) || queue.includes(rid)) return; queue.push(rid); pump(); };
  return {
    /** @returns {{ state: string, on?: boolean, remain?: string, at?: number } | undefined} */
    get(rid) {
      if (!rid) return undefined;
      const c = C.get(rid), t = now();
      if (!c) { C.set(rid, { state: 'loading', at: t }); fetchOne(rid); return C.get(rid); }
      if (c.state !== 'loading' && t - c.at >= (c.state === 'ok' ? TTL_OK : TTL_ERR)) fetchOne(rid);   // 낡은 사본은 새로 받는 동안 그대로 보인다
      return c;
    },
    /** 켜져 있다고 아는 노드만 — 모름 · 꺼짐 · 받는 중은 false */
    on(rid) { const c = this.get(rid); return !!(c && c.state === 'ok' && c.on); },
    clear() { C.clear(); queue.length = 0; },
  };
}
