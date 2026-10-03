// 이 저장소의 출하 Scene 이 Terra 의 실 런타임에서 **마운트되는지** 본다.
//
//   node tools/test-scenes.mjs --terra ../terra
//
// **왜 이 파일이 있나 (분리 검토 G-23)** — `terra module pack` 은 Scene 의 정적
// 무결성을 본다(fragment 가 모르는 store 를 부르는지, id 가 기여 id 와 같은지).
// 그것이 통과해도 **실 DOM 에서 서는** Scene 이 있다: `custom` 요소의 실체를
// 등록하는 것은 제품 앱이고(호스트 계층), 이 저장소는 그것을 모른다.
//
// **실제로 당했다 (2026-10-01).** modules#17 이 `lab.stellaxia.node-gui` 를 머지한
// 것만으로 Terra 의 모든 PR 과 main 이 빨개졌다. 그 Scene 의 main Fragment 는
// 루트가 `terra.web/frame` 이고, 그 component 는 `terra-runtime-core` 에 산다.
// Terra 의 `shipped-scenes.test.ts` 는 `TERRA_MODULES_ROOT` 로 **이 저장소의 main
// 을 라이브로** 걷기 때문에, 여기서 머지하는 순간이 저쪽의 빌드 시점이다 —
// 그리고 그때까지 **양쪽 어디에도 막을 문이 없었다.**
//
// G-14 의 거울상이다. G-14 는 *이 저장소가 가져온 시험이 아무도 안 돌리게 되는
// 것*이었고(그래서 `test-modules.mjs` 가 섰다), 이것은 *이 저장소의 내용이 저쪽
// 시험을 깨뜨리는 것*이다. 둘 다 처방은 같다: **그 시험을 여기서 돌린다.**
//
// 시험을 사본으로 들고 오지 않는 이유 — 그 시험의 권위는 Terra 다. 사본은 말없이
// 늙고, 무엇보다 저쪽이 호스트 component 를 하나 더 등록하면 사본은 그것을 모른다.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot, resolveTerraRoot, run } from './go-workspace.mjs';

/** Terra 안에서 이 저장소의 Scene 을 읽는 시험들. 경로는 저쪽 트리 기준이다. */
const SCENE_PACKAGE = join('products', 'common', 'packages', 'terra-scene-runtime');
const SCENE_TESTS = [
  // TERRA_MODULES_ROOT 아래의 출하 Scene 을 **전부 열거해** 마운트한다. 모르는
  // custom component 는 이름을 대며 선다 — §8.3 격리 때문에 그 요소가 **중첩**
  // 이면 루트가 멀쩡히 남아 마운트 단언은 통과하므로, 그 가드가 따로 있다.
  join('tests', 'shipped-scenes.test.ts'),
  // io.terra.scene.login-demo 의 출하 바이트를 실 로더에 먹인다.
  join('tests', 'login-demo-scene.test.ts')
];

function parseArgs(argv) {
  let terra = process.env.TERRA_CHECKOUT ?? '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--terra') terra = argv[++index] ?? '';
    else throw new Error(`알 수 없는 인자: ${argument}`);
  }
  return { terraRoot: resolveTerraRoot(terra) };
}

async function main() {
  const { terraRoot } = parseArgs(process.argv.slice(2));

  // 의존이 없으면 vitest 가 없다. 여기서 세우지 않으면 "command not found" 가
  // 나고, 그 말은 **무엇을 해야 하는지**를 말해 주지 않는다.
  if (!existsSync(join(terraRoot, 'node_modules'))) {
    throw new Error(
      `Terra 체크아웃에 node_modules 가 없다: ${terraRoot}\n` +
        '그 트리에서 `npm ci` 를 먼저 돈다 — 이 시험은 저쪽의 vitest 로 돈다.'
    );
  }

  // 시험 파일이 저쪽에서 옮겨지거나 이름이 바뀌면 **여기서** 선다. 이 검사가
  // 없으면 "돌릴 대상이 없다"가 조용한 통과로 보일 수 있다(G-7·G-14 의 그 모양).
  const missing = SCENE_TESTS.filter((relative) => !existsSync(join(terraRoot, SCENE_PACKAGE, relative)));
  if (missing.length > 0) {
    throw new Error(
      `Terra 에서 시험 파일을 찾지 못했다: ${missing.join(', ')} (${join(terraRoot, SCENE_PACKAGE)})\n` +
        '저쪽에서 옮겨졌다면 이 파일의 SCENE_TESTS 를 따라 옮긴다 — 목록을 지우면 검사가 사라진다.'
    );
  }

  console.log(`::group::vitest ${SCENE_TESTS.join(' ')} (${SCENE_PACKAGE})`);
  const code = await run('npm', ['exec', '--', 'vitest', 'run', '--root', SCENE_PACKAGE, ...SCENE_TESTS], {
    cwd: terraRoot,
    env: { ...process.env, TERRA_MODULES_ROOT: repoRoot }
  });
  console.log('::endgroup::');

  if (code !== 0) {
    console.error(
      `::error::출하 Scene 이 Terra 의 런타임에서 마운트되지 않는다 (exit ${code}) — ` +
        '모르는 custom component 면 그 실체를 등록하는 계층이 어디인지 보고, ' +
        '호스트 계층이면 Terra 쪽 HOST_NATIVE_COMPONENTS 에 더한다 (분리 검토 G-23)'
    );
    return 1;
  }

  console.log(`Scene 마운트 — 시험 파일 ${SCENE_TESTS.length}개 통과 (뿌리 ${repoRoot})`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
}
