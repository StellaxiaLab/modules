// 입력 묶음(§5.3 "입력") — 공백만은 못 보냄 · HTML 과 {{…}} 가 글자로 · 연타해도 한 번 · 조합 중 Enter 무시 ·
// Shift+Enter 줄바꿈 · 20001자 차단. 원본: design/checks/demo-checks.mjs 의 "Live: input edge cases"·DC-22, textarea-grow.mjs.
// 20001자는 서버가 막지 않는다(소스 그대로, README "알려진 갈라짐") — 앱이 막았음은 messages.post 가 가지 않은 것으로 본다.

import { OP, agentApi, assert, mark, openApp, requestsOf, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };

/** plan 세션을 심고 그 세션에서 앱을 연다. */
async function openChat(t, id, { scenario = 'read-only-answer', ...opts } = {}) {
  const api = agentApi(t);
  await api.open({ id, autonomy: 'plan', scenario });
  const app = await openApp(t, { route: `#/s/${id}`, ...opts });
  await app.pane.waitFor({ state: 'visible' });
  await until(async () => !(await app.textarea.isDisabled()), { message: '입력칸이 켜지지 않았다' });
  return { api, app };
}

const posts = async (t, since) => (await requestsOf(t, OP.messagesPost, since)).length;

check('입력: 공백만 쓴 글은 보낼 수 없다 — 버튼이 꺼지고 Enter 를 눌러도 messages.post 가 가지 않는다', async (t) => {
  const { app } = await openChat(t, 'in-blank');
  const before = await mark(t);
  assert.equal(await app.send.isDisabled(), true, '빈 입력인데 보내기가 켜져 있다');
  await app.textarea.fill('   \n  \t ');
  assert.equal(await app.send.isDisabled(), true, '공백만인데 보내기가 켜져 있다');
  await app.textarea.press('Enter');
  await app.send.click({ force: true }).catch(() => {}); // 꺼진 버튼을 억지로 눌러도
  // 서버로 가는 길이 없다는 것은 "조금 기다려 봐도 안 온다"가 아니라, 이어서 보낸 정상 글이 첫 post 라는 것으로 닫는다.
  await app.type('이제 진짜 글');
  await until(async () => (await app.lineKinds()).includes('user'), { message: '정상 글이 기록에 오르지 않았다' });
  assert.equal(await posts(t, before), 1, '공백 글이 서버로 갔다');
  assert.equal((await app.lines()).filter((l) => l.kind === 'user').length, 1);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('입력: 글 속 HTML·{{…}} 는 글자로 나온다 — 내가 쓴 글도, 모델이 쓴 글도 마크업이 되지 않는다', async (t) => {
  const { app } = await openChat(t, 'in-html', { scenario: 'html-in-text' });
  const mine = '<b id="mine">굵게</b> {{7*7}} <img src=x onerror="window.__xss=9">';
  await app.type(mine);
  await app.waitChip('대기'); // 차례가 끝나 모델의 글(html-in-text)까지 올랐다
  await until(async () => (await app.lineKinds()).includes('assistant'), { message: '모델의 글이 오르지 않았다' });
  const user = await app.$('.line[data-kind="user"] .body').first().textContent();
  assert.equal(user, mine, '내가 쓴 글이 글자 그대로가 아니다');
  const ai = await app.$('.line[data-kind="assistant"] .body').first().textContent();
  assert.match(ai, /<img src=x onerror="window.__xss=1">/);
  assert.match(ai, /\{\{7\*7\}\}/);
  assert.match(ai, /\[눌러 보세요\]\(javascript:window.__xss=3\)/, '마크다운 링크가 링크가 됐거나 글자가 달라졌다');
  // 말풍선(.body) 안에는 글자 노드뿐이다 — 요소가 하나라도 있으면 글이 마크업으로 읽힌 것이다. 스크립트도 돌지 않았다.
  const markup = await app.log.evaluate((el) => ({ children: el.querySelectorAll('.body *').length, links: el.querySelectorAll('a').length, xss: window.__xss ?? null }));
  assert.deepEqual(markup, { children: 0, links: 0, xss: null }, '말풍선에 마크업이 생겼거나 스크립트가 돌았다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('입력: 연타해도 한 번 — 더블클릭·Enter 연타 모두 messages.post 가 정확히 한 번 간다', async (t) => {
  const { app } = await openChat(t, 'in-rapid');
  // 응답을 늦춰 "보내는 중" 창을 넓힌다 — 두 번째 클릭이 첫 응답 전에 들어간다.
  await t.control.inject({ op: OP.messagesPost }, { delay_ms: 300 }, { times: 5 });
  const before = await mark(t);
  await app.textarea.fill('한 번만');
  await app.send.dblclick();
  await app.textarea.press('Enter');
  await app.textarea.press('Enter');
  await until(async () => (await app.lineKinds()).includes('user'), { message: '글이 기록에 오르지 않았다' });
  await app.waitChip('대기');
  assert.equal(await posts(t, before), 1, 'messages.post 가 한 번이 아니다');
  assert.equal((await app.lines()).filter((l) => l.kind === 'user').length, 1);
  assert.equal(await app.textarea.inputValue(), '', '보낸 뒤 입력칸이 비지 않았다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('입력: 한글 조합 중 Enter 는 보내지 않는다(DC-22) — 조합이 끝난 Enter 만 보낸다', async (t) => {
  const { app } = await openChat(t, 'in-ime');
  const before = await mark(t);
  await app.textarea.fill('안녕하세요');
  // 크롬은 조합 확정 Enter 에 isComposing=true, 사파리는 keyCode 229 를 낸다 — 둘 다 흉내 낸다(실제 IME 조합은 아니다).
  const fire = (init) =>
    app.textarea.evaluate((el, i) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...i })), init);
  await fire({ isComposing: true, keyCode: 229 });
  await fire({ keyCode: 229 });
  await app.textarea.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await fire({});
  await app.textarea.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  assert.equal(await posts(t, before), 0, '조합 중 Enter 로 글이 나갔다');
  assert.equal(await app.textarea.inputValue(), '안녕하세요', '조합 중 Enter 가 입력칸을 건드렸다');
  await app.textarea.press('Enter'); // 진짜 Enter
  await until(async () => (await app.lineKinds()).includes('user'), { message: '진짜 Enter 로 글이 나가지 않았다' });
  assert.equal(await posts(t, before), 1);
}, UI);

check('입력: Shift+Enter 는 줄바꿈이고 Enter 는 보낸다 — 입력칸은 줄 수에 따라 자라되 120px 에서 멈춘다', async (t) => {
  const { app } = await openChat(t, 'in-newline');
  const before = await mark(t);
  const height = () => app.textarea.evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const oneLine = await height();
  await app.textarea.fill('첫 줄');
  await app.textarea.press('Shift+Enter');
  await app.textarea.pressSequentially('둘째 줄');
  assert.equal(await app.textarea.inputValue(), '첫 줄\n둘째 줄');
  assert.equal(await posts(t, before), 0, 'Shift+Enter 가 글을 보냈다');
  const twoLines = await height();
  assert.ok(twoLines > oneLine, `두 줄에서 입력칸이 자라지 않았다 (${oneLine} → ${twoLines})`);
  // 줄을 더 쌓으면 상한(120px)에서 멈추고 안쪽이 스크롤된다.
  await app.textarea.fill(Array.from({ length: 12 }, (_, i) => `줄 ${i + 1}`).join('\n'));
  const capped = await app.textarea.evaluate((el) => ({ h: Math.round(el.getBoundingClientRect().height), scrolls: el.scrollHeight > el.clientHeight, overflowY: getComputedStyle(el).overflowY }));
  assert.deepEqual([capped.h, capped.scrolls, capped.overflowY], [120, true, 'auto']);
  await app.textarea.fill('끝');
  assert.equal(await height(), oneLine, '글을 줄이면 한 줄 높이로 돌아와야 한다');
  await app.textarea.press('Enter');
  await until(async () => (await app.lineKinds()).includes('user'), { message: 'Enter 로 글이 나가지 않았다' });
  assert.equal(await posts(t, before), 1);
}, UI);

check('입력: 20001자는 막힌다(DC-22) — 숫자가 오류 색으로, 보내기가 꺼지고, Enter 를 눌러도 messages.post 가 가지 않는다', async (t) => {
  const { app } = await openChat(t, 'in-long');
  const before = await mark(t);
  const count = app.$('#composer-count');
  await app.textarea.fill('가'.repeat(20000));
  assert.equal((await count.textContent()).trim(), '20000 / 20000');
  assert.equal(await app.send.isDisabled(), false, '정확히 20000자는 보낼 수 있어야 한다');
  await app.textarea.fill('가'.repeat(20001));
  assert.match(await count.textContent(), /^20001 \/ 20000/);
  assert.ok((await count.getAttribute('class')).split(/\s+/).includes('over'), '한도를 넘었는데 숫자가 오류 표시가 아니다');
  assert.equal(await app.send.isDisabled(), true, '20001자인데 보내기가 켜져 있다');
  await app.textarea.press('Enter');
  // 코드 포인트 수로 센다 — 이모지(2 UTF-16 단위)로 채운 20000자는 보낼 수 있다.
  await app.textarea.fill('😀'.repeat(20000));
  assert.equal(await app.send.isDisabled(), false, '20000 코드 포인트(이모지)가 막혔다 — 글자 수를 UTF-16 단위로 센다');
  await app.textarea.fill('가'.repeat(20001));
  await app.textarea.press('Enter');
  assert.equal(await posts(t, before), 0, '20001자가 서버로 갔다 — 서버는 막지 않으니 앱이 막아야 한다');
  assert.deepEqual(app.problems.all(), []);
}, UI);
