// 새 세션 폼의 값과 검증 (GAP-9, 보드 ⑤). 화면 없이 도는 순수 함수다.
// 보낼 칸은 "기본과 다른 것"만이다 — 기본값은 모듈이 정하므로 생략하면 모듈의 기본이 적용된다(D-7: 자율성만 항상 싣는다).
// 숫자 칸은 글자로 받아 직접 읽는다: 정수 글자(숫자만)가 아니면 거절하고, 범위는 계약(sessions.post 입력)과 같다.

import { DEFAULT_MAX_SECONDS, DEFAULT_MAX_STEPS, MAX_SECONDS_RANGE, MAX_STEPS_RANGE, TOPIC_MAX_CHARS, charLength } from '../api/client';
import type { Autonomy, OpenSessionInput } from '../api/types';

/** 자율성 중 지금 열 수 있는 것. unattended 는 G4 까지 닫혀 있다(무인 자격·사전 승인 화면이 서기 전). */
export const OPENABLE_AUTONOMIES: readonly Autonomy[] = ['plan', 'ask', 'auto'];
export const UNATTENDED_OFF_REASON = '무인 세션은 G4에서 열립니다';

export interface NewSessionValues {
  topic: string;
  autonomy: Autonomy;
  simulate: boolean;
  /** provider 이름. 모델 목록을 못 읽었으면 ''. */
  provider: string;
  mcp: readonly string[];
  maxSteps: string;
  maxSeconds: string;
  tokenBudget: string;
}

export interface ProviderChoice {
  provider: string;
  model: string;
  default: boolean;
}

export interface NewSessionContext {
  /** 고를 수 있는(등록된) provider. 목록을 못 읽었으면 null. */
  providers: readonly ProviderChoice[] | null;
  defaultProvider: string | null;
  /** 등록된 외부 MCP 서버 이름(목록 순서). 목록을 못 읽었으면 null. */
  mcpNames: readonly string[] | null;
}

export type FieldKey = 'topic' | 'autonomy' | 'provider' | 'mcp' | 'maxSteps' | 'maxSeconds' | 'tokenBudget';
/** 화면에 나오는 순서 — 오류가 여럿이면 앞선 칸으로 초점을 보낸다. */
export const FIELD_ORDER: readonly FieldKey[] = ['topic', 'autonomy', 'provider', 'mcp', 'maxSteps', 'maxSeconds', 'tokenBudget'];

export type NewSessionInput = Omit<OpenSessionInput, 'session_id'>;
export type ValidationResult = { ok: true; input: NewSessionInput } | { ok: false; errors: Partial<Record<FieldKey, string>>; first: FieldKey };

export function defaultValues(ctx: NewSessionContext): NewSessionValues {
  return {
    topic: '',
    autonomy: 'plan',
    simulate: false,
    provider: ctx.defaultProvider ?? '',
    mcp: [],
    maxSteps: String(DEFAULT_MAX_STEPS),
    maxSeconds: String(DEFAULT_MAX_SECONDS),
    tokenBudget: '',
  };
}

type Parsed = { ok: true; value: number | null } | { ok: false };

/** 숫자만 있는 글을 정수로 읽는다. 빈 글은 null(기본·무제한). */
function parseCount(text: string, max: number): Parsed {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  if (!/^[0-9]+$/.test(t)) return { ok: false };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n > max) return { ok: false };
  return { ok: true, value: n };
}

export function validateNewSession(values: NewSessionValues, ctx: NewSessionContext): ValidationResult {
  const errors: Partial<Record<FieldKey, string>> = {};
  const input: NewSessionInput = { autonomy: values.autonomy };

  const topic = values.topic.trim();
  if (charLength(topic) > TOPIC_MAX_CHARS) errors.topic = `제목은 ${TOPIC_MAX_CHARS}자 이하로 적어 주세요.`;
  else if (topic !== '') input.topic = topic;

  if (!OPENABLE_AUTONOMIES.includes(values.autonomy)) errors.autonomy = `${values.autonomy}: ${UNATTENDED_OFF_REASON}`;

  if (ctx.providers !== null && values.provider !== '') {
    if (!ctx.providers.some((p) => p.provider === values.provider)) errors.provider = '등록된 모델 provider 에서 골라 주세요.';
    else if (values.provider !== ctx.defaultProvider) input.provider = values.provider;
  }

  const wanted = new Set(values.mcp);
  if (wanted.size > 0) {
    const known = ctx.mcpNames;
    const unknown = known === null ? [] : [...wanted].filter((n) => !known.includes(n));
    if (values.autonomy === 'unattended') errors.mcp = '무인 세션은 외부 MCP 서버와 함께 열 수 없습니다. 서버를 빼거나 자율성을 바꿔 주세요.';
    else if (unknown.length > 0) errors.mcp = `등록되지 않은 서버입니다: ${unknown.join(', ')}`;
    else input.mcp_servers = known === null ? [...wanted] : known.filter((n) => wanted.has(n));
  }

  const steps = parseCount(values.maxSteps, MAX_STEPS_RANGE.max);
  if (!steps.ok || (steps.value !== null && steps.value < MAX_STEPS_RANGE.min)) errors.maxSteps = `${MAX_STEPS_RANGE.min}~${MAX_STEPS_RANGE.max} 의 정수로 적어 주세요.`;
  else if (steps.value !== null && steps.value !== DEFAULT_MAX_STEPS) input.max_steps = steps.value;

  const seconds = parseCount(values.maxSeconds, MAX_SECONDS_RANGE.max);
  if (!seconds.ok || (seconds.value !== null && seconds.value < MAX_SECONDS_RANGE.min)) errors.maxSeconds = `${MAX_SECONDS_RANGE.min}~${MAX_SECONDS_RANGE.max} 의 정수로 적어 주세요.`;
  else if (seconds.value !== null && seconds.value !== DEFAULT_MAX_SECONDS) input.max_seconds = seconds.value;

  const tokens = parseCount(values.tokenBudget, Number.MAX_SAFE_INTEGER);
  if (!tokens.ok || tokens.value === 0) errors.tokenBudget = '1 이상의 정수로 적어 주세요. 비우면 제한이 없습니다.';
  else if (tokens.value !== null) input.token_budget = tokens.value;

  if (values.simulate) input.simulate = true;

  const first = FIELD_ORDER.find((k) => errors[k] !== undefined);
  if (first !== undefined) return { ok: false, errors, first };
  return { ok: true, input };
}
