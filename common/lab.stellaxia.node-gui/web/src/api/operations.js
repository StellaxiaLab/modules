// 화면 기능 ↔ Gateway operation 대응표.
// 화면은 operationId만 안다 — 호출은 client.invoke(opId, input) 한 곳을 지난다 (docs/api/backend-integration.md §2)
//   where: 'L' = leaf Gateway(Daemon terra.daemon.*), 'T' = tree Gateway(Master terra.master.*), '∀' = 양쪽(terra.gateway.*), 'M' = 모듈 namespace
//   perm : 라우트 권한 (★ = 기본 권한 밖). SVI 핸들은 라우트가 node.read여도 자원별 허가가 진짜 문이다
//   resp : 'now' 즉시 · 'job' 202 뒤 비동기(작업 링) · 'stream' WebSocket/SSE
//   verify: true = 원본 문서에서 operationId 표기를 확인하지 못했다 (코드 세션에서 catalog로 확인)
// 원본: terra-gui-resource-inventory(자원 목록) · terra-gui-api-priority(GUI API 우선순위)

const L = (op) => 'terra.daemon.' + op;
const T = (op) => 'terra.master.' + op;
const G = (op) => 'terra.gateway.' + op;
const FILE = (op) => 'io.terra.file.' + op;   // 모듈 op — 원격 노드는 Gateway /api/nodes/{node}/modules/io.terra.file/v1/... 경유

/** 조타륜 앱 10개 — 목록(list) · 동작(acts). acts의 키는 화면 hbAct(app, id, op)의 op와 같다 */
export const HELM_APPS = {
  svi: {
    name: 'SVI 자원', see: 'node.read',
    list: { op: T('svi.resources.get'), where: 'T', perm: 'node.read', resp: 'now', input: { node_id: '<노드>', limit: 100 } },
    extra: [{ op: T('svi.grants.get'), where: 'T', perm: 'node.read', use: '카드의 허가 표시 (내가 받은 허가)' }],
    acts: {
      open: { op: T('svi.handles.post'), where: 'T', perm: 'node.read', resp: 'job', gate: '자원별 허가(read) · io.* 는 백엔드 없음' },
      close: { op: T('svi.handles.by-handle-id.delete'), where: 'T', perm: 'node.read', resp: 'now' },
      stream: { op: T('svi.handles.by-handle-id.stream.get'), where: 'T', perm: 'node.read', resp: 'stream', note: 'Gateway invoke로 닿지 않는다 — 직접 WebSocket' }
    }
  },
  decl: {
    name: '자원 선언', see: 'node.read',
    list: { op: L('svi.declarations.get'), where: 'L', perm: 'node.read', resp: 'now' },
    acts: {
      add: { op: L('svi.declarations.post'), where: 'L', perm: 'node.config★', resp: 'now', input: { declaration: {}, replace: false, reuse_name: false } },
      undeclare: { op: L('svi.declarations.by-family.by-name.undeclare.post'), where: 'L', perm: 'node.config★', resp: 'now' },
      redeclare: { op: L('svi.declarations.post'), where: 'L', perm: 'node.config★', resp: 'now', input: { reuse_name: true } },
      forget: { op: L('svi.declarations.retired.by-family.by-name.forget.post'), where: 'L', perm: 'node.config★', resp: 'now' }
    }
  },
  grant: {
    name: '허가 · 연결', see: 'node.read',
    list: { op: T('svi.grants.get'), where: 'T', perm: 'node.read', resp: 'now' },
    extra: [{ op: T('svi.bindings.get'), where: 'T', perm: 'node.read', use: '바인딩 카드' }],
    acts: {
      add: { op: T('svi.grants.post'), where: 'T', perm: 'node.control', resp: 'now', input: { subject_id: '', resource_id: '', operations: ['read'], ttl_seconds: 3600 } },
      revoke: { op: T('svi.grants.by-grant-id.delete'), where: 'T', perm: 'node.control', resp: 'now' },
      unbind: { op: T('svi.bindings.by-binding-id.delete'), where: 'T', perm: 'node.read', resp: 'now' }
    }
  },
  io: {
    name: 'I/O 장치', see: 'node.read',
    list: { op: L('io.devices.get'), where: 'L', perm: 'node.read', resp: 'now' },
    acts: {
      approve: { op: L('io.devices.by-device-id.approve.post'), where: 'L', perm: 'node.control', resp: 'now' },
      deny: { op: L('io.devices.by-device-id.deny.post'), where: 'L', perm: 'node.control', resp: 'now' },
      enable: { op: L('io.devices.by-device-id.enable.post'), where: 'L', perm: 'node.control', resp: 'now' },
      disable: { op: L('io.devices.by-device-id.disable.post'), where: 'L', perm: 'node.control', resp: 'now' },
      forget: { op: L('io.devices.by-device-id.forget.post'), where: 'L', perm: 'node.control', resp: 'now' },
      scan: { op: L('io.scan.post'), where: 'L', perm: 'node.control', resp: 'now', note: 'macOS는 501' }
    }
  },
  folder: {
    name: '공유 폴더', see: 'file.read',
    list: { op: L('files.list.get'), where: 'L', perm: 'file.read', resp: 'now', note: '루트 목록 · 항목 목록. 그 밖의 동작은 모듈 namespace' },
    acts: {
      open: { op: FILE('entries.list'), where: 'M', perm: 'file.read', resp: 'now', verify: true },
      get: { op: FILE('transfers.create'), where: 'M', perm: 'file.read', resp: 'now', input: { direction: 'pull' }, verify: true },
      del: { op: FILE('entries.remove'), where: 'M', perm: 'file.write', resp: 'now', verify: true, note: '모듈 op는 권한을 선언하지 않는다 — 화면이 file.write로 잠근다' },
      mkdir: { op: FILE('entries.mkdir'), where: 'M', perm: 'file.write', resp: 'now', verify: true }
    }
  },
  xfer: {
    name: '파일 전송', see: 'file.read',
    list: { op: FILE('transfers.list'), where: 'M', perm: 'file.read', resp: 'now', verify: true },
    acts: {
      push: { op: FILE('transfers.create'), where: 'M', perm: 'file.write', resp: 'now', input: { direction: 'push', mode: 'create' }, verify: true },
      abort: { op: FILE('transfers.abort'), where: 'M', perm: 'file.read|file.write', resp: 'now', input: { keep_partial: true }, verify: true },
      resume: { op: FILE('transfers.chunks.put'), where: 'M', perm: 'file.write', resp: 'now', note: '409의 retry_offset부터', verify: true },
      clear: { op: null, note: '화면에서만 치운다 — 완료된 전송은 서버에서 이미 지워진다' }
    }
  },
  tunnel: {
    name: '서비스 터널', see: 'node.read',
    list: { op: L('service-tunnels.get'), where: 'L', perm: 'node.read', resp: 'now' },
    extra: [{ op: T('service-tunnels.declarations.get'), where: 'T', perm: 'node.read', use: '선언 카드' }],
    acts: {
      open: { op: T('service-tunnels.open.post'), where: 'T', perm: 'node.control', resp: 'job', note: '저장되지 않는다' },
      close: { op: L('service-tunnels.by-tunnel-id.close.post'), where: 'L', perm: 'node.control', resp: 'job' },
      del: { op: T('service-tunnels.declarations.by-declaration-id.delete'), where: 'T', perm: 'node.control', resp: 'now' }
    }
  },
  wg: {
    name: 'WireGuard 피어', see: 'node.read',
    list: { op: L('wireguard.peers.get'), where: 'L', perm: 'node.read', resp: 'now' },
    extra: [{ op: L('wireguard.status.get'), where: 'L', perm: 'node.read', use: '머리 칸 요약(wg0 · 주소)' }],
    acts: {
      sync: { op: L('wireguard.sync.post'), where: 'L', perm: 'node.control', resp: 'job' },
      revoke: { op: T('network.mesh.wireguard.peers.revoke.post'), where: 'T', perm: 'node.control', resp: 'now', confirm: '두 번 눌러야 — 되돌릴 수 없다' }
    }
  },
  job: {
    name: '명령 · 작업', see: 'node.read',
    list: { op: T('jobs.get'), where: 'T', perm: 'node.read', resp: 'now', note: 'leaf 자신이면 terra.daemon.tasks.get', verify: true },
    acts: {
      run: { op: T('commands.post'), where: 'T', perm: 'process.execute', resp: 'job', input: { target_node_id: '<노드>', type: 'process.execute.request', payload: {} }, gate: '직계 자식만 (DELEGATION_REQUIRED)' },
      rerun: { op: T('commands.post'), where: 'T', perm: 'process.execute', resp: 'job' },
      cancel: { op: T('commands.post'), where: 'T', perm: 'process.execute + process.cancel★', resp: 'job', input: { type: 'process.cancel.request' } },
      out: { op: T('jobs.by-job-id.get'), where: 'T', perm: 'node.read', resp: 'now', note: '출력은 폴링 — stdout · stderr 64 KiB' }
    }
  },
  mod: {
    name: '모듈', see: 'node.read',
    list: { op: L('modules.get'), where: 'L', perm: 'node.read', resp: 'now', note: 'tree에서 볼 때 terra.master.nodes.by-node-id.modules.get' },
    acts: {
      start: { op: G('modules.by-module-id.start.post'), where: '∀', perm: 'module.manage★', resp: 'job', verify: true, note: 'tree Gateway에선 501 — leaf는 Daemon 경로(node.control)도 있다' },
      stop: { op: G('modules.by-module-id.stop.post'), where: '∀', perm: 'module.manage★', resp: 'job', verify: true },
      restart: { op: G('modules.by-module-id.restart.post'), where: '∀', perm: 'module.manage★', resp: 'job', verify: true },
      log: { op: G('modules.by-module-id.logs.get'), where: '∀', perm: 'node.read', resp: 'now', verify: true },
      check: { op: L('modules.get'), where: 'L', perm: 'node.read', resp: 'now' }
    }
  }
};

/** 폴더 보관함 바로가기 셋 */
export const FOLDER_STORAGE = {
  repo: { list: { op: L('files.list.get'), perm: 'file.read', note: 'Terra가 관리하는 공유 폴더 · 백업 · 모듈 데이터. 읽기만' } },
  local: { list: { op: null, perm: 'file.read', note: '⚠ API 없음 — 로컬 최상위 루트 탐색 op를 Daemon에 새로 둬야 한다(제안: terra.daemon.local-fs.list.get)' } },
  memo: { list: { op: FILE('entries.list'), perm: 'file.read', note: '메모 루트(memos)를 공유 폴더로 등록하거나 LayoutStore에 둔다 — 결정 필요', verify: true },
    write: { op: FILE('entries.write'), perm: 'file.write', verify: true }, remove: { op: FILE('entries.remove'), perm: 'file.write', verify: true },
    mkdir: { op: FILE('entries.mkdir'), perm: 'file.write', verify: true } },
  openWithApp: { op: null, note: '⚠ API 없음 — 로컬 프로그램으로 열기(xdg-open · 기본 앱 · open)는 Daemon 로컬 op가 필요하다(제안: terra.daemon.desktop.open.post)' },
  openOsExplorer: { op: null, note: '⚠ API 없음 — 위와 같은 op에 폴더 경로를 넘긴다' }
};

/** 세션 · 맵 · 관리 노드 창 */
export const SESSION = {
  health: { op: G('health.get'), perm: '공개' },
  whoami: { op: G('agent.whoami.get'), perm: '로그인' },
  catalog: { op: G('catalog.get'), perm: '공개' },
  login: { op: G('auth.credentials.post'), perm: '공개' },
  logout: { op: G('auth.credentials.delete'), perm: '로그인' },
  nodes: { op: T('nodes.get'), perm: 'node.read', note: '맵의 노드 · 부모 관계 → NET' },
  node: { op: T('nodes.by-node-id.get'), perm: 'node.read' },
  events: { op: L('events.get'), perm: 'node.read', resp: 'stream', note: 'leaf SSE — tree는 폴링' }
};
