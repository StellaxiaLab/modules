// 가짜 Gateway 카탈로그 — 시나리오의 "모델"이 부르는 operation 들.
// 모양은 모듈이 승인 카드에 싣는 계약 사실(approvalContract, session.go)과 같다:
// 계약이 적지 않은 필드는 **없다**(기본값으로 채우지 않는다 — "적지 않음"과 "없음"은 다른 사실이다, DC-17).
// side_effects·permissions 는 빈 배열이 "계약이 없음이라 적었다"이고, 키가 없는 것이 "적지 않았다"이다.

export const CATALOG = {
  'terra.daemon.modules.list': {
    risk: 'read', confirmation_mode: 'none', idempotency_mode: 'safe', retry_mode: 'safe', output_mode: 'immediate',
    side_effects: [], permissions: ['modules.read'],
    result: { modules: [{ id: 'io.terra.chat', state: 'Running' }, { id: 'io.terra.agent', state: 'Running' }] },
  },
  'terra.daemon.modules.by-module-id.get': {
    risk: 'read', confirmation_mode: 'none', idempotency_mode: 'safe', retry_mode: 'safe', output_mode: 'immediate',
    side_effects: [], permissions: ['modules.read'],
    result: { id: 'io.terra.chat', state: 'Stopped' },
  },
  'terra.daemon.modules.by-module-id.restart.post': {
    risk: 'dangerous', confirmation_mode: 'required', idempotency_mode: 'none', retry_mode: 'never', output_mode: 'accepted-job',
    side_effects: [{ resource_id: 'module', action: 'restart' }], permissions: ['modules.restart'],
    result: { job_id: 'job-0001', accepted: true },
  },
  'terra.files.write': {
    risk: 'write', confirmation_mode: 'none', idempotency_mode: 'none', retry_mode: 'never', output_mode: 'immediate',
    side_effects: [], permissions: ['files.write'],
    result: { written: true },
  },
  'terra.nodes.rebalance.post': {
    // 접수되는 쓰기 — auto 에서는 묻지 않고 돌지만 결과는 "접수"일 뿐이다(접수 ≠ 완료).
    risk: 'write', confirmation_mode: 'none', idempotency_mode: 'key', retry_mode: 'never', output_mode: 'accepted-job',
    side_effects: [{ resource_id: 'node', action: 'rebalance' }], permissions: ['nodes.write'],
    result: { job_id: 'job-0002', accepted: true },
  },
  // 계약이 위험만 적고 나머지는 적지 않은 operation — 승인 카드의 "적지 않음" 표현 시험용.
  'terra.legacy.touch': {
    risk: 'write',
    result: { touched: true },
  },
  // 이 자격의 reach 밖 — 게이트가 거절한다.
  'terra.fleet.nodes.reboot.post': {
    risk: 'dangerous', confirmation_mode: 'required', idempotency_mode: 'none', retry_mode: 'never', output_mode: 'accepted-job',
    side_effects: [{ resource_id: 'node', action: 'reboot' }], permissions: ['fleet.reboot'],
    reach: 'fleet',
    result: { job_id: 'job-9999' },
  },
};

/** 승인 카드에 싣는 계약 사실(approvalContractOf 와 같은 규칙). 카탈로그에 없으면 undefined. */
export function contractFacts(operationId) {
  const op = CATALOG[operationId];
  if (!op) return undefined;
  const facts = {};
  if (op.risk !== undefined) facts.risk = op.risk;
  if (op.confirmation_mode !== undefined) facts.confirmation_mode = op.confirmation_mode;
  if (op.idempotency_mode !== undefined) facts.idempotency_mode = op.idempotency_mode;
  if (op.retry_mode !== undefined) facts.retry_mode = op.retry_mode;
  if (op.output_mode !== undefined) facts.output_mode = op.output_mode;
  if (op.side_effects !== undefined) facts.side_effects = op.side_effects.map((e) => ({ ...e }));
  if (op.permissions !== undefined) facts.permissions = [...op.permissions];
  return facts;
}

/**
 * 모듈의 Decide 한 벌을 흉내 낸다(요구 I5: 화면은 다시 계산하지 않는다 — 이 함수가 "서버의 판정"이다).
 * 반환 {decision: run|confirm|plan|refuse, reason, errorCode?}
 */
export function decide({ autonomy, op, operationId, preApproved = [], reach = 'node' }) {
  if (op.reach === 'fleet' && reach !== 'fleet') {
    return { decision: 'refuse', reason: 'the operation reaches past this credential\'s reach', errorCode: 'TERRA_REACH_EXCEEDED' };
  }
  if (op.risk === 'read') return { decision: 'run', reason: 'read-only operation runs without asking' };
  switch (autonomy) {
    case 'plan':
      return { decision: 'plan', reason: 'autonomy=plan only proposes; nothing runs', errorCode: 'TERRA_APPROVAL_REQUIRED' };
    case 'ask':
      return { decision: 'confirm', reason: `autonomy=ask: every ${op.risk} operation needs a person` };
    case 'auto':
      if (op.risk === 'dangerous') return { decision: 'confirm', reason: 'autonomy=auto still asks for a dangerous operation' };
      return { decision: 'run', reason: 'autonomy=auto runs a write without asking' };
    case 'unattended':
      if (preApproved.includes(operationId)) return { decision: 'run', reason: 'pre-approved for this unattended credential' };
      return { decision: 'refuse', reason: 'nobody is present to ask and the operation is not pre-approved', errorCode: 'TERRA_APPROVAL_REQUIRED' };
    default:
      return { decision: 'refuse', reason: 'unknown autonomy', errorCode: 'TERRA_APPROVAL_REQUIRED' };
  }
}
