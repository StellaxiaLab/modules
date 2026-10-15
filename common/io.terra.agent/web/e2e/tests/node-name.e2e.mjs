// 헤더의 대상 노드 이름 (GAP-13) — status.get 의 선택 필드 node_name.
// 있으면 헤더에 글자로 보이고, 없으면(이전 모듈) 자리가 없다. 꾸민 이름은 어느 경우에도 없다.

import { assert, openApp, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };
const NODE = '[data-role="node-name"]';

check('노드 이름: node_name 이 있으면 헤더에 그 글자가 보인다', async (t) => {
  await t.control.config({ node_name: 'tree-home' });
  const app = await openApp(t, {});
  await until(async () => (await app.$(NODE).count()) === 1, { message: '헤더에 노드 이름이 서지 않았다' });
  assert.equal((await app.$(NODE).textContent()).trim(), 'tree-home');
  assert.equal(await app.$(NODE).evaluate((el) => el.closest('header') !== null), true, '노드 이름이 헤더 안에 있지 않다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('노드 이름: node_name 이 없으면(이전 모듈) 노드 이름 자리가 없고 꾸민 이름도 없다', async (t) => {
  const app = await openApp(t, {});
  await until(async () => (await app.$('[data-role="readiness-chip"]').textContent())?.includes('준비'), { message: '준비 상태가 서지 않았다' });
  assert.equal(await app.$(NODE).count(), 0, '노드 이름이 없는데 자리가 있다');
  assert.ok(!((await app.$('header').first().textContent()) ?? '').includes('tree-home'), '꾸민 노드 이름이 보인다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('노드 이름: 마크업처럼 생긴 이름은 글자로만 보이고 요소가 되지 않는다 (I7)', async (t) => {
  const evil = '<img src=x onerror=alert(1)>';
  await t.control.config({ node_name: evil });
  const app = await openApp(t, {});
  await until(async () => (await app.$(NODE).count()) === 1, { message: '헤더에 노드 이름이 서지 않았다' });
  assert.equal(await app.$(NODE).textContent(), evil);
  assert.equal(await app.$('header img').count(), 0, '이름이 요소로 해석됐다');
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('노드 이름: 긴 이름은 잘리지 않는다 — 전체 글자가 화면 안에서 줄을 바꿔 보이고 접근성 이름도 전체다', async (t) => {
  const long = `node-${'가나다라마바사'.repeat(14)}-끝`;
  await t.control.config({ node_name: long });
  const app = await openApp(t, {});
  await until(async () => (await app.$(NODE).count()) === 1, { message: '헤더에 노드 이름이 서지 않았다' });
  const el = app.$(NODE);
  assert.equal(await el.textContent(), long);
  assert.equal(await el.getAttribute('aria-label'), `대상 노드 ${long}`);
  assert.equal(await el.getAttribute('title'), long);
  // 말줄임·가림이 없다: 넘침이 보이는 채이고, 요소 안에서 글자가 다 들어간다(scrollWidth ≤ clientWidth).
  const fit = await el.evaluate((node) => ({ over: getComputedStyle(node).textOverflow, ow: getComputedStyle(node).overflow, fits: node.scrollWidth <= node.clientWidth + 1 }));
  assert.equal(fit.over, 'clip', '말줄임 표시가 켜져 있다');
  assert.equal(fit.fits, true, '긴 이름이 요소 안에서 잘린다');
  const box = await el.boundingBox();
  const frame = await app.$('header').first().boundingBox();
  assert.ok(box && frame && box.x >= frame.x - 1 && box.x + box.width <= frame.x + frame.width + 1, '긴 이름이 헤더 밖으로 나간다');
  assert.deepEqual(app.problems.all(), []);
}, UI);
