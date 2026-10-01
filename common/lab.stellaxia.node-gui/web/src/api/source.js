// 데이터 소스 — 조타륜 앱이 자원 목록을 받고 동작을 보내는 곳.
//   MockSource : 프로토타입 예시 데이터 (화면의 hbSeed). 기본값
//   LiveSource : Gateway (TerraClient + operations.js + adapters.js)
// 화면과는 src/api/wire.js 가 잇는다.

import { HELM_APPS } from './operations.js';
import { ADAPT } from './adapters.js';

/**
 * @typedef {Object} HelmSource
 * @property {boolean} mock
 * @property {(node: string, app: string) => Promise<any[]>} list
 * @property {(node: string, app: string, id: string|null, op: string, item?: any) => Promise<import('./client.js').Result>} act
 */

/** @implements {HelmSource} */
export class MockSource {
  constructor(screen) { this.mock = true; this.screen = screen; }
  async list(node, app) { return this.screen.hbSeed(node, app); }
  async act() { return { kind: 'ok', data: null }; }   // 예시 모드에선 화면의 hbAct가 직접 바꾼다
}

/** @implements {HelmSource} */
export class LiveSource {
  /** @param {import('./client.js').TerraClient} client @param {{ localNode: string }} opts */
  constructor(client, opts) { this.mock = false; this.client = client; this.localNode = opts.localNode; }

  // L(Daemon) · M(모듈) op은 이 노드의 것만 부를 수 있다 — 다른 노드로 가는 operation 경로가 없다(client.invoke의 node).
  // T(Master) op은 node_id를 본문에 싣는다.
  call(spec, node, input) {
    const remote = spec.where === 'L' || spec.where === 'M' ? node !== this.localNode : false;
    return this.client.invoke(spec.op, Object.assign({ node_id: node }, fillNode(spec.input, node), input || {}), remote ? { node } : {});
  }

  async list(node, app) {
    const A = HELM_APPS[app]; if (!A) return [];
    const r = await this.call(A.list, node);
    if (r.kind !== 'ok') throw r;
    const ctx = { local: node === this.localNode };
    for (const ex of A.extra || []) {
      const e = await this.call(ex, node);
      if (e.kind === 'ok') {
        if (/grants/.test(ex.op)) ctx.grants = e.data && (e.data.grants || e.data);
        if (/bindings/.test(ex.op)) ctx.bindings = e.data && (e.data.bindings || e.data);
        if (/declarations/.test(ex.op)) ctx.declarations = e.data && (e.data.declarations || e.data);
      }
    }
    return (ADAPT[app] || ((d) => d))(r.data, ctx);
  }

  async act(node, app, id, op, item) {
    const spec = (HELM_APPS[app] && HELM_APPS[app].acts[op]) || null;
    if (!spec || !spec.op) return { kind: 'ok', data: null };   // 화면에서만 하는 동작 (치우기 등)
    const input = id ? { id, device_id: id, resource_id: id, grant_id: id, binding_id: id, tunnel_id: id, declaration_id: id, job_id: id, module_id: id, transfer_id: id, path: id } : {};   // ⚠ op마다 필요한 키만 남길 것
    if (item && item.fam) Object.assign(input, { family: item.fam, name: item.name });
    return this.call(spec, node, input);
  }
}

/**
 * 대응표(operations.js)의 input 에는 '<노드>' 자리 표시자가 있다(node_id · target_node_id).
 * 그대로 실으면 Object.assign 순서 때문에 실제 노드를 덮어 서버가 node_id=<노드>를 받는다 — 그 자리를 노드로 채운다.
 */
export function fillNode(input, node) {
  if (!input) return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) out[k] = v === '<노드>' ? node : v;
  return out;
}
