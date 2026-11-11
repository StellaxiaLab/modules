// node --test — 제어기 창이 노드 id(rid)를 Embed 로 넘기고, 열려 있는 동안 TerraNodes.watch 한다(설계 node-owned-desk.md §8 · §9.2).
//   Scene.dc.html · Field.dc.html 은 build/mkglobal.py 가 굽는다 — 둘 다(그리고 원본)가 같은 줄을 갖는지, 창 수명과 watch 가 짝이 맞는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';

const rd = (p) => readFileSync(fileURLToPath(new URL('../design/' + p, import.meta.url)), 'utf8');
const SCENE = rd('Scene.dc.html'), FIELD = rd('Field.dc.html'), MK = rd('build/mkglobal.py'), LOGIN = rd('build/mklogin.py');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const klass = (html) => new Function('DCLogic', parseBoard(html).script + '\nreturn Component;')(DCLogic);

test('슬롯 — 제어기 자리마다 node-rid 를 ctlRid<번호> 로 받는다(Field · 구운 Scene 둘 다, 같은 번호)', () => {
  for (const [name, h] of [['Field', FIELD], ['Scene', SCENE]]) {
    const slots = [...h.matchAll(/<dc-import name="NodeDesktopEmbed"[^>]*>/g)].map((m) => m[0]);
    assert.equal(slots.length, 6, name + ' 슬롯 수');
    slots.forEach((t, i) => {
      assert.ok(t.includes('node-key="{{ctlKey' + i + '}}" node-rid="{{ctlRid' + i + '}}"'), name + ' 슬롯 ' + i + ' — ' + t.slice(0, 80));
      assert.equal((t.match(/node-rid=/g) || []).length, 1);
    });
  }
  assert.match(MK, /node-rid="\{\{ctlRid/, 'mkglobal.py 가 다시 구워도 사라지지 않게');
  assert.match(parseBoard(rd('NodeDesktopEmbed.dc.html')).script.length > 0 ? rd('NodeDesktopEmbed.dc.html') : '', /"nodeRid":\{"editor":"text","default":""\}/, 'Embed 가 nodeRid 를 선언한다');
});

test('창을 열 때 ctlRid 가 정해져 고정된다 — 이후 지도가 바뀌어(순번이 밀려) 장면 id 가 달라져도 그 슬롯의 rid 는 그대로', () => {
  for (const [name, h, pre] of [['Field', FIELD, ''], ['Scene', SCENE, 'gf_']]) {
    const C = klass(h), c = Object.create(C.prototype), S = {};
    c.state = S; c.setState = (p) => Object.assign(S, p);
    assert.match(h, /\['ctlRid' \+ k\]: node\.rid \|\| ''/, name + ' — 열 때 노드의 rid 를 담는다');
    const props = c[pre + 'ctlProps'].call(Object.assign(c, { CTLN: () => 6, [pre + 'CTLN']: () => 6, TN: () => null, [pre + 'TN']: () => null }));
    for (let k = 0; k < 6; k++) assert.equal(props['ctlRid' + k], '', name + ' — 빈 자리는 빈 값(§9.1)');
    S.ctlRid2 = 'rid-A'; S.ctlKey2 = 'T3';
    assert.equal(c[pre + 'ctlProps']().ctlRid2, 'rid-A');
    S.ctlKey2 = 'T4';   // 노드가 추가돼 순번이 밀림 — 장면 id 만 달라진다
    assert.equal(c[pre + 'ctlProps']().ctlRid2, 'rid-A', name + ' — rid 는 창을 열 때 한 번 정해져 그대로');
  }
});

/** Field · Scene 의 watch 짝 — 열 때 watch, 닫을 때(winDrop) unwatch, 같은 노드 한 번만 · 최소화는 열린 것 · 로그아웃 때 전부 */
function watchTest(name, h, pre) {
  test(name + ' — 제어기 창이 열려 있는 동안 TerraNodes.watch, 닫을 때 unwatch(짝이 맞는다)', () => {
    const C = klass(h), c = Object.create(C.prototype), calls = [];
    globalThis.window = globalThis; window.TerraNodes = { watch: (r, o) => calls.push(['w', r, o.scene]), unwatch: (r) => calls.push(['u', r]) };
    try {
      const A = { id: 'T3', rid: 'rid-A', name: 'a' }, B = { id: 'T4', rid: 'rid-B', name: 'b' }, Root = { id: 'root', rid: '', name: '계정' };
      const w = (n, on) => c[pre + 'ctlWatch'](n, on);
      w(Root, true); assert.deepEqual(calls, [], 'rid 없는 자리(계정 루트)는 부르지 않는다(§9.1)');
      w(A, true); w(A, true); assert.deepEqual(calls, [['w', 'rid-A', 'T3']], '같은 노드를 두 번 열어도(슬롯 재사용) 한 번만 센다');
      w(B, true); w(A, false); w(A, false); assert.deepEqual(calls.slice(1), [['w', 'rid-B', 'T4'], ['u', 'rid-A']], '닫힌 것만 unwatch, 두 번 닫아도 한 번');
      // 창 기록을 버릴 때(×) — winDrop 이 ctl 만 unwatch 한다. 최소화(winPut 'min')는 부르지 않으므로 열린 것으로 친다
      const WL = pre ? '_q_wins' : '_wins';   // 구운 Scene 은 필드에 _q_ 가 붙는다
      c[WL] = [{ node: B, kind: 'ctl', arg: '' }, { node: B, kind: 'conf', arg: '' }];
      c[pre + 'winDrop'](B, 'conf'); assert.equal(calls.length, 3, '다른 종류의 창을 닫는다고 제어기 watch 가 풀리지 않는다'); assert.equal(c[WL].length, 1);
      c[pre + 'winDrop'](B, 'ctl'); assert.deepEqual(calls.at(-1), ['u', 'rid-B']); assert.equal(c[WL].length, 0);
      // 로그아웃 — 남은 것을 전부
      w(A, true); w(B, true); calls.length = 0; c[pre + 'ctlWatchAll'](); assert.deepEqual(calls.map((x) => x[0] + x[1]).sort(), ['urid-A', 'urid-B']);
      c[pre + 'ctlWatchAll'](); assert.equal(calls.length, 2, '비운 뒤 또 불러도 아무 일 없음');
    } finally { delete window.TerraNodes; }
  });
}
watchTest('Field', FIELD, '');
watchTest('Scene(구운 것)', SCENE, 'gf_');

test('열기 · 닫기 · 로그아웃 연결 — ctlOpenWin 이 watch 를 걸고, sceneLogout · cmdDispose 가 푼다(원본 mklogin.py · Field 에도)', () => {
  assert.match(FIELD, /this\['_ctlNode' \+ k\] = node; this\.ctlWatch\(node, true\);/);
  assert.match(SCENE, /this\['_ctlNode' \+ k\] = node; this\.gf_ctlWatch\(node, true\);/);
  assert.match(SCENE, /sceneLogout\(\) \{ if \(this\.loginOn\(\)\) return; this\.gf_ctlCloseAll\(\); this\.gf_ctlWatchAll\(\);/);
  assert.match(LOGIN, /this\.gf_ctlCloseAll\(\); this\.gf_ctlWatchAll\(\);/, '원본 mklogin.py 에도(다시 구워도 남게)');
  assert.match(FIELD, /cmdDispose\(\) \{ this\.ctlCloseAll\(\); this\.ctlWatchAll\(\);/);
  assert.match(FIELD, /winDrop\(node, kind\) \{ if \(\(kind \|\| 'ctl'\) === 'ctl'\) this\.ctlWatch\(node, false\);/);
});
