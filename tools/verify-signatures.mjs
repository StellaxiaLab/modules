// 포장한 `.tmod` 전부를 Terra 가 판정하는 그대로 다시 열어, 기대한 키·tier 로 믿는지 본다.
//
//   node tools/verify-signatures.mjs --cli <terra> --dist <dir> --signing signing.json
//
// **왜 pack 의 성공으로 모자라나** — `pack --sign-key` 는 서명을 **붙였다**는 것만
// 말한다. 노드가 그것을 믿는지는 노드의 keyring 이 정한다. 이 잡의 terra CLI 는 Terra
// main 체크아웃으로 빌드되므로(release.yml), 그 CLI 의 `module inspect` 는 **Terra main
// 의 builtin_keys.json** 으로 판정한다. 그래서 이 검사는 "서명돼 있다"가 아니라 "Terra
// main 이 이 패키지를 signing.json 이 말하는 키와 tier 로 믿는다"를 확인한다
// (Terra ADR-MD-005 §2.4). Terra main 에 공개키가 아직 없으면 여기서 선다 — 그것이
// 맞는 결과다: 키를 모르는 Terra 에 서명된 모듈은 미서명보다 나쁘다(같은 ADR §1 경고).
//
// **왜 수를 세나** — 확인한 자산 수가 modules.json 의 assetCount 와 달라도 선다. 목록에
// 없는 파일이 dist 에 섞였거나 목록의 파일이 빠졌다면, 개별 판정이 전부 초록이어도
// 릴리스가 말하는 것과 실린 것이 다르다(G-10 의 서명판).

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { keyForModule, loadSigningPlan } from './signing.mjs';

function parseArgs(argv) {
  let cli = '';
  let dist = '';
  let signing = '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--cli') cli = argv[++index] ?? '';
    else if (argument === '--dist') dist = argv[++index] ?? '';
    else if (argument === '--signing') signing = argv[++index] ?? '';
    else throw new Error(`알 수 없는 인자: ${argument}`);
  }
  if (!cli || !dist || !signing) {
    throw new Error('usage: node tools/verify-signatures.mjs --cli <terra> --dist <dir> --signing <signing.json>');
  }
  return { cli: resolve(cli), dist: resolve(dist), signing: resolve(signing) };
}

function capture(command, args) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
    child.on('error', (error) => done({ code: 1, stdout, stderr: String(error) }));
  });
}

/**
 * inspect 의 판정에서 이 검사가 보는 것만 꺼낸다. 설치 가능 여부(installable)는 보지
 * 않는다 — 윈도우 타깃 자산은 리눅스 러너에서 늘 "호환 안 됨"이고, 그것은 서명과
 * 무관하다.
 */
export function trustProblem(data, key, label) {
  const trust = data?.trust ?? {};
  if (trust.tier !== key.tier) {
    const why = trust.code ? ` (${trust.code}: ${trust.reason ?? ''})` : '';
    return `${label}: tier ${trust.tier ?? '없음'}${why} — 기대 ${key.tier} (${key.name})`;
  }
  if (trust.key_id !== key.keyId) {
    return `${label}: keyId ${trust.key_id} — 기대 ${key.keyId} (${key.name})`;
  }
  if (trust.issuer !== key.issuer) {
    return `${label}: issuer ${trust.issuer} — 기대 ${key.issuer} (${key.name})`;
  }
  return null;
}

async function main() {
  const { cli, dist, signing } = parseArgs(process.argv.slice(2));
  const plan = loadSigningPlan(signing);
  const listing = JSON.parse(await readFile(join(dist, 'modules.json'), 'utf8'));

  // inspect 는 "이미 깔렸나"도 본다. 러너의 상태를 읽지도 쓰지도 않도록 빈 자리를 준다.
  const scratch = await mkdtemp(join(tmpdir(), 'verify-signatures-'));
  const problems = [];
  let checked = 0;
  try {
    for (const module of listing.modules) {
      const key = keyForModule(plan, module.id);
      if (key === null) {
        problems.push(`${module.id}: signing.json 에 맞는 접두사가 없다`);
        continue;
      }
      for (const asset of module.assets) {
        const result = await capture(cli, [
          '--config', join(scratch, 'config.json'), '--json',
          'module', 'inspect', join(dist, asset.name),
          '--root', join(scratch, 'root'), '--state-root', join(scratch, 'state')
        ]);
        let data;
        try {
          data = JSON.parse(result.stdout).data;
        } catch {
          problems.push(`${asset.name}: inspect 출력을 읽지 못했다 (exit ${result.code}) ${result.stderr.trim()}`);
          continue;
        }
        if (data?.id !== module.id || data?.version !== module.version) {
          problems.push(`${asset.name}: 패키지는 ${data?.id} ${data?.version} — 목록은 ${module.id} ${module.version}`);
          continue;
        }
        const problem = trustProblem(data, key, asset.name);
        if (problem) problems.push(problem);
        else console.log(`  ${asset.name} — ${key.tier} (${key.keyId})`);
        checked += 1;
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const onDisk = (await readdir(dist)).filter((name) => name.endsWith('.tmod')).length;
  if (checked !== listing.assetCount || onDisk !== listing.assetCount) {
    problems.push(`확인 ${checked}개 · dist 의 .tmod ${onDisk}개 · 목록 assetCount ${listing.assetCount}개 — 셋이 같아야 한다`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    console.error('::error::Terra main 이 기대한 키·tier 로 믿지 않는 패키지가 있다 — 릴리스를 만들지 않는다');
    return 1;
  }
  console.log(`서명 확인: 자산 ${checked}개 전부 Terra main 의 keyring 이 기대 tier 로 믿는다`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
