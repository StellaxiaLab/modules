// 웹 화면을 가진 모듈 — `web/` 을 구워 `ui/` 에 놓는 모듈 — 의 공통 배선.
//
// **왜 따로 있나** — `build-web.mjs` · `test-web.mjs` · `pack-modules.mjs` 가 같은 판정을 필요로 한다.
// "어느 모듈이 웹 모듈인가", "구운 결과가 있는가". 세 벌로 들고 있으면 한쪽만 조용히 틀린다 —
// go-workspace.mjs 가 build·test 사이에 같은 이유로 있는 것과 같다.
//
// **웹 모듈이란** — `web/package.json` 이 있는 모듈이다. Terra 의 `terra module new --web` 이 굽는
// 모양이 이것이고(웹 소스는 `web/`, 빌드 결과는 `ui/`), `web/` 은 `terra module pack` 의 허용 목록
// (`contracts·ui·bin·config·scene`) 밖이라 출하되지 않는다. 그래서 `ui/` 는 `bin/` 처럼 **빌드 산출물**이다.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TIERS = ['common', 'leaf', 'tree'];

/** `web/package.json` 을 가진 모듈 디렉터리인가 */
export function isWebModule(dir) {
  return existsSync(join(dir, 'web', 'package.json'));
}

/** 웹 소스를 가진 모듈만 — 나머지는 구울 웹이 없다. */
export function webModules() {
  const found = [];
  for (const tier of TIERS) {
    const tierDir = join(repoRoot, tier);
    if (!existsSync(tierDir)) continue;
    for (const entry of readdirSync(tierDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const dir = join(tierDir, entry.name);
      if (!existsSync(join(dir, 'module.json')) || !isWebModule(dir)) continue;
      found.push({ tier, id: entry.name, dir, web: join(dir, 'web') });
    }
  }
  return found;
}

/**
 * npm 을 부른다. 윈도우에서 npm 은 npm.cmd 이고, Node 는 .cmd 를 셸 없이 spawn 하지 않는다
 * (CVE-2024-27980 이후 EINVAL) — 그래서 윈도우에서만 셸을 거친다.
 */
export function npm(args, cwd) {
  return new Promise((done) => {
    const child = spawn('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => done(code ?? 1));
    child.on('error', () => done(1));
  });
}

/** `web/package.json` 의 scripts */
export function webScripts(module) {
  try {
    return JSON.parse(readFileSync(join(module.web, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    return {};
  }
}

/** 의존을 받는다. 잠금 파일이 있으면 `npm ci` — 잠금 파일 없이 굽는 릴리스는 같은 소스로 다른 결과를 낸다. */
export async function installDependencies(module) {
  const locked = existsSync(join(module.web, 'package-lock.json'));
  if (!locked) {
    console.error(`::error file=${relative(repoRoot, module.web)}/package.json::package-lock.json 이 없다 — 잠금 없이 굽지 않는다 (npm install 로 만들어 커밋한다)`);
    return 1;
  }
  return npm(['ci', '--no-audit', '--no-fund'], module.web);
}

/**
 * `terra module new --web` 이 첫 빌드 전에 두는 자리 표시자의 표식. 그 파일이 남은 채 포장되면
 * `terra module pack` 은 `VERIFIED true` 로 통과시키고 노드에는 "웹 빌드가 아직 없습니다" 화면이
 * 출하된다 — 실측했다. 그래서 여기서 막는다.
 */
const PLACEHOLDER_MARKS = ['웹 빌드가 아직 없습니다', 'terra module new --web</code>이 둔 자리 표시자'];

/**
 * 매니페스트의 static GUI 앱 entry 들 (mode 생략 = static). proxied · window 앱은 파일을 싣지 않는다.
 * @returns {{ id: string, entry: string }[]}
 */
export function staticAppEntries(manifest) {
  const apps = manifest?.contributions?.gui?.apps;
  if (!Array.isArray(apps)) return [];
  return apps
    .filter((app) => app && typeof app.entry === 'string' && app.entry.trim() !== '' && (app.mode ?? 'static') === 'static')
    .map((app) => ({ id: app.id ?? manifest.id, entry: app.entry }));
}

/**
 * 포장 전에 앱 entry 를 본다 — 있는가, 자리 표시자가 아닌가.
 * `terra module pack` 은 gui.apps 의 entry 를 보지 않는다: entry 가 아예 없어도 `VERIFIED true` 다(실측).
 * @returns {string[]} 문제 목록. 비었으면 통과
 */
export function appEntryProblems(dir, manifest) {
  const problems = [];
  const hint = isWebModule(dir) ? ' — 웹 빌드를 먼저 돌린다 (node tools/build-web.mjs)' : '';
  for (const { id, entry } of staticAppEntries(manifest)) {
    const path = resolve(dir, entry);
    if (!existsSync(path) || !statSync(path).isFile()) {
      problems.push(`앱 ${id} 의 entry ${entry} 가 없다${hint}`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    if (PLACEHOLDER_MARKS.some((mark) => text.includes(mark))) {
      problems.push(`앱 ${id} 의 entry ${entry} 가 아직 자리 표시자다${hint}`);
    }
  }
  return problems;
}
