// 엄격한 본문 검증 · principal(M-1) · 소유자 필터 — api.go 의 decodeBody·principal·ownedSession 과 같은 규칙.

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { startAgent, waitState } from './helpers.mjs';

let ctx;
before(async () => {
  ctx = await startAgent();
});
after(async () => ctx?.close());
const reset = async (preset = 'ready') => {
  await ctx.control.reset(preset);
  await ctx.control.config({ model_delay_ms: 5 });
};

// 본문을 받는 operation 마다 "모르는 필드" 하나를 얹어 보낸다 → 400 INVALID_REQUEST
const BODY_CASES = [
  ['PUT', '/credentials', { credential: 'tsa_value_ok' }],
  ['PUT', '/models/anthropic', { api_key: 'sk-example-0000' }],
  ['PUT', '/mcp/servers/s1', { command: 'weather-mcp' }, 'ext'],
  ['POST', '/runs', { prompt: 'p' }],
  ['POST', '/sessions', {}],
  ['POST', '/sessions/own/messages', { text: 't' }],
  ['POST', '/approvals/apr_1', {}],
];

test('본문을 받는 operation 은 모르는 필드를 400 INVALID_REQUEST 로 거절한다', async () => {
  await reset();
  await ctx.api('POST', '/sessions', { body: { session_id: 'own' } });
  for (const [method, rel, base, principal] of BODY_CASES) {
    const r = await ctx.api(method, rel, { principal: principal ?? 'alice', body: { ...base, 모르는필드: 1 } });
    assert.equal(r.status, 400, `${method} ${rel}: ${r.text}`);
    assert.equal(r.json.error.code, 'INVALID_REQUEST');
    assert.match(r.json.error.message, /unknown field/);
  }
});

test('타입이 틀리면 400, null 은 안 준 것과 같고, 빈 본문은 허용(필수 항목이 없으면 그 검증으로 간다)', async () => {
  await reset();
  assert.equal((await ctx.api('POST', '/sessions', { body: { simulate: 'yes' } })).status, 400);
  assert.equal((await ctx.api('POST', '/sessions', { body: { max_steps: 1.5 } })).status, 400);
  assert.equal((await ctx.api('POST', '/sessions', { body: { mcp_servers: 'a' } })).status, 400);
  assert.equal((await ctx.api('POST', '/sessions', { raw: '[1]' })).status, 400);
  assert.equal((await ctx.api('POST', '/sessions', { raw: '{깨진' })).status, 400);
  const nulls = await ctx.api('POST', '/sessions', { body: { session_id: 'n1', autonomy: null, topic: null } });
  assert.equal(nulls.status, 200);
  assert.equal(nulls.json.autonomy, 'plan');
  assert.equal((await ctx.api('POST', '/sessions', { raw: '' })).status, 200);
  const noPrompt = await ctx.api('POST', '/runs', { body: {} });
  assert.deepEqual([noPrompt.status, noPrompt.json.error.message], [400, 'prompt is required']);
});

test('값 검증: autonomy·한도·세션 id·모델 provider·api_key·MCP 이름', async () => {
  await reset();
  const bad = async (path, body, pattern, principal = 'alice') => {
    const r = await ctx.api(path.startsWith('PUT') ? 'PUT' : 'POST', path.replace(/^(PUT|POST) /, ''), { principal, body });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json.error.code, 'INVALID_REQUEST');
    assert.match(r.json.error.message, pattern);
  };
  await bad('/sessions', { autonomy: 'yolo' }, /unknown autonomy "yolo"; expected plan, ask, auto or unattended/);
  await bad('/sessions', { max_steps: 101 }, /max_steps must be between 1 and 100/);
  await bad('/sessions', { max_seconds: 7201 }, /max_seconds must be between 1 and 7200/);
  await bad('/sessions', { token_budget: -1 }, /token_budget cannot be negative/);
  await bad('/sessions', { session_id: '../etc' }, /session id/);
  await bad('PUT /models/openai', { api_key: 'sk-example-0000' }, /unknown model provider "openai"; this build knows: anthropic/);
  await bad('PUT /models/anthropic', { api_key: 'short' }, /api_key is required/);
  await bad('PUT /mcp/servers/bad%20name', { command: 'x' }, /server name/, 'ext');
  await bad('PUT /mcp/servers/ok', { command: '  ' }, /command is required/, 'ext');
  await bad('PUT /credentials', { credential: 'sess_user_token' }, /delegated credential \(tsa_…\)/);
  const readOnly = await ctx.api('PUT', '/mcp/servers/ok2', { principal: 'ext', body: { command: 'weather-mcp', read_only: ['없는도구'] } });
  assert.equal(readOnly.status, 400);
});

test('쿼리: after_seq·limit 은 음수·비정수를 400 으로 거절한다', async () => {
  await reset();
  await ctx.api('POST', '/sessions', { body: { session_id: 'q1' } });
  for (const q of ['after_seq=-1', 'limit=abc', 'after_seq=1.5']) {
    const r = await ctx.api('GET', `/sessions/q1/messages?${q}`);
    assert.deepEqual([r.status, r.json.error.code], [400, 'INVALID_REQUEST'], q);
  }
  assert.equal((await ctx.api('GET', '/sessions/q1/messages?after_seq=0&limit=10')).status, 200);
});

test('소스가 계약보다 느슨한 곳은 소스를 따른다(README "갈라진 곳")', async () => {
  await reset();
  // limit=0 은 "제한 없음"(계약은 최소 1), 20000자 넘는 글도 모듈은 받는다(계약은 maxLength 20000 — 앱이 막는다)
  await ctx.control.seed({ scenario: 'long-history', session_id: 'long', owner: 'alice', entries: 600 });
  assert.equal((await ctx.api('GET', '/sessions/long/messages?limit=0')).json.entries.length, 600);
  assert.equal((await ctx.api('GET', '/sessions/long/messages?limit=9999')).json.entries.length, 600);
  await ctx.api('POST', '/sessions', { body: { session_id: 'lax' } });
  const big = await ctx.api('POST', '/sessions/lax/messages', { body: { text: '가'.repeat(20001) } });
  assert.equal(big.status, 201);
  // sessions.post 가 prompt 를, runs.post 가 session_id·topic 을 받는다(입력 구조체를 공유한다)
  assert.equal((await ctx.api('POST', '/sessions', { body: { session_id: 'lax2', prompt: '무시됨' } })).status, 200);
  const run = await ctx.api('POST', '/runs', { body: { prompt: '실행', topic: '제목', session_id: '무시됨' } });
  assert.equal(run.status, 200);
  // max_steps:0 은 기본값(계약은 최소 1)
  assert.equal((await ctx.api('POST', '/sessions', { body: { session_id: 'lax3', max_steps: 0 } })).status, 200);
  assert.equal((await ctx.api('GET', '/sessions/lax3')).json.max_steps, 24);
});

test('M-1: principal 이 없으면 400 INVALID_REQUEST — status·models.list·mcp.list 만 principal 이 필요 없다', async () => {
  await reset();
  const needs = [
    ['GET', '/credentials'], ['PUT', '/credentials', { credential: 'tsa_x_value' }], ['DELETE', '/credentials'],
    ['PUT', '/models/anthropic', { api_key: 'sk-example-0000' }], ['DELETE', '/models/anthropic'],
    ['PUT', '/mcp/servers/a', { command: 'x' }], ['DELETE', '/mcp/servers/a'],
    ['POST', '/runs', { prompt: 'p' }], ['POST', '/sessions', {}], ['GET', '/sessions'], ['GET', '/sessions/x'],
    ['GET', '/sessions/x/messages'], ['POST', '/sessions/x/messages', { text: 't' }], ['GET', '/sessions/x/stream'],
    ['POST', '/sessions/x/cancel'], ['POST', '/approvals/apr_1', {}],
  ];
  for (const [method, rel, body] of needs) {
    for (const principal of [null, 'anonymous']) {
      const r = await ctx.api(method, rel, { principal, body });
      assert.equal(r.status, 400, `${method} ${rel} (${principal}): ${r.text}`);
      assert.equal(r.json.error.code, 'INVALID_REQUEST');
    }
  }
  for (const rel of ['/status', '/models', '/mcp/servers']) assert.equal((await ctx.api('GET', rel, { principal: null })).status, 200, rel);
});

test('소유자 필터: 목록은 남의 세션을 거르고, 읽기·쓰기·취소·승인은 403 SESSION_NOT_OWNED', async () => {
  await reset();
  await ctx.control.scenario('approval-flow');
  await ctx.api('POST', '/sessions', { body: { session_id: 'a1', autonomy: 'ask' } });
  await ctx.api('POST', '/sessions/a1/messages', { body: { text: '다시 시작' } });
  const waiting = await waitState(ctx.api, 'a1', 'waiting-approval');
  await ctx.api('POST', '/sessions', { principal: 'bob', body: { session_id: 'b1' } });

  assert.deepEqual((await ctx.api('GET', '/sessions', { principal: 'alice' })).json.sessions.map((s) => s.session_id), ['a1']);
  assert.deepEqual((await ctx.api('GET', '/sessions', { principal: 'bob' })).json.sessions.map((s) => s.session_id), ['b1']);
  const requestId = waiting.pending_approvals[0].request_id;
  for (const [method, rel, body] of [
    ['GET', '/sessions/a1'], ['GET', '/sessions/a1/messages'], ['POST', '/sessions/a1/messages', { text: 'hi' }],
    ['POST', '/sessions/a1/cancel'], ['GET', '/sessions/a1/stream'], ['POST', `/approvals/${requestId}`, {}], ['POST', '/sessions', { session_id: 'a1' }],
  ]) {
    const r = await ctx.api(method, rel, { principal: 'bob', body });
    assert.deepEqual([r.status, r.json?.error?.code], [403, 'SESSION_NOT_OWNED'], `${method} ${rel}`);
  }
  // 남의 승인 카드는 bob 의 목록에 없고, alice 의 대기는 그대로다
  assert.equal((await ctx.api('GET', '/sessions/a1')).json.pending_approvals.length, 1);
  // R-2 전의 모양: 목록이 섞여 오게 켜 본다
  await ctx.control.features({ sessionsListUnfiltered: true });
  assert.deepEqual((await ctx.api('GET', '/sessions', { principal: 'bob' })).json.sessions.map((s) => s.session_id).sort(), ['a1', 'b1']);
});

test('자격·모델·MCP 응답에 비밀이 없다(I1) · 호출 기록의 비밀은 가려진다', async () => {
  await reset('empty');
  await ctx.api('PUT', '/models/anthropic', { body: { api_key: 'sk-never-echo-me-0000' } });
  await ctx.api('PUT', '/credentials', { body: { credential: 'tsa_never_echo_me' } });
  await ctx.api('PUT', '/mcp/servers/w', { principal: 'ext', body: { command: 'weather-mcp', env: { TOKEN: 'never-echo-me' } } });
  const everything = [
    (await ctx.api('GET', '/models')).text, (await ctx.api('GET', '/credentials')).text, (await ctx.api('GET', '/mcp/servers')).text,
    JSON.stringify(await ctx.control.requests()),
  ].join('\n');
  assert.doesNotMatch(everything, /never-echo-me|sk-never/);
  assert.match(everything, /\*\*\*/); // 기록에는 가린 표시가 있다
});
