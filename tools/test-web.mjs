// 웹 화면을 가진 모듈의 시험을 돈다 — `web/package.json` 의 `scripts.test`.
//
//   node tools/test-web.mjs [--module lab.stellaxia.node-gui]
//
// **왜 이 파일이 있나** — test-modules.mjs 는 Go 시험만 돈다. 웹 모듈의 시험은 그 훑기에 들지 않으므로,
// 이것이 없으면 *"아무도 돌리지 않는 시험"* 이 된다(분리 검토 G-14 · G-17 과 같은 모양이다).
//
// 시험이 없는 웹 모듈은 실패가 아니라 **알린다** — 조용히 0개를 돌고 초록이라 말하지 않는다.
// 브라우저가 필요한 시험(연기 시험 따위)은 `test` 가 아닌 다른 이름으로 둔다: CI 러너에는 브라우저가 없다.

import { installDependencies, npm, webModules, webScripts } from './web-workspace.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const only = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--module') only.push(argv[++index] ?? '');
    else throw new Error(`알 수 없는 인자: ${argv[index]}`);
  }
  return { only: only.filter(Boolean) };
}

async function main() {
  const { only } = parseArgs(process.argv.slice(2));
  const all = webModules();
  const modules = only.length ? all.filter((m) => only.includes(m.id)) : all;
  if (modules.length === 0) {
    console.log('웹 소스(web/package.json)를 가진 모듈이 없다 — 돌릴 웹 시험이 없다.');
    return 0;
  }

  let failed = 0, tested = 0;
  for (const module of modules) {
    const label = `${module.tier}/${module.id}`;
    if (!webScripts(module).test) {
      const message = `${label}: web/package.json 에 scripts.test 가 없다 — 이 모듈의 웹 시험은 돌지 않는다`;
      console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `! ${message}`);
      continue;
    }
    console.log(`::group::web test ${label}`);
    let code = existsSync(join(module.web, 'node_modules')) ? 0 : await installDependencies(module);
    if (code === 0) code = await npm(['test'], module.web);
    console.log('::endgroup::');
    tested += 1;
    if (code !== 0) {
      console.error(`::error file=${label}/web/package.json::웹 시험이 실패했다 (exit ${code})`);
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`::error::웹 시험 ${tested}개 모듈 중 ${failed}개가 실패했다`);
    return 1;
  }
  console.log(`\n웹 시험 — 모듈 ${tested}개 통과 (웹 모듈 ${modules.length}개)`);
  return 0;
}

process.exitCode = await main();
