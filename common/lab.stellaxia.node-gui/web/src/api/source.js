// 데이터 소스 — 조타륜 앱이 자원 목록을 받고 동작을 보내는 곳.
//   MockSource : 화면의 hbSeed 를 그대로 돌려준다 (실데이터 층에서는 빈 목록)
//   LiveSource : Gateway (TerraClient + operations.js + adapters.js)
// 화면과는 src/api/wire.js 가 잇는다.

import { HELM_APPS } from './operations.js';
import { ADAPT } from './adapters.js';

/**
 * @typedef {Object} HelmSource
 * @property {boolean} mock
 * @property {(node: string, app: string, ctx?: { path?: string }) => Promise<any[]>} list
 * @property {(node: string, app: string, id: string|null, op: string, item?: any, ctx?: { path?: string }) => Promise<import('./client.js').Result & { say?: string, where?: string }>} act
 */

/** @implements {HelmSource} */
export class MockSource {
  constructor(screen) { this.mock = true; this.screen = screen; }
  async list(node, app) { return this.screen.hbSeed(node, app); }
  async act() { return { kind: 'ok', data: null }; }   // 연결 전에는 화면의 hbAct 가 받는다 (실데이터 층: 로그인 안내만)
}

/** 앱 대응표 — 로컬 노드에서 볼 때 local 대응이 있으면 그것으로 바꿔 낀다 */
export function appFor(app, local) {
  const A = HELM_APPS[app];
  if (!A || !local || !A.local) return A || null;
  return Object.assign({}, A, {
    list: A.local.list || A.list,
    extra: A.local.extra || (A.local.list ? [] : A.extra),
    adapt: A.local.adapt || A.adapt,
    acts: Object.assign({}, A.acts, A.local.acts || {})
  });
}

/**
 * op 이름의 by-… 자리를 입력 키로 채운다. 'io.devices.by-device-id.approve.post' → { device_id: id }.
 * by-family · by-name 은 항목의 fam · name 으로. 나머지 키는 싣지 않는다 — 모듈 op 은 모르는 키를 거절하고,
 * Daemon 의 POST 본문 해석기(DisallowUnknownFields)도 그렇다.
 */
export function pathInput(op, id, item) {
  const out = {};
  for (const seg of String(op || '').split('.')) {
    if (!seg.startsWith('by-')) continue;
    const key = seg.slice(3).replace(/-/g, '_');
    if (key === 'family') { if (item && item.fam) out.family = item.fam; }
    else if (key === 'name') { if (item && item.name) out.name = item.name; }
    else if (id != null) out[key] = id;
  }
  return out;
}

/** @implements {HelmSource} */
export class LiveSource {
  /** @param {import('./client.js').TerraClient} client @param {{ localNode: string, localId?: string|null }} opts */
  constructor(client, opts) { this.mock = false; this.client = client; this.localNode = opts.localNode; this.localId = opts.localId || null; }

  // L(Daemon) · M(모듈) op은 이 노드의 것만 부를 수 있다 — 다른 노드로 가는 operation 경로가 없다(client.invoke의 node).
  // T(Master) op만 node_id를 본문에 싣는다(화면 이름이 아니라 진짜 node_id — 로컬 노드면 localId).
  call(spec, node, input) {
    const scoped = spec.where === 'L' || spec.where === 'M';
    const remote = scoped && node !== this.localNode;
    const nodeId = node === this.localNode && this.localId ? this.localId : node;
    const base = spec.where === 'T' ? Object.assign({ node_id: nodeId }, fillNode(spec.input, nodeId)) : fillNode(spec.input, nodeId);
    return this.client.invoke(spec.op, Object.assign(base, input || {}), remote ? { node } : {});
  }

  async list(node, app, ctx = {}) {
    const local = node === this.localNode;
    const A = appFor(app, local); if (!A) return [];
    if (A.guard) {
      const g = await this.call(A.guard, node);
      if (g.kind === 'ok' && A.guard.skip(g.data)) return [];
    }
    const r = await this.call(A.list, node);
    if (r.kind !== 'ok') {
      if (A.list.empty && A.list.empty(r)) return [];   // 꺼진 기능의 거절은 빈 목록이다(WireGuard 422 등)
      throw r;
    }
    const actx = { local };
    for (const ex of A.extra || []) {
      const e = await this.call(ex, node);
      if (e.kind === 'ok') {
        if (/grants/.test(ex.op)) actx.grants = e.data && (e.data.grants || e.data);
        if (/bindings/.test(ex.op)) actx.bindings = e.data && (e.data.bindings || e.data);
        if (/declarations/.test(ex.op)) actx.declarations = e.data && (e.data.declarations || e.data);
      }
    }
    const adapt = ADAPT[A.adapt || app] || ((d) => d);
    const items = adapt(r.data, actx);
    if (app === 'folder') return items.concat(await this.folderLevels(node, ctx.path));
    return items;
  }

  /** 폴더 앱 — 지금 경로까지 각 단계의 항목. 화면은 지금 경로가 목록에 있어야 그 안을 보여 준다 */
  async folderLevels(node, at) {
    const s = String(at || '');
    if (!s) return [];
    const i = s.indexOf('/'), root = i < 0 ? s : s.slice(0, i), rel = i < 0 ? '' : s.slice(i + 1);
    const parts = rel ? rel.split('/') : [];
    const out = [];
    for (let k = 0; k <= parts.length; k++) {
      const path = parts.slice(0, k).join('/');
      const r = await this.call({ op: 'io.terra.file.entries.list', where: 'M' }, node, path ? { root, path } : { root });
      if (r.kind !== 'ok') { if (k === 0) throw r; break; }
      out.push(...ADAPT.folderEntries(root, path, r.data));
    }
    return out;
  }

  async act(node, app, id, op, item, ctx = {}) {
    const A = appFor(app, node === this.localNode);
    const spec = (A && A.acts[op]) || null;
    if (!spec || !spec.op) return { kind: 'ok', data: null };   // 화면에서만 하는 동작 (치우기 등)
    if (spec.none) return { kind: 'unavailable', reason: spec.none };
    const input = spec.in ? spec.in(id, item || {}, ctx) : pathInput(spec.op, id, item);
    const r = await this.call(spec, node, Object.assign({}, spec.body || {}, input));
    if (r.kind === 'ok' && spec.say) r.say = spec.say(r.data, item);
    r.where = spec.where;
    return r;
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
