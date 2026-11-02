---
title: "네트워크 속성 창 — 노드의 주소와 노드 간 연결"
aliases:
  - "네트워크 속성 창"
  - "NodeNet"
doc_type: "design"
scope: "module"
target: "lab.stellaxia.gui-v3"
status: "draft"
version: "0.1.0"
last_updated: "2026-11-02"
language: "ko-KR"
related:
  - "[[terra-reach|Terra 도달 분석]]"
  - "[[node-data|노드 데이터와 분할 — PA/EL]]"
  - "[[design-ops-gaps|시안 ↔ 실제 운영 격차]]"
  - "[[web-architecture|GUI v3 웹 구조]]"
---

# 네트워크 속성 창 — 노드의 주소와 노드 간 연결

노드는 서로 여러 길(WireGuard mesh · LAN TCP · WebRTC · Master 중계)로 붙는데, 지금까지 화면에서는 **두 노드가 어떤 길로 붙어 있는지**
볼 수 없었다. 이 창은 한 노드에 대해 ① 그 노드가 가진 주소 ② 그 노드가 광고하는 전송 ③ 다른 노드마다 지금 쓰는 경로를 보인다.

- 보드 `web/design/NodeNet.dc.html`(조각 `build/parts/nodenet/`) · 데이터 `web/src/api/net-props.js`(시험 `net-props.test.mjs` · `tests/nodenet.test.mjs`)
- 여는 곳: 우클릭 › **네트워크**(트리 · 리프) · 전역 제어 노드 폴더 › 기능 › 네트워크. 창 자리 21 · 22, 680 × 720, 불투명
- 시안(캔버스)은 `netProps()` 반환과 같은 칸 · 순서의 예시 값. 실제 모드(`window.TerraNetProps`)는 보고된 것만 — 없는 칸은 `—`

## 1. 근거 — Terra 문서와 계약 (Terra origin/main 53043270)

정본: Terra `docs/modules/terra-gui/design/unified-gui-ux/terra-gui-network-requirements.md`. 필드 이름은 코드(Go json 태그)로 다시 확인했다.

| 개념 | 값 | 출처 |
| --- | --- | --- |
| 경로 종류(route_type) | `local_loopback` · `mesh_vpn_direct` · `lan_direct` · `webrtc_p2p` · `cloud_relay` (`gateway_lan` 은 설계만) | `products/common/packages/terra-protocol/transport.go` |
| 고르는 순서 | mesh 직결 → LAN 직결 → WebRTC P2P → (정책이 허용하면) Master 중계 | Master `control_plane/direct_route_service.go` · `docs/architecture/network/automatic-network-abstraction-design.md` |
| reachability | `local` · `lan` · `mesh` · `internet` | `transport.go` |
| Terra 주소 | `cluster_address` — 등록 노드마다 배정(기본 100.80.0.0/24). "주소는 경로가 아니다" | `docs/architecture/operations/node-identity-and-display-name-alias.md` |
| 사설망 IP | `network.state` `assignments[].assigned_ip` + `networks[]{name, cidr, gateway, dns}` | Master `models/network_state.go` |
| 공인 IP · 공인 endpoint · LAN · 수신 포트 | `observed_transports[adapter=wireguard-bootstrap].details{nat_identity, nat_identity_source, public_endpoint, public_source, lan_endpoint, listen_port}` — 그 노드가 WireGuard 보고를 했을 때만 | `network_state.go` `WireGuardEndpointDetails` |
| 쌍마다 WireGuard endpoint | `network.mesh.wireguard.peers.get{node_id}` `peers[]{endpoint, endpoint_source(lan · public · peer_reflexive · reported · operator), health}` | Master `api/routes_network_wireguard_peers.go` |

## 2. 무엇을 어디서 읽나 — 모두 앱 자격(A 모드)에서 열림

| 창의 구역 | 읽기 | 비고 |
| --- | --- | --- |
| 주소 | 지도(`nodes.get`) · `network.state` · Daemon `wireguard.status`(mesh 인터페이스 `address_cidr` · NAT 매핑 · STUN 서버) | Daemon 은 로컬이면 바로, 다른 노드면 Master 중계(직계 자식만) |
| 사설망 | `network.state` | |
| 광고 중인 전송 | `network.status` `transport_capabilities[]`(TTL 2분) + 광고에 없는 관측 전송(24시간) + relay 연결 | |
| 다른 노드와의 연결 | `route.graph`(두 방향의 고를 후보 · 거부 수) · `mesh.wireguard.peers` · Daemon `wireguard.peers`(handshake · 트래픽) · `network.probes`(지연) · `route.sessions` | "지금 경로" = 열린 세션 > 고를 후보 > WireGuard 쌍 |
| 줄 펼침 › 후보 보기 | `route.candidates{source_node_id, target_node_id}` | 후보 · 양쪽 endpoint · 이유 · 거부 사유 · 정책 출처 |

Master 읽기는 15초 나눠 쓰고(창 여러 개), 실패한 읽기는 창 머리 아래 노란 줄 `읽지 못함 · 이름 코드` — 나머지는 그린다.

## 3. Terra 가 보고하지 않는 것 — 창 아래에 그대로 적는다

| 사용자가 원한 것 | 왜 못 보이나 | 바꾸려면 |
| --- | --- | --- |
| 노드가 가진 **모든 IP · 인터페이스 목록** | Daemon 이 bootstrap 보고에 `endpoint_candidates` 를 싣지만 Master 가 `lan_endpoint` 하나만 남긴다. 읽는 Daemon operation 도 없다 | Terra — 후보 목록 저장 또는 Daemon 읽기 operation |
| **서브넷(prefix)** | 접두사 보고 자체가 없다(ADR-NW-001 §2-2 가 요구) | Terra |
| WebRTC ICE 후보 · 고른 pair · 연결 상태 | 노출하는 코드가 없다 | Terra |
| probe 새로 실행 | `network.probes.post` 가 위임 밖 | Terra 위임 문 |
| 손자 노드의 Daemon 읽기(mesh 인터페이스 · handshake) | Master 중계는 직계 자식만 | — (그 칸만 `—`, 창 머리에 읽지 못함) |
