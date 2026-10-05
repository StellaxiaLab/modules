// 데이터 소스 — 조타륜 앱이 자원 목록을 받고 동작을 보내는 곳.
//   MockSource : 화면의 hbSeed 를 그대로 돌려준다 (실데이터 층에서는 빈 목록)
//   LiveSource : Gateway (TerraClient + operations.js + adapters.js)
// 화면과는 src/api/wire.js 가 잇는다.

import { HELM_APPS, HELM_CRUD, GUI_APPS, scanLine } from './operations.js';
import { ADAPT, withGui } from './adapters.js';
import { resultText } from './client.js';
import { Sha256, sha256Blob, toB64, fromB64 } from './sha256.js';

/**
 * @typedef {Object} HelmSource
 * @property {boolean} mock
 * @property {(node: string, app: string, ctx?: { path?: string|string[] }) => Promise<any[]>} list  폴더 앱은 경로 여럿을 받는다
 * @property {(node: string, app: string, id: string|null, op: string, item?: any, ctx?: { path?: string }) => Promise<import('./client.js').Result & { say?: string, where?: string }>} act
 * @property {(node: string, app: string, mode: 'create'|'update'|'del', vals: any, item: any, ctx?: CrudCtx) => Promise<CrudResult|null>} [crud]
 */

/**
 * @typedef {{ path?: string, nodeIdOf?: (name: string) => string|null }} CrudCtx
 * @typedef {import('./client.js').Result & { say?: string, where?: string, id?: string, screen?: boolean, same?: boolean, keep?: boolean, verb?: string }} CrudResult
 */

/** @implements {HelmSource} */
export class MockSource {
  constructor(screen) { this.mock = true; this.screen = screen; }
  async list(node, app) { return this.screen.hbSeed(node, app); }
  async act() { return { kind: 'ok', data: null }; }   // 연결 전에는 화면의 hbAct 가 받는다 (실데이터 층: 로그인 안내만)
}

/** 앱 대응표 — Daemon 쪽에서 볼 때(이 노드 · 노드 주소 호출로 닿는 다른 노드) local 대응이 있으면 그것으로 바꿔 낀다 */
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

/** 다른 노드에서 볼 때 바꿔 낄 것(spec.remote) — 게이트웨이 op 는 그 노드에 없다. 모듈 로그는 그 노드 Daemon 의 것으로 */
function forNode(spec, local) { return spec && !local && spec.remote ? Object.assign({}, spec, spec.remote) : spec; }

/** @implements {HelmSource} */
export class LiveSource {
  /**
   * @param {import('./client.js').TerraClient} client
   * @param {{ localNode: string, localId?: string|null, idOf?: (name: string) => string|null|undefined }} opts
   *   idOf — 화면의 노드 이름 → Master node_id (관계도 NET[name].id). 다른 노드는 이것으로 노드 주소 호출(B-1)을 한다
   */
  constructor(client, opts) {
    this.mock = false; this.client = client; this.localNode = opts.localNode; this.localId = opts.localId || null;
    this.idOf = opts.idOf || (() => null);
  }

  /** 화면의 노드 이름 → 진짜 node_id (이 노드면 localId). 모르면 이름 그대로(Master 가 거절한다) */
  nodeIdOf(node) { return node === this.localNode ? this.localId || node : this.idOf(node) || node; }

  /** 다른 노드의 Daemon 에 노드 주소 호출(B-1)로 닿나 — 이 게이트웨이에 그 길이 있어야 한다 */
  relays() { return !!(this.client.canRelay && this.client.canRelay()); }

  /** Daemon 쪽 대응(local)을 쓰나 — 이 노드, 또는 노드 주소 호출로 그 Daemon 에 닿는 다른 노드.
   *  앱 토큰은 Master 에 닿지 않는다(구현해야 할 것 PF-1) — 다른 노드의 작업도 그 Daemon 의 작업 목록으로 본다 */
  daemonView(node) { return node === this.localNode || this.relays(); }

  /** 그 노드에서 볼 앱 대응표 */
  appFor(app, node) { return appFor(app, this.daemonView(node)); }

  // L(Daemon) · M(모듈) op — 이 노드면 invoke, 다른 노드면 노드 주소 호출(client.invoke 의 node = node_id). node_id 를 모르면 부르지 않는다.
  // T(Master) 의 읽기 · 지우기(GET · DELETE)는 node_id 를 query 로 싣는다(화면 이름이 아니라 진짜 node_id — 로컬 노드면 localId).
  // 본문이 있는 Master 호출(POST)에는 싣지 않는다 — Master 의 본문 해석기도 모르는 키를 거절한다(decodeJSON DisallowUnknownFields)
  call(spec0, node, input) {
    const local = node === this.localNode, spec = forNode(spec0, local);
    const scoped = spec.where === 'L' || spec.where === 'M';
    if (scoped && !local) {
      const id = this.idOf(node);
      if (!id) return Promise.resolve({ kind: 'unavailable', reason: 'no-node-id' });
      return this.client.invoke(spec.op, Object.assign(fillNode(spec.input, id), input || {}), { node: id });
    }
    const nodeId = this.nodeIdOf(node);
    const query = spec.where === 'T' && /\.(get|delete)$/.test(spec.op || '');
    const base = query ? Object.assign({ node_id: nodeId }, fillNode(spec.input, nodeId)) : fillNode(spec.input, nodeId);
    return this.client.invoke(spec.op, Object.assign(base, input || {}));
  }

  async list(node, app, ctx = {}) {
    const local = node === this.localNode;
    if (!local && this.relays() && this.client.nodeCatalog) void this.client.nodeCatalog(this.idOf(node));   // 누르기 전 자물쇠용으로 미리
    const A = this.appFor(app, node); if (!A) return [];
    if (A.guard) {
      const g = await this.call(A.guard, node);
      if (g.kind === 'ok' && A.guard.skip(g.data)) return [];
    }
    const r = await this.call(A.list, node);
    if (r.kind !== 'ok') {
      if (A.list.empty && A.list.empty(r)) return [];   // 꺼진 기능의 거절은 빈 목록이다(WireGuard 422 등)
      throw r;
    }
    const actx = { local };   // 이 노드의 SVI 자원은 내 것(own) — 다른 노드는 허가를 본다
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
    if (app === 'folder') {
      // 경로 여럿(보고 있는 곳 + 맵에 설치한 칸들의 위 칸) — 겹치는 단계는 한 번만 읽는다. 첫 경로 밖의 실패(지워진 폴더)는 건너뛴다
      const paths = [].concat(ctx.path == null ? [] : ctx.path), seen = new Set(), more = [];
      for (let i = 0; i < paths.length; i++) more.push(...await this.folderLevels(node, paths[i], seen, i > 0));
      return items.concat(more);
    }
    if (app === 'mod' && local) return withGui(items, await this.guiApps());
    return items;
  }

  /** 이 노드에 설치된 GUI 앱(게이트웨이 /api/v1/gui/apps — 공개). 못 읽으면 null — 모듈은 GUI 표시 없이 보인다 */
  async guiApps() {
    if (!this.client.get) return null;
    const r = await this.client.get(GUI_APPS.path);
    return r.kind === 'ok' && r.data && Array.isArray(r.data.apps) ? r.data.apps : null;
  }

  /**
   * 폴더 앱 — 지금 경로까지 각 단계의 항목. 화면은 지금 경로가 목록에 있어야 그 안을 보여 준다
   * @param {Set<string>} [seen]  이미 읽은 단계('공유 폴더/경로') — 여러 경로를 읽을 때 겹치는 단계를 건너뛴다
   * @param {boolean} [lenient]   맨 위 단계가 실패해도 던지지 않는다(설치한 칸이 가리키는 폴더가 지워졌을 때)
   */
  async folderLevels(node, at, seen = new Set(), lenient = false) {
    const s = String(at || '');
    if (!s) return [];
    const i = s.indexOf('/'), root = i < 0 ? s : s.slice(0, i), rel = i < 0 ? '' : s.slice(i + 1);
    const parts = rel ? rel.split('/') : [];
    const out = [];
    for (let k = 0; k <= parts.length; k++) {
      const path = parts.slice(0, k).join('/'), key = root + '/' + path;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = await this.call({ op: 'io.terra.file.entries.list', where: 'M' }, node, path ? { root, path } : { root });
      if (r.kind !== 'ok') { if (k === 0 && !lenient) throw r; break; }
      out.push(...ADAPT.folderEntries(root, path, r.data));
    }
    return out;
  }

  /**
   * 누르기 전에 잠글 이유 — 화면의 hbOpLock 이 카드 · 머리 버튼마다 부른다(🔒 + 이유). 누른 뒤에야 "길이 없다"를 듣지 않게.
   * 화면에서만 하는 동작 · 폼으로 가는 동작 · 부를 수 있는 동작은 null
   */
  lockFor(app, op, node) {
    const local = node === this.localNode, A = this.appFor(app, node), spec = forNode(A && A.acts ? A.acts[op] : null, local);
    if (!spec || !spec.op || spec.form) return null;
    const why = (reason) => resultText({ kind: 'unavailable', reason });
    if (spec.none) return why(spec.none);
    if ((spec.where === 'L' || spec.where === 'M') && !local) {
      if (!this.relays()) return why('remote-node');
      if (this.client.masterBlocked) return why('master-delegation');
      const id = this.idOf(node);
      if (!id) return why('no-node-id');
      const cat = this.client.nodeCatalogNow ? this.client.nodeCatalogNow(id) : null;
      if (!cat) { if (this.client.nodeCatalog) void this.client.nodeCatalog(id); return null; }   // 받는 중 — 누르면 호출이 다시 판정한다
      const e = cat.ok ? cat.ops.get(spec.op) : null;
      if (cat.ok && !e) return why('not-remote');
      if (e && e.allowed === false) return resultText({ kind: 'forbidden', reason: 'remote-denied' });
      return null;
    }
    if (spec.where === 'T' && this.client.masterBlocked) return why('master-delegation');
    const cat = this.client.catalog;
    if (cat && cat.size > 0 && !this.client.has(spec.op)) return why(spec.where === 'T' ? 'master-delegation' : 'not-in-catalog');
    return null;
  }

  /**
   * 파일 올리기 — io.terra.file 전송: transfers.create(push · 크기 · SHA-256) → transfers.chunks.put(조각마다 —
   * 409 면 서버가 받은 offset 부터 이어서) → transfers.complete(모듈이 전체 SHA-256 을 검사한다)
   * @param {string} node @param {Blob & { name: string }} file
   * @param {string} dir 보관함 칸 id('<공유 폴더>/<경로>') — ''이면 share-0 맨 위
   * @param {(offset: number) => void} [onProgress]
   */
  async upload(node, file, dir, onProgress) {
    const M = (op, input) => this.call({ op: 'io.terra.file.' + op, where: 'M' }, node, input);
    const s = String(dir || ''), i = s.indexOf('/'), root = i < 0 ? s : s.slice(0, i), rel = i < 0 ? '' : s.slice(i + 1);
    const cr = await M('transfers.create', Object.assign({ direction: 'push', path: (rel ? rel + '/' : '') + file.name, size_bytes: file.size,
      checksum_sha256: await sha256Blob(file), mode: 'create' }, root ? { root } : {}));
    if (cr.kind !== 'ok' && cr.kind !== 'accepted') return cr;
    const tr = (cr.data && cr.data.transfer) || cr.data || {}, id = tr.transfer_id;
    if (!id) return { kind: 'error', reason: '전송 id를 받지 못했다' };
    const step = Math.min(tr.chunk_size || 262144, 512 * 1024);
    let off = tr.offset || 0, retry = 0;
    while (off < file.size) {
      const bytes = new Uint8Array(await file.slice(off, off + step).arrayBuffer());
      const r = await M('transfers.chunks.put', { transfer_id: id, offset: off, data: toB64(bytes) });
      if (r.kind !== 'ok') {
        if (r.status !== 409 || ++retry > 5) return r;
        const g = await M('transfers.get', { transfer_id: id });   // 어긋남 — 서버가 받은 곳부터
        if (g.kind !== 'ok') return r;
        const t = (g.data && g.data.transfer) || g.data || {};
        off = t.offset || 0;
        continue;
      }
      off = (r.data && r.data.next_offset) || off + bytes.length;
      retry = 0;
      if (onProgress) onProgress(off);
    }
    return M('transfers.complete', { transfer_id: id });
  }

  /**
   * 파일 받기 — io.terra.file 받기(0.2.0): transfers.pulls.create(root · path) → transfers.chunks.get(offset 부터 eof 까지 —
   * 조각마다 SHA-256 을 견준다) → 전체 SHA-256 을 서버의 것과 견주고 transfers.pulls.complete. 어긋나면 pulls.abort 로 닫는다
   * @param {string} node @param {string} id 보관함 칸 id('<공유 폴더>/<경로>')
   * @param {(offset: number, size?: number) => void} [onProgress]
   * @returns {Promise<import('./client.js').Result & { blob?: Blob, name?: string }>}
   */
  async download(node, id, onProgress) {
    const M = (op, input) => this.call({ op: 'io.terra.file.' + op, where: 'M' }, node, input);
    const s = String(id || ''), i = s.indexOf('/'), root = i < 0 ? '' : s.slice(0, i), path = i < 0 ? '' : s.slice(i + 1);
    if (!root || !path) return { kind: 'unavailable', reason: 'share-root' };
    const cr = await M('transfers.pulls.create', { root, path });
    if (cr.kind !== 'ok' && cr.kind !== 'accepted') return cr;
    const tr = (cr.data && cr.data.transfer) || cr.data || {}, tid = tr.transfer_id;
    if (!tid) return { kind: 'error', reason: '전송 id를 받지 못했다' };
    const close = async (r) => { await M('transfers.pulls.abort', { transfer_id: tid }); return r; };
    const H = new Sha256(), parts = [];
    let off = 0;
    for (;;) {
      const r = await M('transfers.chunks.get', { transfer_id: tid, offset: off });
      if (r.kind !== 'ok' || !r.data) return close(r);
      const bytes = fromB64(r.data.data);
      if (r.data.sha256 && new Sha256().update(bytes).hex() !== r.data.sha256) return close({ kind: 'error', reason: 'chunk-checksum' });
      H.update(bytes); parts.push(bytes); off += bytes.length;
      if (onProgress) onProgress(off, tr.size_bytes);
      if (r.data.eof || !bytes.length) break;
    }
    if (tr.checksum_sha256 && H.hex() !== tr.checksum_sha256) return close({ kind: 'error', reason: 'checksum' });
    const done = await M('transfers.pulls.complete', { transfer_id: tid });
    if (done.kind !== 'ok') return done;
    if (done.data && done.data.verified === false) return { kind: 'error', reason: 'checksum', data: done.data };
    return { kind: 'ok', data: done.data, blob: new Blob(parts), name: path.split('/').pop() };
  }

  async act(node, app, id, op, item, ctx = {}) {
    const A = this.appFor(app, node);
    const spec = forNode((A && A.acts[op]) || null, node === this.localNode);
    if (!spec || !spec.op) return { kind: 'ok', data: null };   // 화면에서만 하는 동작 (치우기 등)
    if (spec.none) return { kind: 'unavailable', reason: spec.none };
    if (spec.upload) return { kind: 'unavailable', reason: 'no-upload' };   // 올리기는 파일을 골라야 한다 — wire.js 가 고르게 하고 upload 를 부른다
    if (spec.download) return { kind: 'unavailable', reason: 'no-download' };   // 받기는 저장할 곳이 있어야 한다 — wire.js 가 download 를 부르고 브라우저로 저장한다
    const input = spec.in ? spec.in(id, item || {}, Object.assign({ nodeId: this.nodeIdOf(node) }, ctx)) : pathInput(spec.op, id, item);
    if (input && input.none) return { kind: 'unavailable', reason: input.none };
    const r = await this.call(spec, node, Object.assign({}, spec.body || {}, input));
    if (r.kind === 'ok' && spec.say) r.say = spec.say(r.data, item);
    r.where = spec.where;
    return r;
  }

  /**
   * 추가(create) · 수정(update) · 삭제(del) — operations.js HELM_CRUD. 돌려주는 것:
   *   null                          서버에 길이 없다 — 화면은 항목을 지어내지 않는다(wire.js 가 그렇다고 말한다)
   *   { kind: 'unavailable', reason } 부르지 않았다(값이 맞지 않거나 길이 닫혔다)
   *   { kind: 'ok', screen: true }   서버에 지울 것이 없다 — 화면 목록에서만 걷는다
   *   { kind: 'ok', same: true }     바뀐 것이 없다
   *   그 밖                          마지막 호출의 Result (+ where · 칸 id 가 바뀌면 id · 스캔이면 say)
   * @param {CrudCtx} [ctx]
   * @returns {Promise<CrudResult|null>}
   */
  async crud(node, app, mode, vals, item, ctx = {}) {
    const C = HELM_CRUD[app];
    if (!C) return null;
    const v = vals || {}, it = item || {}, cx = Object.assign({ nodeId: this.nodeIdOf(node) }, ctx);
    let spec = this.daemonView(node) && C.local && C.local[mode] !== undefined ? C.local[mode] : C[mode];
    if (spec && spec.localOnly && node !== this.localNode) spec = C[mode];   // 그 Daemon 이 원격으로 열지 않은 것 — Master 경로로
    if (typeof spec === 'function') spec = spec(v, it, cx);
    if (!spec) return null;
    if (spec.none) return { kind: 'unavailable', reason: spec.none };
    if (spec.screen) return { kind: 'ok', data: null, screen: true, verb: spec.verb };
    const steps = spec.steps ? spec.steps(v, it, cx) : [{ op: spec.op, body: spec.body ? spec.body(v, it, cx) : {} }];
    if (!Array.isArray(steps)) return { kind: 'unavailable', reason: (steps && steps.none) || 'no-operation' };
    if (!steps.length) return { kind: 'ok', data: null, same: true };
    let r = null;
    for (const s of steps) {   // 여러 번이면 차례로 — 하나가 실패하면 거기서 멈춘다(앞의 것은 이미 바뀌었다 — 목록을 다시 받아 보인다)
      r = await this.call({ op: s.op, where: spec.where }, node, s.body);
      if (r.kind !== 'ok' && r.kind !== 'accepted') break;
    }
    r.where = spec.where;
    if (spec.id) r.id = spec.id;
    if (spec.keep) r.keep = true;
    if (spec.verb) r.verb = spec.verb;
    if (spec.scan && r.kind === 'ok') r.say = scanLine(r.data);
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
