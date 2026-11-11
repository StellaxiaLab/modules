// node --test — 이 PC 에만 남는 제어기 상태(설계 node-owned-desk.md §5 · §14): 키 모양 · 이행 삭제 · 로그아웃 삭제 · 순서
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { PC, deskKey, termPrefix, encPrincipal, clearTerm, migratePc, pcLogout } from './pc-state.js';
import { boardModule } from '../../tools/dc-board.mjs';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('이행 — 처음 한 번 terra.view.desk.* · terra.wall.* 만 지우고 표시한다', () => {
  const st = mem({ 'terra.view.desk.T1': '{}', 'terra.view.desk.P1:ws': '{}', 'terra.wall.ws-a': 'x', 'terra.theme': 'dark', 'terra.cache': '{}', 'terra.view.other': '1', 'terra.pc.desk.n1': '{}' });
  assert.equal(migratePc(st), true);
  assert.deepEqual([...st.m.keys()].sort(), ['terra.cache', 'terra.pc.desk.n1', 'terra.pc.migrated', 'terra.theme', 'terra.view.other']);
  st.setItem('terra.view.desk.T9', 'back'); st.setItem('terra.wall.again', 'back');
  assert.equal(migratePc(st), false, '두 번째부터는 건드리지 않는다');
  assert.ok(st.m.has('terra.view.desk.T9') && st.m.has('terra.wall.again'));
  assert.equal(migratePc(null), false);
});

test('터미널 삭제 — 그 계정 것만(접두사가 겹치는 다른 계정 · 같은 계정의 PC 창 상태는 남긴다)', () => {
  const a = termPrefix('user:a'), ab = termPrefix('user:a.b');
  const st = mem({ [a + 'n1']: '1', [a + 'n2']: '2', [ab + 'n1']: '3', [deskKey('n1')]: '4', 'terra.theme': 'x' });
  assert.ok(!ab.startsWith(a), "'.' 까지 바꿔 한 계정의 접두사가 다른 계정 것과 겹치지 않는다 — " + a + ' / ' + ab);
  assert.equal(clearTerm(st, 'user:a'), 2);
  assert.deepEqual([...st.m.keys()].sort(), [ab + 'n1', deskKey('n1'), 'terra.theme'].sort());
  assert.equal(clearTerm(st, ''), 0); assert.equal(clearTerm(st, null), 0, 'principal 을 모르면 아무것도 지우지 않는다');
  assert.equal(st.m.size, 3);
});

test('로그아웃 — 신호(타이머 취소) → 삭제 → TerraWho = null 순서', () => {
  const order = [], st = mem({ [termPrefix('u') + 'n1']: 'x', [deskKey('n1')]: 'y' });
  const win = { TerraWho: { principal: 'u' }, dispatchEvent: (e) => { order.push(e.type + ':' + (st.m.has(termPrefix('u') + 'n1') ? 'term있음' : 'term없음') + ':' + (win.TerraWho ? 'who있음' : 'who없음')); return true; } };
  pcLogout(win, st);
  assert.deepEqual(order, ['terra-pc-logout:term있음:who있음'], '신호 때는 아직 아무것도 지워지지 않았다 — 제어기가 타이머를 먼저 취소한다');
  assert.equal(st.m.has(termPrefix('u') + 'n1'), false); assert.equal(win.TerraWho, null); assert.ok(st.m.has(deskKey('n1')), 'PC 창 상태는 지우지 않는다');
  pcLogout(win, st);   // 두 번째 길(onToken(null) 등) — principal 이 없어 아무것도 지우지 않고 던지지 않는다
  assert.ok(st.m.has(deskKey('n1')));
});

test('키 모양 — TerraNodes.pcDesk · pcTerm 이 pc-state 와 같다(terra.pc.<키>)', async () => {
  globalThis.localStorage = mem(); globalThis.window = globalThis;
  const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, addEventListener() {} });
  globalThis.document = { visibilityState: 'visible', createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el(), addEventListener() {}, removeEventListener() {} };
  const RT = pathToFileURL(fileURLToPath(new URL('../ui/dc/runtime.js', import.meta.url))).href, { boardDef } = await import(RT);
  const f = join(mkdtempSync(join(tmpdir(), 'pcs-')), 'TerraNodes.mjs');
  writeFileSync(f, boardModule(readFileSync(fileURLToPath(new URL('../../design/TerraNodes.dc.html', import.meta.url)), 'utf8'), 'TerraNodes', RT));
  await import(pathToFileURL(f).href);
  delete window.TerraNodes; window.TerraTransport = { kind: 'gateway', localId: () => '' };
  new (boardDef('TerraNodes').Logic)({}); const T = window.TerraNodes;
  assert.equal(PC + T.pcDesk('n1'), deskKey('n1'));
  for (const p of ['user:admin', 'a.b', 'x/y z']) assert.equal(PC + T.pcTerm(p, 'n1'), termPrefix(p) + 'n1', p);
  assert.equal(encPrincipal('a.b'), 'a%2Eb');
  T.setView(T.pcDesk('n1'), { wins: { a: 1 } });
  assert.deepEqual(JSON.parse(localStorage.getItem('terra.pc.desk.n1')), { wins: { a: 1 } }, '이 브라우저에만 — terra.pc.* 에 쓴다');
  assert.equal(localStorage.getItem('terra.view.desk.n1'), null, '옛 키에는 쓰지 않는다');
  assert.equal(window.TerraTransport.saveView, undefined);
});
