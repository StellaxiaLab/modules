#!/usr/bin/env node
// 모듈 소스 트리 검증기.
//
// 이 저장소는 모듈 *소스*만 담는다. 그래서 여기서 볼 수 있는 것과 볼 수 없는 것이
// 갈린다.
//
//   볼 수 있다 — 매니페스트의 형식(Manifest v2 스키마), 저장소 배치 규칙,
//                매니페스트가 가리키는 파일의 실재.
//   볼 수 없다 — Scene 무결성(fragment 가 모르는 store 를 부르는지 따위)과
//                포장 화이트리스트의 실제 적용. 그 둘의 권위는 Go 쪽
//                `terra module pack` 이고, 여기서 다시 구현하면 사본이 하나
//                더 생겨 어긋난다. CI 의 pack 잡이 그것을 부른다.
//
// 규칙 번호(L-1 …)는 docs/layout.md 와 같은 것을 가리킨다.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ajvModule from "ajv/dist/2020.js";

const Ajv = ajvModule.default ?? ajvModule;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// 소유권 루트 → 그 루트가 요구하는 compatibility.products (L-4).
const OWNERSHIP_ROOTS = {
  common: ["leaf", "tree"],
  leaf: ["leaf"],
  tree: ["tree"],
};

// terra module pack 이 기본으로 담는 것 + 매니페스트 자신.
const PACKED = new Set(["module.json", "contracts", "ui", "bin", "config", "scene"]);
// 포장되지 않지만 소스 트리에 있는 것이 당연한 것들.
const DEV_ONLY = new Set(["src", "README.md", "licenses", "signature"]);

const args = process.argv.slice(2);
const allowEmpty = args.includes("--allow-empty");
const rootFlag = args.indexOf("--root");
const scanRoot = rootFlag === -1 ? repoRoot : resolve(args[rootFlag + 1]);

const errors = [];
const warnings = [];

const fail = (file, rule, message) => errors.push({ file, rule, message });
const warn = (file, rule, message) => warnings.push({ file, rule, message });

const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

// ── 스키마 (L-5) ────────────────────────────────────────────────────────────
// strict:false 인 이유 — 이 스키마는 이 저장소가 쓴 것이 아니라 Terra 의
// terra-module-runtime 이 소유한 사본이다(schemas/PROVENANCE.json). 사본을
// ajv 의 취향에 맞게 고치는 순간 바이트 대조가 깨지므로 고치지 않는다.
const schemaPath = join(repoRoot, "schemas", "manifest-v2.schema.json");
const ajv = new Ajv({ allErrors: true, strict: false });
const validateManifest = ajv.compile(readJSON(schemaPath));

// ── 발견 (L-1) ──────────────────────────────────────────────────────────────
const modules = [];
for (const root of Object.keys(OWNERSHIP_ROOTS)) {
  const rootPath = join(scanRoot, root);
  if (!isDir(rootPath)) continue;
  for (const entry of readdirSync(rootPath).sort()) {
    if (entry.startsWith(".")) continue;
    if (entry === "README.md") continue;
    const dir = join(rootPath, entry);
    if (!isDir(dir)) {
      warn(`${root}/${entry}`, "L-1", "소유권 루트 바로 아래에는 모듈 디렉터리와 README.md 만 둔다");
      continue;
    }
    const manifestPath = join(dir, "module.json");
    if (!existsSync(manifestPath)) {
      fail(`${root}/${entry}`, "L-1", "module.json 이 없다 — 모듈 디렉터리가 아니면 소유권 루트 밖에 둔다");
      continue;
    }
    modules.push({ root, name: entry, dir, manifestPath });
  }
}

// 소유권 루트 밖에 놓인 모듈 (L-1).
for (const entry of readdirSync(scanRoot)) {
  if (entry.startsWith(".") || entry in OWNERSHIP_ROOTS) continue;
  const candidate = join(scanRoot, entry, "module.json");
  if (existsSync(candidate)) {
    fail(`${entry}/module.json`, "L-1", `모듈이 소유권 루트 밖에 있다 — ${Object.keys(OWNERSHIP_ROOTS).join(" · ")} 중 하나 아래로 옮긴다`);
  }
}

// ── 모듈 0개 (L-9) ─────────────────────────────────────────────────────────
// 빈 모듈 집합은 조용히 통과하지 않는다. Terra 의 릴리스 빌드가 module/ 이
// 비었을 때 오류도 경고도 없이 모듈 0개 번들을 내보내는 것(G-7)과 같은 모양의
// 사고를 이 저장소에서는 여기서 막는다.
if (modules.length === 0) {
  if (allowEmpty) {
    const message = "모듈 0개 — --allow-empty 라서 통과시킨다";
    console.log(process.env.GITHUB_ACTIONS ? `::notice::${message}` : `! ${message}`);
  } else {
    fail(".", "L-9", "모듈이 하나도 없다 — 빈 집합을 통과시키려면 --allow-empty 를 명시한다");
  }
}

const seenIDs = new Map();

for (const module of modules) {
  const label = `${module.root}/${module.name}/module.json`;
  let manifest;
  try {
    manifest = readJSON(module.manifestPath);
  } catch (error) {
    fail(label, "L-5", `JSON 을 읽을 수 없다: ${error.message}`);
    continue;
  }

  // L-5 스키마
  if (!validateManifest(manifest)) {
    for (const error of validateManifest.errors ?? []) {
      const at = error.instancePath || "/";
      fail(label, "L-5", `${at} ${error.message}${error.params?.allowedValues ? ` (${error.params.allowedValues.join(", ")})` : ""}`);
    }
  }

  const id = typeof manifest.id === "string" ? manifest.id : "";

  // L-2 디렉터리 이름 == id
  if (id && id !== module.name) {
    fail(label, "L-2", `디렉터리 이름 ${module.name} 과 id ${id} 가 다르다`);
  }

  // L-3 id 유일성
  if (id) {
    const previous = seenIDs.get(id);
    if (previous) {
      fail(label, "L-3", `id ${id} 가 ${previous} 와 겹친다`);
    } else {
      seenIDs.set(id, `${module.root}/${module.name}`);
    }
  }

  // L-4 소유권 루트가 products 를 정한다
  const expected = OWNERSHIP_ROOTS[module.root];
  const declared = manifest.compatibility?.products;
  if (!Array.isArray(declared)) {
    fail(label, "L-4", `compatibility.products 가 없다 — ${module.root}/ 아래라면 [${expected.map((p) => `"${p}"`).join(", ")}] 이다`);
  } else {
    const normalized = [...declared].sort().join(",");
    if (normalized !== [...expected].sort().join(",")) {
      fail(label, "L-4", `${module.root}/ 아래의 products 는 [${expected.join(", ")}] 인데 [${declared.join(", ")}] 이라고 적혀 있다`);
    }
  }

  // L-6 매니페스트가 가리키는 경로는 패키지를 벗어나지 않고, 소스인 것은 실재한다
  //
  // 실재까지 요구하는 것과 모양만 보는 것을 가른다. 컴파일 산출물(bin/<target>/…,
  // dist/…)은 릴리스 빌드가 낳으므로 소스 트리에 없는 것이 정상이다 — 그것까지
  // 요구하면 출하 모듈 21개 중 18개가 빨개지고, 그것은 발견이 아니라 소음이다.
  // 계약 JSON · Scene · 기여 번들은 사람이 써서 커밋하는 것이므로 실재를 요구한다.
  const referenced = [];
  const pushPath = (value, where, { mustExist }) => {
    if (typeof value === "string" && value.trim() !== "") referenced.push({ value, where, mustExist });
  };
  pushPath(manifest.entrypoints?.scene, "entrypoints.scene", { mustExist: true });
  for (const kind of ["process", "worker", "library", "runtime"]) {
    const targets = manifest.entrypoints?.[kind];
    if (targets && typeof targets === "object") {
      for (const [target, value] of Object.entries(targets)) {
        pushPath(value, `entrypoints.${kind}.${target}`, { mustExist: false });
      }
    }
  }
  for (const [name, value] of Object.entries(manifest.contracts ?? {})) {
    pushPath(value, `contracts.${name}`, { mustExist: true });
  }
  // 기여는 표면마다 모양이 다르고 공통설계가 소유한다. 경로를 들고 있는 자리는
  // 어디든 `entry` 라는 이름이므로, 모양을 가정하지 않고 그 키만 훑는다.
  const walkEntries = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walkEntries(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "entry") pushPath(value, `${path}.entry`, { mustExist: true });
      else walkEntries(value, `${path}.${key}`);
    }
  };
  walkEntries(manifest.contributions, "contributions");

  for (const { value, where, mustExist } of referenced) {
    if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) {
      fail(label, "L-6", `${where} 가 절대 경로다: ${value}`);
      continue;
    }
    const target = resolve(module.dir, value);
    const inside = relative(module.dir, target);
    if (inside.startsWith("..") || inside.startsWith(sep)) {
      fail(label, "L-6", `${where} 가 패키지 밖을 가리킨다: ${value}`);
      continue;
    }
    if (mustExist && !existsSync(target)) {
      fail(label, "L-6", `${where} 가 가리키는 파일이 없다: ${value}`);
    }
  }

  // L-7 kind 가 요구하는 실행 선언
  const entrypointCount = Object.keys(manifest.entrypoints ?? {}).length;
  const gui = manifest.contributions?.gui ?? {};
  const has = (value) => Array.isArray(value) ? value.length > 0 : Boolean(value);
  const satisfied =
    entrypointCount > 0 ||
    (manifest.kind === "scene" && has(gui.scenes)) ||
    (manifest.kind === "extension" && has(gui.extensions)) ||
    (manifest.kind === "adapter" && has(manifest.contributions?.service));
  if (!satisfied) {
    fail(label, "L-7", `kind ${manifest.kind} 인데 entrypoint 도, 구현을 지목하는 contribution 도 없다`);
  }

  // L-8 최상위 항목 — 포장되는 것과 개발 전용을 뺀 나머지는 알린다
  for (const entry of readdirSync(module.dir)) {
    if (entry.startsWith(".")) continue;
    if (PACKED.has(entry) || DEV_ONLY.has(entry)) continue;
    warn(`${module.root}/${module.name}/${entry}`, "L-8", "포장되지 않는다 — 배포에 필요하면 contracts · ui · bin · config · scene 중 하나로 옮긴다");
  }
}

// ── 보고 ────────────────────────────────────────────────────────────────────
const inActions = Boolean(process.env.GITHUB_ACTIONS);
const emit = (kind, items) => {
  for (const { file, rule, message } of items) {
    if (inActions) console.log(`::${kind} file=${file}::[${rule}] ${message}`);
    else console.log(`${kind === "error" ? "✗" : "!"} ${file} [${rule}] ${message}`);
  }
};

emit("warning", warnings);
emit("error", errors);

const scanned = scanRoot === repoRoot ? "" : ` (${scanRoot})`;
console.log(`\n모듈 ${modules.length}개${scanned} · 오류 ${errors.length} · 경고 ${warnings.length}`);
if (modules.length > 0) {
  for (const root of Object.keys(OWNERSHIP_ROOTS)) {
    const inRoot = modules.filter((m) => m.root === root).map((m) => m.name);
    if (inRoot.length > 0) console.log(`  ${root}/ ${inRoot.join(" · ")}`);
  }
}

process.exit(errors.length > 0 ? 1 : 0);
