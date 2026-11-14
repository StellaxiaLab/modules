// node --test — 제어기 › 모듈(설치됨) · 장치 목록의 행: 230px 목록에서 긴 이름("Terra Scene Runtime (dom.basic)")이 두 줄로
//   접히면 아래 id 줄과 다음 행 글자 위로 겹쳤고, 행 가운데에 맞춘 버전이 이름 줄과 어긋났다.
//   이제 이름은 한 줄 말줄임(전체는 행 title), 점 · 버전 · 칩은 이름 줄에 맞춘다. 화면 확인은 PR 의 스크린샷.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const board = readFileSync(new URL('../design/NodeDesktopEmbed.dc.html', import.meta.url), 'utf8');
// 줄 머리의 `sel{…}` 규칙 몸통
const rule = (sel) => {
  const line = board.split(/\r?\n/).find((l) => l.startsWith(sel + '{'));
  return line ? line.slice(sel.length + 1, line.indexOf('}')) : '';
};

for (const [what, v] of [['설치된 모듈', 'md'], ['장치', 'dv']]) {
  test(`${what} 목록 — 이름은 자기 칸에 담기고 행 title 이 전체 이름`, () => {
    const row = board.split(/\r?\n/).find((l) => l.includes(`class="nx-li {{${v}.cls}}"`));
    assert.ok(row, what + ' 행');
    assert.ok(row.includes(`title="{{${v}.name}}"`), 'title');
    assert.ok(row.includes(`<span class="nx-li-t"><span class="nx-li-n">{{${v}.name}}</span>`), '이름 칸');
  });
}

test('이름 칸은 한 줄 말줄임 — 접혀서 다음 줄과 겹치지 않는다', () => {
  const n = rule('.nx-li-n');
  for (const d of ['white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis']) assert.ok(n.includes(d), d);
});

test('점 · 버전 · 칩은 이름 줄에 맞춘다(행 가운데가 아니라)', () => {
  assert.ok(board.includes('.nx-li{align-items:flex-start;flex-shrink:0}'), '이름 줄 맞춤 · 행은 줄지 않음(세로 flex 목록)');
  assert.ok(board.includes('.nx-li>.nx-k,.nx-li>.nx-chip{flex-shrink:0;white-space:nowrap;line-height:16px}'));
});
