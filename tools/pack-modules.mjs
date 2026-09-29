// 모든 모듈을 `.tmod` 로 포장하고, 릴리스가 실을 목록(modules.json)을 함께 낸다.
//
//   node tools/pack-modules.mjs --cli <terra> --terra ../terra --tag v2026.09.29 [--out dist]
//
// **왜 스크립트인가** — CI 의 `pack` 잡은 모듈 하나를 통째로 포장해 "설치가 되는가"만
// 본다. 릴리스는 그것으로 모자란다. 타깃마다 따로 구워야 하고(아래), 무엇이 실렸는지
// 코어가 읽을 수 있는 형태로 남겨야 하고, 하나라도 빠지면 **릴리스를 만들지 말아야**
// 한다. 셋 다 셸 루프로는 정직하게 못 한다.
//
// **왜 타깃마다 따로 굽나** — `terra module pack` 은 기본으로 `bin/` 전체를 싣는다
// (module_pack.go 의 packDefaultInclude). 타깃 셋을 선언한 모듈을 안 좁히고 포장하면
// 리눅스 노드가 윈도우 바이너리까지 받는다. `--target` 이 `bin/` 만 좁히고, 같은 값이
// verifyStagedProcessEntrypoints 에도 넘어가 **그 타깃의 진입점만** 요구한다 — 그래서
// 타깃별 포장이 "반쪽인데 통과"가 되지 않는다.
//
// **왜 modules.json 인가** (분리 검토 Q-12) — 코어가 자산 이름을 규약으로 조립하면
// 그 이름이 두 저장소 사이의 계약이 된다. 여기서 한 글자만 바꿔도 코어가 깨지고,
// 그 깨짐은 다음 릴리스 때까지 안 보인다. 목록을 같이 실으면 이름은 사람이 읽는
// 용도로 내려가고, 덤으로 **G-2(버전 스큐)의 대조 자리**가 생긴다 — terraCommit 을
// 적어 두면 코어가 빌드할 때 자기 커밋과 맞춰 볼 수 있다.
//
// **왜 여기서 빌드는 안 하나** — `bin/` 을 채우는 것은 tools/build-modules.mjs 의
// 일이다. 이 스크립트는 `bin/` 이 비어 있으면 `pack` 이 내는 MODULE_ENTRYPOINT_MISSING
// 을 그대로 통과시킨다. 굽는 단계를 빠뜨린 릴리스는 조용히 반쪽이 되는 대신 **거기서
// 선다.**

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIERS = ['common', 'leaf', 'tree'];

// modules.json 의 형태가 바뀌면 이 숫자를 올린다 — 코어가 모르는 형태를 만나면
// 추측하는 대신 그 숫자를 대며 거절할 수 있어야 한다.
const MANIFEST_SCHEMA_VERSION = 1;

// --- 인자 ---------------------------------------------------------------

function parseArgs(argv) {
  let cli = process.env.TERRA_CLI ?? '';
  let terra = process.env.TERRA_CHECKOUT ?? '';
  let out = '';
  let tag = process.env.GITHUB_REF_NAME ?? '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--cli') cli = argv[++index] ?? '';
    else if (argument === '--terra') terra = argv[++index] ?? '';
    else if (argument === '--out') out = argv[++index] ?? '';
    else if (argument === '--tag') tag = argv[++index] ?? '';
    else throw new Error(`알 수 없는 인자: ${argument}`);
  }
  if (!cli) {
    throw new Error('terra CLI 가 필요하다 — --cli <path> 또는 TERRA_CLI 환경변수.');
  }
  if (!terra) {
    throw new Error(
      'Terra 체크아웃이 필요하다 — --terra <path> 또는 TERRA_CHECKOUT 환경변수.\n' +
        '자산을 구운 Terra 커밋을 provenance 에 적기 위해서다 (분리 검토 G-2).'
    );
  }
  if (!tag) {
    throw new Error('릴리스 태그가 필요하다 — --tag <tag> 또는 GITHUB_REF_NAME 환경변수.');
  }
  const terraRoot = isAbsolute(terra) ? terra : resolve(repoRoot, terra);
  if (!existsSync(join(terraRoot, 'go.work'))) {
    throw new Error(`Terra 체크아웃이 아니다 (go.work 가 없다): ${terraRoot}`);
  }
  return {
    cli: isAbsolute(cli) ? cli : resolve(process.cwd(), cli),
    terraRoot,
    outDir: isAbsolute(out || 'dist') ? out : resolve(repoRoot, out || 'dist'),
    tag
  };
}

// --- 모듈 훑기 ----------------------------------------------------------

/**
 * module.json 을 가진 디렉터리 전부. build-modules.mjs 의 goModules() 와 달리
 * **거르지 않는다** — Scene 도 extension 도 전부 릴리스에 실린다. 여기서 거르면
 * 빠진 모듈이 오류가 아니라 침묵이 된다.
 */
function allModules() {
  const found = [];
  for (const tier of TIERS) {
    const tierDir = join(repoRoot, tier);
    if (!existsSync(tierDir)) continue;
    for (const entry of readdirSync(tierDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (!entry.isDirectory()) continue;
      const dir = join(tierDir, entry.name);
      if (!existsSync(join(dir, 'module.json'))) continue;
      found.push({ tier, id: entry.name, dir });
    }
  }
  return found;
}

// --- 실행 ---------------------------------------------------------------

function run(command, args, options) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('close', (code) => done(code ?? 1));
  });
}

function capture(command, args, options) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], ...options });
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += chunk;
    });
    child.on('close', (code) => done({ code: code ?? 1, text: text.trim() }));
    child.on('error', () => done({ code: 1, text: '' }));
  });
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

// --- 본체 ---------------------------------------------------------------

async function main() {
  const { cli, terraRoot, outDir, tag } = parseArgs(process.argv.slice(2));
  const modules = allModules();

  // 빈 릴리스를 만들지 않는다. G-7 이 코어에서 보여 준 것과 같은 모양이다 —
  // 모듈 0개 번들이 오류 없이 출하됐다.
  if (modules.length === 0) {
    console.error('::error::포장할 모듈이 없다 — 빈 릴리스는 만들지 않는다');
    return 1;
  }

  // 자산을 다시 만들기 전에 지운다. 지난 실행이 남긴 `.tmod` 가 섞이면 개수는
  // 맞는데 내용이 낡은 릴리스가 된다 — 가장 찾기 어려운 종류의 사고다.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const terraCommit = await capture('git', ['-C', terraRoot, 'rev-parse', 'HEAD']);
  if (terraCommit.code !== 0 || !terraCommit.text) {
    console.error(`::error::Terra 커밋을 읽지 못했다: ${terraRoot}`);
    return 1;
  }

  const entries = [];
  // 자산 실패와 모듈 실패를 따로 센다. 하나로 뭉치면 "4건 실패" 가 타깃 3개가
  // 거절된 모듈 하나인지 모듈 4개인지 알려 주지 않는다.
  let failedAssets = 0;
  let failedModules = 0;
  let assetCount = 0;

  for (const module of modules) {
    const manifest = JSON.parse(await readFile(join(module.dir, 'module.json'), 'utf8'));
    if (manifest.id !== module.id) {
      console.error(`::error::${module.tier}/${module.id}: 매니페스트 id 가 다르다 (${manifest.id})`);
      failedModules += 1;
      continue;
    }
    const declared = Object.keys(manifest.entrypoints?.process ?? {}).sort();

    // 타깃을 선언하지 않은 모듈(Scene·extension)은 파일 하나다. 선언한 모듈은
    // 타깃마다 하나 — 이름에 타깃이 없으면 두 번째가 첫 번째를 덮어쓴다.
    const jobs =
      declared.length === 0
        ? [{ target: null, name: `${manifest.id}-${manifest.version}.tmod`, args: [] }]
        : declared.map((target) => ({
            target,
            name: `${manifest.id}-${manifest.version}-${target}.tmod`,
            args: ['--target', target]
          }));

    const assets = [];
    for (const job of jobs) {
      const outPath = join(outDir, job.name);
      const label = job.target ? `${module.id} → ${job.target}` : module.id;
      console.log(`::group::terra module pack ${label}`);
      const code = await run(cli, ['module', 'pack', module.dir, '--out', outPath, ...job.args]);
      console.log('::endgroup::');
      if (code !== 0) {
        console.error(
          `::error file=${module.tier}/${module.id}/module.json::pack 이 거절했다 (${label}, exit ${code})` +
            (job.target ? ' — bin/ 이 비어 있다면 tools/build-modules.mjs 를 먼저 돌린다' : '')
        );
        failedAssets += 1;
        continue;
      }
      assets.push({ target: job.target, name: job.name, sha256: await sha256(outPath) });
      assetCount += 1;
    }

    // 모듈 하나가 자산을 하나도 못 냈는데 릴리스가 서면, 그 모듈을 핀한 코어는
    // 빌드 때가 되어서야 없는 것을 알게 된다 (G-1).
    if (assets.length === 0) {
      console.error(`::error::${module.tier}/${module.id}: 자산을 하나도 내지 못했다`);
      failedModules += 1;
      continue;
    }

    entries.push({
      id: manifest.id,
      version: manifest.version,
      kind: manifest.kind,
      tier: module.tier,
      // 매니페스트가 적어 두면 싣는다. **역할의 권위는 코어의 선언이다**(D-22) —
      // 이 값은 코어가 대조에 쓸 참고이지 그 자체로 역할 선택의 근거가 아니다.
      products: manifest.compatibility?.products ?? null,
      assets
    });
  }

  if (failedAssets > 0 || failedModules > 0) {
    console.error(
      `::error::자산 ${failedAssets}건 · 모듈 ${failedModules}건이 실패해 릴리스 목록을 쓰지 않는다 — 반쪽 릴리스를 만들지 않는다`
    );
    return 1;
  }

  // 훑은 모듈과 목록에 오른 모듈이 같아야 한다. 위 실패 집계를 빠져나온 경로가
  // 생기더라도 여기서 선다 — 릴리스에서 모듈이 조용히 빠지는 것이 G-1 이 말하는
  // 사고이고, 코어는 빌드 때가 되어서야 그것을 안다.
  if (entries.length !== modules.length) {
    console.error(
      `::error::훑은 모듈 ${modules.length}개 중 ${entries.length}개만 목록에 올랐다 — 릴리스를 만들지 않는다`
    );
    return 1;
  }

  const listing = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    tag,
    builtAt: new Date().toISOString(),
    terraCommit: terraCommit.text,
    moduleCount: entries.length,
    assetCount,
    modules: entries
  };
  const listingPath = join(outDir, 'modules.json');
  await writeFile(listingPath, `${JSON.stringify(listing, null, 2)}\n`, 'utf8');

  console.log(
    `\n포장한 모듈 ${entries.length}개 · 자산 ${assetCount}개 · Terra ${terraCommit.text.slice(0, 8)} → ${outDir}`
  );
  for (const entry of entries) {
    const targets = entry.assets.map((a) => a.target ?? '타깃 없음').join(' · ');
    console.log(`  ${entry.tier}/${entry.id} ${entry.version} — ${targets}`);
  }
  console.log(`  modules.json (${listingPath})`);
  return 0;
}

process.exitCode = await main();
