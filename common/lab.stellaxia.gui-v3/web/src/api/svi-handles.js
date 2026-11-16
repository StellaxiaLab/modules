// SVI handle 만들기 · 지우기 · write — 위임 세션(앱 토큰)으로 (Terra P12-2, #429).
//
//   만들기   terra.master.svi.handles.post   { resource_id, endpoint_id, operation, qos_profile?, idempotency_key, ttl_seconds?(≤ 86400) } → 202 { handle_id, operation_id, state }   분당 30
//   지우기   terra.master.svi.handles.by-handle-id.delete { handle_id }                                                                                                   분당 60
//   write    terra.master.svi.handles.by-handle-id.write.get — WebSocket 업그레이드(스트림 티켓). 소비자가 { sequence, data(base64) } 프레임을 올리면 Master 가 제공 노드로 relay.
//            거부는 { kind: 'error', … } 메시지 · 정상 종료는 close. 업그레이드 1회 = 1건(열린 소켓의 프레임은 세지 않음)                                                     분당 30
//   한도를 넘으면 429 RATE_LIMITED. Gateway 가 write 소켓을 중계하는 길은 Terra 쪽 후속이라, 티켓을 못 받으면 그 사유를 그대로 보인다(몰래 성공으로 두지 않는다).
// 소유자 · cluster 확인은 Master 핸들러가 한다 — 남의 핸들은 404/403.

import { TerraError } from './terra.js';

export const HANDLE_OPS = { create: 'terra.master.svi.handles.post', delete: 'terra.master.svi.handles.by-handle-id.delete', write: 'terra.master.svi.handles.by-handle-id.write.get', list: 'terra.master.svi.handles.get', events: 'terra.master.svi.handles.by-handle-id.events.get' };
/** 분당 한도(Terra #429) — 안내 글에만 쓴다(판정은 Master) */
export const LIMITS = { [HANDLE_OPS.create]: 30, [HANDLE_OPS.delete]: 60, [HANDLE_OPS.write]: 30 };
const VERB = { [HANDLE_OPS.create]: '핸들 만들기', [HANDLE_OPS.delete]: '핸들 지우기', [HANDLE_OPS.write]: 'write 소켓 열기', [HANDLE_OPS.events]: '값 구독' };

/** 429 인가 */
export const isLimited = (e) => !!e && (e.status === 429 || e.code === 'RATE_LIMITED' || e.code === 'TOO_MANY_STREAMS');

/** 실패 → 사람이 읽을 안내 한 줄 + 종류. 429 는 한도와 기다릴 시간을 적는다(곧바로 다시 누르지 않게) */
export function explain(op, e) {
  const v = VERB[op] || op, code = (e && e.code) || '', st = (e && e.status) || 0;
  if (isLimited(e)) { const n = LIMITS[op]; return { kind: 'limit', retryable: true, text: v + ' — 요청 한도 초과' + (n ? ' (분당 ' + n + '번)' : '') + ' · 1분쯤 뒤 다시' }; }
  if (code === 'DELEGATION_NOT_OPEN') return { kind: 'closed', retryable: false, text: v + ' — 앱 토큰에 닫힘 (' + code + ')' };
  if (st === 401) return { kind: 'session', retryable: false, text: v + ' — 세션 만료 · 다시 로그인' };
  if (st === 403) return { kind: 'denied', retryable: false, text: v + ' — 권한 없음' + (code ? ' (' + code + ')' : '') };
  if (st === 404) return { kind: 'gone', retryable: false, text: v + ' — 핸들 없음 (끝났거나 남의 것)' };
  if (code === 'NOT_IMPLEMENTED') return { kind: 'closed', retryable: false, text: v + ' — 이 Terra 에 아직 없음 (NOT_IMPLEMENTED)' };
  return { kind: 'error', retryable: !!(e && e.retryable), text: v + ' 실패 — ' + (code || (e && e.message) || '오류') };
}

const b64 = (x) => {
  const u = typeof x === 'string' ? new TextEncoder().encode(x) : Uint8Array.from(x || []); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * @param {{ invoke: Function, streamIO?: (op: string, input: object, h: { onMessage: Function, onClose: Function }) => Promise<{ send: (v: any) => void, close: () => void }> }} terra
 */
export function createSviHandles(terra) {
  const key = () => 'gui-v3-h-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const wrap = async (op, p) => { try { return await p(); } catch (e) { const x = explain(op, e); e.explain = x; throw e; } };
  return {
    /** 핸들 만들기 — operation: read · subscribe · write … 이미 같은 idempotency_key 면 Master 가 같은 핸들을 준다 */
    create(req) {
      const input = { resource_id: req.resource_id, endpoint_id: req.endpoint_id, operation: req.operation || 'subscribe', idempotency_key: req.key || key(), ttl_seconds: req.ttl || 3600 };
      if (req.qos) input.qos_profile = req.qos;
      return wrap(HANDLE_OPS.create, () => terra.invoke(HANDLE_OPS.create, input));
    },
    delete: (handle_id) => wrap(HANDLE_OPS.delete, () => terra.invoke(HANDLE_OPS.delete, { handle_id })),
    /** 내 핸들 목록(보이는 것만) — { items, next_cursor } */
    list: (o = {}) => terra.invoke(HANDLE_OPS.list, o),
    /**
     * write 소켓 — 열면 { send(data, sequence?), close(), sent() }. 거부(kind: error) · 닫힘은 h.onReject / h.onClose 로.
     * 소켓을 못 열면 TerraError(explain 이 사유 · 429 안내). streamIO 가 없는 전송이면 NOT_SUPPORTED
     */
    async openWriter(handle_id, h = {}) {
      if (!terra.streamIO) throw Object.assign(new TerraError('NOT_SUPPORTED', 'write 소켓 : 이 전송에 WebSocket 없음', 0), { explain: { kind: 'closed', retryable: false, text: 'write 소켓 : 이 전송에 WebSocket 없음' } });
      let seq = 0, closed = false;
      const io = await wrap(HANDLE_OPS.write, () => terra.streamIO(HANDLE_OPS.write, { handle_id }, {
        onMessage: (m) => { let v = m; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return; } } if (v && v.kind === 'error' && h.onReject) try { h.onReject(v); } catch {} },
        onClose: () => { if (closed) return; closed = true; if (h.onClose) try { h.onClose(); } catch {} },
      }));
      return {
        /** 한 프레임 — 글(UTF-8) 또는 바이트 배열. 순번은 1 부터 */
        send(data, sequence) { if (closed) throw new TerraError('CLOSED', 'write 소켓 닫힘', 0); const q = sequence || ++seq; if (sequence) seq = Math.max(seq, sequence); io.send({ sequence: q, data: b64(data) }); return q; },
        close() { if (closed) return; closed = true; try { io.close(); } catch {} if (h.onClose) try { h.onClose(); } catch {} },
        sent: () => seq,
      };
    },
  };
}
