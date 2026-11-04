// node --test — 제어기의 두 터미널(NodeDesktopEmbed): 노드 터미널(잠김) · Terra 터미널 · 아래 바 크기
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';

const src = readFileSync(fileURLToPath(new URL('../design/NodeDesktopEmbed.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const Desk = () => new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic);
const make = (win, props) => {
  const prev = globalThis.window; globalThis.window = win;
  const C = Desk(), c = new C(Object.assign({ nodeName: 'desk', winW: 1240, winH: 760 }, props)); c.persist = () => {}; c.closeWin = () => {};
  return { c, done: () => { globalThis.window = prev; } };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const texts = (c, k) => c.state[k].map((l) => l.t);

test('아래 바 — 단추 수만큼 길이, 안에 다 들어가고, 작은 창에서는 함께 줄어든다', () => {
  const { c, done } = make({}); try {
    const n = 10, b = c.dockBox(); assert.equal(b.w, n * b.S + (n - 1) * b.gap + b.pad * 2); assert.equal(b.S, 42);
    const { c: s, done: d2 } = make({}, { winW: 620, winH: 420, chrome: 'none' }); try { const q = s.dockBox(); assert.ok(q.S < 42 && q.S >= 26); assert.ok(q.w <= 620 - 24); assert.ok(s.workBox().h + 32 + q.th + 16 <= 420); } finally { d2(); }
  } finally { done(); }
});

test('노드 터미널 — 잠김: 입력 줄 대신 이유 · 대신 할 곳 · 설계 문서, 들어온 줄도 실행하지 않는다', () => {
  const ran = [];
  const shells = { NODE_SHELL: { locked: true, reason: '잠김 이유', design: 'docs/design/node-shell.md', instead: ['가', '나'] }, node: { can: () => true, run: async () => { ran.push(1); return {}; } }, terra: { run: async () => ({ lines: [] }) } };
  const { c, done } = make({ TerraShells: shells }); try {
    c.liveRec = () => ({});
    c.runCmd('ls -la'); assert.equal(ran.length, 0, '노드 셸은 실행하지 않는다');
    assert.deepEqual(texts(c, 'term').slice(-3), ['잠김 이유 · 실행 안 함', '  · 가', '  · 나']);
    c.runCmd('clear'); assert.deepEqual(c.state.term, []);
  } finally { done(); }
});

test('노드 터미널 창 — 잠금 판만, 입력 줄 없음(시안도) · Terra 터미널 창은 입력 줄', () => {
  const { c, done } = make({}); try {
    assert.equal(c.nodeShell().locked, true);
    c.runCmd('uname -a'); assert.ok(texts(c, 'term').some((t) => /^잠김 : 설계 필요 — .* · 실행 안 함$/.test(t)));
    assert.ok(!texts(c, 'term').some((t) => /Linux|192\.168|inet /.test(t)), '시안에서도 셸 출력을 지어내지 않는다');
  } finally { done(); }
  const m = /<sc-if value="\{\{w\.locked\}\}"[\s\S]*?<\/sc-if>/.exec(src); assert.ok(m, '잠금 판'); assert.ok(!/<input/.test(m[0]), '잠금 판에 입력 칸 없음');
  assert.match(m[0], /\{\{w\.lockWhy\}\}/); assert.match(m[0], /\{\{w\.lockDoc\}\}/);
  assert.match(src, /<sc-if value="\{\{w\.open\}\}"[\s\S]*?<input type="text" aria-label="명령 입력"/);
  assert.match(src, /o\.locked = lock; o\.open = !lock;/);
  assert.ok(!/commands\.execute\.post'/.test(parseBoard(src).script), '보드가 commands.execute 를 부르지 않는다');
  assert.ok(!/sampleShell/.test(src));
});

test('Terra 터미널 — TerraShells.terra.run 결과 · use · !! · 히스토리', async () => {
  const seen = [];
  const shells = { node: { can: () => true }, terra: { run: async (line, cx) => { seen.push([line, cx.cur]); if (line.startsWith('use')) return { lines: [{ t: '현재 노드 = server', c: 'dim' }], cur: 'n-srv', curName: 'server' }; return { lines: [{ t: 'ok ' + line, c: 'out' }] }; } } };
  const { c, done } = make({ TerraShells: shells }); try {
    c.liveRec = () => ({});
    c.runTerra('node list'); await tick(); c.runTerra('use server'); await tick(); c.runTerra('!!'); await tick();
    assert.deepEqual(seen, [['node list', ''], ['use server', ''], ['use server', 'n-srv']]);
    assert.equal(c.state.ttCurName, 'server'); assert.deepEqual(c.state.ttHist, ['node list', 'use server', 'use server']);
    assert.ok(texts(c, 'tterm').includes('terra[server]> use server'));
  } finally { done(); }
});

test('시안(실제 연결 없음) — 노드 셸은 잠금, Terra 터미널은 예시라고 밝히고 셸 문법은 거절', () => {
  const { c, done } = make({}); try {
    c.liveRec = () => null;
    c.runCmd('terra status'); assert.ok(texts(c, 'term').some((t) => /^잠김 : 설계 필요 — .* · 실행 안 함$/.test(t)));
    c.runTerra('frob'); assert.match(texts(c, 'tterm').pop(), /^\(시안\) frob/);
    c.runTerra('status; ls'); assert.match(texts(c, 'tterm').pop(), /^SHELL_SYNTAX/);
    c.runTerra('terra module start io.terra.agent'); assert.match(texts(c, 'tterm').pop(), /^NOT_HERE — .*여기서 불가/);
    c.runTerra('node list'); assert.doesNotMatch(texts(c, 'tterm').pop(), /^NOT_HERE/);
    c.runTerra('help'); assert.ok(texts(c, 'tterm').some((t) => /terra shell 낱말/.test(t)));
  } finally { done(); }
});

test('보드의 잠금 문구 — src/api/shells.js NODE_SHELL 과 같다(캔버스에도 같은 이유)', async () => {
  const { NODE_SHELL } = await import('../src/api/shells.js');
  const { c, done } = make({}); try { const L = c.nodeShell(); assert.equal(L.reason, NODE_SHELL.reason); assert.equal(L.design, NODE_SHELL.design); assert.deepEqual(L.instead, [...NODE_SHELL.instead]); } finally { done(); }
});

test('Terra 터미널 도움말 — 보드의 시안 목록과 src/api/shells.js TERRA_HELP 가 같은 명령을 든다', async () => {
  const { TERRA_HELP } = await import('../src/api/shells.js');
  const head = (L) => L.slice(1).map((l) => l.trim().split(/\s{2,}/)[0]);
  const sample = new Function(src.slice(src.indexOf('const TERRA_HELP_SAMPLE = '), src.indexOf(';', src.indexOf('const TERRA_HELP_SAMPLE = ')) + 1) + '\nreturn TERRA_HELP_SAMPLE;')();
  for (const h of head(sample)) assert.ok(head(TERRA_HELP).some((x) => x.startsWith(h.split(' ')[0])), h);
});
