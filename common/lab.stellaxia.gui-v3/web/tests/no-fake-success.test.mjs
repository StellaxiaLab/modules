// 실제 모드에서 노드에 보낼 operation 이 없는 변경이 성공으로 뜨지 않는다 — 보드 소스의 불변식(보드는 DOM 없이 못 띄우므로 소스로 확인)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const desk = readFileSync(new URL('../design/NodeDesktopEmbed.dc.html', import.meta.url), 'utf8');
const nodes = readFileSync(new URL('../design/TerraNodes.dc.html', import.meta.url), 'utf8');

test('ndSet — 실모드 · operation 없음 · 초안 아님이면 거절(false), 초안만 사본에서', () => {
  const i = desk.indexOf('  ndSet(fn, op, input, o) {'), body = desk.slice(i, desk.indexOf('  ndSeed(', i));
  assert.ok(i > 0);
  assert.match(body, /!op && T\.t && T\.t\.kind !== 'mock'/);
  assert.match(body, /o && o\.draft\) \{ T\.draft\(/);
  assert.match(body, /적용 안 함 : 노드에 보낼 operation 없음'\); return false;/);
  assert.ok(nodes.includes('  draft(n, res, apply)'));
});

test('성공 문구는 ndSet 이 거절하지 않았을 때만 — 모듈 끄기 · 켜기 · 되돌리기 · 선언 적용 · 작업', () => {
  assert.match(desk, /\.post', op && \{ module_id: m\.id \}\) !== false\) this\.say\(msg\)/);
  assert.match(desk, /x\.st = 'applied'; \}\)\) !== false\) this\.say\(/);
  assert.match(desk, /\}\) === false\) return false; setTimeout/);
});

test('다시 읽기 — 실모드는 modules.scan.post 를 실제로 부른다', () => {
  assert.match(desk, /if \(this\.real\(\)\) \{[^}]*'terra\.daemon\.modules\.scan\.post'/);
});

test('저장 전 입력 초안(설정 · 폴더 · 등록 코드)은 draft 표시', () => {
  assert.equal((desk.match(/\{ draft: true \}/g) || []).length >= 6, true);
});
