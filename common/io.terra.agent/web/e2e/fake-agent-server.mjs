// 가짜 Gateway + 모듈 서버 — 순수 Node http, 의존 없음.
//
// 한 포트가 둘을 겸한다:
//   · Gateway 쪽  : 권한 교집합(X-Terra-Scope-Permissions ∩ 계정 권한) → 403 MODULE_PERMISSION_DENIED, 오류 주입,
//                   성공 봉투({ok,data,meta}) 선택, 입구 오류(UNAUTHORIZED·QUOTA_EXCEEDED·REQUEST_TOO_LARGE …).
//   · 모듈 쪽     : 계약의 operation 19개를 /api/modules/io.terra.agent/v1/… 경로로(lib/routes.mjs, lib/engine.mjs).
// 모델은 없다 — 시나리오(scenarios/*.mjs)가 "모델의 응답"이다. 제어는 /__control/… (README 참고).
//
// 직접 띄우기:  node e2e/fake-agent-server.mjs --port 4010 [--strict-gateway] [--cors-origin http://127.0.0.1:4011]
//   curl -H 'X-Terra-Principal: alice' http://127.0.0.1:4010/api/modules/io.terra.agent/v1/sessions

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createClock } from './lib/clock.mjs';
import { createEngine, DEFAULT_FEATURES } from './lib/engine.mjs';
import { ApiError, GATEWAY_ERRORS, MODULE_ERRORS, gatewayBody, moduleBody } from './lib/errors.mjs';
import { API_PREFIX, compileRoutes, createHandlers } from './lib/routes.mjs';
import { loadScenarios } from './scenarios/index.mjs';

const MAX_REQUEST_BYTES = 2 << 20; // 이보다 크면 Gateway 가 413 REQUEST_TOO_LARGE 로 막는다(모듈의 1MiB 제한보다 위)
const REDACT = new Set(['api_key', 'credential', 'token']);
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

function redact(raw) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw, (key, value) => {
      if (REDACT.has(key)) return '***';
      // 외부 서버 env 의 값은 그 서버의 비밀이다(R7) — 이름만 남긴다
      if (key === 'env' && value && typeof value === 'object') return Object.fromEntries(Object.keys(value).map((name) => [name, '***']));
      return value;
    });
  } catch {
    return `(JSON 아님 ${raw.length}자)`;
  }
}

function globToRegex(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export async function createFakeAgent(options = {}) {
  const clock = createClock();
  const scenarios = options.scenarios ?? (await loadScenarios());
  const engine = createEngine({ clock, scenarios });
  const handlers = createHandlers(engine);
  const routes = compileRoutes();
  const config = {
    envelope: options.envelope ?? 'bare', // 'bare' | 'gateway'
    strictGateway: options.strictGateway ?? false,
    latencyMs: 0,
    allowOrigin: options.corsOrigin ?? null,
    defaultPermissions: ['agent.use'],
  };
  const accounts = new Map([['noperm', { permissions: [] }], ['ext', { permissions: ['agent.use', 'agent.external'] }]]);
  let injections = [];
  let injectionSeq = 0;
  const log = [];
  let requestSeq = 0;
  const sockets = new Set();

  const ticker = setInterval(() => engine.tick(), 250);
  ticker.unref();

  function send(res, status, body, extraHeaders = {}) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders,
    });
    res.end(payload);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) {
          resolve({ tooLarge: true });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve({ raw: Buffer.concat(chunks).toString('utf8') }));
      req.on('error', reject);
    });
  }

  function cors(req, res) {
    if (!config.allowOrigin) return;
    res.setHeader('access-control-allow-origin', config.allowOrigin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-terra-scope-permissions, x-terra-principal');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }

  // ── 오류 주입 ───────────────────────────────────────────────────────
  function takeInjection(route, method, relPath) {
    for (const injection of injections) {
      const m = injection.match;
      const hit = m.op ? m.op === route.operationId : globToRegex(m.path ?? '**').test(relPath) && (!m.method || m.method === method);
      if (!hit) continue;
      if (injection.skip > 0) {
        injection.skip -= 1;
        continue;
      }
      injection.hits += 1;
      if (Number.isFinite(injection.times)) injection.times -= 1;
      injections = injections.filter((candidate) => candidate.times > 0 || !Number.isFinite(candidate.times));
      return injection;
    }
    return null;
  }

  // ── Gateway 계층 ────────────────────────────────────────────────────
  function resolvePrincipal(headers) {
    const auth = String(headers.authorization ?? '');
    const bearer = /^Bearer fake\.([A-Za-z0-9._-]+)$/.exec(auth);
    if (bearer) return { principal: bearer[1], authenticated: true };
    if (config.strictGateway) return { principal: '', authenticated: false };
    return { principal: String(headers['x-terra-principal'] ?? '').trim(), authenticated: false };
  }

  function grantsOf(principal) {
    return accounts.get(principal)?.permissions ?? config.defaultPermissions;
  }

  function envelopeSuccess(body) {
    if (config.envelope !== 'gateway') return body;
    return { ok: true, data: body, meta: { request_id: `req_${requestSeq}`, module_id: 'io.terra.agent' } };
  }

  async function handleApi(req, res, url) {
    const started = Date.now();
    requestSeq += 1;
    const seq = requestSeq;
    engine.tick();
    const rel = url.pathname.slice(API_PREFIX.length) || '/';
    const entry = { n: seq, at: started, clock_ms: clock.now(), method: req.method, path: url.pathname + url.search, op: null, principal: '', scope: null, request: undefined, status: 0, injected: null };
    log.push(entry);
    if (log.length > 2000) log.shift();
    const finish = (status, body, headers) => {
      entry.status = status;
      send(res, status, body, headers);
    };
    const gatewayFail = (code, message, extra = {}) => finish(extra.status ?? GATEWAY_ERRORS[code]?.status ?? 500, gatewayBody(code, message, { ...extra, requestId: `req_${seq}` }));

    let route;
    let params = {};
    let methodMismatch = false;
    for (const candidate of routes) {
      const match = candidate.regex.exec(url.pathname);
      if (!match) continue;
      if (candidate.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      route = candidate;
      params = Object.fromEntries(candidate.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
      break;
    }
    if (!route) {
      // Go 의 ServeMux 가 내는 평문 — 봉투가 아니다(화면은 UNKNOWN 으로 읽어야 한다).
      if (methodMismatch) return finish(405, 'Method Not Allowed\n', { allow: 'GET, POST, PUT, DELETE' });
      return finish(404, '404 page not found\n');
    }
    entry.op = route.operationId;

    const body = await readBody(req);
    if (body.tooLarge) return gatewayFail('REQUEST_TOO_LARGE', 'the request body is larger than the Gateway accepts');
    entry.request = redact(body.raw);

    const injection = takeInjection(route, req.method, rel);
    const effect = injection?.effect ?? {};
    if (injection) entry.injected = injection.id;
    const delay = (effect.delay_ms ?? 0) + config.latencyMs;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (effect.drop === 'before') return void req.socket.destroy();
    if (effect.hang) return undefined;

    const identity = resolvePrincipal(req.headers);
    if (config.strictGateway && !identity.authenticated) {
      return gatewayFail('UNAUTHORIZED', 'the session is missing or has ended');
    }
    if (effect.gateway_error) {
      const g = effect.gateway_error;
      return gatewayFail(g.code, g.message ?? g.code, { status: g.status, retryable: g.retryable, details: g.details });
    }
    if (effect.status) {
      const text = typeof effect.body === 'string' ? effect.body : JSON.stringify(effect.body ?? {});
      entry.status = effect.status;
      res.writeHead(effect.status, { 'content-type': effect.content_type ?? (typeof effect.body === 'string' ? 'text/html' : 'application/json') });
      return void res.end(text);
    }

    // 권한: 계정 권한 ∩ 앱이 선언해 셸이 실은 범위. 모듈에 닿기 전에 Gateway 가 막는다.
    entry.principal = identity.principal;
    const scopeHeader = req.headers['x-terra-scope-permissions'];
    const scope = typeof scopeHeader === 'string' ? scopeHeader.split(/\s+/).filter(Boolean) : null;
    entry.scope = scope;
    if (route.permission && identity.principal && identity.principal !== 'anonymous') {
      const grants = grantsOf(identity.principal);
      const effective = scope ? grants.filter((p) => scope.includes(p)) : grants;
      if (!effective.includes(route.permission)) {
        return gatewayFail('MODULE_PERMISSION_DENIED', 'permission denied');
      }
    }

    const headers = { ...req.headers, 'x-terra-principal': identity.principal };
    if (!identity.principal) delete headers['x-terra-principal'];

    let result;
    try {
      if (effect.module_error) {
        const e = effect.module_error;
        throw new ApiError(e.code, e.message ?? e.code, e.status);
      }
      result = await handlers[route.handlerName]({ params, url, headers, raw: body.raw });
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (effect.drop === 'after') return void req.socket.destroy();
        return finish(cause.status, moduleBody(cause.code, cause.message));
      }
      console.error('fake agent handler crashed', cause);
      return finish(503, moduleBody('AGENT_UNAVAILABLE', String(cause?.message ?? cause)));
    }

    if (result.stream) return void streamEntries(req, res, entry, result.stream);
    if (effect.drop === 'after') return void req.socket.destroy(); // 처리는 끝났다 — 응답만 잃었다(outcomeUnknown)
    return finish(result.status, envelopeSuccess(result.body));
  }

  function streamEntries(req, res, entry, session) {
    entry.status = 200;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(': connected\n\n');
    const push = (view) => res.write(`event: entry\ndata: ${JSON.stringify({ event: 'entry', entry: view })}\n\n`);
    session.subscribers.add(push);
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15_000);
    res.on('close', () => {
      clearInterval(keepalive);
      session.subscribers.delete(push);
    });
  }

  // ── 제어 ────────────────────────────────────────────────────────────
  async function handleControl(req, res, url) {
    const { raw = '' } = await readBody(req);
    let input = {};
    if (raw) {
      try {
        input = JSON.parse(raw);
      } catch {
        return send(res, 400, { ok: false, error: '제어 본문이 JSON 이 아니다' });
      }
    }
    const route = `${req.method} ${url.pathname.slice('/__control'.length)}`;
    const reply = (extra = {}) => send(res, 200, { ok: true, ...extra });
    try {
      switch (route) {
        case 'GET /health':
          return reply({ clock_ms: clock.now() });
        case 'GET /state':
          return reply({
            clock_ms: clock.now(), clock_offset_ms: clock.offset, sessions: engine.state.sessions.size, config, features: engine.state.features,
            default_scenario: engine.state.defaultScenario, pins: [...engine.state.pins], queue: engine.state.queue, injections,
            door: engine.state.door, model_delay_ms: engine.state.modelDelayMs, call_delay_ms: engine.state.callDelayMs,
            credentials: [...engine.state.credentials.keys()], providers: [...engine.state.providers.keys()], mcp: [...engine.state.mcp.keys()],
            accounts: Object.fromEntries(accounts),
          });
        case 'GET /scenarios':
          return reply({ default: engine.state.defaultScenario, scenarios: scenarios.list() });
        case 'POST /reset':
          injections = [];
          log.length = 0;
          config.envelope = options.envelope ?? 'bare';
          config.latencyMs = 0;
          config.defaultPermissions = ['agent.use'];
          accounts.clear();
          accounts.set('noperm', { permissions: [] });
          accounts.set('ext', { permissions: ['agent.use', 'agent.external'] });
          engine.reset(input.preset ?? 'ready');
          return reply({ preset: input.preset ?? 'ready' });
        case 'POST /scenario': {
          if (!scenarios.get(input.id)) return send(res, 404, { ok: false, error: `알 수 없는 시나리오: ${input.id}`, known: scenarios.ids() });
          if (input.session_id) engine.state.pins.set(input.session_id, { id: input.id, times: input.times ?? Infinity });
          else if (input.queue) for (let i = 0; i < (input.times ?? 1); i += 1) engine.state.queue.push(input.id);
          else engine.state.defaultScenario = input.id;
          return reply({ default: engine.state.defaultScenario });
        }
        case 'GET /clock':
          return reply({ now_ms: clock.now(), offset_ms: clock.offset });
        case 'POST /clock': {
          if (input.reset) clock.reset();
          else clock.advance(input.advance_ms ?? (input.advance_s ?? 0) * 1000);
          engine.tick();
          await settle();
          return reply({ now_ms: clock.now(), offset_ms: clock.offset });
        }
        case 'POST /inject': {
          const injection = { id: `inj-${++injectionSeq}`, match: input.match ?? { path: '**' }, skip: input.skip ?? 0, times: input.times ?? 1, effect: input.effect ?? {}, hits: 0 };
          injections.push(injection);
          return reply({ injection });
        }
        case 'GET /inject':
          return reply({ injections });
        case 'DELETE /inject':
          injections = [];
          return reply();
        case 'GET /requests': {
          const since = Number(url.searchParams.get('since') ?? 0);
          const op = url.searchParams.get('op');
          return reply({ requests: log.filter((r) => r.n > since && (!op || r.op === op)) });
        }
        case 'DELETE /requests':
          log.length = 0;
          return reply();
        case 'GET /calls':
          return reply({ calls: engine.calls });
        case 'GET /sessions':
          return reply({ sessions: [...engine.state.sessions.values()].map((s) => engine.snapshot(s)) });
        case 'POST /restart-module':
          engine.restartModule();
          await settle();
          return reply();
        case 'POST /config': {
          if (input.model_delay_ms !== undefined) engine.state.modelDelayMs = input.model_delay_ms;
          if (input.call_delay_ms !== undefined) engine.state.callDelayMs = input.call_delay_ms;
          if (input.latency_ms !== undefined) config.latencyMs = input.latency_ms;
          if (input.envelope !== undefined) config.envelope = input.envelope;
          if (input.door !== undefined) engine.state.door = !!input.door;
          if (input.strict_gateway !== undefined) config.strictGateway = !!input.strict_gateway;
          if (input.default_permissions !== undefined) config.defaultPermissions = input.default_permissions;
          if ('status_override' in input) engine.state.statusOverride = input.status_override ?? undefined;
          if (input.features) {
            for (const key of Object.keys(input.features)) {
              if (!(key in DEFAULT_FEATURES)) return send(res, 400, { ok: false, error: `알 수 없는 기능 스위치: ${key}`, known: Object.keys(DEFAULT_FEATURES) });
            }
            Object.assign(engine.state.features, input.features);
          }
          return reply({ config, features: engine.state.features });
        }
        case 'POST /accounts':
          accounts.set(input.principal, { permissions: input.permissions ?? [] });
          return reply();
        case 'POST /credential': {
          const { principal, ...flags } = input;
          engine.state.credentials.set(principal, engine.makeCredential(principal, flags));
          return reply({ credential: engine.credentialFacts(engine.state.credentials.get(principal)) });
        }
        case 'DELETE /credential':
          engine.state.credentials.delete(input.principal ?? url.searchParams.get('principal'));
          return reply();
        case 'POST /seed': {
          const scenario = scenarios.get(input.scenario);
          if (!scenario || scenario.kind !== 'seed') return send(res, 404, { ok: false, error: `seed 시나리오가 아니다: ${input.scenario}` });
          const session = scenario.seed(engine, input);
          return reply({ session_id: session.meta.id, entries: session.entries.length });
        }
        default:
          return send(res, 404, { ok: false, error: `제어 경로가 없다: ${route}` });
      }
    } catch (cause) {
      return send(res, 500, { ok: false, error: String(cause?.stack ?? cause) });
    }
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://fake.invalid');
    // 연결을 재사용하지 않는다: 재사용 중인 연결이 응답 없이 끊기면 Chromium 이 요청을 조용히 다시 보내(POST 도) 응답 유실
    // 주입(drop)이 중복 전송이 되어 버린다. 끊는 순간 앱이 실패를 보도록 매 응답에서 연결을 닫는다.
    res.setHeader('connection', 'close');
    cors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return void res.end();
    }
    try {
      if (url.pathname.startsWith('/__control/')) return await handleControl(req, res, url);
      if (url.pathname.startsWith(API_PREFIX)) return await handleApi(req, res, url);
      return send(res, 404, '404 page not found\n');
    } catch (cause) {
      console.error('fake agent crashed', cause);
      if (!res.headersSent) send(res, 500, moduleBody('AGENT_UNAVAILABLE', String(cause?.message ?? cause)));
      return undefined;
    }
  }

  const server = http.createServer((req, res) => void handler(req, res));
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return {
    server, engine, handler, config, scenarios, log, clock, routes,
    accounts,
    get injections() {
      return injections;
    },
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(`http://${host}:${server.address().port}`));
      });
    },
    close() {
      clearInterval(ticker);
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const agent = await createFakeAgent({ strictGateway: argv.includes('--strict-gateway'), corsOrigin: argValue(argv, '--cors-origin') ?? null });
  const origin = await agent.listen(Number(argValue(argv, '--port') ?? 4010));
  console.log(`가짜 Gateway·모듈 서버: ${origin}${API_PREFIX}/status`);
  console.log(`제어: ${origin}/__control/state   시나리오: ${agent.scenarios.ids().join(', ')}`);
  console.log(`오류 코드: 모듈 ${Object.keys(MODULE_ERRORS).length}개 · Gateway ${Object.keys(GATEWAY_ERRORS).length}개`);
}
