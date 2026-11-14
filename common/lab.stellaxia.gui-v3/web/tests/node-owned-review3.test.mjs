// node --test — 3차 리뷰 회귀: 편집 중 초안은 사본 밖 · 노드 설정을 못 읽으면 시안 값 대신 못 봤음 · whoami 재시도 · allPermissions
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { gate } from '../src/api/gates.js';

const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const src = rd('../design/NodeDesktopEmbed.dc.html');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
globalThis.window = globalThis;
const mk = (T) => { window.TerraNodes = T; const C = new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic); return new C({ nodeName: 'ws', nodeKey: 'T1', nodeRid: 'n1', chrome: 'none' }); };
const node = (o) => Object.assign({ real: true, node: 'ws', dirs: [{ name: 'node', path: '/srv' }], memos: '', localFs: false, dirsBase: null, mods: [], devs: [], parts: ['config'] }, o);

test('1 공유 폴더 초안은 15초 재읽기(사본 교체)에 지워지지 않고, 저장 · 되돌리기 때만 비운다 · 사본(draft)을 거치지 않는다', () => {
  let cur = node(), drafts = 0, reads = 0;
  const T = { t: { kind: 'gateway', meta: {} }, shapes: {}, read: () => { reads++; return { data: cur, view: cur, at: Date.now(), link: {} }; }, linkText: () => ({ t: '', cls: '', ro: false }), subscribe: () => () => {}, draft: () => { drafts++; } };
  const c = mk(T);
  const mark = (fn) => c.ndSet((d) => { if (!d.dirsBase) d.dirsBase = { dirs: JSON.parse(JSON.stringify(d.dirs)), memos: d.memos, localFs: d.localFs }; fn(d); }, null, null, { draft: true });
  mark((q) => { q.dirs.push({ name: 'mine', path: '/typed' }); });
  assert.equal(drafts, 0, '사본에 쓰지 않는다'); assert.equal(c.nd().dirs.length, 2);
  const before = reads; for (let i = 0; i < 5; i++) c.nd(); assert.equal(reads - before, 5, '입력이 사본 읽기 횟수를 늘리지 않는다(읽기 1회 = 그리기 1회)');
  cur = node({ dirs: [{ name: 'node', path: '/srv' }], parts: ['config', 'x'] });   // TTL 뒤 다시 받아 사본이 새 객체로 바뀜
  assert.deepEqual(c.nd().dirs.map((x) => x.name), ['node', 'mine'], '다시 받아도 편집 중인 값이 남는다'); assert.ok(c.nd().dirsBase, '비교 기준(dirsBase)도');
  mark((q) => { q.memos = '/m'; }); assert.equal(c.nd().memos, '/m'); assert.equal(c.nd().dirs.length, 2);
  // 되돌리기 — dirsBase 를 비우면 초안 전체가 사라진다
  c.ndSet((d) => { Object.assign(d, { dirs: c.nd().dirsBase.dirs, memos: '', localFs: false, dirsBase: null }); }, null, null, { draft: true });
  assert.deepEqual(c.nd().dirs.map((x) => x.name), ['node']); assert.equal(c.nd().dirsBase, null); assert.equal(c._ov.T1, undefined);
  assert.match(src, /delete this\._ov\[nk\];[^]*this\.say\('저장 — 재시작/, '저장 성공 때도 비운다');
});

test('1 별칭 입력 초안은 사본 밖(this._ali)에 두고, 칸을 떠날 때 노드로 · 성공하면 비운다', () => {
  assert.match(src, /aliasIn: \(e\) => \{ \(this\._ali = this\._ali \|\| \{\}\)\[this\.nodeKey\(\) \+ '\|' \+ D\.id\] = e\.target\.value; \}/);
  assert.ok(!/aliasIn: \(e\) => \{ const v = e\.target\.value; this\.ndSet/.test(src), '입력 중 ndSet(사본)을 부르지 않는다');
  assert.match(src, /if \(ok !== false && this\._ali\) \{ delete this\._ali\[k\]/);
  assert.match(src, /basis: D\.basis, usage: D\.use/, '주석이 뒤 필드를 삼키지 않는다');
});

test('3 config.get 만 실패 — ndEmpty 는 시안 설정값을 비우고, 설정 탭은 못 봤음 + 저장 잠금', () => {
  const c = mk(null);
  const d = c.ndEmpty('ws'); assert.deepEqual(d.cfg, {}); assert.deepEqual(d.cfgBase, {}); assert.deepEqual(d.cfgErr, {}); assert.equal(d.empty, true);
  assert.match(src, /const cfgMiss = N\.real \? !\(N\.parts \|\| \[\]\)\.includes\('config'\) : !!N\.empty;/);
  assert.match(src, /못 봤음 — 노드 설정을 읽지 못함\(저장 잠금\)/);
  assert.match(src, /\{ off: !dk\.length \|\| cfgMiss, pri: !!dk\.length && !cfgMiss, local: true \}/);
});

test('4 who.allPermissions 이면 사람 권한 검사를 건너뛴다(목록이 없어도 열림)', () => {
  assert.equal(gate('terra.daemon.config.patch', { who: { allPermissions: true } }).open, true);
  assert.equal(gate('terra.master.nodes.by-node-id.modules.assignments.post', { who: { allPermissions: true } }).open, true);
  assert.equal(gate('terra.daemon.config.patch', { who: { permissions: ['node.read'], allPermissions: true } }).open, true);
  assert.equal(gate('terra.daemon.config.patch', { who: { permissions: ['node.read'] } }).open, false, '일반 계정은 그대로');
  assert.equal(gate('terra.daemon.enrollment.code.post', { who: { allPermissions: true } }).open, false, '앱 권한은 건너뛰지 않는다');
});

test('2 whoami 일시 실패 — 3 · 10 · 30초 재시도, 받으면 terra-who, 토큰 갱신 때 비어 있으면 다시 묻는다, 제어기가 terra-who 에 다시 그린다', () => {
  const m = rd('../src/boot/main.js');
  assert.match(m, /const WHO_RETRY = \[3000, 10000, 30000\]/);
  assert.match(m, /whoT = setTimeout\(\(\) => askWho\(n \+ 1\), WHO_RETRY\[n\]\)/);
  assert.match(m, /dispatchEvent\(new Event\('terra-who'\)\)/);
  assert.match(m, /else if \(tok && !window\.TerraWho\) askWho\(0\)/);
  assert.match(m, /const stopLive = \(\) => \{ whoSeq\+\+; clearTimeout\(whoT\);/, '로그아웃 때 재시도를 멈춘다');
  assert.match(src, /window\.addEventListener\('terra-who', this\._onWho\)/); assert.match(src, /removeEventListener\('terra-who'/);
});
