// 연결 상태 · 이유 → 화면 글 (MD-29). Terra 의 바인딩 이유는 코드가 아니라 자유 글자다 — 알려진 것(binding_service.go authorizeAndPlan · 조정 sweep)만
// 풀어 쓰고, 모르는 것은 그대로 보인다(검색되는 이름이 낫다). 코드에 없는 이름(GRANT_REQUIRED · SCHEMA_MISMATCH 같은 것)은 쓰지 않는다.

/** 이유 앞머리(`name: 자세한 글`의 name · 또는 통째) → 사람 말. `<쪽>` 은 source · target */
const SIDE = { source: '보내는 쪽', target: '받는 쪽' };
const FIXED = {
  missing_bind_grant: '허가가 없다 — 보내는 쪽 bind.source · 받는 쪽 bind.target 이 모두 있어야 한다',
  flow_not_allowed: '이 자원이 내보낼 수 있는 노드가 아니다 — 노드 허가(흐름 허용 목록)에 없다',
  flow_allow_list_unavailable: '흐름 허용 목록을 읽지 못했다 — 잠시 뒤 다시',
  no_common_qos_profile: '두 끝이 함께 내는 QoS 가 없다',
  grant_revoked: '허가가 철회됐다',
  authorization_lost: '허가를 잃었다',
  participant_disconnected: '한쪽 노드가 끊겼다 — 다시 이어지면 돌아온다',
  participant_closed: '한쪽이 먼저 닫았다',
  source_completed: '보내는 쪽이 끝났다',
  resource_withdrawn: '자원이 철회됐다',
  resource_replaced: '자원이 새로 바뀌었다',
  consumer_requested: '내가 끊었다',
  endpoint_not_chosen: '엔드포인트를 고른다',
  no_node_id: '그 노드의 node_id 를 모른다',
  grants_unreadable: '허가를 읽지 못했다',
  schema_major_mismatch: '형식의 major 버전이 다르다',
  schema_incompatible: '형식이 맞지 않는다',
  compatibility_transform_unavailable: '형식을 바꿔 줄 변환이 없다',
  source_endpoint_not_found: '보내는 쪽 엔드포인트를 찾을 수 없다',
  target_endpoint_not_found: '받는 쪽 엔드포인트를 찾을 수 없다',
  source_resource_not_found: '보내는 쪽 자원을 찾을 수 없다(내 것이 아니거나 사라졌다)',
  target_resource_not_found: '받는 쪽 자원을 찾을 수 없다(내 것이 아니거나 사라졌다)'
};
const SIDED = {
  qos_unsupported: '이 QoS 를 내지 못한다', endpoint_exclusive: '엔드포인트가 이미 쓰이고 있다(단독)', endpoint_consumer_limit: '엔드포인트가 받을 수 있는 수를 넘었다',
  prepare_failed: '준비에 실패했다', commit_failed: '확정에 실패했다', direction_source: '방향이 맞지 않는다(source 가 아니다)', direction_sink: '방향이 맞지 않는다(sink 가 아니다)',
  'missing_bind.source': '이 엔드포인트는 bind.source 를 지원하지 않는다', 'missing_bind.target': '이 엔드포인트는 bind.target 을 지원하지 않는다',
  not_resumable_for_reliable_ordered: 'reliable_ordered 는 이어서 만들 수 있는 자원만 쓴다', resource_unavailable: '자원을 쓸 수 없다', resource_disabled: '자원이 꺼져 있다', resource_unsupported: '지원하지 않는 자원이다',
  unavailable: '쓸 수 없다', disabled: '꺼져 있다', unsupported: '지원하지 않는다'
};

/**
 * 이유 한 줄 → 화면 글. 예: `flow_not_allowed: target node n2 …` → `이 자원이 … — target node n2 …`
 * @param {string} reason
 */
export function reasonLine(reason) {
  const r = String(reason || '').trim();
  if (!r) return '';
  const i = r.indexOf(':'), head = (i < 0 ? r : r.slice(0, i)).trim(), tail = i < 0 ? '' : r.slice(i + 1).trim();
  if (FIXED[head]) return FIXED[head] + (tail ? ' — ' + tail : '');
  const m = /^(source|target)_(.+)$/.exec(head);
  if (m && SIDED[m[2]]) return SIDE[m[1]] + ' ' + SIDED[m[2]] + (tail ? ' — ' + tail : '');
  if (/^compatibility_/.test(head)) return '호환되지 않는다 — ' + r.replace(/^compatibility_/, '');
  return r;
}

const PHASE = {
  draft: '설정 전', invalid: '맞지 않는다', 'needs-grant': '허가 필요', binding: '연결 중', active: '흐르는 중', degraded: '저하', failed: '실패 · 다시 시도 중',
  denied: '거절', closed: '닫혔다', lost: '서버에 없다', shared: '공유됨', 'share-expired': '공유 기한 끝'
};
/** 상태 이름 → 화면 글(설정 창 상태 줄) */
export const phaseLabel = (phase) => PHASE[phase] || phase || '';

/** 상태 → 도로 이벤트(설계 §4.4) — 'run' · 'wait' · 'stop' · 'fail' */
const EVENT = { draft: 'wait', invalid: 'fail', 'needs-grant': 'wait', binding: 'wait', active: 'run', degraded: 'wait', failed: 'fail', denied: 'fail', closed: 'stop', lost: 'stop', shared: 'run', 'share-expired': 'stop' };
export const phaseEvent = (phase) => EVENT[phase] || 'run';
