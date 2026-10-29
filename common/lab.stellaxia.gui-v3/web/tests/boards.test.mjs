// node --test — 캔버스 보드 → 모듈 (tools/dc-board.mjs). 씬에서 닿는 보드가 모두 모듈이 되고, 모듈 코드로 문법이 맞는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBoard, boardModule, importsOf } from '../tools/dc-board.mjs';

const D = new URL('../design/', import.meta.url).pathname;
const read = (n) => readFileSync(join(D, n + '.dc.html'), 'utf8');
const closure = () => { const seen = new Set(), q = ['Scene']; while (q.length) { const n = q.shift(); if (seen.has(n)) continue; seen.add(n); q.push(...importsOf(read(n))); } return [...seen]; };

test('씬에서 닿는 보드 — 창 보드가 다 들어 있다', () => {
  const L = closure();
  for (const n of ['Scene', 'Login', 'NodeDesktopEmbed', 'StarMaker', 'NodeConf', 'NodeStatus', 'NodeShare', 'ResStatus', 'TreeLogin', 'ModStatus', 'WebBrowser']) assert.ok(L.includes(n), n);
});

test('parseBoard — 마크업 · 로직 · 속성 기본값 · 바깥 글꼴 버림', () => {
  const B = parseBoard(read('ModStatus'));
  assert.match(B.markup, /^<div class="ns ms"/);
  assert.ok(!B.markup.includes('<script'));
  assert.match(B.script, /class Component extends DCLogic/);
  assert.ok(!/\/_blob\//.test(B.css), '캔버스 저장소 글꼴은 버린다');
  const L = parseBoard(read('Login'));
  assert.equal(L.props.installed, 'Leaf');   // data-props 의 default
});

test('보드 모듈 — 모두 ES 모듈 문법으로 맞다 (node --check)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'boards-'));
  const { execFileSync } = await import('node:child_process');
  for (const n of closure()) {
    const f = join(dir, n + '.mjs');
    writeFileSync(f, boardModule(read(n), n, '/src/ui/dc/runtime.js'));
    execFileSync(process.execPath, ['--check', f]);
  }
  assert.ok(readdirSync(dir).length >= 11);
});
