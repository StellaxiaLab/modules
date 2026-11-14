// node --test — AUD-75: 바탕 우클릭 메뉴의 '앱 목록' 이 deskClick 으로 번져 런처가 열리지 않던 결함.
//   메뉴 상자는 클릭을 바탕으로 올려 보내지 않아야 하고(stop), 항목 실행 뒤 lau 가 true 로 남아야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';

const src = readFileSync(fileURLToPath(new URL('../design/NodeDesktopEmbed.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Desk = new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic);

test('AUD-75 메뉴 상자 클릭은 바탕으로 번지지 않는다', () => {
  const c = new Desk({ nodeName: 'desk', winW: 1240, winH: 760 }); c.persist = () => {}; c.renderVals();
  c.setState({ menu: { x: 10, y: 50 } });
  const v = c.renderVals();
  assert.equal(typeof v.menu.stop, 'function', 'menu.stop 이 있어야 한다');
  let stopped = 0; v.menu.stop({ stopPropagation: () => { stopped++; } });
  assert.equal(stopped, 1);
  assert.match(src, /role="menu"[^>]*onClick="\{\{menu\.stop\}\}"/, '메뉴 상자에 onClick 이 묶여야 한다');
});

test('AUD-75 앱 목록 항목 → 번지는 클릭 뒤에도 lau 가 true', () => {
  const c = new Desk({ nodeName: 'desk', winW: 1240, winH: 760 }); c.persist = () => {}; c.renderVals();
  c.setState({ menu: { x: 10, y: 50 }, lau: false });
  const v = c.renderVals();
  const item = v.menu.items.find((m) => m.label === '앱 목록');
  const ev = { stopPropagation() { this.stopped = true; } };
  item.run();
  // 브라우저처럼: 상자의 핸들러(있다면)가 막지 않으면 클릭이 바탕까지 올라간다
  if (v.menu.stop) v.menu.stop(ev);
  if (!ev.stopped) v.deskClick();
  assert.equal(c.state.lau, true);
  assert.equal(c.state.menu, null);
});
