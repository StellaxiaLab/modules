// node --test — AUD-46: 제어기(NodeDesktopEmbed)가 실제 모드(Gateway 전송)에서 시안 값을 실제처럼 보이지 않는다.
//   실제 모드의 원격 노드 제어기 — 노드가 아무 값도 주지 않는데(빈 응답) 모든 앱 창을 열어 그린 결과 전체에서
//   시안 문구(backup.tar · 사용자 stk · 시각 10:36 · 지어낸 알림 · '(시안)')를 찾는다. 시안(목업) 모드는 그대로 시안을 보인다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule, parseBoard } from '../tools/dc-board.mjs';
import * as deskAdapt from '../src/api/desk-adapt.js';
import * as changes from '../src/api/changes.js';
import { gate } from '../src/api/gates.js';

const D = fileURLToPath(new URL('../design/', import.meta.url));
const src = readFileSync(join(D, 'NodeDesktopEmbed.dc.html'), 'utf8');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const script = parseBoard(src).script;
const Desk = () => new Function('DCLogic', script + '\nreturn Component;')(DCLogic);
const APPS = [...script.match(/const APPS = \{[\s\S]*?\n\};/)[0].matchAll(/^  ([A-Za-z_]\w*):\s*\{ title/gm)].map((m) => m[1]);

async function loadStore() {
  const dir = mkdtempSync(join(tmpdir(), 'tn-')), rt = join(dir, 'rt.mjs'), f = join(dir, 'TerraNodes.mjs');
  writeFileSync(rt, 'export class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState() {} }\nexport const defineBoard = (d) => d;\n');
  writeFileSync(f, boardModule(readFileSync(join(D, 'TerraNodes.dc.html'), 'utf8'), 'TerraNodes', './rt.mjs'));
  const def = (await import(pathToFileURL(f).href)).default; new def.Logic({ quiet: true });
  return globalThis.window.TerraNodes;
}

// 노드가 값을 하나도 안 주는 전송 — 모든 읽기는 빈 응답
const emptyGateway = (fail) => ({ kind: 'gateway', meta: { L: { id: 'L', name: 'desk', rid: 'nd_L' }, R: { id: 'R', name: 'far', rid: 'nd_R' } }, localId: () => 'L', calls: [], invoke(node, op) { this.calls.push([node, op]); return fail ? Promise.reject({ code: 'UNREACHABLE', status: 502, message: '노드에 닿지 못함' }) : Promise.resolve({}); } });

// 시안 문구 — 실제 모드의 화면에 나오면 안 된다
const SAMPLE = [/backup\.tar/, /\bstk\b/, /10:36/, /\(시안\)/, /시안 지도/, /화면 배치 저장됨/, /u_stk/, /nd_7f3a9c21/];
const flat = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x));

async function realDesk(props, fail) {
  globalThis.localStorage = mem();
  const t = emptyGateway(fail); globalThis.window = { TerraTransport: t };
  await loadStore();
  Object.assign(globalThis.window, { TerraDesk: deskAdapt, TerraChanges: changes, TerraGate: (op, x) => gate(op, x), TerraRisk: () => '', addEventListener() {} });
  const C = Desk(), c = new C(Object.assign({ winW: 1240, winH: 760 }, props)); c.persist = () => {};
  c.renderVals(); await tick(5); c.renderVals();
  return c;
}
const hits = (v) => { const s = flat(v); return SAMPLE.filter((re) => re.test(s)).map(String); };

test('실제 · 원격 노드 제어기 — 값이 없을 때 모든 창에 시안 문구가 없다', async () => {
  const c = await realDesk({ nodeName: 'far', nodeKey: 'R', nodeRid: 'nd_R', remote: true });
  const bad = {};
  const base = hits(c.renderVals()); if (base.length) bad.desktop = base;
  for (const app of APPS) { try { c.launch(app); } catch { continue; } await tick(2); const h = hits(c.renderVals()); if (h.length) bad[app] = h; }
    assert.deepEqual(bad, {}, '시안 문구가 실제 화면에 나온다');
});

test('실제 · 원격 노드를 읽지 못할 때(못 봤음) 모든 창에 시안 문구가 없다', async () => {
  const c = await realDesk({ nodeName: 'far', nodeKey: 'R', nodeRid: 'nd_R', remote: true }, true);
  const bad = {};
  const base = hits(c.renderVals()); if (base.length) bad.desktop = base;
  for (const app of APPS) { try { c.launch(app); } catch { continue; } await tick(2); const h = hits(c.renderVals()); if (h.length) bad[app] = h; }
  assert.deepEqual(bad, {}, '시안 문구가 실제 화면에 나온다');
});

test('실제 · 이 노드 제어기 — 값이 없을 때 모든 창에 시안 문구가 없다', async () => {
  const c = await realDesk({ nodeName: 'desk', nodeKey: 'L', nodeRid: 'nd_L' });
  const bad = {};
  for (const app of APPS) { try { c.launch(app); } catch { continue; } await tick(2); const h = hits(c.renderVals()); if (h.length) bad[app] = h; }
  assert.deepEqual(bad, {}, '시안 문구가 실제 화면에 나온다');
});

test('시안(목업) 모드는 시안을 그대로 보인다', () => {
  globalThis.localStorage = mem(); globalThis.window = { TerraDesk: deskAdapt, addEventListener() {} };
  const C = Desk(), c = new C({ nodeName: 'lab-ws-02', winW: 1240, winH: 760 }); c.persist = () => {};
  c.renderVals(); c.launch('jobs'); const s = flat(c.renderVals());
  assert.match(s, /backup\.tar/, '시안 모드의 작업 목록은 그대로');
});
