// 노드 데이터 층(캔버스 보드 TerraNodes)의 실제 전송 — Gateway 로.
//
// 보드(design/TerraNodes.dc.html)는 사본 · 분할 정책(PA/EL)을 들고, 전송은 "그 노드에서 그 operation 을 불러 달라"만 한다:
//   로컬 노드(이 GUI 를 띄운 노드)   POST /api/v1/operations/{op}/invoke
//   다른 노드                         POST /api/v1/nodes/{node}/operations/{op}/invoke   (Master 중계 · 직계 자식만)
//   Master 가 마지막으로 관측한 값    terra.master.nodes.by-node-id(.modules).get        (끊겼을 때 사본이 없으면)
//   GUI 보기 상태(제어기 창 배치 …)   /api/v1/me/documents/gui-v3/view/<키>            (계정에 — 다른 브라우저에서도 같은 배치)
// 실패는 TerraError(code) 로 — 보드가 code 로 분할(NODE_OFFLINE · RELAY_NOT_CONNECTED · NETWORK · TIMEOUT · GATEWAY_UNREACHABLE)인지 가른다.
//
// 장면의 노드 id 는 시안의 것이다(지도 · 항성계를 그리는 자리). 그래서 묶는다: 장면의 로컬 노드 = 이 Gateway 의 노드,
// 나머지는 Master 노드 목록에서 이름(display_name · device_name)이 같은 노드로. 못 찾으면 NODE_UNMAPPED — 보드는 "Terra 에 없는 노드"로 읽기 전용.

import { TerraError } from './terra.js';

export const VIEW_NS = 'gui-v3';

/**
 * @param {{ terra: ReturnType<import('./terra.js').createTerra>, authed?: () => boolean, storage?: Storage, saveMs?: number }} o
 *   authed — 로그인 전이면 false: 아무 데도 부르지 않고 UNAUTHENTICATED 로 답한다(로그인 화면 뒤에서 노드를 두드리지 않게)
 */
export function createGatewayTransport(o) {
  const T = o.terra, LS = o.storage || globalThis.localStorage, saveMs = o.saveMs ?? 800;
  const meta = {}, real = new Map(), views = new Map(), saveT = new Map();
  let sceneLocal = '', nodesP = null;
  const nodes = () => nodesP || (nodesP = T.invoke('terra.master.nodes.get', {}).then((d) => (Array.isArray(d) ? d : (d && d.nodes) || []), (e) => { nodesP = null; throw e; }));
  const lsGet = (k) => { try { return JSON.parse(LS.getItem('terra.view.' + k) || 'null'); } catch { return null; } };
  const lsSet = (k, v) => { try { LS.setItem('terra.view.' + k, JSON.stringify(v)); } catch {} };
  const docPath = (k) => '/api/v1/me/documents/' + VIEW_NS + '/view/' + k.split('/').map(encodeURIComponent).join('/');

  const tp = {
    kind: 'gateway', meta,
    localId: () => sceneLocal,
    bindScene(localId, metas) { sceneLocal = localId; for (const m of metas) meta[m.id] = m; },

    /** 장면 노드 → Terra 노드 id. 로컬이면 null(로컬 길) */
    async realId(n) {
      if (n === sceneLocal) return null;
      if (meta[n] && meta[n].rid) return meta[n].rid;   // 실제 지도(TerraTopology)면 장면 노드가 Terra id 를 들고 있다
      if (real.has(n)) { const id = real.get(n); if (!id) throw new TerraError('NODE_UNMAPPED', (meta[n] && meta[n].name || n) + ' — Terra 노드 목록에 없음', 404); return id; }
      const list = await nodes(), m = meta[n] || {}, nm = m.name || n;
      const hit = list.find((x) => x.node_id === n || x.id === n || x.display_name === nm || x.device_name === nm || x.name === nm);
      const id = hit ? hit.node_id || hit.id : null; real.set(n, id);
      if (!id) throw new TerraError('NODE_UNMAPPED', nm + ' — Terra 노드 목록에 없음', 404);
      return id;
    },

    async invoke(n, op, input) {
      if (o.authed && !o.authed()) throw new TerraError('UNAUTHENTICATED', '로그인 전', 401);
      if (op.startsWith('gui-v3.')) return { ok: true, local: true };   // 화면 안 초안(보낼 operation 이 아직 없는 편집) — 노드로 보내지 않는다
      const id = await tp.realId(n);
      return T.invoke(op, input || {}, id ? { node: id } : {});
    },

    async master(n, op) { if (o.authed && !o.authed()) throw new TerraError('UNAUTHENTICATED', '로그인 전', 401);
      const id = await tp.realId(n); return T.invoke(op, { node_id: id }); },

    // 보기 상태 — 보드는 동기로 읽는다: 미리 받아 둔 것(ready) · 없으면 이 브라우저 사본
    loadView(key) { return views.has(key) ? views.get(key) : lsGet(key); },
    saveView(key, v) {
      views.set(key, v); lsSet(key, v);
      clearTimeout(saveT.get(key));
      saveT.set(key, setTimeout(() => { T.http('PUT', docPath(key), { value: v, force: true }).catch(() => {}); }, saveMs));   // 계정 문서 — 실패해도 이 브라우저 사본은 남는다
    },
    /** 계정에 둔 보기 상태를 미리 받는다(로그인 뒤 한 번) */
    async ready() {
      try {
        const d = await T.http('GET', '/api/v1/me/documents/' + VIEW_NS);
        const items = (d && (d.documents || d.items)) || (Array.isArray(d) ? d : []);
        await Promise.all(items.filter((x) => String(x.key || '').startsWith('view/')).map(async (x) => {
          const k = x.key.slice(5), v = 'value' in x ? x.value : (await T.http('GET', docPath(k))).value;
          if (v != null) { views.set(k, v); lsSet(k, v); }
        }));
        return true;
      } catch { return false; }
    },
  };
  return tp;
}
