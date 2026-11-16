# lab.stellaxia.workload

Terra가 **Terra를 모르는 프로그램**을 맡는다. 실행 파일을 경로로 **참조 등록**하고, 시작·정지·로그를 본다 — 복사도, 패키징도, manifest도 없이.

> **Workload M1** — 참조 등록 · `exec` 드라이버 · 한 노드. 설계는 terra-docs `docs/modules/terra-workload/` (v0.4), 단계는 `docs/implementation/remote-execution-workload-plan.md`.

```bash
terra workload register local.scriba-backend --exec "C:/Terra Project/Scriba/backend.exe" --dir "C:/Terra Project/Scriba" --restart on-failure
terra workload start  local.scriba-backend
terra workload logs   local.scriba-backend --tail 50
terra workload status local.scriba-backend     # status와 마지막 종료(코드·forced)
terra workload stop   local.scriba-backend
terra workload rm     local.scriba-backend
```

명령 11개: `register` `list` `get` `set` `rm` `start` `stop` `restart` `status` `logs` `events`. 전부 이 모듈의 operation(`lab.stellaxia.workload.workloads.*`)을 부르는 기여 명령이라 코어 CLI는 이 모듈을 모른다.

## 약속

- **충실도** — 격리 없음. 종료 코드를 그대로 기록한다(`last_exit.code`).
- **id는 `local.`로 시작** (D-26) — 트리 배포 id와 충돌하지 않는다.
- **이 노드에서만 유효** — 목록 응답은 `scope: node-local`. 없는 id는 `WORKLOAD_NOT_FOUND`("이 노드에 없다").
- **drift는 표시** — 등록 뒤 파일이 바뀌어도 막지 않고 `source.drift`로 알린다 (D-16).
- **로그** — workload 전용, 2 MiB × 2장 회전. 데몬 로그를 밀어내지 않는다.
- **재시작** — `never`/`on-failure`/`always`, backoff는 두 배씩 30초 상한. 연속 `max_restarts` 초과 또는 절대 20회에서 `restart_storm` 이벤트를 남기고 멈춘다 (FR-H4).
- **부모가 죽으면 자식도** — Windows는 Job Object(kill-on-close), Linux는 `Pdeathsig` (FR-H5).
- **환경** — 스냅샷 값은 `workloads/{id}/env.snapshot`(0600)에만 있고 응답에는 키 이름만 나온다. `TERRA_*` 키는 스냅샷·선언값 모두에서 버린다 (FR-H6).
- **재기동 복원** — 모듈이 다시 뜨면 `auto_start` 등록을 시작한다. 파일이 사라진 건은 그 건만 `unavailable` (FR-B8).

## 승격 데몬 가드 (Q-14 · O8 · D-27)

이 모듈은 Daemon이 띄우므로 Daemon의 토큰을 물려받는다. 그래서 **자기 프로세스가 승격이면 Daemon이 승격이다** — Windows 토큰 `TokenElevation`, Linux `euid == 0`. 승격이면 `register`·`set`·`start`·`restart`를 `WORKLOAD_DAEMON_ELEVATED`(403)로 거부하고 이유를 문장으로 답한다. `list`·`get`·`status`·`logs`·`events`·`stop`·`rm`은 그대로 되어, 승격 아래 남은 등록을 치울 수 있다. 판별을 읽지 못하면 승격으로 간주한다(안전한 쪽). 데몬이 비승격이 되면 가드는 저절로 풀린다. 코어 변경은 필요 없다.

## M1에서 아직 안 되는 것

- **셸 환경 스냅샷을 CLI가 자동으로 보내지 않는다.** 기여 명령은 셸 환경을 읽을 수 없다. API(`env_snapshot`)는 받는다. 지금 CLI에서는 `--env KEY=VALUE`(선언값)만 되고, 스냅샷이 없으면 `env.mode`는 `declared`(안전 키 + 선언값)다. 코어에 "이 플래그는 셸 환경에서 온다" 출처가 필요하다 (D-25의 남은 조각).
- **`logs -f` 없음** — 요청/응답 operation이라 `--after <cursor>`로 이어 읽는다.
- **Windows graceful 정지 없음** — 임의 프로그램에 보낼 신호가 없어 Job을 종료하고 `forced: true`로 답한다. Linux는 SIGTERM 후 예산 초과 시 SIGKILL.
- `--attach`(D-14), 동봉 등록·컨테이너·배치·격리·원격(M2~), GUI 화면.
- `set --auto-start`는 켜기만 된다(끄기 플래그 없음).
- `workload.read`/`workload.manage` 권한은 계약에 선언했지만 계정에 부여하는 정책은 이 PR 밖이다.
