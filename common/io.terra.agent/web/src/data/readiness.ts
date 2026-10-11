// 준비 상태 합성 (요구 §6.2 + GAP-2).
// ready = delegate_door ∧ credentials.registered ∧ ¬expired ∧ 기본 provider registered — status.get 에는 사람별 자격도
// 기본 provider 도 없으므로 세 호출(status.get · models.list · credentials.get)을 클라이언트에서 합성한다.
//
// GAP-2 권한 없음: 기존 계정은 agent.use 를 소급 받지 않았다. status.get 만 권한 없이 되고 나머지는 403 MODULE_PERMISSION_DENIED 다
// (권한 부족과 reach 밖이 같은 문구). 그래서 "모듈이 답한다"(1) 다음에 "권한이 있다"를 두고, 거기서 막히면 나머지는 판정하지 않는다.
// 단계 6(폐기·Gateway 재시작)은 알 수 없다(R-10) — 준비가 돼도 caveat 로 그렇게 적는다.

import type { CallResult } from '../api/client';
import type { CredentialFacts, ModelsListResponse, ModuleStatus } from '../api/types';

export interface ReadinessInput {
  status?: CallResult<ModuleStatus>;
  models?: CallResult<ModelsListResponse>;
  credentials?: CallResult<CredentialFacts>;
}

export type StepId = 'module' | 'permission' | 'door' | 'model' | 'credential' | 'expiry';
export type StepStatus = 'ok' | 'warn' | 'fail' | 'pending' | 'skipped';
export type ReadinessBlock =
  | 'module-down'
  | 'session-ended'
  | 'unreachable'
  | 'module-error'
  | 'no-permission'
  | 'no-door'
  | 'no-model'
  | 'models-check-failed'
  | 'no-credential'
  | 'credentials-check-failed'
  | 'credential-expired';

export interface ReadinessStep {
  id: StepId;
  status: StepStatus;
  block?: ReadinessBlock;
}

export interface Readiness {
  ready: boolean;
  /** 가장 앞선 실패. 없으면 null(모두 통과했거나 아직 못 읽은 단계가 있다). */
  blocking: ReadinessBlock | null;
  steps: ReadinessStep[];
  /** 위임 관문이 없으면 읽기만 허용. */
  readOnly: boolean;
  /** 자격이 있고 만료 전일 때: "폐기 여부는 확인하지 못함". */
  caveat: string | null;
  /** 자격의 principal — 소유자 필터의 viewer 가 된다. 자격이 없으면 null. */
  viewer: string | null;
  expiresAt: string | null;
  version: string | null;
}

const PERMISSION_CODES: ReadonlySet<string> = new Set(['MODULE_PERMISSION_DENIED', 'BRIDGE_NO_PERMISSIONS']);
export const CREDENTIAL_CAVEAT = '만료 시각 전 — 폐기 여부는 확인하지 못함';

const isPermissionDenied = (r: CallResult<unknown> | undefined): boolean => r !== undefined && !r.ok && r.code !== undefined && PERMISSION_CODES.has(r.code);

function moduleBlock(status: Extract<CallResult<ModuleStatus>, { ok: false }>): ReadinessBlock {
  if (status.code === 'MODULE_UNAVAILABLE') return 'module-down';
  if (status.status === 401 || status.code === 'UNAUTHORIZED') return 'session-ended';
  if (status.status === 0 || status.code === undefined) return 'unreachable';
  return 'module-error';
}

export function composeReadiness(input: ReadinessInput): Readiness {
  const { status, models, credentials } = input;
  const steps: ReadinessStep[] = [];
  const push = (id: StepId, st: StepStatus, block?: ReadinessBlock): void => {
    steps.push(block ? { id, status: st, block } : { id, status: st });
  };

  // 1. 모듈이 답한다 — status.get 은 권한 없이도 된다.
  let moduleOk = false;
  if (!status) push('module', 'pending');
  else if (!status.ok) push('module', 'fail', moduleBlock(status));
  else {
    moduleOk = true;
    push('module', status.data.status === 'degraded' ? 'warn' : 'ok');
  }
  if (!moduleOk) {
    for (const id of ['permission', 'door', 'model', 'credential', 'expiry'] as const) push(id, status ? 'skipped' : 'pending');
    return finish(steps, status, credentials);
  }

  // GAP-2. 권한 — models.list·credentials.get 이 agent.use 를 요구한다.
  const denied = isPermissionDenied(models) || isPermissionDenied(credentials);
  if (denied) push('permission', 'fail', 'no-permission');
  else if (!models && !credentials) push('permission', 'pending');
  else push('permission', 'ok');

  // 2. 위임 관문.
  if (status?.ok && status.data.delegate_door === true) push('door', 'ok');
  else push('door', 'fail', 'no-door');

  // 3. 모델 / 4. 자격 / 5. 만료.
  if (denied) {
    push('model', 'skipped');
    push('credential', 'skipped');
    push('expiry', 'skipped');
  } else {
    if (!models) push('model', 'pending');
    else if (!models.ok) push('model', 'fail', 'models-check-failed');
    else push('model', defaultProviderRegistered(models.data) ? 'ok' : 'fail', defaultProviderRegistered(models.data) ? undefined : 'no-model');

    if (!credentials) {
      push('credential', 'pending');
      push('expiry', 'pending');
    } else if (!credentials.ok) {
      push('credential', 'fail', 'credentials-check-failed');
      push('expiry', 'skipped');
    } else if (!credentials.data.registered) {
      push('credential', 'fail', 'no-credential');
      push('expiry', 'skipped');
    } else {
      push('credential', 'ok');
      if (credentials.data.expired === true) push('expiry', 'fail', 'credential-expired');
      else push('expiry', 'ok');
    }
  }
  return finish(steps, status, credentials);
}

function defaultProviderRegistered(models: ModelsListResponse): boolean {
  const providers = Array.isArray(models.providers) ? models.providers : [];
  return providers.some((p) => p.registered && (p.default || p.provider === models.default));
}

function finish(steps: ReadinessStep[], status: CallResult<ModuleStatus> | undefined, credentials: CallResult<CredentialFacts> | undefined): Readiness {
  const firstFail = steps.find((s) => s.status === 'fail');
  const ready = steps.every((s) => s.status === 'ok' || s.status === 'warn');
  const creds = credentials?.ok && credentials.data.registered ? credentials.data : null;
  return {
    ready,
    blocking: firstFail?.block ?? null,
    steps,
    readOnly: steps.some((s) => s.id === 'door' && s.status === 'fail'),
    caveat: creds && creds.expired !== true ? CREDENTIAL_CAVEAT : null,
    viewer: creds?.principal ?? null,
    expiresAt: creds?.expires_at ?? null,
    version: status?.ok ? status.data.version : null,
  };
}
