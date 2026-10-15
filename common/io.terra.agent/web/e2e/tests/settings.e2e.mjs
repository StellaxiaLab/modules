// 화면 6 — 설정(읽기 전용)과 자격 거두기 3단계(G3, DC-20). 실제 앱(--app ui)을 셸 안에서 열어 본다.
//
//  · 설정은 읽기뿐이다: 모델 목록·자격 사실·MCP 서버 목록·한도 기본값. 키·자격 문자열·env 값은 화면·저장소·주소·콘솔·브리지 어디에도 없고(I1·I19),
//    설정 화면이 서버에 보낸 요청은 GET 뿐이다(모델·MCP 쓰기는 이 앱에 없다).
//  · 자격 거두기는 세 단계다: 열린 세션 취소 → (사람이) Gateway 폐기 → 자격 삭제. 앞 단계가 끝나기 전에는 삭제가 잠겨 있고, 삭제는 한 번만 나간다.
//    응답을 잃어도(outcomeUnknown) 다시 보내지 않고 자격을 읽어 확인한다.
// 시계는 서버 쪽 가짜 시계가 따로 있고 이 점검은 벽시계를 기다리지 않는다 — 조건(`until`)만 기다린다.

import { MODULE, OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };
const OP_CRED_DELETE = 'io.terra.agent.credentials.delete';
const OP_CRED_GET = 'io.terra.agent.credentials.get';

const SECRETS = {
  apiKey: 'sk-ant-api03-SETTINGS-E2E-KEY-5c1d90aa',
  credential: 'tsa_SETTINGS_E2E_TOKEN_9b7e12cc',
  mcpEnv: 'mcp-env-SETTINGS-E2E-VALUE-3f44d1e0',
};
const NEEDLES = [SECRETS.apiKey, SECRETS.credential, SECRETS.mcpEnv, 'sk-ant-api03', 'SETTINGS-E2E', 'SETTINGS_E2E', 'tsa_SETTINGS', 'mcp-env-SETTINGS'];

/** 설정 화면을 연다 — 사이드바의 설정 링크를 누른다(해시 이동). */
async function enterSettings(app) {
  await app.$('[data-role="settings-link"]').click();
  await app.$('[data-role="settings"]').waitFor({ state: 'visible' });
  await until(async () => (await app.$('[data-role="settings-models"] tbody tr').count()) > 0, { message: '모델 목록이 서지 않았다' });
}

const revokeOpen = (app) => app.$('[data-role="revoke-open"]');
const overlay = (app) => app.$('[data-role="revoke-overlay"]');
const del = (app) => app.$('[data-role="revoke-delete"]');
const cmdText = (app) => app.$('[data-role="revoke-overlay"] [data-role="revoke-command"]').textContent();

async function openRevoke(app) {
  await revokeOpen(app).click();
  await overlay(app).waitFor({ state: 'visible' });
}

function surfaces(target) {
  return target.evaluate(async () => {
    const dump = (store) => {
      const items = {};
      for (let i = 0; i < store.length; i += 1) items[store.key(i)] = store.getItem(store.key(i));
      return items;
    };
    let storage = {};
    try {
      storage = { local: dump(localStorage), session: dump(sessionStorage) };
    } catch {
      /* 저장소를 못 읽는 환경 */
    }
    return {
      html: document.documentElement.outerHTML,
      text: document.body.innerText,
      url: location.href,
      title: document.title,
      cookie: document.cookie,
      storage,
      resources: performance.getEntriesByType('resource').map((r) => r.name),
    };
  });
}

check('설정: 사이드바에서 들어가 모델·자격·MCP·한도를 읽기 전용으로 보인다 — 초점이 제목으로 가고, 구역마다 이름이 있고, 키·자격·env 값은 어디에도 없으며, 서버에 간 요청은 GET 뿐이다 (I1·I19, D-4)', async (t) => {
  const messages = [];
  t.context.on('page', (page) => {
    page.on('console', (message) => messages.push(message.text()));
    page.on('pageerror', (error) => messages.push(String(error?.message ?? error)));
  });
  const alice = agentApi(t);
  assert.equal((await alice.call('PUT', '/models/anthropic', { api_key: SECRETS.apiKey, model: 'fake-model-1', default: true })).status, 200);
  assert.equal((await alice.call('PUT', '/credentials', { credential: SECRETS.credential })).status, 200);
  assert.equal((await agentApi(t, 'ext').call('PUT', '/mcp/servers/fake-mcp', { command: 'fake-mcp-cmd', args: ['--stdio'], env: { API_TOKEN: SECRETS.mcpEnv } })).status, 200);

  const app = await openApp(t);
  await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비됨'), { message: '준비됨이 서지 않았다' });
  const start = await mark(t);
  await enterSettings(app);

  // 들어오면 초점이 제목으로 간다. 주소는 #/settings.
  assert.equal(await app.f.evaluate(() => document.activeElement?.id), 'settings-title');
  assert.equal(await app.f.evaluate(() => location.hash), '#/settings');
  assert.equal(await app.$('[data-role="settings-link"]').getAttribute('aria-current'), 'page');

  // 구역 넷이 이름을 가진다.
  for (const role of ['settings-models', 'settings-credential', 'settings-mcp', 'settings-limits']) {
    const labelled = await app.$(`[data-role="${role}"]`).getAttribute('aria-labelledby');
    assert.ok(labelled, `${role}: aria-labelledby 가 없다`);
    assert.ok(((await app.$(`#${labelled}`).textContent()) ?? '').trim().length > 0, `${role}: 제목이 비었다`);
  }

  // 모델: 제공자·모델·주소·기본·등록. 입력칸이 하나도 없다.
  const row = app.$('[data-role="settings-models"] tbody tr').first();
  const rowText = (await row.textContent()) ?? '';
  for (const want of ['anthropic', 'fake-model-1', '기본', '등록됨']) assert.ok(rowText.includes(want), `모델 행에 '${want}' 이 없다: ${rowText}`);
  assert.equal(await app.$('[data-role="settings"] input, [data-role="settings"] textarea, [data-role="settings"] select').count(), 0, '설정 화면에 입력칸이 있다');

  // 자격: 사실만. "폐기 여부는 확인하지 못함".
  const credText = (await app.$('[data-role="settings-credential"]').textContent()) ?? '';
  assert.equal((await app.$('[data-role="credential-state"]').textContent())?.trim(), '만료 시각 전');
  for (const want of ['alice', 'node', '폐기 여부는 확인하지 못함', 'GATEWAY_UNREACHABLE']) assert.ok(credText.includes(want), `자격 카드에 '${want}' 이 없다`);
  assert.ok(!/자격 유효|유효합니다/.test(credText), '"유효"라고 말했다');

  // MCP: 이름·도구 수·env 이름. 값은 없고 등록·삭제 단추도 없다.
  const mcpText = (await app.$('[data-role="settings-mcp"]').textContent()) ?? '';
  for (const want of ['fake-mcp', 'env: API_TOKEN', '값은 표시하지 않음', '터미널']) assert.ok(mcpText.includes(want), `MCP 구역에 '${want}' 이 없다`);
  assert.equal(await app.$('[data-role="settings-mcp"] button, [data-role="settings-mcp"] input, [data-role="settings-mcp"] a').count(), 0, 'MCP 구역에 조작 요소가 있다');

  // 한도 기본값.
  const limitText = (await app.$('[data-role="settings-limits"]').textContent()) ?? '';
  for (const want of ['24', '900', '무제한', '1 ~ 100', '1 ~ 7200']) assert.ok(limitText.includes(want), `한도 구역에 '${want}' 이 없다`);

  // 이름 없는 조작 요소가 없다.
  const unnamed = await app.f.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-role="settings"] button, [data-role="settings"] a[href], [data-role="settings"] table')) {
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.textContent ?? '').trim() !== '';
      if (!named) out.push(el.tagName.toLowerCase());
    }
    return out;
  });
  assert.deepEqual(unnamed, [], '이름이 없는 요소가 있다');

  // 설정 화면이 서버에 보낸 요청은 GET 뿐이다(쓰기·삭제 없음) — 모델·MCP 쓰기는 이 앱에 없다.
  const sent = (await t.control.requests('')).filter((r) => r.n > start && r.scope !== null);
  assert.ok(sent.length > 0, '앱이 낸 요청을 하나도 못 봤다');
  assert.deepEqual(sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.op}`), [], '설정 화면이 쓰기 요청을 냈다');
  const ops = new Set(sent.map((r) => r.op));
  for (const want of ['io.terra.agent.models.list', OP_CRED_GET, 'io.terra.agent.mcp.list']) assert.ok(ops.has(want), `${want} 를 부르지 않았다`);

  // 비밀은 어디에도 없다.
  const found = [];
  for (const [where, target] of [['앱 프레임', app.f], ['셸 페이지', app.page]]) {
    const blob = JSON.stringify(await surfaces(target));
    for (const needle of NEEDLES) if (blob.includes(needle)) found.push(`${where}: ${needle}`);
  }
  const bridgeLog = JSON.stringify(await app.page.evaluate(() => window.__shell.log));
  for (const needle of NEEDLES) {
    if (bridgeLog.includes(needle)) found.push(`브리지 기록: ${needle}`);
    if (messages.join('\n').includes(needle)) found.push(`콘솔: ${needle}`);
    if (JSON.stringify((await t.control.requests('')).map((r) => r.path)).includes(needle)) found.push(`요청 주소: ${needle}`);
  }
  assert.deepEqual(found, [], '비밀이 다시 보이는 자리가 있다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('설정: 한 구역이 실패해도 나머지는 선다 — 실패는 그 구역에서 role=alert 로 사전 문구를 쓰고 원문은 접고, "다시 읽기"로 풀린다', async (t) => {
  await t.control.inject({ op: 'io.terra.agent.mcp.list' }, { module_error: { code: 'AGENT_UNAVAILABLE', message: 'RAW english: store down', status: 503 } });
  const app = await openApp(t, { route: '#/settings' });
  await app.$('[data-role="settings"]').waitFor({ state: 'visible' });
  const alert = app.$('[data-role="settings-mcp"] [role="alert"]');
  await alert.waitFor({ state: 'visible' });
  assert.match((await alert.textContent()) ?? '', /에이전트 모듈이 지금 처리할 수 없습니다/);
  assert.equal(await alert.locator('details').evaluate((d) => d.open), false, '원문이 펼쳐져 있다');
  assert.match((await alert.locator('details').textContent()) ?? '', /RAW english: store down/);
  await until(async () => (await app.$('[data-role="settings-models"] tbody tr').count()) > 0, { message: '다른 구역이 서지 않았다' });
  assert.equal((await app.$('[data-role="credential-state"]').textContent())?.trim(), '만료 시각 전');
  await app.$('[data-role="settings-reload"]').click();
  await until(async () => (await app.$('[data-role="settings-mcp"] [role="alert"]').count()) === 0, { message: '다시 읽어도 실패가 남았다' });
  assert.equal(await app.$('[data-role="settings-mcp"] .mcp-card').count(), 0, '서버가 없는데 카드가 있다');
  assert.match((await app.$('[data-role="settings-mcp"]').textContent()) ?? '', /등록된 외부 서버가 없습니다/);
}, UI);

for (const [preset, state, hasRevoke] of [
  ['expired-credential', '만료됨', true],
  ['no-credential', '미등록', false],
]) {
  check(`설정: 자격이 ${state}이면 그대로 말한다${hasRevoke ? ' — 정리(거두기)는 할 수 있다' : ' — 거두기 단추가 없다'}`, async (t) => {
    const app = await openApp(t, { route: '#/settings' });
    await app.$('[data-role="settings"]').waitFor({ state: 'visible' });
    await until(async () => (await app.$('[data-role="credential-state"]').textContent())?.trim() === state, { message: `자격 상태가 '${state}' 이 되지 않았다` });
    assert.equal((await revokeOpen(app).count()) > 0, hasRevoke);
    const text = (await app.$('[data-role="settings-credential"]').textContent()) ?? '';
    assert.equal(text.includes('폐기 여부는 확인하지 못함'), false, '만료·미등록인데 "만료 시각 전"류 단서를 붙였다');
    assert.deepEqual(app.problems.all(), []);
  }, { ...UI, preset });
}

check('자격 거두기: 대화창이 모달로 서고(초점 "닫기"·Tab 가둠·Esc), 확인 단계가 "폐기 여부는 확인하지 못함"·턴 도중 GATEWAY_UNREACHABLE·사람 세션 폐기 명령을 말한다 (DC-20, R-10)', async (t) => {
  const app = await openApp(t, { route: '#/settings' });
  await app.$('[data-role="settings"]').waitFor({ state: 'visible' });
  await until(async () => (await revokeOpen(app).count()) > 0, { message: '거두기 단추가 서지 않았다' });
  await revokeOpen(app).focus();
  await openRevoke(app);

  const dialog = app.$('[data-role="revoke-overlay"] [role="dialog"]');
  assert.equal(await dialog.getAttribute('aria-modal'), 'true');
  const name = await app.$(`#${await dialog.getAttribute('aria-labelledby')}`).textContent();
  assert.match(name ?? '', /위임 자격을 거둘까요\?/);
  assert.equal(await app.f.evaluate(() => document.activeElement?.getAttribute('data-role')), 'revoke-close', '초점이 안전한 "닫기"에서 시작하지 않는다');
  assert.equal(await app.$('[data-role="app"]').getAttribute('inert'), '', '바깥 화면이 inert 가 아니다');

  const text = (await dialog.textContent()) ?? '';
  for (const want of ['폐기 여부는 확인하지 못합니다', 'GATEWAY_UNREACHABLE', 'HTTP 오류', '사람 세션만', 'Gateway 폐기를 마쳤습니다']) assert.ok(text.includes(want), `확인 단계에 '${want}' 이 없다`);
  assert.equal((await cmdText(app))?.trim(), 'terra agent revoke delegate-alice');

  // Tab 은 대화창 안에서만 돈다 — 여러 번 눌러도 초점이 창 밖으로 나가지 않는다.
  for (let i = 0; i < 8; i += 1) {
    await app.page.keyboard.press('Tab');
    assert.equal(await app.f.evaluate(() => !!document.activeElement?.closest('[data-role="revoke-overlay"]')), true, `Tab ${i + 1}번째에 초점이 창 밖으로 나갔다`);
  }
  for (let i = 0; i < 8; i += 1) {
    await app.page.keyboard.press('Shift+Tab');
    assert.equal(await app.f.evaluate(() => !!document.activeElement?.closest('[data-role="revoke-overlay"]')), true, `Shift+Tab ${i + 1}번째에 초점이 창 밖으로 나갔다`);
  }

  // Esc 로 닫으면 초점이 연 단추로 돌아오고 아무것도 지워지지 않는다.
  await app.page.keyboard.press('Escape');
  await overlay(app).waitFor({ state: 'hidden' });
  assert.equal(await app.f.evaluate(() => document.activeElement?.getAttribute('data-role')), 'revoke-open');
  assert.equal(await app.$('[data-role="app"]').getAttribute('inert'), null);
  assert.equal((await requestsOf(t, OP_CRED_DELETE)).length, 0, '닫기만 했는데 삭제가 나갔다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('자격 거두기 3단계: 열린 세션이 있으면 삭제가 잠겨 있다 → 세션 취소(서버에서 cancelled) → 폐기 확인 → 삭제 한 번 → 서버의 자격이 지워지고 준비 상태가 막히며, 결과에 "Gateway 폐기는 아직입니다"와 명령이 남는다 (DC-20)', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'rv-a', topic: '열린 하나' });
  await api.open({ id: 'rv-b', topic: '열린 둘' });
  await api.open({ id: 'rv-done', scenario: 'model-failure', topic: '이미 끝남' });
  await api.say('rv-done', '죽어라');
  await api.waitState('rv-done', 'failed');
  const app = await openApp(t, { route: '#/settings' });
  await app.$('[data-role="settings"]').waitFor({ state: 'visible' });
  await until(async () => (await app.$('[data-role="revoke-steps"] li').first().textContent())?.includes('열린 세션 2개'), { message: '열린 세션 2개가 카드에 서지 않았다' });
  await openRevoke(app);

  // 잠겨 있다 — 눌러도 아무 요청도 나가지 않는다.
  assert.equal(await del(app).getAttribute('aria-disabled'), 'true');
  const hint = await app.$(`#${await del(app).getAttribute('aria-describedby')}`).textContent();
  assert.match(hint ?? '', /열린 세션이 2개 남아 있습니다/);
  await del(app).click({ force: true }); // aria-disabled 단추라 Playwright 는 기본으로 "눌릴 때까지" 기다린다 — 일부러 눌러 본다
  assert.equal((await requestsOf(t, OP_CRED_DELETE)).length, 0, '잠긴 삭제 단추가 요청을 냈다');

  // 1 단계: 열린 세션 취소. 이미 끝난 세션은 건드리지 않는다.
  await app.$('[data-role="revoke-cancel-sessions"]').click();
  await until(async () => /열린 세션이 없습니다/.test((await app.$('[data-role="revoke-open-count"]').textContent()) ?? ''), { message: '열린 세션이 0이 되지 않았다' });
  assert.equal((await api.session('rv-a')).state, 'cancelled');
  assert.equal((await api.session('rv-b')).state, 'cancelled');
  assert.equal((await api.session('rv-done')).state, 'failed', '끝난 세션을 건드렸다');
  const cancels = await requestsOf(t, OP.sessionsCancel);
  assert.deepEqual(cancels.map((r) => r.path.split('/')[6]).sort(), ['rv-a', 'rv-b'].sort());
  // 아직 폐기 확인이 없으므로 잠겨 있다.
  assert.equal(await del(app).getAttribute('aria-disabled'), 'true');

  // 2 단계: 명령 복사(sandbox 에서는 막힐 수 있다 — 어느 쪽이든 role=status 로 말한다).
  await app.$('[data-role="revoke-copy"]').click();
  const note = app.$('[data-role="revoke-copy-note"]');
  await until(async () => /복사했습니다|복사하지 못했습니다/.test((await note.textContent()) ?? ''), { message: '복사 결과를 말하지 않았다' });
  assert.equal(await note.getAttribute('role'), 'status');

  // 폐기를 마쳤다고 사람이 확인해야 삭제가 풀린다.
  await app.$('[data-role="revoke-confirmed"]').check();
  assert.equal(await del(app).getAttribute('aria-disabled'), 'false');

  // 3 단계: 삭제는 정확히 한 번 — 연타해도.
  await del(app).dblclick();
  const result = app.$('[data-role="revoke-result"]');
  await result.waitFor({ state: 'visible' });
  const resultText = (await result.textContent()) ?? '';
  for (const want of ['맡긴 자격을 삭제했습니다', 'Gateway 폐기는 아직입니다', '폐기 여부는 확인하지 못합니다']) assert.ok(resultText.includes(want), `결과에 '${want}' 이 없다: ${resultText}`);
  assert.equal((await cmdText(app))?.trim(), 'terra agent revoke delegate-alice', '삭제한 뒤 결과 화면에 폐기 명령이 남지 않았다');
  assert.equal((await requestsOf(t, OP_CRED_DELETE)).length, 1, '삭제 요청이 한 번이 아니다');
  assert.equal(await app.f.evaluate(() => document.activeElement?.getAttribute('data-role')), 'revoke-title', '결과로 초점이 가지 않았다');

  // 서버는 자격을 지웠고, 앱의 준비 상태·설정 카드는 따라온다.
  assert.equal((await api.call('GET', '/credentials')).data.registered, false);
  await app.$('[data-role="revoke-close"]').click();
  await overlay(app).waitFor({ state: 'hidden' });
  await until(async () => (await app.$('[data-role="credential-state"]').textContent())?.trim() === '미등록', { message: '자격 카드가 미등록이 되지 않았다' });
  assert.equal(await revokeOpen(app).count(), 0);
  await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비 안 됨'), { message: '준비 상태가 막히지 않았다' });
  assert.equal(await app.$('[data-role="new-session"]').getAttribute('aria-disabled'), 'true');
  assert.equal(await app.f.evaluate(() => document.activeElement?.id), 'settings-title', '초점이 제목에 안착하지 않았다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('자격 거두기 · 응답 유실(drop:after, 서버는 지웠다): 다시 보내지 않고 자격을 읽어 "삭제된 것을 확인"한다 — DELETE 는 한 번 (I17의 정신)', async (t) => {
  const app = await openApp(t, { route: '#/settings' });
  await app.$('[data-role="settings"]').waitFor({ state: 'visible' });
  await until(async () => (await revokeOpen(app).count()) > 0, { message: '거두기 단추가 서지 않았다' });
  await openRevoke(app);
  await app.$('[data-role="revoke-confirmed"]').check();
  await t.control.inject({ op: OP_CRED_DELETE }, { drop: 'after' });
  const start = await mark(t);
  await del(app).click();
  const result = app.$('[data-role="revoke-result"]');
  await result.waitFor({ state: 'visible' });
  const text = (await result.textContent()) ?? '';
  assert.match(text, /응답은 받지 못했지만/);
  assert.match(text, /삭제된 것을 확인했습니다/);
  assert.match(text, /Gateway 폐기는 아직입니다/);
  assert.equal((await requestsOf(t, OP_CRED_DELETE, start)).length, 1, '유실된 삭제를 앱이 다시 보냈다');
  assert.ok((await requestsOf(t, OP_CRED_GET, start)).length >= 1, '자격을 다시 읽어 확인하지 않았다');
  assert.equal((await agentApi(t).call('GET', '/credentials')).data.registered, false);
}, UI);

check('자격 거두기 · 요청이 닿지 못함(drop:before, 서버는 안 지웠다): "삭제되지 않았습니다"를 role=alert 로 알리고 자동 재전송 없이 사람이 다시 눌러야 두 번째가 나간다', async (t) => {
  const app = await openApp(t, { route: '#/settings' });
  await app.$('[data-role="settings"]').waitFor({ state: 'visible' });
  await until(async () => (await revokeOpen(app).count()) > 0, { message: '거두기 단추가 서지 않았다' });
  await openRevoke(app);
  await app.$('[data-role="revoke-confirmed"]').check();
  await t.control.inject({ op: OP_CRED_DELETE }, { drop: 'before' });
  const start = await mark(t);
  await del(app).click();
  const alert = app.$('[data-role="revoke-error"]');
  await until(async () => (await alert.isVisible()) && /아직 남아 있습니다/.test((await alert.textContent()) ?? ''), { message: '유실 안내가 서지 않았다' });
  assert.equal(await alert.getAttribute('role'), 'alert');
  assert.match((await alert.textContent()) ?? '', /자동으로 다시 보내지 않았습니다/);
  assert.equal((await requestsOf(t, OP_CRED_DELETE, start)).length, 1, '앱이 스스로 다시 보냈다');
  assert.equal((await agentApi(t).call('GET', '/credentials')).data.registered, true, '서버 자격이 지워졌다');
  assert.equal(await overlay(app).isVisible(), true, '대화창이 닫혔다');
  // 사람이 다시 누르면 그때 두 번째가 나가고 끝난다.
  await del(app).click();
  await app.$('[data-role="revoke-result"]').waitFor({ state: 'visible' });
  assert.equal((await requestsOf(t, OP_CRED_DELETE, start)).length, 2);
  assert.equal((await agentApi(t).call('GET', '/credentials')).data.registered, false);
}, UI);

check('자격 거두기 · 거절(권한 없음): 사전 문구를 role=alert 로, 원문은 접어서 — 대화창은 열린 채 자격은 그대로', async (t) => {
  const app = await openApp(t, { route: '#/settings' });
  await app.$('[data-role="settings"]').waitFor({ state: 'visible' });
  await until(async () => (await revokeOpen(app).count()) > 0, { message: '거두기 단추가 서지 않았다' });
  await openRevoke(app);
  await app.$('[data-role="revoke-confirmed"]').check();
  await t.control.inject({ op: OP_CRED_DELETE }, { gateway_error: { code: 'MODULE_PERMISSION_DENIED', message: 'RAW english: denied' } });
  await del(app).click();
  const alert = app.$('[data-role="revoke-error"]');
  await until(async () => (await alert.isVisible()) && /agent\.use 권한이 없거나/.test((await alert.textContent()) ?? ''), { message: '권한 안내가 서지 않았다' });
  assert.equal(await alert.getAttribute('role'), 'alert');
  assert.equal(await alert.locator('details').evaluate((d) => d.open), false);
  assert.match((await alert.locator('details').textContent()) ?? '', /RAW english: denied/);
  assert.equal((await agentApi(t).call('GET', '/credentials')).data.registered, true);
  assert.equal(await overlay(app).isVisible(), true);
}, UI);

check('턴 도중에 거두면 HTTP 오류 없이 call 줄에 GATEWAY_UNREACHABLE 만 쌓인다 — 서버 쪽 사실을 확인한다(앱이 확인 단계에서 이렇게 미리 말하는 근거)', async (t) => {
  // 가짜 서버는 모듈 소스(loop.go)를 옮긴 것이다: 모델이 호출을 제안한 시점에 자격이 없으면 그 call 줄이 GATEWAY_UNREACHABLE 로 쌓인다.
  await t.control.config({ model_delay_ms: 1500 }); // 차례가 진행 중인 동안 거둘 틈
  const api = agentApi(t);
  await api.open({ id: 'mid-turn', autonomy: 'ask', scenario: 'approval-flow' });
  await api.say('mid-turn', 'io.terra.chat 을 다시 시작해 줘');
  await api.waitState('mid-turn', 'running');
  const removed = await api.call('DELETE', '/credentials'); // 턴 도중에 거둔다
  assert.equal(removed.status, 200);
  assert.equal(removed.data.removed, true);
  await until(async () => ['idle', 'done', 'failed'].includes((await api.session('mid-turn')).state), { message: '턴이 끝나지 않았다' });
  const entries = await api.entries('mid-turn');
  const calls = entries.filter((e) => e.kind === 'call');
  assert.ok(calls.some((e) => e.error_code === 'GATEWAY_UNREACHABLE'), `call 줄에 GATEWAY_UNREACHABLE 이 없다: ${JSON.stringify(calls.map((e) => e.error_code))}`);
  // 요청은 모두 성공했다 — 자격이 사라졌어도 HTTP 오류는 어디에도 없다.
  const failed = (await t.control.requests('')).filter((r) => r.scope === null && r.status >= 400);
  assert.deepEqual(failed.map((r) => `${r.op} ${r.status}`), [], 'HTTP 오류가 났다');
}, UI);
