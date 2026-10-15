// Gateway 쪽 규칙(권한 교집합·오류 봉투·주입·토큰), 정적 서빙의 CSP, 셸 브리지 규칙, 스트림, 제어 엔드포인트.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { GATEWAY_ERRORS } from '../lib/errors.mjs';
import { APP_MOUNT, appCsp, createStaticServer } from '../serve.mjs';
import { BRIDGE_PATH_PREFIXES, WEB_APP_SANDBOX, handleBridgeRequest, isTrustedAppMessage } from '../shell-bridge.mjs';
import { API_PREFIX, startAgent, waitState } from './helpers.mjs';

let ctx;
before(async () => {
  ctx = await startAgent();
});
after(async () => ctx?.close());
const begin = async (preset = 'ready') => {
  await ctx.control.reset(preset);
  await ctx.control.config({ model_delay_ms: 5 });
};

test('권한: 계정 권한 ∩ 앱 선언 — 없으면 403 MODULE_PERMISSION_DENIED(실제 Gateway 봉투 {error:{code,message,traceId}}), status.get 은 권한이 필요 없다', async () => {
  await begin();
  const denied = await ctx.api('GET', '/sessions', { principal: 'noperm' });
  assert.equal(denied.status, 403);
  assert.deepEqual(Object.keys(denied.json), ['error'], '실제 Gateway 는 ok·meta 를 싣지 않는다');
  assert.deepEqual(Object.keys(denied.json.error).sort(), ['code', 'message', 'traceId']);
  assert.equal(denied.json.error.code, 'MODULE_PERMISSION_DENIED');
  assert.match(denied.json.error.message, /^호출에 필요한 권한이 없습니다: io\.terra\.agent\.sessions\.list$/);
  assert.match(denied.json.error.traceId, /^trace-/);
  assert.equal((await ctx.api('GET', '/status', { principal: 'noperm' })).status, 200);
  assert.equal((await ctx.api('GET', '/models', { principal: 'noperm' })).status, 403, 'models.list 는 agent.use 가 필요하다(계약)');

  // 앱이 선언한 범위가 좁히기만 한다
  const narrowed = await ctx.api('GET', '/sessions', { headers: { 'x-terra-scope-permissions': 'something.else' } });
  assert.equal(narrowed.json.error.code, 'MODULE_PERMISSION_DENIED');
  assert.equal((await ctx.api('GET', '/sessions', { headers: { 'x-terra-scope-permissions': 'agent.use other' } })).status, 200);
  // agent.external 은 기본 권한이 아니다(I22): alice 는 못 하고, ext 계정도 앱이 agent.use 만 선언하면 못 한다
  const body = { command: 'weather-mcp' };
  assert.equal((await ctx.api('PUT', '/mcp/servers/w', { principal: 'alice', body })).status, 403);
  assert.equal((await ctx.api('PUT', '/mcp/servers/w', { principal: 'ext', body })).status, 200);
  assert.equal((await ctx.api('PUT', '/mcp/servers/w', { principal: 'ext', body, headers: { 'x-terra-scope-permissions': 'agent.use' } })).status, 403);
  await ctx.control.account('carol', ['agent.use']);
  await ctx.control.credential('carol');
  assert.equal((await ctx.api('GET', '/sessions', { principal: 'carol' })).status, 200);
});

test('오류 봉투: 모듈 {error:{code,message}}, Gateway {error:{code,message,traceId}}, 성공은 기본 그대로·선택하면 {ok,data,meta}, 없는 경로·메서드는 404 MODULE_ROUTE_NOT_FOUND(JSON)', async () => {
  await begin();
  const moduleError = await ctx.api('GET', '/sessions/none');
  assert.deepEqual(Object.keys(moduleError.json), ['error']);
  const ok = await ctx.api('GET', '/status', { principal: null });
  assert.deepEqual(Object.keys(ok.json).sort(), ['delegate_door', 'models_registered', 'sessions', 'status', 'version']);
  await ctx.control.config({ envelope: 'gateway' });
  const wrapped = await ctx.api('GET', '/status', { principal: null });
  assert.deepEqual(Object.keys(wrapped.json).sort(), ['data', 'meta', 'ok']);
  assert.equal(wrapped.json.data.version, '0.1.0');
  const stillModuleError = await ctx.api('GET', '/sessions/none');
  assert.deepEqual(Object.keys(stillModuleError.json), ['error'], '모듈의 오류는 감싸지 않는다');
  await ctx.control.config({ envelope: 'bare' });

  const nowhere = await ctx.api('GET', '/nothing-here');
  assert.equal(nowhere.status, 404);
  assert.deepEqual(Object.keys(nowhere.json), ['error']);
  assert.deepEqual([nowhere.json.error.code, Object.keys(nowhere.json.error).sort()], ['MODULE_ROUTE_NOT_FOUND', ['code', 'message', 'traceId']]);
  assert.match(nowhere.json.error.message, /published route를 찾을 수 없습니다: GET .*\/nothing-here$/);
  const wrongMethod = await ctx.api('PATCH', '/status', { principal: null });
  assert.deepEqual([wrongMethod.status, wrongMethod.json.error.code], [404, 'MODULE_ROUTE_NOT_FOUND'], '없는 메서드는 405 가 아니라 404 JSON 이다');
  assert.equal((await fetch(`${ctx.origin}/api/modules/other.module/v1/status`)).status, 404, '다른 모듈의 경로는 이 서버의 몫이 아니다');
});

test('Gateway 오류 7개를 주입할 수 있다 — 코드·상태·retryable', async () => {
  await begin();
  for (const [code, spec] of Object.entries(GATEWAY_ERRORS)) {
    await ctx.control.inject({ op: 'io.terra.agent.status.get' }, { gateway_error: { code } });
    const r = await ctx.api('GET', '/status', { principal: null });
    assert.equal(r.status, spec.status, code);
    assert.deepEqual([r.json.ok, r.json.error.code, r.json.error.retryable], [undefined, code, undefined], `${code}: 서버가 싣지 않으면 retryable 도 없다(앱이 코드별 기본을 쓴다)`);
    assert.match(r.json.error.traceId, /^trace-/, code);
  }
  await ctx.control.inject({ op: 'io.terra.agent.status.get' }, { gateway_error: { code: 'MODULE_INVOCATION_TIMEOUT', status: 504, retryable: false, details: { after_ms: 15000 } } });
  const timeout = await ctx.api('GET', '/status', { principal: null });
  assert.deepEqual([timeout.status, timeout.json.error.retryable, timeout.json.error.details], [504, undefined, { after_ms: 15000 }]);
  await ctx.control.inject({ op: 'io.terra.agent.status.get' }, { gateway_error: { code: 'MODULE_UNAVAILABLE', retryable: true } });
  assert.equal((await ctx.api('GET', '/status', { principal: null })).json.error.retryable, true, 'retryable 은 true 일 때만 싣는다');
  assert.equal((await ctx.api('GET', '/status', { principal: null })).status, 200, '주입은 한 번 쓰고 사라진다');
});

test('주입: 모듈 오류·평문 본문·지연·건너뛰기·횟수·경로 글롭·응답 유실(before/after)·멈춤', async () => {
  await begin();
  await ctx.control.inject({ method: 'GET', path: '/sessions/*' }, { module_error: { code: 'AGENT_UNAVAILABLE', message: '저장소 손상' } }, { skip: 1, times: 2 });
  await ctx.api('POST', '/sessions', { body: { session_id: 'inj' } });
  assert.equal((await ctx.api('GET', '/sessions/inj')).status, 200, 'skip 1');
  const hit = await ctx.api('GET', '/sessions/inj');
  assert.deepEqual([hit.status, hit.json.error], [503, { code: 'AGENT_UNAVAILABLE', message: '저장소 손상' }]);
  assert.equal((await ctx.api('GET', '/sessions/inj')).status, 503, 'times 2');
  assert.equal((await ctx.api('GET', '/sessions/inj')).status, 200);
  assert.equal((await ctx.api('GET', '/sessions')).status, 200, '글롭 /sessions/* 는 /sessions 에 닿지 않는다');

  await ctx.control.inject({ op: 'io.terra.agent.status.get' }, { status: 502, body: '<html>Bad Gateway</html>' });
  const html = await ctx.api('GET', '/status', { principal: null });
  assert.deepEqual([html.status, html.json, html.headers.get('content-type')], [502, undefined, 'text/html']);

  await ctx.control.inject({ op: 'io.terra.agent.status.get' }, { delay_ms: 120 });
  const started = Date.now();
  await ctx.api('GET', '/status', { principal: null });
  assert.ok(Date.now() - started >= 110);

  // 응답 유실: before = 처리 전에 끊김, after = 처리는 됐는데 응답만 잃음(outcomeUnknown)
  await ctx.control.inject({ op: 'io.terra.agent.messages.post' }, { drop: 'before' });
  await assert.rejects(ctx.api('POST', '/sessions/inj/messages', { body: { text: '처리 전에 끊김' } }));
  assert.equal((await ctx.api('GET', '/sessions/inj/messages')).json.entries.length, 0);
  await ctx.control.inject({ op: 'io.terra.agent.messages.post' }, { drop: 'after' });
  await assert.rejects(ctx.api('POST', '/sessions/inj/messages', { body: { text: '처리 후에 끊김' } }));
  assert.equal((await ctx.api('GET', '/sessions/inj/messages')).json.entries[0].text, '처리 후에 끊김');

  await ctx.control.inject({ op: 'io.terra.agent.status.get' }, { hang: true });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  await assert.rejects(fetch(`${ctx.origin}${API_PREFIX}/status`, { signal: controller.signal }), /abort/i);
  assert.deepEqual((await ctx.control.state()).injections, []);
  const seen = await ctx.control.requests('?op=io.terra.agent.messages.post');
  assert.deepEqual(seen.map((r) => [r.status, Boolean(r.injected)]), [[0, true], [0, true]]);
  assert.deepEqual(seen[0].request, { text: '처리 전에 끊김' });
});

test('엄격한 Gateway: 권한 없는 operation(status.get)은 토큰 없음 401 UNAUTHORIZED·무효 토큰 403 MODULE_PERMISSION_DENIED(로그인 필요 문구), 권한 있는 operation 은 둘 다 403 권한 문구, Bearer fake.<이름> 이 호출자이며 X-Terra-Principal 위조는 무시된다', async () => {
  const strict = await startAgent({ strictGateway: true });
  try {
    const call = async (headers) => {
      const r = await fetch(`${strict.origin}${API_PREFIX}/sessions`, { headers });
      return { status: r.status, json: await r.json() };
    };
    const callStatus = async (headers) => {
      const r = await fetch(`${strict.origin}${API_PREFIX}/status`, { headers });
      return { status: r.status, json: await r.json() };
    };
    // 실제 Gateway(server.go admitInvocation): 권한을 선언하지 않은 operation 은 호출자가 누구인지만 묻는다.
    const noToken = await callStatus({});
    assert.deepEqual([noToken.status, noToken.json.error.code], [401, 'UNAUTHORIZED']);
    assert.match(noToken.json.error.message, /로그인한 호출자가 필요합니다: io\.terra\.agent\.status\.get$/);
    for (const authorization of ['Bearer expired', 'Bearer fake.', 'Basic abc']) {
      const bad = await callStatus({ authorization });
      assert.deepEqual([bad.status, bad.json.error.code], [403, 'MODULE_PERMISSION_DENIED'], authorization);
      assert.match(bad.json.error.message, /로그인한 호출자가 필요합니다: io\.terra\.agent\.status\.get$/, authorization);
    }
    // 권한을 선언한 operation 은 호출자가 풀리지 않으면 그냥 권한이 없는 것이다 — 토큰 없음·무효가 진짜 권한 부족과 같은 문구로 온다.
    for (const headers of [{}, { authorization: 'Bearer expired' }]) {
      const none = await call(headers);
      assert.deepEqual([none.status, none.json.error.code], [403, 'MODULE_PERMISSION_DENIED']);
      assert.match(none.json.error.message, /^호출에 필요한 권한이 없습니다: io\.terra\.agent\.sessions\.list$/);
    }
    const forged = await call({ 'x-terra-principal': 'alice' });
    assert.equal(forged.status, 403, '헤더만으로는 호출자가 되지 못한다');
    assert.equal((await call({ authorization: 'Bearer fake.alice' })).status, 200);
    await strict.api('POST', '/sessions', { principal: null, headers: { authorization: 'Bearer fake.bob' }, body: { session_id: 'bobs' } });
    const mine = await fetch(`${strict.origin}${API_PREFIX}/sessions`, { headers: { authorization: 'Bearer fake.alice', 'x-terra-principal': 'bob' } });
    assert.deepEqual((await mine.json()).sessions, [], '토큰의 alice 가 호출자다 — bob 헤더는 무시');
  } finally {
    await strict.close();
  }
});

test('SSE: messages.stream 은 새 줄을 event: entry 로 내보내고 끊으면 구독이 사라진다', async () => {
  await begin();
  await ctx.api('POST', '/sessions', { body: { session_id: 'sse' } });
  const response = await fetch(`${ctx.origin}${API_PREFIX}/sessions/sse/stream`, { headers: { 'x-terra-principal': 'alice' } });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = decoder.decode((await reader.read()).value);
  assert.match(text, /^: connected/);
  await ctx.api('POST', '/sessions/sse/messages', { body: { text: '스트림으로 보인다' } });
  while ((text.match(/event: entry/g) ?? []).length < 3) text += decoder.decode((await reader.read()).value);
  const events = [...text.matchAll(/data: (.*)\n/g)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(events.slice(0, 3).map((e) => [e.event, e.entry.kind]), [['entry', 'user'], ['entry', 'model'], ['entry', 'assistant']]);
  await reader.cancel();
  await waitState(ctx.api, 'sse', 'idle');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const session = ctx.agent.engine.getSession('sse');
  assert.equal(session.subscribers.size, 0);
});

test('제어: 시계·프리셋·설정·기능 스위치·요청 기록', async () => {
  await begin();
  const before = (await ctx.control.call('GET', '/clock')).now_ms;
  const advanced = (await ctx.control.advance(90)).now_ms;
  assert.ok(advanced - before >= 90_000 && advanced - before < 91_000);
  await ctx.control.reset('empty');
  assert.deepEqual([(await ctx.api('GET', '/models', { principal: null })).json.providers, (await ctx.api('GET', '/credentials')).json.registered], [[], false]);
  assert.ok((await ctx.control.call('GET', '/clock')).offset_ms === 0, 'reset 은 시계도 되돌린다');
  await ctx.control.reset('ready');
  assert.equal((await ctx.api('GET', '/status', { principal: null })).json.models_registered, 1);
  await assert.rejects(ctx.control.features({ 없는스위치: true }), /알 수 없는 기능 스위치/);
  await assert.rejects(ctx.control.scenario('없는-시나리오'), /알 수 없는 시나리오/);
  await ctx.control.config({ status_override: 'degraded' });
  assert.equal((await ctx.api('GET', '/status', { principal: null })).json.status, 'degraded');
  const log = await ctx.control.requests();
  assert.ok(log.length > 0 && log.every((r) => typeof r.n === 'number' && 'op' in r));
  const state = await ctx.control.state();
  assert.deepEqual(Object.keys(state.features).sort(), ['contract', 'expires', 'lastErrorCode', 'modelFields', 'reasonJudgement', 'sessionsListUnfiltered']);
});

// ── 정적 서빙(serve.mjs) ──────────────────────────────────────────────
test('정적 서빙: 앱 자산에 plan §5.1 의 CSP 를 그대로 건다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-test-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(root, 'app.js'), 'export {}');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'font.woff2'), 'x');
  const shell = 'http://127.0.0.1:5555';
  const server = createStaticServer({ root, csp: appCsp(shell) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${APP_MOUNT}`;
  try {
    const page = await fetch(`${base}index.html`);
    assert.equal(
      page.headers.get('content-security-policy'),
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors ${shell}`,
    );
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal((await fetch(base)).status, 200, '디렉터리는 index.html');
    assert.equal((await fetch(`${base}app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(`${base}assets/font.woff2`)).headers.get('content-type'), 'font/woff2');
    assert.equal((await fetch(`${base}missing.js`)).status, 404);
    assert.equal((await fetch(`${base}..%2F..%2Fetc%2Fpasswd`)).status, 403);
    assert.equal((await fetch(`${base}index.html`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}index.html`, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/elsewhere`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 셸 브리지 규칙(shell-bridge.mjs) ───────────────────────────────────
test('셸 브리지 규칙: 권한 없음·메서드·경로 거절, 헤더, 본문, 응답 모양, 닿지 못함', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: 'yes' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const app = { id: 'io.terra.agent', permissions: ['agent.use', 'agent.extra'] };
  const run = (message, options = {}) => handleBridgeRequest(message, { gatewayUrl: 'http://gw.test/', app, getToken: () => 'tok', fetchImpl, ...options });

  assert.deepEqual(await run({ method: 'GET', path: '/api/modules/x' }), { type: 'terra.webapp.response', id: '', ok: false, status: 400, error: { code: 'BRIDGE_INVALID_REQUEST', message: 'request id is required' } });
  assert.equal((await run({ id: '1', method: 'GET', path: '/api/modules/x' }, { app: { id: 'a' } })).error.code, 'BRIDGE_NO_PERMISSIONS');
  assert.equal((await run({ id: '1', method: 'GET', path: '/api/modules/x' }, { app: { id: 'a', permissions: [] } })).status, 403);
  assert.deepEqual([(await run({ id: '2', method: 'TRACE', path: '/api/modules/x' })).status, (await run({ id: '2', method: 'TRACE', path: '/api/modules/x' })).error.code], [405, 'BRIDGE_METHOD_NOT_ALLOWED']);
  assert.deepEqual((await run({ id: '3', method: 'GET', path: '/api/v1/gui/apps' })).error.code, 'BRIDGE_PATH_NOT_ALLOWED');
  assert.equal(calls.length, 0, '거절된 요청은 Gateway 로 가지 않는다');
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'put']) assert.equal((await run({ id: method, method, path: '/api/nodes/n1/x' })).ok, true, method);

  calls.length = 0;
  const response = await run({ id: '9', method: 'POST', path: '/api/modules/m/v1/y', body: { a: 1 } });
  assert.deepEqual(response, { type: 'terra.webapp.response', id: '9', ok: true, status: 201, data: { ok: 'yes' } });
  assert.equal(calls[0].url, 'http://gw.test/api/modules/m/v1/y');
  assert.deepEqual(calls[0].init.headers, { Accept: 'application/json', 'X-Terra-Scope-Permissions': 'agent.use agent.extra', Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
  assert.equal(calls[0].init.body, '{"a":1}');
  calls.length = 0;
  await run({ id: 'g', method: 'GET', path: '/api/modules/m', body: { ignored: true } });
  assert.equal(calls[0].init.body, undefined, 'GET 은 본문을 보내지 않는다');
  await run({ id: 'n', method: 'GET', path: '/api/modules/m' }, { getToken: () => undefined });
  assert.equal('Authorization' in calls[1].init.headers, false);

  const empty = await run({ id: 'e', method: 'GET', path: '/api/modules/m' }, { fetchImpl: async () => new Response('not json', { status: 500 }) });
  assert.deepEqual([empty.ok, empty.status, empty.data], [false, 500, undefined]);
  const unreachable = await run({ id: 'u', method: 'GET', path: '/api/modules/m' }, { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual(unreachable, { type: 'terra.webapp.response', id: 'u', ok: false, status: 502, error: { code: 'BRIDGE_GATEWAY_UNREACHABLE', message: 'fetch failed' } });

  assert.deepEqual(BRIDGE_PATH_PREFIXES, ['/api/modules/', '/api/nodes/']);
  assert.equal(WEB_APP_SANDBOX, 'allow-scripts allow-forms allow-same-origin');
  const frame = {};
  assert.equal(isTrustedAppMessage({ origin: 'http://gw.test', source: frame }, 'http://gw.test', frame), true);
  assert.equal(isTrustedAppMessage({ origin: 'http://evil.test', source: frame }, 'http://gw.test', frame), false);
  assert.equal(isTrustedAppMessage({ origin: 'http://gw.test', source: {} }, 'http://gw.test', frame), false);
  assert.equal(isTrustedAppMessage({ origin: 'http://gw.test', source: frame }, '', frame), false);
});

test('standalone 으로 http 서버를 직접 세워도 같다 — 외부 의존이 없다(순수 node:http)', async () => {
  const text = fs.readFileSync(new URL('../fake-agent-server.mjs', import.meta.url), 'utf8');
  const imports = [...text.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.ok(imports.every((name) => name.startsWith('node:') || name.startsWith('./')), `외부 패키지를 불러온다: ${imports}`);
  assert.equal(typeof http.createServer, 'function');
});
