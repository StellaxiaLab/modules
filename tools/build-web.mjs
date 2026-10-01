// 웹 화면을 가진 모듈의 `web/` 을 구워 `ui/` 에 놓는다.
//
//   node tools/build-web.mjs [--module lab.stellaxia.node-gui]
//
// **왜 필요한가** — `terra module new --web` 이 굽는 모듈은 화면 소스를 `web/` 에 두고, 빌드 결과를
// `ui/` 에 쓴다(Vite `outDir: '../ui'`). `web/` 은 포장 허용 목록 밖이라 출하되지 않으므로 **포장되는
// 것은 `ui/` 뿐이다.** `ui/` 는 `bin/` 처럼 빌드 산출물이고 커밋하지 않는다. 그래서 포장 전에 누군가
// 구워야 하는데, `build-modules.mjs` 는 Go 만 굽는다. 이 파일이 그 사이를 메운다.
//
// **왜 Terra 체크아웃이 필요 없나** — 웹 빌드는 모듈의 `web/package.json` 과 잠금 파일만 본다.
// 그래서 이 스크립트는 시크릿 없는 CI 잡에서도 돈다.
//
// **구운 뒤에 본다** — 매니페스트의 static 앱 entry 가 생겼는지, 그리고 그것이 스캐폴드의 자리 표시자가
// 아닌지. `terra module pack` 은 둘 다 보지 않는다(entry 가 없어도 `VERIFIED true` — 실측).

import { appEntryProblems, installDependencies, npm, webModules, webScripts } from './web-workspace.mjs';
import { readFile } from 'node:fs/promises';
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
  if (only.length && modules.length !== only.length) {
    const missing = only.filter((id) => !modules.some((m) => m.id === id));
    console.error(`::error::웹 모듈이 아니다: ${missing.join(', ')}`);
    return 1;
  }
  if (modules.length === 0) {
    // 오류가 아니다 — 웹 화면이 없는 저장소는 구울 것이 없다. 다만 조용히 통과하지는 않는다.
    console.log('웹 소스(web/package.json)를 가진 모듈이 없다 — 구울 것이 없다.');
    return 0;
  }

  let failed = 0;
  for (const module of modules) {
    const label = `${module.tier}/${module.id}`;
    console.log(`::group::web build ${label}`);
    const scripts = webScripts(module);
    let code = 0;
    if (!scripts.build) {
      console.error(`::error file=${label}/web/package.json::scripts.build 가 없다 — ui/ 를 쓸 길이 없다`);
      code = 1;
    }
    if (code === 0) code = await installDependencies(module);
    if (code === 0) code = await npm(['run', 'build'], module.web);
    console.log('::endgroup::');
    if (code !== 0) {
      console.error(`::error file=${label}/web/package.json::웹 빌드가 실패했다 (exit ${code})`);
      failed += 1;
      continue;
    }
    const manifest = JSON.parse(await readFile(join(module.dir, 'module.json'), 'utf8'));
    const problems = appEntryProblems(module.dir, manifest);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`::error file=${label}/module.json::${problem}`);
      failed += 1;
      continue;
    }
    console.log(`  ${label} — ui/ 를 썼다`);
  }

  if (failed > 0) {
    console.error(`::error::웹 모듈 ${modules.length}개 중 ${failed}개를 굽지 못했다`);
    return 1;
  }
  console.log(`\n웹 모듈 ${modules.length}개를 구웠다`);
  return 0;
}

process.exitCode = await main();
