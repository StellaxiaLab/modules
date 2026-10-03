// 폴더 보관함의 "Terra 저장소" — 이 노드의 진짜 공유 폴더(io.terra.file).
//
// 화면은 항목을 { id, parent, name, dir, size?, info } 로 읽고, 폴더에 들어가면 그 id 를 fb.path 로 둔다.
// 여기서는 공유 폴더 이름을 맨 위 칸으로, 그 안의 경로를 '<공유 폴더>/<상대 경로>' 로 이어 붙인다.
// share · rel 은 io.terra.file op 에 그대로 싣는 값(root · path)이다. 'root' 라는 이름은 쓰지 않는다 —
// 조타륜 폴더 앱은 root 가 참인 칸을 공유 폴더 줄(지우기 없음)로 그린다.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
export function fmtSize(bytes) {
  let n = Number(bytes) || 0, i = 0;
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i += 1; }
  return (i === 0 ? String(n) : n.toFixed(n < 10 ? 1 : 0)) + ' ' + UNITS[i];
}

const pad = (n) => String(n).padStart(2, '0');
/** 수정 시각 — 'YYYY-MM-DD HH:MM' (로컬) */
export function fmtTime(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 공유 폴더 목록 → 맨 위 칸 */
export function rootItems(roots) {
  return (Array.isArray(roots) ? roots : []).filter((r) => r && r.name).map((r) => ({
    id: r.name, parent: '', name: r.name, dir: true, info: r.name + ' · ' + (r.path || ''), share: r.name, rel: ''
  }));
}

/** 보관함 칸 id → { root, rel }. 맨 위('')는 root 가 없다 */
export function splitId(id) {
  const s = String(id || '');
  if (!s) return { root: '', rel: '' };
  const i = s.indexOf('/');
  return i < 0 ? { root: s, rel: '' } : { root: s.slice(0, i), rel: s.slice(i + 1) };
}

/** 한 폴더의 진짜 항목 → 그 폴더 아래 칸 */
export function entryItems(root, rel, entries) {
  const parent = rel ? root + '/' + rel : root;
  return (Array.isArray(entries) ? entries : []).filter((e) => e && e.name).map((e) => {
    const path = e.path || (rel ? rel + '/' + e.name : e.name);
    return {
      id: root + '/' + path, parent, name: e.name, dir: !!e.is_dir,
      size: e.is_dir ? undefined : fmtSize(e.size), info: fmtTime(e.modified_at), share: root, rel: path
    };
  });
}
