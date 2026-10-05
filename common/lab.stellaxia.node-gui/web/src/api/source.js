// 데이터 소스 — 조타륜 앱이 자원 목록을 받고 동작을 보내는 곳.
//   MockSource : 화면의 hbSeed 를 그대로 돌려준다 (실데이터 층에서는 빈 목록)
//   LiveSource : Gateway (TerraClient + operations.js + adapters.js)
// 화면과는 src/api/wire.js 가 잇는다.

import { HELM_APPS, HELM_CRUD, GUI_APPS, scanLine, fileBinding, cfgForm } from './operations.js';
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

/** io.terra.file 이 root 를 비웠을 때 쓰는 공유 폴더(api.go defaultRootName) — 전송 기록의 root 는 이 이름으로 남는다 */
const DEFAULT_ROOT = 'share-0';
/** 이만큼 서버 기록이 움직이지 않았고 이 화면이 보내지도 받지도 않으면 멈춘 전송이다 — 서버 시각(updated_at)으로 */
export const STALL_MS = 60000;
/** 이 화면이 목록을 받으며 이만큼 지켜봤는데 offset 이 그대로면 멈춘 전송이다 — 이 브라우저 시계로(시계가 어긋나도 된다) */
export const SEEN_MS = 15000;
/** 전송 만들기 · 읽기의 답 → 전송 기록 */
const trOf = (r) => (r && r.data && r.data.transfer) || (r && r.data) || {};
/** 멈춘 올리기를 다시 연다 — 같은 전송(resume_id). 받은 곳(offset)과 부분 파일은 서버에 남아 있다 */
const resumeBody = (t) => ({ direction: 'push', root: t.root, path: t.path, size_bytes: t.bytes, checksum_sha256: t.sha, mode: t.mode || 'create', resume_id: t.id });

/**
 * 전송 목록의 멈춘 전송 — 서버 상태는 아직 prepared · transferring 인데 보내거나 받는 쪽이 없다(그 화면을 닫았다).
 * 이 화면이 하는 중이 아니고, 기한(expires_at)이 지났거나 · STALL_MS 넘게 기록이 움직이지 않았거나 · 이 화면이 SEEN_MS 넘게
 * 지켜봤는데 offset 이 그대로면 화면의 '어긋남'(failed) 칸에 둔다 — 디자인이 그 칸에 이어서 · 중단을 붙인다.
 * 중단(부분 남김)한 전송은 그대로 '중단됨'이다 — 같은 파일을 다시 올리면 잇는다
 * @param {any[]} items  adapters.js xfer 항목 @param {Set<string>} [active] 이 화면이 보내거나 받는 전송 id
 * @param {Map<string, { off: number, t: number }>} [seen]  이 화면이 본 offset 과 처음 본 때 — 목록을 받을 때마다 고친다
 */
export function markStalled(items, active, now = Date.now(), seen = null) {
  if (seen) { const ids = new Set(items.map((d) => d.id)); [...seen.keys()].forEach((k) => { if (!ids.has(k)) seen.delete(k); }); }
  return items.map((d) => {
    if (d.state !== 'transferring' || (active && active.has(d.id))) { if (seen) seen.delete(d.id); return d; }
    let still = false;
    if (seen) {
      const o = seen.get(d.id);
      if (o && o.off === d.off) still = now - o.t >= SEEN_MS; else seen.set(d.id, { off: d.off, t: now });
    }
    if (!(still || (d.exp && d.exp < now) || (d.at && d.at < now - STALL_MS))) return d;
    return Object.assign({}, d, { state: 'failed', stalled: true, reason: d.dir === 'pull'
      ? '멈췄다 · 받던 화면이 닫혔다 — 이어서: 이 브라우저에 받아 둔 만큼은 건너뛴다'
      : '멈췄다 · ' + Math.floor((d.off || 0) * 100) + '%에서 보내던 화면이 닫혔다 — 이어서: 같은 파일을 고르면 거기서부터' });
  });
}

/** @implements {HelmSource} */
export class LiveSource {
  /**
   * @param {import('./client.js').TerraClient} client
   * @param {{ localNode: string, localId?: string|null, idOf?: (name: string) => string|null|undefined, parts?: import('../store/parts.js').PartStore|null }} opts
   *   idOf — 화면의 노드 이름 → Master node_id (관계도 NET[name].id). 다른 노드는 이것으로 노드 주소 호출(B-1)을 한다
   *   parts — 받기 조각 보관(src/store/parts.js). 없으면 받기는 메모리로만 한다 — 페이지를 닫으면 처음부터
   */
  constructor(client, opts) {
    this.mock = false; this.client = client; this.localNode = opts.localNode; this.localId = opts.localId || null;
    this.idOf = opts.idOf || (() => null);
    this.parts = opts.parts || null;
    this.active = new Set();   // 이 화면이 지금 보내거나 받는 전송 id — 전송 목록에서 멈춘 것과 가른다
    this.seen = new Map();     // 노드 → (전송 id → 이 화면이 본 offset · 처음 본 때) — markStalled
  }

  /** 다른 화면이 보내는 중인지 볼 때 기다리는 시간(ms) — 시험은 줄여 쓴다 */
  static PROBE_MS = 3000;

  /** 화면의 노드 이름 → 진짜 node_id (이 노드면 localId). 모르면 이름 그대로(Master 가 거절한다) */
  nodeIdOf(node) { return node === this.localNode ? this.localId || node : this.idOf(node) || node; }

  /** 다른 노드의 Daemon 에 노드 주소 호출(B-1)로 닿나 — 이 게이트웨이에 그 길이 있어야 한다 */
  relays() { return !!(this.client.canRelay && this.client.canRelay()); }

  /** Daemon 쪽 대응(local)을 쓰나 — 이 노드, 또는 노드 주소 호출로 그 Daemon 에 닿는 다른 노드.
   *  앱 토큰은 Master 에 닿지 않는다(구현해야 할 것 PF-1) — 다른 노드의 작업도 그 Daemon 의 작업 목록으로 본다 */
  daemonView(node) { return node === this.localNode || this.relays(); }

  /** 그 노드에서 볼 앱 대응표 */
  appFor(app, node) { return appFor(app, this.daemonView(node)); }

  // L(Daemon) op — 이 노드면 invoke, 다른 노드면 노드 주소 호출(client.invoke 의 node = node_id).
  // M(모듈) op — 이 노드면 invoke, 다른 노드면 원격 모듈 경로(client.invokeModuleAt — io.terra.file 은 노드 카탈로그에 없다). node_id 를 모르면 부르지 않는다.
  // T(Master) 의 읽기 · 지우기(GET · DELETE)는 node_id 를 query 로 싣는다(화면 이름이 아니라 진짜 node_id — 로컬 노드면 localId).
  // 본문이 있는 Master 호출(POST)에는 싣지 않는다 — Master 의 본문 해석기도 모르는 키를 거절한다(decodeJSON DisallowUnknownFields)
  call(spec0, node, input) {
    const local = node === this.localNode, spec = forNode(spec0, local);
    const scoped = spec.where === 'L' || spec.where === 'M';
    if (scoped && !local) {
      const id = this.idOf(node);
      if (!id) return Promise.resolve({ kind: 'unavailable', reason: 'no-node-id' });
      const body = Object.assign(fillNode(spec.input, id), input || {});
      if (spec.where === 'M' && this.client.invokeModuleAt) return this.client.invokeModuleAt(id, spec.op, body, fileBinding(spec.op));
      return this.client.invoke(spec.op, body, { node: id });
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
    if (app === 'xfer') {
      if (!this.seen.has(node)) this.seen.set(node, new Map());
      return markStalled(items, this.active, Date.now(), this.seen.get(node));
    }
    return items;
  }

  /**
   * 모듈 설정(B-6 설정) — 스키마(config.schema.get)와 저장된 값(config.get)을 받아 폼 모양(cfgForm)으로. 둘 다 node.read 다.
   * 다른 노드는 노드 주소 호출(두 op 모두 scopes cluster). 설정을 선언하지 않은 모듈이면 cfg 는 null · r.reason MODULE_CONFIG_UNDECLARED
   * @returns {Promise<{ r: import('./client.js').Result, cfg: ReturnType<typeof cfgForm> | null }>}
   */
  async modConfig(node, id) {
    const L = (op) => ({ op: 'terra.daemon.modules.by-module-id.' + op, where: 'L' });
    const s = await this.call(L('config.schema.get'), node, { module_id: id });
    if (s.kind !== 'ok') return { r: s, cfg: null };
    const v = await this.call(L('config.get'), node, { module_id: id });
    if (v.kind !== 'ok') return { r: v, cfg: null };
    return { r: v, cfg: cfgForm(s.data, v.data) };
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
      // 모듈 op 는 원격 모듈 경로 — 그 노드 카탈로그(B-1)가 아니다. 경로를 알면(카탈로그 bindings · 대응표) 막지 않는다 — 그 노드에 모듈이 없으면 부를 때 답한다
      if (spec.where === 'M') return this.client.binding && this.client.binding(spec.op, fileBinding(spec.op)) ? null : why('not-remote');
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
   * 끊긴 뒤 이어서(MD-21) — 보내던 화면을 닫으면 부분 파일이 남아 새로 만들기는 FILE_TARGET_EXISTS 다. 그 자리에 같은 파일
   * (크기 · SHA-256)을 보내다 멈춘 전송이 있으면 새로 만들지 않고 그 전송을 다시 연다(resume_id — 서버가 받은 곳부터).
   * 보내는 사이 기한이 지나도(TRANSFER_EXPIRED) 같은 전송을 다시 연다
   * @param {string} node @param {Blob & { name: string }} file
   * @param {string} dir 보관함 칸 id('<공유 폴더>/<경로>') — ''이면 share-0 맨 위
   * @param {(offset: number) => void} [onProgress]
   * @param {{ resume?: any }} [opts]  resume — 전송 앱 카드의 이어서: 그 전송(adapters.js xfer 항목 — root · path · bytes · sha)
   * @returns {Promise<import('./client.js').Result & { from?: number }>}  from — 이어서 보냈으면 시작한 바이트
   */
  async upload(node, file, dir, onProgress, opts = {}) {
    const M = (op, input) => this.call({ op: 'io.terra.file.' + op, where: 'M' }, node, input);
    const sha = await sha256Blob(file);
    let cr;
    if (opts.resume) {
      const t = opts.resume;
      if (t.bytes !== file.size || (t.sha && t.sha !== sha)) return { kind: 'unavailable', reason: 'xfer-differs' };
      cr = await M('transfers.create', resumeBody(t));
    } else {
      const s = String(dir || ''), i = s.indexOf('/'), root = i < 0 ? s : s.slice(0, i), rel = i < 0 ? '' : s.slice(i + 1);
      const path = (rel ? rel + '/' : '') + file.name;
      cr = await M('transfers.create', Object.assign({ direction: 'push', path, size_bytes: file.size, checksum_sha256: sha, mode: 'create' }, root ? { root } : {}));
      if (cr.reason === 'FILE_TARGET_EXISTS') {   // 그 파일이 멈춘 올리기의 부분 파일일 수 있다
        const hit = await this.stalledPush(node, root || DEFAULT_ROOT, path, file.size, sha);
        if (hit.reason) return hit;
        if (hit.rec) cr = await M('transfers.create', resumeBody(hit.rec));
      }
    }
    if (cr.kind !== 'ok' && cr.kind !== 'accepted') return cr;
    const tr = trOf(cr), id = tr.transfer_id;
    if (!id) return { kind: 'error', reason: '전송 id를 받지 못했다' };
    const step = Math.min(tr.chunk_size || 262144, 512 * 1024), from = tr.offset || 0;
    let off = from, retry = 0, reopen = 0;
    if (from && onProgress) onProgress(from);
    this.active.add(id);
    try {
      while (off < file.size) {
        const bytes = new Uint8Array(await file.slice(off, off + step).arrayBuffer());
        const r = await M('transfers.chunks.put', { transfer_id: id, offset: off, data: toB64(bytes) });
        if (r.kind !== 'ok') {
          // 다른 곳에서 끝냈거나 중단했다 — 더 보내지 않는다
          if (r.status !== 409 || r.reason === 'TRANSFER_WRONG_STATE' || ++retry > 5) return r;
          const g = r.reason === 'TRANSFER_EXPIRED' && reopen++ < 3
            ? await M('transfers.create', resumeBody({ id, root: tr.root, path: tr.path, bytes: tr.size_bytes, sha: tr.checksum_sha256, mode: tr.mode }))   // 기한이 지났다 — 같은 전송을 다시 연다
            : await M('transfers.get', { transfer_id: id });   // 어긋남 — 서버가 받은 곳부터
          if (g.kind !== 'ok' && g.kind !== 'accepted') return r;
          off = trOf(g).offset || 0;
          continue;
        }
        off = (r.data && r.data.next_offset) || off + bytes.length;
        retry = 0;
        if (onProgress) onProgress(off);
      }
      const done = await M('transfers.complete', { transfer_id: id });
      return from ? Object.assign(done, { from }) : done;
    } finally { this.active.delete(id); }
  }

  /**
   * 그 자리(root · path)에서 보내다 멈춘 올리기 — 서버 전송 목록에서 찾는다(이 화면을 닫았다 다시 연 뒤라도, 다른 브라우저라도).
   * 이을 수 있는 것: 멈춘 것(markStalled) · 중단(부분 남김)한 것 중 크기 · SHA-256 이 같은 것. 목록은 새것부터다.
   * 방금까지 움직인 것은 PROBE_MS 기다려 다시 본다 — offset 이 그대로면 보내던 화면이 닫힌 것이다(닫고 곧바로 다시 올릴 때)
   * @returns {Promise<{ rec?: any } & Partial<import('./client.js').Result>>}  rec — 이을 전송 · reason — 이을 수 없는 까닭 · {} — 그런 전송이 없다
   */
  async stalledPush(node, root, path, size, sha) {
    const r = await this.call({ op: 'io.terra.file.transfers.list', where: 'M' }, node, {});
    if (r.kind !== 'ok') return {};
    const here = markStalled(ADAPT.xfer(r.data), this.active).filter((t) => t.dir === 'push' && t.root === root && t.path === path && /^(transferring|failed|aborted)$/.test(t.state));
    if (!here.length) return {};
    const same = here.filter((t) => t.bytes === size && t.sha === sha);
    const free = same.find((t) => t.state !== 'transferring');
    if (free) return { rec: free };
    if (!same.length) return { kind: 'unavailable', reason: 'xfer-other' };
    const t = same[0];
    await new Promise((res) => setTimeout(res, LiveSource.PROBE_MS));
    const g = await this.call({ op: 'io.terra.file.transfers.get', where: 'M' }, node, { transfer_id: t.id });
    const now = trOf(g);
    if (g.reason === 'TRANSFER_EXPIRED') return { rec: t };   // 기한이 지났다 — 보내는 쪽이 없다
    if (g.kind === 'ok' && /^(prepared|transferring)$/.test(now.state) && Math.min(1, (now.offset || 0) / Math.max(1, t.bytes)) === t.off) return { rec: t };
    return { kind: 'unavailable', reason: 'xfer-busy' };
  }

  /**
   * 파일 받기 — io.terra.file 받기(0.2.0): transfers.pulls.create(root · path) → transfers.chunks.get(offset 부터 eof 까지 —
   * 조각마다 SHA-256 을 견준다) → 전체 SHA-256 을 서버의 것과 견주고 transfers.pulls.complete. 어긋나면 pulls.abort 로 닫는다
   * 끊긴 뒤 이어서(MD-21) — 받은 조각을 이 브라우저(this.parts — IndexedDB)에 둔다. 같은 파일을 다시 받으면 새로 연 받기의
   * SHA-256 · 크기가 저장본과 같을 때 둔 곳부터 잇는다(다르면 그 사이 파일이 바뀌었다 — 처음부터). 앞서 받다 만 전송은 닫는다
   * @param {string} node @param {string} id 보관함 칸 id('<공유 폴더>/<경로>')
   * @param {(offset: number, size?: number) => void} [onProgress]
   * @param {{ old?: string }} [opts]  old — 전송 앱 카드의 이어서: 멈춘 그 받기(새로 열고 닫는다)
   * @returns {Promise<import('./client.js').Result & { blob?: Blob, name?: string, from?: number }>}  from — 이어 받았으면 시작한 바이트
   */
  async download(node, id, onProgress, opts = {}) {
    const M = (op, input) => this.call({ op: 'io.terra.file.' + op, where: 'M' }, node, input);
    const s = String(id || ''), i = s.indexOf('/'), root = i < 0 ? '' : s.slice(0, i), path = i < 0 ? '' : s.slice(i + 1);
    if (!root || !path) return { kind: 'unavailable', reason: 'share-root' };
    const cr = await M('transfers.pulls.create', { root, path });
    if (cr.kind !== 'ok' && cr.kind !== 'accepted') return cr;
    const tr = trOf(cr), tid = tr.transfer_id, size = tr.size_bytes;
    if (!tid) return { kind: 'error', reason: '전송 id를 받지 못했다' };
    const P = this.parts, key = this.nodeIdOf(node) + '|' + root + '/' + path;
    let kept = null;
    if (P && tr.checksum_sha256) { try { kept = await P.open(key, { sha: tr.checksum_sha256, size, tid }); } catch { kept = null; } }
    // 앞서 받다 만 전송(카드의 이어서 · 이 브라우저에 적어 둔 것) — 새로 열었으니 닫는다
    [...new Set([opts.old, kept && kept.tid])].filter((x) => x && x !== tid).forEach((x) => { void M('transfers.pulls.abort', { transfer_id: x }); });
    const close = async (r, bad) => { if (bad && kept) await P.drop(key); await M('transfers.pulls.abort', { transfer_id: tid }); return r; };
    const H = new Sha256(), parts = [];
    let off = 0, keep = !!kept, reopen = 0;
    if (kept && kept.offset) { kept.chunks.forEach((b) => { H.update(b); parts.push(b); }); off = kept.offset; if (onProgress) onProgress(off, size); }
    const from = off;
    let eof = size > 0 && off >= size;
    this.active.add(tid);
    try {
      while (!eof) {
        const r = await M('transfers.chunks.get', { transfer_id: tid, offset: off });
        if (r.kind !== 'ok' || !r.data) {
          if (r.reason === 'TRANSFER_EXPIRED' && reopen++ < 3) {   // 기한이 지났다 — 같은 받기를 다시 연다
            const g = await M('transfers.pulls.create', { root, path, resume_id: tid });
            if (g.kind === 'ok' || g.kind === 'accepted') continue;
          }
          return close(r);
        }
        const bytes = fromB64(r.data.data);
        if (r.data.sha256 && new Sha256().update(bytes).hex() !== r.data.sha256) return close({ kind: 'error', reason: 'chunk-checksum' });
        if (keep && bytes.length) keep = await P.add(key, off, bytes);
        H.update(bytes); parts.push(bytes); off += bytes.length;
        if (onProgress) onProgress(off, size);
        eof = !!r.data.eof || !bytes.length;
      }
      // 전체가 다르다 — 받는 사이 파일이 바뀌었다. 이 브라우저에 둔 것도 버린다
      if (tr.checksum_sha256 && H.hex() !== tr.checksum_sha256) return close({ kind: 'error', reason: 'checksum' }, true);
      const done = await M('transfers.pulls.complete', { transfer_id: tid });
      if (done.kind !== 'ok') return done;
      if (done.data && done.data.verified === false) return { kind: 'error', reason: 'checksum', data: done.data };
      if (kept) await P.drop(key);
      return Object.assign({ kind: 'ok', data: done.data, blob: new Blob(parts), name: path.split('/').pop() }, from ? { from } : {});
    } finally { this.active.delete(tid); }
  }

  async act(node, app, id, op, item, ctx = {}) {
    const A = this.appFor(app, node);
    const spec = forNode((A && A.acts[op]) || null, node === this.localNode);
    if (!spec || !spec.op) return { kind: 'ok', data: null };   // 화면에서만 하는 동작 (치우기 등)
    if (spec.none) return { kind: 'unavailable', reason: spec.none };
    if (spec.upload) return { kind: 'unavailable', reason: 'no-upload' };   // 올리기는 파일을 골라야 한다 — wire.js 가 고르게 하고 upload 를 부른다
    if (spec.download) return { kind: 'unavailable', reason: 'no-download' };   // 받기는 저장할 곳이 있어야 한다 — wire.js 가 download 를 부르고 브라우저로 저장한다
    if (spec.resume) return { kind: 'unavailable', reason: 'no-upload' };   // 이어서 — 올리기는 파일을 다시 골라야 한다 · 받기는 저장할 곳이 있어야 한다(wire.js)
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
    if (spec.say && (r.kind === 'ok' || r.kind === 'accepted')) r.say = spec.say(r.data, it);
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
