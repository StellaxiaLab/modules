// 한 번에 돌린다 — 페이지를 만들고 점검 스크립트를 차례로 실행해 요약을 낸다.
// 사용: node run-all.mjs [designDir] [pagesDir]      종료 코드: 실패가 하나라도 있으면 1.
import { spawnSync } from 'child_process';
import path from 'path';
import { HERE } from './lib.mjs';

const designDir = path.resolve(process.argv[2] || path.join(HERE, '..'));
const pagesDir = path.resolve(process.argv[3] || path.join(HERE, '.pages'));
const run = (script, ...args) => spawnSync(process.execPath, [path.join(HERE, script), ...args], { stdio: 'inherit', env: process.env }).status;

if (run('build-pages.mjs', designDir, pagesDir) !== 0) process.exit(2);
const steps = [
  ['시연 점검(35개)', 'demo-checks.mjs', pagesDir],
  ['글자 대비·선호 설정 폴백', 'contrast-fallback.mjs', pagesDir],
  ['키보드 초점', 'focus-stops.mjs', pagesDir],
  ['대화 스크롤 따라가기(측정)', 'scroll-follow.mjs', pagesDir],
  ['입력칸 자동 높이(측정)', 'textarea-grow.mjs', pagesDir],
  ['iframe 흐림·shape()(측정)', 'iframe-backdrop.mjs'],
];
const rows = [];
for (const [label, script, ...args] of steps) {
  console.log(`\n===== ${label} =====`);
  rows.push([label, run(script, ...args)]);
}
console.log('\n===== 요약 =====');
for (const [label, code] of rows) console.log(code === 0 ? '통과' : '실패(종료 ' + code + ')', '-', label);
process.exit(rows.some(([, c]) => c !== 0) ? 1 : 0);
