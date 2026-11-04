// 설정 화면(화면 6, G3)의 데이터 — 읽기 전용. 화면 없이 도는 순수 함수다.
//
// 응답을 화면 모델로 옮길 때 **허용 목록**으로만 옮긴다(I1·I19): 계약이 약속한 칸만 읽고 나머지는 버린다.
// 서버가 계약을 어기고 키·자격 문자열·env 값을 실어 보내도 이 층을 지나면 사라진다 — tests/settings-data.test.ts 가 못 박는다.
// 모델 이름·명령·인자 같은 글은 모두 글자로만 그려지므로(I7) 여기서는 모양만 고른다.

import {
  DEFAULT_MAX_SECONDS,
  DEFAULT_MAX_STEPS,
  MAX_SECONDS_RANGE,
  MAX_STEPS_RANGE,
} from '../api/client';
import type { CredentialFacts, McpListResponse, ModelsListResponse, SessionSnapshot } from '../api/types';
import { isTerminal } from './status';

const isString = (value: unknown): value is string => typeof value === 'string';
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);

// ── 모델 ────────────────────────────────────────────────────────────────

export interface ModelRow {
  provider: string;
  model: string;
  /** 보여도 되는 모양으로 다듬은 주소. 기본 주소(빈 값)면 null. */
  baseUrl: string | null;
  /** 주소의 일부(사용자 정보·쿼리·해시)를 가렸는가. */
  baseUrlMasked: boolean;
  registered: boolean;
  isDefault: boolean;
}

export interface ModelsView {
  rows: ModelRow[];
  defaultProvider: string | null;
}

/**
 * base_url 은 프롬프트가 가는 도착지다(보드 ④ 경고). 주소에 키가 실려 있을 수 있어
 * 사용자 정보(user:pw@)·쿼리·해시는 버리고 `원점 + 경로`만 보인다. 주소로 읽을 수 없으면 통째로 가린다.
 */
export function safeBaseUrl(raw: unknown): { text: string; masked: boolean } | null {
  if (!isString(raw) || raw.trim() === '') return null;
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { text: '(주소 형식이 아님 — 표시하지 않음)', masked: true };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { text: '(주소 형식이 아님 — 표시하지 않음)', masked: true };
  const path = url.pathname === '/' ? '' : url.pathname;
  const masked = url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '';
  return { text: `${url.protocol}//${url.host}${path}`, masked };
}

export function modelsView(data: ModelsListResponse): ModelsView {
  const defaultProvider = isString(data?.default) && data.default !== '' ? data.default : null;
  const list = Array.isArray(data?.providers) ? data.providers : [];
  const rows: ModelRow[] = [];
  for (const p of list) {
    if (p === null || typeof p !== 'object' || !isString(p.provider) || p.provider === '') continue;
    const url = safeBaseUrl(p.base_url);
    rows.push({
      provider: p.provider,
      model: isString(p.model) ? p.model : '',
      baseUrl: url?.text ?? null,
      baseUrlMasked: url?.masked ?? false,
      registered: p.registered === true,
      isDefault: p.default === true || p.provider === defaultProvider,
    });
  }
  return { rows, defaultProvider };
}

// ── 자격 ────────────────────────────────────────────────────────────────

export type CredentialState = 'none' | 'active' | 'expired';

export interface CredentialView {
  state: CredentialState;
  principal: string | null;
  /** 보이는 대리인 id(`agent:agn_…` 그대로). 명령에 안전한 글자가 아니면 null — 알아볼 수 없는 글은 화면에 올리지 않는다. */
  delegate: string | null;
  /** 서버가 대리인 id 를 줬지만 알아볼 수 없는 모양이었다(그래서 폐기 명령을 만들지 못한다). */
  delegateUnreadable: boolean;
  /** `agent:` 를 뗀 id — 폐기 명령에 쓴다. 명령에 안전한 글자가 아니면 null. */
  delegateId: string | null;
  permissions: string[];
  reach: string | null;
  expiresAt: string | null;
  expiresAtMs: number | null;
  unattended: boolean;
  preApproved: string[];
}

/** `terra agent revoke <id>` 의 id 로 쓸 수 있는 모양. 사람이 셸에 붙여넣는 글이므로 좁게 잡는다. */
const DELEGATE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function delegateIdOf(delegate: unknown): string | null {
  if (!isString(delegate)) return null;
  const id = delegate.startsWith('agent:') ? delegate.slice('agent:'.length) : delegate;
  return DELEGATE_ID.test(id) ? id : null;
}

export function revokeCommand(delegateId: string | null): string | null {
  return delegateId === null ? null : `terra agent revoke ${delegateId}`;
}

export function credentialView(data: CredentialFacts): CredentialView {
  if (data?.registered !== true) {
    return { state: 'none', principal: null, delegate: null, delegateUnreadable: false, delegateId: null, permissions: [], reach: null, expiresAt: null, expiresAtMs: null, unattended: false, preApproved: [] };
  }
  const expiresAt = isString(data.expires_at) && data.expires_at !== '' ? data.expires_at : null;
  const parsed = expiresAt === null ? Number.NaN : Date.parse(expiresAt);
  const delegateId = delegateIdOf(data.delegate);
  const hasDelegate = isString(data.delegate) && data.delegate !== '';
  return {
    state: data.expired === true ? 'expired' : 'active',
    principal: isString(data.principal) && data.principal !== '' ? data.principal : null,
    delegate: delegateId !== null && isString(data.delegate) ? data.delegate : null,
    delegateUnreadable: hasDelegate && delegateId === null,
    delegateId,
    permissions: strings(data.permissions),
    reach: isString(data.reach) && data.reach !== '' ? data.reach : null,
    expiresAt,
    expiresAtMs: Number.isFinite(parsed) ? parsed : null,
    unattended: data.unattended === true,
    preApproved: strings(data.pre_approved),
  };
}

/**
 * 만료까지 남은 시간. 양수일 때만 말한다 — 서버 시계와 이 브라우저의 시계가 어긋날 수 있으므로,
 * 지났다고 앱이 스스로 "만료됨"이라 단정하지 않는다(만료 판정은 서버의 `expired` 다).
 */
export function expiryText(view: Pick<CredentialView, 'expiresAtMs'>, nowMs: number): string {
  if (view.expiresAtMs === null) return '';
  const left = view.expiresAtMs - nowMs;
  if (!(left > 0)) return '';
  if (left < 60_000) return '1분 안';
  const minutes = Math.floor(left / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}일 ${hours % 24}시간 뒤`;
  if (hours > 0) return rest > 0 ? `${hours}시간 ${rest}분 뒤` : `${hours}시간 뒤`;
  return `${rest}분 뒤`;
}

// ── MCP ─────────────────────────────────────────────────────────────────

export interface McpRow {
  name: string;
  /** 명령 + 인자(셸을 거치지 않는 한 줄 표시용). 비밀처럼 보이는 인자의 값은 가렸다. */
  commandLine: string;
  /** 환경 변수의 **이름**뿐이다. 값은 어떤 응답에도 없고(I19) 여기에도 없다. */
  envNames: string[];
  tools: number;
  readOnly: number;
  dropped: number;
}

const SECRET_FLAG = /(token|secret|key|pass(word|wd)?|credential|auth|bearer)/i;

/**
 * 인자 중 `--token=값`·`--api-key 값` 꼴의 값을 가린다. 계약은 args 에 비밀이 없다고 하지만(등록은 env 로),
 * 사람이 인자에 키를 넣은 서버가 있을 수 있어 알아볼 수 있는 것만 막는다. 위치 인자까지는 알아볼 수 없다.
 */
function maskArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    const eq = arg.startsWith('-') ? arg.indexOf('=') : -1;
    if (eq > 0 && SECRET_FLAG.test(arg.slice(0, eq))) {
      out.push(`${arg.slice(0, eq)}=…`);
    } else if (arg.startsWith('-') && eq < 0 && SECRET_FLAG.test(arg)) {
      out.push(arg);
      if (i + 1 < args.length && !(args[i + 1] as string).startsWith('-')) {
        out.push('…');
        i += 1;
      }
    } else {
      out.push(arg);
    }
  }
  return out;
}

function envNamesOf(env: unknown): string[] {
  if (Array.isArray(env)) return env.filter(isString);
  if (env !== null && typeof env === 'object') return Object.keys(env as Record<string, unknown>); // 값 지도로 와도 이름만
  return [];
}

export function mcpView(data: McpListResponse): McpRow[] {
  const servers = Array.isArray(data?.servers) ? data.servers : [];
  const rows: McpRow[] = [];
  for (const server of servers) {
    if (server === null || typeof server !== 'object' || !isString(server.name) || server.name === '') continue;
    const tools = Array.isArray(server.tools) ? server.tools.filter((tool) => tool !== null && typeof tool === 'object') : [];
    rows.push({
      name: server.name,
      commandLine: [isString(server.command) ? server.command : '', ...maskArgs(strings(server.args))].filter((part) => part !== '').join(' '),
      envNames: envNamesOf(server.env),
      tools: tools.length,
      readOnly: tools.filter((tool) => tool.read_only === true).length,
      dropped: strings(server.dropped).length,
    });
  }
  return rows;
}

// ── 한도 기본값 · 열린 세션 ─────────────────────────────────────────────

/** 새 세션 폼이 채워 보이는 모듈 기본값(session.go). 이 화면은 보기만 한다. */
export const LIMIT_DEFAULTS = {
  maxSteps: DEFAULT_MAX_STEPS,
  maxSeconds: DEFAULT_MAX_SECONDS,
  /** 기본은 제한 없음. */
  tokenBudget: null as number | null,
  stepsRange: { ...MAX_STEPS_RANGE },
  secondsRange: { ...MAX_SECONDS_RANGE },
} as const;

/** 아직 끝나지 않은 세션(idle 포함 — 모듈이 재시작하면 archived 가 된다). 반드시 소유자 필터를 거친 목록을 넘긴다. */
export function openSessions(owned: readonly SessionSnapshot[]): SessionSnapshot[] {
  return owned.filter((session) => !isTerminal(session.state));
}
