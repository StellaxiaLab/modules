// 설정 — 디자인 캔버스 원본 design/Settings.dc.html 에서 옮긴 화면 로직 (module 변형 · tools/gen-pages.py로 다시 만든다)
// 데이터를 바꿔 끼우는 곳은 src/boot/module.js · src/data/*.js — 이 파일은 손으로 고치지 않는다
import { DCLogic } from '../runtime/dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    // Master의 기본 권한(DefaultPermissions) · 권한 사전 — Master는 값을 검사하지 않고 저장한다, 사전에 없는 이름도 문자열로 넣을 수 있다
    this.DEFAULT_PERMS = ['node.read', 'node.control', 'process.execute', 'file.read', 'file.write', 'relay.use', 'module.publish', 'agent.use', 'agent.grant'];
    this.KNOWN_PERMS = this.DEFAULT_PERMS.concat(['node.config', 'node.enroll', 'module.manage', 'master.admin', 'module.approve', 'core.publish']);
    // Daemon 설정 스키마 135키 — terra-gui-settings §2.7에서 옮김: [key, 타입, 소유, 반영, 컨트롤, 기본값, 허용값·규칙, 뜻, 선택지]
    this.GROUPS = [{"name": "노드", "pre": "daemon · storage · logging", "keys": [["daemon.capabilities", "목록", "운영자", "즉시", "목록", "—", "—", "로컬 노드가 광고하는 capability 목록", []], ["daemon.data_dir", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra`", "필수", "데이터 디렉터리", []], ["daemon.device_name", "문자열", "운영자", "즉시", "텍스트", "`\"\"`", "—", "노드 표시 이름", []], ["daemon.environment", "문자열", "운영자", "재시작", "선택", "`prod`", "`dev`·`test`·`prod`", "실행 환경. prod면 보안 규칙이 강해진다", ["dev", "test", "prod"]], ["daemon.node_id", "문자열", "파생", "재시작", "읽기 전용", "`\"\"`", "—", "Master가 등록 때 발급한 노드 id", []], ["daemon.roles", "목록", "파생", "즉시", "읽기 전용", "—", "—", "설치된 구성요소가 정하는 역할 목록", []], ["daemon.runtime_mode", "문자열", "운영자", "재시작", "선택", "`service`", "`foreground`·`service`·`dev`", "실행 방식", ["foreground", "service", "dev"]], ["storage.cache_dir", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra/cache`", "—", "캐시 디렉터리", []], ["storage.data_dir", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra`", "필수", "저장소 데이터 디렉터리", []], ["storage.shared_dirs", "목록", "운영자", "재시작", "목록", "`~/TerraShare`", "—", "공유 폴더 목록 — `io.terra.file`이 여는 루트", []], ["storage.temp_dir", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra/tmp`", "—", "임시 디렉터리", []], ["logging.file_enabled", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "파일로 남기기", []], ["logging.format", "문자열", "운영자", "재시작", "선택", "`json`", "`json`·`text`", "로그 형식", ["json", "text"]], ["logging.level", "문자열", "운영자", "즉시", "선택", "`info`", "`debug`·`info`·`warn`·`warning`·`error`", "로그 수준", ["debug", "info", "warn", "warning", "error"]], ["logging.log_dir", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra/logs`", "—", "로그 디렉터리", []], ["logging.max_backups", "정수", "운영자", "재시작", "숫자", "`5`", "≥ 0", "보관할 이전 파일 수", []], ["logging.max_size_mb", "정수", "운영자", "재시작", "숫자", "`10`", "≥ 1", "파일 하나의 최대 크기(MB)", []]], "secs": [{"name": "노드 식별", "keys": ["daemon.capabilities", "daemon.data_dir", "daemon.device_name", "daemon.environment", "daemon.node_id", "daemon.roles", "daemon.runtime_mode"]}, {"name": "저장소", "keys": ["storage.cache_dir", "storage.data_dir", "storage.shared_dirs", "storage.temp_dir"]}, {"name": "로그", "keys": ["logging.file_enabled", "logging.format", "logging.level", "logging.log_dir", "logging.max_backups", "logging.max_size_mb"]}]}, {"name": "Master 연결", "pre": "master · heartbeat · enrollment", "keys": [["master.reconnect", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "끊기면 다시 연결", []], ["master.reconnect_initial_delay_ms", "정수", "운영자", "재시작", "숫자", "`1000`", "≥ 0", "재연결 첫 대기(ms)", []], ["master.reconnect_max_delay_ms", "정수", "운영자", "재시작", "숫자", "`30000`", "≥ 첫 대기", "재연결 최대 대기(ms)", []], ["master.request_timeout_sec", "정수", "운영자", "재시작", "숫자", "`10`", "≥ 1", "Master 요청 제한 시간(초)", []], ["master.url", "문자열", "운영자", "재시작", "텍스트", "`\"\"`", "절대 URL, `ws`·`wss`·`http`·`https`. prod + `security.require_tls` + runtime≠dev면 `wss`·`https`만. 필수", "상위 Master 주소", []], ["heartbeat.interval_sec", "정수", "운영자", "재시작", "숫자", "`10`", "≥ 1", "heartbeat 주기(초)", []], ["heartbeat.timeout_sec", "정수", "운영자", "재시작", "숫자", "`5`", "1 ~ 주기", "heartbeat 응답 제한(초)", []], ["enrollment.enabled", "켜기/끄기", "설치기", "재시작", "읽기 전용", "켬", "켜면 `enrollment.state_path` 필수", "등록 기능을 이 설치가 가졌는가", []], ["enrollment.image_digest", "문자열", "파생", "재시작", "읽기 전용", "—", "`TERRA_IMAGE_DIGEST`가 우선", "이 멤버가 부팅한 이미지 digest", []], ["enrollment.instance_key", "문자열", "운영자", "재시작", "텍스트", "—", "`TERRA_INSTANCE_KEY`가 우선", "Fleet 안의 고정 신원 — 재시작 때 같은 자리를 다시 쓰는가를 정한다", []], ["enrollment.join_code_path", "문자열", "운영자", "재시작", "텍스트", "—", "`TERRA_JOIN_CODE`가 우선", "Fleet 가입 코드 파일 경로 — 코드는 파일에만 둔다", []], ["enrollment.state_path", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra/registration.json`", "—", "등록 상태 파일", []], ["daemon.co_located_master.base_url", "문자열", "설치기", "재시작", "읽기 전용", "—", "루프백", "같은 기계의 Master 주소 — tree 역할도 가진 노드만", []], ["daemon.co_located_master.request_timeout_sec", "정수", "운영자", "재시작", "숫자", "—", "—", "그 Master 호출 제한 시간(초)", []], ["daemon.co_located_master.service_credential", "문자열", "비밀", "재시작", "숨김", "(숨김)", "API로 못 바꾼다", "그 Master에 대한 Core-peer 자격", []]], "secs": [{"name": "Master 세션", "keys": ["master.reconnect", "master.reconnect_initial_delay_ms", "master.reconnect_max_delay_ms", "master.request_timeout_sec", "master.url", "heartbeat.interval_sec", "heartbeat.timeout_sec"]}, {"name": "노드 등록", "keys": ["enrollment.enabled", "enrollment.image_digest", "enrollment.instance_key", "enrollment.join_code_path", "enrollment.state_path"]}, {"name": "동일 호스트 Master", "keys": ["daemon.co_located_master.base_url", "daemon.co_located_master.request_timeout_sec", "daemon.co_located_master.service_credential"]}]}, {"name": "네트워크", "pre": "wireguard · mesh_vpn · direct_tcp · grpc · webrtc · 터널", "keys": [["wireguard.address_cidr", "문자열", "파생", "재시작", "읽기 전용", "`\"\"`", "managed면 CIDR. 등록·동기화가 켜져 있으면 비워도 된다", "로컬 노드의 mesh 주소 — Master 네트워크 계획이 준다", []], ["wireguard.advertise_endpoint", "문자열", "운영자", "재시작", "텍스트", "—", "—", "다른 노드에 알릴 endpoint", []], ["wireguard.auto_install", "켜기/끄기", "설치기", "재시작", "읽기 전용", "끔", "—", "WireGuard 자동 설치", []], ["wireguard.auto_up", "켜기/끄기", "설치기", "재시작", "읽기 전용", "끔", "managed에서 주소가 없고 동기화도 없으면 켤 수 없다", "인터페이스 자동 올림", []], ["wireguard.desired_sync_interval_sec", "정수", "운영자", "재시작", "숫자", "`60`", "≥ 0", "Master desired 설정 동기화 주기(초)", []], ["wireguard.enabled", "켜기/끄기", "운영자", "재시작", "토글", "끔", "켜면 `interface_name`·`private_key_path` 필수", "WireGuard 통합 켜기", []], ["wireguard.endpoint_refresh_interval_sec", "정수", "운영자", "재시작", "숫자", "`60`", "≥ 0", "endpoint 갱신 주기(초)", []], ["wireguard.install_policy", "문자열", "설치기", "재시작", "읽기 전용", "`optional`", "`optional`·`required`", "WireGuard 설치가 필수인가", []], ["wireguard.interface_name", "문자열", "운영자", "재시작", "텍스트", "`terra0`", "—", "인터페이스 이름", []], ["wireguard.listen_port", "정수", "운영자", "재시작", "숫자", "`51820`", "0 ~ 65535", "수신 포트", []], ["wireguard.mode", "문자열", "설치기", "재시작", "읽기 전용", "`external`", "`external`·`managed`", "WireGuard 운영 방식 — managed는 권한 헬퍼가 필요해 재설치로만 바꾼다", []], ["wireguard.mtu", "정수", "운영자", "재시작", "숫자", "`1420`", "0 또는 ≥ 576", "MTU", []], ["wireguard.nat_gateway", "문자열", "운영자", "재시작", "텍스트", "—", "IP 주소. 비면 자동", "매핑을 요청할 게이트웨이", []], ["wireguard.nat_mapping_lifetime_sec", "정수", "운영자", "재시작", "숫자", "`3600`", "auto면 ≥ 60", "매핑 수명(초)", []], ["wireguard.nat_mapping_mode", "문자열", "운영자", "재시작", "선택", "`auto`", "`auto`·`disabled`", "공유기 포트 매핑 시도", ["auto", "disabled"]], ["wireguard.nat_mapping_protocols", "목록", "운영자", "재시작", "다중 선택", "`nat-pmp, pcp, upnp`", "`nat-pmp`·`pcp`·`upnp`, auto면 1개 이상, 중복 불가", "포트 매핑 프로토콜", ["nat-pmp", "pcp", "upnp"]], ["wireguard.nat_probe_timeout_ms", "정수", "운영자", "재시작", "숫자", "`2000`", "auto면 ≥ 1", "매핑 탐침 제한(ms)", []], ["wireguard.persistent_keepalive_sec", "정수", "운영자", "재시작", "숫자", "`25`", "≥ 0", "keepalive(초)", []], ["wireguard.private_key_path", "문자열", "설치기", "재시작", "읽기 전용", "`\"\"`", "—", "WireGuard 개인키 파일", []], ["wireguard.privileged_helper_path", "문자열", "설치기", "재시작", "읽기 전용", "—", "—", "권한 헬퍼 경로", []], ["wireguard.privileged_helper_timeout_sec", "정수", "운영자", "재시작", "숫자", "`30`", "헬퍼가 있으면 ≥ 1", "권한 헬퍼 제한(초)", []], ["wireguard.stun_servers", "목록", "운영자", "재시작", "목록", "—", "—", "공인 주소를 찾을 STUN 서버", []], ["wireguard.stun_timeout_ms", "정수", "운영자", "재시작", "숫자", "`2000`", "STUN 서버가 있으면 ≥ 1", "STUN 제한(ms)", []], ["mesh_vpn.adapter", "문자열", "파생", "재시작", "읽기 전용", "`wireguard`", "`wireguard`·`tailscale` 등. tcp·websocket·webrtc 불가", "mesh 어댑터", []], ["mesh_vpn.advertise_host", "문자열", "파생", "재시작", "읽기 전용", "`\"\"`", "`0.0.0.0`·`::` 불가", "mesh로 알릴 주소", []], ["mesh_vpn.connect_timeout_ms", "정수", "운영자", "재시작", "숫자", "`5000`", "켜져 있으면 ≥ 1", "mesh 연결 제한(ms)", []], ["mesh_vpn.enabled", "켜기/끄기", "파생", "재시작", "읽기 전용", "끔", "켜면 adapter·listen·advertise·network_id·timeout 필수", "mesh 도달 endpoint를 광고한다", []], ["mesh_vpn.listen_host", "문자열", "운영자", "재시작", "텍스트", "`0.0.0.0`", "—", "mesh 리스너 주소", []], ["mesh_vpn.mode", "문자열", "파생", "재시작", "읽기 전용", "`external`", "`external`·`managed`(managed는 wireguard만, `wireguard.enabled` 필요)", "mesh 운영 방식", []], ["mesh_vpn.network_id", "문자열", "파생", "재시작", "읽기 전용", "`\"\"`", "—", "mesh 네트워크 id", []], ["mesh_vpn.peer_id", "문자열", "파생", "재시작", "읽기 전용", "`\"\"`", "—", "mesh 안의 로컬 노드 id", []], ["mesh_vpn.port", "정수", "운영자", "재시작", "숫자", "`17323`", "0 ~ 65535", "mesh 리스너 포트", []], ["direct_tcp.advertise_host", "문자열", "운영자", "재시작", "텍스트", "`\"\"`", "`0.0.0.0`·`::` 불가", "다른 노드가 붙을 주소", []], ["direct_tcp.connect_timeout_ms", "정수", "운영자", "재시작", "숫자", "`5000`", "≥ 1", "연결 제한(ms)", []], ["direct_tcp.enabled", "켜기/끄기", "운영자", "재시작", "토글", "끔", "켜면 listen·advertise·port·timeout 필수", "LAN 직접 연결 리스너(TLS·route ticket) — 포트가 열린다", []], ["direct_tcp.listen_host", "문자열", "운영자", "재시작", "텍스트", "`0.0.0.0`", "—", "리스너 주소", []], ["direct_tcp.port", "정수", "운영자", "재시작", "숫자", "`17322`", "1 ~ 65535", "리스너 포트", []], ["grpc_transport.advertise_host", "문자열", "운영자", "재시작", "텍스트", "`\"\"`", "—", "다른 노드가 붙을 주소", []], ["grpc_transport.connect_timeout_ms", "정수", "운영자", "재시작", "숫자", "`5000`", "—", "연결 제한(ms)", []], ["grpc_transport.enabled", "켜기/끄기", "운영자", "재시작", "토글", "끔", "—", "같은 세션을 gRPC로 나르는 리스너 — 포트가 열린다", []], ["grpc_transport.listen_host", "문자열", "운영자", "재시작", "텍스트", "`0.0.0.0`", "—", "리스너 주소", []], ["grpc_transport.port", "정수", "운영자", "재시작", "숫자", "`17325`", "—", "리스너 포트", []], ["webrtc.connect_timeout_ms", "정수", "운영자", "재시작", "숫자", "`15000`", "켜져 있으면 ≥ 1", "연결 제한(ms)", []], ["webrtc.enabled", "켜기/끄기", "운영자", "재시작", "토글", "끔", "—", "서비스 터널의 WebRTC P2P 경로", []], ["webrtc.stun_servers", "목록", "운영자", "재시작", "목록", "—", "—", "STUN 서버", []], ["service_tunnels.enabled", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "Master에 선언된 터널을 로컬 노드가 연다 — 무엇을 열지는 Master가 정한다", []], ["service_tunnels.reconcile_interval_sec", "정수", "운영자", "재시작", "숫자", "—", "0 = 기본값", "선언 조회 주기(초)", []]], "secs": [{"name": "WireGuard", "keys": ["wireguard.address_cidr", "wireguard.advertise_endpoint", "wireguard.auto_install", "wireguard.auto_up", "wireguard.desired_sync_interval_sec", "wireguard.enabled", "wireguard.endpoint_refresh_interval_sec", "wireguard.install_policy", "wireguard.interface_name", "wireguard.listen_port", "wireguard.mode", "wireguard.mtu", "wireguard.nat_gateway", "wireguard.nat_mapping_lifetime_sec", "wireguard.nat_mapping_mode", "wireguard.nat_mapping_protocols", "wireguard.nat_probe_timeout_ms", "wireguard.persistent_keepalive_sec", "wireguard.private_key_path", "wireguard.privileged_helper_path", "wireguard.privileged_helper_timeout_sec", "wireguard.stun_servers", "wireguard.stun_timeout_ms"]}, {"name": "Mesh VPN", "keys": ["mesh_vpn.adapter", "mesh_vpn.advertise_host", "mesh_vpn.connect_timeout_ms", "mesh_vpn.enabled", "mesh_vpn.listen_host", "mesh_vpn.mode", "mesh_vpn.network_id", "mesh_vpn.peer_id", "mesh_vpn.port"]}, {"name": "직접 TCP", "keys": ["direct_tcp.advertise_host", "direct_tcp.connect_timeout_ms", "direct_tcp.enabled", "direct_tcp.listen_host", "direct_tcp.port"]}, {"name": "gRPC 전송", "keys": ["grpc_transport.advertise_host", "grpc_transport.connect_timeout_ms", "grpc_transport.enabled", "grpc_transport.listen_host", "grpc_transport.port"]}, {"name": "WebRTC", "keys": ["webrtc.connect_timeout_ms", "webrtc.enabled", "webrtc.stun_servers"]}, {"name": "서비스 터널", "keys": ["service_tunnels.enabled", "service_tunnels.reconcile_interval_sec"]}]}, {"name": "보안·API", "pre": "security · local_api · gateway_service", "keys": [["security.device_token_path", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra/token.json`", "—", "장치 토큰 파일", []], ["security.private_key_path", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra/keys/device_private.key`", "—", "장치 개인키 파일", []], ["security.public_key_path", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra/keys/device_public.key`", "—", "장치 공개키 파일", []], ["security.require_tls", "켜기/끄기", "운영자", "재시작", "토글", "켬", "prod·비개발 모드면 `master.url`이 `wss`·`https`여야 한다", "Master 연결에 TLS를 요구", []], ["local_api.auth_token_path", "문자열", "설치기", "재시작", "읽기 전용", "`~/.terra/local_api_token`", "—", "로컬 API 토큰 파일", []], ["local_api.bind_host", "문자열", "운영자", "재시작", "텍스트", "`127.0.0.1`", "prod에서 `0.0.0.0` 금지", "로컬 API 바인드 주소", []], ["local_api.enable_debug", "켜기/끄기", "운영자", "재시작", "토글", "끔", "—", "`/debug/*` 경로 켜기", []], ["local_api.enabled", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "로컬 API 켜기 — Gateway·CLI가 이것으로 데몬에 닿는다", []], ["local_api.port", "정수", "운영자", "재시작", "숫자", "`17321`", "1 ~ 65535. 생성 엔드포인트 표와 묶여 있다(§9-8)", "로컬 API 포트", []], ["local_api.require_auth", "켜기/끄기", "운영자", "재시작", "토글", "켬", "prod에서 끌 수 없다", "로컬 API에 토큰 요구", []], ["local_api.shutdown_timeout_sec", "정수", "운영자", "재시작", "숫자", "`5`", "≥ 1", "종료 대기(초)", []], ["gateway_service.addr", "문자열", "운영자", "재시작", "텍스트", "`127.0.0.1:8787`", "생성 엔드포인트 표와 묶여 있다(§9-8)", "Gateway 주소", []], ["gateway_service.binary_path", "문자열", "설치기", "재시작", "읽기 전용", "—", "비면 데몬 옆", "Gateway 실행 파일 경로", []], ["gateway_service.dev_open", "켜기/끄기", "운영자", "재시작", "토글", "—", "운영에서 켜지 않는다", "모든 호출자에게 모든 권한 — **개발 전용**", []], ["gateway_service.enabled", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "로컬 노드의 Gateway를 띄운다", []], ["gateway_service.ipc", "문자열", "파생", "재시작", "읽기 전용", "—", "비면 데이터 디렉터리에서 파생", "모듈 게시 IPC 주소", []], ["gateway_service.master_service_credential", "문자열", "비밀", "재시작", "숨김", "(숨김)", "API로 못 바꾼다", "Gateway의 Core-peer 자격", []]], "secs": [{"name": "보안 자격", "keys": ["security.device_token_path", "security.private_key_path", "security.public_key_path", "security.require_tls"]}, {"name": "로컬 API", "keys": ["local_api.auth_token_path", "local_api.bind_host", "local_api.enable_debug", "local_api.enabled", "local_api.port", "local_api.require_auth", "local_api.shutdown_timeout_sec"]}, {"name": "Gateway", "keys": ["gateway_service.addr", "gateway_service.binary_path", "gateway_service.dev_open", "gateway_service.enabled", "gateway_service.ipc", "gateway_service.master_service_credential"]}]}, {"name": "모듈·업데이트", "pre": "modules · 배포 · core · fleet", "keys": [["modules.allow_tree_override", "켜기/끄기", "설치기", "재시작", "읽기 전용", "—", "—", "이미지에 구운 모듈과 Tree 배포본이 겹치면 Tree 쪽을 살린다 — 이미지 빌드 결정", []], ["modules.auto_start", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "발견한 모듈을 자동 기동", []], ["modules.directories", "목록", "설치기", "재시작", "읽기 전용", "—", "—", "모듈을 찾는 디렉터리", []], ["modules.enabled", "켜기/끄기", "설치기", "재시작", "읽기 전용", "켬", "켜면 `modules.directories` 필수", "모듈 호스트를 이 설치가 가졌는가", []], ["modules.gateway_ipc", "문자열", "파생", "재시작", "읽기 전용", "—", "비면 데이터 디렉터리에서 파생", "Gateway에 route를 게시하는 IPC 주소", []], ["modules.managed_directories", "목록", "설치기", "재시작", "읽기 전용", "—", "—", "Tree 배포가 설치하는 디렉터리", []], ["modules.max_restarts", "정수", "운영자", "재시작", "숫자", "`3`", "≥ 0", "모듈 최대 재시작 횟수", []], ["modules.require_executable_hash", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "모듈 실행 파일 해시 검사", []], ["modules.rescan_interval_sec", "정수", "운영자", "재시작", "숫자", "—", "0 = 시작 때 한 번", "모듈 디렉터리 재스캔 주기(초)", []], ["modules.restart_backoff_ms", "정수", "운영자", "재시작", "숫자", "`1000`", "≥ 0", "모듈 재시작 간격(ms)", []], ["modules.state_dir", "문자열", "설치기", "재시작", "읽기 전용", "—", "—", "설치 기록 디렉터리", []], ["modules.stop_timeout_sec", "정수", "운영자", "재시작", "숫자", "`10`", "≥ 1 (모듈 호스트가 켜져 있을 때)", "모듈 정지 대기(초)", []], ["modules.strict_module_signing", "켜기/끄기", "운영자", "재시작", "토글", "끔", "—", "서명 없는 모듈도 격리 — Terra 서명 모듈만 돈다", []], ["module_distribution.allow_dev_install", "켜기/끄기", "운영자", "재시작", "토글", "—", "—", "서명 없는(개발 신뢰) 패키지 자동 설치 허용 — 시험대 전용", []], ["module_distribution.disk_quota_mb", "정수", "운영자", "재시작", "숫자", "—", "0 = 무제한", "관리 모듈 디스크 상한(MB)", []], ["module_distribution.enabled", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "Tree의 모듈 배포를 받는다", []], ["module_distribution.poll_interval_sec", "정수", "운영자", "재시작", "숫자", "—", "0 = Tree가 보낸 lease 주기(최소 60초)", "배포 조회 주기(초)", []], ["core_distribution.allow_apply", "켜기/끄기", "운영자", "재시작", "토글", "—", "—", "코어 교체 허용 — 끄면 바이트만 받고 교체는 손으로", []], ["core_distribution.disk_quota_mb", "정수", "운영자", "재시작", "숫자", "`4096`", "0 = 무제한", "스테이징 디스크 상한(MB)", []], ["core_distribution.enabled", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "코어 릴리스를 받아 스테이징한다", []], ["core_distribution.hold", "켜기/끄기", "운영자", "재시작", "토글", "—", "—", "스테이징을 거부한다 — 거부 사실은 Tree에 보고된다", []], ["core_distribution.hold_reason", "문자열", "운영자", "재시작", "텍스트", "—", "비면 기본 문구", "거부 사유", []], ["core_distribution.maintenance_window", "문자열", "운영자", "재시작", "텍스트", "—", "`HH:MM-HH:MM` 로컬 시각, 자정 넘김 가능. 비면 언제든", "릴리스 적용을 허용하는 시간대", []], ["core_distribution.poll_interval_sec", "정수", "운영자", "재시작", "숫자", "—", "0 = 기본값", "조회 주기(초)", []], ["core_distribution.role", "문자열", "운영자", "재시작", "텍스트", "—", "비면 `terra`(통합 번들)", "받을 릴리스 번들", []], ["fleet_host.docker_binary", "문자열", "운영자", "재시작", "텍스트", "—", "비면 PATH", "docker CLI 경로", []], ["fleet_host.enabled", "켜기/끄기", "설치기", "재시작", "읽기 전용", "끔", "—", "Fleet 컨테이너 호스트 역할", []], ["fleet_host.poll_interval_sec", "정수", "운영자", "재시작", "숫자", "—", "0 = 30초", "조회 주기(초)", []], ["fleet_host.stop_timeout_sec", "정수", "운영자", "재시작", "숫자", "—", "—", "`docker stop` 대기(초)", []]], "secs": [{"name": "모듈", "keys": ["modules.allow_tree_override", "modules.auto_start", "modules.directories", "modules.enabled", "modules.gateway_ipc", "modules.managed_directories", "modules.max_restarts", "modules.require_executable_hash", "modules.rescan_interval_sec", "modules.restart_backoff_ms", "modules.state_dir", "modules.stop_timeout_sec", "modules.strict_module_signing"]}, {"name": "모듈 배포", "keys": ["module_distribution.allow_dev_install", "module_distribution.disk_quota_mb", "module_distribution.enabled", "module_distribution.poll_interval_sec"]}, {"name": "코어 업데이트", "keys": ["core_distribution.allow_apply", "core_distribution.disk_quota_mb", "core_distribution.enabled", "core_distribution.hold", "core_distribution.hold_reason", "core_distribution.maintenance_window", "core_distribution.poll_interval_sec", "core_distribution.role"]}, {"name": "Fleet 호스트", "keys": ["fleet_host.docker_binary", "fleet_host.enabled", "fleet_host.poll_interval_sec", "fleet_host.stop_timeout_sec"]}]}, {"name": "런타임", "pre": "task_queue · feature", "keys": [["task_queue.default_timeout_sec", "정수", "운영자", "재시작", "숫자", "`300`", "≥ 1", "작업 기본 제한 시간(초)", []], ["task_queue.max_queue_size", "정수", "운영자", "재시작", "숫자", "`1024`", "≥ 1", "대기열 최대 길이", []], ["task_queue.max_retry_count", "정수", "운영자", "재시작", "숫자", "`3`", "≥ 0", "재시도 횟수", []], ["task_queue.worker_count", "정수", "운영자", "재시작", "숫자", "`4`", "≥ 1", "동시에 도는 작업 수", []], ["feature.enable_docker", "켜기/끄기", "운영자", "재시작", "토글", "끔", "—", "Docker 기능", []], ["feature.enable_experimental", "켜기/끄기", "운영자", "재시작", "토글", "끔", "—", "실험 기능", []], ["feature.enable_io_gateway", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "I/O 게이트웨이 기능", []], ["feature.enable_screen_share", "켜기/끄기", "운영자", "재시작", "토글", "끔", "—", "화면 공유 기능", []], ["feature.enable_svi", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "SVI 기능", []], ["feature.enable_svi_test_stream", "켜기/끄기", "운영자", "재시작", "토글", "켬", "—", "SVI 시험 스트림 자원 — 발견만 되고 여는 데는 Grant가 필요하다", []]], "secs": [{"name": "작업 큐", "keys": ["task_queue.default_timeout_sec", "task_queue.max_queue_size", "task_queue.max_retry_count", "task_queue.worker_count"]}, {"name": "기능 플래그", "keys": ["feature.enable_docker", "feature.enable_experimental", "feature.enable_io_gateway", "feature.enable_screen_share", "feature.enable_svi", "feature.enable_svi_test_stream"]}]}];
    // 라벨은 명사형 용어로 — 문서의 뜻(mean) 문장은 ⓘ · 설명 줄에 남긴다
    this.LABEL = {"daemon.capabilities": "광고 capability 목록", "daemon.environment": "실행 환경", "daemon.node_id": "노드 id (Master 발급)", "daemon.roles": "노드 역할 목록", "logging.file_enabled": "파일 로그", "logging.max_backups": "이전 로그 보관 수", "logging.max_size_mb": "로그 파일 최대 크기(MB)", "master.reconnect": "자동 재연결", "master.url": "상위 Master 주소", "enrollment.enabled": "등록 기능", "enrollment.image_digest": "부팅 이미지 digest", "enrollment.instance_key": "Fleet 인스턴스 키", "enrollment.join_code_path": "Fleet 가입 코드 파일", "enrollment.state_path": "등록 상태 파일", "daemon.co_located_master.base_url": "동일 호스트 Master 주소", "daemon.co_located_master.request_timeout_sec": "동일 호스트 Master 요청 제한(초)", "daemon.co_located_master.service_credential": "동일 호스트 Master Core-peer 자격", "wireguard.address_cidr": "mesh 주소 (CIDR)", "wireguard.advertise_endpoint": "광고 endpoint", "wireguard.desired_sync_interval_sec": "desired 동기화 주기(초)", "wireguard.enabled": "WireGuard 통합", "wireguard.install_policy": "설치 정책", "wireguard.auto_up": "인터페이스 자동 up", "wireguard.nat_gateway": "NAT 매핑 게이트웨이", "wireguard.nat_mapping_lifetime_sec": "NAT 매핑 수명(초)", "wireguard.nat_mapping_mode": "NAT 포트 매핑 방식", "wireguard.nat_mapping_protocols": "NAT 매핑 프로토콜", "wireguard.nat_probe_timeout_ms": "NAT 탐침 제한(ms)", "wireguard.stun_servers": "STUN 서버", "wireguard.mode": "운영 방식", "wireguard.private_key_path": "개인키 파일", "mesh_vpn.advertise_host": "광고 주소", "mesh_vpn.enabled": "Mesh VPN endpoint 광고", "mesh_vpn.connect_timeout_ms": "연결 제한(ms)", "mesh_vpn.listen_host": "리스너 주소", "mesh_vpn.mode": "운영 방식", "mesh_vpn.network_id": "네트워크 id", "mesh_vpn.peer_id": "peer id", "mesh_vpn.port": "리스너 포트", "mesh_vpn.adapter": "어댑터", "direct_tcp.advertise_host": "광고 주소", "direct_tcp.enabled": "직접 TCP 리스너 (TLS · route ticket)", "grpc_transport.advertise_host": "광고 주소", "grpc_transport.enabled": "gRPC 전송 리스너", "webrtc.enabled": "WebRTC P2P 경로", "service_tunnels.enabled": "선언 터널 자동 열기", "service_tunnels.reconcile_interval_sec": "선언 조회 주기(초)", "security.require_tls": "Master 연결 TLS 필수", "local_api.enable_debug": "`/debug/*` 경로", "local_api.enabled": "로컬 API", "local_api.require_auth": "로컬 API 토큰 인증", "local_api.shutdown_timeout_sec": "종료 대기(초)", "gateway_service.dev_open": "개발용 전체 개방", "gateway_service.enabled": "Gateway 실행", "gateway_service.ipc": "모듈 게시 IPC 주소", "modules.allow_tree_override": "Tree 배포본 우선", "modules.auto_start": "모듈 자동 기동", "modules.directories": "모듈 탐색 디렉터리", "modules.enabled": "모듈 호스트", "modules.gateway_ipc": "Gateway route 게시 IPC 주소", "modules.managed_directories": "Tree 배포 설치 디렉터리", "modules.state_dir": "설치 기록 디렉터리", "modules.strict_module_signing": "엄격한 모듈 서명 검사", "module_distribution.allow_dev_install": "개발 신뢰 패키지 자동 설치", "module_distribution.enabled": "Tree 모듈 배포 수신", "core_distribution.enabled": "코어 릴리스 수신 · 스테이징", "core_distribution.hold": "스테이징 보류", "core_distribution.hold_reason": "보류 사유", "core_distribution.maintenance_window": "적용 허용 시간대", "core_distribution.role": "릴리스 번들", "fleet_host.enabled": "Fleet 컨테이너 호스트", "task_queue.worker_count": "동시 작업 수", "task_queue.max_retry_count": "최대 재시도 횟수"};
    this.KEY = {};
    this.GROUPS.forEach((g, gi) => g.keys.forEach((k) => { this.KEY[k[0]] = { key: k[0], type: k[1], owner: k[2], apply: k[3], ctrl: k[4], dflt: k[5], rule: k[6], mean: k[7], opts: k[8], group: gi }; }));
    const dv = (k) => { const d = this.KEY[k].dflt.replace(/`/g, ''); if (this.KEY[k].type === '켜기/끄기') return d === '켬'; if (d === '—' || d === '(숨김)' || d === '""') return ''; return d; };
    const cur = {}; Object.keys(this.KEY).forEach((k) => { cur[k] = dv(k); });
    // 예시 노드 edge-01의 런타임 값 (config.get)
    Object.assign(cur, {
      'daemon.device_name': 'edge-01', 'daemon.node_id': 'node_7f3a91c2', 'daemon.roles': 'leaf', 'daemon.capabilities': 'command, file, svi, io',
      'daemon.co_located_master.service_credential': '***', 'gateway_service.master_service_credential': '***',
      'master.url': 'wss://tree-home.local:8443', 'enrollment.image_digest': '', 'heartbeat.interval_sec': '15', 'logging.level': 'debug',
      'wireguard.enabled': true, 'wireguard.mode': 'managed', 'wireguard.address_cidr': '10.60.0.11/24', 'wireguard.private_key_path': '~/.terra/wireguard/terra0.key',
      'wireguard.privileged_helper_path': '/usr/lib/terra/terra-net-helper', 'mesh_vpn.enabled': true, 'mesh_vpn.mode': 'managed', 'mesh_vpn.network_id': 'net_home', 'mesh_vpn.peer_id': 'node_7f3a91c2', 'mesh_vpn.advertise_host': '10.60.0.11',
      'modules.directories': '~/.terra/modules', 'modules.managed_directories': '~/.terra/modules/managed', 'modules.state_dir': '~/.terra/modules/state', 'modules.gateway_ipc': '~/.terra/gateway.sock', 'gateway_service.ipc': '~/.terra/gateway.sock',
      'storage.shared_dirs': '~/TerraShare, ~/Camera'
    });
    // 설치 기준선과 달라진 운영자 키 (config.get의 deviations[])
    this.DEV = { 'logging.level': 'info', 'heartbeat.interval_sec': '10', 'storage.shared_dirs': '~/TerraShare' };
    // 설정창이 자기 접속 경로를 끊는 키 (§8.2 CAUTION)
    this.DANGER = {
      'gateway_service.enabled': [false, 'Daemon이 Gateway를 띄우지 않습니다 — 재시작 뒤 현재 GUI가 붙을 곳이 사라집니다.'],
      'local_api.enabled': [false, 'Gateway가 Daemon에 닿지 못합니다 — 재시작 뒤 terra.daemon.* 호출이 전부 실패합니다.'],
      'gateway_service.dev_open': [true, '끊기는 것이 아니라 모든 호출자에게 모든 권한이 열립니다. 개발 전용입니다.'],
      'gateway_service.addr': [null, '셸 · CLI는 생성 엔드포인트 표의 주소로 Gateway를 찾습니다 — 바꾸면 런처가 로컬 노드를 못 찾습니다.'],
      'local_api.port': [null, 'Gateway · CLI가 생성 엔드포인트 표의 포트로 Daemon을 찾습니다 — 바꾸면 닿지 못합니다.']
    };
    this.state = {
      role: 'leaf', perm: true, demo: 'ok', tab: 'node', group: 0, q: '', filter: 'all', cur, draft: {}, pending: {}, errors: {}, open: {}, dlg: null, toasts: [], saving: false,
      help: this.readHelp(), winOp: this.readWinOp(),
      prefs: { start: '노드 화면', refresh: '10초' },
      grants: [{ id: 'grt_31', agent: 'claude-agent', level: 'read', nodes: 'edge-01', exp: '21:40' }],
      // 사용자 관리(M-1) · 첫 로그인 마무리(O-3) · 이 노드의 등록 상태(O-6) — 예시 값. 서비스는 Master · Daemon 응답으로 바꾼다
      me: 'admin@example.com', usersState: 'ok',
      users: [
        { id: 'u_admin', email: 'admin@example.com', name: '관리자', type: 'master_admin', status: 'active', perms: this.DEFAULT_PERMS.concat(['node.config']) },
        { id: 'u_minji', email: 'minji@example.com', name: '민지', type: 'cluster_user', status: 'active', perms: this.DEFAULT_PERMS.slice() },
        { id: 'u_ci', email: 'ci-bot@example.com', name: 'CI 봇', type: 'cluster_user', status: 'disabled', perms: this.DEFAULT_PERMS.slice() }
      ],
      uf: null, firstDone: this.readFirstDone(),
      enrSt: { state: 'ok', registered: true, nodeId: 'node_7f3a91c2', deviceId: 'dev_edge01', masterUrl: 'https://tree.example.com', registeredAt: '2026-10-02 14:03', credentialReady: true, fleet: '' }
    };
  }
  componentWillUnmount() { (this._ts || []).forEach(clearTimeout); try { window.removeEventListener('storage', this._onStore); } catch (e) { /* 무시 */ } }
  // 이너 도움말 — "…입니다" 같은 회색 설명 글. 끄면 숨기고 ⓘ(마우스를 올리면 전체)로만 남긴다.
  // GUI 선호라서 현재 브라우저에만 저장한다(localStorage). 다른 보드는 storage 이벤트로 바로 따라온다
  readHelp() { try { const v = window.localStorage.getItem('terra.gui.innerHelp'); return v === '1'; } catch (e) { return false; } }
  readFirstDone() { try { return window.localStorage.getItem('terra.gui.firstRunDone') === '1'; } catch (e) { return false; } }
  writeFirstDone(v) { try { if (v) window.localStorage.setItem('terra.gui.firstRunDone', '1'); else window.localStorage.removeItem('terra.gui.firstRunDone'); } catch (e) { /* 저장 못 해도 이 화면에서는 바로 닫힌다 */ } this.setState({ firstDone: !!v }); }
  // 사용자 관리(M-1): 한 곳으로 모은 호출 — act = create | patch | password. 이 판은 화면 안에서만 바꾸고, 서비스는 이 메서드 하나를 Master 호출로 바꿔 끼운다
  async userApi(act, a) {
    const U = this.state.users.map((x) => Object.assign({}, x));
    if (act === 'create') {
      if (U.some((x) => x.email.toLowerCase() === a.email.toLowerCase())) return { ok: false, msg: '이미 등록된 이메일입니다 (EMAIL_IN_USE)' };
      U.push({ id: 'u_' + Math.random().toString(36).slice(2, 8), email: a.email, name: a.display_name || '', type: a.user_type || 'cluster_user', status: 'active', perms: this.DEFAULT_PERMS.slice() });
    } else if (act === 'patch') {
      const u = U.find((x) => x.id === a.id); if (!u) return { ok: false, msg: '사용자를 찾지 못했습니다 (USER_NOT_FOUND)' };
      if (a.status) u.status = a.status; if (a.permissions) u.perms = a.permissions.slice();
    } else if (act === 'password') { if (!U.some((x) => x.id === a.id)) return { ok: false, msg: '사용자를 찾지 못했습니다 (USER_NOT_FOUND)' }; }
    this.setState({ users: U }); return { ok: true };
  }
  ufSet(patch) { this.setState({ uf: Object.assign({}, this.state.uf, patch, { msg: patch.msg != null ? patch.msg : '' }) }); }
  userForm(mode, u) {
    const base = { mode, id: u ? u.id : '', who: u ? u.email : '', busy: false, msg: '' };
    this.setState({ uf: mode === 'new' ? Object.assign(base, { email: '', name: '', pw: '', type: 'cluster_user' })
      : mode === 'perm' ? Object.assign(base, { perms: (u.perms || []).filter((x) => this.KNOWN_PERMS.indexOf(x) >= 0), extra: (u.perms || []).filter((x) => this.KNOWN_PERMS.indexOf(x) < 0).join(', ') })
      : Object.assign(base, { pw: '' }) });
  }
  async userSubmit() {
    const f = this.state.uf; if (!f || f.busy) return;
    const fail = (msg) => this.setState({ uf: Object.assign({}, this.state.uf, { busy: false, msg }) });
    let act, a;
    if (f.mode === 'new') {
      if (!/^[^@\s]+@[^@\s]+$/.test(String(f.email || '').trim())) return fail('이메일을 입력하세요');
      if (String(f.pw || '').length < 8) return fail('비밀번호는 8자 이상이어야 합니다');
      act = 'create'; a = { email: f.email.trim(), password: f.pw, display_name: String(f.name || '').trim() || undefined, user_type: f.type };
    } else if (f.mode === 'perm') {
      const extra = String(f.extra || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      act = 'patch'; a = { id: f.id, permissions: Array.from(new Set((f.perms || []).concat(extra))) };
    } else {
      if (String(f.pw || '').length < 8) return fail('비밀번호는 8자 이상이어야 합니다');
      act = 'password'; a = { id: f.id, password: f.pw };
    }
    this.setState({ uf: Object.assign({}, f, { busy: true, msg: '' }) });
    const r = await this.userApi(act, a);
    if (!r || !r.ok) return fail((r && r.msg) || '하지 못했습니다');
    this.setState({ uf: null });
    this.toast('●', '#3ecf8e', f.mode === 'new' ? '사용자를 만들었습니다' : f.mode === 'perm' ? '권한을 저장했습니다' : '비밀번호를 다시 정했습니다', f.mode === 'new' ? a.email : f.who);
  }
  userToggle(u) {
    const to = u.status === 'active' ? 'disabled' : 'active';
    this.setState({ dlg: { title: to === 'disabled' ? u.email + ' 계정을 끌까요?' : u.email + ' 계정을 다시 켤까요?', op: 'terra.master.admin.users.by-user-id.patch { status: ' + to + ' }',
      rows: [['계정', u.email], ['유형', u.type], ['바뀌는 값', 'status → ' + to]],
      warn: to === 'disabled' ? '계정을 끄면 로그인할 수 없고 열린 세션도 이어지지 않습니다. 문서는 지워지지 않으며 다시 켜면 그대로 돌아옵니다. SVI 허가는 따로 회수해야 합니다.' : '', okLabel: to === 'disabled' ? '끄기' : '켜기',
      ok: async () => { const r = await this.userApi('patch', { id: u.id, status: to }); if (r && r.ok) this.toast('●', '#3ecf8e', to === 'disabled' ? '계정을 껐습니다' : '계정을 켰습니다', u.email); else this.toast('■', '#ff6b81', '하지 못했습니다', (r && r.msg) || ''); } } });
  }
  // 첫 로그인 마무리(O-3): Tree를 처음 쓰는 최초(bootstrap) 관리자에게 — 사용자가 이 계정 하나뿐이고 아직 닫지 않았을 때만
  firstRunCards() {
    const S = this.state, U = S.users;
    if (S.firstDone || S.usersState !== 'ok' || !(U.length === 1 && U[0].type === 'master_admin')) return [];
    return [this.card({ span: 12, title: '첫 로그인 마무리', sub: '최초(bootstrap) 관리자 · 두 가지가 남았다', acts: [this.btn('이 안내 닫기', () => this.writeFirstDone(true))], rows: [
      this.row('일상용 계정 만들기', 'bootstrap 관리자(master_admin)는 설치가 만든 최상위 계정이다. 일상 작업은 별도 계정으로 하고, 이 계정은 계정 관리 · 복구용으로 남겨 둔다', '남음', { badges: [this.tag('권장', 'warn')], btns: [this.btn('+ 사용자 만들기', () => this.userForm('new'), { primary: true })] }),
      this.row('bootstrap 자격 파일 정리', 'Windows 마법사가 암호를 만들었다면 Tree 데이터 위치의 bootstrap-password 파일에 남아 있다. 암호를 안전한 곳에 옮긴 뒤 그 파일을 지운다 — 이 화면에서는 지울 수 없다. Linux는 --admin-password-file로 준 파일, compose는 .env의 TERRA_ADMIN_PASSWORD도 같다', '이 화면 밖', { badges: [this.tag('파일 · CLI', 'off')] })
    ] })];
  }
  usersCard() {
    const S = this.state, U = S.users;
    if (S.usersState === 'loading') return this.stateCard('rotate', '#9aa1ab', '사용자를 불러오는 중…', '잠시만 기다리세요.');
    if (S.usersState === 'denied') return this.stateCard('lock', '#f5b83d', '사용자 관리는 master_admin만', '이 계정은 사용자 유형이 master_admin이 아니라 사용자 목록을 볼 수 없습니다 (FORBIDDEN). 관리자 계정으로 로그인하세요.');
    if (S.usersState === 'error') return this.stateCard('lock', '#ff6b81', '사용자 목록을 받지 못했습니다', 'Master에 닿지 않았거나 이 Gateway에 사용자 관리 길(terra.master.admin.users.*)이 없습니다. 새로고침해 보세요.');
    const rows = U.map((u) => {
      const self = u.email === S.me, off = u.status !== 'active', badges = [];
      badges.push(this.tag(u.type, u.type === 'master_admin' ? 'vio' : 'info', u.type === 'master_admin' ? '관리자는 권한이 아니라 사용자 유형' : '일상용 계정'));
      if (self) badges.push(this.tag('나', 'ok'));
      if (off) badges.push(this.tag('꺼짐', 'off', '로그인할 수 없다 — 문서는 그대로 있고 다시 켜면 돌아온다'));
      if ((u.perms || []).indexOf('node.config') < 0) badges.push(this.tag('node.config★ 없음', 'warn', 'Daemon 설정 쓰기는 권한 목록에 명시해야 열린다'));
      return this.row(u.email, [u.name, '권한 ' + (u.perms || []).length].filter(Boolean).join(' · '), off ? 'disabled' : 'active', { tmono: true, op: off ? 0.6 : 1, badges,
        btns: [this.btn('권한', () => this.userForm('perm', u)), this.btn('암호 재설정', () => this.userForm('pw', u)),
          this.btn(off ? '켜기' : '끄기', () => this.userToggle(u), { danger: !off, dis: self && !off, tip: self && !off ? '자기 계정은 끌 수 없다 (SELF_DISABLE_NOT_ALLOWED)' : '' })] });
    });
    return this.card(Object.assign({ span: 12, title: '사용자 · 권한', sub: 'admin.users.* · master_admin 유형만 · ' + U.length + '명', acts: [this.btn('+ 사용자', () => this.userForm('new'), { primary: true })], rows }, this.userFormCard()));
  }
  // 이 노드의 등록 상태(O-6): 이 기계의 Daemon이 어느 Tree에 속했나
  enrollCard() {
    const E = this.state.enrSt;
    if (E.state === 'none') return this.stateCard('link', '#9aa1ab', '이 Gateway엔 Daemon 등록 정보가 없습니다', 'tree만 설치한 기계이거나 Daemon에 닿지 않았습니다. 등록 상태는 Daemon(terra.daemon.enrollment.status.get)이 압니다.');
    const ok = !!E.registered;
    return this.card({ span: 12, title: '이 노드의 등록 상태', sub: 'terra.daemon.enrollment.status.get', rows: [
      this.row('등록', ok ? '이 기계는 Tree에 등록되어 있다' : '아직 어느 Tree에도 속하지 않았다 — 시작 화면에서 등록 코드로 등록한다', ok ? '등록됨' : '미등록', { badges: [this.tag(ok ? 'registered' : 'not registered', ok ? 'ok' : 'warn')] }),
      ...(ok ? [
        this.row('노드 ID', 'Master가 발급한 노드 번호', E.nodeId || '—', { mono: true, help: true }),
        this.row('장치 ID', '이 기계의 장치 번호', E.deviceId || '—', { mono: true, help: true }),
        this.row('Master 주소', '이 노드가 보고하는 Tree', E.masterUrl || '—', { mono: true, help: true }),
        this.row('등록한 때', '', E.registeredAt || '—', { help: true }),
        this.row('Gateway 자격', 'Gateway가 Master 인증으로 다시 뜰 수 있나', E.credentialReady ? '준비됨' : '없음', { badges: [this.tag(E.credentialReady ? 'ready' : 'missing', E.credentialReady ? 'ok' : 'bad')], vc: E.credentialReady ? '#3ecf8e' : '#ff6b81' }),
        ...(E.fleet ? [this.row('Fleet', 'Fleet 가입 코드로 등록한 노드', E.fleet, { mono: true })] : [])] : []),
      this.row('해제 · 다른 Tree로 옮기기', 'Daemon에는 등록을 푸는 길이 없다. 노드 제거는 Tree 쪽에서 한다 — 해제 절차는 아직 정해지지 않았다', '없음', { help: true, vc: '#9aa1ab', badges: [this.tag('API 없음', 'off')] })
    ] });
  }
  // 사용자 카드의 입력 묶음 (uf가 열려 있을 때)
  userFormCard() {
    const f = this.state.uf; if (!f) return {};
    const set = (k) => (e) => this.ufSet({ [k]: e.target.value });
    const title = f.mode === 'new' ? '새 사용자' : f.mode === 'perm' ? f.who + ' — 권한' : f.who + ' — 비밀번호 다시 정하기';
    let fields;
    if (f.mode === 'new') fields = [
      { key: 'email', label: '이메일 *', span: 1, isIn: true, type: 'email', v: f.email, ph: 'name@example.com', set: set('email') },
      { key: 'name', label: '표시 이름', span: 1, isIn: true, type: 'text', v: f.name, ph: '비우면 이메일', set: set('name') },
      { key: 'pw', label: '초기 비밀번호 * (8자 이상)', span: 1, isIn: true, type: 'password', v: f.pw, ph: '1회용으로 전하고 첫 로그인 뒤 바꾸게 한다', set: set('pw') },
      { key: 'type', label: '사용자 유형', span: 1, isSel: true, set: set('type'), opts: [['cluster_user', 'cluster_user — 일상용'], ['master_admin', 'master_admin — 계정 관리자']].map(([v, t]) => ({ v, t, sel: f.type === v ? 'selected' : null })) }];
    else if (f.mode === 'perm') fields = [
      { key: 'perms', label: '권한 — 누르면 켜고 끈다 (Master는 값을 검사하지 않고 저장한다)', span: 2, isChips: true, chips: this.KNOWN_PERMS.map((v) => { const on = f.perms.indexOf(v) >= 0, star = this.DEFAULT_PERMS.indexOf(v) < 0;
        return { v, on: on ? 'true' : 'false', tip: star ? '기본 권한 밖 — 명시해야 열린다' : '기본 권한', bg: on ? 'rgba(237,233,225,0.14)' : 'transparent', fg: on ? '#ede9e1' : '#9aa1ab', line: on ? '#ede9e1' : 'rgba(255,255,255,0.18)',
          run: () => this.ufSet({ perms: on ? f.perms.filter((x) => x !== v) : f.perms.concat([v]) }) }; }) },
      { key: 'extra', label: '그 밖의 권한 (쉼표로 나눔 — 사전에 없는 이름도 그대로 저장된다)', span: 2, isIn: true, type: 'text', v: f.extra, ph: '예: module.manage', set: set('extra') }];
    else fields = [{ key: 'pw', label: '새 비밀번호 (8자 이상)', span: 2, isIn: true, type: 'password', v: f.pw, ph: '', set: set('pw') }];
    return { hasForm: true, formId: f.mode, formTitle: title, fields, fmsg: f.msg, fmsgDisp: f.msg ? 'block' : 'none', fcancel: () => this.setState({ uf: null }), fok: () => this.userSubmit(),
      fokLabel: f.busy ? '보내는 중…' : f.mode === 'new' ? '만들기' : '저장', fbusy: f.busy ? 'true' : 'false', fop: f.busy ? 0.6 : 1 };
  }
  readWinOp() { try { const v = parseInt(window.localStorage.getItem('terra.gui.winOpacity'), 10); return v >= 30 && v <= 100 ? v : 64; } catch (e) { return 64; } }
  writeWinOp(v) { v = Math.max(30, Math.min(100, Math.round(v))); try { window.localStorage.setItem('terra.gui.winOpacity', String(v)); } catch (e) { /* 저장 못 해도 이 화면에서는 바뀐다 */ } this.setState({ winOp: v }); }
  writeHelp(on) { try { window.localStorage.setItem('terra.gui.innerHelp', on ? '1' : '0'); } catch (e) { /* 저장 못 해도 이 화면에서는 바뀐다 */ } this.setState({ help: on }); }
  componentDidMount() { this._onStore = (e) => { if (e.key === 'terra.gui.innerHelp') this.setState({ help: e.newValue === '1' }); if (e.key === 'terra.gui.winOpacity') this.setState({ winOp: this.readWinOp() }); }; try { window.addEventListener('storage', this._onStore); } catch (e) { /* 무시 */ } }

  // Daemon 재시작 (terra.daemon.restart.post): 첫 누름 = 확인 준비(5초), 둘째 = 실행. 예시는 바로 끝난 것으로. 서비스가 doRestart를 바꿔 끼운다
  restartDaemon() {
    const S = this.state; if (S.restarting) return;
    if (!S.restartArm) { this.setState({ restartArm: true }); clearTimeout(this._raT); this._raT = setTimeout(() => this.setState({ restartArm: false }), 5000); return; }
    this.setState({ restartArm: false, restarting: true });
    this.doRestart().then((r) => {
      this.setState({ restarting: false });
      if (r && r.ok === false) { this.toast('■', '#ff6b81', '재시작하지 못했습니다', r.msg || ''); return; }
      this.setState({ pending: {} }); this.toast('●', '#4ade80', 'Daemon을 다시 시작했습니다', '실행 중인 값을 다시 읽었습니다 (config.get)');
    });
  }
  async doRestart() { await new Promise((r) => setTimeout(r, 900)); return { ok: true }; }
  later(ms, f) { this._ts = this._ts || []; this._ts.push(setTimeout(f, ms)); }
  toast(g, c, title, text) { const id = Math.random(); this.setState({ toasts: this.state.toasts.concat([{ id, g, c, title, text }]).slice(-3) }); this.later(4500, () => this.setState({ toasts: this.state.toasts.filter((t) => t.id !== id) })); }
  val(k) { const d = this.state.draft; return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : this.state.cur[k]; }
  // 초안 검증 — Validate()의 조합 규칙(§2.6)을 옮긴 것. 최종 판정은 PATCH의 400
  check() {
    const v = (k) => this.val(k), num = (k) => Number(v(k)), E = {};
    const url = String(v('master.url'));
    if (!url) E['master.url'] = '필수입니다';
    else if (!/^(ws|wss|http|https):\/\//.test(url)) E['master.url'] = 'ws · wss · http · https 절대 URL이어야 합니다';
    else if (v('security.require_tls') && v('daemon.environment') === 'prod' && v('daemon.runtime_mode') !== 'dev' && !/^(wss|https):/.test(url)) E['master.url'] = 'prod + require_tls면 wss · https만 됩니다';
    if (v('daemon.environment') === 'prod') {
      if (v('local_api.bind_host') === '0.0.0.0') E['local_api.bind_host'] = 'prod에서 0.0.0.0은 안 됩니다';
      if (!v('local_api.require_auth')) E['local_api.require_auth'] = 'prod에서는 끌 수 없습니다';
    }
    if (!(num('heartbeat.timeout_sec') >= 1 && num('heartbeat.timeout_sec') <= num('heartbeat.interval_sec'))) E['heartbeat.timeout_sec'] = '1 이상, heartbeat 주기(' + v('heartbeat.interval_sec') + ') 이하';
    if (num('master.reconnect_max_delay_ms') < num('master.reconnect_initial_delay_ms')) E['master.reconnect_max_delay_ms'] = '첫 대기(' + v('master.reconnect_initial_delay_ms') + ') 이상이어야 합니다';
    if (v('direct_tcp.enabled')) {
      const a = String(v('direct_tcp.advertise_host'));
      if (!a || a === '0.0.0.0' || a === '::') E['direct_tcp.advertise_host'] = 'direct_tcp를 켜려면 다른 노드가 붙을 주소가 필요합니다 (0.0.0.0 · :: 불가)';
      const p = num('direct_tcp.port'); if (!(p >= 1 && p <= 65535)) E['direct_tcp.port'] = '1 ~ 65535';
    }
    if (v('wireguard.enabled')) {
      const m = num('wireguard.mtu'); if (!(m === 0 || m >= 576)) E['wireguard.mtu'] = '0 또는 576 이상';
      if (v('wireguard.nat_mapping_mode') === 'auto' && !String(v('wireguard.nat_mapping_protocols')).trim()) E['wireguard.nat_mapping_protocols'] = 'auto면 1개 이상';
      if (v('wireguard.nat_mapping_mode') === 'auto' && num('wireguard.nat_mapping_lifetime_sec') < 60) E['wireguard.nat_mapping_lifetime_sec'] = 'auto면 60 이상';
    }
    Object.keys(this.state.draft).forEach((k) => { const K = this.KEY[k]; if (K.type === '정수' && !/^-?\d+$/.test(String(this.state.draft[k]))) E[k] = '정수여야 합니다'; });
    return E;
  }
  // PATCH 순서: 선행 값 → *.enabled (§2.6 · §9-1 — 한 번에 보내면 순서가 무작위이고 부분 반영될 수 있다)
  order(keys) { return keys.filter((k) => !/\.enabled$/.test(k)).concat(keys.filter((k) => /\.enabled$/.test(k))); }
  save(force) {
    const S = this.state, keys = Object.keys(S.draft), E = this.check();
    if (Object.keys(E).length) { this.setState({ errors: E }); this.toast('■', '#ff5d5d', '저장하지 않았습니다 — 초안 검사 ' + Object.keys(E).length + '건', '키 옆의 빨간 문장을 고치세요. 최종 판정은 데몬이 합니다(PATCH 400).'); return; }
    const danger = keys.filter((k) => this.DANGER[k] && (this.DANGER[k][0] === null || this.DANGER[k][0] === S.draft[k]));
    if (danger.length && !force) {
      this.setState({ dlg: { title: '저장 시 현재 화면의 접속 경로가 끊길 수 있습니다', op: 'terra.daemon.config.patch · save: true', rows: danger.map((k) => [k, String(S.draft[k])]), warn: danger.map((k) => this.DANGER[k][1]).join(' '), okLabel: '그래도 저장', ok: () => this.save(true) } });
      return;
    }
    const ord = this.order(keys);
    this.setState({ saving: true, errors: {} });
    this.later(900, () => {
      const cur = Object.assign({}, this.state.cur), pending = Object.assign({}, this.state.pending), now = [];
      ord.forEach((k) => { if (this.KEY[k].apply === '즉시') now.push(k); else pending[k] = { from: cur[k], to: this.state.draft[k] }; cur[k] = this.state.draft[k]; });
      this.setState({ saving: false, cur, pending, draft: {} });
      this.toast('●', '#3ecf8e', '저장됨 — PATCH ' + ord.length + '번 (save: true)', (now.length ? '즉시 반영: ' + now.join(', ') + '. ' : '') + (ord.length - now.length ? '재시작 대기 ' + (ord.length - now.length) + '키' : ''));
    });
  }
  tag(t, tone, tip) { const T = { ok: ['rgba(62,207,142,0.10)', '#3ecf8e'], warn: ['rgba(245,184,61,0.10)', '#f5b83d'], bad: ['rgba(255,93,93,0.10)', '#ff5d5d'], info: ['rgba(122,167,255,0.10)', '#7aa7ff'], off: ['rgba(255,255,255,0.04)', '#9aa1ab'], vio: ['rgba(180,140,255,0.10)', '#b48cff'] }[tone]; return { t, bg: T[0], fg: T[1], tip: tip || '' }; }
  btn(label, run, o) { o = o || {}; const d = o.danger; return { label, run: o.dis ? () => {} : run, tip: o.tip || '', dis: o.dis ? 'true' : 'false', cur: o.dis ? 'not-allowed' : 'pointer', op: o.dis ? 0.5 : 1, line: d ? 'rgba(255,93,93,0.45)' : o.primary ? '#ede9e1' : 'rgba(255,255,255,0.18)', bg: o.primary ? '#ede9e1' : 'rgba(255,255,255,0.04)', fg: d ? '#ff5d5d' : o.primary ? '#111111' : '#ede9e1', cls: o.primary ? 'pri' : 'ghost' }; }
  card(o) { const H = this.state.help; return Object.assign({ subDisp: H ? 'inline' : 'none', showText: !!o.text && (H || !!o.big), span: 12, headDisp: o.title ? 'flex' : 'none', title: '', sub: '', acts: [], rows: [], hasText: !!o.text, text: '', textPad: '12px 14px', textAlign: 'left', iconDisp: 'none', icon: '', iconBg: '#9aa1ab', bigDisp: 'none', big: '', hasCode: !!(o.code && o.code.length), code: [], hasForm: false, formId: '', formTitle: '', fields: [], fmsg: '', fmsgDisp: 'none', fmsgC: '#ff6b81', fcancel: () => {}, fok: () => {}, fokLabel: '', fbusy: 'false', fop: 1 }, o); }
  row(t, d, v, o) { o = o || {}; const hide = o.help && !this.state.help; return { dDisp: d && !hide ? 'block' : 'none', t, d: d || '', v: v == null ? '' : String(v), vc: o.vc || '#ede9e1', vcls: o.mono ? 'mono' : '', cls: o.tmono ? 'mono' : '', hasSl: !!o.sl, slV: o.sl ? o.sl.v : 0, slSet: o.sl ? o.sl.set : null, slPrev: o.sl ? 'rgba(13,15,19,' + (o.sl.v / 100) + ')' : '', badges: o.badges || [], btns: o.btns || [], op: o.op == null ? 1 : o.op }; }
  stateCard(icon, bg, big, text) { return this.card({ hasText: true, subDisp: 'inline', showText: true, text, big, bigDisp: 'block', icon, iconBg: bg, iconDisp: 'flex', textPad: '40px 24px', textAlign: 'center' }); }
  // 키 한 줄 — 상태 9가지(§8.2)
  keyRow(k) {
    const S = this.state, K = this.KEY[k], v = this.val(k), drafted = Object.prototype.hasOwnProperty.call(S.draft, k), pend = S.pending[k], err = S.errors[k] || (drafted ? this.check()[k] : null);
    const locked = !S.perm && K.owner === '운영자', dev = this.DEV[k] != null && String(S.cur[k]) !== String(this.DEV[k]);
    const endpointBound = k === 'gateway_service.addr' || k === 'local_api.port';
    const badges = [];
    badges.push(K.apply === '즉시' ? this.tag('즉시', 'ok', '저장하면 바로 반영') : this.tag('재시작 후', 'off', '저장 뒤 Daemon 재시작해야 반영'));
    if (K.owner === '설치기') badges.push(this.tag('설치기', 'vio', '설치가 놓은 값 — 복구하면 되돌아간다'));
    if (K.owner === '파생') badges.push(this.tag('파생', 'info', '등록 · Master · 다른 키가 정한다 — 다음 동기화가 덮는다'));
    if (K.owner === '비밀') badges.push(this.tag('비밀', 'bad', 'API로 못 바꾼다'));
    if (dev) badges.push(this.tag('설치값과 다름', 'warn', 'deviations[] — 기준선 ' + this.DEV[k]));
    if (drafted) badges.push(this.tag('수정됨 · 미저장', 'info'));
    if (pend) badges.push(this.tag('재시작 대기', 'warn'));
    if (this.DANGER[k]) badges.push(this.tag('접속 경로', 'bad', '현재 GUI가 돌아올 길과 관계된 키'));
    const r = { isKey: true, isFold: false, isHead: false, key: k, label: this.LABEL[k] || K.mean.split(' — ')[0], badges, labelFg: '#ede9e1',
      edge: err ? '#ff5d5d' : drafted ? '#7aa7ff' : pend ? '#f5b83d' : 'transparent', bg: err ? 'rgba(255,93,93,0.06)' : drafted ? 'rgba(122,167,255,0.06)' : 'transparent',
      noteFull: [this.LABEL[k] ? K.mean.split(' — ')[0] : '', K.mean.indexOf(' — ') > 0 ? K.mean.split(' — ').slice(1).join(' — ') : '', K.rule && K.rule !== '—' ? K.rule.replace(/`/g, '') : ''].filter(Boolean).join(' · '),
      note: err ? '⚠ ' + err : [this.LABEL[k] ? K.mean.split(' — ')[0] : '', K.mean.indexOf(' — ') > 0 ? K.mean.split(' — ').slice(1).join(' — ') : '', K.rule && K.rule !== '—' ? K.rule.replace(/`/g, '') : ''].filter(Boolean).join(' · '), noteFg: err ? '#ff7a7a' : '#9aa1ab',
      isToggle: false, isSelect: false, isInput: false, isMulti: false, isRO: false, val: '', line: err ? '#ff5d5d' : drafted ? '#7aa7ff' : 'rgba(255,255,255,0.18)',
      sub: '', subDisp: 'none', subFg: '#9aa1ab', actDisp: 'none', actLabel: '', act: () => {}, roIcon: '', roTip: '' };
    const set = (nv) => { const d = Object.assign({}, this.state.draft); if (String(nv) === String(this.state.cur[k])) delete d[k]; else d[k] = nv; const e = Object.assign({}, this.state.errors); delete e[k]; this.setState({ draft: d, errors: e }); };
    const ro = (icon, tip) => { r.isRO = true; r.val = v === '' ? '(비어 있음)' : String(v); r.roIcon = icon; r.roTip = tip; };
    if (K.owner === '비밀') { ro('shield', 'API로 못 바꾼다 — 값은 *** 로만 온다'); r.val = '***'; r.sub = '값을 숨김 · 편집 없음'; r.subDisp = 'inline'; }
    else if (K.owner === '설치기') { ro('box', '설치가 놓은 값'); r.sub = '재설치 · 복구로 바꾼다'; r.subDisp = 'inline'; }
    else if (K.owner === '파생') { ro('down', '누가 정하나'); r.sub = /^wireguard\.|^mesh_vpn\./.test(k) ? 'Master 네트워크 계획이 정한다' : /node_id|roles/.test(k) ? '등록 · 설치 구성요소가 정한다' : '다른 키에서 파생된다'; r.subDisp = 'inline'; }
    else if (locked) { ro('lock', 'node.config 필요'); r.sub = 'node.config★ 권한이 없어 잠김 — 관리자가 권한 목록에 넣어야 열린다'; r.subDisp = 'inline'; r.subFg = '#f5b83d'; }
    else if (endpointBound) { ro('link', '생성 엔드포인트 표와 묶여 있다'); r.sub = '운영자 키지만 읽기 전용 권장 — 바꾸면 런처가 못 찾는다'; r.subDisp = 'inline'; r.actDisp = 'inline'; r.actLabel = '그래도 편집'; r.act = () => set(v); }
    else if (K.ctrl === '토글') { r.isToggle = true; r.onA = v ? 'true' : 'false'; r.onText = v ? '켬' : '끔'; r.track = v ? '#ede9e1' : 'rgba(255,255,255,0.08)'; r.knobC = v ? '#111111' : '#9aa1ab'; r.knob = v ? '17px' : '1px'; r.flip = () => set(!v); }
    else if (K.ctrl === '선택') { r.isSelect = true; r.opts = K.opts.map((o) => ({ v: o, sel: String(v) === o ? 'selected' : null })); r.set = (e) => set(e.target.value); }
    else if (K.ctrl === '다중 선택') { r.isMulti = true; const cur = String(v).split(',').map((x) => x.trim()).filter(Boolean); r.chips = K.opts.map((o) => { const on = cur.indexOf(o) >= 0; return { v: o, on: on ? 'true' : 'false', bg: on ? 'rgba(237,233,225,0.12)' : 'rgba(255,255,255,0.02)', line: on ? '#ede9e1' : 'rgba(255,255,255,0.14)', fg: on ? '#ede9e1' : '#9aa1ab', pick: () => set((on ? cur.filter((x) => x !== o) : cur.concat([o])).join(', ')) }; }); }
    else { r.isInput = true; r.val = String(v); r.set = (e) => set(e.target.value); const n = K.type === '정수'; r.w = n ? '120px' : K.ctrl === '목록' ? '300px' : '240px'; r.align = n ? 'right' : 'left'; r.ph = K.ctrl === '목록' ? '쉼표로 나눔' : K.dflt === '—' ? '비어 있음' : ''; }
    // 이너 도움말이 꺼져 있으면: 설명 · 이유 문장을 숨기고 라벨 옆 ⓘ에 모은다 (오류 · 상태 문장은 남긴다)
    r.subHelp = r.subDisp === 'inline';
    if (dev && !drafted && !locked && K.owner === '운영자') { r.actDisp = 'inline'; r.actLabel = '설치값 복원 (' + this.DEV[k] + ')'; r.act = () => set(this.DEV[k]); }
    if (pend && !err) { r.sub = '실행 중 ' + (pend.from === '' ? '(비어 있음)' : String(pend.from)) + ' → 파일 ' + String(pend.to); r.subDisp = 'inline'; r.subFg = '#f5b83d'; }
    if (drafted && K.apply === '즉시' && !err) { r.sub = '저장하면 바로 반영'; r.subDisp = 'inline'; r.subFg = '#3ecf8e'; }
    const H = S.help;
    if (!H && !err) { r.tip = [r.noteFull, r.subHelp && !pend && !(drafted && K.apply === '즉시') ? r.sub : ''].filter(Boolean).join(' — '); r.note = ''; }
    else r.tip = '';
    if (!H && r.subHelp && !pend && !(drafted && K.apply === '즉시')) r.subDisp = 'none';
    r.noteDisp = r.note ? 'inline' : 'none'; r.tipDisp = r.tip ? 'inline-flex' : 'none';
    return r;
  }
  nodeRows() {
    const S = this.state, q = S.q.trim().toLowerCase(), F = S.filter;
    const pass = (k) => { const K = this.KEY[k]; if (F === 'edit' && K.owner !== '운영자') return false; if (F === 'dev' && !(this.DEV[k] != null && String(S.cur[k]) !== String(this.DEV[k])) && !S.draft.hasOwnProperty(k) && !S.pending[k]) return false; return true; };
    const rows = [];
    if (q || F !== 'all') {
      this.GROUPS.forEach((g) => g.secs.forEach((sc) => { const ks = sc.keys.filter((k) => pass(k) && (!q || k.toLowerCase().indexOf(q) >= 0 || this.KEY[k].mean.indexOf(S.q.trim()) >= 0)); if (ks.length) { rows.push(this.head(g.name + ' › ' + sc.name, ks.length)); ks.forEach((k) => rows.push(this.keyRow(k))); } }));
      return rows;
    }
    // 분류 하나 = 섹션 여러 개. 섹션마다 머리 줄을 두고, 그 안에서 스위치 아래로 접는다 — prefix.enabled가 꺼져 있으면 같은 prefix의 나머지를 접는다 (§8.1)
    const g = this.GROUPS[S.group];
    g.secs.forEach((sc, si) => {
      const keys = sc.keys;
      rows.push(this.head(sc.name, keys.length, 'sec-' + si));
      const sw = {}; keys.forEach((k) => { const m = /^(.+)\.enabled$/.exec(k); if (m && keys.filter((x) => x.indexOf(m[1] + '.') === 0).length > 2) sw[m[1]] = k; });
      const pre = (k) => Object.keys(sw).find((p) => k.indexOf(p + '.') === 0 && k !== sw[p]);
      const shown = {};
      Object.keys(sw).sort((a, b) => keys.indexOf(sw[a]) - keys.indexOf(sw[b])).forEach((p) => {
        rows.push(this.keyRow(sw[p]));
        const rest = keys.filter((k) => pre(k) === p), on = !!this.val(sw[p]), open = on || S.open[p];
        if (!on) rows.push({ isFold: true, isKey: false, isHead: false, arrow: open ? '▾' : '▸', text: sw[p] + ' 꺼짐 — 하위 ' + rest.length + '키 ' + (open ? '표시 중' : '접힘'), toggle: () => this.setState({ open: Object.assign({}, S.open, { [p]: !S.open[p] }) }) });
        if (open) rest.forEach((k) => rows.push(this.keyRow(k)));
        rest.forEach((k) => { shown[k] = 1; }); shown[sw[p]] = 1;
      });
      keys.filter((k) => !shown[k]).forEach((k) => rows.push(this.keyRow(k)));
    });
    return rows;
  }
  head(text, n, id) { return { isHead: true, isKey: false, isFold: false, text, n: String(n) + '키', hid: id || '' }; }
  renderVals() {
    const S = this.state, leaf = S.role === 'leaf';
    const TABS = [
      { id: 'general', icon: 'gear', label: '일반', role: '로컬 기기', sub: 'GUI 환경설정 — 브라우저에만', avail: true },
      { id: 'gui', icon: 'gear', label: 'GUI · 창', role: '로컬 기기', sub: '창 불투명도 · 유리 효과', avail: true },
      { id: 'account', icon: 'user', label: '계정', role: '∀', sub: 'whoami · 로그아웃 · 위임 자격', avail: true },
      { id: 'node', icon: 'cpu', label: '로컬 노드', role: 'L', sub: 'Daemon 설정 135키 · 6분류', avail: leaf },
      { id: 'res', icon: 'box', label: '로컬 자원', role: 'L', sub: '공유 폴더 · SVI · I/O · 모듈 동의', avail: leaf },
      { id: 'cluster', icon: 'tree', label: '클러스터', role: 'T', sub: '사용자 · 네트워크 · 배포 정책', avail: !leaf },
      { id: 'server', icon: 'archive', label: '서버', role: 'T', sub: 'Master 설정 — API 없음', avail: !leaf }
    ];
    const cur = TABS.find((t) => t.id === S.tab) || TABS[0];
    const nDraft = Object.keys(S.draft).length, nPend = Object.keys(S.pending).length;
    const tabs = TABS.map((t) => { const on = t.id === cur.id;
      return { icon: t.icon, label: t.label, role: t.role, sub: t.avail ? t.sub : (leaf ? 'tree GUI에서만 — terra.master.* 없음' : 'leaf GUI에서만 — terra.daemon.* 없음'), cur: on ? 'page' : 'false', bg: on ? 'rgba(255,255,255,0.07)' : 'transparent', ring: on ? 'rgba(255,255,255,0.14)' : 'transparent', fg: t.avail ? '#ede9e1' : '#6b7280', subFg: t.avail ? '#9aa1ab' : '#6b7280',
        tint: on ? 'rgba(240,166,58,0.12)' : 'rgba(255,255,255,0.04)', tintLine: on ? 'rgba(240,166,58,0.5)' : 'rgba(255,255,255,0.10)', ic: on ? '#f0a63a' : t.avail ? '#b4bac3' : '#6b7280', gray: t.avail ? 'none' : 'grayscale(1)',
        roleFg: t.role === 'L' ? '#5aa8ff' : t.role === 'T' ? '#f0a63a' : '#9aa1ab', roleLine: t.role === 'L' ? 'rgba(90,168,255,0.5)' : t.role === 'T' ? 'rgba(240,166,58,0.5)' : 'rgba(255,255,255,0.18)',
        subDisp: S.help || !t.avail ? 'block' : 'none', dot: t.id === 'node' ? String(nDraft + nPend) : '', dotDisp: t.id === 'node' && nDraft + nPend ? 'inline-block' : 'none', pick: () => this.setState({ tab: t.id }) }; });
    let title = cur.label, sub = '', chips = [], cards = [], keyRows = [], showKeys = false, showGrp = false, bar = false;
    const demoBlock = () => {
      if (S.demo === 'unreach') return this.stateCard('warn', '#ff5d5d', 'Gateway에 닿지 못했습니다', '현재 GUI를 서빙한 Gateway가 응답하지 않습니다(unreachable). 설정을 읽을 수도 쓸 수도 없습니다. 로컬 기기의 Terra가 실행 중인지 확인하세요.');
      if (S.demo === 'anon' && cur.id !== 'general') return this.stateCard('key', '#7aa7ff', '로그인이 필요합니다', '설정은 읽기에도 node.read가 필요합니다 — 로그인 전(anonymous)에는 값을 보여 줄 수 없습니다. "일반" 탭의 로컬 기기 선호만 바꿀 수 있습니다.');
      if (S.demo === 'unenrolled' && (cur.id === 'node' || cur.id === 'res')) return this.stateCard('link', '#f5b83d', '로컬 노드는 Master에 등록되지 않았습니다', '세션 상태 unavailable — Daemon 설정 자체를 읽지 못합니다. 등록은 GUI 버튼이 아니라 로컬 기기에서 terra daemon enroll 명령(또는 설치 마법사)으로 합니다.');
      return null;
    };
    const blocked = demoBlock();
    if (blocked) cards = [blocked];
    else if (!cur.avail) cards = [this.stateCard('lock', '#9aa1ab', cur.label + ' 탭은 로컬 노드에서 서지 않습니다', leaf ? '현재 GUI는 leaf(edge-01)의 Gateway가 서빙합니다. 카탈로그에 terra.master.*가 없어 클러스터 정책과 tree 서버 안내를 그릴 수 없습니다 — tree 노드의 GUI에서 여세요. (탭은 역할을 선언하지 않고 catalog로 관측해 연다)' : '현재 GUI는 tree(tree-home)의 Gateway가 서빙합니다. 카탈로그에 terra.daemon.config.*가 없습니다 — tree에서 leaf의 Daemon 설정을 바꾸는 API는 없습니다. 해당 노드의 GUI에서 여세요.')];
    else if (cur.id === 'general') {
      sub = 'Terra 설정이 아니라 현재 브라우저 · 현재 셸의 설정 — 노드가 아니라 기기마다 따로';
      const P = S.prefs, cyc = (k, list) => () => { const i = list.indexOf(P[k]); this.setState({ prefs: Object.assign({}, P, { [k]: list[(i + 1) % list.length] }) }); };
      const HO = S.help;
      cards = [this.card({ title: 'GUI 환경설정', sub: 'Scene persistent Store · API 없음', rows: [
        this.row('이너 도움말', '회색 설명 글을 보여 준다. 끄면 ⓘ에 마우스를 올려야 보인다 — 오류 · 상태 · 경고는 늘 보인다', HO ? '켬' : '끔', { badges: [this.tag('모든 화면', 'info', '노드 화면 · 네트워크 · 설정에 바로 적용')], btns: [this.btn(HO ? '끄기' : '켜기', () => { this.writeHelp(!HO); this.toast('●', '#3ecf8e', '이너 도움말 ' + (!HO ? '켬' : '끔'), '현재 브라우저의 모든 Terra 화면에 적용됩니다'); }, { primary: !HO })] }),
        this.row('시작 화면', 'GUI를 열면 처음 보이는 화면', P.start, { help: true, btns: [this.btn('바꾸기', cyc('start', ['노드 화면', '네트워크', '설정']))] }),
        this.row('자동 새로 고침 주기', '폴링 화면의 기본 주기 — tree 화면은 대부분 폴링이다', P.refresh, { help: true, btns: [this.btn('바꾸기', cyc('refresh', ['5초', '10초', '30초', '끔']))] }),
        this.row('언어', '셸(호스트)이 정한다 — 없으면 브라우저 언어', '한국어 (셸)', { help: true, vc: '#9aa1ab', badges: [this.tag('셸 지정', 'off')] }),
        this.row('라이트 · 다크', 'OS의 prefers-color-scheme 하나 — 수동 전환이 없다', 'OS 따름', { help: true, vc: '#9aa1ab', badges: [this.tag('OS 지정', 'off')] }),
        this.row('연결 대상', '셸이 자기 노드의 Gateway를 연다', leaf ? '127.0.0.1:8787' : '127.0.0.1:8788', { help: true, mono: true, vc: '#9aa1ab', badges: [this.tag('셸 지정', 'off')] })
      ] })];
    } else if (cur.id === 'gui') {
      sub = 'Terra 설정이 아니라 현재 브라우저의 GUI 설정 — 노드 화면의 모든 창에 바로 적용된다';
      const V = S.winOp, setV = (v) => this.writeWinOp(v);
      cards = [this.card({ title: '창', sub: 'Scene persistent Store · API 없음', rows: [
        this.row('창 불투명도', '숫자가 낮을수록 창 뒤의 맵이 더 비친다. 100%는 완전히 불투명 — 창 제목줄 왼쪽의 물방울 버튼으로 창마다 잠깐 끄고 켤 수도 있다 (그 창만 100%)', V + '%', { badges: [this.tag('모든 창', 'info', '일반 창 · 전체 화면 창 · 조타륜 앱 창')], sl: { v: V, set: (e) => setV(+e.target.value) }, btns: [this.btn('기본값 64%', () => setV(64))] }),
        this.row('빠른 선택', '자주 쓰는 값', '', { help: true, btns: [30, 50, 64, 80, 100].map((n) => this.btn(n + '%', () => setV(n), { primary: V === n })) }),
        this.row('전환', '불투명도를 켜고 끌 때 값이 한 번에 바뀌지 않고 약 0.5초 동안 일정한 속도로 바뀐다', '선형 0.5초', { help: true, vc: '#9aa1ab', badges: [this.tag('고정', 'off')] })
      ] })];
    } else if (cur.id === 'account') {
      sub = 'terra.gateway.agent.whoami.get · auth.credentials.* · agent.grants.*';
      const perms = ['node.read', 'node.control', 'process.execute', 'file.read', 'file.write', 'relay.use', 'module.publish', 'agent.use', 'agent.grant'].concat(S.perm ? ['node.config'] : []);
      cards = [
        this.card({ span: 7, title: '세션 정보', sub: 'whoami', acts: [this.btn('로그아웃', () => this.toast('●', '#3ecf8e', '로그아웃 — auth.credentials.delete', '자격 핸들을 폐기했습니다 (시연)'), { danger: true })], rows: [
          this.row('admin', 'principal · 사용자 유형 master_admin', '만료 21:40', { tmono: true, mono: true, badges: [this.tag('master_admin', 'vio', '관리자는 권한이 아니라 사용자 유형')] }),
          this.row('권한', perms.join(' · '), perms.length + '개', { mono: true, badges: S.perm ? [this.tag('node.config★ 있음', 'ok')] : [this.tag('node.config★ 없음', 'warn', '관리자라도 Daemon 설정 쓰기는 권한 목록에 명시해야 열린다')] }),
          this.row('reach', '현재 세션이 닿는 노드', leaf ? 'edge-01 (로컬 노드)' : 'home 클러스터 8노드', { mono: true, help: true }),
          this.row('비밀번호 변경', '자기 비밀번호를 바꾸는 operation이 없다 — 관리자 재설정만', '없음', { help: true, vc: '#9aa1ab', badges: [this.tag('API 없음', 'off')] })
        ] }),
        this.card({ span: 5, title: '에이전트 위임 자격', sub: 'agent.grants.*', acts: [this.btn('+ 발급', () => this.setState({ dlg: { title: '에이전트에게 자격을 발급할까요?', op: 'terra.gateway.agent.grants.post', rows: [['agent', 'claude-agent'], ['level', 'read'], ['nodes', leaf ? 'edge-01' : 'tree-home 외 7'], ['만료', '세션과 같이 21:40']], warn: '위임 자격은 위험 동작입니다. 발급한 동안 에이전트가 이 권한으로 노드를 부를 수 있습니다.', okLabel: '발급', ok: () => { this.setState({ grants: this.state.grants.concat([{ id: 'grt_' + Math.floor(Math.random() * 90 + 10), agent: 'claude-agent', level: 'read', nodes: leaf ? 'edge-01' : '8노드', exp: '21:40' }]) }); this.toast('●', '#3ecf8e', '발급됨', 'agent.grants.post'); } } }), { primary: true })],
          rows: S.grants.map((g) => this.row(g.agent, g.id + ' · ' + g.nodes + ' · 만료 ' + g.exp, g.level, { mono: true, badges: [this.tag(g.level, 'info')], btns: [this.btn('회수', () => this.setState({ grants: this.state.grants.filter((x) => x.id !== g.id) }), { danger: true })] })) }),
        this.enrollCard()
      ];
    } else if (cur.id === 'node') {
      showKeys = true; showGrp = true; bar = true;
      const g = this.GROUPS[S.group];
      title = S.q || S.filter !== 'all' ? '로컬 노드 — 찾기' : g.name;
      sub = 'terra.daemon.config.* · edge-01 · ~/.terra/terra-daemon.config.json';
      const own = { 운영자: 0, 설치기: 0, 파생: 0, 비밀: 0 }; g.keys.forEach((k) => { own[k[2]]++; });
      chips = S.q || S.filter !== 'all' ? [] : [this.tag(g.keys.length + '키', 'off'), this.tag('편집 ' + own['운영자'], 'ok'), this.tag('설치기 ' + own['설치기'], 'vio'), this.tag('파생 ' + own['파생'], 'info')].concat(own['비밀'] ? [this.tag('비밀 ' + own['비밀'], 'bad')] : []).concat(!S.perm ? [this.tag('권한 잠김', 'warn', 'node.config★ 없음 — 읽기만')] : []);
      keyRows = this.nodeRows();
    } else if (cur.id === 'res') {
      sub = '설정 파일 밖 — 로컬 자원 · 정책 (leaf Gateway operation)';
      cards = [
        this.card({ span: 6, title: '공유 폴더', sub: 'config.patch storage.shared_dirs · 재시작 필요', acts: [this.btn('로컬 노드 › 저장소에서 편집', () => this.setState({ tab: 'node', group: 0, q: '' }))], rows: String(S.cur['storage.shared_dirs']).split(',').map((d) => this.row(d.trim(), 'io.terra.file이 여는 루트', '', { tmono: true })) }),
        this.card({ span: 6, title: 'SVI 자원 선언', sub: 'svi.declarations.* · 재시작 없이 반영', acts: [this.btn('dry_run으로 확인', () => this.toast('◇', '#7aa7ff', 'apply — dry_run', '하나라도 거절되면 아무것도 적용하지 않습니다 · 거절 0')), this.btn('적용', () => this.toast('●', '#3ecf8e', '적용됨 — 재시작 없이', 'svi.declarations.apply.post'), { primary: true, dis: !S.perm, tip: S.perm ? '' : 'node.config★ 필요' })], rows: [
          this.row('camera.front', '장치 · /dev/video0', 'declared', { mono: true, badges: [this.tag('declared', 'ok')] }), this.row('sensor.hub', '장치 · /dev/ttyUSB0', 'declared', { mono: true, badges: [this.tag('declared', 'ok')] }), this.row('share.inbox', '폴더 · ~/TerraShare/inbox', 'undeclared', { mono: true, op: 0.6, badges: [this.tag('undeclared', 'off')] })] }),
        this.card({ span: 7, title: 'I/O 장치', sub: 'io.devices.* · io.terra.io-inventory 모듈 의존 — 없으면 503', rows: [
          this.row('USB Camera (046d:0825)', '승인됨 · 별칭 camera.front', 'enabled', { badges: [this.tag('approved', 'ok')], btns: [this.btn('끄기', () => this.toast('●', '#3ecf8e', '장치 끔', 'io.devices.disable'))] }),
          this.row('CP2102 USB-UART', '새 장치 — 결정 전', 'pending', { badges: [this.tag('new', 'info')], btns: [this.btn('승인', () => this.toast('●', '#3ecf8e', '승인됨', 'io.devices.approve')), this.btn('거부', () => this.toast('●', '#9aa1ab', '거부됨', 'io.devices.deny'), { danger: true })] })] }),
        this.card({ span: 5, title: '모듈 설치 동의', sub: 'modules.offers.* — Tree가 제안한 모듈', rows: [
          this.row('io.terra.file', 'v1.4.2 · recommended', '동의함', { mono: true, tmono: true, badges: [this.tag('consented', 'ok')], btns: [this.btn('철회', () => this.toast('●', '#9aa1ab', '동의 철회 — 중지 · 제거', 'modules.offers.withdraw'), { danger: true })] }),
          this.row('io.terra.screen', 'v0.9.0 · available', '대기', { tmono: true, badges: [this.tag('offered', 'info')], btns: [this.btn('동의', () => this.toast('●', '#3ecf8e', '동의 — 설치 · 기동', 'modules.offers.consent'))] })] }),
        this.card({ span: 12, text: 'WireGuard 관리형 키 · 설정은 설정이라기보다 동작(위험 · 확인 필요)이라 네트워크 화면의 "로컬 WireGuard"에 둡니다. SVI의 목록형 선언과 런타임 상한(svi.runtime)은 스키마 밖 — 파일로만 편집합니다.' })
      ];
    } else if (cur.id === 'cluster') {
      sub = 'tree Gateway · Master API — 설정 "키"가 아니라 레코드를 만들고 고친다';
      cards = [
        ...this.firstRunCards(),
        this.usersCard(),
        this.card({ span: 12, title: '클러스터', sub: 'admin.clusters.*', rows: [this.row('home', 'environment prod', 'active', { tmono: true, badges: [this.tag('active', 'ok')], btns: [this.btn('수정', () => this.toast('◇', '#7aa7ff', '클러스터 수정', 'name · status · environment'))] })] }),
        this.card({ span: 12, title: '타 화면 소유 클러스터 정책', sub: '여기서는 목록과 길만', rows: [
          this.row('논리 네트워크 · IP 할당 · transport', 'network.* — 네트워크 화면 "사설망"', '2 네트워크', { btns: [this.btn('네트워크 화면 →', () => { if (typeof window !== 'undefined') window.location.href = 'network.html'; })] }),
          this.row('라우트 정책', 'route.policies.* — 네트워크 화면 "연결 진단"', '3 정책', { btns: [this.btn('네트워크 화면 →', () => { if (typeof window !== 'undefined') window.location.href = 'network.html'; })] }),
          this.row('서비스 터널 선언', 'service-tunnels.declarations.*', '2 선언'),
          this.row('SVI 접근 허가', 'svi.grants.* — subject · resource · operations · ttl', '4 허가'),
          this.row('모듈 배포 정책', '승인 상한 · 접두사 · 봉투(available·recommended·required) · 핀 · 롤아웃(1·10·50·100)', 'master_admin · module.publish'),
          this.row('코어 릴리스', 'core.releases.* rollout · apply · revoke', 'core.publish★', { badges: [this.tag('권한 잠김', 'warn', '기본 권한 밖')] })] })
      ];
    } else if (cur.id === 'server') {
      sub = 'tree의 Master config.json — 46키 · 전부 재시작 필요';
      cards = [
        this.stateCard('archive', '#b48cff', '이 설정은 tree 서버에서 CLI로 바꿉니다', 'Master 설정에는 HTTP API가 없어 이 화면은 값을 읽지도 못합니다. 경보 임계값 · TURN · 최초 계정 · tree 계층 · 모듈 호스트 · Gateway가 여기 있습니다. tree 기계에서 아래 명령을 쓰세요.'),
        this.card({ span: 12, title: 'terra master config', sub: 'tree 기계에서', hasCode: true, code: [
          { c: 'terra master config show', d: '지금 값 (비밀은 숨김)' }, { c: 'terra master config schema', d: '키 · 타입 · 소유 — 운영자 28 · 설치기 10 · 파생 4 · 비밀 4' },
          { c: 'terra master config get monitor.alerts.cpu_percent', d: '키 하나' }, { c: 'terra master config set monitor.alerts.cpu_percent 85', d: '바꾸기' },
          { c: 'terra master config validate', d: '검사' }, { c: 'terra master config save', d: '저장 — 그 뒤 Master 재시작' }] })
      ];
    }
    // 그룹 목록
    const grpItems = this.GROUPS.map((g, i) => { const ks = g.keys.map((x) => x[0]), on = i === S.group && !S.q && S.filter === 'all', ed = g.keys.filter((x) => x[2] === '운영자').length;
      return { name: g.name, meta: ks.length + '키 · 편집 ' + ed, secDisp: on ? 'flex' : 'none', secs: g.secs.map((sc, si) => ({ t: sc.name, n: String(sc.keys.length), go: () => { try { const el = document.getElementById('sec-' + si); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* 무시 */ } } })), bg: on ? 'rgba(255,255,255,0.07)' : 'transparent', ring: on ? 'rgba(255,255,255,0.14)' : 'transparent', fg: '#ede9e1', fw: on ? 700 : 500,
        draftDisp: ks.some((k) => S.draft.hasOwnProperty(k)) ? 'inline-block' : 'none', pendDisp: ks.some((k) => S.pending[k]) ? 'inline-block' : 'none', pick: () => this.setState({ group: i, q: '', filter: 'all' }) }; });
    const nDev = Object.keys(this.DEV).filter((k) => String(S.cur[k]) !== String(this.DEV[k])).length;
    const E = S.saving ? {} : this.check(), nErr = Object.keys(S.draft).filter((k) => E[k]).length;
    const ord = this.order(Object.keys(S.draft));
    return {
      hdr: { roleText: leaf ? 'edge-01 · leaf GUI' : 'tree-home · tree GUI', gwTip: leaf ? 'Gateway 127.0.0.1:8787' : 'Gateway 127.0.0.1:8788', roleBg: leaf ? 'rgba(90,168,255,0.10)' : 'rgba(240,166,58,0.10)', roleFg: leaf ? '#5aa8ff' : '#f0a63a', roleDot: leaf ? '#5aa8ff' : '#f0a63a',
        who: S.demo === 'anon' ? '로그인 전' : 'admin · 만료 21:40',
        roles: [['leaf', 'leaf에서 연 GUI'], ['tree', 'tree에서 연 GUI']].map(([k, label]) => ({ label, on: S.role === k ? 'true' : 'false', bg: S.role === k ? '#ede9e1' : 'transparent', fg: S.role === k ? '#111111' : '#9aa1ab', sh: S.role === k ? '0 1px 2px rgba(0,0,0,0.35)' : 'none', pick: () => this.setState({ role: k }) })),
        permOn: S.perm ? 'true' : 'false', permLabel: S.perm ? 'node.config★ 있음' : 'node.config★ 없음', permBg: S.perm ? 'rgba(62,207,142,0.10)' : 'rgba(245,184,61,0.10)', permFg: S.perm ? '#3ecf8e' : '#f5b83d', permLine: S.perm ? 'rgba(62,207,142,0.45)' : 'rgba(245,184,61,0.5)', togglePerm: () => this.setState({ perm: !S.perm }),
        demos: [['ok', '상태: 정상'], ['unreach', '상태: Gateway 미연결'], ['anon', '상태: 로그인 전'], ['unenrolled', '상태: 미등록 leaf']].map(([v, label]) => ({ v, label, sel: S.demo === v ? 'selected' : null })),
        setDemo: (e) => this.setState({ demo: e.target.value }) },
      helpBox: S.help ? 'block' : 'none',
      tabs,
      grp: { disp: showGrp && !blocked ? 'flex' : 'none', q: S.q, setQ: (e) => this.setState({ q: e.target.value }), items: grpItems,
        filters: [['all', '모두', 135], ['edit', '편집 가능', 96], ['dev', '변경된 값', nDev + nPend + nDraft]].map(([k, label, n]) => ({ label, n, on: S.filter === k ? 'true' : 'false', bg: S.filter === k ? '#ede9e1' : 'rgba(255,255,255,0.03)', fg: S.filter === k ? '#111111' : '#b4bac3', line: S.filter === k ? '#ede9e1' : 'rgba(255,255,255,0.12)', pick: () => this.setState({ filter: k }) })) },
      pend: { helpDisp: S.help ? 'inline' : 'none', show: !blocked && cur.id === 'node' && nPend > 0, n: nPend, keys: Object.keys(S.pending).join(' · '), done: () => this.restartDaemon(), label: S.restartArm ? '정말 재시작' : S.restarting ? '↻ 재시작 중…' : '↻ Daemon 재시작', bg: S.restartArm ? '#f5b83d' : 'rgba(255,255,255,0.04)', fg: S.restartArm ? '#111111' : '#f5b83d', line: S.restartArm ? '#f5b83d' : 'rgba(245,184,61,0.45)' },
      page: { title, sub, chips, subDisp: S.help && sub ? 'inline' : 'none' },
      keys: { show: showKeys && !blocked, rows: keyRows, empty: showKeys && !keyRows.length },
      cards: blocked || !showKeys ? cards : [],
      bar: { disp: bar && !blocked && (nDraft || S.saving) ? 'flex' : 'none', dot: nErr ? '#ff5d5d' : '#7aa7ff', fg: nErr ? '#ff7a7a' : '#ede9e1',
        title: S.saving ? 'PATCH 전송 중…' : nErr ? '수정 ' + nDraft + '키 · 초안 검사 ' + nErr + '건 실패' : '미저장 ' + nDraft + '키 · GUI 초안',
        order: '보내는 순서: ' + ord.join(' → ') + (ord.some((k) => /\.enabled$/.test(k)) ? '   (켜기 키는 마지막 — §2.6)' : ''),
        discard: () => this.setState({ draft: {}, errors: {} }), save: () => { if (!S.saving) this.save(false); }, saveLabel: S.saving ? '저장 중' : '저장 (save: true)', g: S.saving ? '⟳' : '', gDisp: S.saving ? 'inline-flex' : 'none', spin: S.saving ? 'spin' : '',
        dis: S.saving ? 'true' : 'false', cur: S.saving ? 'wait' : 'pointer', op: S.saving ? 0.7 : 1, btnBg: '#ede9e1', btnLine: '#ede9e1' },
      dlg: S.dlg ? { open: true, title: S.dlg.title, op: S.dlg.op, rows: S.dlg.rows.map(([k, v]) => ({ k, v })), warn: S.dlg.warn, okLabel: S.dlg.okLabel, cancel: () => this.setState({ dlg: null }), ok: () => { const f = S.dlg.ok; this.setState({ dlg: null }); f(); } }
        : { open: false, title: '', op: '', rows: [], warn: '', okLabel: '', cancel: () => {}, ok: () => {} },
      toasts: S.toasts
    };
  }
}
