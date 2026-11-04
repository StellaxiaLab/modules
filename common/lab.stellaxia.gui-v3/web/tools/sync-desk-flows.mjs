#!/usr/bin/env node
// src/api/desk-flows.js 의 @flows 구간을 제어기 보드(design/NodeDesktopEmbed.dc.html)에 그대로 옮긴다.
//   보드는 캔버스에서도 혼자 돌아야 해서 모듈을 들여오지 못한다 — 원본은 desk-flows.js, 보드는 그 사본(tests/desk-flows.test.mjs 가 같은지 본다)
//   node tools/sync-desk-flows.mjs           보드를 고친다
//   node tools/sync-desk-flows.mjs --check   다르면 실패
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/api/desk-flows.js', import.meta.url));
const BOARD = fileURLToPath(new URL('../design/NodeDesktopEmbed.dc.html', import.meta.url));
const A = '/* @flows:begin */', B = '/* @flows:end */';
export const region = (s) => { const i = s.indexOf(A), j = s.indexOf(B); if (i < 0 || j < i) throw new Error('@flows 구간 없음'); return s.slice(i, j + B.length); };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = region(readFileSync(SRC, 'utf8')), board = readFileSync(BOARD, 'utf8'), cur = region(board);
  if (process.argv.includes('--check')) { if (cur !== src) { console.error('보드의 @flows 구간이 desk-flows.js 와 다르다 — node tools/sync-desk-flows.mjs'); process.exit(1); } console.log('같다'); }
  else { writeFileSync(BOARD, board.replace(cur, () => src)); console.log(cur === src ? '그대로' : '옮겼다'); }
}
