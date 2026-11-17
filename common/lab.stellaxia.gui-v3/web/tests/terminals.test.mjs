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

test('노드 셸 창 — 시안(연결 없음): 열 수 없고 이유만, 셸 출력을 지어내지 않는다', () => {
  const { c, done } = make({}); try {
    assert.equal(c.nodeShell(), null);
    const P = c.nsPanel(); assert.equal(P.kind, 'sim'); assert.equal(P.canOpen, false); assert.match(P.text, /시안/);
    assert.ok(!/Linux|192\.168|inet /.test(JSON.stringify(c.state)), '시안에서도 셸 출력을 지어내지 않는다');
  } finally { done(); }
});

test('노드 셸 창 — 템플릿: 입력 줄은 Terra 터미널만, 노드 셸은 격자 · 숨은 입력 칸 · 경고 띠, 열리지 않은 판에 다음 걸음 단추', () => {
  assert.match(src, /<sc-if value="\{\{w\.isTT\}\}"[\s\S]*?<sc-for list="\{\{w\.lines\}\}"/);
  assert.match(src, /<sc-if value="\{\{w\.open\}\}"[\s\S]*?<input type="text" aria-label="명령 입력"/);
  const live = /<sc-if value="\{\{w\.ns\.live\}\}"[\s\S]*?<\/textarea>/.exec(src); assert.ok(live, '노드 셸 격자');
  assert.match(live[0], /\{\{w\.ns\.elevText\}\}/); assert.match(live[0], /<textarea aria-label="노드 셸 입력"/); assert.match(live[0], /onKeyDown="\{\{w\.ns\.key\}\}"/); assert.match(live[0], /onCompositionEnd="\{\{w\.ns\.compEnd\}\}"/);
  const lock = /<sc-if value="\{\{w\.locked\}\}"[\s\S]*?(?=<sc-if value="\{\{w\.open\}\}")/.exec(src); assert.ok(lock, '열리지 않은 판');
  assert.ok(!/<input/.test(lock[0]), '열리지 않은 판에 입력 칸 없음'); assert.match(lock[0], /\{\{w\.lockWhy\}\}/); assert.match(lock[0], /onClick="\{\{w\.shellAsk\}\}"/); assert.match(lock[0], /\{\{w\.btn\}\}/);
  assert.ok(!/commands\.execute\.post'/.test(parseBoard(src).script));
  assert.ok(!/NODE_SHELL_LOCK|sampleShell|runCmd/.test(src), '낡은 잠금 시안 · runCmd 없음');
});

test('시안(실제 연결 없음) — Terra 터미널은 예시라고 밝히고 셸 문법은 거절', () => {
  const { c, done } = make({}); try {
    c.liveRec = () => null;
    c.runTerra('frob'); assert.match(texts(c, 'tterm').pop(), /^\(시안\) frob/);
    c.runTerra('status; ls'); assert.match(texts(c, 'tterm').pop(), /^SHELL_SYNTAX/);
    c.runTerra('terra module install a.tpkg'); assert.match(texts(c, 'tterm').pop(), /^NOT_HERE — .*여기서 불가/);
    c.runTerra('node list'); assert.doesNotMatch(texts(c, 'tterm').pop(), /^NOT_HERE/);
    c.runTerra('help'); assert.ok(texts(c, 'tterm').some((t) => /terra shell 낱말/.test(t)));
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

test('Terra 터미널 도움말 — 보드의 시안 목록과 src/api/shells.js TERRA_HELP 가 같은 명령을 든다', async () => {
  const { TERRA_HELP } = await import('../src/api/shells.js');
  const head = (L) => L.slice(1).map((l) => l.trim().split(/\s{2,}/)[0]);
  const sample = new Function(src.slice(src.indexOf('const TERRA_HELP_SAMPLE = '), src.indexOf(';', src.indexOf('const TERRA_HELP_SAMPLE = ')) + 1) + '\nreturn TERRA_HELP_SAMPLE;')();
  for (const h of head(sample)) assert.ok(head(TERRA_HELP).some((x) => x.startsWith(h.split(' ')[0])), h);
});

test('노드 셸 창(보드) — 열기 → 격자 · 경고 띠 · 입력 → 창 닫기가 세션을 지운다 / 스위치 꺼짐이면 스위치 단추', async () => {
  const { createNodeShell, shellPanel, keyBytes } = await import('../src/api/node-shell.js');
  const calls = [], sent = []; let hand = null;
  const ctl = Object.assign(createNodeShell({
    invoke: async (op, input) => { calls.push([op, input]); if (op.endsWith('sessions.post')) return { session: { session_id: 'ts_b', shell: 'bash', cols: input.cols, rows: input.rows }, elevated: true, warning: 'root 로 돎' }; return {}; },
    streamIO: async (op, input, h) => { hand = h; return { send: (v) => sent.push(v), close() {} }; }, setTimeout: (f) => { f(); return 1; }, clearTimeout: () => {} }), { panel: shellPanel, keyBytes });
  const asked = [];
  const { c, done } = make({ TerraNodeShell: ctl, TerraCanApprove: () => true, TerraDangerAsk: (k) => { asked.push(k); return true; } }); try {
    c.liveRec = () => ({}); c.real = () => false; c.persist = () => {}; c.renderVals(); delete c.closeWin;   // 처음 그리기가 보기 상태를 불러온다 — 그 뒤에 창을 둔다 · closeWin 은 진짜로(세션 정리를 본다)
    c.state.wins = { term: { fx: 0, fy: 0, fw: .6, fh: .7, min: false, max: false } }; c.state.order = ['term'];
    const w0 = () => c.renderVals().wins.find((w) => w.isTerm);
    assert.equal(w0().locked, true); assert.equal(w0().btnOn, true); assert.match(w0().tLabel, /닫힘/);   // 아직 안 열림 — 열기 단추
    await c.openShell(); assert.equal(ctl.state().phase, 'live');
    const z = c.nsCells(true); assert.deepEqual(calls[0], ['terra.daemon.terminal.sessions.post', { cols: c.nsCells(false).cols, rows: c.nsCells(false).rows }]);
    hand.onMessage(new TextEncoder().encode('hi\x1b[31m!').buffer);
    const w = w0(); assert.equal(w.locked, false); assert.equal(w.ns.live, true); assert.equal(w.ns.elevated, true); assert.match(w.ns.elevText, /관리자 · root 셸 — root 로 돎/);
    assert.equal(w.tBadge, '관리자 · root'); assert.equal(w.ns.rows[0].runs.map((r) => r.t).join('').trim(), 'hi!'); assert.match(w.ns.rows[0].runs.find((r) => r.t === '!').st, /color:#e5604f/);
    let pd = 0; w.ns.key({ key: 'ArrowUp', preventDefault: () => { pd++; } }); assert.equal(pd, 1); assert.equal(new TextDecoder().decode(sent.at(-1)), '\x1b[A');
    w.ns.key({ key: 'a', preventDefault: () => { pd++; } }); assert.equal(pd, 1, '글자는 입력 칸이 받는다');
    const ta = { value: '한', }; w.ns.input({ isComposing: false, target: ta }); assert.equal(new TextDecoder().decode(sent.at(-1)), '한'); assert.equal(ta.value, '');
    c.closeWin('term'); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.at(-1), ['terra.daemon.terminal.sessions.by-session-id.delete', { session_id: 'ts_b' }]);
    assert.equal(ctl.state().phase, 'idle');
    // 스위치 꺼짐 → 이유 + 위험 영역 단추
    const off = createNodeShell({ invoke: async () => { throw Object.assign(new Error('x'), { code: 'NODE_SHELL_DISABLED' }); }, streamIO: async () => { throw new Error('no'); } });
    ctl.open = off.open; ctl.state = off.state; ctl.subscribe = off.subscribe; ctl.reset = off.reset;
    c.state.wins = { term: { fx: 0, fy: 0, fw: .6, fh: .7, min: false, max: false } }; c.state.order = ['term'];
    await c.openShell().catch(() => {});
    const w2 = w0(); assert.equal(w2.locked, true); assert.match(w2.lockWhy, /꺼져 있음 — 위험 영역에서 켜기/); assert.equal(w2.btn, '위험 영역에서 켜기 ›');
    w2.shellAsk(); assert.deepEqual(asked, ['nodeShell']);
  } finally { done(); }
  assert.match(src, /X\.dzS = row\('nodeShell'\)/); assert.match(src, /\{\{w\.nx\.dzS\.label\}\}/);
});

test('노드 셸 창 — 줄 간격: 템플릿 줄바꿈 글자가 빈 줄이 되지 않는다(칸 격자는 줄 div 안에서만 pre)', () => {
  const live = /<sc-if value="\{\{w\.ns\.live\}\}"[\s\S]*?<\/textarea>/.exec(src); assert.ok(live, '노드 셸 격자');
  const log = /<div role="log"[^>]*style="([^"]*)"/.exec(live[0]); assert.ok(log, '화면 영역');
  assert.ok(!/white-space:\s*pre/.test(log[1]), 'role=log 에 white-space:pre 가 있으면 sc-for 사이의 공백 글자가 줄마다 빈 줄 하나(또는 둘)로 보인다');
  const row = /<sc-for list="\{\{w\.ns\.rows\}\}"[^>]*>\s*<div style="([^"]*)"/.exec(live[0]); assert.ok(row, '줄 div');
  assert.match(row[1], /white-space:\s*pre/); assert.match(row[1], /height:\s*19px/);   // 줄 높이 19px · 칸 안의 빈칸은 그대로
});
