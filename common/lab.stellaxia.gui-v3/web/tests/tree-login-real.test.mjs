// node --test — AUD-23 재점검: 실제 연결(TerraTransport 있음)에서 '주소 묻기'는 시안(mock) 분기를 타지 않는다.
//   노드 id 가 없으면 요청도 주소도 없이 '알 수 없음 · NO_NODE_ID', 있으면 실제 resolve op 에 그 node_id 로.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { boardModule } from '../tools/dc-board.mjs';

const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
globalThis.document = globalThis.document || { createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el() };
globalThis.window = globalThis;
const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { boardDef } = await import(RT);
const dir = mkdtempSync(join(tmpdir(), 'tree-login-real-'));
const f = join(dir, 'TreeLogin.mjs');
writeFileSync(f, boardModule(readFileSync(fileURLToPath(new URL('../design/TreeLogin.dc.html', import.meta.url)), 'utf8'), 'TreeLogin', RT));
await import(pathToFileURL(f).href);
const { makeTerraTreeLogin, RESOLVE_OP } = await import('../src/boot/tree-login.js');

function mk(rid, invoke) {
  const K = makeTerraTreeLogin(boardDef('TreeLogin').Logic, { terra: { invoke }, ridOf: () => rid }), o = Object.create(K.prototype);
  o.props = { treeName: 'Master', treeKey: 'T1', direction: 'far', loginUrl: '', reachable: false, needsResolve: true };
  o.state = { email: '', pass: '', keep: false, phase: null, msg: '', bad: false, err: null, manual: false, manualUrl: '' };
  o.setState = (p) => Object.assign(o.state, p);
  o._chg = {}; o._g = 0; o._t0 = 0; o._k = 'T1|Master';
  return o;
}
const real = async (fn) => { window.TerraTransport = {}; try { return await fn(); } finally { delete window.TerraTransport; } };

test('실제 연결 · 노드 id 없음: 요청 없이 알 수 없음 · NO_NODE_ID, terra.local 주소가 어디에도 없다', () => real(async () => {
  const calls = []; const o = mk('', (...a) => { calls.push(a); return Promise.resolve({}); });
  const v = o.renderVals(); v.resolve();
  assert.equal(calls.length, 0, '요청 없음');
  assert.equal(o.state.url, null); assert.match(o.state.msg, /^알 수 없음 · NO_NODE_ID$/);
  assert.ok(!JSON.stringify([o.state, o.renderVals().urlT]).includes('terra.local'));
  o.login();   // 로그인도 시안 분기가 아니라 같은 까닭으로 거절
  assert.equal(o.state.err.code, 'NO_NODE_ID');
}));

test('실제 연결 · 노드 id 있음: 실제 resolve op 를 그 node_id 로 부르고 결과 · 오류 코드를 보인다', () => real(async () => {
  const calls = []; let reply = { login_url: 'https://t.example:8443' };
  const o = mk('node-abc', (op, inp) => { calls.push([op, inp]); return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply); });
  o.renderVals().resolve(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [[RESOLVE_OP, { node_id: 'node-abc' }]]);
  assert.equal(o.state.url, 'https://t.example:8443');
  reply = Object.assign(new Error('x'), { code: 'DELEGATION_UNAVAILABLE' });
  o.renderVals().resolve(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(o.state.url, null); assert.match(o.state.msg, /알 수 없음 · DELEGATION_UNAVAILABLE/);
}));
