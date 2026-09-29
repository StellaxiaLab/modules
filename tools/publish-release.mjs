// dist/ 의 자산을 GitHub 릴리스로 올린다.
//
//   node tools/publish-release.mjs --dist dist [--repo owner/name] [--dry-run]
//
// **왜 스크립트인가** — 워크플로에 curl 을 늘어놓으면 실패 처리가 사라진다.
// `curl` 은 HTTP 400 을 받고도 exit 0 이고, 그러면 자산 절반만 올라간 릴리스가
// 초록으로 선다. 코어가 그 태그를 핀하면 빌드 때가 되어서야 없는 자산을 안다
// (분리 검토 G-1).
//
// **왜 제3자 액션이 아닌가** — 이 워크플로가 내는 것은 설치되는 물건이다.
// 릴리스 경로에 공급망을 하나 더 들이지 않는다. 필요한 것은 REST 호출 셋뿐이고
// Node 24 의 내장 fetch 로 충분하다.
//
// **왜 draft 로 만들어 나중에 발행하나** — 자산 업로드는 여러 번의 요청이고
// 중간에 실패할 수 있다. 처음부터 발행해 두면 그 실패가 **반쪽짜리 공개 릴리스**
// 를 남긴다. draft 는 보이지 않으므로, 전부 올라간 뒤에 발행하면 "있는데 반쪽"
// 인 순간이 없다. 실패하면 draft 로 남고 — 지우는 것은 사람이 판단한다.

import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const UPLOADS = process.env.GITHUB_UPLOADS_URL || 'https://uploads.github.com';

function parseArgs(argv) {
  let dist = 'dist';
  let repo = process.env.GITHUB_REPOSITORY ?? '';
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dist') dist = argv[++index] ?? '';
    else if (argument === '--repo') repo = argv[++index] ?? '';
    else if (argument === '--dry-run') dryRun = true;
    else throw new Error(`알 수 없는 인자: ${argument}`);
  }
  if (!repo.includes('/')) {
    throw new Error('저장소가 필요하다 — --repo owner/name 또는 GITHUB_REPOSITORY 환경변수.');
  }
  const token = process.env.GITHUB_TOKEN ?? '';
  if (!token && !dryRun) {
    throw new Error('GITHUB_TOKEN 이 필요하다 — 워크플로에 permissions: contents: write 를 준다.');
  }
  return { distDir: isAbsolute(dist) ? dist : resolve(process.cwd(), dist), repo, token, dryRun };
}

async function api(url, { token, method = 'GET', body, headers = {} }) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers
    },
    body
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${url} → ${response.status} ${response.statusText}\n${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/** 릴리스 본문 — 사람이 무엇이 들었는지 보는 자리다. 코어는 modules.json 을 읽는다. */
function releaseBody(listing) {
  const rows = listing.modules.flatMap((module) =>
    module.assets.map((asset) => `| \`${module.id}\` | ${module.version} | ${module.kind} | ${asset.target ?? '—'} | \`${asset.sha256.slice(0, 12)}…\` |`)
  );
  return [
    `모듈 ${listing.moduleCount}개 · 자산 ${listing.assetCount}개.`,
    '',
    '코어는 이 목록을 파일 이름으로 조립하지 말고 **`modules.json`** 을 읽는다 — 이름 규약이',
    '두 저장소 사이의 계약이 되면 한 글자만 바꿔도 코어가 깨진다.',
    '',
    `자산을 구운 Terra 커밋: \`${listing.terraCommit}\``,
    '',
    '| 모듈 | 버전 | kind | 타깃 | sha256 |',
    '| --- | --- | --- | --- | --- |',
    ...rows
  ].join('\n');
}

async function main() {
  const { distDir, repo, token, dryRun } = parseArgs(process.argv.slice(2));
  const listingPath = join(distDir, 'modules.json');
  const listing = JSON.parse(await readFile(listingPath, 'utf8'));

  // 목록과 디스크가 어긋나면 올리지 않는다. pack 이 쓴 뒤 누가 손댔거나, 잘못된
  // dist 를 가리켰거나 — 어느 쪽이든 올리고 나서 알 일이 아니다.
  const files = [listingPath];
  for (const module of listing.modules) {
    for (const asset of module.assets) {
      const path = join(distDir, asset.name);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) {
        throw new Error(`목록에 있는 자산이 디스크에 없다: ${asset.name}`);
      }
      files.push(path);
    }
  }
  const expected = listing.assetCount + 1; // 자산 + modules.json
  if (files.length !== expected) {
    throw new Error(`올릴 파일이 ${files.length}개인데 목록은 ${expected}개를 말한다`);
  }

  console.log(`${repo} ${listing.tag} — 자산 ${listing.assetCount}개 + modules.json`);
  if (dryRun) {
    for (const file of files) console.log(`  (dry-run) ${basename(file)}`);
    console.log('\n--- 릴리스 본문 ---\n' + releaseBody(listing));
    return 0;
  }

  // 1. draft 로 만든다.
  const release = await api(`${API}/repos/${repo}/releases`, {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: listing.tag,
      name: listing.tag,
      body: releaseBody(listing),
      draft: true,
      prerelease: false
    })
  });
  console.log(`draft 릴리스 ${release.id} 생성`);

  // 2. 전부 올린다.
  for (const file of files) {
    const name = basename(file);
    const payload = await readFile(file);
    const url = `${UPLOADS}/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
    await api(url, {
      token,
      method: 'POST',
      headers: {
        'Content-Type': name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'Content-Length': String(payload.byteLength)
      },
      body: payload
    });
    console.log(`  올림 ${name} (${(payload.byteLength / 1048576).toFixed(1)} MB)`);
  }

  // 3. 전부 올라간 뒤에 발행한다.
  const published = await api(`${API}/repos/${repo}/releases/${release.id}`, {
    token,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false })
  });
  console.log(`발행: ${published.html_url}`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
}
