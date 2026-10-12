// 앱의 경계 두 가지 — 비밀을 다시 보이지 않는다(I1·I19)는 것, 그리고 Gateway 로 가는 길은 셸 브리지 하나뿐이라는 것(계획서 §5.1).
//
//  · 키·자격·외부 서버 env 값은 쓰기 전용이다: 모듈은 어떤 응답에도 되돌려 주지 않고(I1·I19), 앱은 그것을 화면·저장소·주소 어디에도 두지 않는다.
//    (앱에는 키·자격을 맡기는 화면이 아직 없다 — 서버 쪽에서 맡긴 비밀이 앱을 한 바퀴 돌리는 동안 어디에도 새어 나오지 않는지를 본다.)
//  · 앱 CSP 의 `connect-src 'self'` 는 앱 origin(= Gateway origin)을 가리켜서 앱이 직접 fetch 해도 CSP 가 막지 않는다. 그래서 따로 본다:
//    엄격 Gateway(토큰 없는 호출은 401)에서 앱이 끝까지 돌고, 서버가 받은 모든 호출에 셸이 실은 머리말(Authorization·선언 권한)이 있다.

import { APP_MOUNT } from '../serve.mjs';
import { MODULE, OP, agentApi, assert, mark, openApp, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';
import { openAsk, waitCard } from '../lib/cards.mjs';

const UI = { apps: ['ui'] };

const SECRETS = {
  apiKey: 'sk-ant-api03-E2E-SECRET-KEY-7f3a91c2',
  credential: 'tsa_E2E_SECRET_TOKEN_55d0c1ab',
  mcpEnv: 'mcp-env-secret-value-0b8e44d7',
};
/** 비밀 전체와, 앞부분만 새도 알아볼 수 있는 토막. */
const NEEDLES = [SECRETS.apiKey, SECRETS.credential, SECRETS.mcpEnv, 'sk-ant-api03', 'E2E-SECRET', 'E2E_SECRET', 'tsa_E2E', 'mcp-env-secret'];

/** 한 페이지(셸 또는 앱 프레임)에서 비밀이 있을 만한 모든 자리를 한 덩어리 글로 모은다. */
function surfaces(target) {
  return target.evaluate(async () => {
    const out = {};
    out.html = document.documentElement.outerHTML; // 속성·숨은 노드·title 까지
    out.text = document.body.innerText;
    out.url = location.href;
    out.referrer = document.referrer;
    out.title = document.title;
    out.cookie = document.cookie;
    const dump = (store) => {
      const items = {};
      for (let i = 0; i < store.length; i += 1) items[store.key(i)] = store.getItem(store.key(i));
      return items;
    };
    try {
      out.localStorage = dump(localStorage);
      out.sessionStorage = dump(sessionStorage);
    } catch (cause) {
      out.storageError = String(cause);
    }
    try {
      out.indexedDB = (await indexedDB.databases()).map((db) => db.name);
    } catch {
      out.indexedDB = [];
    }
    out.history = JSON.stringify(history.state);
    out.resources = performance.getEntriesByType('resource').map((r) => r.name);
    return out;
  });
}

check('비밀은 다시 보이지 않는다(I1·I19): 키·자격·외부 서버 env 값을 맡긴 뒤 앱을 한 바퀴 돌려도 화면·저장소·주소·콘솔·브리지 기록 어디에도 없고, 서버 기록에는 ***', async (t) => {
  const messages = [];
  t.context.on('page', (page) => {
    page.on('console', (message) => messages.push(message.text()));
    page.on('pageerror', (error) => messages.push(String(error?.message ?? error)));
  });

  // 비밀을 맡긴다 — 서버 쪽 호출자로. 응답에도 요청 기록에도 비밀이 없어야 한다.
  const alice = agentApi(t);
  const putModel = await alice.call('PUT', '/models/anthropic', { api_key: SECRETS.apiKey, model: 'fake-model-1', default: true });
  assert.equal(putModel.status, 200, JSON.stringify(putModel.data));
  const putCredential = await alice.call('PUT', '/credentials', { credential: SECRETS.credential });
  assert.equal(putCredential.status, 200, JSON.stringify(putCredential.data));
  const putMcp = await agentApi(t, 'ext').call('PUT', '/mcp/servers/fake-mcp', { command: 'fake-mcp-cmd', env: { API_TOKEN: SECRETS.mcpEnv } });
  assert.equal(putMcp.status, 200, JSON.stringify(putMcp.data));
  const readBack = JSON.stringify([putModel.data, putCredential.data, putMcp.data, (await alice.call('GET', '/models')).data, (await alice.call('GET', '/credentials')).data, (await alice.call('GET', '/mcp/servers')).data]);
  for (const needle of NEEDLES) assert.equal(readBack.includes(needle), false, `서버가 비밀(${needle})을 응답에 되돌려 주었다 — 가짜가 I1·I19 를 어겼다`);
  assert.deepEqual(JSON.parse(readBack)[2].env, ['API_TOKEN'], '외부 서버 env 는 이름만 돌려 준다');
  const logged = JSON.stringify(await t.control.requests(''));
  for (const needle of NEEDLES) assert.equal(logged.includes(needle), false, `서버 요청 기록에 비밀(${needle})이 그대로 남았다`);
  assert.ok(logged.includes('"***"'), '요청 기록에 가림 표시(***)가 없다 — 시험이 의미가 없다');

  // 앱을 한 바퀴: 홈(준비 상태) → 세션(보내기·승인 카드·승인) → 종료됨 탭.
  const { app } = await openAsk(t, { id: 'secret-walk', scenario: 'approval-flow' });
  await app.type('io.terra.chat 을 다시 시작해 줘');
  const card = await waitCard(app);
  await card.locator('[data-role="approve"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  await app.$('#tab-ended').click();
  await app.$('#tab-mine').click();
  await app.f.evaluate(() => {
    window.location.hash = '#/';
  });
  await app.$('[data-role="readiness-guide"]').waitFor({ state: 'visible' });
  await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비됨'), { message: '준비됨이 서지 않았다' });
  // 자격의 사실(주체·만료)은 보여도 되지만 자격 문자열은 아니다.
  assert.match((await app.$('[data-role="readiness-guide"]').textContent()) ?? '', /만료 시각/);

  const found = [];
  for (const [where, target] of [['앱 프레임', app.f], ['셸 페이지', app.page]]) {
    const seen = await surfaces(target);
    const blob = JSON.stringify(seen);
    for (const needle of NEEDLES) if (blob.includes(needle)) found.push(`${where}: ${needle}`);
    assert.equal(seen.storageError, undefined, `${where}: 저장소를 읽지 못했다 — ${seen.storageError}`);
  }
  const bridgeLog = JSON.stringify(await app.page.evaluate(() => window.__shell.log));
  for (const needle of NEEDLES) if (bridgeLog.includes(needle)) found.push(`브리지 기록: ${needle}`);
  for (const needle of NEEDLES) if (messages.join('\n').includes(needle)) found.push(`콘솔: ${needle}`);
  const sentPaths = JSON.stringify((await t.control.requests('')).map((r) => r.path));
  for (const needle of NEEDLES) if (sentPaths.includes(needle)) found.push(`요청 주소: ${needle}`);
  assert.deepEqual(found, [], '비밀이 다시 보이는 자리가 있다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('앱은 직접 fetch 하지 않고 브리지만 쓴다(§5.1): 엄격 Gateway 에서 보내기·승인까지 끝까지 돌고, 서버가 받은 모든 호출에 셸이 실은 머리말이 있으며, 앱 프레임은 /api 로 요청을 낸 적이 없다', async (t) => {
  await t.control.config({ strict_gateway: true });
  // 시험의 대조군: 머리말 없는 직접 호출은 엄격 Gateway 가 401 로 돌려보낸다.
  const direct = await fetch(`${t.stack.gatewayOrigin}${MODULE}/status`);
  assert.equal(direct.status, 401, '엄격 Gateway 가 머리말 없는 호출을 막지 않는다 — 이 시험이 의미가 없다');

  // 앱 프레임이 낸 요청을 모두 모은다(페이지가 생기기 전부터).
  const fromApp = [];
  t.context.on('request', (request) => {
    const frame = request.frame();
    if (frame && frame.parentFrame() !== null) fromApp.push({ url: request.url(), type: request.resourceType() });
  });

  const start = await mark(t);
  const { api, app } = await openAsk(t, { id: 'bridge-only', scenario: 'approval-flow' });
  await app.type('io.terra.chat 을 다시 시작해 줘');
  const card = await waitCard(app);
  await app.$('#tab-ended').click();
  await app.$('#tab-mine').click();
  await card.locator('[data-role="approve"]').click();
  await until(async () => (await app.lineKinds()).includes('done'), { message: '차례가 끝나지 않았다' });
  await app.waitChip('대기');
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력이 돌아오지 않았다' });

  // 서버가 받은 호출을 둘로 가른다: 셸이 선언 권한 머리말을 실은 것(브리지) / 아닌 것. 아닌 것은 시험이 세션을 심은 한 번뿐이다(Authorization 만 있다).
  const all = (await t.control.requests('')).filter((r) => r.n > start);
  const bridged = all.filter((r) => r.scope !== null);
  assert.deepEqual(all.filter((r) => r.scope === null).map((r) => r.op), [OP.sessionsPost], '브리지를 거치지 않은 호출이 시험의 세션 심기 말고도 있다');
  const ops = new Set(bridged.map((r) => r.op));
  for (const op of [OP.messagesPost, OP.approvalsPost, OP.sessionsGet, OP.sessionsList, OP.messagesList]) assert.ok(ops.has(op), `앱이 ${op} 를 부르지 않았다 — 한 바퀴를 못 돌았다`);
  for (const call of all) {
    assert.notEqual(call.status, 401, `#${call.n} ${call.op}: 머리말 없이 갔다(401)`);
    assert.equal(call.principal, 'alice', `#${call.n} ${call.op}: Authorization 이 없다`);
  }
  for (const call of bridged) assert.deepEqual(call.scope, ['agent.use'], `#${call.n} ${call.op}: 선언 권한 머리말이 다르다`);

  // 앱 프레임 자신은 문서·스크립트·스타일 말고는 아무 요청도 내지 않았다 — fetch·XHR·EventSource·WebSocket·beacon 이 없다.
  const outsideMount = fromApp.filter((r) => !r.url.includes(APP_MOUNT) && !/\/favicon\.ico$/.test(r.url));
  assert.deepEqual(outsideMount, [], '앱 프레임이 자산 밖으로 요청을 냈다');
  const scripted = fromApp.filter((r) => ['fetch', 'xhr', 'eventsource', 'websocket', 'ping'].includes(r.type));
  assert.deepEqual(scripted, [], '앱 프레임이 fetch 류로 요청을 냈다');
  assert.ok(fromApp.some((r) => r.type === 'document'), '앱 프레임의 요청을 하나도 보지 못했다 — 수집이 어긋났다');
  assert.equal((await api.session('bridge-only')).state, 'idle');
  assert.deepEqual(app.problems.all(), []);
}, UI);
