// 화면 기능 ↔ Gateway operation 대응표.
// 화면은 operationId만 안다 — 호출은 client.invoke(opId, input) 한 곳을 지난다 (docs/api/backend-integration.md §2)
//   where: 'L' = leaf Gateway(Daemon terra.daemon.*), 'T' = tree Gateway(Master terra.master.*), '∀' = 양쪽(terra.gateway.*), 'M' = 모듈 namespace
//   perm : 라우트 권한 (★ = 기본 권한 밖). SVI 핸들은 라우트가 node.read여도 자원별 허가가 진짜 문이다
//   resp : 'now' 즉시 · 'job' 202 뒤 비동기(작업 링) · 'stream' WebSocket/SSE
//   verify: true = 원본 문서에서 operationId 표기를 확인하지 못했다 (코드 세션에서 catalog로 확인)
//   in    : (id, item, ctx) => 입력. 없으면 op 이름의 by-…-id 자리만 채운다(source.js pathInput) — 모듈 op은 모르는 키를 거절한다
//   none  : 대응하는 API가 없거나 화면이 아직 하지 않는 동작 — 부르지 않고 그 이유를 낸다(client.js REASON)
//   form  : 적을 값이 있어야 하는 동작 — 부르지 않고 앱 전체 화면의 추가('add') · 수정('edit') 폼을 연다(wire.js)
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
      // 선언 내용(계열 · 이름 · 방향 · 명령)을 적어야 한다 — 폼으로. 퇴역한 선언은 내용이 원장에 남지 않아 다시 적는다
      add: { op: L('svi.declarations.post'), where: 'L', perm: 'node.config★', resp: 'now', form: 'add' },
      undeclare: { op: L('svi.declarations.by-family.by-name.undeclare.post'), where: 'L', perm: 'node.config★', resp: 'now' },
      redeclare: { op: L('svi.declarations.post'), where: 'L', perm: 'node.config★', resp: 'now', form: 'edit' },
      forget: { op: L('svi.declarations.retired.by-family.by-name.forget.post'), where: 'L', perm: 'node.config★', resp: 'now' }
    }
  },
  grant: {
    name: '허가 · 연결', see: 'node.read',
    list: { op: T('svi.grants.get'), where: 'T', perm: 'node.read', resp: 'now' },
    extra: [{ op: T('svi.bindings.get'), where: 'T', perm: 'node.read', use: '바인딩 카드' }],
    acts: {
      add: { op: T('svi.grants.post'), where: 'T', perm: 'node.control', resp: 'now', form: 'add', note: '받는 이 · 자원 · 권한을 적어야 한다' },
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
      scan: { op: L('io.scan.post'), where: 'L', perm: 'node.control', resp: 'now', note: 'macOS는 501', say: (d) => scanLine(d) }
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
      open: { op: T('service-tunnels.open.post'), where: 'T', perm: 'node.control', resp: 'job', form: 'add', preset: { type: 'tun' }, note: '저장되지 않는다 · 대상 노드:포트와 로컬 주소를 적어야 한다' },
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
      // Master 는 두 끝(이 노드 → 피어)을 받는다. 공개 키만 아는 피어(node_id 없음)는 회수할 수 없다
      revoke: { op: T('network.mesh.wireguard.peers.revoke.post'), where: 'T', perm: 'node.control', resp: 'now', confirm: '두 번 눌러야 — 되돌릴 수 없다', in: (id, item, ctx) => wgRevoke(item, ctx) }
    }
  },
  job: {
    name: '명령 · 작업', see: 'node.read',
    list: { op: T('jobs.get'), where: 'T', perm: 'node.read', resp: 'now', note: 'leaf 자신이면 terra.daemon.tasks.get', verify: true },
    acts: {
      run: { op: T('commands.post'), where: 'T', perm: 'process.execute', resp: 'job', form: 'add', gate: '직계 자식만 (DELEGATION_REQUIRED)' },
      rerun: { op: T('commands.post'), where: 'T', perm: 'process.execute', resp: 'job' },
      cancel: { op: T('commands.post'), where: 'T', perm: 'process.execute + process.cancel★', resp: 'job', input: { type: 'process.cancel.request' } },
      out: { op: T('jobs.by-job-id.get'), where: 'T', perm: 'node.read', resp: 'now', note: '출력은 폴링 — stdout · stderr 64 KiB' }
    },
    // 이 노드 자신의 작업은 Daemon 이 안다 — Master 를 거치지 않는다. 출력(stdout)은 Daemon 이 돌려주지 않는다
    local: {
      list: { op: L('tasks.get'), where: 'L', perm: 'node.read', resp: 'now' },
      adapt: 'jobLocal',
      acts: {
        run: { op: L('commands.execute.post'), where: 'L', perm: 'process.execute', resp: 'job', form: 'add', note: '명령은 앱 전체 화면의 추가 폼에 적는다' },
        rerun: { op: L('commands.execute.post'), where: 'L', perm: 'process.execute', resp: 'job', none: 'no-rerun', note: 'Daemon 작업 목록은 명령을 돌려주지 않는다' },
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

/** 이 노드에 설치된 GUI 앱 — 게이트웨이 경로(공개). 모듈 앱의 GUI 표시(gui · ui)가 읽는다 */
export const GUI_APPS = { path: '/api/v1/gui/apps', perm: '공개', note: 'apps[] — id · moduleId · route · origin · embed' };

/**
 * 조타륜 앱의 추가(create) · 수정(update) · 삭제(del) — 화면의 폼(hbFormSave)과 두 번 누르는 삭제(hbDel)가 부른다(wire.js · source.js crud).
 * 본문은 실제 서버의 입력에 맞췄다 — Daemon · Master · 모듈 op 모두 모르는 키를 거절한다(DisallowUnknownFields · additionalProperties:false).
 *   { op, where, body(v, it, ctx) }       한 번 부른다
 *   { where, steps(v, it, ctx) → [...] }   여러 번 부른다(장치 고치기 — 별명 · 승인 · 켜기 가운데 바뀐 것만). 배열 대신 { none } 이면 부르지 않는다
 *   { none: 이유 }                         부르지 않고 이유를 낸다(client.js REASON)
 *   { screen: true }                      서버에 지울 것이 없다 — 화면 목록에서만 걷는다(끝난 전송)
 *   keep · verb                           삭제해도 항목이 목록에 남는다(작업 취소 · 선언 철회 · 전송 중단 — 맵 자리를 걷지 않는다) · 글줄의 낱말
 *   (v, it, ctx) => spec                  값 · 항목에 따라 길이 다르다(파일 · 폴더 · 선언 · 즉석 터널 · 바인딩)
 *   null                                  서버에 길이 없다 — 화면은 항목을 지어내지 않고 그렇다고만 말한다(CRUD_TEXT 의 ⚠ 제안)
 *   local                                 이 노드에서 볼 때의 대응(Master 를 거치지 않는 Daemon 경로)
 * ctx = { path: 폴더 앱의 지금 경로(보관함 칸 id), nodeId: 이 노드의 node_id, nodeIdOf(이름): 맵의 노드 이름 → node_id }
 */
export const HELM_CRUD = {
  io: {
    create: { op: L('io.scan.post'), where: 'L', body: () => ({}), scan: true },   // 손으로 등록하는 op는 없다 — 스캔이 찾는다
    update: { where: 'L', steps: (v, it) => ioSteps(v, it) },
    del: { op: L('io.devices.by-device-id.forget.post'), where: 'L', body: (v, it) => ({ device_id: it.id }), verb: '잊음' }
  },
  svi: { create: null, update: null, del: null },   // SVI 자원은 선언에서 생기고 철회로 사라진다 — 자원 선언 앱
  decl: {
    create: { op: L('svi.declarations.post'), where: 'L', body: (v) => declBody(v) },
    update: (v, it) => (v.fam !== it.fam || v.name !== it.name ? { none: 'decl-key' }
      : { op: L('svi.declarations.post'), where: 'L', body: (vv, i) => Object.assign(declBody(vv), i.state === 'retired' ? { reuse_name: true } : { replace: true }) }),
    del: { op: L('svi.declarations.by-family.by-name.undeclare.post'), where: 'L', body: (v, it) => ({ family: it.fam, name: it.name }), keep: true, verb: '철회' }   // 퇴역 원장에 남는다
  },
  grant: {
    create: { op: T('svi.grants.post'), where: 'T', body: (v) => ({ subject_id: v.who, resource_id: v.res, operations: String(v.ops || 'read').split(' · '), ttl_seconds: ttlSec(v.ttl) }) },
    update: null,   // 허가를 고치는 op 없음 — 철회 뒤 다시 준다
    del: (v, it) => (it && it.type === 'bind'
      ? { op: T('svi.bindings.by-binding-id.delete'), where: 'T', body: (vv, i) => ({ binding_id: i.id }), verb: '끊음' }
      : { op: T('svi.grants.by-grant-id.delete'), where: 'T', body: (vv, i) => ({ grant_id: i.id }), verb: '철회' })
  },
  // 폴더 앱의 칸 id 는 '공유 폴더/상대 경로'다(files.js splitId). 공유 폴더 자신(맨 위 칸)은 Daemon 설정이 정한다
  folder: {
    create: (v, it, ctx) => {
      const at = split(ctx && ctx.path);
      if (!at.root) return { none: 'share-root' };
      if (/[/\\]/.test(v.name)) return { none: 'bad-name' };
      const path = join(at.rel, v.name);
      return v.dir
        ? { op: FILE('entries.mkdir'), where: 'M', body: () => ({ root: at.root, path }) }   // 이미 있으면 FILE_TARGET_EXISTS — 덮지 않는다
        : { op: FILE('entries.write'), where: 'M', body: () => ({ root: at.root, path, data: '', exclusive: true }) };   // 빈 파일(O_CREAT|O_EXCL)
    },
    update: (v, it) => {
      const at = split(it && it.id);
      if (!at.rel) return { none: 'share-root' };
      if (/[/\\]/.test(v.name)) return { none: 'bad-name' };
      const up = at.rel.indexOf('/') >= 0 ? at.rel.slice(0, at.rel.lastIndexOf('/')) : '', to = join(up, v.name);
      return { op: FILE('entries.rename'), where: 'M', body: () => ({ root: at.root, path: at.rel, to }), id: at.root + '/' + to };
    },
    del: (v, it) => {
      const at = split(it && it.id);
      return at.rel ? { op: FILE('entries.remove'), where: 'M', body: () => ({ root: at.root, path: at.rel, recursive: !!it.dir }), verb: '지움' } : { none: 'share-root' };
    }
  },
  xfer: {
    create: { none: 'no-transfer' },   // 올리기는 청크를 보내고, 받기는 끝까지 당겨 저장해야 한다 — 화면에 그 칸이 없다
    update: null,   // 전송을 고치는 op 없음 — 중단 뒤 다시
    del: (v, it) => (it && (it.state === 'completed' || it.state === 'aborted') ? { screen: true, verb: '치움' }
      : { op: FILE('transfers.abort'), where: 'M', body: (vv, i) => ({ transfer_id: i.id, keep_partial: false }), keep: true, verb: '중단' })   // 삭제 = 포기 — 부분 파일도 지운다
  },
  tunnel: {
    // Master 가 경로 표(ticket)를 발급해야 열린다 — Daemon 의 POST /service-tunnels 는 그 표를 받는 쪽이다. 대상 · 로컬 주소는 loopback 만
    create: (v, it, ctx) => {
      const to = hostPort(v.to), bind = hostPort(v.bind || '127.0.0.1:0');
      if (!to || !bind) return { none: 'tunnel-addr' };
      const target = ctx && ctx.nodeIdOf ? ctx.nodeIdOf(to.host) : null;
      if (!target) return { none: 'unknown-node' };
      const body = { source_node_id: (ctx && ctx.nodeId) || '', target_node_id: target, target_port: to.port, local_bind_host: bind.host || '127.0.0.1', local_port: bind.port };
      return { op: T(v.type === 'decl' ? 'service-tunnels.declarations.post' : 'service-tunnels.open.post'), where: 'T', body: () => body };
    },
    update: null,   // 고치는 op 없음 — 지우고 다시
    del: (v, it) => (it && it.type === 'decl'
      ? { op: T('service-tunnels.declarations.by-declaration-id.delete'), where: 'T', body: (vv, i) => ({ declaration_id: i.id }), verb: '선언 지움' }
      : { op: L('service-tunnels.by-tunnel-id.close.post'), where: 'L', body: (vv, i) => ({ tunnel_id: i.id }), verb: '닫음' })
  },
  wg: {
    create: null, update: null,   // 피어는 mesh 가입으로 생긴다 — 고치는 op 없음(동기화)
    del: (v, it, ctx) => { const b = wgRevoke(it, ctx); return b.none ? b : { op: T('network.mesh.wireguard.peers.revoke.post'), where: 'T', body: () => b, verb: '회수' }; }
  },
  job: {
    create: { op: T('commands.post'), where: 'T', body: (v, it, ctx) => ({ target_node_id: ctx.nodeId, type: 'process.execute.request', payload: cmdLine(v.cmd) }) },
    update: null,   // 작업은 고칠 수 없다 — 다시 실행
    del: { op: T('commands.post'), where: 'T', body: (v, it, ctx) => ({ target_node_id: ctx.nodeId, type: 'process.cancel.request', payload: { job_id: it.id } }), keep: true, verb: '취소' },
    // 이 노드 자신의 작업은 Daemon 이 받는다 — 명령 · 인자만(작업 id 는 202 의 task_id)
    local: {
      create: { op: L('commands.execute.post'), where: 'L', body: (v) => cmdLine(v.cmd) },
      del: { op: L('tasks.by-task-id.cancel.post'), where: 'L', body: (v, it) => ({ task_id: it.id }), keep: true, verb: '취소' }
    }
  },
  mod: { create: null, update: null, del: null }   // 설치 · 설정 · 제거 op 가 아직 없다(제안 — CRUD_TEXT)
};

/**
 * 폼 · 상태 화면의 'API' 줄 — 이 모듈이 실제로 부르는 것. ⚠ = 아직 없는 길(제안)
 * 화면(HBCRUD)의 글은 원본 설계의 것이라 실제와 다른 곳이 있다(장치 이름 바꾸기 · 터널 · 피어 회수 본문) — node-live.js 가 이것으로 바꾼다
 */
export const CRUD_TEXT = {
  io: { list: 'terra.daemon.io.devices.get', add: 'terra.daemon.io.scan.post — 손으로 등록하는 op는 없다, 스캔이 찾는다', edit: 'io.devices.by-device-id.{alias · approve · deny · enable · disable}.post — 바뀐 것만 차례로', del: 'terra.daemon.io.devices.by-device-id.forget.post' },
  svi: { list: 'terra.master.svi.resources.get (node_id)', add: '⚠ SVI 자원은 선언에서 생긴다 — 자원 선언 앱', edit: '⚠ 자원을 고치는 op 없음 — 같은 이름으로 다시 선언', del: '⚠ 선언 철회로 사라진다 — 자원 선언 앱' },
  decl: { list: 'terra.daemon.svi.declarations.get', add: 'terra.daemon.svi.declarations.post', edit: 'terra.daemon.svi.declarations.post {replace · 퇴역이면 reuse_name}', del: 'terra.daemon.svi.declarations.by-family.by-name.undeclare.post' },
  grant: { list: 'terra.master.svi.grants.get + svi.bindings.get', add: 'terra.master.svi.grants.post', edit: '⚠ 허가를 고치는 op 없음 — 철회 뒤 다시 준다', del: 'terra.master.svi.grants.by-grant-id.delete · 바인딩은 svi.bindings.by-binding-id.delete' },
  folder: { list: 'io.terra.file.roots.list · io.terra.file.entries.list', add: 'io.terra.file.entries.mkdir · 파일은 io.terra.file.entries.write (빈 파일)', edit: 'io.terra.file.entries.rename', del: 'io.terra.file.entries.remove' },
  xfer: { list: 'io.terra.file.transfers.list', add: '⚠ 올리기 · 받기는 청크를 보내고 받아야 한다 — 아직 화면에 없다', edit: '⚠ 전송을 고치는 op 없음 — 중단 뒤 다시', del: 'io.terra.file.transfers.abort · 끝난 전송은 화면에서만 치운다' },
  tunnel: { list: 'terra.daemon.service-tunnels.get + terra.master.service-tunnels.declarations.get', add: '선언 terra.master.service-tunnels.declarations.post · 즉석 terra.master.service-tunnels.open.post', edit: '⚠ 고치는 op 없음 — 지우고 다시', del: 'terra.daemon.service-tunnels.by-tunnel-id.close.post · 선언은 terra.master.service-tunnels.declarations.by-declaration-id.delete' },
  wg: { list: 'terra.daemon.wireguard.peers.get · wireguard.status.get', add: '⚠ 피어는 mesh 가입으로 생긴다', edit: '⚠ 피어를 고치는 op 없음 — 동기화(wireguard.sync.post)', del: 'terra.master.network.mesh.wireguard.peers.revoke.post {source_node_id · target_node_id} (되돌릴 수 없다)' },
  job: { list: 'terra.daemon.tasks.get · tree: terra.master.jobs.get', add: 'terra.daemon.commands.execute.post · tree: terra.master.commands.post', edit: '⚠ 작업은 고칠 수 없다 — 다시 실행', del: 'terra.daemon.tasks.by-task-id.cancel.post · tree: commands.post {process.cancel.request}' },
  mod: { list: 'terra.daemon.modules.get · GUI는 /api/v1/gui/apps', add: '⚠ 모듈 설치 op 없음 — 제안 terra.gateway.modules.post (패키지 · 서명)', edit: '⚠ 모듈 설정 — 제안 terra.gateway.modules.by-module-id.config.put', del: '⚠ 모듈 제거 — 제안 terra.gateway.modules.by-module-id.delete' }
};

/** 장치 고치기 — 바뀐 것만 차례로. 종류는 장치가 정하고, 승인 대기로 되돌리는 op 는 없다 */
function ioSteps(v, it) {
  if (v.kind !== it.kind) return { none: 'io-kind' };
  const id = it.id, P = (a) => L('io.devices.by-device-id.' + a + '.post'), out = [];
  if (v.name !== it.name) out.push({ op: P('alias'), body: { device_id: id, alias: v.name } });
  if (v.approval !== it.approval) {
    if (v.approval === 'approved') out.push({ op: P('approve'), body: { device_id: id } });
    else if (v.approval === 'denied') out.push({ op: P('deny'), body: { device_id: id } });
    else return { none: 'io-pending' };
  }
  if (!!v.enabled !== !!it.enabled) out.push({ op: P(v.enabled ? 'enable' : 'disable'), body: { device_id: id } });
  return out;
}

/** 선언 본문 — Daemon 은 평평한 선언(계열 · 이름 · 방향 + 계열마다 command·args / path / address)을 받는다 */
function declBody(v) {
  const d = { family: v.fam, name: v.name, direction: v.dir }, what = String(v.what || '').trim();
  if (v.fam === 'process') { const [command, ...args] = what.split(/\s+/).filter(Boolean); if (command) d.command = command; if (args.length) d.args = args; }
  else if (v.fam === 'file') { if (what) d.path = what; }
  else if (what) d.address = what;
  return d;
}

/** 명령 한 줄 → { command, args } (따옴표는 풀지 않는다 — 빈칸으로 나눈다) */
function cmdLine(s) {
  const [command, ...args] = String(s || '').trim().split(/\s+/).filter(Boolean);
  return args.length ? { command: command || '', args } : { command: command || '' };
}

/** '2시간' · '30분' · '1일' · '3600' → 초. 모르면 1시간 */
function ttlSec(s) {
  const m = /(\d+)\s*(초|분|시간|일)?/.exec(String(s || ''));
  if (!m) return 3600;
  return +m[1] * ({ 초: 1, 분: 60, 시간: 3600, 일: 86400 }[m[2]] || 1) || 3600;
}

/** '이름:22' · '127.0.0.1:2222' → { host, port } (포트가 없거나 틀리면 null) */
function hostPort(s) {
  const t = String(s || '').trim(), i = t.lastIndexOf(':');
  const port = i < 0 ? NaN : Number(t.slice(i + 1));
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? { host: t.slice(0, i).trim(), port } : null;
}

/** 피어 회수 본문 — 이 노드에서 그 피어로 가는 길을 끊는다. 피어 id 가 공개 키면(node_id 를 모르면) 회수할 수 없다 */
function wgRevoke(item, ctx) {
  const peer = item && item.node ? item.node : item && item.id;
  if (!peer || /=$/.test(peer) || !(ctx && ctx.nodeId)) return { none: 'wg-no-node' };
  return { source_node_id: ctx.nodeId, target_node_id: peer };
}

const split = (id) => { const s = String(id || ''), i = s.indexOf('/'); return i < 0 ? { root: s, rel: '' } : { root: s.slice(0, i), rel: s.slice(i + 1) }; };
const join = (dir, name) => (dir ? dir + '/' : '') + name;

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

/** I/O 스캔 결과(ScanResult) → 글줄 */
export function scanLine(d) {
  const n = (k) => (d && Array.isArray(d[k]) ? d[k].length : 0);
  return '스캔 — 장치 ' + (d && d.scanned != null ? d.scanned : '?') + ' · 새 ' + n('added') + ' · 바뀜 ' + n('updated') + ' · 사라짐 ' + n('missing');
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
