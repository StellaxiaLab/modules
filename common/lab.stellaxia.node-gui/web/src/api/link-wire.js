// 연결 적용을 화면에 잇는다 (MD-28) — screen.linkApply(연결 id) · screen.linkGrantSelf(연결 id).
// 입출력 설정 화면(UP-25)이 아직 없어 단추는 없다 — 화면이 오면 [연결 적용] · [나에게 허가 주기]가 이 둘을 부른다.
// 적용 규칙은 link-apply.js. 여기서는 화면 상태(links)에 결과를 쓰고 글줄로 알린다.
import { screenLinkCtx } from '../model/link-io.js';
import { applyLink, grantSelf, lacksOf } from './link-apply.js';

const GREEN = '#3ecf8e', AMBER = '#f5b83d', RED = '#ff6b81';

/**
 * @param {any} screen
 * @param {{ client: any, principal?: string }} source
 * @returns {() => void} 걷기
 */
export function wireLinkApply(screen, source) {
  const busy = new Set();
  const say = (r) => {
    const n = r.notes || [], bad = r.unavailable || (r.io && r.io.phase && /^(denied|invalid|failed)$/.test(r.io.phase));
    screen.hbSay(n.slice(0, 2).join(' · ') + (n.length > 2 ? ' 외 ' + (n.length - 2) : '') || '변한 것이 없다', r.unavailable ? RED : bad ? AMBER : r.applied ? GREEN : AMBER);
  };

  /** 연결 하나를 적용한다. 같은 연결을 두 번 동시에 적용하지 않는다(null) */
  screen.linkApply = async (id) => {
    const links = screen.state.links || [], link = links.find((l) => l && l.id === id);
    if (!link || busy.has(id)) return null;
    busy.add(id);
    try {
      const r = await applyLink(source, link, links, screenLinkCtx(screen), { userId: source.principal || '' });
      // 서버에 닿지 않았으면 연결을 바꾸지 않는다. 그 사이 연결이 사라졌으면 쓰지 않는다
      if (!r.unavailable && (screen.state.links || []).some((l) => l.id === id)) {
        screen.setState({ links: (screen.state.links || []).map((l) => (l.id === id ? Object.assign({}, l, { io: r.io }) : l)) });
      }
      say(r);
      return r;
    } finally { busy.delete(id); }
  };

  /**
   * [나에게 허가 주기] — needs-grant 인 쌍의 허가를 만들고 다시 적용한다. 사람이 확인한 뒤에만 부른다(Q-22).
   * @returns {Promise<{ grant: any, apply: any }|null>}
   */
  screen.linkGrantSelf = async (id) => {
    const link = (screen.state.links || []).find((l) => l && l.id === id);
    if (!link || !link.io) return null;
    const lacks = link.io.pairs.filter((p) => p.phase === 'needs-grant').flatMap(lacksOf);
    if (!lacks.length) return null;
    const grant = await grantSelf(source.client, lacks, source.principal || '', 0);
    screen.hbSay(grant.ok ? '허가를 만들었다 — ' + grant.made.join(', ') : '허가를 만들지 못했다 — ' + grant.failed.map((f) => f.resource_id + ' ' + f.operation + ' · ' + f.code).join(', '), grant.ok ? GREEN : RED);
    const apply = grant.ok ? await screen.linkApply(id) : null;
    return { grant, apply };
  };

  return () => { delete screen.linkApply; delete screen.linkGrantSelf; };
}
