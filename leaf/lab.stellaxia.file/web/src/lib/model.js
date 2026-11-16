// 화면이 쓰는 순수 함수 — 경로 · 권한 · 오류 분류 · 전송 줄 · 공유 폴더 상태.
// DOM 도 네트워크도 모른다(node --test 로 시험한다). 계약: contracts/api/terra-api.json.

/** 토큰이 실은 권한 → 화면이 잠글 것. 읽기만 있으면 받기는 되고 올리기 · 삭제는 잠근다 */
export function capabilities(perms) {
  const has = (p) => Array.isArray(perms) && perms.includes(p);
  return { read: has('file.read'), write: has('file.write'), nodes: has('node.read') };
}

export const LOCK_WHY = {
  write: 'file.write 권한이 필요합니다.',
  read: 'file.read 권한이 필요합니다.',
};

/** 공유 폴더 상대 경로 — 앞뒤 슬래시 · 빈 조각을 지운다. '..' 은 그대로 둔다(노드가 PATH_DENIED 로 거절하는 것을 화면이 보여 주려고) */
export const cleanPath = (p) => String(p || '').replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').join('/');
export const joinPath = (a, b) => cleanPath(cleanPath(a) + '/' + cleanPath(b));
export const parentPath = (p) => cleanPath(p).split('/').slice(0, -1).join('/');
export const baseName = (p) => cleanPath(p).split('/').pop() || '';
/** 'a/b/c' → [{name:'a', path:'a'}, {name:'b', path:'a/b'}, …] */
export function crumbs(p) {
  const parts = cleanPath(p).split('/').filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

/** 주소창에 쓴 경로가 공유 폴더 밖을 가리키는가 — 절대 경로 · 상위 이동. 노드가 어차피 막지만 보내기 전에 말해 준다 */
export function outsideRoot(p) {
  const s = String(p || '').replace(/\\/g, '/');
  return /^([a-zA-Z]:|\/)/.test(s) || s.split('/').includes('..');
}

/** entries.list 의 항목 → 폴더 먼저, 이름순 */
export function sortEntries(entries) {
  return [...(entries || [])].sort((a, b) => (a.is_dir === b.is_dir ? String(a.name).localeCompare(String(b.name)) : a.is_dir ? -1 : 1));
}

/**
 * roots.list 응답 → 화면 상태. "없음"과 "못 봤음"과 "모르겠음"을 섞지 않는다.
 *  ok       공유 폴더가 있다
 *  empty    목록이 비었다 — 선언을 안 했거나 모듈이 폴더 권한을 못 받았다. "공유 폴더 없음"이라고 단정하지 않는다
 *  unseen   답을 못 받았다(노드 응답 없음 · 모듈 없음 …)
 */
export function rootsState(resp, err) {
  if (err) return { state: 'unseen', roots: [], err };
  const roots = (resp && Array.isArray(resp.roots) ? resp.roots : []).filter((r) => r && r.name);
  return roots.length ? { state: 'ok', roots } : { state: 'empty', roots: [] };
}

/** 오류 코드 → 화면 문구. 코드는 계약의 errors 와 Gateway 의 것이다 */
const ERR = {
  PATH_DENIED: { tone: 'error', title: '공유 폴더 밖 경로입니다', body: '절대 경로, 상위 이동(..), 밖을 가리키는 심볼릭 링크는 열 수 없습니다. 공유 폴더 기준 상대 경로로 고쳐 주세요.' },
  ROOT_NOT_FOUND: { tone: 'error', title: '등록되지 않은 공유 폴더입니다', body: '이 노드가 그 이름의 폴더를 내주지 않습니다. 목록에서 다시 고르세요.' },
  FILE_NOT_FOUND: { tone: 'warn', title: '경로가 없습니다', body: '다른 곳에서 지워졌거나 옮겨졌을 수 있습니다. 빈 폴더와는 다른 상태입니다.' },
  FILE_TARGET_EXISTS: { tone: 'warn', title: '같은 이름이 이미 있습니다', body: '덮어쓰거나 다른 이름을 고르세요.' },
  FILE_RECURSIVE_REQUIRED: { tone: 'warn', title: '비어 있지 않은 폴더입니다', body: '안의 것까지 지우려면 확인이 필요합니다.' },
  TRANSFER_TOO_LARGE: { tone: 'error', title: '노드가 받는 크기를 넘었습니다', body: '파일을 나누거나 노드 설정(TERRA_FILE_MAX_TRANSFER_MB)에서 상한을 올리세요.' },
  TRANSFER_EXPIRED: { tone: 'warn', title: '전송 시간이 지났습니다', body: '받은 데까지는 남아 있어 이어서 보낼 수 있습니다.' },
  TRANSFER_NOT_FOUND: { tone: 'warn', title: '그 전송이 없습니다', body: '이미 정리됐습니다. 목록을 새로 고치세요.' },
  CHECKSUM_MISMATCH: { tone: 'error', title: '완료된 파일이 맞지 않습니다', body: '부분 파일을 지웠습니다. 처음부터 다시 하세요.' },
  TOO_LARGE_FOR_BROWSER: { tone: 'warn', title: '브라우저로는 너무 큽니다', body: '큰 파일은 CLI의 terra file send / get을 쓰세요.' },
  MODULE_NOT_FOUND: { tone: 'unseen', title: '이 노드의 파일을 확인하지 못했습니다', body: 'lab.stellaxia.file이 그 노드에 설치되어 있지 않거나 실행 중이 아닙니다. 파일이 없다는 뜻이 아닙니다.' },
  MODULE_ROUTE_NOT_FOUND: { tone: 'unseen', title: '이 노드의 파일을 확인하지 못했습니다', body: '그 노드에서 파일 모듈의 길을 찾지 못했습니다. 파일이 없다는 뜻이 아닙니다.' },
  NETWORK: { tone: 'unseen', title: '게이트웨이에 닿지 못했습니다', body: '네트워크나 이 노드의 Gateway를 확인하세요.' },
  TIMEOUT: { tone: 'unseen', title: '시간 안에 답이 오지 않았습니다', body: '노드가 바쁘거나 끊겼습니다. 파일이 없다는 뜻이 아닙니다.' },
  GATEWAY_UNREACHABLE: { tone: 'unseen', title: '노드에 닿지 못했습니다', body: '노드가 꺼져 있거나 길이 끊겼습니다. 파일이 없다는 뜻이 아닙니다.' },
};

/** @returns {{ tone: 'error'|'warn'|'unseen', title: string, body: string, code: string }} */
export function describeError(err) {
  const code = (err && err.code) || 'ERROR';
  const known = ERR[code];
  if (known) return { ...known, code };
  if (err && (err.status === 401 || code === 'UNAUTHORIZED')) return { tone: 'error', code, title: '로그인이 필요합니다', body: '세션이 끝났습니다. 다시 로그인하세요.' };
  if (err && (err.status === 403 || /FORBIDDEN|PERMISSION/.test(code))) return { tone: 'error', code, title: '권한이 없습니다', body: '이 일에는 file.read 또는 file.write 권한이 필요합니다.' };
  if (err && err.status >= 502) return { tone: 'unseen', code, title: '노드에 닿지 못했습니다', body: '파일이 없다는 뜻이 아닙니다.' };
  return { tone: 'error', code, title: '요청을 처리하지 못했습니다', body: (err && err.message) || code };
}

/**
 * 모듈의 전송 기록(transfers.list 의 한 줄) + 이 화면이 지금 돌리고 있는 작업 → 한 줄.
 * 모듈의 상태는 prepared · transferring · verifying · completed · aborted 뿐이다. 화면이 돌리는 작업이 없는데
 * transferring 이면 끊긴 것(멈춤)이고, 이어받기는 같은 경로로 다시 준비하면 된다.
 */
export function transferRow(t, liveIds = new Set()) {
  const size = Number(t.size_bytes) || 0, off = Number(t.offset) || 0;
  const pct = size > 0 ? Math.min(100, Math.floor((off / size) * 100)) : t.state === 'completed' ? 100 : 0;
  const live = liveIds.has(t.transfer_id);
  let label, tone, actions;
  switch (t.state) {
    case 'completed': label = '완료'; tone = 'ok'; actions = []; break;
    case 'aborted': label = t.reason === 'expired' ? '만료' : '중단됨'; tone = 'warn'; actions = t.direction === 'push' ? ['resume'] : []; break;
    case 'verifying': label = '검증 중'; tone = 'run'; actions = []; break;
    default: label = live ? '전송 중' : '멈춤'; tone = live ? 'run' : 'warn'; actions = live ? ['cancel'] : ['resume', 'discard'];
  }
  return { id: t.transfer_id, dir: t.direction === 'pull' ? 'down' : 'up', root: t.root, path: t.path, size, offset: off, pct, label, tone, actions, reason: t.reason || '', live };
}

/** 같은 이름이 있을 때 고를 수 있는 것 — 모듈이 아는 것은 create(거절)와 overwrite 뿐이고, "이름을 바꿔서"는 화면이 다른 경로를 쥐여 주는 것이다 */
export function suggestName(name, taken) {
  const set = new Set(taken || []);
  const m = String(name).match(/^(.*?)(\.[^.]+)?$/);
  const stem = m[1] || name, ext = m[2] || '';
  for (let i = 1; i < 1000; i++) { const c = `${stem} (${i})${ext}`; if (!set.has(c)) return c; }
  return `${stem} (${Date.now()})${ext}`;
}
