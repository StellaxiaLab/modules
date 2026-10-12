// 승인 카드의 한국어 문구 사전 — 화면 코드에 글을 흩어 두지 않는다(요구 §6.5: 언어는 한국어).
// 계약 값(risk·confirmation_mode …)은 계약이 적은 그대로 보인다. 번역하지 않는다 — 번역하면 사실이 아니라 해석이 된다.

export const APPROVAL_TEXT = {
  title: '승인 요청',
  factsHeading: '계약이 말하는 것',
  claimHeading: '모델이 말하는 것',
  claimCaveat: '모델의 주장입니다.',
  claimCaveatBold: '근거가 아닙니다.',
  noReason: '모델이 이유를 적지 않았습니다.',
  judgement: '모듈의 판정 근거',
  /** 계약이 그 칸을 적지 않았다 — "없음"과 다른 사실이다(DC-17). */
  unspecified: '적지 않음',
  /** 적었는데 비어 있다. */
  none: '없음',
  contractUnreadable: '계약 사실을 읽지 못했습니다',
  contractUnreadableHint: '계약이 없는 도구(외부 MCP 도구 등)이거나 모듈이 계약을 싣지 않았습니다. 아래 판정 근거만 읽을 수 있습니다.',
  noJudgement: '(판정 근거도 오지 않았습니다)',
  target: '이 Gateway의 노드',
  acceptedJob: '접수 ≠ 완료',
  inputSummary: '입력 원문',
  inputTruncated: '… (길어서 여기까지만 보입니다)',
  approve: '승인',
  deny: '거부',
  working: '처리 중…',
  gatewayAgain: '승인은 “물어봤다”입니다. Gateway가 다시 판정하므로 승인 뒤에도 거절될 수 있습니다.',
  expired: '마감되었습니다. 모듈이 질문을 닫았는지 새로 읽어 확인하는 중입니다 — 컨트롤은 꺼 두었습니다.',
  clockApprox: '마감 시각을 모듈이 알려 주지 않아 근사한 값입니다. 틀릴 수 있습니다.',
  clockExact: '모듈이 알려 준 마감까지 남은 시간입니다.',
  prevDenied: (n: number) => `이전에 거부한 같은 호출 ${n}회`,
  prevDeniedUnknown: (n: number) => `같은 도구를 거부한 적 ${n}회 — 입력은 비교하지 못했습니다`,
  clockSr: (rem: number): string => {
    if (rem <= 0) return '마감되었습니다';
    if (rem <= 10_000) return '남은 시간 10초 이내';
    if (rem <= 30_000) return '남은 시간 30초 이내';
    if (rem <= 60_000) return '남은 시간 1분 이내';
    return `남은 시간 약 ${Math.ceil(rem / 60_000)}분`;
  },
  rowLabels: { risk: '위험', confirmation: '확인', sideEffects: '부작용', retry: '재시도', idempotency: '멱등', output: '결과', target: '대상' },
  actionLabel: (verb: string, op: string) => `${verb} — ${op}`,
} as const;

/** 위험 값의 색조. 모르는 값은 중립 — 안전하다고 칠하지 않는다. */
export function riskTone(risk: string): 'ok' | 'warn' | 'err' | 'mut' {
  const v = risk.toLowerCase();
  if (v === 'read' || v === 'safe') return 'ok';
  if (v === 'dangerous' || v === 'destructive' || v === 'critical' || v === 'high') return 'err';
  if (v === 'write' || v === 'medium' || v === 'moderate') return 'warn';
  return 'mut';
}
