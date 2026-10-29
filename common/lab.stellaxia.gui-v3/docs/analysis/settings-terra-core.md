---
title: "Terra 코어 설정 전수표 — 설정 파일 · 키 · env · 플래그 · 포트 · API"
aliases:
  - "코어 설정 전수표"
  - "Terra Core Settings"
doc_type: "analysis"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-10-28"
language: "ko-KR"
based_on: "Terra main 8192add (2026-10-28, shallow) — 읽기만 함(빌드 · 시험 없음). 비밀 값은 적지 않음"
os_priority:
  - Linux
  - Windows
  - macOS
related:
  - "[[settings-inventory|GUI v3 설정 종합]]"
  - "[[settings-modules|modules 설정 전수표]]"
---

# Terra core — 설정 관리 대상 전수 인벤토리 (GUI v3 설계 입력)

- 대상: `/home/claude/terra` (StellaxiaLab/Terra), HEAD `8192add`, 2026-10-28 (shallow clone)
- 방법: 읽기 전용. `os.Getenv/LookupEnv`, `flag.*`, 커스텀 argv 파서, `json.Unmarshal`(설정 로드), `filepath.Join`(데이터 경로), `UserConfigDir/UserCacheDir`, Local API·Master·Gateway·Host 라우트, API 계약(`terra-api.json`), 인스톨러 writer, infra 스크립트를 grep → 정의 파일 정독.
- 경로 표기: 모든 `path:line` 은 저장소 루트 기준. `D=` `products/leaf/daemon/src/terra_daemon`, `M=` `products/tree/master/src/terra_master`, `CLI=` `products/common/apps/terra-cli/internal`, `INS=` `products/common/apps/terra-installer/internal/installer`, `GW=` `products/common/apps/terra-gateway-service`, `HOST=` `products/common/host/host`, `MH=` `products/common/packages/terra-module-host`, `MRT=` `products/common/packages/terra-module-runtime`.
- 비밀 값은 기록하지 않았다(이름·위치만).
- "GUI" 열: **E**=편집 가능하게 노출, **R**=읽기 전용 노출, **N**=노출 금지(never), **A**=고급/숨김(전문가 화면에서만). 판단 근거는 코드의 소유자(owner) 모델을 1차로 따른다.

## 0. 저장소 관례 (설정 관련)

| 관례 | 근거 |
| --- | --- |
| 설정 형식은 **전부 JSON**. YAML/TOML/INI/viper/cobra 없음. 모든 CLI 파서는 stdlib `flag` 또는 수제 argv 루프 | grep 결과 0건(viper/yaml/toml) |
| Daemon·Master 설정 키마다 **소유자(owner)**: `installer` / `operator`(기본) / `derived` / `secret` | `D/core/config.go:755-871`, `M/app/config.go:255-315` |
| `secret` 키는 `GET /config`·`config get/show` 에서 `***` 로 가리고, config API(`SetValue`/PATCH)로는 **설정 불가** | `D/core/config.go:1075-1112,1238-1249`, `M/app/config.go:398-453,538-548` |
| 설치 직후 스냅숏 `config-baseline.json` 을 config 옆에 쓰고, operator 키가 거기서 벗어나면 `deviations` 로 계속 보고 | `D/core/config.go:1114-1206`, `INS/setup_engine.go:2378` |
| 루프백 포트·쿠키 이름은 **한 표**(`HOST/endpoints.go`)에서 생성기로 모든 소비자(Go/TS/C#)에 미러링. 손으로 고치지 말 것 | `HOST/endpoints.go:5-50`, `products/common/contracts/endpoints.json` (generated), `tools/endpoints-gen` |
| 비밀은 값이 아니라 **파일 경로**로 넘긴다(argv 노출 방지) | `D/gatewayservice/module.go:292-308`, `M/gatewayservice/service.go:230-240` |
| CLI 명령 설명 정본은 `CLI/help/registry.go` | `README.md` |
| 설정·데이터 소유권 설계 문서 | `docs/implementation/config-data-ownership-consolidation-plan.md` (§4.2 키 분류 근거) |

---

## 1. 설정 파일 인벤토리 (무엇이 어디에)

| # | 파일 | 형식/스키마(구조체) | 기본 위치 (Linux 설치본) | 쓰는 쪽 | 읽는 쪽 | GUI |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Daemon 설정 `config.json` | `core.Config` `D/core/config.go:52-100` | `~/.terra/terra/config.json` (바이너리 기본 `--config ~/.terra/config.json` `products/leaf/daemon/cmd/terra-daemon/main.go:879`) | 인스톨러 `INS/setup_engine.go:2835-2967`, Local API `PATCH /config`·`/config/save|apply`, CLI `terra daemon config set`, WireGuard desired-sync | terra-daemon, CLI(`config_sync.go:344`), 인스톨러 | E(operator 키), R(installer/derived), N(secret) |
| F2 | Daemon 설치 기준선 `config-baseline.json` | 같은 구조 | F1 옆 | 인스톨러 | daemon `GET /config`(deviations) | R |
| F3 | Master 설정 `config.json` | `app.Config` `M/app/config.go:32-154` | `~/.terra-master/terra/config.json` | 인스톨러 `INS/setup_engine.go:2617-2722`, CLI `terra master config set/save`(파일 직접) | terra-master | E(operator, **파일 편집 경로만**), N(secret) |
| F4 | Master 기준선 `config-baseline.json` | 같은 구조 | F3 옆 | 인스톨러 | `terra master config show` | R |
| F5 | Product Host 설정 `product-host/config.json` | `host.Config` `HOST/config.go:78-101` (unknown field 거부) | leaf: `~/.terra/terra/product-host/config.json`, tree: `~/.terra-master/terra/product-host/config.json` (`INS/setup_engine.go:4940-4953`) | 인스톨러 `INS/setup_engine.go:3085-3160` | terra-host, Windows DesktopShell(`ProductProfile.cs:122`) | R (대부분 설치 사실) |
| F6 | CLI 설정 `cli/config.json` | `config.Document{active_profile, profiles}` `CLI/config/config.go:18-78` | `~/.terra/cli/config.json`; Win `%LOCALAPPDATA%\Terra\cli\config.json` (`CLI/config/config.go:99-113`) | `terra config set/sync/init`, `terra profile *`, 로그인(tree_aliases) | terra CLI | E (CLI 프로필 화면) |
| F7 | CLI 토큰 저장소 `tokens.json` | `{tokens:{<profile>, <profile>#refresh, <profile>@tree:<ref>}}` `CLI/config/config.go:278-338` | F6 옆 (0600) | `terra login/logout` | CLI | N |
| F8 | 모듈별 설정 레코드 `module-config/<id>.json` (+`<id>.effective.json`) | `ModuleConfigRecord` `MRT/config_store.go:22-37` | `<modules.state_dir>/module-config/` (기본 daemon data dir) | Local API `PATCH /modules/{id}/config`, Gateway | Module Host, 모듈(`TERRA_MODULE_CONFIG_FILE`) | E(스키마 기반 동적 폼), secret 키는 set 여부만 |
| F9 | 모듈 설치 기록 `module-state/<id>/state/state.json` | Keeper state `MRT/state_store.go:73-85,234` | `<state_dir>/module-state/...` | 인스톨러, reconciler, `terra module install` | Module Host(설치 게이트) | R |
| F10 | Network helper 정책 `network-helper.json` | `network_helper.Policy` `D/network_helper/helper.go:21-29` (unknown field 거부, 64KiB 제한) | `/etc/terra/network-helper.json` (Win `%ProgramData%\Terra\`, macOS `/Library/Application Support/Terra/`) `D/network_helper/helper.go:153-169` | 인스톨러(sudo) `INS/setup_platform_linux.go:155-204` | terra-network-helper (root) | N (권한 상승 경계) |
| F11 | 설치 매니페스트 `install-manifest.json` | `InstallManifest` `INS/setup_types.go:257-297` | `~/.local/share/terra/terra/install-manifest.json` | 인스톨러 | CLI(데이터 디렉터리 탐색 `CLI/app/config_sync.go:307-333,406-432`), DesktopShell, 인스톨러 | R |
| F12 | 등록 상태 `registration.json` | `registration.Store` `D/registration/state.go:65` | `<daemon data>/registration.json` | daemon | Master(`tree_node_id_file`), 인스톨러, Gateway credential refresh | R (node_id 등, 비밀 없음 — 코드 주석상 "safe to expose") |
| F13 | SVI 런타임 선언 `svi-declarations.json` | `svideclare.Store` `D/svideclare/store.go:19-23` | `<daemon data>/` | `POST /svi/declarations*` | daemon | E(엔벨로프 범위 안) |
| F14 | SVI incarnation `svi-state.json` | `D/data_plane/module.go:339` | `<daemon data>/` | daemon | daemon | N |
| F15 | WireGuard peer index `wireguard/peer-index.json` | `D/data_plane/network/wireguard/peer_index.go:22,61` | `<daemon data>/wireguard/` | daemon | daemon | N |
| F16 | 코어 업데이트 스테이징 `updates/…` (`.terra-core-staged`, `apply-plan.json`, `apply-result.json`, `apply.log`) | `D/coredistrib/module.go:444`, `D/coredistrib/spawn.go:25-26,204` | `<daemon data>/updates` (`D/core/config.go:318-327`) | daemon | daemon(`--core-apply`) | R(상태) |
| F17 | 인스톨러 신뢰 기록 `trust-state.json` + UI 락 `ui.lock` | `INS/setup_remote.go:29-53`, `INS/setup_ui_cmd.go:70` | `~/.config/Terra/installer/` (캐시 `~/.cache/Terra/installer/{downloads,staging}`) | 인스톨러 | 인스톨러 | N |
| F18 | 가상 장치 모듈 설정 `virtual-device.json` | `products/common/apps/terra-virtual-device/vdevice/config.go:42` | `$TERRA_MODULE_DIR/config/` | 운영자 | terra-virtual-device | 모듈 범위 |
| F19 | 번들 선언 `bundled-modules.json` / `installer-modules.json` | 레포 루트 (schemaVersion 1, `release.repo/tag`, `modules[{id,roles,required}]`) | 빌드 입력 | 개발자 | build-release.ps1, terra-release-sign(`--installer-modules`) | N (빌드 타임) |
| F20 | Master 서비스 아이덴티티 `service-identity.json` | `M/app/app.go:176` | `<master data>/` | master | master | N |
| F21 | Master DB `terra-master.db` (SQLite) 또는 PostgreSQL | `M/app/config.go:835-840` | `<master data>/terra-master.db` | master | master | R(경로·종류) |

---

## 2. Daemon 설정 키 (`config.json`) — 전체 표

- 정의: `D/core/config.go:52-640`, 기본값 `:656-687`, 편집 가능 스키마 `ConfigSchema()` `:886-1063` (**140키**; 응답 주석의 "118 keys" `D/local_api/config_routes.go:45` 는 낡은 숫자), 소유자 `:792-863`, 환경변수 오버레이 `ApplyEnv` `:1470-1713`, 정규화 `:1734-1951`, 검증 `:1987-2181`, 디렉터리 생성 `:2183-2203`(0700).
- 우선순위: 기본값 → JSON 파일(기본값 위에 overlay) → `TERRA_DAEMON_*` env(빈 문자열은 무시) → CLI 플래그(`--master-url/--log-level/--data-dir/--runtime-mode`) → Normalize → Validate (`D/core/config.go:698-735`).
- `restart` 열: 스키마의 `RestartRequired`. 거의 전부 true — **런타임 즉시 반영은 `daemon.device_name/roles/capabilities`, `logging.level`, `local_fs.*` 뿐**.
- `env` 열: `TERRA_DAEMON_` 접두사 뒤 이름. `—` = env 없음.
- Owner: I=installer, O=operator, D=derived, S=secret.

### 2.1 daemon / master / heartbeat / logging / task_queue

| key | type | default | owner | env | 의미 / 비고 | GUI |
| --- | --- | --- | --- | --- | --- | --- |
| `daemon.node_id` (`:169`) | string | "" | D | NODE_ID | Master가 등록 시 발급 | R |
| `daemon.device_name` (`:170`) | string | "" (설치시 `--device-name`) | O | DEVICE_NAME | 표시 이름; restart 불필요 | E |
| `daemon.roles` (`:171`) | []string | [] (설치시 역할) | D | NODE_ROLES (comma) | 설치된 역할 | R |
| `daemon.capabilities` (`:172`) | []string | [] | O | NODE_CAPABILITIES | 광고 capability | A |
| `daemon.environment` (`:173`) | string `dev|test|prod` | `prod` | O | — | prod면 TLS·local_api 인증 강제 | A |
| `daemon.data_dir` (`:174`) | path | `~/.terra` (설치 `~/.terra/terra`) | I | DATA_DIR (storage.data_dir도 같이 설정) | 모든 파생 경로의 루트 | R |
| `daemon.runtime_mode` (`:175`) | `foreground|service|dev` | `service` | O | RUNTIME_MODE | dev면 TLS 요구 해제 | A |
| `daemon.co_located_master.base_url` (`:162`) | URL(loopback) | "" | I | — | 같은 노드 Master로의 위임 hop | R |
| `daemon.co_located_master.service_credential` (`:164`) | string | "" | **S** | — | Core-peer 비밀 | N |
| `daemon.co_located_master.request_timeout_sec` (`:165`) | int | 0 | O | — | | A |
| `master.url` (`:180`) | URL | "" (필수) | O | MASTER_URL | Master origin; `ws/wss` → `http/https`로 정규화, 경로·자격 제거 `:1956-1985`; prod+require_tls면 https 필수 `:2001` | E (재등록 영향 큼, 확인 필요) |
| `master.reconnect` (`:181`) | bool | true | O | — | **런타임 소비처 없음**(검증만) | A |
| `master.reconnect_initial_delay_ms` (`:182`) | int | 1000 | O | — | | A |
| `master.reconnect_max_delay_ms` (`:183`) | int | 30000 | O | — | ≥ initial | A |
| `master.request_timeout_sec` (`:184`) | int | 10 | O | — | ≥1 | A |
| `heartbeat.interval_sec` (`:187`) | int | 10 | O | — | ≥1 | A |
| `heartbeat.timeout_sec` (`:188`) | int | 5 | O | — | ≤ interval; **런타임 소비처 없음** | A |
| `logging.level` (`:191`) | `debug|info|warn|warning|error` | info | O | LOG_LEVEL | restart 불필요 | E |
| `logging.format` (`:192`) | `json|text` | json | O | — | | A |
| `logging.file_enabled` (`:193`) | bool | true | O(설치가 true로 씀) | — | | A |
| `logging.log_dir` (`:194`) | path | `~/.terra/logs` → `<data>/logs` | I | — | `daemon.log`·`job.log`·`audit.log` `D/core/logger.go:74-83` | R |
| `logging.max_size_mb` (`:195`) | int | 10 | O | — | 파일당 회전 크기(≥1) | E |
| `logging.max_backups` (`:196`) | int | 5 | O | — | ≥0 | E |
| `task_queue.worker_count` (`:199`) | int | 4 | O | — | | A |
| `task_queue.max_queue_size` (`:200`) | int | 1024 | O | — | | A |
| `task_queue.default_timeout_sec` (`:201`) | int | 300 | O | — | | A |
| `task_queue.max_retry_count` (`:202`) | int | 3 | O | — | **런타임 소비처 없음** | A |

### 2.2 security / local_api / enrollment

| key | type | default | owner | env | 의미 / 비고 | GUI |
| --- | --- | --- | --- | --- | --- | --- |
| `security.device_token_path` (`:205`) | path | `~/.terra/token.json` (설치: `<data>/device_token` `INS/setup_engine.go:2786`) | I | DEVICE_TOKEN_PATH | 장치 자격 파일 위치(값은 비밀) | R(경로) |
| `security.private_key_path` (`:206`) | path | `~/.terra/keys/device_private.key` | I | — | **런타임 소비처 없음** | R/숨김 |
| `security.public_key_path` (`:207`) | path | `~/.terra/keys/device_public.key` | I | — | **런타임 소비처 없음** | R/숨김 |
| `security.require_tls` (`:208`) | bool | true (설치: master.url이 https일 때만 true `INS/setup_engine.go:2911`) | O | REQUIRE_TLS | 검증 게이트로만 쓰임 | A (보안 경고 필수) |
| `local_api.enabled` (`:211`) | bool | true | O | LOCAL_API_ENABLED | | A |
| `local_api.bind_host` (`:212`) | host | `127.0.0.1` (endpoints 표) | O | LOCAL_API_BIND_HOST | prod에서 0.0.0.0 금지 `:2174` | A |
| `local_api.port` (`:213`) | int | **17321** (endpoints 표) | O | LOCAL_API_PORT | | A (바꾸면 host/CLI 미러와 불일치) |
| `local_api.auth_token_path` (`:214`) | path | Linux `~/.terra/local_api_token`, Win `%APPDATA%\Terra\local_api_token` (`:689-696`); 설치: `<data>/local_api_token` | I | LOCAL_API_AUTH_TOKEN_PATH | Local API bearer 토큰 파일 | R(경로) |
| `local_api.require_auth` (`:215`) | bool | true | O | LOCAL_API_REQUIRE_AUTH | prod에서 false 금지 | N(끄기 금지) |
| `local_api.enable_debug` (`:216`) | bool | false | O | LOCAL_API_ENABLE_DEBUG | `/debug/config`, `/debug/routes` 등록 | A |
| `local_api.shutdown_timeout_sec` (`:217`) | int | 5 | O | — | | A |
| `enrollment.enabled` (`:223`) | bool | true | I | ENROLLMENT_ENABLED | | R |
| `enrollment.state_path` (`:224`) | path | `<data>/registration.json` | I | ENROLLMENT_STATE_PATH | | R |
| `enrollment.join_code_path` (`:229`) | path | "" | O | (값 자체는 `TERRA_JOIN_CODE`가 우선) | Fleet join code 파일 | A |
| `enrollment.instance_key` (`:234`) | string | "" (→hostname) | O | `TERRA_INSTANCE_KEY` | Fleet 좌석 식별 | A |
| `enrollment.image_digest` (`:238`) | string | "" | D | `TERRA_IMAGE_DIGEST` | | R |

### 2.3 storage / local_fs / modules / distribution

| key | type | default | owner | env | 의미 / 비고 | GUI |
| --- | --- | --- | --- | --- | --- | --- |
| `storage.data_dir` (`:391`) | path | `~/.terra` (= daemon.data_dir) | I | (DATA_DIR) | | R |
| `storage.cache_dir` (`:392`) | path | `<storage>/cache` | I | — | EnsureDirs 외 **소비처 없음** | R |
| `storage.shared_dirs` (`:402`) | `[{name,path}]` 또는 문자열 | `[{path:"~/TerraShare"}]` → 이름 없으면 `share-0…` | O | — | 공유 폴더(모듈 shared-roots 권한으로 전달) | **E (핵심 사용자 설정)** |
| `storage.temp_dir` (`:403`) | path | `<storage>/tmp` | I | — | | R |
| `storage.memos_dir` (`:412`) | *string (nil=기본, ""=끔) | `<storage>/memos` | O | — | 예약 루트 이름 `memos` `:417`; shared_dirs가 `memos` 이름 쓰면 부팅 실패 `:2014-2020` | E |
| `local_fs.enabled` (`:107`) | bool | true | O | — | 루프백 GUI 폴더 브라우저; restart 불필요 | E |
| `local_fs.roots` (`:111`) | `[{name,path}]` | [] → OS 기본(Linux `/`,`$HOME`; Win 드라이브+`%USERPROFILE%`; mac `/`,`$HOME`,`/Volumes/*`) `D/localfs/roots_*.go` | O | — | | E |
| `local_fs.deny` (`:115`) | []path | [] (+항상 data dir·config dir·storage data dir `ProtectedPaths` `:122-131`) | O | — | | E |
| `modules.enabled` (`MH/logger.go:54`) | bool | true (설치: modules 컴포넌트 여부) | I | MODULES_ENABLED | | R |
| `modules.directories` (`MH/logger.go:55`) | []path | [] → `<data>/modules`; 설치 `<install>/modules` + managed root가 항상 덧붙음 `:1850-1870` | I | MODULE_DIRECTORIES | | R |
| `modules.managed_directories` (`MH/logger.go:70`) | []path | managed root 자동 추가 | I | — | 설치기록 게이트 적용 범위 | R |
| `modules.allow_tree_override` (`MH/logger.go:86`) | bool | false | I | — | 이미지 모듈 vs 트리 배포 모듈 승자 | R |
| `modules.auto_start` (`MH/logger.go:87`) | bool | true | O | MODULE_AUTO_START | | E |
| `modules.require_executable_hash` (`MH/logger.go:88`) | bool | true | O | MODULE_REQUIRE_EXECUTABLE_HASH | | A (보안) |
| `modules.stop_timeout_sec` (`MH/logger.go:89`) | int | 10 | O | MODULE_STOP_TIMEOUT_SEC | | A |
| `modules.restart_backoff_ms` (`MH/logger.go:90`) | int | 1000 | O | MODULE_RESTART_BACKOFF_MS | | A |
| `modules.max_restarts` (`MH/logger.go:91`) | int | 3 | O | MODULE_MAX_RESTARTS | | A |
| `modules.strict_module_signing` (`MH/logger.go:98`) | bool | false | O | MODULE_STRICT_SIGNING | true면 무서명 모듈 격리 | A (보안) |
| `modules.gateway_ipc` (`MH/logger.go:105`) | string | "" (파생) | D | MODULE_GATEWAY_IPC | provider 등록 IPC | R |
| `modules.rescan_interval_sec` (`MH/logger.go:109`) | int | 0(1회 스캔) | O | — | | A |
| `modules.state_dir` (`MH/logger.go:118`) | path | daemon.data_dir | I | — | `module-state/`, `module-config/` 루트 | R |
| `modules.shared_roots` (`MH/logger.go:126`) | – | storage에서 자동 채움 | – | — | **스키마 외**(daemon은 덮어씀) | N |
| `modules.allow_unsigned_shared_roots` (`MH/logger.go:137`) | bool | false | O | — | **스키마 외**(파일 편집만). 의도적으로 env 없음 | A (보안 경고) |
| `module_distribution.enabled` (`:261`) | bool | true | O | — | 트리 모듈 배포 reconciler | E |
| `module_distribution.poll_interval_sec` (`:264`) | int | 0(=lease 갱신 주기, ≥60s) | O | — | | A |
| `module_distribution.allow_dev_install` (`:267`) | bool | false | O | — | 무서명 자동설치 허용 | A (위험) |
| `module_distribution.disk_quota_mb` (`:270`) | int | 0(무제한) | O | — | | E |
| `core_distribution.enabled` (`:281`) | bool | true | O | — | 코어 릴리스 스테이징 | E |
| `core_distribution.role` (`:285`) | string | ""(=terra) | O | — | 받을 번들 | A |
| `core_distribution.poll_interval_sec` (`:287`) | int | 0(기본) | O | — | | A |
| `core_distribution.disk_quota_mb` (`:291`) | int | **4096** | O | — | | E |
| `core_distribution.hold` (`:293`) | bool | false | O | — | 업데이트 거부(상위에 선언) | **E (업데이트 정책)** |
| `core_distribution.hold_reason` (`:311`) | string | ""(→기본 문구) | O | — | | E |
| `core_distribution.maintenance_window` (`:303`) | `"HH:MM-HH:MM"` 로컬시간 | ""(언제든) | O | — | 자정 넘김 허용 | **E** |
| `core_distribution.allow_apply` (`:308`) | *bool | nil(=허용) | O | — | false면 받기만 하고 교체 안 함 | **E** |
| `fleet_host.enabled` (`:244`) | bool | false | I | — | docker 컨테이너 호스트 역할 | R (재설치로 변경) |
| `fleet_host.poll_interval_sec` (`:246`) | int | 0(=30s) | O | — | | A |
| `fleet_host.docker_binary` (`:249`) | path | ""(PATH의 docker) | O | — | | A |
| `fleet_host.stop_timeout_sec` (`:251`) | int | 0 | O | — | | A |
| `service_tunnels.enabled` (`:140`) | bool | true | O | — | 선언된 터널 재개방 | E |
| `service_tunnels.reconcile_interval_sec` (`:142`) | int | 0(기본) | O | — | | A |
| `remote_operations.workers` (`:151`) | int | 0(=4) | O | — | 릴레이 operation 동시 실행 수 | A |

### 2.4 gateway_service / feature / svi

| key | type | default | owner | env | 의미 / 비고 | GUI |
| --- | --- | --- | --- | --- | --- | --- |
| `gateway_service.enabled` (`:460`) | bool | true | O | GATEWAY_SERVICE_ENABLED | 바이너리 없으면 조용히 off | A |
| `gateway_service.binary_path` (`:463`) | path | ""(daemon 옆) | I | GATEWAY_SERVICE_BINARY | | R |
| `gateway_service.addr` (`:469`) | host:port | `127.0.0.1:8787` | O | GATEWAY_SERVICE_ADDR | | A (미러 불일치 위험) |
| `gateway_service.ipc` (`:472`) | string | "" → `<data>/gateway.sock` / Win `\\.\pipe\terra-gateway-<hash>` | D | GATEWAY_SERVICE_IPC | | R |
| `gateway_service.master_service_credential` (`:478`) | string | "" | **S** | GATEWAY_SERVICE_MASTER_CREDENTIAL | Core-peer 비밀(없으면 GW auth mode none) | N (상태 "설정됨/안됨"만 R) |
| `gateway_service.dev_open` (`:481`) | bool | false | O | — | 모든 호출자 전권 — 개발 전용 | N |
| `feature.enable_docker` (`:539`) | bool | false | O | ENABLE_DOCKER | **소비처 없음** | 숨김 |
| `feature.enable_screen_share` (`:540`) | bool | false | O | — | **소비처 없음** | 숨김 |
| `feature.enable_io_gateway` (`:541`) | bool | true | O | — | `products/leaf/daemon/cmd/terra-daemon/main.go:387` | A |
| `feature.enable_svi` (`:542`) | bool | true | O | ENABLE_SVI | | E |
| `feature.enable_svi_test_stream` (`:549`) | bool | true | O | ENABLE_SVI_TEST_STREAM | 테스트 스트림 리소스 | A |
| `feature.enable_experimental` (`:550`) | bool | false | O | — | **소비처 없음** | 숨김 |
| `svi.resources[]` (`:495`, decl `D/core/svi_declarations.go:18-34`) | `{family: process|file|net, name, direction: source|sink, command,args,path,address,mode,framing}` | [] | – | — | **스키마 외: 파일 편집만** (`:1064-1067`) | R (편집은 런타임 선언 API로) |
| `svi.runtime.file_roots` (`svi_declarations.go:342`) | []path | [] | – | — | 런타임 선언 엔벨로프. **API로 넓힐 수 없음(의도)** | R |
| `svi.runtime.process` (`:344`) | `off|allowlist|any` | off | – | — | | R |
| `svi.runtime.process_commands` (`:347`) | []abs path | [] | – | — | | R |
| `svi.runtime.max_declarations` (`:349`) | int | 0(기본) | – | — | | R |
| `svi.runtime.net` (`:353`) | `off|allowlist` | off | – | — | | R |
| `svi.runtime.net_endpoints` (`:356`) | `tcp|udp://ip:port[-last]` | [] | – | — | | R |
| `svi.process_sources|process_sinks|file_sinks|file_sources` (`:502-513`) | 구형 목록 | [] | – | — | | R |

### 2.5 네트워크 (direct_tcp / grpc_transport / mesh_vpn / wireguard / webrtc)

| key | type | default | owner | env | 비고 | GUI |
| --- | --- | --- | --- | --- | --- | --- |
| `direct_tcp.enabled` (`:574`) | bool | false | O | DIRECT_TCP_ENABLED | LAN 리스너(TLS1.3 자체서명+route ticket) | E |
| `direct_tcp.listen_host` | host | 0.0.0.0 | O | DIRECT_TCP_LISTEN_HOST | | A |
| `direct_tcp.advertise_host` | host | "" (enabled면 필수, 0.0.0.0/:: 금지) | O | DIRECT_TCP_ADVERTISE_HOST | | E |
| `direct_tcp.port` | int | **17322** | O | DIRECT_TCP_PORT | | E |
| `direct_tcp.connect_timeout_ms` | int | 5000 | O | DIRECT_TCP_CONNECT_TIMEOUT_MS | | A |
| `grpc_transport.enabled/listen_host/advertise_host/port/connect_timeout_ms` (`:565-571`) | – | false / 0.0.0.0 / "" / **17325** / 5000 | O | — (env 없음) | | A |
| `mesh_vpn.enabled` (`:586`) | bool | false | **D** | MESH_VPN_ENABLED | managed WG면 desired-sync가 씀 | R |
| `mesh_vpn.adapter` | string | wireguard | D | MESH_VPN_ADAPTER | tcp/websocket/webrtc 금지 | R |
| `mesh_vpn.mode` | `external|managed` | external | D | MESH_VPN_MODE | | R |
| `mesh_vpn.listen_host` | host | 0.0.0.0 | O | MESH_VPN_LISTEN_HOST | | A |
| `mesh_vpn.advertise_host` | host | "" | D | MESH_VPN_ADVERTISE_HOST | | R |
| `mesh_vpn.port` | int | **17323** | O | MESH_VPN_PORT | | A |
| `mesh_vpn.network_id`/`peer_id` | string | "" | D | MESH_VPN_NETWORK_ID/PEER_ID | | R |
| `mesh_vpn.connect_timeout_ms` | int | 5000 | O | MESH_VPN_CONNECT_TIMEOUT_MS | | A |
| `wireguard.enabled` (`:601`) | bool | false (설치 `--wireguard` ≠ disabled면 true) | O | WIREGUARD_ENABLED | | E |
| `wireguard.mode` | `external|managed` | external | **I** | WIREGUARD_MODE | managed는 헬퍼 설치 필요 → 재설치로 변경 | R (재설치 안내) |
| `wireguard.interface_name` | string | `terra0` | O | WIREGUARD_INTERFACE_NAME | 헬퍼 정책 allowed_interfaces와 일치해야 함 | A |
| `wireguard.private_key_path` | path | `<data>/wireguard/private.key` | I | WIREGUARD_PRIVATE_KEY_PATH | | R(경로) |
| `wireguard.address_cidr` | CIDR | "" | D | WIREGUARD_ADDRESS_CIDR | Master 계획이 배정 | R |
| `wireguard.listen_port` | int | **51820** | O | WIREGUARD_LISTEN_PORT | 0-65535 | E |
| `wireguard.advertise_endpoint` | host:port | "" | O | WIREGUARD_ADVERTISE_ENDPOINT | | E |
| `wireguard.stun_servers` | []string | [] (설치: `stun:stun.l.google.com:19302`) | O | WIREGUARD_STUN_SERVERS | | E |
| `wireguard.stun_timeout_ms` | int | 2000 | O | WIREGUARD_STUN_TIMEOUT_MS | | A |
| `wireguard.nat_mapping_mode` | `auto|disabled` | auto | O | WIREGUARD_NAT_MAPPING_MODE | | E |
| `wireguard.nat_mapping_protocols` | ⊆{nat-pmp,pcp,upnp} | 셋 다 | O | WIREGUARD_NAT_MAPPING_PROTOCOLS | | A |
| `wireguard.nat_gateway` | IP | "" (`TERRA_WIREGUARD_NAT_GATEWAY` env도 있음 `D/local_api/wireguard_nat.go:245`) | O | WIREGUARD_NAT_GATEWAY | | A |
| `wireguard.nat_mapping_lifetime_sec` | int | 3600 (≥60) | O | …_LIFETIME_SEC | | A |
| `wireguard.nat_probe_timeout_ms` | int | 2000 | O | …_PROBE_TIMEOUT_MS | | A |
| `wireguard.endpoint_refresh_interval_sec` | int | 60 | O | … | | A |
| `wireguard.privileged_helper_path` | path | "" (managed: `/usr/libexec/terra/terra-network-helper`, Win `%ProgramFiles%\Terra\terra-network-helper.exe`) | I | WIREGUARD_PRIVILEGED_HELPER_PATH | | R |
| `wireguard.privileged_helper_timeout_sec` | int | 30 | O | … | | A |
| `wireguard.mtu` | int | 1420 (0 또는 ≥576) | O | WIREGUARD_MTU | | A |
| `wireguard.persistent_keepalive_sec` | int | 25 | O | … | | A |
| `wireguard.auto_install` / `auto_up` | bool | false/false (설치: enabled / managed) | I | … | | R |
| `wireguard.desired_sync_interval_sec` | int | 60 | O | … | | A |
| `wireguard.install_policy` | `optional|required` | optional | I | … | | R |
| `webrtc.enabled` (`:630`) | bool | false | O | WEBRTC_ENABLED | Service Tunnel P2P | E |
| `webrtc.stun_servers` | []string | [] | O | WEBRTC_STUN_SERVERS | | E |
| `webrtc.ice_servers[]` (`:632,636-640`) | `{urls,username,credential}` | [] | – (**스키마 외**) | WEBRTC_ICE_SERVERS | `credential` 은 TURN 비밀인데 **owner 표에 secret 로 등록되지 않음** | N(credential) |
| `webrtc.connect_timeout_ms` | int | 15000 | O | WEBRTC_CONNECT_TIMEOUT_MS | | A |

---

## 3. Master 설정 키 (`config.json`)

- 정의 `M/app/config.go:32-177`, 기본값 `:218-220`, 소유자 `:279-308`, 스키마 46키 `:329-388`, env `:629-689`, 검증 `:691-731`. Load 순서: 기본값 → 파일 → env → 플래그(`--listen/--data-dir/--database-url/--log-level/--runtime-mode`).
- **Master 설정은 HTTP API로 노출되지 않는다** (Master 라우트 195개 중 config 라우트 없음). 변경 경로는 `terra master config set/save`(파일 직접 편집 `CLI/app/app.go:5697-5714`) 또는 env/재설치뿐.

| key | type | default | owner | env (`TERRA_MASTER_…`) | 비고 | GUI |
| --- | --- | --- | --- | --- | --- | --- |
| `http_addr` (`:40`) | host:port | `127.0.0.1:8080` (endpoints 표) | O | HTTP_ADDR, LISTEN | 설치 `--http-addr` | A |
| `data_dir` (`:41`) | path | `./data` (설치 `~/.terra-master/terra`) | I | DATA_DIR | | R |
| `database_url` (`:42`) | `sqlite`|경로|postgres URL | `sqlite` → `<data>/terra-master.db` `:835-840` | O | DATABASE_URL | 비밀 포함 가능(PG URL) — **owner가 secret 아님** | A(마스킹 권장) |
| `jwt_secret` (`:43`) | string | 개발용 하드코딩 기본값(값 생략); prod는 ≥32자·기본값 금지 `:719` | **S** | JWT_SECRET | | N |
| `log_level` (`:44`) | `debug|info|warn|error` | info | O | LOG_LEVEL | | E |
| `runtime_mode` (`:45`) | `dev|test|prod` | **dev** (설치 prod) | O | RUNTIME_MODE | | A |
| `bootstrap_email` (`:46`) | string | 예시 주소 | O | BOOTSTRAP_EMAIL | 첫 관리자 | R |
| `bootstrap_password` (`:47`) | string(≥8) | 개발용 기본값(값 생략) | **S** | BOOTSTRAP_PASSWORD | | N |
| `bootstrap_user_type` (`:48`) | `cluster_user|master_admin` | cluster_user (설치 master_admin) | O | BOOTSTRAP_USER_TYPE | | A |
| `bootstrap_reconcile` (`:60`) | bool | false | O | BOOTSTRAP_RECONCILE | 부팅마다 선언값으로 암호 덮어씀 | A |
| `service_credential` (`:64`) | string | "" | **S** | — | Tree Gateway Core-peer 비밀 | N |
| `tree_node_id` (`:68`) | string | "" | D | TREE_NODE_ID | | R |
| `tree_node_id_file` (`:75`) | path | "" (중간 트리: daemon `registration.json`) | I | TREE_NODE_ID_FILE | | R |
| `tree_display_name` (`:83`) | string | ""(→hostname→"tree") | O(**스키마 외**) | TREE_DISPLAY_NAME | | E (스키마 등록 필요) |
| `parent_device_token_file` (`:89`) | path | "" | I | PARENT_DEVICE_TOKEN_FILE | 상위 Master 호출 자격 | R |
| `tree_login_url` (`:102`) | URL | "" | O(**스키마 외**) | TREE_LOGIN_URL | 상위 트리에 공개되는 로그인 origin | A |
| `tree_login_tunnel` (`:114`) | bool | false | O(**스키마 외**) | TREE_LOGIN_TUNNEL | | A |
| `tree_sibling_introductions` (`:129`) | bool | false | O(**스키마 외**) | TREE_SIBLING_INTRODUCTIONS | | A |
| `mesh_cidr` (`:132`) | CIDR | "" | D | MESH_CIDR | 부모가 위임한 블록 | R |
| `peer_grant_ttl_sec` (`:136`) | int | 0(=600s; 범위 2m~1h) `M/control_plane/peer_grant.go:31,40` | O | — | | A |
| `peer_grant_sweep_sec` (`:140`) | int | 0 | O | — | | A |
| `crossboundary_rules[]` (`:145`) | `control.CrossBoundaryRule` | [] (deny) | – (**스키마 외, 파일만**) | — | 열린 끝 규칙이면 부팅 실패 | R |
| `turn.enabled/urls/shared_secret/username_prefix/credential_ttl_sec` (`:156-162`) | – | false/[]/""/`terra`/300 | O / **S**(shared_secret) | TURN_ENABLED, TURN_URLS, TURN_SHARED_SECRET, TURN_USERNAME_PREFIX, TURN_CREDENTIAL_TTL_SEC | | E(shared_secret 제외) |
| `monitor.alerts.enabled` (`:172`) | bool | true | O | — | | E |
| `monitor.alerts.heartbeat_lag_sec` | int | 180 | O | — | 0=기본 | E |
| `monitor.alerts.cpu_percent`/`memory_percent`/`disk_percent` | int | 90/90/90 | O | — | | E |
| `modules.*` (공통 `MH/logger.go:53-138`) | – | Master 기본: enabled=false, stop 10s, backoff **500ms**, max_restarts 3 (`:219`); 설치는 enabled=modules 컴포넌트, dirs=`<install>/modules`, auto_start/require_hash true (`INS/setup_engine.go:2688-2693`) | I/O 혼합(daemon과 동일) | — | | 2.3절과 동일 |
| `gateway.disabled` (`M/gatewayservice/service.go:85`) | bool | false | O | GATEWAY_DISABLED | | A |
| `gateway.addr` (`:87`) | host:port | `127.0.0.1:8788` | O | GATEWAY_ADDR | | A |
| `gateway.ipc` (`:91`) | string | 파생 | D | GATEWAY_IPC | | R |
| `gateway.binary_path` (`:94`) | path | ""(master 옆) | I | GATEWAY_BINARY | | R |
| `gateway.dev_open` (`:97`) | bool | false | O | GATEWAY_DEV_OPEN | | N |
| `gateway.scene_roots` (`:101`) | []path | ""(→modules.directories) | I | GATEWAY_SCENE_ROOTS | | R |

Master 내부 상수(설정 불가, GUI에서 정보로 표시할 만한 것): access token 1h `M/auth/service.go:21`, refresh 7d `:26`, 노드 등록코드 15m `M/auth/node_enroll_code.go:39`, fleet 코드 24h `M/auth/enroll_code.go:118`, route ticket 2m, SVI lease 2m(최대 24h), 확인(confirmation) 15m, 모듈 desired lease 24h, 위임 grant 최대 90d.

---

## 4. Product Host 설정 (`product-host/config.json`)

`HOST/config.go:78-131`, 로드 시 알 수 없는 필드 거부·상대경로는 config 디렉터리 기준 `:133-171`, 검증 `:173-226`.

| key | type | default (leaf / tree) | 검증 | 비고 | GUI |
| --- | --- | --- | --- | --- | --- |
| `schema_version` | int | 1 | ==1 | | N |
| `product` | `terra-leaf|terra-tree` | 역할 | 실행 역할과 일치 | | R |
| `listen` | host:port | `127.0.0.1:17421` / `127.0.0.1:17422` | **loopback IP만** | GUI 원점 | R |
| `ui_root` | path | `runtime-ui` | 필수 | | R |
| `backend_url` | URL | `http://127.0.0.1:17321` / `http://127.0.0.1:8080` | loopback·자격/쿼리 금지 | | R |
| `master_base_url` | URL | ""/ tree=`backend_url` | 경로 금지 | 설치 시 `--master-url` 기록 | R |
| `gateway_base_url` | URL | `http://127.0.0.1:8787` / `:8788` | bare origin | | R |
| `backend_token_file` | path | leaf: `<daemon data>/local_api_token` | – | Local API 토큰 파일 | N |
| `backend_health_path` | path | `/live` / `/api/v1/health` | `/` 시작 | | R |
| `desktop_launch_token_file` | path | `<config dir>/desktop-launch-token` (설치 생성, 32B hex) | – | `POST /api/product/session` 의 `X-Terra-Desktop-Token` 헤더 검사 `HOST/server.go:34,642-668` | N |
| `session_cookie_name` | string | `terra_leaf_session` / `terra_tree_session` | 구분자 금지 | | N |
| `session_ttl_seconds` | int | 28800 (8h) | 60~604800 | | A |
| `request_timeout_sec` | int | 30 | 1~300 | | A |
| `log_sources` | map name→path | leaf: daemon/job/audit 로그, tree: master.log (`INS/setup_engine.go:3118-3129`) | 이름에 `/\?&#` 금지 | `/api/product/logs` 소스 | R |
| `scene_workspace_root` | path | ""(API 비활성) | – | 쓰기 표면 활성화 스위치; 플래그 `--scene-workspace-root` 우선 | A |

---

## 5. CLI 프로필 (`cli/config.json`)

`CLI/config/config.go:18-78`, 기본 문서 `:123-138`(프로필 `dev`), 검증 `:546-578`. 해석 순서: 플래그 > env > 프로필 > 기본 (`:177-240`, gateway 결정 규칙 `:459-500`).

| key | type | default | env override | 검증 | GUI |
| --- | --- | --- | --- | --- | --- |
| `active_profile` | string | `dev` | `TERRA_CLI_PROFILE` / `--profile` | 존재해야 | E |
| `profiles.<n>.gateway_url` | URL | "" | `TERRA_CLI_GATEWAY_URL` / `--gateway` | 셋 중 하나 필수 | E |
| `.leaf_gateway_url` | URL | `http://127.0.0.1:8787` | – | | E(sync로 채움) |
| `.tree_gateway_url` | URL | "" | – | | E |
| `.gateway_role` | `leaf|tree` | leaf | `TERRA_CLI_GATEWAY_ROLE` / `--tree-gateway` `--leaf-gateway` | | E |
| `.local_daemon_url` | URL | `http://127.0.0.1:17321` | `TERRA_CLI_LOCAL_DAEMON_URL` | 필수 | A |
| `.output` | `table|json|quiet` | table | `TERRA_CLI_OUTPUT` / `--json` `--quiet` | | E |
| `.output_view` | `compact|summary|detail|wide|raw` | "" | `TERRA_CLI_OUTPUT_VIEW` / `--view` | | E |
| `.output_max_rows` | int≥0 | 0 | `TERRA_CLI_OUTPUT_MAX_ROWS` | | E |
| `.output_pager` | `auto|always|never` | "" | `TERRA_CLI_OUTPUT_PAGER` / `--pager` | | E |
| `.language` | `en|ko` | en | `TERRA_CLI_LANG`, `TERRA_CLI_LANGUAGE` / `--lang --ko --en` | | E |
| `.timeout_sec` | float>0 | 30 | `TERRA_CLI_TIMEOUT_SEC` | | E |
| `.module_root` | path | ""(daemon config에서 유도) | `TERRA_MODULE_ROOT` / `--root` (`CLI/app/module_root.go:66-97`) | | R |
| `.module_state_root` | path | "" | `TERRA_MODULE_STATE_ROOT` / `--state-root` | | R |
| `.tree_aliases` | map | – | – | CLI 기록용, `config get` 미노출 | N |

`terra config set` 대상 키 처리: `CLI/app/app.go:4140-4200` (`gateway_role`, `module_root` 등). 관련 명령: `config {get,set,path,sync,init,doctor}`, `profile {create,delete,list,use}`, `daemon config {get,set,show,schema,path,validate,save,apply}`, `master config {get,set,show,schema,path,validate,save}`.

---

## 6. 환경 변수

### 6.1 Daemon (`TERRA_DAEMON_*`, `D/core/config.go:1470-1713`) — 76개

MASTER_URL, NODE_ID, DEVICE_NAME, NODE_ROLES, NODE_CAPABILITIES, DATA_DIR, LOG_LEVEL, RUNTIME_MODE, DEVICE_TOKEN_PATH, REQUIRE_TLS, ENABLE_DOCKER, ENABLE_SVI, ENABLE_SVI_TEST_STREAM, MODULES_ENABLED, MODULE_DIRECTORIES, MODULE_AUTO_START, MODULE_REQUIRE_EXECUTABLE_HASH, MODULE_STOP_TIMEOUT_SEC, MODULE_RESTART_BACKOFF_MS, MODULE_MAX_RESTARTS, MODULE_STRICT_SIGNING, GATEWAY_SERVICE_{ENABLED,BINARY,ADDR,IPC,MASTER_CREDENTIAL}, MODULE_GATEWAY_IPC, LOCAL_API_{ENABLED,BIND_HOST,PORT,REQUIRE_AUTH,AUTH_TOKEN_PATH,ENABLE_DEBUG}, ENROLLMENT_{ENABLED,STATE_PATH}, DIRECT_TCP_{ENABLED,LISTEN_HOST,ADVERTISE_HOST,PORT,CONNECT_TIMEOUT_MS}, MESH_VPN_{ENABLED,ADAPTER,MODE,LISTEN_HOST,ADVERTISE_HOST,PORT,NETWORK_ID,PEER_ID,CONNECT_TIMEOUT_MS}, WIREGUARD_{ENABLED,MODE,INTERFACE_NAME,PRIVATE_KEY_PATH,ADDRESS_CIDR,LISTEN_PORT,ADVERTISE_ENDPOINT,STUN_SERVERS,STUN_TIMEOUT_MS,NAT_MAPPING_MODE,NAT_MAPPING_PROTOCOLS,NAT_GATEWAY,NAT_MAPPING_LIFETIME_SEC,NAT_PROBE_TIMEOUT_MS,ENDPOINT_REFRESH_INTERVAL_SEC,PRIVILEGED_HELPER_PATH,PRIVILEGED_HELPER_TIMEOUT_SEC,MTU,PERSISTENT_KEEPALIVE_SEC,AUTO_INSTALL,AUTO_UP,DESIRED_SYNC_INTERVAL_SEC,INSTALL_POLICY}, WEBRTC_{ENABLED,STUN_SERVERS,ICE_SERVERS,CONNECT_TIMEOUT_MS}. (줄 번호는 `:1480`~`:1709`, 3줄 간격.) 주의: env는 **파일 값을 덮어쓰지만 파일에 저장되지 않는다** → GUI가 보는 값(GET /config)과 파일이 다를 수 있다.

기타 daemon env:

| env | 위치 | 용도 | GUI |
| --- | --- | --- | --- |
| `TERRA_JOIN_CODE` | `D/registration/bootstrap.go:23,49` | Fleet join code(자격) — 파일보다 우선 | N |
| `TERRA_INSTANCE_KEY` | `bootstrap.go:27,71` | Fleet 좌석 식별 | R |
| `TERRA_IMAGE_DIGEST` | `bootstrap.go:29,90` | 이미지 다이제스트 보고 | R |
| `TERRA_WIREGUARD_NAT_GATEWAY` | `D/local_api/wireguard_nat.go:245` | NAT 게이트웨이 IP 강제 | A |
| `TERRA_NETWORK_HELPER_POLICY_PATH` | `D/network_helper/helper.go:154` | 헬퍼 정책 파일 경로 | N |
| `HOME`/`USERPROFILE`/`ProgramData` | `D/localfs/roots_*.go`, `D/data_plane/network/wireguard/manager.go:1161` | OS 기본 경로 | – |

### 6.2 Master (`M/app/config.go:640-688`)
`TERRA_MASTER_` + HTTP_ADDR, LISTEN, DATA_DIR, DATABASE_URL, JWT_SECRET(S), TREE_NODE_ID, TREE_NODE_ID_FILE, TREE_DISPLAY_NAME, PARENT_DEVICE_TOKEN_FILE, TREE_LOGIN_URL, TREE_LOGIN_TUNNEL, TREE_SIBLING_INTRODUCTIONS, MESH_CIDR, LOG_LEVEL, RUNTIME_MODE, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD(S), BOOTSTRAP_USER_TYPE, BOOTSTRAP_RECONCILE, TURN_URLS, TURN_SHARED_SECRET(S), TURN_USERNAME_PREFIX, TURN_ENABLED, TURN_CREDENTIAL_TTL_SEC, GATEWAY_DISABLED, GATEWAY_DEV_OPEN, GATEWAY_ADDR, GATEWAY_IPC, GATEWAY_BINARY, GATEWAY_SCENE_ROOTS (30개). bool은 `true`/`1`만 참.

### 6.3 CLI

| env | 위치 | 용도 |
| --- | --- | --- |
| `TERRA_CLI_CONFIG` | `CLI/config/config.go:100` | CLI config 경로 |
| `TERRA_CLI_PROFILE`, `_GATEWAY_ROLE`, `_GATEWAY_URL`, `_LOCAL_DAEMON_URL`, `_OUTPUT`, `_LANG`, `_LANGUAGE`, `_OUTPUT_VIEW`, `_OUTPUT_PAGER`, `_OUTPUT_MAX_ROWS`, `_TIMEOUT_SEC` | `:185-234` | 5절 표 참고 |
| `TERRA_DAEMON_CONFIG` | `CLI/app/app.go:5692` | daemon config 경로(CLI만 읽음; daemon 바이너리는 안 읽음) |
| `TERRA_MASTER_CONFIG` | `CLI/app/app.go:5700` | master config 경로(CLI만) |
| `TERRA_DAEMON_LOCAL_API_AUTH_TOKEN_PATH` | `CLI/app/app.go:5623,5672` | Local API 토큰 경로 (daemon env와 이름 공유) |
| `TERRA_MODULE_ROOT`, `TERRA_MODULE_STATE_ROOT` | `CLI/app/module_root.go:66-67` | 모듈 루트 |
| `TERRA_MODULE_CACHE` | `CLI/app/module_acquire.go:129` (build-release.ps1:912도) | .tmod 캐시 |
| `TERRA_MODULES_TOKEN` → `GITHUB_TOKEN` | `module_acquire.go:511-514` | private modules 릴리스 읽기 자격 (S) |
| `GITHUB_API_URL` | `module_acquire.go:501` | 기본 `https://api.github.com` |
| `TERRA_AGENT_TOKEN` | `CLI/app/agent.go:25`, `mcp.go:140` | 위임(agent) grant 자격 (S) |
| `LOCALAPPDATA` | `config.go:104`, `config_sync.go:417` | Win 경로 |

### 6.4 모듈 프로세스에 주입되는 env (Module Host → 모듈)
`TERRA_MODULE_ID/VERSION/DIR/TARGET` `MH/manager.go:808-811`, `TERRA_MODULE_DATA_DIR`(manifest `permissions.storage:["module-data"]`일 때만 `:813`), `TERRA_MODULE_SHARED_ROOTS`(shared-roots 권한+신뢰등급 `:824`), `TERRA_MODULE_CONFIG_FILE`(`MRT/config_store.go:58`), `TERRA_ACTIVATION_EPOCH`, `TERRA_INSTANCE_ID`, `TERRA_BOOTSTRAP_NONCE`, `TERRA_WORKLOAD_CREDENTIAL`(S), `TERRA_LOOPBACK_ENDPOINT`, `TERRA_MODULE_HOST_ENDPOINT`. 상속 env 허용목록: PATH, PATHEXT, SYSTEMROOT, WINDIR, COMSPEC, TEMP, TMP, TMPDIR, HOME, USERPROFILE, PROGRAMDATA, APPDATA, LOCALAPPDATA, LANG, LANGUAGE, TZ, NUMBER_OF_PROCESSORS, PROCESSOR_ARCHITECTURE, `LC_*` (`MH/process.go:98-110`). `TERRA_MODULE_STATE_DIR`(virtual-device 수동 실행용 `products/common/apps/terra-virtual-device/cmd/terra-virtual-device/main.go:117`).

### 6.5 인스톨러 / 서명 / 테스트

| env | 위치 | 용도 |
| --- | --- | --- |
| `TERRA_SETUP_STATE_DIR` | `INS/setup_remote.go:39` | state/cache/staging 루트 오버라이드 |
| `TERRA_SIGN_PASSPHRASE` | `products/common/apps/terra-installer/cmd/terra-release-sign/main.go:24` | 릴리스 키 암호 (S, CI) |
| `TERRA_TEST_ROOT_PUB` | `products/common/apps/terra-installer/internal/trust/testroots_enabled.go:14` | 테스트 빌드 태그 전용 루트 키 |
| `XDG_RUNTIME_DIR`, `DISPLAY`, `WAYLAND_DISPLAY`, `SHELL`, `PATH`, `ProgramData`, `ProgramFiles(x86)`, `SystemRoot`, `windir`, `SystemDrive`, `APPDATA`, `USERPROFILE`, `LOCALAPPDATA` | `products/common/apps/terra-installer/internal/elevate/*`, `INS/setup_platform_*.go`, `INS/elevated_policy.go:43-44` | OS 경로·권한상승 |
| `TERRA_TEST_WAIT_SCALE`, `TERRA_MARKET_BIN/SRC/REQUIRED` | `products/common/packages/terra-testwait/*.go` | 테스트 전용 |

### 6.6 프런트엔드 빌드 타임 (Vite) / Node 스크립트
`VITE_TERRA_API_BASE_URL`, `VITE_TERRA_DAEMON_API_BASE_URL`, `VITE_TERRA_GATEWAY_URL`, `VITE_TERRA_DEMO_MODE`, `VITE_TERRA_PRODUCT`, `VITE_TERRA_SHELL`, `VITE_TERRA_UI_PROJECT_URL`, `VITE_TERRA_UI_STUDIO_ORIGINS`, `VITE_TERRA_DEV_TOKEN`(템플릿, DEV만) — `products/common/ui/terra-runtime-core/src/runtime/runtime-config.ts:67-88`, `App.tsx:86,228`, `main.tsx:12`. Node: `TERRA_MODULES_ROOT` (`tools/stage-*.mjs`), `TERRA_GATEWAY`(vite 프록시), `TERRA_UI_STUDIO_WORKSPACE_ROOT`.

### 6.7 컨테이너/infra (엔트리포인트가 위 env로 번역)
`infra/docker/terra-tree/entrypoint.sh`, `infra/compose/entrypoint-*.sh`, `infra/terraform/modules/*`: TERRA_ADMIN_{EMAIL,PASSWORD(S),PASSWORD_FILE,USERNAME,USER_TYPE,RECONCILE}, TERRA_JWT_SECRET(S), TERRA_SERVICE_CREDENTIAL(S), TERRA_DB_{MODE,HOST,PORT,NAME,USER,PASSWORD(S),SSLMODE,URL,WAIT_SEC,READONLY_USER,READONLY_PASSWORD(S),READONLY_PASSWORD_FILE}, TERRA_DATABASE_URL, TERRA_MASTER_{URL,PORT,CONFIG_FILE,WAIT_SEC,…}, TERRA_LOG_LEVEL, TERRA_REQUIRE_TLS, TERRA_NODE_NAME, TERRA_ENROLL_{EMAIL,PASSWORD(S)}, TERRA_JOIN_CODE(S), TERRA_TREE_DISPLAY_NAME, TERRA_PUBLIC_URL, TERRA_MESH_CIDR, TERRA_GATEWAY_{ADDR,DISABLED}, TERRA_HOST_{ENABLED,LISTEN}, TERRA_MODULES_{DIR,ENABLED,AUTO_START}, TERRA_MODULE_SELECTION, TERRA_RENDER_ONLY, TERRA_TREE_RENDER_ONLY, TERRA_SHUTDOWN_TIMEOUT_SEC, TERRA_HEALTHCHECK_{PATH,TIMEOUT_SEC}, TERRA_ENROL_WAIT_SEC, 빌드 인자 TERRA_{VERSION,TARGET,PLATFORM,COMMIT,BASE_IMAGE,INSTALL_OS_PACKAGES,BUNDLE_SHA256,BUNDLE_DIR,RELEASE_REPO,RELEASE_TAG,POSTGRES_IMAGE,DB_IMAGE_TAG,BIND_IP}. 컨테이너 경로: `/opt/terra/{bin,modules,data-seed,install-manifest.json}`, `/etc/terra/{daemon,master}.json`, `/data/*`, `/var/lib/terra-master`. GUI v3 범위 밖(R 정도).

---

## 7. CLI 플래그

| 바이너리 | 플래그 (기본) | 위치 |
| --- | --- | --- |
| terra-daemon | `--config ~/.terra/config.json`, `--master-url`, `--log-level`, `--data-dir`, `--runtime-mode`, `--version`, `--print-config-schema`, `--core-apply <plan>`(내부), `--health`, `--validate-config`, `--allow-missing-config=true`, `--save-config`, `--save-config-output`, `--save-config-name`, `--shutdown-timeout 15`, `--enroll-token-file`, `--enroll-email`, `--enroll-password-file`, `--enroll-name`, `--enroll-only` | `products/leaf/daemon/cmd/terra-daemon/main.go:877-898` |
| terra-master | `--config`, `--listen`/`--http-addr`, `--data-dir`, `--database-url`/`--db-path`, `--log-level`, `--runtime-mode`, `--version`, `--print-config-schema`, `--validate-config`, `--save-config`, `--save-config-output`, `--save-config-name`, `--health`, `--shutdown-timeout 15` | `products/tree/master/cmd/terra-master/main.go:117-132` |
| terra-host | `--config`, `--role leaf|tree`, `--validate-config`, `--version`, `--scene-workspace-root` | `products/common/host/command/run.go:41-55` |
| terra-gateway | `--version`, `--addr`(역할 기본), `--lease 30s`, `--sweep 5s`, `--invoke-timeout 20s`, `--ipc`, `--provider id=url`(반복), `--provider-forward-auth`, `--provider-auth-file id=path`, `--rate-limit 0`, `--audit false`, `--alias`, `--session-auth`(deprecated), `--dev-open`, `--session`(dev seed), `--master-url`, `--auth-reason`, `--pre-enrollment-op`, `--pre-enrollment-limit`, `--daemon-url`, `--daemon-token-file`, `--gui-cache-dir`, `--gui-app-origin-template`, `--gui-frame-ancestors`, `--master-service-credential`(값), `--master-service-credential-file`, `--module-state-root`, `--scene-root`(반복), 위치인자=provider roots | `GW/cmd/terra-gateway/main.go:49-170`. daemon이 넘기는 인자 `D/gatewayservice/module.go:296-375`, master `M/gatewayservice/service.go:284-313` |
| terra-network-helper | (정책 파일 기반; `wireguard up/down --config --interface`) | `products/leaf/daemon/cmd/terra-network-helper/main.go`, `INS/setup_platform_linux.go:226` |
| terra-shell (Linux/mac) | `--role leaf`, `--origin`, `--health-timeout 15s`, `--skip-health`, `--data-dir`, `--launcher`(무시), `--choose` | `products/common/desktop/terra-shell/cmd/terra-shell/main.go:23-33` |
| Terra.DesktopShell (Win) | `--choose --config --dev-origin --install --launcher --origin --product --self-test --validate-config --version` | `products/common/desktop/Terra.DesktopShell/CommandLineOptions.cs` |
| terra-setup (installer) | `--config <request.json>`, `--profile`, `--product`, `--role`, `--add-role`, `--remove-role`, `--components`, `--source-dir`, `--catalog`, `--install-dir`, `--master-data-dir`, `--daemon-data-dir`, `--http-addr`, `--database-url`, `--admin-email`, `--admin-password-file`, `--master-url`, `--device-name`, `--enrollment-mode auto|account|token|none`, `--enroll-token-file`, `--enroll-email`, `--enroll-password-file`, `--gateway-service-credential-file`, `--wireguard disabled|external|managed`, `--with-ssh-server`, `--with-fleet-host`, `--no-ssh-server`, `--no-fleet-host`, `--no-start`, `--all-modules`, `--required-modules-only`, `--add-to-path`, `--no-add-to-path`, `--deregister`, `--purge`, `--remove-dependencies`, `--force`, `--allow-downgrade`, `--dry-run`, `--yes`, `--json`, `--non-interactive`; 패키지 모드 `--role --package(s) --yes --dry-run --json --timeout-sec` | `INS/setup_cli.go:441-607`, `INS/app.go:132-158` |
| terra-release-sign | keygen/cert/sign/verify/catalog/renew 서브커맨드 플래그 | `products/common/apps/terra-installer/cmd/terra-release-sign/main.go:92-369` |
| terra-virtual-device | `--master --token --resource --endpoint output --device --ttl 0 --config` | `products/common/apps/terra-virtual-device/cmd/terra-virtual-device/main.go:55-61` |
| terra (CLI) 전역 | `--profile --config --gateway --tree-gateway --leaf-gateway --local --json --quiet --verbose --trace-id --yes --dry-run --ko --en --lang --format --view --columns --fields --filter --sort --limit --page --tree --depth --wrap --no-truncate --pager` | `CLI/help/registry.go:67-95`, 파서 `CLI/app/app.go:173-300` |
| terra mcp serve | `--autonomy plan|auto|unattended`(기본 plan), `--record <path>`(기본 `<cli config dir>/agent-records.jsonl`), `--no-record` | `CLI/app/mcp.go:40-100,150-180` |
| tools | release-share `--root --port --bind 0.0.0.0`; endpoints-gen `--check --root` | `tools/release-share/main.go:47-49`, `tools/endpoints-gen/main.go:44-45` |

---

## 8. 빌드 타임 변수

| 변수 | 주입 | 위치 |
| --- | --- | --- |
| `main.version`, `main.commit`, `main.buildDate` | `-ldflags -X` (UsesBuildMetadata 컴포넌트) | `build-release.ps1:2229` |
| `…/terra-installer/internal/installer.defaultCatalogRef` (https 필수) | `-X` (bootstrap 인스톨러) | `tools/Build-BootstrapInstaller.ps1:54`, 사용처 `INS/setup_ui_cmd.go:21-31` |
| build-release.ps1 파라미터: `-Target windows-amd64|linux-amd64|linux-arm64`, `-Bundle terra|leaf|tree|android|all`, `-OutputDirectory dist`, `-Version dev`, `-Commit unknown`, `-RunTests`, `-NoArchive`, `-GoCommand/-NpmCommand/-DotNetCommand`, `-AndroidVersionCode`, `-OfflineModules`, `-ModuleCacheDirectory` | | `build-release.ps1:2-38` |
| PowerShell `$env:` 사용: GOOS, GOARCH, CGO_ENABLED, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT, LOCALAPPDATA, ProgramFiles, PATH, TERRA_MODULE_CACHE | | `build-release.ps1` (862, 912, 1304, 2197…) |
| 번들 모듈 핀: `StellaxiaLab/modules@v2026.10.19` (10개), 인스톨러 직접 수신 `lab.stellaxia.node-gui`(required) | | `bundled-modules.json`, `installer-modules.json` |
| 루프백 표 생성 | `go generate` (`tools/endpoints-gen`) → Go/TS/C# 미러 + `products/common/contracts/endpoints.json` | `HOST/endpoints.go:30` |

---

## 9. 디스크 레이아웃 · 포트 · 소켓 · 락 · 로그

### 9.1 포트 (전부 기본값)

| 포트 | 누가 | bind | 설정 키 |
| --- | --- | --- | --- |
| 17421 | Leaf Product Host (GUI) | 127.0.0.1 | host `listen` |
| 17422 | Tree Product Host | 127.0.0.1 | host `listen` |
| 17321 | Daemon Local API | 127.0.0.1 | `local_api.port` |
| 8080 | Master HTTP API (+`/ws/daemon`) | 127.0.0.1 (설치 `--http-addr`) | `http_addr` |
| 8787 | Leaf Gateway | 127.0.0.1 | `gateway_service.addr` |
| 8788 | Tree Gateway | 127.0.0.1 | `gateway.addr` |
| 17322 | Direct TCP (TLS1.3) | 0.0.0.0 | `direct_tcp.port` (기본 off) |
| 17323 | Mesh VPN 리스너 | 0.0.0.0 | `mesh_vpn.port` |
| 17325 | gRPC transport | 0.0.0.0 | `grpc_transport.port` (off) |
| 51820/udp | WireGuard | – | `wireguard.listen_port` |
| 임의 | 인스톨러 웹 UI (`/api/ping`, `ui.lock` 에 주소 기록) | loopback | – |
| 5173/5174 | dev UI(vite) | – | `.claude/launch.json` |

### 9.2 Linux (설치본, 통합 `terra` 제품, systemd **user** 유닛)

| 경로 | 내용 | 근거 |
| --- | --- | --- |
| `~/.local/share/terra/terra/` | InstallDir: `bin/`, `modules/`(번들 모듈), `install-manifest.json`, runtime-ui | `INS/setup_platform_linux.go:25-38`, `INS/setup_engine.go:3404-3434` |
| `~/.local/bin/terra` | CLI symlink(PATH) | `INS/setup_platform_linux.go:311-334` |
| `~/.terra/terra/` (0700, `.terra-install-owner` 마커) | Daemon data: `config.json`, `config-baseline.json`, `device_token`, `local_api_token`, `registration.json`, `logs/{daemon,job,audit}.log`, `cache/`, `tmp/`, `memos/`, `modules/`(managed), `module-state/`, `module-config/`, `updates/`, `wireguard/{private.key,peer-index.json,terra0.conf}`, `svi-state.json`, `svi-declarations.json`, `gateway.sock`, `gateway_service_credential`, `gateway-providers/`, `product-host/{config.json,desktop-launch-token}` | 2절, `INS/setup_engine.go:30,2783-2788,3092`, `D/gatewayservice/module.go:135,559` |
| `~/.terra-master/terra/` | Master data: `config.json`, `config-baseline.json`, `terra-master.db`, `logs/master.log`, `service-identity.json`, `bootstrap-credentials`, `bootstrap-password`, `gateway-service-credential`, `gateway-providers/terra.master/`, `module-registry/blobs`, `modules/blobs`, `product-host/` | `INS/setup_engine.go:2617-2722`, `M/gatewayservice/service.go:230-261`, `M/moduleregistry/blobstore.go:39-44` |
| `~/.terra/cli/{config.json,tokens.json,agent-records.jsonl}` | CLI | 5절 |
| `~/.config/systemd/user/terra-{daemon,master,leaf-host,tree-host}.service` | `ExecStart=… --config …`, `Restart=on-failure`, `RestartSec=5`, `WantedBy=default.target` | `INS/setup_platform_linux.go:46-48,280-282`, `INS/setup_systemd_unit.go:11-27`, `INS/setup_engine.go:4926-4937` |
| `/usr/libexec/terra/terra-network-helper`, `/etc/terra/network-helper.json`, `/etc/sudoers.d/terra-network-helper-<user>` | managed WireGuard 헬퍼(sudo로 설치) | `INS/setup_platform_linux.go:143-204` |
| `~/.config/Terra/installer/{trust-state.json,ui.lock}`, `~/.cache/Terra/installer/{downloads,staging}` | 인스톨러 | `INS/setup_remote.go:37-53` |
| `$XDG_RUNTIME_DIR/terra-setup-*/` | 인스톨러 권한상승 유닉스 소켓 | `products/common/apps/terra-installer/internal/elevate/transport_linux.go:40-60` |
| `~/.cache/terra-shell/{<product>.lock,<product>-profile/}` | 데스크톱 셸 단일 인스턴스 락·브라우저 프로필 | `products/common/desktop/terra-shell/cmd/terra-shell/main.go:55-63`, `shell/single.go:43-51` |
| 레거시 탐색 후보 | `~/.terra/{terra,leaf}/config.json`, `~/.terra/config.json`, `~/.terra-master/{terra,tree}/config.json`, `~/.terra/local_api_token` | `CLI/app/config_sync.go:307-377` |

### 9.3 Windows (scheduled task, HKCU)

| 경로/이름 | 내용 | 근거 |
| --- | --- | --- |
| `%LOCALAPPDATA%\Terra\Terra\` (+`bin`, `install-manifest.json`) | InstallDir (제품명 대문자) | `INS/setup_platform_windows.go:52-63`, `INS/setup_engine.go:3424-3426` |
| `%USERPROFILE%\.terra\terra\`, `%USERPROFILE%\.terra-master\terra\` | Daemon/Master data (Linux와 같은 내부 구조) | 동상 |
| `%APPDATA%\Terra\local_api_token` | 바이너리 기본(설치본은 data dir) | `D/core/config.go:689-696` |
| `%LOCALAPPDATA%\Terra\cli\config.json` | CLI | `CLI/config/config.go:103-109` |
| `%LOCALAPPDATA%\Terra\{Leaf,Tree}\{webview,logs}` | DesktopShell WebView2 프로필/로그 | `products/common/desktop/Terra.DesktopShell/ProductProfile.cs:135-163` |
| `%ProgramFiles%\Terra\terra-network-helper.exe`, `%ProgramData%\Terra\{network-helper.json,wireguard\terra0.conf}` | managed WG | `INS/setup_platform_windows.go:362-422` |
| Scheduled tasks "Terra Daemon", "Terra Master", host 태스크 | ServiceKind `scheduled-task`; 설정 미적용 시 `Degraded=scheduled-task-settings-not-applied` | `INS/setup_platform_windows.go:68`, `INS/setup_types.go:195-220`, `INS/setup_engine.go:893,966` |
| `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Terra[ Leaf|Tree|Studio]`, `HKCU\Software\Classes\.tmod`, `HKCU\Environment\Path` | 제거 항목, .tmod 연결, PATH | `INS/setup_platform_windows.go:960-995`, `INS/setup_tmod_association_windows.go:26-28` |
| 시작 메뉴 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Terra\Terra.lnk` | | `INS/setup_platform_windows.go:776-784,956` |
| 파이프: `\\.\pipe\terra-gateway-<sha256(dataDir)[:9] b64url>`, `\\.\pipe\terra-setup-<32hex>`, mutex `Local\<key>.desktop.mutex` | Gateway IPC, 인스톨러 권한상승, 셸 단일 인스턴스 | `products/common/packages/terra-gateway-launch/launch.go:305-315`, `products/common/apps/terra-installer/internal/elevate/transport_windows.go:77,372`, `Terra.DesktopShell/SingleInstance.cs:26` |

### 9.4 macOS
인스톨러 미지원(`INS/setup_platform_other.go:29-33` "unsupported on this OS"). 바이너리 기본값만 적용: daemon `~/.terra/…`, CLI `~/.terra/cli/config.json`, CLI의 설치 루트 탐색 `~/.local/share/terra`(Linux와 동일 가정), network helper 정책 `/Library/Application Support/Terra/network-helper.json`, local_fs 기본 루트 `/`,`$HOME`,`/Volumes/*`, terra-shell 캐시 `~/Library/Caches/terra-shell`.

### 9.5 로그·감사·크기 제한

| 로그 | 위치 | 회전/제한 |
| --- | --- | --- |
| daemon.log / job.log / audit.log | `<daemon data>/logs/` | `logging.max_size_mb`(10)×`max_backups`(5) — `D/core/logger.go:62-83` |
| master.log | `<master data>/logs/master.log` (0600, JSON) | **회전 없음**(append) `M/logging/manager.go:14,40-51` |
| Gateway 감사(`--audit`) | stdout 라인 (invoked/denied/throttled/unavailable; DELEGATED는 항상) | `GW/audit.go:11-52` |
| 모듈 stdout/stderr | Module Host 링버퍼 → `GET /modules/{id}/logs` | `MH/module_logs.go` |
| core apply | `<data>/updates/<applier>/apply.log` | `D/coredistrib/spawn.go:204` |
| MCP 호출 기록 | `<cli dir>/agent-records.jsonl` (0600, 회전 없음) | `CLI/app/mcp.go:150-180` |
| 기타 한도 | network helper 정책 64KiB, GUI diagnostics 본문 1MiB(`GW/gui_diagnostics.go:81`), Gateway invoke 20s, credential handle 1h(최대 24h) `GW/credential_vault.go:49-55`, core 스테이징 4096MB | |

---

## 10. API / IPC 로 노출되는 설정 (GUI v3가 실제로 호출할 표면)

### 10.1 Daemon Local API (`127.0.0.1:17321`, bearer = local_api_token) — 라우트 표 `D/local_api/router.go:27-104`, Gateway 경유 시 operation id `terra.daemon.*` + 권한(`products/leaf/daemon/contracts/api/terra-api.json`)

| operation | 메서드·경로 | 요청 | 권한 / scope | 비고 |
| --- | --- | --- | --- | --- |
| `terra.daemon.config.get` | GET /config | – | node.read / local,**cluster** | `{config(redacted), config_path, deviations?}` `D/local_api/config_routes.go:34-58` |
| `terra.daemon.config.schema.get` | GET /config/schema | – | node.read / local,cluster | `{fields:{key:{type,restart_required,owner,description}}}` — **GUI 폼 생성 원천** |
| `terra.daemon.config.patch` | PATCH /config | `{set:{key:value}, save?, path?, name?, force?}` (unknown field 거부) | **node.config / local만** | 전부-아니면-전무, 키별 오류 `NOT_EDITABLE|TYPE|VALIDATION|OWNER_LOCKED` `D/core/config_patch.go:11-60`; 응답 `{changed, restart_required, config, saved?}`; `config.changed` 시그널 발행 |
| `terra.daemon.config.validate.post` | POST /config/validate | – | node.read / local | |
| `terra.daemon.config.save.post` / `apply.post` | POST /config/save, /config/apply | `{path?, name?}` | node.config / local | apply = save + "재시작 필요" 응답 |
| `terra.daemon.restart.post` | POST /restart | – | node.config / local | systemd `Restart=on-failure`에 의존 |
| `terra.daemon.debug.config.get` | GET /debug/config | – | node.read / local | `local_api.enable_debug` 일 때만 |
| enrollment | GET /enrollment/status, POST /enrollment/register, POST /enrollment/code | – | node.read / **node.enroll** | pre-enrollment 창: Gateway `--pre-enrollment-op terra.daemon.enrollment.code.post` |
| local-fs | GET /local-fs/roots, /local-fs/entries, POST /desktop/open | – | file.read / node.control, local | `local_fs.*` 반영 |
| modules config | GET/PATCH /modules/{id}/config, GET …/config/schema | PATCH `{values, unset, base_revision}` | node.read / **module.manage**, local+cluster | `{module_id, revision, values, secrets:{k:{set}}, invalid_keys, restart_pending}` `MH/module_config.go:42-77` |
| modules lifecycle | start/stop/restart/uninstall/scan, offers consent/withdraw | – | node.control / module.manage | |
| svi declarations | GET/POST /svi/declarations, POST …/apply, …/{family}/{name}/undeclare, …/retired/…/forget | – | node.config | 엔벨로프(`svi.runtime`) 안에서만 |
| wireguard | GET status/install-plan/peers, POST managed-key/managed-config/apply/down/report/sync | – | node.read / node.control | |
| service tunnels | GET/POST /service-tunnels, POST …/close | – | node.read / node.control | |
| 이벤트 | GET /events (SSE) | – | node.read | `config.changed` 등 |

### 10.2 Master API (설정성 엔드포인트만; 전체 195개)
`M/api/http_server.go` — 관리자 사용자 `GET/POST/PATCH/DELETE /api/v1/admin/users…`, 암호 재설정 `POST /api/v1/admin/users/{id}/password` (`:197-201`, master_admin), 클러스터 `GET/PATCH /api/v1/admin/clusters…` (`:202-203`), 노드 등록코드 `GET/POST/DELETE /api/v1/nodes/enroll-codes` (`:247-249`, node.control), 노드 메타 `PATCH /api/v1/nodes/{id}`(display name 등 `:461`), 게이트웨이 자격 회수 `POST /api/v1/nodes/{id}/gateway-credential/revoke`(`:241`), 코어 릴리스 `GET/POST /api/v1/core/releases`, `…/{id}/{apply,rollout,revoke}`(`:348-352`, core.publish), 모니터 알림 `GET/POST /api/v1/monitor/alerts`, ack(`:277-279`), 모듈 거버넌스 approval-ceiling(`:365-366`), prefixes(`:324-325`), upstreams, trust-anchor(`:385`), 노드별 모듈 assignments/pins(`:375-380`), 네트워크 networks/assignments(`:479-481`), transport desired `PUT /api/v1/network/nodes/{id}/transports/{adapter}/desired`(`:487`), route policies(`:495-498`), service-tunnel declarations(`:474-475`), crossboundary peer-grants/login-routes, 문서 relay `POST /api/v1/documents/relay`(사용자 문서 저장소 원본). 권한 상수 `M/auth/service.go:617-703` (module.publish/approve/manage, core.publish, node.config, node.enroll, agent.*, process.execute.delegated).

### 10.3 Gateway (`:8787/:8788`) — `GW/contracts/api/terra-api.json` 54 operations
설정 관련: `GET /api/v1/health`(auth mode·reason), `POST /api/v1/auth/login`, `POST/DELETE /api/v1/auth/credentials`, **사용자 문서 저장소** `GET/PUT/DELETE /api/v1/me/documents/{namespace}/{key...}` (Master에 저장, 사람 단위, `app:<id>` 네임스페이스 격리, revision 기반 낙관적 잠금 `GW/documents.go:1-60`) — **GUI v3 사용자 환경설정 저장 후보**, 에이전트 grant `POST/DELETE /api/v1/agent/grants`, 모듈 `enable/disable/start/stop/rollback`, 원격 노드 operation 호출 `POST /api/v1/nodes/{node}/operations/{id}/invoke` (원격 `config.get`은 cluster scope로 가능, **원격 config 쓰기는 local scope라 불가**).

### 10.4 Product Host (`:17421/:17422`) `HOST/server.go:192-247`
`GET /.well-known/terra-product.json`(엔드포인트 디스커버리 `:499-560`), `GET /api/product/config`(공개 설정 투영 `:563-640`), `GET /api/product/status`, `POST/DELETE /api/product/session`(쿠키; `X-Terra-Desktop-Token`), `DELETE /api/product/master-session`, `GET /api/product/logs[/stream]`(log_sources), `/api/product/workspace…`(scene_workspace_root 있을 때), 프록시 `/api/backend/`(→daemon/master, 토큰 부착), `/api/master/`, `/api/gateway/`.

### 10.5 인스톨러 UI API (loopback, 세션) `INS/ui_api.go:282-292`
`GET /api/state`, `GET /api/dependencies`, `POST /api/catalog`, `POST /api/plan`, `POST /api/run`, `GET /api/run`, `POST /api/run/cancel`, `POST /api/check`, `POST /api/tree`, `POST /api/cache/clear`, `GET /api/events`; 요청 본문 = `SetupRequest` (`INS/setup_types.go:77-172`).

### 10.6 MCP (`terra mcp serve`, stdio)
도구 목록은 Gateway 카탈로그에서 파생(`CLI/mcp/server.go:149`), 자격은 `TERRA_AGENT_TOKEN` 또는 프로필 세션, autonomy 등급. 설정 쓰기 전용 도구는 없음(Gateway operation 호출로 일반화).

### 10.7 브라우저 저장소 (현 runtime UI)
localStorage `terra.runtime.connection.v1` {masterBaseUrl, daemonBaseUrl, demoMode}, `terra.shell.mode`, `terra.runtime.ui-project.v2`, 네임스페이스 `terra.runtime-core`; sessionStorage `terra.runtime.master-token`, `terra.runtime.master-device-token`, `terra.runtime.daemon-token` — `products/common/ui/terra-runtime-core/src/runtime/runtime-config.ts:4-7`, `shell-mode.ts:21`, `runtime-ui-project-storage.ts:4`, `components/ScenePlayerSurface.tsx:205-210`.

---

## 11. 비밀·자격증명 (이름과 위치만)

| 비밀 | 위치 | 보호 | GUI |
| --- | --- | --- | --- |
| 장치 토큰 | `security.device_token_path` (설치 `<daemon data>/device_token`) | 0600, 파일 | N (존재 여부만) |
| Local API bearer | `<daemon data>/local_api_token` (Win 기본 `%APPDATA%\Terra\`) | 0600 | N (host가 프록시에서 부착) |
| Daemon Core-peer 자격 | config `gateway_service.master_service_credential`, `daemon.co_located_master.service_credential`; 자식용 파일 `<data>/gateway_service_credential` | owner=secret, redacted | N |
| Master JWT 서명키 | config `jwt_secret` / env | secret | N |
| 첫 관리자 암호 | config `bootstrap_password`, **평문 파일** `<master data>/bootstrap-credentials`, `bootstrap-password` (0600) | secret | N (최초 1회 안내만) |
| Tree Gateway Core-peer | config `service_credential`, `<master data>/gateway-service-credential` | secret | N |
| TURN 공유 비밀 | `turn.shared_secret` / env | secret | N |
| WebRTC ICE credential | `webrtc.ice_servers[].credential` | **owner 미지정, 마스킹 안 됨** | N |
| DB 비밀번호 | `database_url`(PG) / infra `TERRA_DB_PASSWORD` | 마스킹 안 됨 | N/마스킹 |
| WireGuard 개인키 | `<daemon data>/wireguard/private.key`, `terra0.conf` | 0700 dir | N |
| Master 서비스 아이덴티티 키 | `<master data>/service-identity.json` (ed25519) | | N |
| CLI 세션 | `~/.terra/cli/tokens.json` (access/refresh/tree별) | 0600 | N |
| Desktop launch 토큰 | `<product-host dir>/desktop-launch-token` | 0600 | N |
| 모듈 secret 설정값 | `module-config/<id>.json` 안 **평문**(0600), API는 `{set:bool}`만 | | E(쓰기 전용 입력) |
| Fleet join code | `TERRA_JOIN_CODE` / `enrollment.join_code_path` | | N |
| Agent grant | `TERRA_AGENT_TOKEN` | env | N |
| 모듈 워크로드 자격 | `TERRA_WORKLOAD_CREDENTIAL` (모듈 env) | | N |
| 릴리스 서명키 암호 | `TERRA_SIGN_PASSPHRASE` | CI | N |
| GitHub 토큰 | `TERRA_MODULES_TOKEN` / `GITHUB_TOKEN` | env | N |
| 인스톨러 요청 내 비밀 | `admin_password`, `enrollment_token`, `enrollment_password`, `gateway_service_credential` (request.json; `*_file` 대안 있음) | | N |
| 신뢰 루트 공개키 | `products/common/apps/terra-installer/internal/trust/roots/*.pub`, `release-keys/release-key.cert.json(.minisig)` | 공개 | R |

---

## 12. GUI v3 노출 권고 요약

- **편집(E) 1순위 — 일반 사용자 설정**: `daemon.device_name`, `storage.shared_dirs`, `storage.memos_dir`, `local_fs.{enabled,roots,deny}`, `logging.level`(+max_size/backups), `core_distribution.{hold,hold_reason,maintenance_window,allow_apply,disk_quota_mb,enabled}`, `module_distribution.{enabled,disk_quota_mb}`, `service_tunnels.enabled`, `feature.enable_svi`, 네트워크 토글(`direct_tcp.*`, `wireguard.{enabled,listen_port,advertise_endpoint,stun_servers,nat_mapping_mode}`, `webrtc.{enabled,stun_servers}`), 모듈별 설정(스키마 폼), Master `monitor.alerts.*`, `turn.*`(비밀 제외), CLI 프로필.
- **읽기 전용(R)**: installer/derived owner 키 전부(경로, roles, node_id, mesh_vpn.*, wireguard.mode/address_cidr), 포트·엔드포인트 표, install-manifest, registration 상태, deviations.
- **숨김/고급(A)**: 타임아웃·재시도·간격류, 서명 엄격도, require_tls, local_api.*, runtime_mode/environment.
- **금지(N)**: owner=secret 전부, `dev_open`, `local_api.require_auth=false`, `allow_unsigned_shared_roots`, `module_distribution.allow_dev_install`(최소한 강한 경고), network-helper 정책.
- 구현 지침: (1) 폼은 `GET /config/schema`의 `type/owner/restart_required`로 생성, (2) 쓰기는 `PATCH /config {set, save:true}` + 키별 오류 표시, `OWNER_LOCKED`는 `force` 대신 "재설치/재구성" 안내, (3) `restart_required` 이면 `POST /restart` 제안, (4) env 오버라이드가 걸린 키는 파일과 실제값이 다를 수 있음을 표시(현재 API가 출처를 주지 않음), (5) 원격 노드 설정은 읽기만 가능(cluster scope) — 쓰기는 해당 노드 로컬 GUI에서.

---

## 13. 놀라운 점 (설계에 영향)

1. **Master 설정은 API로 노출되지 않는다.** Tree GUI가 Master 설정(alerts, TURN, display name 등)을 바꾸려면 새 API가 필요하다(현재는 CLI의 파일 직접 편집 + 재시작뿐).
2. **daemon 설정 쓰기는 local scope 전용**(`node.config`), 읽기는 cluster scope 허용. 원격 설정 편집 UI는 현 계약으로 불가능.
3. **소비처 없는 키**: `security.private_key_path`, `security.public_key_path`, `feature.enable_docker`, `feature.enable_screen_share`, `feature.enable_experimental`, `task_queue.max_retry_count`, `master.reconnect`, `heartbeat.timeout_sec`(검증만), `storage.cache_dir`(디렉터리 생성만). GUI에 노출하면 "아무 효과 없는 스위치"가 된다.
4. **스키마 밖 키**(config API로 편집 불가, 파일만): daemon `svi.*`, `webrtc.ice_servers`, `modules.allow_unsigned_shared_roots`, `modules.shared_roots`; master `tree_display_name`, `tree_login_url`, `tree_login_tunnel`, `tree_sibling_introductions`, `crossboundary_rules`.
5. **비밀 분류 누락**: `webrtc.ice_servers[].credential`, Master `database_url`(PG 비밀번호 포함 가능)는 owner=secret 이 아니어서 `config show`에 그대로 출력될 수 있다.
6. **Master 첫 관리자 암호가 평문 파일 2개**(`bootstrap-credentials`, `bootstrap-password`)로 남는다(0600).
7. **master.log 는 회전이 없다**(daemon 로그는 10MB×5). MCP `agent-records.jsonl`도 무제한 append.
8. 바이너리 기본값과 설치값이 다르다: daemon data `~/.terra` vs 설치 `~/.terra/terra`; device token `~/.terra/token.json` vs 설치 `<data>/device_token`; Master `runtime_mode` 기본 dev·`data_dir ./data`. GUI는 "기본값"이 아니라 **실행 중 값(GET /config)** 을 보여야 한다.
9. 자격 파일 이름 불일치: daemon `gateway_service_credential`(밑줄) vs master `gateway-service-credential`(하이픈).
10. `PATCH /config` 와 `POST /config/save` 는 `path`/`name`을 받아 **임의 경로에 설정 파일(비밀 포함, 0600)을 저장**할 수 있다(로컬 토큰 보유자 한정).
11. `GET /config` 주석의 "118 keys"는 낡았고 실제 스키마는 140키(Master 46키).
12. env 오버라이드(`TERRA_DAEMON_*` 76개)는 저장되지 않는데 GET /config 는 출처를 구분하지 않는다 → GUI에서 바꿔도 재시작 후 env가 다시 이긴다.
13. 업데이트 "채널" 개념이 없다: 코어 업데이트는 Tree가 지정(`core_distribution`), 인스톨러 카탈로그 URL은 빌드 시 `defaultCatalogRef` 로 고정.
14. macOS는 인스톨러·서비스 등록 미지원 — 경로는 바이너리 기본값에만 의존.

## 열린 질문

1. GUI v3는 어느 원점에서 동작하나? Product Host(`/api/backend` 프록시, 토큰 자동 부착) 경유인가, Gateway operation(`terra.daemon.config.*`, 권한 `node.config`) 경유인가? 후자면 세션 사용자의 `node.config` 권한 부여 정책이 필요.
2. Master 설정(alerts·TURN·tree_display_name·login 공개 등)을 GUI에서 편집하려면 Master에 `GET/PATCH /api/v1/config` 류 API를 새로 둘 것인가, 아니면 tree 노드의 로컬 파일 편집으로 둘 것인가?
3. 소비처 없는 키(13절 3번)는 스키마에서 제거/숨김할 것인가? (`feature.enable_docker`는 fleet_host와 의미가 겹침)
4. `webrtc.ice_servers.credential`, `database_url`을 owner=secret로 승격할 것인가?
5. env로 덮인 키를 GUI에 어떻게 표시할 것인가(현 API에 출처 정보 없음) — `GET /config`에 `sources` 추가 필요?
6. 사용자 환경설정(테마, 언어, 레이아웃)은 Gateway `me/documents`(Master 저장, 사용자 단위)에 둘 것인가, 브라우저 localStorage(현행 `terra.runtime.*`)에 둘 것인가? CLI `language`/`output`과 동기화 필요 여부.
7. `restart_required` 키 적용 후 재시작은 `POST /restart`(systemd Restart=on-failure/Windows task 의존)로 충분한가, Windows scheduled-task `Degraded` 상태에서도 재기동이 보장되는가?
8. `installer`-owned 키 변경(예: wireguard.mode, fleet_host.enabled)을 GUI에서 "재구성(modify) 실행"으로 연결할 것인가? 인스톨러 UI API(`/api/plan`,`/api/run`)를 GUI v3가 호출하는 구조가 허용되는가?
9. 포트(17321/8787/8788/17421/17422/8080)는 endpoints 표 생성물에 고정 — 사용자 편집을 허용하면 모든 미러와 어긋난다. 편집 불가로 확정할 것인가?
10. 모듈 secret 값이 `module-config/<id>.json`에 평문 저장되는 것을 GUI 설계에서 그대로 수용할 것인가(OS 키체인 연동 여부)?
11. macOS 지원 범위(설치/서비스 없음)에서 GUI v3가 보여 줄 경로 정보의 기준은?

## 관련 문서

- [[settings-inventory|GUI v3 설정 종합]]
- [[settings-modules|modules 설정 전수표]]
