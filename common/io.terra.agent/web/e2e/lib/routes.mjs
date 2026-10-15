// 경로 표와 핸들러 — api.go 의 operationRoutes 와 각 handler 를 옮긴 것.
// 표(ROUTE_TABLE)는 계약(terra-api.json)·소스(api.go)와 한 줄씩 같아야 하고, server/contract.test.mjs 가 두 쪽에 대조한다.
// 핸들러는 {status, body} 를 돌려주거나 ApiError 를 던진다. 본문 검증은 소스처럼 엄격하다(모르는 필드 400).

import { ApiError, MESSAGES } from './errors.mjs';
import { MODULE_VERSION, answerText } from './engine.mjs';
import { decodeBody, principalOf, queryInt } from './validate.mjs';

export const API_PREFIX = '/api/modules/io.terra.agent/v1';

// [operationId, method, path(prefix 뒤), 필요한 권한(계약 security.permissions) | null]
export const ROUTE_TABLE = [
  ['io.terra.agent.status.get', 'GET', '/status', null, 'status'],
  ['io.terra.agent.credentials.put', 'PUT', '/credentials', 'agent.use', 'credentialPut'],
  ['io.terra.agent.credentials.get', 'GET', '/credentials', 'agent.use', 'credentialGet'],
  ['io.terra.agent.credentials.delete', 'DELETE', '/credentials', 'agent.use', 'credentialDelete'],
  ['io.terra.agent.models.put', 'PUT', '/models/{provider}', 'agent.use', 'modelPut'],
  ['io.terra.agent.models.list', 'GET', '/models', 'agent.use', 'modelList'],
  ['io.terra.agent.models.delete', 'DELETE', '/models/{provider}', 'agent.use', 'modelDelete'],
  ['io.terra.agent.mcp.put', 'PUT', '/mcp/servers/{server}', 'agent.external', 'mcpPut'],
  ['io.terra.agent.mcp.list', 'GET', '/mcp/servers', 'agent.use', 'mcpList'],
  ['io.terra.agent.mcp.delete', 'DELETE', '/mcp/servers/{server}', 'agent.external', 'mcpDelete'],
  ['io.terra.agent.runs.post', 'POST', '/runs', 'agent.use', 'runPost'],
  ['io.terra.agent.sessions.post', 'POST', '/sessions', 'agent.use', 'sessionPost'],
  ['io.terra.agent.sessions.list', 'GET', '/sessions', 'agent.use', 'sessionList'],
  ['io.terra.agent.sessions.get', 'GET', '/sessions/{session_id}', 'agent.use', 'sessionGet'],
  ['io.terra.agent.messages.list', 'GET', '/sessions/{session_id}/messages', 'agent.use', 'messageList'],
  ['io.terra.agent.messages.post', 'POST', '/sessions/{session_id}/messages', 'agent.use', 'messagePost'],
  ['io.terra.agent.messages.stream', 'GET', '/sessions/{session_id}/stream', 'agent.use', 'messageStream'],
  ['io.terra.agent.sessions.cancel', 'POST', '/sessions/{session_id}/cancel', 'agent.use', 'sessionCancel'],
  ['io.terra.agent.approvals.post', 'POST', '/approvals/{request_id}', 'agent.use', 'approvalPost'],
];

const ok = (body, status = 200) => ({ status, body });
const trim = (value) => (typeof value === 'string' ? value.trim() : '');
const SESSION_INPUT = {
  session_id: 'string', prompt: 'string', autonomy: 'string', simulate: 'bool', max_steps: 'int', max_seconds: 'int',
  token_budget: 'int', provider: 'string', topic: 'string', mcp_servers: 'strings',
};
const AUTONOMIES = new Set(['plan', 'ask', 'auto', 'unattended']);

export function createHandlers(engine) {
  const { state } = engine;

  const ownedSession = (req) => {
    const owner = principalOf(req.headers);
    const session = engine.getSession(req.params.session_id);
    if (!session) throw new ApiError('SESSION_NOT_FOUND', MESSAGES.sessionNotFound);
    if (session.meta.owner !== owner) throw new ApiError('SESSION_NOT_OWNED', MESSAGES.notOwner);
    return { session, owner };
  };

  /** sessionInput.options — 검증 문구는 api.go 와 같다. 범위는 계약(최소 1)보다 소스(0 = 기본값)를 따른다. */
  function sessionOptions(input, provider) {
    const autonomy = trim(input.autonomy) || 'plan';
    if (!AUTONOMIES.has(autonomy)) {
      throw new ApiError('INVALID_REQUEST', `unknown autonomy "${input.autonomy}"; expected plan, ask, auto or unattended`);
    }
    const maxSteps = input.max_steps ?? 0;
    if (maxSteps < 0 || maxSteps > 100) throw new ApiError('INVALID_REQUEST', 'max_steps must be between 1 and 100');
    const maxSeconds = input.max_seconds ?? 0;
    if (maxSeconds < 0 || maxSeconds > 7200) throw new ApiError('INVALID_REQUEST', 'max_seconds must be between 1 and 7200');
    const budget = input.token_budget ?? 0;
    if (budget < 0) throw new ApiError('INVALID_REQUEST', 'token_budget cannot be negative');
    return {
      id: input.session_id, autonomy, simulate: !!input.simulate, max_steps: maxSteps, max_seconds: maxSeconds, token_budget: budget,
      provider: provider.name, model: provider.model, topic: trim(input.topic),
      mcp_servers: (input.mcp_servers ?? []).map((n) => n.trim()).filter(Boolean),
    };
  }

  function openedView(session, viewer, created) {
    const m = session.meta;
    return {
      session_id: m.id, viewer, state: m.state, autonomy: m.autonomy, simulate: m.simulate,
      ...(m.provider ? { provider: m.provider } : {}), ...(m.model ? { model: m.model } : {}), created,
    };
  }

  /** 자격 등록의 Gateway 확인(Whoami)을 흉내 낸다 — README 의 "자격 문자열 규칙". */
  function whoami(principal, credential) {
    if (/down/.test(credential)) {
      throw new ApiError('AGENT_UNAVAILABLE', 'could not verify the credential at the Gateway: fake gateway unreachable');
    }
    if (/reject|revoked|expired/.test(credential)) {
      throw new ApiError('CREDENTIAL_REJECTED', 'the Gateway did not accept this credential: fake: revoked or expired');
    }
    if (/person/.test(credential)) {
      throw new ApiError('CREDENTIAL_REJECTED', 'the Gateway did not treat this value as a delegated credential');
    }
    const flags = {};
    if (/unattended-empty/.test(credential)) Object.assign(flags, { unattended: true, pre_approved: [] });
    else if (/unattended/.test(credential)) Object.assign(flags, { unattended: true, pre_approved: ['terra.daemon.modules.by-module-id.restart.post'] });
    if (/readonly/.test(credential)) flags.permissions = ['modules.read'];
    if (/fleet/.test(credential)) flags.reach = 'fleet';
    if (/short/.test(credential)) flags.ttl_ms = 90_000;
    const record = engine.makeCredential(principal, flags);
    record.credential = credential;
    return record;
  }

  const handlers = {
    status() {
      return ok({
        status: state.statusOverride ?? 'ok', version: MODULE_VERSION, sessions: state.sessions.size,
        models_registered: state.providers.size, delegate_door: state.door,
        ...(state.nodeName ? { node_name: state.nodeName } : {}),
      });
    },

    credentialPut(req) {
      const owner = principalOf(req.headers);
      const input = decodeBody(req.raw, { credential: 'string' });
      const credential = trim(input.credential);
      if (!credential.startsWith('tsa_') || credential.length <= 4) {
        throw new ApiError('INVALID_REQUEST', 'credential is required and must be a delegated credential (tsa_…) issued by `terra agent grant`; a user session token is never accepted');
      }
      if (!state.door) throw new ApiError('AGENT_UNAVAILABLE', MESSAGES.noDoor);
      const record = whoami(owner, credential);
      state.credentials.set(owner, record);
      const facts = engine.credentialFacts(record);
      delete facts.expired;
      return ok(facts);
    },

    credentialGet(req) {
      const owner = principalOf(req.headers);
      const record = state.credentials.get(owner);
      return ok(record ? engine.credentialFacts(record) : { registered: false });
    },

    credentialDelete(req) {
      const owner = principalOf(req.headers);
      return ok({ removed: state.credentials.delete(owner) });
    },

    modelPut(req) {
      principalOf(req.headers);
      const name = trim(req.params.provider);
      const input = decodeBody(req.raw, { provider: 'string', api_key: 'string', model: 'string', base_url: 'string', default: 'bool' });
      if (name !== 'anthropic') {
        throw new ApiError('INVALID_REQUEST', `unknown model provider ${JSON.stringify(name)}; this build knows: anthropic`);
      }
      if (trim(input.api_key).length < 8) {
        throw new ApiError('INVALID_REQUEST', 'api_key is required; give it on standard input (--api-key-stdin), never as an argument');
      }
      const config = { provider: name, api_key: trim(input.api_key), model: trim(input.model), base_url: trim(input.base_url) };
      const isDefault = engine.putProvider(config, !!input.default);
      return ok(engine.providerFacts(state.providers.get(name), isDefault)); // 키는 어떤 응답에도 없다(I1)
    },

    modelList() {
      return ok(engine.listProviders());
    },

    modelDelete(req) {
      principalOf(req.headers);
      const name = trim(req.params.provider);
      return ok({ provider: name, removed: engine.deleteProvider(name) });
    },

    mcpPut(req) {
      principalOf(req.headers);
      const name = trim(req.params.server);
      const input = decodeBody(req.raw, { server: 'string', command: 'string', args: 'strings', env: 'strmap', read_only: 'strings' });
      if (!engine.validServerName(name)) {
        throw new ApiError('INVALID_REQUEST', `server name ${JSON.stringify(name)}: letters, digits, '.', '_' and '-' only, at most 64 — it becomes part of the tool name the model sees`);
      }
      if (trim(input.command) === '') {
        throw new ApiError('INVALID_REQUEST', 'command is required: registration runs it to find out what the server offers');
      }
      return ok(engine.putMcp(name, input));
    },

    mcpList() {
      return ok({ servers: engine.listMcp() });
    },

    mcpDelete(req) {
      principalOf(req.headers);
      const name = trim(req.params.server);
      return ok({ name, removed: engine.deleteMcp(name) });
    },

    async runPost(req) {
      const owner = principalOf(req.headers);
      const input = decodeBody(req.raw, SESSION_INPUT);
      if (trim(input.prompt) === '') throw new ApiError('INVALID_REQUEST', 'prompt is required');
      const provider = engine.prepare(owner, input.provider);
      const options = sessionOptions(input, provider);
      engine.allowsUnattended(owner, options.autonomy);
      engine.allowsExternal(options.autonomy, options.mcp_servers);
      options.id = `run-${(++state.counters.id).toString(16).padStart(8, '0')}`;
      const { session } = engine.openSession(options, owner);
      await engine.run(session, input.prompt, provider);
      const view = engine.snapshot(session);
      // 소스는 view["answer"]·view["last_error"] 를 그대로 옮긴다 — 키가 없으면 null 이다(계약은 string).
      return ok({
        session_id: session.meta.id, state: view.state, answer: view.answer ?? null, steps: view.steps,
        entries: engine.entriesAfter(session, 0, 0), usage: view.usage, last_error: view.last_error ?? null,
      });
    },

    sessionPost(req) {
      const owner = principalOf(req.headers);
      const input = decodeBody(req.raw, SESSION_INPUT);
      const existing = engine.getSession(trim(input.session_id));
      if (existing) {
        if (existing.meta.owner !== owner) throw new ApiError('SESSION_NOT_OWNED', MESSAGES.notOwner);
        return ok(openedView(existing, owner, false));
      }
      const provider = engine.prepare(owner, input.provider);
      const options = sessionOptions(input, provider);
      engine.allowsUnattended(owner, options.autonomy);
      engine.allowsExternal(options.autonomy, options.mcp_servers);
      const { session, created } = engine.openSession(options, owner);
      return ok(openedView(session, owner, created));
    },

    sessionList(req) {
      const owner = principalOf(req.headers);
      return ok({ sessions: engine.sessionsOf(owner).map((s) => engine.snapshot(s)) });
    },

    sessionGet(req) {
      const { session } = ownedSession(req);
      return ok(engine.snapshot(session));
    },

    messageList(req) {
      const { session } = ownedSession(req);
      const afterSeq = queryInt(req.url, 'after_seq', 0);
      const limit = queryInt(req.url, 'limit', 500);
      return ok({ session_id: session.meta.id, entries: engine.entriesAfter(session, afterSeq, limit) });
    },

    messagePost(req) {
      const { session, owner } = ownedSession(req);
      const input = decodeBody(req.raw, { session_id: 'string', text: 'string' });
      const text = trim(input.text);
      if (text === '') throw new ApiError('INVALID_REQUEST', 'text is required');
      const answer = answerText(text);
      if (answer && engine.pendingCount(session) > 0) {
        // 함정 6: 승인 대기가 있으면 "y"·"n"·"approve" 는 글이 아니라 승인 답이다 — 줄은 먼저 쌓인다(소스 순서 그대로).
        const line = engine.append(session, { kind: 'user', author: owner, text });
        if (!engine.answerApproval(session, answer.id, answer.approved)) {
          throw new ApiError('APPROVAL_NOT_FOUND', MESSAGES.approvalMissing);
        }
        return ok({ entry: engine.entryView(line) }, 201);
      }
      const provider = engine.prepare(owner, session.meta.provider);
      const line = engine.submit(session, text, owner, provider);
      return ok({ entry: engine.entryView(line) }, 201);
    },

    messageStream(req) {
      const { session } = ownedSession(req);
      return { stream: session };
    },

    sessionCancel(req) {
      const { session } = ownedSession(req);
      engine.cancel(session);
      return ok({ session_id: session.meta.id, state: engine.snapshot(session).state });
    },

    approvalPost(req) {
      const owner = principalOf(req.headers);
      const input = decodeBody(req.raw, { request_id: 'string', deny: 'bool' });
      const requestId = trim(req.params.request_id);
      const session = engine.findApproval(requestId);
      if (!session) throw new ApiError('APPROVAL_NOT_FOUND', MESSAGES.approvalMissing);
      if (session.meta.owner !== owner) throw new ApiError('SESSION_NOT_OWNED', MESSAGES.notOwner);
      const request = engine.answerApproval(session, requestId, !input.deny);
      if (!request) throw new ApiError('APPROVAL_NOT_FOUND', MESSAGES.approvalMissing);
      return ok({
        request_id: requestId, session_id: session.meta.id, operation_id: request.operation_id, decision: input.deny ? 'denied' : 'approved',
      });
    },
  };

  return handlers;
}

/** 경로 템플릿 → 정규식. `{name}` 은 비어 있지 않은 한 세그먼트(Go 1.22 mux 와 같다). */
export function compileRoutes() {
  return ROUTE_TABLE.map(([operationId, method, path, permission, handlerName]) => {
    const names = [];
    const pattern = path.replace(/\{(\w+)\}/g, (_, name) => {
      names.push(name);
      return '([^/]+)';
    });
    return { operationId, method, path, permission, handlerName, regex: new RegExp(`^${API_PREFIX}${pattern}$`), names };
  });
}
