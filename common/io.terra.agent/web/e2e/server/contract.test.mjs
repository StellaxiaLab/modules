// 가짜 서버가 계약·소스와 갈라지지 않았는지 대조하는 시험 — 가짜 서버의 존재 이유를 지키는 시험이다.
//   1. 계약의 operation 19개가 모두 구현되어 있다(경로·메서드·권한이 계약과 한 줄씩 같다)
//   2. api.go 의 operationRoutes 표와 같다(계약과 소스가 서로 어긋나면 여기서 먼저 보인다)
//   3. 성공 응답이 계약의 output 스키마에 맞다 — 소스가 계약과 다른 곳은 KNOWN_DIVERGENCES 에 이유와 함께 적고,
//      그 갈라짐이 사라지면(고쳐지면) 이 시험이 "목록에서 빼라"고 실패한다
//   4. 계약의 입력 예시를 그대로 보내면 받아들인다(모르는 필드 400 이 없다)
//   5. 오류 코드 15개의 상태·재시도 가능이 계약과 같고, 15개 모두 실제로 발생시킬 수 있다

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MODULE_ERRORS } from '../lib/errors.mjs';
import { ROUTE_TABLE } from '../lib/routes.mjs';
import { validate } from '../lib/schema.mjs';
import { API_PREFIX, startAgent, waitState } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = path.resolve(HERE, '..', '..', '..'); // common/io.terra.agent
const contract = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'contracts', 'api', 'terra-api.json'), 'utf8'));
const apiGo = fs.readFileSync(path.join(MODULE_DIR, 'src', 'api.go'), 'utf8');
const OPERATIONS = Object.entries(contract.operations);

let ctx;
before(async () => {
  ctx = await startAgent();
});
after(async () => ctx?.close());

/** 소스(api.go)가 계약과 다르게 답하는 곳 — 소스를 정본으로 따른다. 항목마다 한 번은 실제로 관찰되어야 한다. */
const KNOWN_DIVERGENCES = [
  { op: 'runs.post', at: /^\/(answer|last_error)$/, kind: 'type', why: 'api.go runPost 가 view["answer"]·view["last_error"] 를 그대로 옮겨, 비어 있으면 키가 없어 null 이 된다(계약은 string)' },
];

test('계약의 operation 19개가 모두 구현되어 있고 경로·메서드·권한이 계약과 같다', () => {
  assert.equal(OPERATIONS.length, 19);
  assert.equal(ROUTE_TABLE.length, 19);
  const table = new Map(ROUTE_TABLE.map(([id, method, rel, permission]) => [id, { method, path: API_PREFIX + rel, permission }]));
  for (const [id, operation] of OPERATIONS) {
    const route = table.get(id);
    assert.ok(route, `${id} 가 가짜 서버 경로 표에 없다`);
    const [binding] = operation.bindings;
    assert.equal(route.method, binding.method, `${id} 메서드`);
    assert.equal(route.path, binding.path, `${id} 경로`);
    const permissions = operation.security?.permissions ?? [];
    assert.deepEqual(route.permission ? [route.permission] : [], permissions, `${id} 권한`);
  }
  for (const id of table.keys()) assert.ok(contract.operations[id], `${id} 는 계약에 없는 operation 이다`);
});

test('api.go 의 operationRoutes 표와 한 줄씩 같다', () => {
  const rows = [...apiGo.matchAll(/\{"(io\.terra\.agent\.[a-z.]+)",\s*"([A-Z]+)",\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]} ${API_PREFIX}${m[3]}`);
  assert.equal(rows.length, 19, 'api.go 에서 읽은 경로 수');
  const ours = ROUTE_TABLE.map(([id, method, rel]) => `${id} ${method} ${API_PREFIX}${rel}`);
  assert.deepEqual([...ours].sort(), [...rows].sort());
});

test('모듈 오류 15개의 상태·retryable 이 계약과 같고 코드 집합이 같다', () => {
  assert.deepEqual(Object.keys(MODULE_ERRORS).sort(), Object.keys(contract.errors).sort());
  assert.equal(Object.keys(contract.errors).length, 15);
  for (const [code, spec] of Object.entries(contract.errors)) {
    assert.equal(MODULE_ERRORS[code].status, spec.httpStatus, `${code} httpStatus`);
    assert.equal(MODULE_ERRORS[code].retryable, spec.retryable, `${code} retryable`);
  }
});

test('모든 operation 의 성공 응답이 계약 output 스키마에 맞다(알려진 갈라짐만 예외)', async () => {
  const { api, control } = ctx;
  await control.reset('ready');
  await control.scenario('read-only-answer');
  const seen = new Map(); // op → 응답 본문들
  const record = (op, response, status = 200) => {
    assert.equal(response.status, status, `${op}: ${response.status} ${response.text}`);
    seen.set(op, [...(seen.get(op) ?? []), response.json]);
    return response;
  };

  record('status.get', await api('GET', '/status', { principal: null }));
  record('credentials.get', await api('GET', '/credentials'));
  record('credentials.put', await api('PUT', '/credentials', { principal: 'carol', body: { credential: 'tsa_carol_unattended' } }));
  record('credentials.get', await api('GET', '/credentials', { principal: 'carol' }));
  record('credentials.get', await api('GET', '/credentials', { principal: 'dave' })); // registered:false
  record('credentials.delete', await api('DELETE', '/credentials', { principal: 'carol' }));
  record('models.put', await api('PUT', '/models/anthropic', { body: { provider: 'anthropic', api_key: 'sk-example-key-0000', model: 'example-model', default: true } }));
  record('models.list', await api('GET', '/models', { principal: null }));
  record('models.delete', await api('DELETE', '/models/anthropic'));
  record('models.put', await api('PUT', '/models/anthropic', { body: { api_key: 'sk-example-key-0000' } }));
  record('mcp.put', await api('PUT', '/mcp/servers/weather', { principal: 'ext', body: { command: '/usr/local/bin/weather-mcp', args: ['--stdio'], env: { TOKEN: 'x' }, read_only: ['read_file'] } }));
  record('mcp.list', await api('GET', '/mcp/servers', { principal: null }));

  record('sessions.post', await api('POST', '/sessions', { body: { session_id: 'c1', autonomy: 'ask', topic: '계약 대조', mcp_servers: ['weather'] } }));
  record('sessions.post', await api('POST', '/sessions', { body: { session_id: 'c1' } })); // 멱등 — created:false
  record('sessions.list', await api('GET', '/sessions'));
  record('sessions.get', await api('GET', '/sessions/c1'));
  record('messages.post', await api('POST', '/sessions/c1/messages', { body: { text: '모듈 목록을 보여 줘' } }), 201);
  await waitState(api, 'c1', 'idle');
  record('messages.list', await api('GET', '/sessions/c1/messages'));
  record('sessions.get', await api('GET', '/sessions/c1'));

  // 승인 카드(pending_approvals 의 스키마)와 approvals.post
  await control.scenario('approval-flow');
  await api('POST', '/sessions/c1/messages', { body: { text: '다시 시작' } });
  const waiting = await waitState(api, 'c1', 'waiting-approval');
  record('sessions.get', await api('GET', '/sessions/c1'));
  record('sessions.list', await api('GET', '/sessions'));
  record('approvals.post', await api('POST', `/approvals/${waiting.pending_approvals[0].request_id}`, { body: {} }));
  await waitState(api, 'c1', 'idle');
  record('messages.list', await api('GET', '/sessions/c1/messages'));
  record('sessions.cancel', await api('POST', '/sessions/c1/cancel'));
  record('runs.post', await api('POST', '/runs', { body: { prompt: '모듈 상태를 보여 줘' } }));
  record('mcp.delete', await api('DELETE', '/mcp/servers/weather', { principal: 'ext' }));

  // messages.stream — 첫 이벤트의 모양
  await control.scenario('read-only-answer');
  await api('POST', '/sessions', { body: { session_id: 'c2' } });
  const stream = await fetch(`${ctx.origin}${API_PREFIX}/sessions/c2/stream`, { headers: { 'x-terra-principal': 'alice' } });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reader = stream.body.getReader();
  await api('POST', '/sessions/c2/messages', { body: { text: '스트림' } });
  let text = '';
  while (!text.includes('event: entry')) text += new TextDecoder().decode((await reader.read()).value);
  const data = JSON.parse(/data: (.*)\n/.exec(text)[1]);
  await reader.cancel();
  seen.set('messages.stream', [data]);

  const observed = new Set();
  for (const [id, operation] of OPERATIONS) {
    const short = id.replace('io.terra.agent.', '');
    const bodies = seen.get(short);
    assert.ok(bodies?.length, `${short} 의 성공 응답을 한 번도 보지 못했다 — 이 시험의 흐름에 추가한다`);
    for (const body of bodies) {
      for (const error of validate(operation.output.schema, body)) {
        const known = KNOWN_DIVERGENCES.findIndex((d) => d.op === short && d.kind === error.kind && d.at.test(error.at));
        if (known === -1) assert.fail(`${short}: 계약 output 스키마 위반 ${error.at} (${error.kind}) ${error.message}`);
        observed.add(known);
      }
    }
  }
  KNOWN_DIVERGENCES.forEach((d, index) => assert.ok(observed.has(index), `알려진 갈라짐이 더는 관찰되지 않는다 — 목록에서 뺀다: ${d.op} ${d.why}`));
});

test('계약의 입력 예시를 그대로 보내면 받아들인다(모르는 필드 400 이 없다)', async () => {
  const { api, control } = ctx;
  await control.reset('ready');
  for (const [id, operation] of OPERATIONS) {
    const [binding] = operation.bindings;
    for (const example of operation.input.examples ?? []) {
      let rel = binding.path.slice(API_PREFIX.length);
      const rest = { ...example.value };
      rel = rel.replace(/\{(\w+)\}/g, (_, name) => {
        const value = rest[name];
        delete rest[name];
        return encodeURIComponent(value);
      });
      const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(binding.method);
      const query = !hasBody && Object.keys(rest).length ? `?${new URLSearchParams(rest)}` : '';
      // 스트림은 열려 있는 채로 끝나지 않으므로 경로만 확인한다
      if (id.endsWith('messages.stream')) continue;
      const response = await api(binding.method, rel + query, { body: hasBody && Object.keys(rest).length ? rest : undefined });
      const unknownField = response.status === 400 && /unknown field/.test(response.json?.error?.message ?? '');
      assert.equal(unknownField, false, `${id} ${example.name ?? ''}: ${response.text}`);
      assert.ok(response.status !== 404 || response.json?.error, `${id}: 경로가 없는 것처럼 답했다 ${response.text}`);
    }
  }
});

// ── 오류 코드 15개를 실제로 발생시킬 수 있다 ───────────────────────────
// 자연 발생(HTTP 요청만으로) 14개, 주입 1개(MODEL_UNAVAILABLE: 소스는 HTTP 로 내지 않는다 — 요구 §6.4. 기록의 error 줄로만 온다).
const PROVOKE = {
  async INVALID_REQUEST({ api }) { return api('POST', '/sessions', { body: { nope: 1 } }); },
  async SESSION_NOT_OWNED({ api }) { await api('POST', '/sessions', { body: { session_id: 'own1' } }); return api('GET', '/sessions/own1', { principal: 'bob' }); },
  async CREDENTIAL_NOT_UNATTENDED({ api }) { return api('POST', '/sessions', { body: { autonomy: 'unattended' } }); },
  async CREDENTIAL_REJECTED({ api }) { return api('PUT', '/credentials', { body: { credential: 'tsa_rejected_value' } }); },
  async SESSION_NOT_FOUND({ api }) { return api('GET', '/sessions/no-such-session'); },
  async APPROVAL_NOT_FOUND({ api }) { return api('POST', '/approvals/apr_nope', { body: {} }); },
  async MCP_SERVER_UNKNOWN({ api }) { return api('POST', '/sessions', { body: { mcp_servers: ['nobody'] } }); },
  async SESSION_BUSY({ api, control }) {
    await control.scenario('slow-model');
    await api('POST', '/sessions', { body: { session_id: 'busy1' } });
    await api('POST', '/sessions/busy1/messages', { body: { text: 'a' } });
    return api('POST', '/sessions/busy1/messages', { body: { text: 'b' } });
  },
  async SESSION_FINISHED({ api }) { await api('POST', '/sessions', { body: { session_id: 'fin1' } }); await api('POST', '/sessions/fin1/cancel'); return api('POST', '/sessions/fin1/messages', { body: { text: 'x' } }); },
  async CREDENTIAL_MISSING({ api }) { return api('POST', '/sessions', { principal: 'carol', body: {} }); },
  async MODEL_NOT_CONFIGURED({ api, control }) { await control.reset('no-model'); return api('POST', '/sessions', { body: {} }); },
  async MCP_UNATTENDED_CONFLICT({ api, control }) { await control.reset('unattended-credential'); return api('POST', '/sessions', { body: { autonomy: 'unattended', mcp_servers: ['x'] } }); },
  async MCP_SERVER_FAILED({ api }) { return api('PUT', '/mcp/servers/broken', { principal: 'ext', body: { command: 'fails-to-start' } }); },
  async AGENT_UNAVAILABLE({ api, control }) { await control.config({ door: false }); return api('PUT', '/credentials', { body: { credential: 'tsa_valid_value' } }); },
  async MODEL_UNAVAILABLE({ api, control }) { await control.inject({ op: 'io.terra.agent.sessions.post' }, { module_error: { code: 'MODEL_UNAVAILABLE' } }); return api('POST', '/sessions', { body: {} }); },
};

test('오류 코드 15개를 모두 발생시킬 수 있고 상태·봉투가 계약과 같다', async () => {
  assert.deepEqual(Object.keys(PROVOKE).sort(), Object.keys(contract.errors).sort(), '시험이 15개를 다 다룬다');
  for (const [code, provoke] of Object.entries(PROVOKE)) {
    await ctx.control.reset('ready');
    await ctx.control.config({ model_delay_ms: 5 });
    const response = await provoke(ctx);
    assert.equal(response.status, contract.errors[code].httpStatus, `${code}: ${response.text}`);
    assert.deepEqual(Object.keys(response.json), ['error'], `${code}: 모듈 오류 봉투는 {error:{code,message}} 뿐이다`);
    assert.equal(response.json.error.code, code);
    assert.equal(typeof response.json.error.message, 'string');
    assert.ok(response.json.error.message.length > 0);
  }
});

test('계약 operation 마다 선언한 오류 코드는 계약의 오류 목록 안에 있다', () => {
  for (const [id, operation] of OPERATIONS) for (const code of operation.errors) assert.ok(contract.errors[code], `${id}: ${code} 는 계약 errors 에 없다`);
});
