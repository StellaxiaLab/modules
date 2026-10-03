// 화면 기능 ↔ Gateway operation 대응표.
// 화면은 operationId만 안다 — 호출은 client.invoke(opId, input) 한 곳을 지난다 (docs/api/backend-integration.md §2)
//   where: 'L' = leaf Gateway(Daemon terra.daemon.*), 'T' = tree Gateway(Master terra.master.*), '∀' = 양쪽(terra.gateway.*), 'M' = 모듈 namespace
//   perm : 라우트 권한 (★ = 기본 권한 밖). SVI 핸들은 라우트가 node.read여도 자원별 허가가 진짜 문이다
//   resp : 'now' 즉시 · 'job' 202 뒤 비동기(작업 링) · 'stream' WebSocket/SSE
//   verify: true = 원본 문서에서 operationId 표기를 확인하지 못했다 (코드 세션에서 catalog로 확인)
//   in    : (id, item, ctx) => 입력. 없으면 op 이름의 by-…-id 자리만 채운다(source.js pathInput) — 모듈 op은 모르는 키를 거절한다
//   none  : 대응하는 API가 없거나 화면이 아직 하지 않는 동작 — 부르지 않고 그 이유를 낸다(client.js REASON)
//   local : 이 노드(로컬)에서 볼 때만 쓰는 대응 — Master 를 거치지 않는 Daemon 경로가 있는 앱(명령 · 작업)
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
      open: { op: FILE('entries.list'), where: 'M', perm: 'file.read', resp: 'now', note: '들어가기는 화면 이동 — 목록은 source.js 가 지금 경로까지 읽는다' },
      get: { op: FILE('transfers.create'), where: 'M', perm: 'file.read', resp: 'now', none: 'no-download', note: '받기는 청크를 끝까지 당겨 파일로 저장해야 한다 — 화면에 아직 없다' },
      del: { op: FILE('entries.remove'), where: 'M', perm: 'file.write', resp: 'now', in: (id, item) => ({ root: item.share, path: item.rel, recursive: !!item.dir }), note: '모듈 op는 권한을 선언하지 않는다 — 화면이 file.write로 잠근다' },
      mkdir: { op: FILE('entries.mkdir'), where: 'M', perm: 'file.write', resp: 'now', in: (id, item, ctx) => newFolder(ctx && ctx.path) }
    }
  },
  xfer: {
    name: '파일 전송', see: 'file.read',
    list: { op: FILE('transfers.list'), where: 'M', perm: 'file.read', resp: 'now', verify: true },
    acts: {
      push: { op: FILE('transfers.create'), where: 'M', perm: 'file.write', resp: 'now', none: 'no-upload', note: '올리기는 파일을 고르고 청크를 보내야 한다 — 화면에 아직 없다' },
      abort: { op: FILE('transfers.abort'), where: 'M', perm: 'file.read|file.write', resp: 'now', in: (id) => ({ transfer_id: id, keep_partial: true }) },
      resume: { op: FILE('transfers.chunks.put'), where: 'M', perm: 'file.write', resp: 'now', none: 'no-upload', note: '409의 retry_offset부터 — 보낼 바이트가 화면에 없다' },
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
    // WireGuard 통합이 꺼져 있으면 Daemon 이 422(LOCAL_API_CONTROL_REJECTED)를 낸다 — 오류가 아니라 피어가 없는 것이다.
    // 그래서 상태를 먼저 보고(guard), 꺼져 있으면 피어를 부르지 않는다
    guard: { op: L('wireguard.status.get'), where: 'L', skip: (d) => !!d && d.enabled === false },
    list: { op: L('wireguard.peers.get'), where: 'L', perm: 'node.read', resp: 'now', empty: (r) => r.status === 422 },
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
    },
    // 이 노드 자신의 작업은 Daemon 이 안다 — Master 를 거치지 않는다. 출력(stdout)은 Daemon 이 돌려주지 않는다
    local: {
      list: { op: L('tasks.get'), where: 'L', perm: 'node.read', resp: 'now' },
      adapt: 'jobLocal',
      acts: {
        run: { op: L('commands.execute.post'), where: 'L', perm: 'process.execute', resp: 'job', none: 'no-command', note: '명령을 적을 칸이 화면에 없다' },
        rerun: { op: L('commands.execute.post'), where: 'L', perm: 'process.execute', resp: 'job', none: 'no-command', note: 'Daemon 작업 목록은 명령을 돌려주지 않는다' },
        cancel: { op: L('tasks.by-task-id.cancel.post'), where: 'L', perm: 'node.control', resp: 'job' },
        out: { op: L('tasks.by-task-id.get'), where: 'L', perm: 'node.read', resp: 'now', say: (d) => taskLine(d) }
      }
    }
  },
  mod: {
    name: '모듈', see: 'node.read',
    list: { op: L('modules.get'), where: 'L', perm: 'node.read', resp: 'now', note: 'tree에서 볼 때 terra.master.nodes.by-node-id.modules.get' },
    acts: {
      // 시작 · 멈춤 · 재시작은 이 노드 Daemon 의 경로(node.control)로 — 게이트웨이의 terra.gateway.modules.by-id.* 는 재시작이 없다.
      // 로그는 게이트웨이가 이 노드의 모듈 것을 준다. 어느 쪽이든 이 노드의 모듈만 다룬다(where 'L' — 다른 노드면 부르지 않는다)
      start: { op: L('modules.by-module-id.start.post'), where: 'L', perm: 'node.control', resp: 'job' },
      stop: { op: L('modules.by-module-id.stop.post'), where: 'L', perm: 'node.control', resp: 'job' },
      restart: { op: L('modules.by-module-id.restart.post'), where: 'L', perm: 'node.control', resp: 'job' },
      log: { op: G('modules.by-id.logs.get'), where: 'L', perm: 'node.read', resp: 'now', say: (d) => logLine(d) },
      check: { op: L('modules.get'), where: 'L', perm: 'node.read', resp: 'now', say: (d) => modLine(d) }
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

/** 작업(job)을 쫓는 op — Daemon 이 접수한 것은 Daemon 작업, 그 밖은 Master 작업 */
export const TRACK = {
  L: { op: L('tasks.by-task-id.get'), key: 'task_id' },
  T: { op: T('jobs.by-job-id.get'), key: 'job_id' }
};

/** 지금 들어가 있는 폴더(보관함 칸 id '공유 폴더/상대 경로')에 만들 새 폴더 */
function newFolder(at) {
  const s = String(at || ''), i = s.indexOf('/');
  const root = i < 0 ? s : s.slice(0, i), rel = i < 0 ? '' : s.slice(i + 1);
  return { root, path: (rel ? rel + '/' : '') + '새 폴더' };
}

export const TASK_STATE = { succeeded: '완료', success: '완료', completed: '완료', failed: '실패', dead_letter: '실패', timed_out: '시간 초과', canceled: '취소됨', cancelled: '취소됨', running: '실행 중', pending: '대기', queued: '대기' };

/** Daemon 작업 하나 → 글줄 */
export function taskLine(d) {
  if (!d || typeof d !== 'object') return '작업 정보 없음';
  return (d.type || '작업') + ' · ' + (TASK_STATE[d.state] || d.state || '상태 모름') + ' — 출력은 Daemon 이 돌려주지 않는다';
}

/** 모듈 로그 → 마지막 한 줄 */
export function logLine(d) {
  const lines = d && Array.isArray(d.logs) ? d.logs.filter((l) => String(l).trim()) : [];
  return (d && d.module ? d.module + ' · ' : '') + (lines.length ? String(lines[lines.length - 1]).slice(0, 160) : '최근 로그 없음');
}

/** 모듈 목록 → 상태 확인 글줄 */
export function modLine(d) {
  const mods = d && Array.isArray(d.modules) ? d.modules : [];
  const run = mods.filter((m) => m.state === 'running').length, bad = mods.filter((m) => m.state === 'failed').length;
  return '상태 확인 — 모듈 ' + mods.length + ' · 실행 ' + run + (bad ? ' · 실패 ' + bad : '');
}
