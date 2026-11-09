# Terra Virtual Device Bridge (lab.stellaxia.virtual-device)

SVI Resource Endpoint가 보내는 영상 frame을 운영체제 가상 카메라 장치로 내보내는 독립 실행형 Leaf 모듈이다. Zoom·OBS·브라우저처럼 SVI를 모르는 프로그램이 일반 장치 목록에서 "Terra Virtual Camera"를 고를 수 있게 하는 것이 목적이다.

이 모듈은 Terra 저장소(`module/leaf/lab.stellaxia.virtual-device` + `products/common/apps/terra-virtual-device`)에서 이 저장소로 이관되었다. 이관 뒤의 정본은 **이 저장소**이고, Terra 쪽 사본은 Phase 0(제어 API + Fake Adapter, frame 경로 없음)에서 멈춘 이전 모습이다. 설계 문서(`leaf-virtual-device-projection-application-detailed-design`)는 Terra 저장소에 남아 있다.

## 지금 되는 것 / 안 되는 것

구현 단계는 설계 §25의 **Phase 1 + Linux Adapter**(`GET /status`의 `phase`: `phase-1+linux-adapter`)다: SVI sink seam으로 frame을 받아 Slot의 Adapter에 전달하고, Linux에서는 미리 만들어 둔 v4l2loopback 노드에 쓴다. **Linux Adapter는 가짜 v4l2 장치를 주입한 시험으로만 검증되었고 실제 v4l2loopback에서는 아직 검증되지 않았다** (아래 "알려진 한계").

| 되는 것 | 안 되는 것 |
| --- | --- |
| 제어 API: 읽기 표면과 Slot·Projection의 `PUT`·`DELETE` (operation 12개) | Windows·macOS Adapter (아직 없음) |
| Slot마다 SVI sink 자원 1개를 카탈로그에 게시 (`vdevice.<slot_id>`, endpoint `input`) | 720p 이상 영상, YUY2 외 픽셀 형식, 압축 영상 (아래 "영상 크기 상한") |
| Daemon이 binding을 열면 frame을 Slot의 Adapter에 순서대로 전달 | Projection 선언으로 binding을 자동 생성 — **binding은 운영자가 만든다** |
| Source가 사라지면(Lease 만료·revoke·binding 닫힘) 즉시 중단하고 장치에 검은 화면 | 오디오 (Phase 5) |
| Projection 런타임이 실제 sink 상태를 보고 (`priming`/`active`/`degraded`) | `POST /adapters/{id}/driver-plan`, `GET /events` (SSE), `terra leaf virtual-device …` CLI |
| Slot·Projection 선언이 재시작을 넘겨 남는다 | Driver·Extension 설치 (서명된 Setup 경로의 일이다) |

**Fake Adapter는 Fake라고 보고한다.** `fake.in-memory`는 `simulated: true`, `health: "simulated"`, `os_device_id`가 `fake:`로 시작한다. frame 경로(개수·바이트·fallback 호출)는 시험할 수 있지만 운영체제 장치 목록에는 아무것도 나타나지 않는다. 카메라가 되는지 확인하는 데 쓰면 안 된다. 그래서 `GET /status`는 Fake만 있을 때 `degraded`이고, 실제(비 simulated) Adapter가 ready일 때만 `ok`다.

`windows.mediafoundation`·`macos.coremediaio`는 `GET /adapters`에 나오되 `install_state: not_installed`이고 Slot 요청을 `VDEV_ADAPTER_UNAVAILABLE`로 거절한다. Linux의 `linux.v4l2loopback`은 설정(`linux.devices`)에 따라 동작한다(실제 장치 검증 전).

## frame이 흐르는 방식 (sink)

모듈은 Daemon에 직접 연결하지 않는다(`GET /status`의 `daemon.connected`는 항상 `false`이고 이유를 적는다). 대신 모듈 SDK의 SVI sink seam을 쓴다.

1. Slot을 선언한다 (`PUT /slots/{slot_id}`). 모듈이 다음 폴링에서 자원 `vdevice.<slot_id>`를 카탈로그에 게시한다 (Daemon 정식 id: `svi.<node>.vdevice.<slot_id>`).
   - kind `virtual-device.camera`, endpoint `input` (direction `sink`, interaction `stream`, 입력 스키마 `terra.video.frame@1`, encoding `video/x-raw;format=YUY2`, `max_consumers: 1`, `exclusive`).
   - endpoint metadata에 `width`·`height`·`fps`·`pixel_format`·`frame_bytes`·`simulated`.
   - 상태: sink가 열려 있으면 `busy`, Adapter가 없거나 준비되지 않았거나 Slot이 중지·형식 불가거나 **그 Slot의 장치가 지금 쓸 수 없으면** `unavailable`(`status_reason`에 `slot_disabled`·`adapter_unavailable`·`adapter_cannot_take_frames`·`format_unsupported`·`slot_device_unavailable`), 아니면 `available`. 장치 가용성은 Adapter 전체가 아니라 **Slot 단위**로 판정한다(다른 Slot의 장치가 멀쩡해도 이 Slot의 장치가 없으면 `unavailable`). 모듈 시작 때 장치가 없어 등록에 실패한 Slot도 장치가 생기면 다시 `available`이 되고, sink를 열 때 Adapter에 Slot을 다시 등록시킨다.
2. **운영자가** Source endpoint를 그 sink에 잇는 binding을 만든다 (Terra CLI/API의 SVI binding). 이 모듈은 binding을 만들지 않는다. Projection 선언(`PUT /projections/…`)은 "무엇을 연결하려 하는가"의 기록일 뿐이고 binding을 만들지 않는다 — 런타임 `reason_detail`이 그렇게 말한다.
3. Daemon이 sink를 열면 frame 1개 = `Write` 1회로 들어온다. 길이가 Slot의 frame 크기와 다르면 거부(`VDEV_FRAME_INVALID`)하고 Adapter에 닿지 않는다.
4. sink가 닫히면(Lease 만료·revoke·binding 닫힘 모두) Adapter에 검은 화면을 띄우고 sink를 닫는다. **장치 handle(fd)을 놓는지는 Adapter마다 다르다**: Fake는 기록을 놓지만, Linux v4l2 Adapter는 노드에 설정된 형식을 유지하려고 Slot당 fd 하나를 들고 있다가 **Slot을 삭제할 때(또는 모듈이 종료될 때)** 놓는다 — Slot 중지나 sink 닫힘으로는 놓지 않는다. Slot을 삭제하거나 중지하거나 frame 크기(너비·높이·픽셀 형식)를 바꾸면 열린 sink도 닫힌다. 이름(`display_name`)만 바꾸는 수정은 열린 sink와 화면을 건드리지 않는다. Adapter가 거절한 수정은 열린 sink를 닫지 않는다.

Projection 런타임 상태 (설계 §10.2에 `waiting_source`라는 상태는 없어 쓰지 않는다):

| 상황 | observed_state |
| --- | --- |
| sink 없음 | `degraded` / `VDEV_SOURCE_UNAVAILABLE` |
| sink 열림, 아직 장치에 닿은 frame 없음 | `priming` |
| sink 열림, frame이 장치에 전달되는 중 | `active` |
| 장치가 frame을 거부 | `degraded` / Adapter의 오류 코드 (다음 성공 frame에서 회복) |
| 크기가 틀린 frame이 거부됨 | `degraded` / `VDEV_FRAME_INVALID` (다음 성공 frame에서 회복) |
| Adapter 또는 그 Slot의 장치가 준비되지 않음 | `waiting_driver` |

선언만으로는 절대 `active`가 되지 않는다.

## 영상 크기 상한

SDK가 sink 요청 JSON을 1 MiB로 자르고 frame은 그 안에서 base64로 실려 오므로 **원시 frame은 약 780 KB(`MaxSinkFrameBytes` = 780,000바이트)가 상한**이다. 이 값은 terra-sdk의 것이라 모듈이 올릴 수 없다.

- Phase 1은 **raw YUY2만** 받는다 (frame = 너비 × 높이 × 2바이트, 너비는 짝수).
- 640x480 YUY2(614,400바이트)는 된다. 1280x720(1,843,200바이트)은 **안 된다**.
- 이를 넘기거나 YUY2가 아닌 형식을 가진 Slot은 `PUT /slots/{slot_id}`에서 `VDEV_FORMAT_INCOMPATIBLE`(409)로 거절된다. 형식을 아예 선언하지 않은 Slot은 만들 수 있지만 `format_unsupported`로 게시되고 sink를 열 수 없다.
- Slot에 형식이 여럿이면 첫 번째가 frame 크기를 정한다.

## 활성화

Manifest v2에는 `enabled` 플래그가 없다. **존재와 실행 가능성이 곧 활성화다** — 모듈 호스트는 자기 target의 프로세스 entrypoint(`bin/<target>/terra-virtual-device`)가 실제로 있고 유효한 모듈을 켠다. 소스 체크아웃에는 `bin/<target>/`이 없어서(빌드 산출물) 개발 트리에서는 모듈이 뜨지 않는다. 이 저장소의 모듈 패키징·서명 절차로 번들에 실려 설치된 노드에서 Daemon의 `POST /modules/scan`으로 다시 검색하고 시작한다.

직접 실행 모드는 **없다**. Terra 쪽 P6의 `--master … --token … --device …`(SVI Handle 하나를 열어 장치 노드로 펌프하는 모드)는 Daemon 쪽 클라이언트 SDK에 의존했는데 공개 terra-sdk에는 그것이 없고, sink seam이 같은 일을 하므로 가져오지 않았다. 바이너리는 모듈 호스트가 주는 workload 신원 환경변수 없이는 시작하지 않는다.

Driver나 Extension 설치는 이 모듈이 하지 않는다. 서명된 Setup 경로만 한다(설계 §4 원칙 3). Linux에서 v4l2loopback 커널 모듈과 `/dev/videoN` 노드는 운영자(또는 Setup)가 미리 만들어 둔다 — 이 모듈은 이미 있는 노드에 쓸 뿐이다.

## 알려진 한계

- **실제 장치 미검증.** Linux v4l2loopback Adapter는 가짜 `v4l2Device`를 주입한 단위 시험으로만 검증되었다. 실제 loopback 노드를 쓰는 시험(`TERRA_VDEV_TEST_DEVICE`)은 장치가 없으면 SKIP된다. "S_FMT 뒤에 write(2)로 frame 1개가 들어간다", "읽는 쪽이 없어도 write가 성공한다", "fd가 열려 있는 동안 형식이 유지된다"는 기억에 의존한 가정이고 실기계 시험이 아직 확인하지 않았다.
- **멈춘 source를 감시하지 않는다 (설계 §14.3 미구현).** sink는 열린 채 frame만 끊기면(source가 멈추거나 느려지거나 Daemon 쪽 전달이 끊김) 장치는 마지막 frame을 계속 보여 주고 Projection은 `active`·마지막 `last_frame_at`을 유지한다. `stale_frame_after_ms`는 읽기만 하고 쓰이지 않는다. sink가 **닫힐 때만** 검은 화면으로 바뀐다.
- **Daemon이 `Close` 없이 사라지면** (비정상 종료 등) Slot이 `busy`로 남는다. 모듈을 재시작하거나 Slot을 중지했다가 다시 시작하면 풀린다 (이 모듈은 sink를 스스로 회수하지 않는다).
- Windows·macOS Adapter, 720p 이상, 압축 영상, 오디오, Projection으로 binding 자동 생성은 없다 (위 표).

## 설정

`config/virtual-device.example.json`을 `config/virtual-device.json`으로 복사해 고친다. 기본값이 곧 예시 파일의 내용이므로 파일이 없는 것과 예시를 그대로 복사한 것이 같게 동작한다. 경로는 `--config` > `$TERRA_MODULE_DIR/config/virtual-device.json` > 작업 디렉터리 순이고, 가운데가 운영 경로다(Manifest v2에는 `args`가 없어 감독되는 모듈은 argv를 받지 않는다).

Linux 장치 매핑:

```json
{
  "schema_version": 1,
  "linux": {
    "devices": { "camera-main": "/dev/video10" }
  }
}
```

키는 Slot id, 값은 그 Slot이 쓸 loopback 노드다. 값은 `/dev/video<N>` 형식만 허용되고 그 밖의 경로는 파일 로드 시 거부된다(임의 경로 쓰기를 막기 위함). 한 노드를 두 Slot이 가질 수 없다. Linux가 아닌 OS에서는 무시된다.

### 아직 동작하지 않는 설정

아래 값은 **파일 검증과 `GET /diagnostics` 보고에만 쓰이고 동작에는 아직 쓰이지 않는다.** 바꿔도 달라지는 것이 없다(검증을 통과한다고 효과가 있는 것은 아니다).

| 설정 | 현재 |
| --- | --- |
| `video.stale_frame_after_ms` | 미동작 — stale 감시가 없다 (위 "알려진 한계") |
| `video.fallback` | 검증만 — 허용값은 `black` 하나이고, 동작도 항상 검은 화면이다 |
| `video.max_queue_frames` | 미동작 — frame 큐가 없다(Write 1회 = 장치 write 1회) |
| `video.max_frame_bytes` | 미동작 — 한도는 고정된 `MaxSinkFrameBytes`(780,000) |
| `daemon.endpoint`·`connect_timeout_sec`·`reconnect_initial_backoff_ms`·`reconnect_max_backoff_ms` | 미동작 — 모듈은 Daemon에 직접 연결하지 않는다 |
| `projection.handle_renew_before_sec` | 미동작 — 모듈이 쥔 Handle이 없다 |
| `projection.default_lifecycle` | 검증·보고만 |
| `audio.*` | 검증·보고만 — 오디오는 없다 |

동작에 쓰이는 것은 `linux.devices`와 보안 불변값 검증이다.

`security.external_listen`·`security.allow_unsigned_adapter`·`diagnostics.persist_frame_payload`는 설계 §18이 고정한 보안 불변값이다. 파일에 적을 수는 있고 켤 수는 없다 — 켜면 기동이 거절된다.

## 상태 저장

선언된 Slot·Projection은 호스트가 내주는 모듈 데이터 디렉터리(`permissions.storage: ["module-data"]`)의 `virtual-device-state.json`에 남는다. 설치 페이로드 안에는 쓰지 않는다 — 그 디렉터리는 설치기의 것이고 해시로 추적되므로 거기 쓰면 모듈이 자기 무결성 검사에 걸린다. Token·Lease·frame payload는 저장하지 않는다(설계 §19.2). sink와 frame 카운터는 메모리에만 있어 재시작하면 새 sink부터 다시 시작한다.

## 제어 API

```text
/api/modules/lab.stellaxia.virtual-device/v1
```

계약이 원본이다: [`contracts/api/terra-api.json`](contracts/api/terra-api.json)의 `bindings`에 적은 method·path를 Gateway가 그대로 게시한다. 표면을 바꿀 때는 코드가 아니라 이 파일을 먼저 고친다(`src/vdevice/contract_map_test.go`가 계약과 핸들러를 양방향으로 대조한다).

## 개발

```bash
cd src
gofmt -l .            # 출력이 없어야 한다
go vet ./...
go test -count=1 ./...
GOOS=linux GOARCH=amd64 go vet ./...   # Linux 어댑터 교차 확인
```

`-race`는 cgo가 있는 환경에서만 돈다. sink 코드의 잠금 순서와 규율은 `src/vdevice/feed.go` 머리 주석에 적혀 있다.
