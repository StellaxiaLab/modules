// 새 세션 열기 화면(GAP-9, 보드 ⑤) — 자율성 ask·auto · topic · simulate · 한도 셋 · provider · 외부 MCP 선택.
// 열기 호출(sessions.post)은 멱등 id 로 가고, 응답을 잃어도(drop:'after') 같은 id·같은 본문으로만 다시 간다.
// 기다림은 `until()`(조건)이고 시계를 감지 않는다 — 벽시계 sleep 없음.

import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };

/** 새 세션 화면을 연다 — 준비 상태가 켜지고 MCP 목록이 읽힐 때까지. */
async function openForm(t, opts = {}) {
  const app = await openApp(t, { route: '#/new', ...opts });
  await app.$('[data-role="new-session-pane"]').waitFor({ state: 'visible' });
  await until(async () => !(await app.$('[data-role="open-session"]').isDisabled()), { message: '세션 열기가 켜지지 않았다(준비 상태)' });
  await until(async () => !/읽는 중/.test((await app.$('[data-role="mcp-state"]').textContent()) ?? ''), { message: 'MCP 목록을 읽지 못했다' });
  return app;
}

/** 서버가 받은 sessions.post 본문들. */
const openedBodies = async (t, since = 0) => (await requestsOf(t, OP.sessionsPost, since)).map((r) => r.request);

check('새 세션 폼: 자율성 4종(ask·auto 는 열리고 unattended 는 G4 까지 꺼짐) · 한도 기본값 · provider · 외부 서버 없음 안내', async (t) => {
  const app = await openForm(t);
  const radios = await app.$('input[name="autonomy"]').evaluateAll((els) => els.map((el) => ({ value: el.value, disabled: el.disabled, checked: el.checked })));
  assert.deepEqual(radios, [
    { value: 'plan', disabled: false, checked: true },
    { value: 'ask', disabled: false, checked: false },
    { value: 'auto', disabled: false, checked: false },
    { value: 'unattended', disabled: true, checked: false },
  ]);
  const off = await app.$('input[name="autonomy"][value="unattended"]').evaluate((el) => document.getElementById(el.getAttribute('aria-describedby'))?.textContent);
  assert.equal(off, '무인 세션은 G4에서 열립니다');
  assert.deepEqual(await app.$('#new-max-steps, #new-max-seconds, #new-token-budget').evaluateAll((els) => els.map((el) => el.value)), ['24', '900', '']);
  assert.equal(await app.$('#new-token-budget').getAttribute('placeholder'), '무제한');
  const providers = await app.$('#new-provider option').evaluateAll((els) => els.map((el) => el.textContent));
  assert.equal(providers.length, 1);
  assert.match(providers[0], /\(기본\)/);
  assert.match((await app.$('[data-role="mcp-state"]').textContent()) ?? '', /등록된 외부 MCP 서버가 없습니다/);
  assert.equal(await app.$('input[name="simulate"][value="off"]').isChecked(), true);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('새 세션 폼: 아무것도 안 건드리고 열면 plan 만 싣는다 (D-7) — 한 번만 나가고 그 세션으로 이동한다', async (t) => {
  const app = await openForm(t);
  const before = await mark(t);
  await app.$('[data-role="open-session"]').click();
  await app.pane.waitFor({ state: 'visible' });
  const bodies = await openedBodies(t, before);
  assert.equal(bodies.length, 1);
  const { session_id: id, ...rest } = bodies[0];
  assert.ok(id.length > 0);
  assert.deepEqual(rest, { autonomy: 'plan' });
  assert.equal((await agentApi(t).session(id)).autonomy, 'plan');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('새 세션 폼: ask + 시뮬레이션 + 제목 + 한도 셋 + 외부 서버를 골라 열면 모듈이 그 값으로 연다 (응답의 실제 값을 확인)', async (t) => {
  const ext = agentApi(t, 'ext');
  const put = await ext.call('PUT', '/mcp/servers/weather', { command: '/usr/local/bin/weather-mcp', read_only: ['read_file'] });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const app = await openForm(t);
  const item = app.$('[data-role="mcp-item"]');
  assert.match((await item.textContent()) ?? '', /weather.*도구 3 · 읽기 전용 1/);
  await app.$('input[name="autonomy"][value="ask"]').check({ force: true });
  await app.$('input[name="simulate"][value="on"]').check({ force: true });
  await app.$('#new-topic').fill('새벽 점검');
  await app.$('#new-max-steps').fill('40');
  await app.$('#new-max-seconds').fill('1800');
  await app.$('#new-token-budget').fill('50000');
  await app.$('input[name="mcp"][value="weather"]').check();
  const before = await mark(t);
  await app.$('[data-role="open-session"]').click();
  await app.pane.waitFor({ state: 'visible' });
  const bodies = await openedBodies(t, before);
  assert.equal(bodies.length, 1);
  const { session_id: id, ...rest } = bodies[0];
  assert.deepEqual(rest, { autonomy: 'ask', simulate: true, topic: '새벽 점검', mcp_servers: ['weather'], max_steps: 40, max_seconds: 1800, token_budget: 50000 });
  const snapshot = await agentApi(t).session(id);
  assert.equal(snapshot.autonomy, 'ask');
  assert.equal(snapshot.simulate, true);
  assert.equal(snapshot.max_steps, 40);
  assert.equal(snapshot.max_seconds, 1800);
  assert.equal(snapshot.token_budget, 50000);
  assert.deepEqual(snapshot.mcp_servers, ['weather']);
  await until(async () => /ask/.test((await app.$('[data-role="autonomy-chip"]').textContent()) ?? ''), { message: '머리의 자율성 칩이 ask 가 아니다' });
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('새 세션 폼: auto 로 열 수 있다', async (t) => {
  const app = await openForm(t);
  await app.$('input[name="autonomy"][value="auto"]').check({ force: true });
  const before = await mark(t);
  await app.$('[data-role="open-session"]').click();
  await app.pane.waitFor({ state: 'visible' });
  const [body] = await openedBodies(t, before);
  assert.equal(body.autonomy, 'auto');
  assert.equal((await agentApi(t).session(body.session_id)).autonomy, 'auto');
}, UI);

check('새 세션 폼: 틀린 한도는 요청 없이 칸에서 막고 첫 오류 칸에 초점을 둔다 — 고치면 열린다', async (t) => {
  const app = await openForm(t);
  await app.$('#new-max-steps').fill('101');
  await app.$('#new-max-seconds').fill('1.5');
  await app.$('#new-token-budget').fill('0');
  const before = await mark(t);
  await app.$('[data-role="open-session"]').click();
  await until(async () => (await app.$('#new-max-steps').getAttribute('aria-invalid')) === 'true', { message: '오류가 칸에 붙지 않았다' });
  assert.equal(await app.$('#new-max-seconds').getAttribute('aria-invalid'), 'true');
  assert.equal(await app.$('#new-token-budget').getAttribute('aria-invalid'), 'true');
  assert.equal(await app.f.evaluate(() => document.activeElement?.id), 'new-max-steps');
  // 오류 문구는 aria-describedby 로 칸에 이어져 있다.
  const described = await app.$('#new-max-steps').evaluate((el) => el.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id)?.textContent).join(' '));
  assert.match(described, /1~100/);
  assert.equal((await openedBodies(t, before)).length, 0, '틀린 값으로 요청이 나갔다');
  await app.$('#new-max-steps').fill('100');
  await app.$('#new-max-seconds').fill('7200');
  await app.$('#new-token-budget').fill('1');
  await app.$('[data-role="open-session"]').click();
  await app.pane.waitFor({ state: 'visible' });
  const [body] = await openedBodies(t, before);
  assert.deepEqual({ ...body, session_id: undefined }, { session_id: undefined, autonomy: 'plan', max_steps: 100, max_seconds: 7200, token_budget: 1 });
}, UI);

check('새 세션 폼: 더블클릭·Enter 연타에도 열기 호출은 한 번이다 (응답이 느려도)', async (t) => {
  const app = await openForm(t);
  await t.control.inject({ op: OP.sessionsPost }, { delay_ms: 400 });
  const before = await mark(t);
  await app.$('[data-role="open-session"]').dblclick();
  await app.$('#new-topic').press('Enter').catch(() => undefined);
  await app.pane.waitFor({ state: 'visible' });
  assert.equal((await openedBodies(t, before)).length, 1, '열기 호출이 둘 이상 나갔다');
  assert.equal((await t.control.sessions()).filter((s) => s.owner === 'alice').length, 1);
}, UI);

check('새 세션 폼: 열기 응답을 잃으면(I17) 값 칸이 잠기고, 다시 눌러도 같은 id·같은 본문이며 세션은 하나다', async (t) => {
  const app = await openForm(t);
  await app.$('input[name="autonomy"][value="ask"]').check({ force: true });
  await app.$('#new-max-steps').fill('10');
  await t.control.inject({ op: OP.sessionsPost }, { drop: 'after' });
  const before = await mark(t);
  await app.$('[data-role="open-session"]').click();
  const banner = app.$('[data-role="open-error"]');
  await until(async () => (await banner.isVisible()) && /OUTCOME_UNKNOWN/.test((await banner.textContent()) ?? ''), { message: '응답 유실 안내가 서지 않았다' });
  assert.equal(await app.$('[data-role="frozen-note"]').isVisible(), true);
  assert.equal(await app.$('#new-max-steps').isDisabled(), true);
  assert.equal(await app.$('input[name="autonomy"][value="auto"]').isDisabled(), true);
  assert.equal((await openedBodies(t, before)).length, 1, '앱이 스스로 다시 보냈다');
  await app.$('[data-role="open-session"]').click();
  await app.pane.waitFor({ state: 'visible' });
  const bodies = await openedBodies(t, before);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], bodies[0], '다시 보낸 본문이 처음과 다르다');
  assert.equal((await t.control.sessions()).filter((s) => s.owner === 'alice').length, 1, '세션이 둘 이상 열렸다');
  // 끊긴 연결(ERR_EMPTY_RESPONSE)만 예상된 소음이다 — 그 밖의 콘솔 오류·CSP 위반은 없다.
  assert.deepEqual(app.problems.all().filter((p) => !/ERR_EMPTY_RESPONSE/.test(p)), []);
}, UI);

check('새 세션 폼: 열기 오류는 오류 사전 문구와 코드로 보이고 원문은 접혀 있다 (MODEL_NOT_CONFIGURED)', async (t) => {
  const app = await openForm(t);
  await t.control.inject({ op: OP.sessionsPost }, { module_error: { code: 'MODEL_NOT_CONFIGURED', message: 'no model registered', status: 409 } });
  await app.$('[data-role="open-session"]').click();
  const banner = app.$('[data-role="open-error"]');
  await until(async () => await banner.isVisible(), { message: '오류 배너가 서지 않았다' });
  const text = (await banner.textContent()) ?? '';
  assert.match(text, /등록된 모델이 없습니다/);
  assert.match(text, /MODEL_NOT_CONFIGURED/);
  assert.equal(await banner.locator('details').getAttribute('open'), null);
  assert.match((await banner.locator('details').textContent()) ?? '', /no model registered/);
  assert.equal(await app.$('#new-max-steps').isDisabled(), false, '확정된 오류인데 값 칸이 잠겼다');
}, UI);

check('새 세션 폼: 외부 MCP 서버 목록을 못 읽어도 서버 없이 열 수 있고 다시 읽기로 되살린다', async (t) => {
  await t.control.inject({ op: 'io.terra.agent.mcp.list' }, { module_error: { code: 'AGENT_UNAVAILABLE', status: 503 } }, { times: 1 });
  const app = await openApp(t, { route: '#/new' });
  await app.$('[data-role="new-session-pane"]').waitFor({ state: 'visible' });
  await until(async () => /읽지 못했습니다/.test((await app.$('[data-role="mcp-state"]').textContent()) ?? ''), { message: '목록 실패 안내가 서지 않았다' });
  await until(async () => !(await app.$('[data-role="open-session"]').isDisabled()), { message: '세션 열기가 켜지지 않았다' });
  await app.$('[data-role="mcp-reload"]').click();
  await until(async () => /등록된 외부 MCP 서버가 없습니다/.test((await app.$('[data-role="mcp-state"]').textContent()) ?? ''), { message: '다시 읽기가 목록을 되살리지 못했다' });
}, UI);

check('새 세션 폼: 키보드로 모든 칸에 닿고 이름이 있으며 초점 고리가 보인다 (요구 §6.5)', async (t) => {
  const ext = agentApi(t, 'ext');
  await ext.call('PUT', '/mcp/servers/weather', { command: '/usr/local/bin/weather-mcp' });
  const app = await openForm(t);
  // 입력 칸마다 접근 가능한 이름(label · 묶음 legend)이 있다.
  const unnamed = await app.f.evaluate(() => {
    const pane = document.querySelector('[data-role="new-session-pane"]');
    const missing = [];
    for (const el of pane.querySelectorAll('input, select')) {
      const named = el.labels?.length > 0 || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!named) missing.push(`${el.tagName}#${el.id}[${el.name}]`);
    }
    for (const group of pane.querySelectorAll('fieldset')) if (!group.querySelector(':scope > legend')?.textContent) missing.push('fieldset');
    return missing;
  });
  assert.deepEqual(unnamed, []);
  // Tab 으로 한 바퀴 — 폼 안의 모든 정지점에 고리가 있다.
  await app.$('#new-topic').focus();
  const labels = [];
  const bad = [];
  for (let i = 0; i < 30; i += 1) {
    const stop = await app.f.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || !el.closest('[data-role="new-session-pane"]')) return null;
      const ring = (node) => {
        const cs = getComputedStyle(node);
        return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
      };
      const wrapper = el.closest('label.opt, .seg-radio label');
      return { id: el.id || `${el.name}=${el.value}`, ring: ring(el) || (wrapper !== null && ring(wrapper)), visible: el.getBoundingClientRect().width > 0 || wrapper !== null };
    });
    if (!stop) break;
    if (labels.length > 0 && stop.id === labels[0]) break;
    labels.push(stop.id);
    if (!stop.ring) bad.push(`${stop.id}: 초점 고리가 없다`);
    if (!stop.visible) bad.push(`${stop.id}: 보이지 않는 정지점`);
    await app.page.keyboard.press('Tab');
  }
  for (const wanted of ['new-topic', 'autonomy=plan', 'new-provider', 'mcp=weather', 'new-max-steps', 'new-max-seconds', 'new-token-budget']) assert.ok(labels.includes(wanted), `${wanted} 가 Tab 정지점에 없다: ${labels}`);
  assert.ok(!labels.includes('autonomy=unattended'), '꺼진 unattended 가 정지점이다');
  assert.deepEqual(bad, []);
  // 라디오는 화살표로 옮긴다 — ask 로 옮기면 선택도 따라간다.
  await app.$('input[name="autonomy"][value="plan"]').focus();
  await app.page.keyboard.press('ArrowRight');
  assert.equal(await app.$('input[name="autonomy"][value="ask"]').isChecked(), true);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('새 세션 폼: 나갔다 들어오면 칸이 처음 값으로 돌아오고 지난 선택이 남지 않는다 (열 때 고정, I10)', async (t) => {
  const app = await openForm(t);
  await app.$('input[name="autonomy"][value="auto"]').check({ force: true });
  await app.$('#new-topic').fill('지난 제목');
  await app.$('#new-max-steps').fill('5');
  await app.$('button:has-text("닫기")').click();
  await app.$('[data-role="new-session"]').click();
  await app.$('[data-role="new-session-pane"]').waitFor({ state: 'visible' });
  assert.equal(await app.$('input[name="autonomy"][value="plan"]').isChecked(), true);
  assert.equal(await app.$('#new-topic').inputValue(), '');
  assert.equal(await app.$('#new-max-steps').inputValue(), '24');
}, UI);
