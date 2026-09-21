#!/usr/bin/env node
// 벤더링한 Manifest v2 스키마가 원본에서 떨어져 나가면 빨갛게 만든다.
//
// schemas/manifest-v2.schema.json 은 이 저장소가 쓴 것이 아니라 Terra 의
// terra-module-runtime 이 소유한 사본이다. 사본은 말없이 늙는다 — Terra 쪽
// 스키마가 키를 하나 늘리면 이 저장소의 검증기는 그 키를 모르는 채로 계속
// 초록색이다. 그 창을 닫는 것이 이 스크립트다.
//
// Terra 는 같은 모양의 대조를 이미 두 군데서 쓴다(패키지에 심은 사본 ↔ 문서
// 사본의 바이트 대조, api-console 스테이징 대조). 여기서는 저장소가 갈라졌으니
// Terra 체크아웃을 인자로 받는다.
//
//   node tools/check-schema-drift.mjs --terra /path/to/Terra
//
// 줄바꿈만 정규화하고 그 밖에는 바이트로 본다 — Terra 의 Go 대조 시험과 같다.

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const provenance = JSON.parse(readFileSync(join(repoRoot, "schemas", "PROVENANCE.json"), "utf8"));

const args = process.argv.slice(2);
const terraFlag = args.indexOf("--terra");
const terraRoot = terraFlag === -1 ? process.env.TERRA_CHECKOUT : args[terraFlag + 1];

const normalize = (text) => text.replace(/\r\n/g, "\n");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

let failed = false;
const problem = (message) => {
  console.log(process.env.GITHUB_ACTIONS ? `::error::${message}` : `✗ ${message}`);
  failed = true;
};

for (const [file, record] of Object.entries(provenance)) {
  if (file.startsWith("$")) continue;

  const localPath = join(repoRoot, "schemas", file);
  if (!existsSync(localPath)) {
    problem(`schemas/${file} 이 PROVENANCE.json 에는 있는데 파일이 없다`);
    continue;
  }
  const local = readFileSync(localPath, "utf8");

  // 1. 기록된 해시와 사본 자신이 맞는가 — Terra 체크아웃 없이도 볼 수 있다.
  const actual = sha256(normalize(local));
  if (actual !== record.sha256) {
    problem(
      `schemas/${file} 이 PROVENANCE.json 의 sha256 과 다르다\n` +
        `  기록: ${record.sha256}\n  실제: ${actual}\n` +
        `  사본을 손으로 고쳤다면 되돌리고, 원본이 바뀐 것이라면 새로 복사한 뒤 PROVENANCE.json 을 갱신한다`,
    );
  }

  // 2. 원본과 바이트가 같은가 — Terra 체크아웃이 있을 때만.
  if (!terraRoot) continue;
  const sourcePath = join(terraRoot, record.sourcePath);
  if (!existsSync(sourcePath)) {
    problem(`Terra 체크아웃에 ${record.sourcePath} 이 없다 (--terra ${terraRoot})`);
    continue;
  }
  const source = readFileSync(sourcePath, "utf8");
  if (normalize(source) !== normalize(local)) {
    problem(
      `schemas/${file} 이 ${record.sourceRepository}:${record.sourcePath} 에서 떨어져 나갔다\n` +
        `  원본 sha256: ${sha256(normalize(source))}\n  사본 sha256: ${actual}\n` +
        `  원본을 다시 복사하고 PROVENANCE.json 의 sha256 · vendoredFromCommit 을 갱신한다`,
    );
  }
}

if (!terraRoot) {
  const message = "Terra 체크아웃이 없어 원본 대조는 건너뛴다 — 사본 자신의 해시만 확인했다 (--terra <path> 또는 TERRA_CHECKOUT)";
  console.log(process.env.GITHUB_ACTIONS ? `::notice::${message}` : `! ${message}`);
}

console.log(failed ? "\n스키마 대조 실패" : "\n스키마 대조 통과");
process.exit(failed ? 1 : 0);
