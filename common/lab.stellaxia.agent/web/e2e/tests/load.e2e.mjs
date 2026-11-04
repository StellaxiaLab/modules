// 실제 앱(`--app ui`)의 불러오기 점검 — plan §5.3 "불러오기: 콘솔 오류·페이지 오류·실패한 요청·4xx가 없다".
// 앱이 무엇을 그리든 같은 약속이라 앱 화면(WP-4)이 없어도 지금 돈다. 앱 화면이 병합되면 이 파일 아래에 점검을 더한다(TODO-checks.md).

import { agentApi, openApp } from '../lib/app.mjs';
import { assert, check, openShell, until } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };

check('불러오기: 셸 안에서 앱이 뜨고 CSP 위반·콘솔 오류·페이지 오류·실패한 요청·4xx 가 없다', async (t) => {
  const shell = await openShell(t, { principal: 'alice' }, { wait: '#app' });
  await until(async () => (await shell.frame.textContent('#app')).trim().length > 0, { message: '앱이 아무것도 그리지 않았다' });
  const text = await shell.frame.textContent('#app');
  assert.doesNotMatch(text, /셸 안에서 여세요/, '셸 안에서 열었는데 셸 밖 안내가 나온다 — 브리지 감지가 틀렸다');
  await new Promise((resolve) => setTimeout(resolve, 500)); // 늦게 오는 요청·오류를 잠깐 더 본다
  assert.deepEqual(shell.problems.all(), []);
  assert.deepEqual(shell.problems.cspViolations, []);
}, UI);

check('불러오기: 셸 밖(최상위 창)에서 열면 브리지 없이 안내를 보이고 오류가 없다', async (t) => {
  const page = await t.newPage();
  const messages = [];
  page.on('console', (m) => m.type() === 'error' && messages.push(m.text()));
  page.on('pageerror', (e) => messages.push(String(e)));
  await page.goto(t.stack.appUrl('index.html'));
  await page.waitForSelector('#app');
  await until(async () => (await page.textContent('#app')).trim().length > 0);
  assert.match(await page.textContent('#app'), /셸 안에서 여세요/);
  assert.deepEqual(messages, []);
}, UI);

check('불러오기: 세션 셋(대기·실패·취소)이 목록에 서고 — 진행 중은 "내 세션", 실패·취소는 "종료됨" — 오류가 없다', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'set-idle', scenario: 'read-only-answer', topic: '대기 세션' });
  await api.open({ id: 'set-failed', scenario: 'model-failure', topic: '실패 세션' });
  await api.open({ id: 'set-cancelled', scenario: 'cancel-mid-turn', topic: '취소 세션' });
  await api.say('set-idle', '읽어 줘');
  await api.say('set-failed', '죽어라');
  await api.say('set-cancelled', '오래 걸린다');
  await api.waitState('set-idle', 'idle');
  await api.waitState('set-failed', 'failed');
  await api.waitState('set-cancelled', 'running');
  assert.equal((await api.call('POST', '/sessions/set-cancelled/cancel', {})).status, 200);
  await api.waitState('set-cancelled', 'cancelled');

  const app = await openApp(t, {});
  const titles = () => app.$('a.sess .sess-title').allTextContents();
  await until(async () => (await titles()).join() === '대기 세션', { message: '"내 세션" 탭에 대기 세션만 서야 한다' });
  assert.match((await app.$('#tab-ended').textContent()) ?? '', /2/);
  await app.$('#tab-ended').click();
  await until(async () => (await titles()).sort().join() === '실패 세션,취소 세션', { message: '"종료됨" 탭에 실패·취소 세션이 서야 한다' });
  const states = await app.$('a.sess .sess-state').allTextContents();
  assert.deepEqual(states.sort(), ['실패', '취소됨']);
  assert.deepEqual(app.problems.all(), []);
  assert.deepEqual(app.problems.cspViolations, []);
}, UI);
