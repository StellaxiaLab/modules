// TerraClient — 화면이 Gateway를 부르는 유일한 길.
// 규칙: 화면은 operationId만 안다 · 호출 전에 catalog에 있는지 본다 · 응답은 Result로 바꿔 넘긴다
//
// 두 모드가 같은 클라이언트를 쓴다. 다른 것은 fetch 하나다.
//   frame 안   base '' (앱별 origin = 이 노드의 게이트웨이) · fetchImpl = terra.fetch (스코프 토큰을 붙이고
//              401이면 한 번 재발급해 다시 보낸다). 쿠키는 게이트웨이를 지나지 않는다
//   주소 지정  base = 게이트웨이 주소 · fetchImpl 없음 → credentials:'include' (시험 · 도구용. 화면은 frame 길만 쓴다)

/**
 * @typedef {{ kind: 'ok', data: any }
 *  | { kind: 'accepted', job: string }
 *  | { kind: 'needs-confirm', message?: string }
 *  | { kind: 'unauthenticated' | 'forbidden' | 'unsupported' | 'down' | 'unreachable' | 'unavailable' | 'error', status?: number, reason?: string, data?: any }} Result
 */

/** frame 토큰으로는 Master에 닿지 않는다 — 게이트웨이가 위임 자격의 Bearer를 Master로 넘기지 않는다(설계상 경계) */
const MASTER_PREFIX = 'terra.master.';

/** 노드 주소 호출 (Terra B-1 · ADR-GW-001) — 다른 노드의 operation 을 Master 가 중계하고, 대상 Daemon 이 자기 계약으로 다시 판정한다.
 *    POST /api/v1/nodes/{node_id}/operations/{id}/invoke  — 대상의 답(Daemon 봉투 · 202 포함)이 그대로 온다
 *    GET  /api/v1/nodes/{node_id}/catalog                 — 그 노드가 클러스터에 연 operation (availability.scopes 에 cluster)
 *  로컬 전용(명령 실행 · local-fs · desktop.open · 재시작 · 이벤트)과 io.terra.file(scopes local · node)은 그 카탈로그에 없다 */
export const RELAY_OP = 'terra.gateway.nodes.by-node.operations.by-id.invoke.post';
export const NODE_CATALOG_OP = 'terra.gateway.nodes.by-node.catalog.get';
/** 노드 카탈로그를 다시 받는 간격 — 노드가 모듈을 깔고 지우면 바뀐다 */
const NODE_CATALOG_TTL = 60000;

export class TerraClient {
  /**
   * @param {string} base 예: 'http://127.0.0.1:8787' (leaf) · ':8788' (tree). frame 안에서는 ''
   * @param {{ fetch?: typeof fetch, delegated?: boolean }} [opts]
   *   fetch     frame 안에서는 terra.fetch
   *   delegated 이 클라이언트의 자격이 위임(앱 스코프 토큰)이다 — Master 401을 "로그인 필요"가 아니라 "닿지 않음"으로 읽는다
   */
  constructor(base, opts = {}) {
    this.base = base.replace(/\/$/, '');
    this.fetch = opts.fetch || ((url, init) => fetch(url, Object.assign({ credentials: 'include' }, init)));
    this.delegated = !!opts.delegated;
    /** Master가 위임 자격을 거절한 뒤로는 부르지 않는다 — 부를 때마다 토큰 재발급 하나와 재시도 하나가 헛돈다 */
    this.masterBlocked = false;
    /** @type {Map<string, any>} */
    this.catalog = new Map();
    /** 노드 카탈로그 캐시 — node_id → { ok, ops: Map, at } · 받는 중이면 { p, at } */
    this._ncat = new Map();
    /** 노드 카탈로그를 받으면 — 화면이 자물쇠를 다시 그린다(wire.js) */
    this.onNodeCatalog = null;
  }

  async refreshCatalog() {   // 로그인 · 로그아웃 · 토큰이 바뀐 뒤마다 (카탈로그는 호출자 권한으로 좁혀 온다)
    const res = await this.fetch(`${this.base}/api/v1/catalog`);
    const body = await res.json();
    const ops = body.operations || body.items || [];
    this.catalog = new Map(ops.map((o) => [o.id || o.operationId, o]));
    return this.catalog.size;
  }
  has(id) { return this.catalog.size === 0 || this.catalog.has(id); }   // 카탈로그를 아직 못 받았으면 막지 않는다
  entry(id) { return this.catalog.get(id); }

  /** 이 게이트웨이에 노드 주소 호출 길이 있나 */
  canRelay() { return this.has(RELAY_OP); }

  /** 카탈로그의 bindings('GET /api/modules/io.terra.file/v1/entries') → { method, path }. 없으면 fallback */
  binding(id, fallback) {
    const e = this.entry(id), b = (e && e.bindings) || [];
    for (const s of b) { const m = /^([A-Z]+)\s+(\/\S+)$/.exec(String(s)); if (m) return { method: m[1], path: m[2] }; }
    return fallback || null;
  }

  /**
   * 그 노드가 클러스터에 연 operation (60초 캐시). 못 받으면 { ok: false } — 그때는 막지 않고 부른다(대상이 다시 판정한다)
   * @param {string} nodeId @returns {Promise<{ ok: boolean, ops: Map<string, any>, at: number } | null>}
   */
  async nodeCatalog(nodeId) {
    if (!nodeId || !this.has(NODE_CATALOG_OP)) return null;
    const c = this._ncat.get(nodeId);
    if (c && Date.now() - c.at < NODE_CATALOG_TTL) return c.p || c;
    const p = this.request('GET', '/api/v1/nodes/' + encodeURIComponent(nodeId) + '/catalog').then((r) => {
      const ops = r.kind === 'ok' && r.data && Array.isArray(r.data.operations) ? r.data.operations : null;
      const v = { ok: !!ops, ops: new Map((ops || []).map((o) => [o.operationId || o.id, o])), at: Date.now(), status: r.status };
      this._ncat.set(nodeId, v);
      if (this.onNodeCatalog) { try { this.onNodeCatalog(nodeId, v); } catch { /* 화면 쪽 */ } }
      return v;
    });
    this._ncat.set(nodeId, { p, at: Date.now() });
    return p;
  }
  /** 받아 둔 노드 카탈로그 — 기다릴 수 없는 곳(누르기 전 자물쇠)용. 없거나 받는 중이면 null */
  nodeCatalogNow(nodeId) { const c = this._ncat.get(nodeId); return c && !c.p ? c : null; }

  /**
   * @param {string} id operationId
   * @param {object} [input] 평평한 객체 — 최상위 키가 경로의 {name}을 채우고 나머지는 query·본문이 된다
   * @param {{ signal?: AbortSignal, node?: string }} [opts]  node = 다른 노드의 node_id — 노드 주소 호출(invokeAt)로 간다
   * @returns {Promise<Result>}
   */
  async invoke(id, input, opts = {}) {
    if (!id) return { kind: 'unavailable', reason: 'no-operation' };
    if (opts.node) return this.invokeAt(opts.node, id, input, opts);
    if (this.masterBlocked && id.startsWith(MASTER_PREFIX)) return { kind: 'unavailable', reason: 'master-delegation' };
    if (!this.has(id)) return { kind: 'unavailable', reason: 'not-in-catalog' };
    let res;
    try {
      // 확인 신호는 보내지 않는다 — 게이트웨이에 그런 규약이 없다. 위험한 동작의 확인은 화면이 맡는다(두 번 누르기).
      res = await this.fetch(`${this.base}/api/v1/operations/${encodeURIComponent(id)}/invoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input ?? {}), signal: opts.signal
      });
    } catch (e) {
      return { kind: 'unreachable', reason: String(e) };
    }
    const r = await toResult(res);
    // frame 클라이언트는 401에 이미 한 번 재발급해 다시 보냈다. 그래도 401인 Master 호출은 토큰 만료가 아니다.
    if (this.delegated && r.kind === 'unauthenticated' && id.startsWith(MASTER_PREFIX)) {
      this.masterBlocked = true;
      return { kind: 'unavailable', status: r.status, reason: 'master-delegation', data: r.data };
    }
    return r;
  }

  /**
   * 다른 노드의 operation — 노드 주소 호출(B-1). 그 노드 카탈로그에 없는 것(로컬 전용 · 열지 않은 것)은 부르지 않는다.
   * Master 의 길 오류(NODE_OFFLINE · DELEGATION_REQUIRED …)는 코드 그대로 reason 에 온다
   * @param {string} nodeId @param {string} id @param {object} [input] @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<Result>}
   */
  async invokeAt(nodeId, id, input, opts = {}) {
    if (!this.canRelay()) return { kind: 'unavailable', reason: 'remote-node' };
    if (this.masterBlocked) return { kind: 'unavailable', reason: 'master-delegation' };   // 중계는 Master 를 지난다
    const cat = await this.nodeCatalog(nodeId), e = cat && cat.ok ? cat.ops.get(id) : null;
    if (cat && cat.ok && !e) return { kind: 'unavailable', reason: 'not-remote' };
    if (e && e.allowed === false) return { kind: 'forbidden', reason: 'remote-denied' };
    let res;
    try {
      res = await this.fetch(`${this.base}/api/v1/nodes/${encodeURIComponent(nodeId)}/operations/${encodeURIComponent(id)}/invoke`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input ?? {}), signal: opts.signal
      });
    } catch (err) {
      return { kind: 'unreachable', reason: String(err) };
    }
    return toResult(res);
  }

  /**
   * 다른 노드의 **모듈** operation — 원격 모듈 경로 `/api/nodes/{node_id}/modules/{모듈}/…`(Master 중계).
   * 모듈 op(io.terra.file …)는 scopes 가 local · node 라 노드 주소 호출(그 노드 카탈로그)에 없다 — 모듈 경로로 간다.
   * 경로는 카탈로그의 bindings(없으면 fallback)에서 — `{name}` 자리를 채우고, GET · DELETE 는 나머지를 query 로, 그 밖은 본문으로
   * @param {string} nodeId @param {string} id @param {object} [input] @param {{ method: string, path: string }} [fallback]
   * @returns {Promise<Result>}
   */
  async invokeModuleAt(nodeId, id, input, fallback) {
    if (this.masterBlocked) return { kind: 'unavailable', reason: 'master-delegation' };   // 중계는 Master 를 지난다
    const b = this.binding(id, fallback);
    if (!b || b.path.indexOf('/api/modules/') !== 0) return { kind: 'unavailable', reason: 'not-remote' };
    const t = fillRoute(b.method, b.path, input || {});
    if (t.missing) return { kind: 'error', reason: 'missing-path-param' };
    return this.request(b.method, t.path.replace(/^\/api\/modules\//, '/api/nodes/' + encodeURIComponent(nodeId) + '/modules/'), t.body);
  }

  /**
   * 게이트웨이 자신의 경로를 GET 으로 — operation 이 아니라 경로로만 맞게 답하는 것들.
   *   /api/v1/agent/whoami  invoke(terra.gateway.agent.whoami.get)로 부르면 호출자가 중계에서 빠져 'anonymous' 가 온다(실측)
   *   /api/v1/agent/nodes   Master 세션으로 노드 목록 — 위임 자격이 노드 id 를 아는 길
   * @param {string} path  '/api/v1/…' @returns {Promise<Result>}
   */
  async get(path) { return this.request('GET', path); }

  /**
   * 게이트웨이 경로를 그대로 — 사용자 문서(/api/v1/me/documents/…)처럼 경로로 불러야 앱 토큰의 호출자가 맞게 가는 것들(get 참고).
   * @param {'GET'|'PUT'|'POST'|'DELETE'} method @param {string} path '/api/v1/…' @param {any} [body] JSON 으로 싣는다
   * @returns {Promise<Result>}
   */
  async request(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try { res = await this.fetch(`${this.base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch (e) { return { kind: 'unreachable', reason: String(e) }; }
    return toResult(res);
  }
}

/**
 * 게이트웨이의 buildUpstreamTarget 과 같은 규칙 — `{name}` 자리 채우기(`{name...}`은 `/`를 살린다) → GET · DELETE 는 나머지를 query, 그 밖은 본문.
 * 자리를 못 채우면 missing 에 그 이름 (maingui src/api/client.js 와 같은 코드)
 * @returns {{ path: string, body: any, missing: string|null }}
 */
export function fillRoute(method, path, input) {
  const rest = Object.assign({}, input);
  let missing = null;
  let p = path.replace(/\{([^}]+)\}/g, (all, raw) => {
    const name = raw.replace(/\.\.\.$/, ''), v = rest[name];
    delete rest[name];
    if (v == null || v === '') { missing = missing || name; return ''; }
    return raw.endsWith('...') ? String(v).split('/').map(encodeURIComponent).join('/') : encodeURIComponent(String(v));
  });
  let body;
  if (method === 'GET' || method === 'DELETE') {
    const q = Object.entries(rest).filter(([, v]) => v != null && v !== '').map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v)));
    if (q.length) p += '?' + q.join('&');
  } else body = rest;
  return { path: p, body, missing };
}

/**
 * 응답 → Result. 봉투를 벗긴다 — provider마다 모양이 다르다.
 *   Daemon   { status: 'ok' | 'accepted', data, meta }  ·  오류 { error: { code, message } }
 *   Master   { ok: true, data, meta }                    ·  오류 { ok: false, error: { code, message } }
 *   Gateway  오류 { error: { code, message, traceId } }
 * @param {Response} res @returns {Promise<Result>}
 */
export async function toResult(res) {
  let body = null;
  try { body = await res.json(); } catch { /* 본문 없음 */ }
  const data = unwrap(body);
  // 작업 기록(tasks.by-task-id.get 등)도 job_id · task_id 를 싣는다 — 상태(state · status)가 있으면 접수가 아니라 기록이다
  const record = data && typeof data === 'object' && ('state' in data || 'status' in data);
  if (res.status === 202 || (body && body.status === 'accepted') || (data && (data.job_id || data.task_id) && !record)) {
    return { kind: 'accepted', job: data && (data.job_id || data.task_id), data };   // data — 전송 만들기(202)는 transfer 를 싣는다
  }
  if (res.ok) return { kind: 'ok', data };
  const map = { 401: 'unauthenticated', 403: 'forbidden', 501: 'unsupported', 503: 'down' };
  return { kind: map[res.status] || 'error', status: res.status, reason: errorCode(body), data: body };
}

function unwrap(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('data' in body)) return body;
  return body.ok === true || body.status === 'ok' || body.status === 'accepted' ? body.data : body;
}

function errorCode(body) {
  if (!body || typeof body !== 'object') return undefined;
  const e = body.error;
  if (e && typeof e === 'object') return e.code || e.message;
  return body.code || (typeof e === 'string' ? e : undefined) || body.message;
}

/** 이유 코드 → 사람이 읽는 말. 모르는 코드는 그대로 보인다(검색되는 이름이 낫다) */
const REASON = {
  'remote-node': '이 노드의 게이트웨이에 노드 주소 호출이 없다 — 다른 노드의 자원은 그 노드의 화면에서',
  'no-node-id': '그 노드의 node_id 를 모른다 — Master 노드 목록에 있는 노드만 부를 수 있다',
  'not-remote': '그 노드가 이 기능을 원격으로 열지 않았다(그 노드에서만 쓴다)',
  'remote-denied': '그 노드에서 이 기능을 쓸 권한이 없다',
  NODE_OFFLINE: '그 노드가 오프라인이다',
  DESKTOP_OPEN_EXECUTABLE: '실행 파일은 열지 않는다 — 파일 관리자로만 보인다',
  DESKTOP_SESSION_UNAVAILABLE: 'Daemon 이 그 컴퓨터의 바탕화면 세션에 닿지 않는다',
  DESKTOP_LAUNCHER_UNAVAILABLE: '그 컴퓨터에 파일을 여는 프로그램(xdg-open 등)이 없다',
  DESKTOP_OPEN_FAILED: '여는 프로그램이 실패했다',
  LOCAL_FS_DISABLED: '그 노드의 로컬 탐색이 꺼져 있다(local_fs.enabled)',
  LOCAL_FS_DENIED: '닫힌 폴더다 — Daemon 이 보이지 않게 막았다',
  LOCAL_FS_ROOT_NOT_FOUND: '그 최상위 루트가 없다',
  LOCAL_FS_PATH_NOT_FOUND: '그 경로가 없다 — 지워졌거나 옮겨졌다',
  LOCAL_FS_PATH_INVALID: '그 경로는 쓸 수 없다',
  RELAY_NOT_CONNECTED: 'Master 와 그 노드의 중계가 끊겼다 — 잠시 뒤 다시',
  DELEGATION_REQUIRED: '직계 자식이 아니다 — 그 노드의 부모 tree 를 거쳐야 한다',
  NODE_NOT_FOUND: 'Master 가 그 노드를 모른다',
  OPERATION_NOT_REMOTE: '그 노드가 이 기능을 원격으로 열지 않았다',
  'master-delegation': 'Master를 거치는 기능은 이 화면에 아직 열리지 않았다',
  'not-in-catalog': '이 노드의 게이트웨이에 없다',
  'no-operation': '대응하는 API가 없다',
  'no-download': '받기는 파일을 저장할 곳이 있어야 한다 — 폴더 앱 파일 카드의 받기를 누른다',
  'chunk-checksum': '받은 조각의 SHA-256 이 맞지 않는다 — 전송을 버렸다',
  checksum: '받은 파일의 SHA-256 이 서버의 것과 다르다 — 저장하지 않았다',
  'no-upload': '올리기는 파일을 골라야 한다 — 조타륜 전송 앱의 ↑ 올리기를 누른다',
  'mod-cfg': '설정을 받지 못했다 — 수정 폼을 다시 연다',
  MODULE_CONFIG_UNDECLARED: '설정을 선언하지 않은 모듈이다(매니페스트 configuration.schema 없음)',
  MODULE_CONFIG_REVISION_CONFLICT: '다른 화면이 먼저 설정을 바꿨다 — 폼을 다시 열어 지금 값에서 고친다',
  MODULE_CONFIG_INVALID: '설정 값이 스키마를 어긴다',
  'xfer-busy': '같은 파일을 다른 화면(또는 기기)이 올리는 중이다 — 끝나거나 멈춘 뒤 다시',
  'xfer-other': '같은 이름으로 보내다 멈춘 다른 파일이 있다 — 전송 앱에서 그 전송을 지운 뒤 다시',
  'xfer-differs': '고른 파일이 멈춘 전송의 파일과 다르다 — 크기 · SHA-256 이 같은 파일이라야 잇는다',
  FILE_TARGET_EXISTS: '같은 이름의 파일이 이미 있다 — 덮어쓰지 않는다',
  TRANSFER_WRONG_STATE: '전송이 이미 끝났거나 중단됐다',
  TRANSFER_NOT_FOUND: '그 전송이 없다 — 끝났거나 지워졌다',
  TRANSFER_EXPIRED: '전송 기한이 지났다 — 전송 앱 카드의 이어서로 다시 연다',
  'no-transfer': '올리기 · 받기는 아직 이 화면에 없다 — 보낼 파일을 고르고 청크를 주고받을 칸이 없다',
  'xfer-form': '전송은 머리의 ↑ 올리기로 파일을 골라 보낸다 — 받기는 폴더 앱 파일 카드의 받기로',
  'no-rerun': 'Daemon 작업 목록은 명령을 돌려주지 않는다 — 추가 폼에 다시 적는다',
  'share-root': '공유 폴더(맨 위 칸)는 Daemon 설정이 정한다 — 폴더 안에 들어가서 만들고 바꾼다',
  'bad-name': '이름에 / 를 쓸 수 없다',
  'bind-immutable': '바인딩은 고칠 수 없다 — 끊고 새로 연결한다',
  'io-kind': '종류는 장치가 정한다 — 바꿀 수 없다',
  'io-addr': '손 등록은 카메라 주소만 받는다 — rtsp:// · rtsps:// · http:// · https:// (비우면 스캔한다)',
  'io-pending': '승인 대기로 되돌리는 op는 없다 — 승인 · 거부만',
  'decl-key': '선언의 계열 · 이름은 바꿀 수 없다 — 철회하고 새 이름으로 선언한다',
  'tunnel-addr': '대상은 노드이름:포트, 로컬 주소는 127.0.0.1:포트로 적는다',
  'unknown-node': '그 이름의 노드를 모른다 — 맵에 있는 노드 이름으로 적는다',
  'wg-no-node': '이 피어의 node_id를 모른다(공개 키뿐) — 회수할 수 없다'
};

/** 이유 코드의 사람 말 — 머리말(쓸 수 없다 · 지금은 볼 수 없다 …) 없이. 모르는 코드면 '' */
export function reasonText(r) { return (r && r.reason && REASON[r.reason]) || ''; }

/** Result → 화면 글줄 (앱 바 왼쪽 msg) */
export function resultText(r) {
  const head = {
    ok: '완료', accepted: '접수됨 — 진행 중', 'needs-confirm': '확인이 필요하다', unauthenticated: '로그인이 필요하다',
    forbidden: '권한 없음', unsupported: '이 노드는 지원하지 않는다', down: '지금은 볼 수 없다 (모듈 멈춤)',
    unreachable: '노드에 닿지 않는다', unavailable: '쓸 수 없다', error: '오류'
  }[r.kind] || r.kind;
  return head + (r.reason ? ' · ' + (REASON[r.reason] || r.reason) : '');
}

/** 작업(job/task) 추적 — 접수 직후 1초 → 최대 5초 backoff. 끝나면 resolve.
 *  key = 작업 id 를 싣는 입력 키 (Master 작업 job_id · Daemon 작업 task_id) */
export async function trackJob(client, jobOp, job, onTick, key = 'job_id') {
  let wait = 1000;
  for (let n = 0; n < 60; n++) {
    await new Promise((r) => setTimeout(r, wait));
    const r = await client.invoke(jobOp, { [key]: job });
    if (onTick) onTick(r);
    const st = r.kind === 'ok' && r.data && (r.data.status || r.data.state);
    if (st && /success|succeeded|failed|canceled|cancelled|completed|timed_out|dead_letter/.test(st)) return r;
    if (r.kind !== 'ok' && r.kind !== 'accepted') return r;
    wait = Math.min(5000, wait * 1.6);
  }
  return { kind: 'unavailable', reason: 'job-timeout' };
}
