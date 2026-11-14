// 파일(.tmod)에서 모듈 설치 — 올리기 · 살피기 · 설치 · 취소 (Terra Daemon op · module.manage · 이 노드와 다른 노드 모두, 노드 지정은 호출 쪽 invoke 가 한다)
//   start    terra.daemon.modules.packages.uploads.post                          { size, sha256, filename } → { upload_id, chunk_bytes, expires_at }
//   chunk    terra.daemon.modules.packages.uploads.by-upload-id.chunk.put        { upload_id, offset, data(base64) } → { received, complete }
//   inspect  terra.daemon.modules.packages.uploads.by-upload-id.get              { upload_id } → { module_id, version, installed_version, action, trust, compatible, permissions, permissions_digest, install_refusal … }
//   install  terra.daemon.modules.packages.uploads.by-upload-id.install.post     { upload_id, permissions_digest, confirm_action } → { module_id, version, previous_version, state, start_error }
//   cancel   terra.daemon.modules.packages.uploads.by-upload-id.delete           { upload_id }
// 조각 크기는 start 가 준 chunk_bytes 만 쓴다(고정 수를 넣지 않는다). 이 파일은 DOM 을 모른다 — invoke(op, input) → Promise<응답 data> 만 받는다.
const P = 'terra.daemon.modules.packages.uploads';
export const TMOD_OPS = { start: P + '.post', chunk: P + '.by-upload-id.chunk.put', inspect: P + '.by-upload-id.get', install: P + '.by-upload-id.install.post', cancel: P + '.by-upload-id.delete' };
export const TMOD_MAX = 256 * 1048576;   // 노드의 패키지 상한(UPLOAD_TOO_LARGE)과 같다 — 넘으면 올리지 않는다
const RESTART_CODES = new Set(['UPLOAD_NOT_FOUND', 'UPLOAD_EXPIRED', 'PACKAGE_HASH_MISMATCH']);

export function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export async function sha256Hex(u8) { const d = await globalThis.crypto.subtle.digest('SHA-256', u8); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const cancelled = () => Object.assign(new Error('올리기를 멈춤'), { code: 'CANCELLED' });

/**
 * 파일을 노드로 올리고 살핀 결과를 돌려준다.
 * @param {{ invoke: (op: string, input: object) => Promise<any>, file: { name: string, size: number, arrayBuffer: () => Promise<ArrayBuffer> }, onProgress?: (p: { sent: number, total: number, phase: string }) => void, signal?: { aborted: boolean } }} a
 * @returns {Promise<{ upload_id: string, insp: any }>}
 */
export async function uploadTmod({ invoke, file, onProgress, signal }) {
  const prog = (sent, phase) => onProgress && onProgress({ sent, total: file.size, phase });
  if (!file.size) throw Object.assign(new Error('빈 파일'), { code: 'UPLOAD_BAD_REQUEST' });
  if (file.size > TMOD_MAX) throw Object.assign(new Error('상한 초과 : 256MiB'), { code: 'UPLOAD_TOO_LARGE' });
  prog(0, 'hash');
  const u8 = new Uint8Array(await file.arrayBuffer()), digest = await sha256Hex(u8);
  if (signal && signal.aborted) throw cancelled();
  const st = await invoke(TMOD_OPS.start, { size: u8.length, sha256: 'sha256:' + digest, filename: file.name });
  const id = st.upload_id, step = Math.max(1, st.chunk_bytes | 0);
  if (!id || !(st.chunk_bytes > 0)) throw Object.assign(new Error('노드가 올리기 조건(chunk_bytes)을 주지 않음'), { code: 'UPLOAD_BAD_REQUEST' });
  const cancel = () => invoke(TMOD_OPS.cancel, { upload_id: id }).catch(() => {});
  try {
    let off = 0, complete = false;
    prog(0, 'upload');
    while (off < u8.length) {
      if (signal && signal.aborted) throw cancelled();
      const end = Math.min(u8.length, off + step);
      let r;
      try { r = await invoke(TMOD_OPS.chunk, { upload_id: id, offset: off, data: b64(u8.subarray(off, end)) }); }
      catch (e) {
        const rec = e && e.details && Number.isInteger(e.details.received) ? e.details.received : -1;
        if (e && e.code === 'UPLOAD_OFFSET_MISMATCH' && rec >= 0 && rec <= u8.length && rec !== off) { off = rec; prog(off, 'upload'); continue; }   // 노드가 아는 자리부터 이어 보낸다
        throw e;
      }
      off = Number.isInteger(r && r.received) ? r.received : end; complete = !!(r && r.complete);
      prog(off, 'upload');
    }
    if (signal && signal.aborted) throw cancelled();
    prog(u8.length, 'inspect');
    const insp = await invoke(TMOD_OPS.inspect, { upload_id: id });
    return { upload_id: id, insp, complete };
  } catch (e) { if (!(e && RESTART_CODES.has(e.code))) await cancel(); throw e; }   // 노드가 이미 버린 올리기는 취소를 부르지 않는다
}

/** 설치 — 사람이 본 권한 묶음(digest)과 살핀 동작(action)을 그대로 돌려준다. 노드가 둘 다 다시 맞춰 본다 */
export function installTmod({ invoke, upload_id, insp }) {
  return invoke(TMOD_OPS.install, { upload_id, permissions_digest: insp.permissions_digest, confirm_action: insp.action });
}
export const cancelTmod = (invoke, upload_id) => invoke(TMOD_OPS.cancel, { upload_id }).catch(() => {});

const ACTION_T = { install: '새로 설치', upgrade: '올리기(업그레이드)', reinstall: '같은 버전 다시 설치', downgrade: '낮은 버전으로 내리기(다운그레이드)' };
const UNSIGNED = '서명 없는 패키지 — 개발 모드 노드에서만';
/** 살핀 결과 → 화면 줄. refusal 이 있으면 설치 단추를 잠근다. extra 는 꼭 따로 체크해야 하는 것 */
export function inspectView(insp) {
  const i = insp || {}, tr = i.trust || {}, perms = Array.isArray(i.permissions) ? i.permissions : [], warns = [], ck = [];
  let refusal = '';
  if (i.install_refusal) {
    const r = i.install_refusal, why = r === 'PACKAGE_QUARANTINED' ? quarantineWhy(tr, i.dev_install_allowed) : r === 'PACKAGE_INCOMPATIBLE' ? '이 노드와 맞지 않음 — ' + (i.incompatible_reason || '호환 안 됨') : r === 'MODULE_REQUIRED' ? 'Tree 가 필수로 지정한 모듈 — 파일로 바꾸지 않음' : String(r);
    refusal = why; warns.push({ t: why, cls: 'err' });
  } else if (i.compatible === false) { refusal = '이 노드와 맞지 않음 — ' + (i.incompatible_reason || '호환 안 됨'); warns.push({ t: refusal, cls: 'err' }); }
  if (!refusal && tr.tier && /dev/i.test(tr.tier)) warns.push({ t: '개발 신뢰 — ' + (tr.reason || '서명 없음 · 알 수 없는 키') + ' (이 노드가 개발 설치를 허용함)', cls: 'warn' });
  if (i.action === 'downgrade') { warns.push({ t: '낮은 버전으로 내립니다 — ' + (i.installed_version || '?') + ' → ' + i.version, cls: 'warn' }); ck.push(['downgrade', '낮은 버전으로 내리는 것 — 확인']); }
  if (!refusal) ck.unshift(['perm', '요구 권한 ' + perms.length + '개 — 확인']);
  const rows = [['모듈', (i.module_id || '—') + ' · ' + (i.version || '—')], ['지금 설치된 버전', i.installed_version || '없음'], ['동작', ACTION_T[i.action] || i.action || '—'],
    ['신뢰', (tr.tier || '—') + (tr.reason ? ' · ' + tr.reason : '') + (tr.key_id ? ' · 키 ' + tr.key_id : '')], ['호환', i.compatible === false ? '맞지 않음' + (i.incompatible_reason ? ' — ' + i.incompatible_reason : '') : '맞음'], ['권한', perms.join(' · ') || '없음']];
  return { rows, warns, checks: ck, refusal, perms, action: i.action || '', actionT: ACTION_T[i.action] || '' };
}
function quarantineWhy(tr, dev) {
  const t = (tr && (tr.code || tr.tier || '')) + ' ' + ((tr && tr.reason) || '');
  if (/unsigned|unknown|서명 없|알 수 없는 키|development/i.test(t) && dev !== true) return UNSIGNED + (tr && tr.reason ? ' (' + tr.reason + ')' : '');
  return '격리된 패키지 — ' + ((tr && tr.reason) || '서명을 믿을 수 없음');
}

/** 오류 → { code, text } — 한 줄(꾸며내지 않는다: 모르는 코드는 노드 문장 그대로) */
export function tmodErr(e) {
  const code = (e && (e.code || (e.status ? 'HTTP_' + e.status : ''))) || 'ERROR', st = e && e.status, d = (e && e.details) || {}, msg = (e && e.message) || '';
  const T = {
    CANCELLED: '올리기를 멈춤', UPLOAD_TOO_LARGE: '패키지가 너무 큼 — 상한 256MiB', UPLOAD_BAD_REQUEST: '올리기 요청이 맞지 않음' + (msg ? ' — ' + msg : ''),
    UPLOAD_NOT_FOUND: '올리기가 노드에 없음(노드 재시작 · 만료) — 파일을 다시 고르세요', UPLOAD_EXPIRED: '올리기가 만료됨(1시간 무활동) — 파일을 다시 고르세요', UPLOAD_FORBIDDEN: '다른 사용자가 시작한 올리기',
    UPLOAD_OFFSET_MISMATCH: '조각 순서가 어긋남 — 다시 시도', UPLOAD_NOT_READY: '올리기가 아직 끝나지 않음', UPLOAD_CAPACITY: '노드가 받는 중인 올리기가 너무 많음 — 잠시 뒤 다시',
    PACKAGE_HASH_MISMATCH: '올린 파일의 해시가 맞지 않음(전송 중 깨짐) — 다시 올리세요', PACKAGE_INVALID: '모듈 패키지 형식이 아님', PACKAGE_UNVERIFIABLE: '무결성 정보(integrity.parts)가 없는 패키지 — 검증할 수 없음',
    PACKAGE_QUARANTINED: quarantineWhy({ code: d.trust_code, reason: d.reason }, false), PACKAGE_INCOMPATIBLE: '이 노드와 맞지 않음 — ' + (d.reason || '호환 안 됨') + ' (여기서는 강제할 수 없음)',
    PACKAGE_TAMPERED: '패키지 내용이 무결성 정보와 다름 — 설치 안 됨(이전 버전 그대로)', GRANT_MISMATCH: '본 권한 목록과 패키지가 달라짐 — 처음부터 다시 살펴보세요', ACTION_MISMATCH: '살핀 동작과 다름' + (d.action ? ' (' + d.action + ')' : '') + ' — 다시 살펴보세요',
    INSTALL_IN_PROGRESS: '이 모듈의 다른 설치가 진행 중 — 끝난 뒤 다시', MODULE_REQUIRED: 'Tree 가 필수로 지정한 모듈 — 파일로 바꾸지 않음', MODULE_DISK_QUOTA: '노드 디스크 한도 — 자리가 모자람',
    INSTALL_FAILED: '설치에 실패함 — 이전 버전이 그대로 복원됨' + (msg ? ' (' + msg + ')' : ''), MODULE_REACH_DENIED: '이 계정이 닿는 범위 밖의 노드 — 설치할 수 없음', LOCAL_API_UNAVAILABLE: '이 노드의 Terra가 아직 지원하지 않음',
    PARTITIONED: '노드와 끊김 — 재연결 후 다시',
  };
  if (T[code]) return { code, text: T[code] };
  if (st === 501) return { code, text: '이 노드의 Terra가 아직 지원하지 않음' };
  if (st === 403) return { code, text: '계정 권한 없음 : module.manage — Tree 관리자에게 요청' };   // Daemon 에 닿기 전 Gateway 가 막은 것
  return { code, text: msg || code };
}

/** 설치 응답 → 결과 줄. state 가 failed 면 failed:true(이전 버전으로 단추를 낸다) */
export function installResult(r) {
  const x = r || {}, failed = x.state === 'failed';
  const lines = [['모듈', (x.module_id || '—') + ' · ' + (x.version || '—')], ['이전 버전', x.previous_version || '없음'], ['상태', failed ? '설치됐지만 시작하지 못함' : x.state === 'running' ? '실행 중' : x.state || '설치됨']];
  if (failed) lines.push(['오류', x.start_error || '시작 실패']);
  return { lines, failed, prev: x.previous_version || '' };
}
