// 스모크 — 가짜 서버·셸 호스트·브리지·CSP 가 실제 Chromium 에서 맞물려 도는지 본다.
// 점검용 앱(fixtures/probe-app)으로 돈다. 실제 앱의 점검(plan §5.3 35개 이식)은 TODO-checks.md 에 매핑만 있다.

import { appCsp } from '../serve.mjs';
import { MODULE, assert, check, openShell, until } from '../lib/harness.mjs';

const PROBE = { apps: ['probe'] };

check('불러오기: 셸이 앱을 올리고 hello→ready 뒤 status·sessions 가 DOM 에 찍힌다', async (t) => {
  const shell = await openShell(t, { principal: 'alice' }, { wait: 'body[data-done="1"]' });
  const status = JSON.parse(await shell.frame.textContent('#status'));
  assert.equal(status.ok, true);
  assert.equal(status.status, 200);
  assert.deepEqual({ ...status.data, sessions: 0 }, { status: 'ok', version: '0.1.0', sessions: 0, models_registered: 1, delegate_door: true });
  const sessions = JSON.parse(await shell.frame.textContent('#sessions'));
  assert.deepEqual(sessions.data, { sessions: [] });
  assert.deepEqual(JSON.parse(await shell.frame.textContent('#permissions')), ['agent.use']);

  const log = await shell.log();
  const kinds = log.map((l) => `${l.dir}:${l.type}`);
  assert.deepEqual(kinds.slice(0, 2), ['in:terra.webapp.hello', 'out:terra.webapp.ready']);
  assert.equal(log.filter((l) => l.dir === 'in' && l.type === 'terra.webapp.request').length, 2);
  assert.deepEqual(log.filter((l) => l.dir === 'out' && l.type === 'terra.webapp.response').map((l) => l.status), [200, 200]);
  assert.deepEqual(shell.problems.all(), [], '콘솔 오류·페이지 오류·실패한 요청·4xx 가 없어야 한다');

  // 서버가 본 요청: 브리지가 Bearer 로 사용자를 찍었고 선언 권한을 실었다.
  const seen = await t.control.requests();
  assert.deepEqual(seen.map((r) => r.op), ['io.terra.agent.status.get', 'io.terra.agent.sessions.list']);
  assert.ok(seen.every((r) => r.principal === 'alice' && JSON.stringify(r.scope) === '["agent.use"]'));
}, PROBE);

check('권한 없는 계정: sessions.list 는 403 MODULE_PERMISSION_DENIED(Gateway 봉투), status.get 은 된다', async (t) => {
  const shell = await openShell(t, { principal: 'noperm' }, { wait: 'body[data-done="1"]' });
  const status = JSON.parse(await shell.frame.textContent('#status'));
  assert.equal(status.ok, true);
  const sessions = JSON.parse(await shell.frame.textContent('#sessions'));
  assert.equal(sessions.ok, false);
  assert.equal(sessions.status, 403);
  assert.equal(sessions.data.ok, false);
  assert.equal(sessions.data.error.code, 'MODULE_PERMISSION_DENIED');
  assert.ok('meta' in sessions.data, 'Gateway 오류 봉투에는 meta 가 있다');
}, PROBE);

check('선언 권한이 비면 BRIDGE_NO_PERMISSIONS — 요청은 Gateway 에 닿지 않는다', async (t) => {
  const shell = await openShell(t, { permissions: '' }, { wait: 'body[data-done="1"]' });
  const status = JSON.parse(await shell.frame.textContent('#status'));
  assert.equal(status.ok, false);
  assert.equal(status.status, 403);
  assert.equal(status.error.code, 'BRIDGE_NO_PERMISSIONS');
  assert.equal('data' in status, false, '브리지가 만든 오류에는 data 가 없다');
  assert.deepEqual(await t.control.requests(), []);
}, PROBE);

check('브리지 규칙: 모듈 이름 공간 밖 경로·허용 밖 메서드는 셸이 거절한다', async (t) => {
  const shell = await openShell(t, {}, { wait: 'body[data-done="1"]' });
  const before = (await t.control.requests()).length;
  const path = await shell.call('GET', '/api/v1/gui/apps');
  assert.deepEqual([path.ok, path.status, path.error.code], [false, 403, 'BRIDGE_PATH_NOT_ALLOWED']);
  const method = await shell.call('TRACE', `${MODULE}/status`);
  assert.deepEqual([method.ok, method.status, method.error.code], [false, 405, 'BRIDGE_METHOD_NOT_ALLOWED']);
  assert.equal((await t.control.requests()).length, before);
  // /api/nodes/ 는 통과한다(가짜 서버에는 그 경로가 없어 평문 404 가 온다 — 봉투가 아니다)
  const nodes = await shell.call('GET', '/api/nodes/tree-02/modules/io.terra.agent/v1/status');
  assert.equal(nodes.status, 404);
}, PROBE);

check('토큰이 없으면(세션 끝) 401 UNAUTHORIZED, 앱은 토큰을 보지 못한다', async (t) => {
  const shell = await openShell(t, { login: 0 }, { wait: 'body[data-done="1"]' });
  const status = JSON.parse(await shell.frame.textContent('#status'));
  assert.deepEqual([status.ok, status.status, status.data.error.code], [false, 401, 'UNAUTHORIZED']);
}, PROBE);

check('CSP: 인라인 스크립트와 바깥 origin 연결이 막힌다(앱 자산에 같은 헤더)', async (t) => {
  const header = (await fetch(t.stack.appUrl('index.html'))).headers.get('content-security-policy');
  assert.equal(header, appCsp(t.stack.shellOrigin));
  assert.match(header, /script-src 'self'/);

  const shell = await openShell(t, { app: `/api/v1/gui/apps/io.terra.agent/files/ui/csp.html?target=${encodeURIComponent(t.stack.shellOrigin)}` }, { wait: 'body[data-done="1"]' });
  assert.equal(await shell.frame.evaluate(() => window.__inlineRan), undefined, '인라인 스크립트가 실행되면 안 된다');
  assert.equal(await shell.frame.evaluate(() => window.__fetchResult), 'blocked', 'connect-src \'self\' 가 바깥 origin 을 막아야 한다');
  assert.ok(shell.problems.cspViolations.length >= 2, `CSP 위반이 콘솔에 잡혀야 한다: ${JSON.stringify(shell.problems.console)}`);
}, PROBE);

check('셸 쪽: 앱 iframe 이 sandbox 이고 다른 창·다른 origin 의 메시지는 받지 않는다', async (t) => {
  const shell = await openShell(t, {}, { wait: 'body[data-done="1"]' });
  const sandbox = await shell.page.getAttribute('#app-frame', 'sandbox');
  assert.equal(sandbox, 'allow-scripts allow-forms allow-same-origin');
  // 셸 창 자신이 보낸 request(출처가 앱이 아니다)는 무시된다.
  await shell.page.evaluate(() => window.postMessage({ type: 'terra.webapp.request', id: 'forged', method: 'GET', path: '/api/modules/io.terra.agent/v1/status' }, '*'));
  const log = await until(async () => (await shell.log()).find((l) => l.dir === 'rejected'), { message: '위조 메시지가 거절 기록에 없다' });
  assert.equal(log.type, 'terra.webapp.request');
  assert.equal((await t.control.requests()).filter((r) => r.op === 'io.terra.agent.status.get').length, 1);
}, PROBE);
