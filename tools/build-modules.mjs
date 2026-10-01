// Go 소스를 가진 모듈을 매니페스트가 선언한 타깃으로 굽는다.
//
//   node tools/build-modules.mjs --terra ../terra [--target linux-amd64]...
//
// **왜 필요한가** — `terra module pack` 은 D-18 이후 바이너리 반쪽을 본다.
// `entrypoints.process` 에 타깃을 적고 `bin/` 이 빈 모듈은 `MODULE_ENTRYPOINT_MISSING`
// 으로 거절된다. 소스 트리의 `bin/` 은 원래 비어 있으므로(빌드 산출물이다), Go 모듈이
// 이 저장소에 오면 `pack` 잡이 그 자리에서 빨개진다. 이 파일이 그 사이를 메운다.
//
// **왜 Terra 체크아웃이 필요한가** — 모듈의 `src/go.mod` 가 `terra-module-sdk` 등을
// `replace` 로 끌어쓰고, 그 SDK 는 공개 레지스트리에 없다(Terra 가 private 이고
// module path 도 실제 remote 와 다르다). 분리 검토 Q-8 이 **나란한 체크아웃**을
// 골랐고, CI 의 pack 잡이 이미 그 모양이다 — `modules/` 와 `terra/` 가 나란히 있다.
//
// 워크스페이스 배선(go.work · replace 덮어쓰기)은 `tools/go-workspace.mjs` 가 갖고
// 있다 — `test-modules.mjs` 가 같은 것을 필요로 하고, 두 벌은 한쪽만 늙는다.

import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { goModules, resolveTerraRoot, run, writeWorkspace } from './go-workspace.mjs';

// --- 인자 ---------------------------------------------------------------

function parseArgs(argv) {
  let terra = process.env.TERRA_CHECKOUT ?? '';
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--terra') terra = argv[++index] ?? '';
    else if (argument === '--target') targets.push(argv[++index] ?? '');
    else throw new Error(`알 수 없는 인자: ${argument}`);
  }
  return { terraRoot: resolveTerraRoot(terra), targets: targets.filter(Boolean) };
}

// --- 빌드 ---------------------------------------------------------------

/**
 * 타깃 이름이 GOOS-GOARCH 다 — Terra 의 build-release.ps1 과 같은 규약이고,
 * 매니페스트의 entrypoints.process 키가 그 이름이다.
 */
function splitTarget(target) {
  const index = target.indexOf('-');
  if (index < 1) throw new Error(`타깃 이름이 GOOS-GOARCH 가 아니다: ${target}`);
  return { goos: target.slice(0, index), goarch: target.slice(index + 1) };
}

async function main() {
  const { terraRoot, targets: wanted } = parseArgs(process.argv.slice(2));
  const modules = goModules();

  if (modules.length === 0) {
    // 오류가 아니다 — Scene·extension 만 있는 저장소는 빌드할 것이 없다.
    // 다만 조용히 통과하지는 않는다: 0개를 빌드하고 "성공"이라 말하는 것이
    // 이 저장소가 L-9 로 막으려는 침묵과 같은 모양이다.
    console.log('Go 소스를 가진 모듈이 없다 — 빌드할 것이 없다.');
    return 0;
  }

  const workspace = await writeWorkspace(modules, terraRoot, 'build-modules.mjs');
  console.log(
    `go.work: 모듈 ${modules.length}개 · Terra 패키지 ${workspace.replacements}개 → ${workspace.path}`
  );

  let failed = 0;
  let built = 0;
  for (const module of modules) {
    const manifest = JSON.parse(await readFile(join(module.dir, 'module.json'), 'utf8'));
    const process_ = manifest.entrypoints?.process ?? {};
    const declared = Object.keys(process_);
    if (declared.length === 0) {
      console.log(`${module.id}: entrypoints.process 가 없다 — 건너뛴다`);
      continue;
    }
    const chosen = wanted.length > 0 ? declared.filter((t) => wanted.includes(t)) : declared;
    if (chosen.length === 0) {
      console.log(`${module.id}: 요청한 타깃을 선언하지 않았다 (선언: ${declared.join(', ')})`);
      continue;
    }
    for (const target of chosen) {
      const { goos, goarch } = splitTarget(target);
      const output = join(module.dir, process_[target]);
      await mkdir(dirname(output), { recursive: true });
      console.log(`::group::go build ${module.tier}/${module.id} → ${target}`);
      const code = await run('go', ['build', '-trimpath', '-o', output, '.'], {
        cwd: join(module.dir, 'src'),
        env: {
          ...process.env,
          GOWORK: workspace.path,
          GOOS: goos,
          GOARCH: goarch,
          // Terra 의 Build-ExternalModules 와 같은 설정 — 교차컴파일에서
          // 호스트 툴체인에 기대지 않는다.
          CGO_ENABLED: '0'
        }
      });
      console.log('::endgroup::');
      if (code !== 0) {
        console.error(`::error::${module.id} ${target} 빌드 실패 (exit ${code})`);
        failed += 1;
      } else {
        built += 1;
      }
    }
  }

  console.log(`빌드한 바이너리 ${built}개 · 실패 ${failed}개`);
  return failed > 0 ? 1 : 0;
}

process.exitCode = await main();
