// node --test — 셸이 연 웹 앱 창(Node Talk)의 최소화가 gui-v3 '최소화 창'에 합쳐진다.
//   src/api/shell-minimized.js(frame.minimized 잇기) + Field/Scene 의 winFind · winTitle · winOpen · 폴더.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { createShellMin } from '../src/api/shell-minimized.js';

const rd = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }

// frame.minimized 가짜 — 셸이 목록을 밀어 넣고, 웹이 take · restore · close 를 보낸다
function fakeFrame(initial = []) {
  const M = { _list: initial, _l: new Set(), taken: [], restored: [], closed: [],
    list: () => M._list.map((x) => ({ ...x })), onChange: (l) => { M._l.add(l); return () => M._l.delete(l); },
    take: (on) => M.taken.push(on !== false), restore: (id) => M.restored.push(id), close: (id) => M.closed.push(id),
    push: (next) => { M._list = next; M._l.forEach((l) => l(next)); } };
  return { frame: { minimized: M }, M };
}

test('셸이 minimize 기능을 말하지 않으면 null — 셸 트레이가 그대로 일한다', () => {
  assert.equal(createShellMin({}), null);
  assert.equal(createShellMin(null), null);
});

test('선언(take)하고, 목록이 바뀌면 알리고, 되살리기 · 닫기는 셸로 되돌린다', () => {
  const { frame, M } = fakeFrame([{ id: 'app.talk', title: 'Node Talk' }]);
  let t = 100, notified = 0;
  const S = createShellMin(frame, { now: () => t, notify: () => { notified++; } });
  assert.deepEqual(M.taken, [true]);   // 목록을 보인다고 선언 → 셸 트레이 숨김
  assert.deepEqual(S.list(), [{ id: 'app.talk', title: 'Node Talk', nodeName: '', at: 100 }]);
  t = 200; M.push([{ id: 'app.talk', title: 'Node Talk' }, { id: 'remote:n1/m/a', title: 'Files', nodeName: 'n1' }]);
  assert.equal(notified, 1);
  assert.deepEqual(S.list().map((w) => [w.id, w.at, w.nodeName]), [['app.talk', 100, ''], ['remote:n1/m/a', 200, 'n1']]);   // 처음 본 시각이 유지된다
  S.restore('app.talk'); S.close('remote:n1/m/a');
  assert.deepEqual([M.restored, M.closed], [['app.talk'], ['remote:n1/m/a']]);
  S.release(); assert.deepEqual(M.taken, [true, false]);
});

function board() {
  const Field = new Function('DCLogic', parseBoard(rd('Field')).script + '\nreturn Component;')(DCLogic);
  const F = Object.create(Field.prototype); F.props = {}; F.state = {}; F._live = true; F.dataLayout = () => {};
  return F;
}
const withWindow = (fn) => { const prev = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }; try { return fn(globalThis.window); } finally { globalThis.window = prev; } };

test('최소화 창 목록 — 셸 항목이 제어기 창과 함께 뜨고, 종류 이름은 앱 · 찾기도 된다', () => withWindow((win) => {
  const { frame } = fakeFrame([{ id: 'app.talk', title: 'Node Talk' }]);
  win.TerraShellMin = createShellMin(frame, { now: () => 5 });
  const F = board(); F._wins = [{ id: 'w1', node: { name: 'desk' }, kind: 'ctl', st: 'min', at: 1 }];
  const mins = F.winFind('', 'min');
  assert.deepEqual(mins.map((e) => e.id), ['shell:app.talk', 'w1']);   // 최근 것이 앞
  assert.equal(F.winName(mins[0]), 'Node Talk');
  assert.equal(F.WINKIND().shell, '앱');
  assert.equal(F.winFind('node talk', 'min').length, 1);
  assert.equal(F.winFind('', 'open').length, 0);   // 셸 항목은 늘 최소화
}));

test('되살리기 — 셸 항목이면 셸에 되돌리고 제어기 창을 열지 않는다', () => withWindow((win) => {
  const { frame, M } = fakeFrame([{ id: 'app.talk', title: 'Node Talk' }]);
  win.TerraShellMin = createShellMin(frame, { now: () => 5 });
  const F = board(); F._flyPin = true; let opened = 0; F.ctlOpenWin = () => { opened++; };
  F.winOpen(F.winFind('', 'min')[0]);
  assert.deepEqual(M.restored, ['app.talk']); assert.equal(opened, 0);
}));

test('최소화 폴더 — 셸 항목은 전역 모드에만 보이고(지역 모드는 노드 아래 창만), 열면 셸로 간다', () => withWindow((win) => {
  const { frame } = fakeFrame([{ id: 'app.talk', title: 'Node Talk' }]);
  win.TerraShellMin = createShellMin(frame, { now: () => 5 });
  const F = board();
  const kids = F.ctlKids({ type: 'wdir', scope: null });
  assert.equal(kids.length, 1); assert.equal(kids[0].name, 'Node Talk'); assert.equal(kids[0].more, '최소화');
  assert.equal(F.ctlKids({ type: 'wdir', scope: { id: 'some-node' } }).length, 0);
}));

test('Scene 은 Field 를 다시 구운 것이므로 같은 합침을 갖는다(gf_ 접두)', () => {
  const S = rd('Scene');
  // 줄 누르기는 gf_wins 가 아니라 winFind(셸 항목 포함)에서 찾는다 — 실기에서 셸 항목 줄이 안 눌리던 결함
  for (const m of ['gf_shellMins()', 'gf_winName(e)', "if (e.shell) { if (window.TerraShellMin) window.TerraShellMin.restore(e.sid)", "this.gf_winOpen(this.gf_winFind('', 'min').find((e) => e.id === mr.id))"]) assert.ok(S.includes(m), m);
  const m = JSON.parse(readFileSync(fileURLToPath(new URL('../../module.json', import.meta.url)), 'utf8')), go = readFileSync(fileURLToPath(new URL('../../src/main.go', import.meta.url)), 'utf8');
  assert.ok(go.includes('moduleVersion = "' + m.version + '"'));
});
