// 연결 적용 · 상태 맞추기 · 끊기를 화면에 잇는다 (MD-28 · MD-29 · MD-30).
//   screen.linkApply(연결 id) · screen.linkGrantSelf(연결 id) — 입출력 설정 화면(UP-25)이 오면 [연결 적용] · [나에게 허가 주기]가 부른다
//   screen.linkSync()  — 서버의 바인딩 · 허가를 읽어 연결 상태(io.phase)를 맞춘다. 신호(terra.svi.*.changed) · 이 맵을 열 때 · 바닥 폴링에 돈다
//   끊기 — 연결이 사라지면(끊기 · 칸 철거 · 경로 철거 · 자원 철거 · 필드 삭제) 더 이상 쓰는 연결이 없는 바인딩을 닫는다. 닫기를 못 하면 state.linkOrphans 에 남겨 다시 한다
// 적용 규칙은 link-apply.js · 상태 맞추기는 link-sync.js. 여기서는 화면 상태(links)에 결과를 쓰고 글줄로 알린다.
import { screenLinkCtx } from '../model/link-io.js';
import { reasonLine } from '../model/link-text.js';
import { applyLink, grantSelf, lacksOf, GRANT_SELF_TTL_DEFAULT } from './link-apply.js';
import { syncLinks, closeBindings, orphanedBindings, reviveOrphans } from './link-sync.js';

const GREEN = '#3ecf8e', AMBER = '#f5b83d', RED = '#ff6b81';

/**
 * @param {any} screen
 * @param {{ client: any, principal?: string }} source
 * @param {{ intervalMs?: number, firstMs?: number, setTimer?: typeof setInterval, clearTimer?: typeof clearInterval, now?: () => number }} [opts]
 * @returns {() => void} 걷기
 */
export function wireLinkApply(screen, source, opts = {}) {
  const busy = new Set(), client = source.client;
  const setT = opts.setTimer || globalThis.setInterval, clearT = opts.clearTimer || globalThis.clearInterval, now = opts.now || Date.now;
  let syncing = false, timer = null, first = null, debounce = null, alive = true;
  const say = (r) => {
    const n = r.notes || [], bad = r.unavailable || (r.io && r.io.phase && /^(denied|invalid|failed)$/.test(r.io.phase));
    screen.hbSay(n.slice(0, 2).join(' · ') + (n.length > 2 ? ' 외 ' + (n.length - 2) : '') || '변한 것이 없다', r.unavailable ? RED : bad ? AMBER : r.applied ? GREEN : AMBER);
  };
  const writeIO = (id, io) => {
    const cur = screen.state.links || [];
    if (cur.some((l) => l && l.id === id)) screen.setState({ links: cur.map((l) => (l && l.id === id ? Object.assign({}, l, { io }) : l)) });
  };

  /** 연결 하나를 적용한다. 같은 연결을 두 번 동시에 적용하지 않는다(null) */
  screen.linkApply = async (id) => {
    const links = screen.state.links || [], link = links.find((l) => l && l.id === id);
    if (!link || busy.has(id)) return null;
    busy.add(id);
    try {
      const r = await applyLink(source, link, links, screenLinkCtx(screen), { userId: source.principal || '', now });
      if (!r.unavailable) writeIO(id, r.io);   // 서버에 닿지 않았으면 연결을 바꾸지 않는다. 그 사이 연결이 사라졌으면 쓰지 않는다
      say(r);
      return r;
    } finally { busy.delete(id); }
  };

  /** [나에게 허가 주기] — needs-grant 인 쌍의 허가를 만들고 다시 적용한다. 사람이 확인한 뒤에만 부른다(Q-22).
   *  opts.ttlSeconds — 설정 창에서 고른 기한(0 = 기한 없음). 없으면 30일(Q-23) */
  screen.linkGrantSelf = async (id, opts = {}) => {
    const link = (screen.state.links || []).find((l) => l && l.id === id);
    if (!link || !link.io) return null;
    const lacks = link.io.pairs.filter((p) => p.phase === 'needs-grant').flatMap(lacksOf);
    if (!lacks.length) return null;
    const ttl = Number.isFinite(opts.ttlSeconds) && opts.ttlSeconds >= 0 ? Math.floor(opts.ttlSeconds) : GRANT_SELF_TTL_DEFAULT;
    const grant = await grantSelf(client, lacks, source.principal || '', ttl);
    screen.hbSay(grant.ok ? '허가를 만들었다 — ' + grant.made.join(', ') : '허가를 만들지 못했다 — ' + grant.failed.map((f) => f.resource_id + ' ' + f.operation + ' · ' + f.code).join(', '), grant.ok ? GREEN : RED);
    const apply = grant.ok ? await screen.linkApply(id) : null;
    return { grant, apply };
  };

  // ── 끊기 (MD-30) ──
  const saveOrphans = (list) => { if (JSON.stringify(list) !== JSON.stringify(screen.state.linkOrphans || [])) screen.setState({ linkOrphans: list }); };
  /** 닫아야 할 바인딩을 닫는다. 못 닫은 것은 orphans 에 남긴다(다음 맞추기에서 다시) */
  const closeAndTrack = async (ids) => {
    if (!ids.length) return;
    const r = await closeBindings(client, ids), at = new Date(now()).toISOString();
    const keep = reviveOrphans(screen.state.linkOrphans).filter((o) => r.closed.indexOf(o.binding_id) < 0 && !r.failed.some((f) => f.binding_id === o.binding_id));
    saveOrphans(keep.concat(r.failed.map((f) => ({ binding_id: f.binding_id, code: f.code, at }))));
    if (r.closed.length) screen.hbSay('바인딩 ' + r.closed.length + '개를 닫았다', GREEN);
    if (r.failed.length) screen.hbSay('바인딩 ' + r.failed.length + '개를 닫지 못했다 — 서버에는 남아 있다 · 다음에 다시 시도한다 (' + r.failed[0].code + ')', AMBER);
  };
  // 연결이 사라지는 setState 를 본다. 맵 · 세계가 통째로 바뀌는 것(맵 이동 · 로그아웃 · 다른 기기의 배치)은 map · maps 가 같이 오니 건드리지 않는다
  const origSet = screen.setState;
  const wrapped = function (patch) {
    const before = this.state && this.state.links, r = origSet.call(this, patch);
    const after = this.state && this.state.links;
    if (alive && after !== before && Array.isArray(before) && patch && typeof patch === 'object' && !('map' in patch) && !('maps' in patch)) {
      const removed = before.filter((l) => l && !(after || []).some((a) => a && a.id === l.id));
      if (removed.length) {
        const others = Object.keys(this.state.maps || {}).filter((k) => k !== this.state.map).map((k) => (this.state.maps[k] || {}).links);
        const ids = orphanedBindings(removed, [after || []].concat(others));
        if (ids.length) void closeAndTrack(ids);
      }
    }
    return r;
  };
  screen.setState = wrapped;

  // ── 상태 맞추기 (MD-29) ──
  /** 서버의 바인딩 · 허가를 읽어 연결 상태를 맞춘다. 동시에 둘 돌지 않는다. 닿지 않으면 바꾸지 않는다 */
  screen.linkSync = async () => {
    if (syncing || !alive) return null;
    syncing = true;
    try {
      const orphans = reviveOrphans(screen.state.linkOrphans);
      if (orphans.length) await closeAndTrack(orphans.map((o) => o.binding_id));
      const r = await syncLinks(client, screen.state.links || [], { now });
      if (r.changed) {
        // 읽는 사이 바뀐 연결은 건드리지 않는다 — 읽기 전 목록의 같은 객체만 새 io 로
        const was = new Map((screen.state.links || []).map((l) => [l && l.id, l]));
        const cur = screen.state.links || [];
        const done = new Map(r.links.filter((l) => l && was.get(l.id) !== l).map((l) => [l.id, l]));
        if (done.size) screen.setState({ links: cur.map((l) => (l && done.has(l.id) ? Object.assign({}, l, { io: done.get(l.id).io }) : l)) });
        const bad = r.links.find((l) => l && l.io && /^(denied|failed|closed|lost)$/.test(l.io.phase) && l.io.reason);
        if (bad) screen.hbSay(reasonLine(bad.io.reason), AMBER);
      }
      return r;
    } finally { syncing = false; }
  };
  const later = (ms) => { clearTimeout(debounce); debounce = setTimeout(() => { void screen.linkSync(); }, ms); if (debounce && typeof debounce === 'object' && debounce.unref) debounce.unref(); };
  // 신호가 오면 — events.js 가 grant · svi 목록을 다시 받게 하는 그 길(screen._hbRefresh)에 얹는다
  const prev = screen._hbRefresh;
  if (prev) screen._hbRefresh = (apps, node) => { prev(apps, node); if (apps.indexOf('grant') >= 0 || apps.indexOf('svi') >= 0) later(300); };
  // 이 맵을 열 때(처음 · 맵 이동 뒤) + 바닥 폴링
  let lastMap = null;
  const tick = () => { const m = screen.state.map; if (m !== lastMap) { lastMap = m; } void screen.linkSync(); };
  first = setTimeout(tick, opts.firstMs === undefined ? 1500 : opts.firstMs);
  timer = setT(tick, opts.intervalMs || 30000);
  [first, timer].forEach((t) => { if (t && typeof t === 'object' && t.unref) t.unref(); });   // node(시험)에서 열린 타이머가 프로세스를 붙잡지 않게

  return () => {
    alive = false;
    clearTimeout(first); clearTimeout(debounce); if (timer) clearT(timer);
    if (screen._hbRefresh && prev) screen._hbRefresh = prev;
    if (screen.setState === wrapped) screen.setState = origSet;   // 이미 다른 층이 걷었으면(저장 연결을 끊을 때) 되살리지 않는다
    delete screen.linkApply; delete screen.linkGrantSelf; delete screen.linkSync;
  };
}
