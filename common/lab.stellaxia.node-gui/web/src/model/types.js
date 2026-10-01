// 노드 화면이 다루는 데이터의 모양 (JSDoc). 화면 로직(src/screens/node.js)의 예시 데이터와 같은 모양이고,
// 실제 연동에서는 src/api 가 Gateway 응답을 이 모양으로 바꿔 넘긴다. 필드 설명은 docs/data-model.md
// 타입 검사가 필요하면 파일 맨 위에 // @ts-check 를 두고 VS Code 등에서 본다.

/**
 * 노드 관계 한 줄 — NET[이름]
 * @typedef {Object} NetNode
 * @property {'Tree'|'Leaf'|'Tree · Leaf'} role
 * @property {string[]} kids              직속 자식 노드 이름 (tree만)
 * @property {Array<[string, '장치'|'모듈'|'파일']>} [res]  leaf가 관리하는 자원 요약
 * @property {string|null} [bid]          프사 · 노드 필드에 쓰는 건물 id
 * @property {'saved'|'password'|'offline'} [auth]  tree 로그인 방식 (saved = 자동 로그인 저장됨)
 */

/**
 * 노드 권한 — 조타륜 앱 · 폴더 보관함이 버튼을 잠글 때 쓴다 (src/model/permissions.js)
 * @typedef {'node.read'|'node.control'|'node.config'|'process.execute'|'process.cancel'|'file.read'|'file.write'|'module.manage'} Permission
 * @typedef {Object} NodePerm
 * @property {'소유자'|'관리자'|'읽기 전용'|'권한 없음'} role
 * @property {Permission[]} has
 * @property {string} [why]               권한이 없는 이유 (예: 'tree-office 로그인 필요')
 */

/**
 * 배지 다섯 — 정상 · 진행 중 · 꺼짐·대기 · 문제 · 끝남 (src/model/badges.js)
 * @typedef {'ok'|'run'|'wait'|'off'|'bad'|'end'} BadgeTone
 * @typedef {{ label: string, tone: BadgeTone, raw?: string }} Badge
 */

// ── 조타륜 앱 10개의 자원 한 줄 ──

/** @typedef {{ id: string, kind: string, name: string, ep: string, status: 'available'|'busy'|'disabled'|'unavailable'|'unsupported', grant: 'own'|string[]|null, handle?: string|null, last?: string }} SviResource */
/** @typedef {{ id: string, fam: 'process'|'file'|'net', name: string, dir: 'source'|'sink', origin: 'file'|'runtime', state: 'applied'|'shadowed'|'refused_by_policy'|'retired', what: string, reason?: string }} SviDeclaration */
/** @typedef {{ id: string, type: 'grant', who: string, res: string, ops: string, ttl: string, alive: boolean }} SviGrant */
/** @typedef {{ id: string, type: 'bind', from: string, to: string, state: string, qos?: string, reason?: string }} SviBinding */
/** @typedef {{ id: string, kind: 'mouse'|'keyboard'|'camera'|'microphone'|'screen'|'raw_bus', name: string, presence: 'present'|'missing'|'unknown', approval: 'pending'|'approved'|'denied'|'quarantined', enabled: boolean }} IoDevice */
/** @typedef {{ id: string, parent: string, name: string, dir?: boolean, root?: boolean, size?: string, info?: string }} FsEntry */
/** @typedef {{ id: string, dir: 'push'|'pull', name: string, total: number, off: number, state: 'prepared'|'transferring'|'verifying'|'completed'|'aborted'|'failed', reason?: string }} Transfer */
/** @typedef {{ id: string, type: 'decl'|'tun', name: string, to: string, bind: string, on?: boolean, state?: 'listening'|'active'|'failed'|'draining', conn?: string, bytes?: string, err?: string }} Tunnel */
/** @typedef {{ id: string, ip: string, ep: string, hs: string, health: 'healthy'|'stale'|'never' }} WgPeer */
/** @typedef {{ id: string, cmd: string, state: 'queued'|'sent'|'running'|'success'|'failed', t?: number, code?: number|null, out?: string }} Job */
/** @typedef {{ id: string, name: string, ver: string, state: 'running'|'degraded'|'failed'|'stopped', svi: number, trust: 'core'|'local', note?: string }} ModuleInfo */

// ── 폴더 보관함 · 메모장 ──

/** @typedef {'repo'|'local'|'memo'} FolderMode */
/** @typedef {{ id: string, parent: string, name: string, dir?: boolean, lock?: boolean, size?: string, info?: string }} FolderEntry */
/** @typedef {FolderEntry & { text?: string }} Memo */

// ── 화면 상태 (일부) ──

/**
 * 전체 화면 id — 서브 창 키(props · bld …) 또는 조타륜 앱 'hb:<앱>'
 * @typedef {string} FullscreenId
 */

export {};
