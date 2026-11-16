// 이 모듈의 operation 을 부른다. 화면은 frame 이 준 스코프 토큰(사용자 권한 ∩ 앱이 선언한 권한)으로 Gateway 의
// 주소 독립 입구를 부른다:
//   이 노드      POST /api/v1/operations/{id}/invoke
//   다른 노드    POST /api/v1/nodes/{node}/operations/{id}/invoke   (Master 중계 — 대상 노드가 자기 계약으로 다시 판정)
// 입력은 평평한 JSON(경로 변수는 Gateway 가 채운다). 본문 상한은 1 MiB — 청크는 모듈이 640 KiB 로 지킨다.

const OP = 'lab.stellaxia.file.';

export class TerraError extends Error {
  constructor(code, message, status, retryable, details) {
    super(message || code);
    this.name = 'TerraError';
    this.code = code;
    this.status = status;
    this.retryable = !!retryable;
    this.details = details || null;
  }
}
const STATUS_CODE = { 502: 'GATEWAY_UNREACHABLE', 503: 'UNAVAILABLE', 504: 'TIMEOUT' };

async function unwrap(res) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {
    throw new TerraError(res.ok ? 'BAD_RESPONSE' : STATUS_CODE[res.status] || 'HTTP_' + res.status, text.slice(0, 200), res.status, res.status >= 502);
  }
  if (!res.ok || (body && body.status === 'error') || (body && body.error)) {
    const e = (body && (body.error || body)) || {};
    throw new TerraError(e.code || STATUS_CODE[res.status] || 'HTTP_' + res.status, e.message || res.statusText, res.status, e.retryable ?? res.status >= 502, e.details);
  }
  // 봉투({status|ok|meta, data})가 있을 때만 벗긴다.
  return body && typeof body === 'object' && 'data' in body && ('status' in body || 'ok' in body || 'meta' in body) ? body.data : body;
}

/** @param {{ fetch: (path: string, init?: RequestInit) => Promise<Response> }} frame terra-frame-client 의 TerraFrame 꼴 */
export function createApi(frame) {
  const send = async (path, init) => {
    try { return await frame.fetch(path, init); } catch (e) {
      if (e && e.name === 'AbortError') throw new TerraError('TIMEOUT', '호출이 시간 안에 끝나지 않았습니다', 0, true);
      throw new TerraError('NETWORK', 'Gateway 에 닿지 못했습니다 — ' + ((e && e.message) || e), 0, true);
    }
  };
  /** @param {string} id 전체 operation id @param {object} [input] @param {{ node?: string, signal?: AbortSignal }} [at] */
  async function invoke(id, input = {}, at = {}) {
    const path = at.node
      ? `/api/v1/nodes/${encodeURIComponent(at.node)}/operations/${encodeURIComponent(id)}/invoke`
      : `/api/v1/operations/${encodeURIComponent(id)}/invoke`;
    return unwrap(await send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: at.signal }));
  }
  /** 그 노드에 묶은 호출 — createFileTransfer 가 요구하는 invoke(op, input) 꼴 */
  const at = (node) => (id, input, o) => invoke(id, input, { ...(o || {}), node: node || undefined });

  return {
    invoke,
    at,
    /** Master 노드 기록 — node.read 가 있을 때만. 없거나 실패하면 호출한 쪽이 이 노드만 보인다 */
    async nodes() {
      const r = await unwrap(await send('/api/v1/operations/terra.master.nodes.get/invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
      const list = Array.isArray(r) ? r : (r && (r.nodes || r.items)) || [];
      return list.filter((n) => n && (n.node_id || n.id)).map((n) => ({ id: n.node_id || n.id, name: n.display_name || n.name || n.node_id || n.id, online: n.online ?? n.status === 'online' }));
    },
    files(node) {
      const call = at(node);
      return {
        roots: () => call(OP + 'roots.list', {}),
        list: (root, path) => call(OP + 'entries.list', { root, path: path || undefined }),
        stat: (root, path, checksum) => call(OP + 'entries.stat', { root, path, checksum: checksum || undefined }),
        mkdir: (root, path, parents) => call(OP + 'entries.mkdir', { root, path, parents: parents || undefined }),
        rename: (root, path, to) => call(OP + 'entries.rename', { root, path, to }),
        remove: (root, path, recursive) => call(OP + 'entries.remove', { root, path, recursive: recursive || undefined }),
        transfers: () => call(OP + 'transfers.list', {}),
        abort: (id, pull) => call(OP + (pull ? 'transfers.pulls.abort' : 'transfers.abort'), { transfer_id: id, reason: 'discarded' }),
      };
    },
  };
}
