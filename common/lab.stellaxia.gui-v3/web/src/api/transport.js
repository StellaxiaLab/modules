// 노드 데이터 층(캔버스 보드 TerraNodes)의 실제 전송 — Gateway 로.
//
// 보드(design/TerraNodes.dc.html)는 사본 · 분할 정책(PA/EL)을 들고, 전송은 "그 노드에서 그 operation 을 불러 달라"만 한다:
//   로컬 노드(이 GUI 를 띄운 노드)   POST /api/v1/operations/{op}/invoke
//   다른 노드                         POST /api/v1/nodes/{node}/operations/{op}/invoke   (Master 중계 · 직계 자식만)
//   Master 가 마지막으로 관측한 값    terra.master.nodes.by-node-id(.modules).get        (끊겼을 때 사본이 없으면)
//   Master 에 쓰는 것(모듈 배정 …)    terra.master.* 는 노드로 중계하지 않고 로컬 Gateway 로 — 입력에 그 노드의 Master id(node_id)를 싣는다
//   바탕 구성(아이콘 · 배경 · 독 · 모양)  invokeRid — 노드 id(rid)로 그 노드의 gui-v3 에 저장(node-desk.*). 창 배치 · 터미널 기록은 이 브라우저(terra.pc.*)에만 — 계정 문서로는 보내지 않는다
// 실패는 TerraError(code) 로 — 보드가 code 로 분할(NODE_OFFLINE · RELAY_NOT_CONNECTED · NETWORK · TIMEOUT · GATEWAY_UNREACHABLE)인지 가른다.
//
// 장면의 노드 id 는 시안의 것이다(지도 · 항성계를 그리는 자리). 그래서 묶는다: 장면의 로컬 노드 = 이 Gateway 의 노드,
// 나머지는 Master 노드 목록에서 이름(display_name · device_name)이 같은 노드로. 못 찾으면 NODE_UNMAPPED — 보드는 "Terra 에 없는 노드"로 읽기 전용.

import { TerraError } from './terra.js';

/**
 * @param {{ terra: ReturnType<import('./terra.js').createTerra>, authed?: () => boolean, localRid?: () => string }} o
 *   localRid — invokeRid 의 로컬 판정: 이 GUI 를 낸 노드의 node_id(지도 localId). 비면(Tree Gateway) 노드 길
 *   authed — 로그인 전이면 false: 아무 데도 부르지 않고 UNAUTHENTICATED 로 답한다(로그인 화면 뒤에서 노드를 두드리지 않게)
 */
export function createGatewayTransport(o) {
  const T = o.terra;
  const meta = {}, real = new Map();
  let sceneLocal = '', nodesP = null, localRid = null;
  const nodes = () => nodesP || (nodesP = T.invoke('terra.master.nodes.get', {}).then((d) => (Array.isArray(d) ? d : (d && d.nodes) || []), (e) => { nodesP = null; throw e; }));

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

    /** 장면 노드 → Master 의 노드 id. 로컬이면 지도가 든 id, 없으면 로컬 Daemon status 의 node_id(등록 전이면 빈 칸) */
    async masterId(n) {
      if (n !== sceneLocal) return tp.realId(n);
      if (meta[n] && meta[n].rid) return meta[n].rid;
      if (!localRid) localRid = T.invoke('terra.daemon.status.get', {}).then((d) => (d && ((d.enrollment && d.enrollment.node_id) || (d.daemon && d.daemon.node_id))) || '', (e) => { localRid = null; throw e; });
      const id = await localRid; if (!id) throw new TerraError('NODE_NOT_ENROLLED', 'Tree 미등록 노드', 409);
      return id;
    },

    async invoke(n, op, input) {
      if (o.authed && !o.authed()) throw new TerraError('UNAUTHENTICATED', '로그인 전', 401);
      if (op.startsWith('gui-v3.')) throw new TerraError('OP_UNSUPPORTED', op + ' — 노드 operation 없음 (화면 초안 · 성공 아님)', 501);   // 모르는 gui-v3.* 쓰기는 가짜 성공 대신 거절
      if (op.startsWith('terra.master.')) { const inp = Object.assign({}, input); if (!inp.node_id && /\.by-node-id\./.test(op)) inp.node_id = await tp.masterId(n); return T.invoke(op, inp); }   // Master 는 로컬 Gateway 가 잇는다
      const id = await tp.realId(n);
      return T.invoke(op, input || {}, id ? { node: id } : {});
    },

    /**
     * 노드 id(rid = Terra node_id)로 직접 — 장면 id 를 거치지 않는다(바탕 구성 · 설계 §9.1).
     * 로컬 판정은 localRid(): 이 GUI 를 낸 노드면 로컬 길(그 Gateway 의 인스턴스), 아니면 노드 주소 호출.
     * Tree Gateway 는 localId 가 비어(자기 Daemon status 가 없다) 노드 길로 가는 것이 맞다.
     * @param {string} rid @param {string} op @param {object} [input] @param {{ signal?: AbortSignal }} [opts]
     */
    async invokeRid(rid, op, input, opts = {}) {
      if (o.authed && !o.authed()) throw new TerraError('UNAUTHENTICATED', '로그인 전', 401);
      if (!rid) throw new TerraError('NO_NODE', '노드 id 가 없음 — 부르지 않음', 0);
      const here = (o.localRid && o.localRid()) || '', signal = opts.signal || undefined;
      return T.invoke(op, input || {}, here && rid === here ? { signal } : { node: rid, signal });
    },

    async master(n, op) { if (o.authed && !o.authed()) throw new TerraError('UNAUTHENTICATED', '로그인 전', 401);
      const id = await tp.realId(n); return T.invoke(op, { node_id: id }); },
  };
  return tp;
}
