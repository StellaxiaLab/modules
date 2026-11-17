// node --test — boot/main.js 한 줄 안에서 `//` 주석이 뒤따르는 코드(window.Terra* = …)를 삼킨 적이 있다(0.6.20 까지):
//   window.TerraShells · TerraSvi* 가 주석 안에 들어가 Terra 터미널이 시안 값을 냈다(D2). 같은 모양이 다시 생기면 막는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/boot/main.js', import.meta.url)), 'utf8');

test('main.js — 주석 뒤에 같은 줄 코드(window.Terra… = )가 숨어 있지 않다', () => {
  const bad = [];
  src.split(/\r?\n/).forEach((line, i) => {
    const at = line.indexOf('// ');
    if (at < 0 || !line.slice(0, at).trim() || /https?:\/\/[^ ]*$/.test(line.slice(0, at + 3))) return;
    if (/\bwindow\.Terra[A-Za-z]+ = /.test(line.slice(at))) bad.push(i + 1);
  });
  assert.deepEqual(bad, [], '주석에 삼켜진 window.Terra* 대입: ' + bad.join(', ') + '행');
});

test('main.js — Terra 터미널 · SVI 도우미를 실제로 건다', () => {
  for (const k of ['TerraShells', 'TerraSviMake', 'TerraSviEnvelope', 'TerraSviView', 'TerraSviWatch', 'TerraSviHandles']) {
    assert.match(src.replace(/\/\/[^\n]*/g, ''), new RegExp('window\.' + k + ' = '), k + ' 대입이 코드에 있어야 한다');
  }
});
