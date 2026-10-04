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

  /**
   * @param {string} id operationId
   * @param {object} [input] 평평한 객체 — 최상위 키가 경로의 {name}을 채우고 나머지는 query·본문이 된다
   * @param {{ signal?: AbortSignal, node?: string }} [opts]  node = 다른 노드 (지금은 길이 없다 — 아래)
   * @returns {Promise<Result>}
   */
  async invoke(id, input, opts = {}) {
    if (!id) return { kind: 'unavailable', reason: 'no-operation' };
    // 다른 노드의 operation을 부르는 게이트웨이 경로가 없다. 원격은 **모듈** 경로
    // (/api/nodes/{node}/modules/{id}/{ver}/…)뿐이고 operation id로는 부를 수 없다.
    if (opts.node) return { kind: 'unavailable', reason: 'remote-node' };
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
   * 게이트웨이 자신의 경로를 GET 으로 — operation 이 아니라 경로로만 맞게 답하는 것들.
   *   /api/v1/agent/whoami  invoke(terra.gateway.agent.whoami.get)로 부르면 호출자가 중계에서 빠져 'anonymous' 가 온다(실측)
   *   /api/v1/agent/nodes   Master 세션으로 노드 목록 — 위임 자격이 노드 id 를 아는 길
   * @param {string} path  '/api/v1/…' @returns {Promise<Result>}
   */
  async get(path) {
    let res;
    try { res = await this.fetch(`${this.base}${path}`, { headers: { Accept: 'application/json' } }); }
    catch (e) { return { kind: 'unreachable', reason: String(e) }; }
    return toResult(res);
  }

  /** leaf SSE (terra.daemon.events.get) — 끊기면 1 → 2 → 4 … 30초 재연결
   *  EventSource는 Authorization을 붙이지 못하므로 fetch 스트림으로 읽는다. Accept가 없으면 일반 호출로 가 15초에서 끊긴다. */
  events(onEvent) {
    let stop = false, wait = 1000, ctl;
    const open = async () => {
      if (stop) return;
      ctl = new AbortController();
      try {
        const res = await this.fetch(`${this.base}/api/v1/operations/terra.daemon.events.get/invoke`, {
          method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: '{}', signal: ctl.signal
        });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          wait = 1000;
          buf += dec.decode(value, { stream: true });
          for (const data of takeEvents(buf, (rest) => { buf = rest; })) {
            try { onEvent(JSON.parse(data)); } catch { onEvent(data); }
          }
        }
      } catch { /* 끊김 · 거절 */ }
      if (!stop) { setTimeout(open, wait); wait = Math.min(30000, wait * 2); }
    };
    open();
    return () => { stop = true; if (ctl) ctl.abort(); };
  }
}

/** SSE 버퍼에서 끝난 이벤트의 data 를 꺼낸다. 남은 조각은 rest 로 돌려준다 */
export function takeEvents(buf, rest) {
  const out = [];
  let cut;
  while ((cut = buf.indexOf('\n\n')) >= 0) {
    const data = buf.slice(0, cut).split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    buf = buf.slice(cut + 2);
    if (data) out.push(data);
  }
  rest(buf);
  return out;
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
    return { kind: 'accepted', job: data && (data.job_id || data.task_id) };
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
  'remote-node': '다른 노드의 자원은 아직 이 화면에서 볼 수 없다',
  'master-delegation': 'Master를 거치는 기능은 이 화면에 아직 열리지 않았다',
  'not-in-catalog': '이 노드의 게이트웨이에 없다',
  'no-operation': '대응하는 API가 없다',
  'no-download': '받기는 아직 이 화면에 없다 — 청크를 끝까지 당겨 저장해야 한다',
  'no-upload': '올리기는 아직 이 화면에 없다 — 보낼 파일을 고를 칸이 없다',
  'no-transfer': '올리기 · 받기는 아직 이 화면에 없다 — 보낼 파일을 고르고 청크를 주고받을 칸이 없다',
  'no-rerun': 'Daemon 작업 목록은 명령을 돌려주지 않는다 — 추가 폼에 다시 적는다',
  'share-root': '공유 폴더(맨 위 칸)는 Daemon 설정이 정한다 — 폴더 안에 들어가서 만들고 바꾼다',
  'bad-name': '이름에 / 를 쓸 수 없다',
  'io-kind': '종류는 장치가 정한다 — 바꿀 수 없다',
  'io-pending': '승인 대기로 되돌리는 op는 없다 — 승인 · 거부만',
  'decl-key': '선언의 계열 · 이름은 바꿀 수 없다 — 철회하고 새 이름으로 선언한다',
  'tunnel-addr': '대상은 노드이름:포트, 로컬 주소는 127.0.0.1:포트로 적는다',
  'unknown-node': '그 이름의 노드를 모른다 — 맵에 있는 노드 이름으로 적는다',
  'wg-no-node': '이 피어의 node_id를 모른다(공개 키뿐) — 회수할 수 없다'
};

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
