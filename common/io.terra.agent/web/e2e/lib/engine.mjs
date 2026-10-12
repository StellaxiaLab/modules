// 가짜 모듈의 엔진 — session.go·loop.go·api.go(prepare 등)를 옮긴 상태기계.
//
// 소스를 정본으로 따른다. 줄(entry)의 종류·필드, 상태 전이, 승인 카드, 오류 코드가 모두 그쪽에서 왔고
// 어긋나는 곳은 README 의 "갈라진 곳"에 적는다. 다른 점은 하나다: 모델이 없다 — 시나리오(scenarios/*.mjs)가
// "모델의 응답"을 대신하고, Gateway 호출은 CATALOG 의 가짜 결과를 돌려준다.
//
// 시계는 가짜 시계(lib/clock.mjs)다. 승인 카드의 expires_ms·턴 한도·자격 만료가 모두 그 시계를 따르므로
// 시험이 시계를 앞당겨 5분·30분을 건너뛴다. 실제 시간으로 흐르는 것은 모델·호출 지연(delayMs)뿐이다.

import { CATALOG, contractFacts, decide } from './catalog.mjs';
import { ApiError, MESSAGES } from './errors.mjs';

export const DEFAULT_FEATURES = {
  contract: true, // M-2  승인 카드의 계약 사실
  expires: true, // M-3  승인 카드의 expires_ms
  reasonJudgement: true, // M-4  call 줄의 reason·judgement
  lastErrorCode: true, // M-6  스냅샷의 last_error_code
  modelFields: true, // M-7  model 줄의 provider·model 구조 필드
  sessionsListUnfiltered: false, // R-2 전: 남의 세션이 목록에 섞여 온다
};

export const DEFAULT_MODEL = 'fake-model-1';
export const MODULE_VERSION = '0.1.0';
const TERMINAL = new Set(['done', 'cancelled', 'failed', 'archived']);
const APPROVAL_WAIT_MS = 30 * 60 * 1000; // loop.go approvalTimeout
const DEFAULT_MAX_STEPS = 24;
const MAX_MAX_STEPS = 100;
const DEFAULT_MAX_SECONDS = 900;
const MAX_MAX_SECONDS = 7200;
export const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SERVER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

class TurnAbort extends Error {
  constructor(reason) {
    super(`turn aborted: ${reason}`);
    this.reason = reason;
  }
}

const rfc3339 = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function abortableSleep(ms, signal) {
  if (signal.aborted) return Promise.reject(new TurnAbort(signal.reason));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TurnAbort(signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function topicFrom(text) {
  const first = text.trim().split('\n')[0].trim();
  const runes = [...first];
  return runes.length > 60 ? runes.slice(0, 57).join('') + '…' : first;
}

/** 입력한 "approve [id]" / "deny [id]" 읽기(loop.go answerText). */
export function answerText(text) {
  const fields = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (fields.length === 0 || fields.length > 2) return null;
  let approved;
  if (['approve', 'yes', 'y'].includes(fields[0])) approved = true;
  else if (['deny', 'no', 'n'].includes(fields[0])) approved = false;
  else return null;
  const id = fields.length === 2 ? text.trim().split(/\s+/)[1] : '';
  return { id, approved };
}

export function createEngine({ clock, scenarios }) {
  const state = {
    sessions: new Map(),
    credentials: new Map(),
    providers: new Map(),
    defaultProvider: '',
    mcp: new Map(),
    door: true,
    features: { ...DEFAULT_FEATURES },
    pins: new Map(), // session_id → {id, times}
    queue: [], // 전역 한 번짜리 시나리오 id 들
    defaultScenario: 'read-only-answer',
    modelDelayMs: 250, // step.delayMs 가 없을 때의 모델 지연(실제 시간)
    callDelayMs: 0, // Gateway 호출 지연(실제 시간)
    counters: { trace: 0, id: 0 },
    statusOverride: undefined,
    nodeName: undefined, // status.get 의 node_name — 없으면 키가 없다(이전 모듈·코어 면 없는 호스트)
  };
  const calls = []; // 모델이 부른 operation 의 기록(시험이 본다)

  const nextId = (prefix) => `${prefix}${(++state.counters.id).toString(16).padStart(8, '0')}`;

  // ── 자격 ──────────────────────────────────────────────────────────────
  function makeCredential(principal, flags = {}) {
    const now = clock.now();
    const record = {
      principal,
      credential: `tsa_${principal}_fake`,
      delegate: `delegate-${principal}`,
      permissions: flags.permissions ?? ['modules.read', 'modules.restart', 'nodes.write', 'files.write'],
      reach: flags.reach ?? 'node',
      expires_at: flags.expires_at ?? rfc3339(now + (flags.ttl_ms ?? 8 * 3600 * 1000)),
      unattended: flags.unattended ?? false,
      registered_ms: now,
    };
    if (flags.pre_approved !== undefined) record.pre_approved = [...flags.pre_approved];
    return record;
  }

  function credentialExpired(record) {
    if (!record.expires_at) return false;
    const expiry = Date.parse(record.expires_at);
    return Number.isFinite(expiry) && clock.now() >= expiry;
  }

  function credentialFacts(record) {
    const facts = {
      registered: true,
      principal: record.principal,
      delegate: record.delegate,
      permissions: [...record.permissions],
      reach: record.reach,
      expires_at: record.expires_at,
      expired: credentialExpired(record),
      unattended: record.unattended,
    };
    if (record.pre_approved !== undefined) facts.pre_approved = [...record.pre_approved];
    return facts;
  }

  function credentialSource(principal) {
    const record = state.credentials.get(principal);
    if (!record) throw new ApiError('CREDENTIAL_MISSING', MESSAGES.credentialMissing);
    if (credentialExpired(record)) {
      throw new ApiError('CREDENTIAL_MISSING', `the registered credential for ${principal} expired at ${record.expires_at}; issue a new one with \`terra agent grant\` and register it again`);
    }
    return record;
  }

  // ── 모델 provider ─────────────────────────────────────────────────────
  const sortedProviderNames = () => [...state.providers.keys()].sort();
  const providerFacts = (config, isDefault) => ({
    provider: config.provider, model: config.model, base_url: config.base_url, registered: config.api_key !== '', default: isDefault,
  });

  function putProvider(config, makeDefault) {
    if (config.model.trim() === '') config.model = DEFAULT_MODEL;
    state.providers.set(config.provider, config);
    if (makeDefault || state.defaultProvider === '') state.defaultProvider = config.provider;
    return state.defaultProvider === config.provider;
  }

  function deleteProvider(name) {
    if (!state.providers.has(name)) return false;
    state.providers.delete(name);
    if (state.defaultProvider === name) state.defaultProvider = sortedProviderNames()[0] ?? '';
    return true;
  }

  function listProviders() {
    return {
      default: state.defaultProvider,
      providers: sortedProviderNames().map((name) => providerFacts(state.providers.get(name), name === state.defaultProvider)),
    };
  }

  function resolveProvider(name) {
    let wanted = (name ?? '').trim();
    if (wanted === '') wanted = state.defaultProvider;
    if (wanted === '') throw new ApiError('MODEL_NOT_CONFIGURED', MESSAGES.modelNotConfigured);
    const config = state.providers.get(wanted);
    if (!config || config.api_key === '') {
      throw new ApiError('MODEL_NOT_CONFIGURED', `model provider "${wanted}" is not registered; run \`terra agent model add ${wanted} --api-key-stdin\``);
    }
    return { name: config.provider, model: config.model };
  }

  // ── 외부 MCP 서버 ─────────────────────────────────────────────────────
  const mcpFacts = (config) => ({
    name: config.name,
    command: config.command,
    args: [...config.args],
    env: Object.keys(config.env).sort(),
    // 소스(mcpregistry.go facts)와 계약 모두 tools[] 에 title·description 을 싣는다.
    tools: config.tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, read_only: tool.read_only })),
    registered_ms: config.registered_ms,
  });

  function probeMcp(command) {
    if (/fail|nonexistent|missing/.test(command)) {
      throw new ApiError('MCP_SERVER_FAILED', `start "${command}": executable file not found in $PATH`);
    }
    const offered = command.includes('small') ? ['echo'] : ['echo', 'read_file', 'write_file', 'bad name!'];
    return offered.map((name) => ({ name, title: name.replace(/[_-]/g, ' '), description: `fake external tool ${name}`, read_only: false }));
  }

  function putMcp(name, input) {
    const offered = probeMcp(input.command.trim());
    const kept = offered.filter((tool) => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name));
    const dropped = offered.filter((tool) => !kept.includes(tool)).map((tool) => tool.name);
    const readOnly = (input.read_only ?? []).map((n) => n.trim()).filter(Boolean);
    for (const wanted of readOnly) {
      if (!kept.some((tool) => tool.name === wanted)) {
        throw new ApiError('INVALID_REQUEST', `read_only names a tool the server does not offer: ${wanted}`);
      }
    }
    const config = {
      name,
      command: input.command.trim(),
      args: input.args ?? [],
      env: input.env ?? {},
      tools: kept.map((tool) => ({ ...tool, read_only: readOnly.includes(tool.name) })),
      registered_ms: clock.now(),
    };
    state.mcp.set(name, config);
    const facts = mcpFacts(config);
    if (dropped.length > 0) facts.dropped = dropped;
    return facts;
  }

  const listMcp = () => [...state.mcp.keys()].sort().map((name) => mcpFacts(state.mcp.get(name)));

  // ── 세션 ──────────────────────────────────────────────────────────────
  function getSession(id) {
    return state.sessions.get(id);
  }

  /** 주어진 owner 의 세션 — 소스는 목록을 소유자로 거른다(sessionStore.list). */
  function sessionsOf(owner) {
    const rows = [...state.sessions.values()].filter((s) => state.features.sessionsListUnfiltered || s.meta.owner === owner);
    rows.sort((a, b) => b.meta.created_ms - a.meta.created_ms);
    return rows;
  }

  function openSession(options, owner) {
    const id = (options.id ?? '').trim() || nextId('s-');
    if (!SESSION_ID.test(id)) {
      throw new ApiError('INVALID_REQUEST', `session id "${id}": letters, digits, '.', '_' and '-' only`);
    }
    const existing = state.sessions.get(id);
    if (existing) return { session: existing, created: false };
    let maxSteps = options.max_steps > 0 ? options.max_steps : DEFAULT_MAX_STEPS;
    if (maxSteps > MAX_MAX_STEPS) maxSteps = MAX_MAX_STEPS;
    let maxSeconds = options.max_seconds > 0 ? options.max_seconds : DEFAULT_MAX_SECONDS;
    if (maxSeconds > MAX_MAX_SECONDS) maxSeconds = MAX_MAX_SECONDS;
    const now = clock.now();
    const session = {
      meta: {
        id, topic: options.topic ?? '', state: 'idle', autonomy: options.autonomy, simulate: !!options.simulate,
        provider: options.provider ?? '', model: options.model ?? '', owner,
        steps: 0, max_steps: maxSteps, max_seconds: maxSeconds, token_budget: options.token_budget ?? 0,
        created_ms: now, updated_ms: now, last_error: '', last_error_code: '', answer: '',
        usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
        mcp_servers: [...(options.mcp_servers ?? [])],
      },
      entries: [],
      pending: new Map(),
      order: [],
      subscribers: new Set(),
      busy: false,
      abort: null,
      deadline: 0,
      turns: 0,
    };
    state.sessions.set(id, session);
    return { session, created: true };
  }

  function setState(s, next) {
    s.meta.state = next;
    s.meta.updated_ms = clock.now();
  }

  function append(s, line) {
    const entry = { ...line };
    entry.seq = s.entries.length + 1;
    if (!entry.time_ms) entry.time_ms = clock.now();
    if (!entry.author_label) entry.author_label = entry.author;
    s.entries.push(entry);
    s.meta.updated_ms = entry.time_ms;
    const view = entryView(entry);
    for (const subscriber of s.subscribers) subscriber(view);
    return entry;
  }

  // ── 직렬화(계약의 모양, 소스의 omitempty) ─────────────────────────────
  function entryView(e) {
    const f = state.features;
    const view = { seq: e.seq, kind: e.kind, author: e.author, author_label: e.author_label };
    if (e.text) view.text = e.text;
    view.time_ms = e.time_ms;
    if (e.note) view.note = e.note;
    if (e.subject) view.subject = e.subject;
    if (e.operation_id) view.operation_id = e.operation_id;
    if (e.decision) view.decision = e.decision;
    if (e.status) view.status = e.status;
    if (e.error_code) view.error_code = e.error_code;
    if (e.request_id) view.request_id = e.request_id;
    if (f.reasonJudgement && e.reason) view.reason = e.reason;
    if (f.reasonJudgement && e.judgement) view.judgement = e.judgement;
    if (e.trace_id) view.trace_id = e.trace_id;
    if (e.sent_bytes) view.sent_bytes = e.sent_bytes;
    if (f.modelFields && e.provider) view.provider = e.provider;
    if (f.modelFields && e.model) view.model = e.model;
    if (e.server) view.server = e.server;
    if (e.result_bytes) view.result_bytes = e.result_bytes;
    return view;
  }

  function approvalView(p) {
    const f = state.features;
    const view = { request_id: p.id, operation_id: p.operation_id };
    if (f.reasonJudgement && p.reason) view.reason = p.reason;
    if (f.reasonJudgement && p.judgement) view.judgement = p.judgement;
    if (p.input !== undefined) view.input = p.input;
    view.created_ms = p.created_ms;
    if (f.contract && p.contract) view.contract = p.contract;
    if (f.expires && p.expires_ms) view.expires_ms = p.expires_ms;
    return view;
  }

  function snapshot(s) {
    const m = s.meta;
    const view = { session_id: m.id };
    if (m.topic) view.topic = m.topic;
    view.state = m.state;
    view.autonomy = m.autonomy;
    view.simulate = m.simulate;
    if (m.provider) view.provider = m.provider;
    if (m.model) view.model = m.model;
    view.owner = m.owner;
    view.steps = m.steps;
    view.max_steps = m.max_steps;
    if (m.max_seconds) view.max_seconds = m.max_seconds;
    if (m.token_budget) view.token_budget = m.token_budget;
    view.created_ms = m.created_ms;
    view.updated_ms = m.updated_ms;
    if (m.last_error) view.last_error = m.last_error;
    if (m.last_error_code && state.features.lastErrorCode) view.last_error_code = m.last_error_code;
    if (m.answer) view.answer = m.answer;
    view.usage = { ...m.usage };
    if (m.mcp_servers.length > 0) view.mcp_servers = [...m.mcp_servers];
    view.pending_approvals = s.order.filter((id) => s.pending.has(id)).map((id) => approvalView(s.pending.get(id)));
    return view;
  }

  function entriesAfter(s, afterSeq, limit) {
    const out = [];
    for (const entry of s.entries) {
      if (entry.seq <= afterSeq) continue;
      out.push(entryView(entry));
      if (limit > 0 && out.length >= limit) break;
    }
    return out;
  }

  // ── 승인 ──────────────────────────────────────────────────────────────
  function approvalText(p, request) {
    const lines = [`Approval needed — ${request.operation_id}`, `why a person: ${request.judgement}`];
    if (request.reason && request.reason.trim()) lines.push(`the model says: ${request.reason}`);
    if (request.input !== undefined && JSON.stringify(request.input) !== '{}') lines.push(`input: ${JSON.stringify(request.input)}`);
    lines.push(`answer: approve ${p.id} / deny ${p.id} (or: terra agent approve ${p.id} [--deny])`);
    return lines.join('\n');
  }

  function pendingCount(s) {
    return s.pending.size;
  }

  function removePending(s, id) {
    s.pending.delete(id);
    s.order = s.order.filter((candidate) => candidate !== id);
  }

  /** 가장 오래된(id 가 비면) 또는 지정한 질문에 답한다. 한 번만 된다. */
  function answerApproval(s, id, approved) {
    let target = id;
    if (!target) target = s.order.find((candidate) => s.pending.has(candidate)) ?? '';
    const request = s.pending.get(target);
    if (!request) return null;
    removePending(s, target);
    request.settle({ kind: 'answer', approved });
    return request;
  }

  function findApproval(requestId) {
    for (const s of state.sessions.values()) if (s.pending.has(requestId)) return s;
    return null;
  }

  // ── 턴 ────────────────────────────────────────────────────────────────
  function chooseScenario(s) {
    const pin = state.pins.get(s.meta.id);
    let id;
    if (pin) {
      id = pin.id;
      if (Number.isFinite(pin.times)) {
        pin.times -= 1;
        if (pin.times <= 0) state.pins.delete(s.meta.id);
      }
    } else if (state.queue.length > 0) {
      id = state.queue.shift();
    } else {
      id = state.defaultScenario;
    }
    const scenario = scenarios.get(id);
    if (!scenario) throw new Error(`알 수 없는 시나리오: ${id}`);
    return scenario;
  }

  function nextStep(scenario, rt, s, userText) {
    const ctx = {
      turn: rt.turnNo, step: rt.stepNo, outcomes: rt.outcomes, last: rt.outcomes.at(-1), userText,
      session: { id: s.meta.id, autonomy: s.meta.autonomy, owner: s.meta.owner, simulate: s.meta.simulate },
    };
    if (typeof scenario.steps === 'function') return scenario.steps(ctx) ?? null;
    const steps = scenario.steps ?? [];
    while (rt.pointer < steps.length) {
      const step = steps[rt.pointer++];
      if (step.when === undefined) return step;
      const wanted = Array.isArray(step.when) ? step.when : [step.when];
      if (rt.outcomes.some((o) => wanted.includes(o.kind) || (wanted.includes('approved') && o.approved))) return step;
    }
    return null;
  }

  function promptBytes(s) {
    // 시스템·도구 스키마(상수) + 지금까지의 말. 값 자체보다 "늘어난다"가 요점이다.
    let total = 5200;
    for (const e of s.entries) total += (e.text ?? '').length + (e.kind === 'call' ? 180 : 0);
    return total;
  }

  function toolResultCount(s) {
    return s.entries.filter((e) => e.kind === 'call' && e.status === 'ok').length;
  }

  async function runTurn(s, provider, finish, userText) {
    const ctrl = new AbortController();
    s.abort = ctrl;
    s.turns += 1;
    s.deadline = clock.now() + s.meta.max_seconds * 1000;
    setState(s, 'running');
    const rt = { turnNo: s.turns, stepNo: 0, pointer: 0, outcomes: [] };

    const end = (finalState, failure, code) => {
      s.busy = false;
      s.abort = null;
      if (s.meta.state === 'cancelled') return;
      if (failure) {
        s.meta.last_error = failure;
        s.meta.last_error_code = code;
      }
      if (finish && finalState === 'idle') finalState = 'done';
      setState(s, finalState);
    };

    try {
      const scenario = chooseScenario(s);
      for (let step = 0; step < s.meta.max_steps; step += 1) {
        if (ctrl.signal.aborted) throw new TurnAbort(ctrl.signal.reason);
        const budget = s.meta.token_budget;
        const spent = s.meta.usage.input_tokens + s.meta.usage.output_tokens;
        if (budget > 0 && spent >= budget) {
          const reason = `stopped: this session spent its token budget (${spent} of ${budget})`;
          append(s, { kind: 'error', author: 'terra', text: reason, error_code: 'TOKEN_BUDGET' });
          return end('idle', reason, 'TOKEN_BUDGET');
        }
        rt.stepNo = step + 1;
        const def = nextStep(scenario, rt, s, userText) ?? {};
        const sent = def.sent_bytes ?? promptBytes(s);
        append(s, {
          kind: 'model', author: 'terra', sent_bytes: sent, provider: provider.name, model: provider.model,
          note: `${provider.name}/${provider.model} · ${sent} B · ${toolResultCount(s)} tool result(s) carried`,
        });
        await abortableSleep(def.delayMs ?? state.modelDelayMs, ctrl.signal);
        if (def.fail) {
          const message = def.fail.message ?? 'fake: model provider unreachable';
          append(s, { kind: 'error', author: 'terra', text: `model call failed: ${message}`, error_code: 'MODEL_UNAVAILABLE' });
          return end('failed', message, 'MODEL_UNAVAILABLE');
        }
        s.meta.steps += 1;
        const usage = def.usage ?? { input_tokens: 1200 + 300 * step, output_tokens: 80 + 20 * step };
        for (const key of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']) s.meta.usage[key] += usage[key] ?? 0;
        if (def.text && def.text.trim() !== '') {
          append(s, { kind: 'assistant', author: 'agent', text: def.text });
          s.meta.answer = def.text;
        }
        if (def.refuse) {
          const text = `the model declined to continue${def.refuse.reason ? ` (${def.refuse.reason})` : ''}`;
          append(s, { kind: 'error', author: 'terra', text, error_code: 'MODEL_REFUSED' });
          return end('idle', text, 'MODEL_REFUSED');
        }
        const toolCalls = def.calls ?? [];
        if (toolCalls.length === 0) {
          if (def.truncated) {
            append(s, { kind: 'error', author: 'terra', text: 'the model\'s answer was cut at its token limit', error_code: 'MODEL_TRUNCATED' });
          }
          append(s, {
            kind: 'done', author: 'terra',
            note: `${s.meta.steps} turn(s) · ${s.meta.usage.input_tokens} in / ${s.meta.usage.output_tokens} out tokens`,
          });
          return end('idle', '', '');
        }
        rt.outcomes = [];
        for (const call of toolCalls) {
          const outcome = await executeCall(s, ctrl.signal, call);
          rt.outcomes.push(outcome);
          calls.push({ session_id: s.meta.id, clock_ms: clock.now(), operation_id: call.operation_id ?? call.external?.tool, outcome: outcome.kind, approved: !!outcome.approved, reached: !!outcome.reached });
          if (ctrl.signal.aborted) throw new TurnAbort(ctrl.signal.reason);
        }
      }
      const text = `stopped: the session's limit of ${s.meta.max_steps} model turns was reached`;
      append(s, { kind: 'error', author: 'terra', text, error_code: 'STEP_LIMIT' });
      return end('idle', 'step limit reached', 'STEP_LIMIT');
    } catch (cause) {
      if (!(cause instanceof TurnAbort)) {
        append(s, { kind: 'error', author: 'terra', text: `fake engine failure: ${cause?.stack ?? cause}`, error_code: 'AGENT_UNAVAILABLE' });
        return end('failed', String(cause?.message ?? cause), 'AGENT_UNAVAILABLE');
      }
      if (cause.reason === 'restart') return undefined; // 프로세스가 죽었다 — 아무것도 더 쓰지 않는다
      if (cause.reason === 'time') {
        const text = `stopped: this turn ran past its limit of ${s.meta.max_seconds}s`;
        append(s, { kind: 'error', author: 'terra', text, error_code: 'TIME_LIMIT' });
        return end('idle', text, 'TIME_LIMIT');
      }
      return end('cancelled', '', ''); // cancel — 이미 cancelled 로 바뀌어 있다
    }
  }

  function callEntry(s, call, extra) {
    const entry = {
      kind: 'call', author: 'agent', subject: call.operation_id, operation_id: call.operation_id, reason: call.reason ?? '', ...extra,
    };
    const notes = [entry.decision, entry.status];
    if (entry.error_code) notes.push(entry.error_code);
    if (entry.trace_id) notes.push(`trace=${entry.trace_id}`);
    entry.note = notes.filter(Boolean).join(' · ');
    return append(s, entry);
  }

  async function executeCall(s, signal, call) {
    const owner = s.meta.owner;
    if (call.external) return executeExternal(s, signal, call);
    const operationId = call.operation_id;
    const op = CATALOG[operationId];
    if (!op) {
      callEntry(s, call, { decision: 'run', status: 'error', error_code: 'HTTP_404', judgement: 'no such operation in this Gateway\'s catalog' });
      return { kind: 'error', operation_id: operationId };
    }
    const record = state.credentials.get(owner);
    if (!record || credentialExpired(record)) {
      callEntry(s, call, { decision: 'run', status: 'error', error_code: 'GATEWAY_UNREACHABLE', judgement: 'the delegated credential is gone or expired' });
      return { kind: 'error', operation_id: operationId };
    }
    const verdict = decide({ autonomy: s.meta.autonomy, op, operationId, preApproved: record.pre_approved ?? [], reach: record.reach });
    if (s.meta.simulate) {
      append(s, {
        kind: 'planned', author: 'agent', subject: operationId, operation_id: operationId, decision: verdict.decision, status: 'planned',
        reason: call.reason ?? '', judgement: verdict.reason, note: `${verdict.decision} · planned (simulate: nothing was run)`,
      });
      return { kind: 'planned', operation_id: operationId };
    }
    if (verdict.decision === 'plan' || verdict.decision === 'refuse') {
      callEntry(s, call, { decision: verdict.decision, status: 'refused', error_code: verdict.errorCode, judgement: verdict.reason });
      return { kind: 'refused', operation_id: operationId };
    }

    let approved = false;
    if (verdict.decision === 'confirm') {
      const answer = await askPerson(s, signal, {
        operation_id: operationId, reason: call.reason ?? '', judgement: verdict.reason, input: call.input,
        contract: contractFacts(operationId),
      });
      if (answer.kind === 'denied') {
        callEntry(s, call, { decision: 'confirm', status: 'refused', error_code: 'TERRA_APPROVAL_DENIED', judgement: verdict.reason });
        return { kind: 'denied', operation_id: operationId };
      }
      if (answer.kind === 'silent') {
        callEntry(s, call, { decision: 'confirm', status: 'refused', error_code: 'TERRA_APPROVAL_REQUIRED', judgement: verdict.reason });
        return { kind: 'timeout', operation_id: operationId };
      }
      approved = true;
    }

    await abortableSleep(call.delayMs ?? state.callDelayMs, signal);
    const failed = call.outcome && call.outcome.status === 'error';
    state.counters.trace += 1;
    callEntry(s, call, {
      decision: verdict.decision, status: failed ? 'error' : 'ok', error_code: failed ? call.outcome.error_code ?? 'MODULE_PERMISSION_DENIED' : '',
      judgement: verdict.reason, trace_id: `tr_${state.counters.trace.toString(16).padStart(6, '0')}`,
    });
    return failed ? { kind: 'error', operation_id: operationId, approved, reached: true } : { kind: 'ok', operation_id: operationId, approved, reached: true, result: op.result };
  }

  async function executeExternal(s, signal, call) {
    const { server, tool, result_bytes: resultBytes = 512, read_only: readOnly = false } = call.external;
    const qualified = `mcp__${server}__${tool}`;
    const verdict = decide({
      autonomy: s.meta.autonomy, op: { risk: readOnly ? 'read' : 'write' }, operationId: qualified, preApproved: [],
    });
    const base = { kind: 'external', author: 'agent', subject: qualified, server, reason: call.reason ?? '' };
    if (s.meta.simulate) {
      append(s, { ...base, kind: 'planned', decision: verdict.decision, status: 'planned', judgement: verdict.reason, note: 'planned (simulate: nothing was run)' });
      return { kind: 'planned', operation_id: qualified };
    }
    if (verdict.decision !== 'run' && verdict.decision !== 'confirm') {
      append(s, { ...base, decision: verdict.decision, status: 'refused', error_code: verdict.errorCode, judgement: verdict.reason, note: `${verdict.decision} · refused · ${verdict.errorCode}` });
      return { kind: 'refused', operation_id: qualified };
    }
    let approved = false;
    if (verdict.decision === 'confirm') {
      // 외부 도구에는 Gateway 계약이 없다 — 카드에 contract 가 없다(approvalContractOf 가 nil).
      const answer = await askPerson(s, signal, { operation_id: qualified, reason: call.reason ?? '', judgement: verdict.reason, input: call.input, contract: undefined });
      if (answer.kind !== 'approved') {
        append(s, { ...base, decision: 'confirm', status: 'refused', error_code: answer.kind === 'denied' ? 'TERRA_APPROVAL_DENIED' : 'TERRA_APPROVAL_REQUIRED', judgement: verdict.reason, note: 'confirm · refused' });
        return { kind: answer.kind === 'denied' ? 'denied' : 'timeout', operation_id: qualified };
      }
      approved = true;
    }
    await abortableSleep(call.delayMs ?? state.callDelayMs, signal);
    append(s, {
      ...base, decision: verdict.decision, status: 'ok', judgement: verdict.reason, result_bytes: resultBytes,
      note: `${verdict.decision} · ok · external · ${resultBytes} B · no gateway audit`,
    });
    return { kind: 'ok', operation_id: qualified, approved, reached: true };
  }

  /**
   * 사람에게 묻는다(loop.go approver). 반환 {kind:'approved'|'denied'|'silent'}.
   * 한도(턴 deadline)나 취소로 끊기면 TurnAbort 를 던진다 — 이때 denied 줄은 **없다**(함정 7: 만료 카드는 entry 가 아니다).
   */
  async function askPerson(s, signal, request) {
    const asked = clock.now();
    const left = s.deadline - asked;
    const span = Math.max(0, Math.min(APPROVAL_WAIT_MS, left));
    const pending = {
      id: nextId('apr_'), operation_id: request.operation_id, reason: request.reason, judgement: request.judgement,
      input: request.input, created_ms: asked, contract: request.contract, expires_ms: asked + span, waitExpiresMs: asked + APPROVAL_WAIT_MS,
    };
    const answered = new Promise((resolve) => {
      pending.settle = resolve;
    });
    s.pending.set(pending.id, pending);
    s.order.push(pending.id);
    setState(s, 'waiting-approval');
    append(s, {
      kind: 'approval', author: 'terra', request_id: pending.id, subject: request.operation_id, operation_id: request.operation_id,
      decision: 'confirm', note: request.judgement, text: approvalText(pending, request),
    });

    let aborted;
    const onAbort = () => {
      aborted = new TurnAbort(signal.reason);
      pending.settle({ kind: 'aborted' });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.timeout = () => pending.settle({ kind: 'silent' });
    let result;
    try {
      result = await answered;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (result.kind === 'aborted') {
      removePending(s, pending.id);
      throw aborted;
    }
    if (result.kind === 'closed') throw new TurnAbort('cancel'); // 취소가 질문을 닫았다
    if (result.kind === 'silent') {
      removePending(s, pending.id);
      append(s, { kind: 'denied', author: 'terra', request_id: pending.id, subject: request.operation_id, note: 'no answer within 30m0s' });
      return { kind: 'silent' };
    }
    if (s.meta.state === 'waiting-approval') setState(s, 'running');
    append(s, {
      kind: result.approved ? 'approved' : 'denied', author: 'terra', request_id: pending.id, subject: request.operation_id, operation_id: request.operation_id,
    });
    return { kind: result.approved ? 'approved' : 'denied' };
  }

  // ── 밖에서 부르는 동작 ────────────────────────────────────────────────
  /** loop.go prepare: 자격과 모델이 갖춰졌는지. 세션이 생기기 전에 실패해야 반쯤 만들어진 세션이 안 남는다. */
  function prepare(owner, providerName) {
    credentialSource(owner);
    return resolveProvider(providerName);
  }

  function allowsUnattended(owner, autonomy) {
    if (autonomy !== 'unattended') return;
    const record = state.credentials.get(owner);
    if (!record) throw new ApiError('CREDENTIAL_MISSING', MESSAGES.credentialMissing);
    if (!record.unattended) {
      throw new ApiError('CREDENTIAL_NOT_UNATTENDED', 'this credential was not issued to run unattended; a session with nobody to ask needs one from `terra agent grant --unattended --pre-approve <operation-id>`');
    }
    if (!record.pre_approved || record.pre_approved.length === 0) {
      throw new ApiError('CREDENTIAL_NOT_UNATTENDED', 'this unattended credential pre-approves nothing, so the session could only read; reissue it with --pre-approve <operation-id> for each operation that may run');
    }
  }

  function allowsExternal(autonomy, names) {
    if (!names || names.length === 0) return;
    if (autonomy === 'unattended') throw new ApiError('MCP_UNATTENDED_CONFLICT', MESSAGES.mcpUnattended);
    for (const name of names) {
      if (!state.mcp.has(name.trim())) throw new ApiError('MCP_SERVER_UNKNOWN', `${MESSAGES.mcpUnknown}: ${name.trim()}`);
    }
  }

  function submit(s, text, authorLabel, provider) {
    if (TERMINAL.has(s.meta.state)) throw new ApiError('SESSION_FINISHED', MESSAGES.finished);
    if (s.busy) throw new ApiError('SESSION_BUSY', MESSAGES.busy);
    s.busy = true;
    const line = append(s, { kind: 'user', author: s.meta.owner, author_label: authorLabel, text });
    if (s.meta.topic.trim() === '') s.meta.topic = topicFrom(text);
    runTurn(s, provider, false, text).catch((cause) => console.error('fake engine turn crashed', cause));
    return line;
  }

  async function run(s, text, provider) {
    s.busy = true;
    append(s, { kind: 'user', author: s.meta.owner, text });
    if (s.meta.topic.trim() === '') s.meta.topic = topicFrom(text);
    await runTurn(s, provider, true, text);
  }

  function cancel(s) {
    for (const id of [...s.order]) {
      const request = s.pending.get(id);
      if (request) {
        removePending(s, id);
        request.settle({ kind: 'closed' });
      }
    }
    const wasBusy = s.busy;
    const controller = s.abort;
    setState(s, 'cancelled');
    append(s, { kind: 'cancelled', author: 'terra' });
    if (controller && wasBusy) controller.abort('cancel');
  }

  /** 시계가 앞서 갔을 때 만료를 처리한다. 요청마다·주기적으로·시계를 건드릴 때 부른다. */
  function tick() {
    const now = clock.now();
    for (const s of state.sessions.values()) {
      if (!s.busy || !s.abort || s.abort.signal.aborted) continue;
      if (now >= s.deadline) {
        s.abort.abort('time');
        continue;
      }
      for (const pending of s.pending.values()) if (now >= pending.waitExpiresMs) pending.timeout?.();
    }
  }

  /** 모듈 재시작: 끝나지 않은 세션은 모두 archived(함정 4). 자격·모델·MCP 등록은 디스크에 있어 남는다. */
  function restartModule() {
    for (const s of state.sessions.values()) {
      const controller = s.abort;
      s.busy = false;
      s.abort = null;
      for (const id of [...s.order]) removePending(s, id);
      if (controller && !controller.signal.aborted) controller.abort('restart');
      if (!['done', 'cancelled', 'failed'].includes(s.meta.state)) setState(s, 'archived');
      s.subscribers.clear();
    }
  }

  /** 긴 기록 같은 "이미 쌓여 있는 세션"을 만든다(시나리오의 seed). */
  function seedSession({ id, owner, entries = 1200, autonomy = 'plan', finalState = 'idle', topic = '긴 기록 세션' }) {
    const provider = resolveProvider('');
    const { session } = openSession({ id, autonomy, provider: provider.name, model: provider.model, topic }, owner);
    if (session.entries.length > 0) return session;
    const base = clock.now() - entries * 4000;
    let t = base;
    let turn = 0;
    while (session.entries.length < entries) {
      turn += 1;
      t += 4000;
      append(session, { kind: 'user', author: owner, author_label: owner, text: `${turn}번째 질문입니다`, time_ms: t });
      append(session, { kind: 'model', author: 'terra', sent_bytes: 5200 + turn * 40, provider: provider.name, model: provider.model, time_ms: t + 1000, note: `${provider.name}/${provider.model} · ${5200 + turn * 40} B · ${turn - 1} tool result(s) carried` });
      append(session, { kind: 'call', author: 'agent', subject: 'terra.daemon.modules.list', operation_id: 'terra.daemon.modules.list', decision: 'run', status: 'ok', trace_id: `tr_${turn.toString(16).padStart(6, '0')}`, reason: '모듈 목록을 확인합니다', judgement: 'read-only operation runs without asking', time_ms: t + 2000, note: `run · ok · trace=tr_${turn.toString(16).padStart(6, '0')}` });
      append(session, { kind: 'assistant', author: 'agent', text: `${turn}번째 답변입니다`, time_ms: t + 3000 });
      append(session, { kind: 'done', author: 'terra', time_ms: t + 3500, note: `${turn} turn(s) · ${turn * 1200} in / ${turn * 80} out tokens` });
    }
    session.entries.length = entries;
    session.meta.steps = turn;
    session.meta.usage = { input_tokens: turn * 1200, output_tokens: turn * 80, cache_read_tokens: 0, cache_write_tokens: 0 };
    session.meta.answer = `${turn}번째 답변입니다`;
    session.meta.created_ms = base;
    setState(session, finalState);
    return session;
  }

  // ── 초기화 ────────────────────────────────────────────────────────────
  function reset(preset = 'ready') {
    for (const s of state.sessions.values()) s.abort?.abort('restart');
    state.sessions.clear();
    state.credentials.clear();
    state.providers.clear();
    state.defaultProvider = '';
    state.mcp.clear();
    state.pins.clear();
    state.queue.length = 0;
    state.defaultScenario = 'read-only-answer';
    state.door = true;
    state.features = { ...DEFAULT_FEATURES };
    state.statusOverride = undefined;
    state.nodeName = undefined;
    state.modelDelayMs = 250;
    state.callDelayMs = 0;
    state.counters = { trace: 0, id: 0 };
    calls.length = 0;
    clock.reset();
    const withModel = !['empty', 'no-model'].includes(preset);
    const withCredential = !['empty', 'no-credential'].includes(preset);
    if (withModel) putProvider({ provider: 'anthropic', api_key: 'fake-key-0000', model: DEFAULT_MODEL, base_url: '' }, true);
    if (withCredential) {
      for (const who of ['alice', 'bob']) {
        let flags = {};
        if (preset === 'expired-credential' && who === 'alice') flags = { expires_at: rfc3339(clock.now() - 60_000) };
        if (preset === 'unattended-credential' && who === 'alice') {
          flags = { unattended: true, pre_approved: ['terra.daemon.modules.by-module-id.restart.post'] };
        }
        state.credentials.set(who, makeCredential(who, flags));
      }
    }
  }

  reset('ready');

  return {
    state, calls, reset, tick, prepare, allowsUnattended, allowsExternal, submit, run, cancel, restartModule, seedSession,
    getSession, sessionsOf, openSession, snapshot, entriesAfter, entryView, pendingCount, answerApproval, findApproval, append,
    makeCredential, credentialFacts, credentialSource, putProvider, deleteProvider, listProviders, providerFacts, putMcp, listMcp,
    mcpFacts, rfc3339, validServerName: (name) => SERVER_NAME.test(name), sleepFor,
    deleteMcp: (name) => state.mcp.delete(name),
  };
}
