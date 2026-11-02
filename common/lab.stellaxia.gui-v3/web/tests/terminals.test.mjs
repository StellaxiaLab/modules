// node --test — 제어기의 두 터미널(NodeDesktopEmbed): 노드 터미널 · Terra 터미널 · 아래 바 크기
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

test('노드 터미널 — 실제면 TerraShells.node.run, 출력 줄을 나눠 붙이고 종료 코드', async () => {
  const runs = [];
  const shells = { node: { can: () => true, run: async (rid, line, o) => { runs.push([rid, line, o.cwd]); o.onChunk({ stream: 'stdout', text: 'a\nb' }); o.onChunk({ stream: 'stdout', text: 'c\n' }); o.onChunk({ stream: 'stderr', text: 'oops\n' }); return { state: 'failed', exit: 2 }; }, cd: async () => '/srv' } };
  const { c, done } = make({ TerraShells: shells }); try {
    c.liveRec = () => ({}); c.shellRid = () => 'n-1'; c.state.termCwd = '/home/u';
    c.runCmd('ls'); await tick(); await tick();
    assert.deepEqual(runs, [['n-1', 'ls', '/home/u']]);
    assert.deepEqual(texts(c, 'term').slice(-5), [c.acct() + '@desk:/home/u$ ls', 'a', 'bc', 'oops', '[종료 코드 2]']);   // 줄이 끝나야 붙이고, 남은 조각은 끝날 때
    c.runCmd('cd /srv'); await tick(); await tick(); assert.equal(c.state.termCwd, '/srv');
  } finally { done(); }
});

test('노드 터미널 — 다른 노드면 열지 않고 Terra 터미널로 안내(commands.execute 는 그 노드에서만)', () => {
  const { c, done } = make({ TerraShells: { node: { can: () => false, run: () => { throw new Error('불렸으면 안 됨'); } } } }); try {
    c.liveRec = () => ({}); c.shellRid = () => 'n-other';
    c.runCmd('ls'); assert.match(texts(c, 'term').pop(), /여기서 열 수 없다 — .*commands\.execute.*Terra 터미널/);
  } finally { done(); }
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

test('시안(실제 연결 없음) — 예시라고 밝히고, Terra 명령을 노드 셸 흉내로 답하지 않는다', () => {
  const { c, done } = make({}); try {
    c.liveRec = () => null;
    c.runCmd('terra status'); assert.match(texts(c, 'term').pop(), /^\(시안\) terra — 실제 연결에서는 이 노드의 셸이 실행한다/);
    c.runTerra('frob'); assert.match(texts(c, 'tterm').pop(), /^\(시안\) frob/);
    c.runTerra('help'); assert.ok(texts(c, 'tterm').some((t) => /terra shell 과 같은 낱말/.test(t)));
  } finally { done(); }
});

test('Terra 터미널 도움말 — 보드의 시안 목록과 src/api/shells.js TERRA_HELP 가 같은 명령을 든다', async () => {
  const { TERRA_HELP } = await import('../src/api/shells.js');
  const head = (L) => L.slice(1).map((l) => l.trim().split(/\s{2,}/)[0]);
  const sample = new Function(src.slice(src.indexOf('const TERRA_HELP_SAMPLE = '), src.indexOf(';', src.indexOf('const TERRA_HELP_SAMPLE = ')) + 1) + '\nreturn TERRA_HELP_SAMPLE;')();
  for (const h of head(sample)) assert.ok(head(TERRA_HELP).some((x) => x.startsWith(h.split(' ')[0])), h);
});
