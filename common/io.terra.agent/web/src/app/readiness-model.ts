// 화면 1 — 준비 상태를 단계별 안내로 푸는 순수 함수(요구 §6.2 + GAP-2).
// 합성은 data/readiness 의 composeReadiness 가 한다. 여기서는 그 결과를 한국어 안내로 옮길 뿐 다시 판정하지 않는다.
// 위임 자격이 없을 때의 "제안 · 아직 없음"은 C-1(발급과 맡기기를 한 동작으로, 코어 CLI) 전의 표지다(요구 §8.1).

import { describeCode } from '../data/errors';
import type { Readiness, ReadinessBlock, ReadinessStep, StepId, StepStatus } from '../data/readiness';

export type Tone = 'ok' | 'warn' | 'bad' | 'wait';

export interface StepPresentation {
  id: StepId;
  label: string;
  status: StepStatus;
  tone: Tone;
  title: string;
  detail: string;
  /** "제안 · 아직 없음" 같은 짧은 표지. */
  badge?: string;
}

export interface ReadinessPresentation {
  tone: Tone;
  /** 준비 상태 칩의 글자. */
  chip: string;
  headline: string;
  steps: StepPresentation[];
  /** 위임 자격이 없거나 만료돼 "제안 · 아직 없음" 안내를 보인다. */
  delegateProposal: boolean;
  /** 새 세션을 열 수 있는가. 준비가 안 됐으면 이유를 headline 이 말한다. */
  canOpenSession: boolean;
  /** "만료 시각 전 — 폐기 여부는 확인하지 못함". */
  caveat: string | null;
  version: string | null;
}

const LABELS: Record<StepId, string> = {
  module: '모듈',
  permission: '권한',
  door: '위임 관문',
  model: '모델',
  credential: '위임 자격',
  expiry: '만료',
};

export const DELEGATE_PROPOSAL_TEXT =
  '발급과 맡기기를 한 동작으로 하는 길(C-1)이 아직 없습니다. 이 앱은 자격을 발급하지 않고 사실만 읽습니다. 자격이 맡겨지면 이 단계가 저절로 열립니다.';

const MODULE_BLOCK_CODE: Partial<Record<ReadinessBlock, string>> = {
  'module-down': 'MODULE_UNAVAILABLE',
  'session-ended': 'UNAUTHORIZED',
  unreachable: 'NETWORK_ERROR',
  'module-error': 'AGENT_UNAVAILABLE',
};

function toneOf(status: StepStatus): Tone {
  if (status === 'ok') return 'ok';
  if (status === 'warn') return 'warn';
  if (status === 'fail') return 'bad';
  return 'wait';
}

function present(step: ReadinessStep, r: Readiness): StepPresentation {
  const base = { id: step.id, label: LABELS[step.id], status: step.status, tone: toneOf(step.status) };
  const out = (title: string, detail = '', badge?: string): StepPresentation => ({ ...base, title, detail, ...(badge ? { badge } : {}) });
  if (step.status === 'pending') return out('확인하는 중입니다');
  if (step.status === 'skipped') return out('앞 단계를 먼저 해결해 주세요');
  switch (step.id) {
    case 'module': {
      if (step.status === 'fail') {
        const code = MODULE_BLOCK_CODE[step.block ?? 'module-error'] ?? 'AGENT_UNAVAILABLE';
        const info = describeCode(code);
        return out(info.message, '');
      }
      return step.status === 'warn'
        ? out('에이전트 모듈이 답하지만 상태가 좋지 않습니다', r.version ? `io.terra.agent ${r.version}` : '')
        : out('에이전트 모듈이 답합니다', r.version ? `io.terra.agent ${r.version}` : '');
    }
    case 'permission':
      return step.status === 'fail'
        ? out('이 계정에 agent.use 권한이 없습니다', describeCode('MODULE_PERMISSION_DENIED').message)
        : out('agent.use 권한이 있습니다');
    case 'door':
      return step.status === 'fail' ? out('이 노드에는 위임 관문이 없습니다', '읽기만 할 수 있고 새 세션은 열 수 없습니다.') : out('위임 관문이 있습니다');
    case 'model':
      if (step.block === 'models-check-failed') return out('모델 목록을 읽지 못했습니다', '잠시 뒤 다시 확인해 주세요.');
      return step.status === 'fail'
        ? out('등록된 기본 모델이 없습니다', `${describeCode('MODEL_NOT_CONFIGURED').message} 모델 등록 화면은 아직 없습니다(G3).`)
        : out('기본 모델이 등록되어 있습니다');
    case 'credential':
      if (step.block === 'credentials-check-failed') return out('위임 자격을 읽지 못했습니다', '잠시 뒤 다시 확인해 주세요.');
      return step.status === 'fail'
        ? out('위임 자격이 아직 맡겨져 있지 않습니다', DELEGATE_PROPOSAL_TEXT, '제안 · 아직 없음')
        : out('위임 자격이 맡겨져 있습니다', r.caveat ?? '');
    case 'expiry':
      return step.status === 'fail'
        ? out('맡겨 둔 위임 자격이 만료되었습니다', `다시 맡겨 주세요. ${DELEGATE_PROPOSAL_TEXT}`, '제안 · 아직 없음')
        : out('만료되지 않았습니다', r.expiresAt ? `만료 시각 ${r.expiresAt}` : '');
  }
}

export function presentReadiness(r: Readiness | null): ReadinessPresentation {
  if (!r) {
    return { tone: 'wait', chip: '확인 중', headline: '준비 상태를 확인하는 중입니다.', steps: [], delegateProposal: false, canOpenSession: false, caveat: null, version: null };
  }
  const steps = r.steps.map((s) => present(s, r));
  const pending = r.steps.some((s) => s.status === 'pending');
  const delegateProposal = r.blocking === 'no-credential' || r.blocking === 'credential-expired';
  let tone: Tone;
  let chip: string;
  let headline: string;
  if (r.ready) {
    tone = 'ok';
    chip = '준비됨';
    headline = '에이전트를 쓸 준비가 되었습니다.';
  } else if (pending && r.blocking === null) {
    tone = 'wait';
    chip = '확인 중';
    headline = '준비 상태를 확인하는 중입니다.';
  } else {
    tone = 'bad';
    chip = '준비 안 됨';
    const first = steps.find((s) => s.status === 'fail');
    headline = first ? `${first.label}: ${first.title}` : '준비가 끝나지 않았습니다.';
  }
  return { tone, chip, headline, steps, delegateProposal, canOpenSession: r.ready, caveat: r.caveat, version: r.version };
}
