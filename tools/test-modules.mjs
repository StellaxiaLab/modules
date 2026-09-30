// Go 소스를 가진 모듈의 시험을 돈다.
//
//   node tools/test-modules.mjs --terra ../terra [--module io.terra.file]
//
// **왜 이 파일이 있나 (분리 검토 G-14)** — 이주 전에는 코어의 CI 가 모듈의 Go
// 시험을 돌고 있었다. Terra 의 `ci.yml` 은 `git ls-files '*go.mod'` 로 저장소의
// 모든 Go 모듈을 훑어 `go test ./...` 를 돌리고, 거기에 `module/<tier>/<id>/src`
// 가 들어 있었다. 모듈이 이 저장소로 오면 그 훑기에서 **말없이 빠진다** —
// 없어진 경로를 세지 않으므로 코어 CI 는 그대로 초록이고, 줄어든 것은 시험의
// 수뿐이다. 실측(2026-09-30): 이주하는 모듈 열에 시험 파일 55개 · `Test` 함수
// 347개가 있고, 이 저장소의 CI 는 `go test` 를 **한 번도 부르지 않았다**
// (validate → schema → build → pack). 빌드는 컴파일이 되는지만 본다.
//
// 이것이 G-7·G-10 과 같은 모양이다: 가드가 더 적게 재게 되어 계속 통과한다.
// 그래서 코어가 `module/` 을 지우기 전에 이 파일이 서야 한다.
//
// **코어와 같은 것을 돈다** — `go test -count=1`, 그리고 goroutine 을 가진
// 패키지에만 `-race`. 코어는 `go vet` 을 CI 에서 돌지 않으므로 여기서도 돌지
// 않는다: 이주는 옮기는 일이고, 없던 검사를 더하는 것은 별 건이다.

import { join } from 'node:path';

import { goModules, resolveTerraRoot, run, writeWorkspace } from './go-workspace.mjs';

/**
 * `-race` 로 한 번 더 도는 패키지들. Terra 의 `ci.yml` 이 들고 있던 목록에서
 * 이 저장소로 온 것을 그대로 옮긴다 — **사유 주석까지 옮긴다.** 목록만 옮기면
 * 왜 그 줄이 있는지가 사라지고, 사유를 모르는 줄은 언젠가 "느리다"는 이유로
 * 지워진다.
 *
 * `-race` 는 리눅스에서만 돈다(코어의 같은 판단: service_tunnel Manager 경합
 * 31건이 윈도우의 `-race` 에서는 한 번도 안 나왔다. 스케줄러 인터리빙이 다르다).
 * 그리고 **전체가 아니라 목록이다** — `./...` 전체에 `-race` 를 걸면 러너 시간이
 * 몇 배가 된다.
 *
 * 여기에 넣는다는 것은 그 패키지가 먼저 race-free 여야 한다는 뜻이다. 경합을
 * 보고하는 패키지는 감사(Terra `docs/reports` 4-A 표)에 적고 고칠 때까지 빼
 * 둔다 — 그래야 이 단계가 **이미 아는 결함으로 빨개지지 않는다.**
 */
const RACE_PACKAGES = [
  {
    id: 'io.terra.io-weave',
    packages: ['./...'],
    // io-weave 는 가상 입력 장치와 watchdog 을 갖는데, 그 watchdog 은 멈춘
    // 쓰기가 쥔 락을 잡지 않고 장치를 없애야 한다(io-weave 설계 D-22 4계층).
    // 그것이 평범한 시험은 다 통과하고 새벽 세 시에 노드에서 데드락하는 모양
    // 이고, 리눅스 전용 코드다. 2026-09-15 기준 race-free. 1초 정도 늘어난다.
    why: '가상 입력 장치 + watchdog 의 락 회피 (io-weave D-22 4계층) — 리눅스 전용'
  }
];

function parseArgs(argv) {
  let terra = process.env.TERRA_CHECKOUT ?? '';
  const only = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--terra') terra = argv[++index] ?? '';
    else if (argument === '--module') only.push(argv[++index] ?? '');
    else throw new Error(`알 수 없는 인자: ${argument}`);
  }
  return { terraRoot: resolveTerraRoot(terra), only: only.filter(Boolean) };
}

async function main() {
  const { terraRoot, only } = parseArgs(process.argv.slice(2));
  const all = goModules();
  const modules = only.length > 0 ? all.filter((m) => only.includes(m.id)) : all;

  if (only.length > 0 && modules.length !== only.length) {
    const missing = only.filter((id) => !all.some((m) => m.id === id));
    throw new Error(`Go 소스를 가진 모듈이 아니다: ${missing.join(', ')}`);
  }

  if (modules.length === 0) {
    // build-modules 와 같은 처분 — 오류는 아니지만 조용하지도 않다.
    console.log('Go 소스를 가진 모듈이 없다 — 시험할 것이 없다.');
    return 0;
  }

  // 목록이 늙는 것을 여기서 잡는다. `-race` 목록에 있는 id 가 이 저장소의 Go
  // 모듈이 아니면, 모듈이 떠났거나 이름이 바뀐 것이다. 어느 쪽이든 **그 줄을
  // 조용히 무시하면 경합 검사가 사라진 것을 아무도 모른다** — 코어에서는 `cd`
  // 가 실패해 시끄러웠던 자리다. 전체를 돌 때만 본다(`--module` 은 부분집합이다).
  if (only.length === 0) {
    const stale = RACE_PACKAGES.filter((entry) => !all.some((m) => m.id === entry.id));
    if (stale.length > 0) {
      console.error(
        `::error::-race 목록이 저장소와 맞지 않는다: ${stale.map((s) => s.id).join(', ')} 가 없다. ` +
          '모듈이 떠났다면 그 줄을 지우는 것이 아니라 그 경합 검사를 누가 받는지를 적는다'
      );
      return 1;
    }
  }

  const workspace = await writeWorkspace(modules, terraRoot, 'test-modules.mjs');
  console.log(
    `go.work: 모듈 ${modules.length}개 · Terra 패키지 ${workspace.replacements}개 → ${workspace.path}`
  );

  // 시험은 **호스트에서 돈다** — 교차컴파일한 시험 바이너리는 실행할 수 없다.
  // GOOS/GOARCH 를 비우는 것이 build-modules 와 다른 점이다.
  //
  // `TERRA_CHECKOUT` 도 넘긴다. 모듈이 Terra 안에 있을 때는 Terra 의 파일을
  // 상대경로로 읽어도 맞았지만, 이 저장소에서는 그 깊이가 체크아웃 밖을
  // 가리킨다. 실측(2026-09-30): `io.terra.treebench` 의 contract_map_test 가
  // `../../../../products/tree/master/contracts/api/terra-api.json` 을 읽어
  // 시험 둘이 이 저장소에서 터졌다 — 이 단계가 없었으면 아무도 몰랐다.
  const env = { ...process.env, GOWORK: workspace.path, TERRA_CHECKOUT: terraRoot };

  let failed = 0;
  let ran = 0;
  for (const module of modules) {
    console.log(`::group::go test ${module.tier}/${module.id}`);
    const code = await run('go', ['test', '-count=1', '-timeout', '30m', './...'], {
      cwd: join(module.dir, 'src'),
      env
    });
    console.log('::endgroup::');
    if (code !== 0) {
      console.error(`::error::${module.id} 시험 실패 (exit ${code})`);
      failed += 1;
    } else {
      ran += 1;
    }
  }

  let raced = 0;
  if (process.platform === 'linux') {
    for (const entry of RACE_PACKAGES) {
      const module = modules.find((m) => m.id === entry.id);
      if (!module) continue; // --module 로 좁힌 실행
      console.log(`::group::go test -race ${entry.id} (${entry.why})`);
      const code = await run(
        'go',
        ['test', '-race', '-count=1', '-timeout', '15m', ...entry.packages],
        { cwd: join(module.dir, 'src'), env }
      );
      console.log('::endgroup::');
      if (code !== 0) {
        console.error(`::error::${entry.id} 에서 경합 또는 -race 실패 (exit ${code})`);
        failed += 1;
      } else {
        raced += 1;
      }
    }
  } else {
    console.log(`-race 는 리눅스에서만 돈다 — 이 호스트는 ${process.platform} 다`);
  }

  console.log(`시험한 모듈 ${ran}개 · -race ${raced}개 · 실패 ${failed}개`);
  return failed > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
}
