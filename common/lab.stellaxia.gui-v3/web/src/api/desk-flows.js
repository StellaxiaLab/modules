// 제어기(NodeDesktopEmbed)의 쓰기 흐름 — 확인 단계 · 등록 코드 · .tmod 매니페스트 · 모듈 배정 진행 · 네트워크 쓰기 · 서비스 터널 열기.
//
// 아래 @flows 구간은 보드(design/NodeDesktopEmbed.dc.html)에 글자 그대로 복사돼 있다 — 보드는 캔버스에서도 혼자 돌아야 해서
// 모듈을 들여오지 못한다. 원본은 이 파일이고, tests/desk-flows.test.mjs 가 두 구간이 같은지 본다(고치면 tools/sync-desk-flows.mjs).
// 구간 안에는 import · export 를 두지 않는다(보드 스크립트의 맨 위에 그대로 놓인다).
//
// 문(gate)은 여기서 정하지 않는다 — 단추마다 window.TerraGate(op)가 연다/닫는다(src/api/gates.js). 여기 있는 것은
//   · op 이름과 입력 모양(Terra 계약 · Provider DTO 에서 확인한 그대로)
//   · 설계 결정 때문에 닫아 둔 것(DECIDE — 코어 권한과 상관없이 사람이 정해야 열린다. 열 때는 이 표 한 곳만 바꾼다)

/* @flows:begin */
// 설계 결정으로 닫은 마지막 단추 — locked 를 false 로 바꾸면 그 단추가 문(gate)만 보고 열린다
const DECIDE = {};
// 계약이 위임을 닫은 까닭을 계약 설명에서 그대로 옮긴 것 — 문(gate)의 why 뒤에 붙인다(잠금 판정은 문이 한다)
const CONTRACT_WHY = {
  'terra.master.users.by-user-id.external-identities.post': 'Master 계약 : 위임 세션(앱 토큰) 닫힘 — 영구 로그인 뒷문 방지',
  'terra.master.users.by-user-id.external-identities.delete': 'Master 계약 : 본인 · master_admin 만 (앱 위임 없음)',
  'terra.master.admin.external-issuers.get': 'Master 계약 : master.admin 권한 (앱 위임 없음)',
  'terra.master.admin.external-issuers.post': 'Master 계약 : master.admin 권한 (앱 위임 없음)',
  'terra.master.admin.external-issuers.delete': 'Master 계약 : master.admin 권한 (앱 위임 없음)',
  'terra.master.service-tunnels.open.post': 'Daemon service-tunnels.post 단독 불가 — 입력 : Master 경로 결정(decision) · 경로 표(ticket · service_tunnel 채널) (Provider DTO OpenRequest) · 표 발급 : Master service-tunnels.open.post',
  'terra.daemon.enrollment.code.post': 'Daemon 계약 : node.enroll 권한 · 이 노드(loopback)만',
  'terra.daemon.terminal.sessions.post': 'Daemon 계약에 없는 op — node-shell.md §5.1 제안',
};

// ── 등록 코드 ── Daemon registration.ParseNodeEnrollCode 와 같은 규칙: tnc_<비밀> · tnc_<비밀>.<base64url(origin)>
//   주소 부분이 깨졌으면 비밀만 쓴다(주소는 편의 — 깨진 주소가 좋은 코드를 실패시키지 않는다). Fleet 가입 코드(tjc_)는 거절
function b64urlText(s) {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/'), pad = b + '='.repeat((4 - (b.length % 4)) % 4);
  const bin = atob(pad), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(u);
}
function parseEnrollCode(raw) {
  const c = String(raw || '').trim();
  if (!c) return { ok: false, kind: '', why: '', origin: '', masked: '', needsUrl: false };
  const dot = c.indexOf('.'), code = dot >= 0 ? c.slice(0, dot) : c, tail = dot >= 0 ? c.slice(dot + 1) : '';
  if (/^tjc_/.test(code)) return { ok: false, kind: 'tjc', why: 'Fleet 가입 코드(tjc_) — 노드 등록 코드 아님 (Daemon 거절)', origin: '', masked: '', needsUrl: false };
  if (!/^tnc_[A-Za-z0-9_-]+$/.test(code)) return { ok: false, kind: 'bad', why: '꼴 : tnc_<비밀> 또는 tnc_<비밀>.<Master 주소>', origin: '', masked: '', needsUrl: false };
  let origin = '', note = '';
  if (tail) { try { const o = b64urlText(tail).trim().replace(/\/+$/, ''); if (/^https?:\/\/\S+$/i.test(o)) origin = o; else note = '품은 주소 http(s) 아님 — 버림'; } catch (e) { note = '주소 부분 해석 불가 — 비밀만 사용'; } }
  const sec = code.slice(4);
  return { ok: true, kind: 'tnc', why: '', origin, note, masked: 'tnc_' + sec.slice(0, 4) + '…' + ' (' + sec.length + '자)', needsUrl: !origin };
}
const ENROLL_ERR = {   // Daemon enrollment_code_routes.go 의 오류 → 사람이 할 일
  ENROLL_CODE_INVALID: 'Master 가 모르는 코드 — 붙여 넣은 글자 확인',
  ENROLL_CODE_USED: '이미 쓴 코드 — Tree 관리자에게 새 코드 요청',
  ENROLL_CODE_EXPIRED: '기한 지난 코드 — Tree 관리자에게 새 코드 요청',
  ENROLL_CODE_REVOKED: '관리자가 거둔 코드 — Tree 관리자에게 문의',
  ENROLL_MASTER_URL_REQUIRED: '코드에 Master 주소 없음 — Master 주소 칸 입력',
  LOCAL_API_CONFLICT: '이미 등록된 노드(409) — 다른 Tree 로 옮기기 : 그 Tree 에서 노드 삭제 먼저',
  LOCAL_API_CONTROL_REJECTED: 'Master 가 등록 거절 — 같은 이름 노드 확인 (장치 이름 변경 후 재시도)',
  LOCAL_API_UNAVAILABLE: 'Master 응답 없음 — 주소 · 네트워크 확인 후 재시도 (코드 미소비)',
};
function enrollResult(d) {   // 202 응답 → 결과 줄
  const x = (d && d.data) || d || {}, st = x.status || {}, L = [];
  L.push(['등록', st.registered === false ? '아직 아님' : '됨' + (st.node_id ? ' · ' + st.node_id : '')]);
  L.push(['Master', (x.master_url || '—') + (x.master_url_persisted === false ? ' · 설정 저장 실패 — 재시작 시 주소 없음' : '')]);
  L.push(['다시 시작', x.restarting ? '서비스 관리자(' + (x.service_manager || '—') + ') · 종료 코드 ' + (x.exit_code || 75) + ' · 잠깐 끊김' : '직접 재시작 필요 (서비스 관리자 없음)']);
  return L;
}

// ── .tmod — zip, module.json 이 첫 엔트리(terra module pack). 서명은 module.json 안의 signature{algorithm, keyId, issuer, signedAt, value}
//   브라우저는 매니페스트만 읽는다(전체를 풀지 않는다 · 서명을 검증하지 않는다 — 검증은 노드의 keyring 이 설치 때)
const TMOD_MAX = 1 << 20;   // module.json 상한 1 MiB
async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저 압축 풀기(DecompressionStream) 불가');
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function readTmod(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let eo = -1; for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('zip 아님 — .tmod 는 terra module pack 이 만든 zip');
  const n = dv.getUint16(eo + 10, true), cd = dv.getUint32(eo + 16, true), names = []; let p = cd, hit = null;
  if (cd === 0xffffffff || n === 0xffff) throw new Error('zip64 미지원');
  for (let k = 0; k < n; k++) {
    if (p + 46 > u.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 목록 깨짐');
    const meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), usz = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl)); names.push(name);
    if (name === 'module.json') hit = { meth, csz, usz, lo };
    p += 46 + nl + xl + cl;
  }
  if (!hit) throw new Error('module.json 없음 — 모듈 패키지 아님');
  if (hit.usz > TMOD_MAX) throw new Error('module.json 너무 큼 (' + hit.usz + 'B)');
  if (dv.getUint32(hit.lo, true) !== 0x04034b50) throw new Error('module.json 머리 깨짐');
  const at = hit.lo + 30 + dv.getUint16(hit.lo + 26, true) + dv.getUint16(hit.lo + 28, true), body = u.subarray(at, at + hit.csz);
  const raw = hit.meth === 0 ? body : hit.meth === 8 ? await inflateRaw(body) : null;
  if (!raw) throw new Error('모르는 압축 방식 ' + hit.meth);
  let manifest; try { manifest = JSON.parse(new TextDecoder().decode(raw)); } catch (e) { throw new Error('module.json 해석 불가 — ' + e.message); }
  return { manifest, entries: names, first: names[0] === 'module.json' };
}
// 요구 권한 — Manifest v2 permissions{coreOperations[{id|capability, versionRange}], storage, network, secret, native}. v1(배열)도 받는다
const PERM_RISK = { native: 'err', secret: 'warn', network: 'warn' };
function tmodPerms(m) {
  const P = (m && m.permissions) || {};
  if (Array.isArray(P)) return P.map((x) => ({ t: String(x), cls: 'info' }));
  const out = [];
  for (const d of P.coreOperations || []) { const id = (d && (d.id || d.capability)) || ''; if (id) out.push({ t: id + (d.versionRange ? ' ' + d.versionRange : ''), cls: /process|execute|control|write|manage/.test(id) ? 'warn' : 'info' }); }
  for (const k of ['storage', 'network', 'secret', 'native']) for (const x of P[k] || []) out.push({ t: k + ':' + x, cls: PERM_RISK[k] || 'info' });
  return out;
}
function tmodView(r, installed, here) {
  const m = r.manifest || {}, sig = m.signature && typeof m.signature === 'object' ? m.signature : null, perms = tmodPerms(m), C = m.compatibility || {}, W = [];
  if (!m.id || !m.version) W.push({ t: 'id · version 없음 — 설치 불가 매니페스트', cls: 'err' });
  if (!r.first) W.push({ t: 'module.json 이 첫 엔트리 아님 — terra module pack 꼴 아님', cls: 'warn' });
  if (!sig) W.push({ t: '서명 없음 — 개발 모드(module_distribution.allow_dev_install · --dev)에서만 설치 · 신뢰 등급 : development', cls: 'warn' });
  else if (String(sig.algorithm || '').toLowerCase() !== 'ed25519') W.push({ t: '서명 알고리즘 ' + (sig.algorithm || '없음') + ' — ed25519 만 허용 (그 밖은 격리)', cls: 'err' });
  else W.push({ t: '서명 있음 · 검증 : 설치 시 노드 keyring(' + (sig.keyId || '?') + ') · 이 화면은 검증 안 함 · 모르는 키 : 격리', cls: 'info' });
  if (perms.some((p) => p.cls === 'err')) W.push({ t: 'native 권한 — OS 직접 접근', cls: 'err' });
  if (perms.some((p) => p.cls === 'warn')) W.push({ t: '주의할 권한 — 노란 칩', cls: 'warn' });
  if (here && Array.isArray(C.os) && C.os.length && !C.os.includes(here.os)) W.push({ t: '호환 밖 — 이 노드 ' + here.os + ' · 호환 목록 : ' + C.os.join(' · '), cls: 'err' });
  const ex = installed ? (installed.ver === m.version ? '설치됨 ' + installed.ver + ' — 같은 버전' : '설치됨 ' + installed.ver + ' → ' + m.version) : '새 모듈';
  return { id: m.id || '—', name: m.name || m.id || '—', ver: m.version || '—', kind: m.kind || '—', schema: m.schemaVersion != null ? String(m.schemaVersion) : '1',
    signed: !!sig, sigT: sig ? (sig.algorithm || '?') + ' · ' + (sig.signedAt ? String(sig.signedAt).slice(0, 10) : '시각 없음') : '서명 없음', key: sig ? (sig.keyId || '—') + (sig.issuer ? ' · ' + sig.issuer : '') : '—',
    compat: [].concat(C.products || [], C.os || [], C.arch || []).join(' · ') || '제한 없음', perms, warns: W, exists: ex, same: !!installed && installed.ver === m.version, files: (r.entries || []).length };
}

// ── 모듈 배정 진행 — 게시본 → Master 배정 → 제안 도착(offers.get) → 동의 → 설치 · 기동(modules.get)
//   게시본은 따로 읽을 길이 없다(publications.get 은 위임 밖) — Master 가 배정 때 본다: MODULE_NOT_FOUND = 이 Tree 에 게시본 없음
const ASG_STEPS = [['pub', '게시본'], ['asg', 'Master 배정'], ['offer', '제안 도착'], ['consent', '동의'], ['inst', '설치 · 기동']];
const ASG_FIX = {
  MODULE_NOT_FOUND: '게시본 없음 — 이 Tree 에 그 모듈(버전) 없음 · Tree 에서 terra module publish 또는 id · 버전 수정',
  FORBIDDEN: '계정 권한 없음 : module.manage (403) — Tree 관리자에게 요청',
  DELEGATION_NOT_OPEN: '앱 자격 밖 — Tree 웹 콘솔에서 배정',
  PARTITIONED: '노드와 끊김 — 재연결 후 재시도',
  stale: '제안 낡음(stale) — Master 배정 · 노드 게시 불일치 · 지정 해제 후 재지정',
  late: '제안 미도착 — 확인 : 노드 · Master 연결(하트비트) · 설정 › 노드 설정 › 지정 모듈 설치(module_distribution.enabled)',
  wait: '동의 대기 — 이 행의 동의 › 노드가 받아 설치',
  stopped: '설치됨 · 멈춤 — 모듈 창에서 시작',
};
function asgSteps(x, now) {
  const S = {}, post = x.post || {}, off = x.offer || null, mod = x.mod || null, t = now || Date.now();
  let fix = '';
  const code = post.code === 403 || post.code === 'LOCAL_API_FORBIDDEN' ? 'FORBIDDEN' : post.code;
  if (post.st === 'err') { S.pub = code === 'MODULE_NOT_FOUND' ? 'fail' : 'unknown'; S.asg = 'fail'; fix = ASG_FIX[code] || '배정 실패 · ' + (post.code || '오류') + (post.msg ? ' — ' + post.msg : ''); }
  else if (post.st === 'ok' || off || mod) { S.pub = 'done'; S.asg = 'done'; }
  else if (post.st === 'wait') { S.pub = 'unknown'; S.asg = 'now'; }
  else { S.pub = 'unknown'; S.asg = 'wait'; }
  if (S.asg === 'done') {
    if (off || mod) S.offer = 'done'; else { S.offer = 'now'; if (post.at && t - post.at > 60000) fix = ASG_FIX.late; }
    if (off && off.state === 'stale') { S.offer = 'fail'; fix = ASG_FIX.stale; }
    if (mod || (off && (off.st === 'consent' || off.st === 'done'))) S.consent = 'done';
    else if (off && off.st === 'wait' && S.offer !== 'fail') { S.consent = 'now'; fix = fix || ASG_FIX.wait; }
    else S.consent = 'wait';
    if (mod && mod.st === 'run') S.inst = 'done';
    else if (mod && mod.st === 'fail') { S.inst = 'fail'; fix = '설치 · 기동 실패' + (mod.err ? ' · ' + mod.err : '') + ' — 확인 : 모듈 창 로그 · 설치 용량(module_distribution.disk_quota_mb)'; }
    else if (mod) { S.inst = 'now'; fix = fix || (mod.st === 'stop' ? ASG_FIX.stopped : ''); }
    else S.inst = S.consent === 'done' ? 'now' : 'wait';
  }
  const steps = ASG_STEPS.map(([k, label]) => ({ key: k, label, st: S[k] || 'wait' }));
  const done = steps.filter((s) => s.st === 'done').length, fail = steps.some((s) => s.st === 'fail');
  return { steps, pct: Math.round((done / steps.length) * 100), fix, fail, end: fail || S.inst === 'done' || (S.inst === 'now' && mod && mod.st === 'stop') };
}

// ── 네트워크 쓰기 — Master 계약의 op(전부 node.control). 입력 모양은 Master 라우트의 입력 구조체 그대로(routes_network.go)
//   f: 칸 [id, 이름, 자리글, 'node'|'text'|'bool'] · input(values, ctx) → op 입력 · undo: 되돌리기 안내
const NET_WRITES = [
  { id: 'reconcile', tab: 'mesh', label: '자동 조정', op: 'terra.master.network.mesh.wireguard.reconcile.post', risk: 'dangerous', f: [],
    what: 'Tree(클러스터) 전체 WireGuard 메시 → Master 원하는 상태 — 모든 노드 피어 · 주소 재배포', input: () => ({}),
    undo: '없음 — 원하는 상태 맞춤만 · 결과 : 조작 이력 탭(network.logs)', where: 'Tree 전체' },
  { id: 'plan', tab: 'mesh', label: '수동 계획', op: 'terra.master.network.mesh.wireguard.plan.post', risk: 'write', f: [['nodes', '노드 id(쉼표 · 둘 이상)', 'nd_a, nd_b', 'text'], ['cidr', 'CIDR', '100.80.0.0/24', 'text'], ['listen_port', '수신 포트', '51820', 'text']],
    what: '고른 노드로 관리 메시 새 계획 (주소 · 키 배포)', input: (v) => { const o = { nodes: String(v.nodes || '').split(/[\s,]+/).filter(Boolean).map((id) => ({ node_id: id })) }; if (v.cidr) o.cidr = v.cidr; if (/^\d+$/.test(v.listen_port || '')) o.listen_port = +v.listen_port; return o; },
    check: (v) => (String(v.nodes || '').split(/[\s,]+/).filter(Boolean).length < 2 ? '노드 둘 이상 필요' : v.cidr && !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(v.cidr) ? 'CIDR 꼴 : 100.80.0.0/24' : ''),
    undo: '새 계획으로 덮어쓰기 — 이전 계획 : 조작 이력 탭', where: '고른 노드' },
  { id: 'revoke', tab: 'peers', label: '피어 철회', op: 'terra.master.network.mesh.wireguard.peers.revoke.post', risk: 'dangerous', f: [['source_node_id', '출발 노드', '', 'node'], ['target_node_id', '상대 노드', '', 'node'], ['bidirectional', '양쪽 다', '', 'bool']],
    what: '두 노드 사이 WireGuard 피어 제거 — 그 사이 메시 경로 끊김', input: (v) => ({ source_node_id: v.source_node_id, target_node_id: v.target_node_id, bidirectional: v.bidirectional !== false }),
    check: (v) => (!v.source_node_id || !v.target_node_id ? '두 노드 선택' : v.source_node_id === v.target_node_id ? '서로 다른 노드 필요' : ''),
    undo: '수동 계획 · 자동 조정으로 다시 붙이기 (메시 탭)', where: '두 노드' },
  { id: 'probe', tab: 'probes', label: 'probe 실행', op: 'terra.master.network.probes.post', risk: 'write', f: [['source_node_id', '출발 노드', '', 'node'], ['target_node_id', '도착 노드', '', 'node'], ['adapter', '어댑터(비우면 전부)', 'wireguard', 'text']],
    what: '출발 → 도착 노드 연결 진단 (접수만 — 결과 : probe 탭 관측 시각 갱신 시)', input: (v) => { const o = { source_node_id: v.source_node_id, target_node_id: v.target_node_id }; if (v.adapter) o.adapter = v.adapter; return o; },
    check: (v) => (!v.source_node_id || !v.target_node_id || v.source_node_id === v.target_node_id ? '서로 다른 두 노드 필요' : ''),
    undo: '없음 — 진단만', where: '출발 노드' },
  { id: 'policyPut', tab: 'policies', label: '정책 저장', op: 'terra.master.route.policies.put', risk: 'write', f: [['source_node_id', '출발 노드(비우면 전부)', '', 'node'], ['target_node_id', '도착 노드(비우면 전부)', '', 'node'], ['channel', '채널', 'service_tunnel', 'text'], ['mode', '방식', 'prefer', 'text'], ['prefer', '선호 경로(쉼표)', 'mesh_direct, master_relay', 'text'], ['deny', '막을 경로(쉼표)', '', 'text']],
    what: '그 범위의 경로 선택 규칙 저장 — 다음 경로부터 적용', input: (v) => { const L = (s) => String(s || '').split(/[\s,]+/).filter(Boolean), sc = {}, po = {}; for (const k of ['source_node_id', 'target_node_id', 'channel']) if (v[k]) sc[k] = v[k]; if (v.mode) po.mode = v.mode; if (L(v.prefer).length) po.prefer = L(v.prefer); if (L(v.deny).length) po.deny = L(v.deny); return { scope: sc, policy: po }; },
    undo: '같은 탭에서 그 정책 지우기', where: '고른 범위' },
  { id: 'policyDel', tab: 'policies', label: '정책 지우기', op: 'terra.master.route.policies.by-policy-id.delete', risk: 'write', f: [['policy_id', '정책 id', 'rp_…', 'text']],
    what: '그 정책 삭제 — 그 범위는 기본 규칙으로', input: (v) => ({ policy_id: v.policy_id }), check: (v) => (!v.policy_id ? '정책 id 필요' : ''),
    undo: '같은 범위로 다시 저장 (지우기 전 값 : 이 탭 목록 — 미리 기록)', where: 'Tree' },
  { id: 'sessionClose', tab: 'sessions', label: '세션 닫기', op: 'terra.master.route.sessions.by-session-id.close.post', risk: 'dangerous', f: [['session_id', '세션 id', 'rt_…', 'text']],
    what: '그 경로 세션 끊기 — 그 위 터널 · 스트림 즉시 끊김', input: (v) => ({ session_id: v.session_id }), check: (v) => (!v.session_id ? '세션 id 필요' : ''),
    undo: '없음 — 쓰던 쪽이 다시 열기', where: '두 노드' },
  { id: 'groupClose', tab: 'sessions', label: '연결 그룹 닫기', op: 'terra.master.connection-groups.by-group-id.close.post', risk: 'dangerous', f: [['group_id', '그룹 id', 'cg_…', 'text']],
    what: '연결 그룹 · 그 안 세션 모두 닫기', input: (v) => ({ group_id: v.group_id }), check: (v) => (!v.group_id ? '그룹 id 필요' : ''),
    undo: '없음 — 그룹 재생성 필요', where: '그룹의 노드들' },
];

// ── 서비스 터널 열기 — Master service-tunnels.open.post(serviceTunnelPlanInput) — 출발 = 이 노드. 받는 쪽 · 듣는 쪽 모두 loopback 만(Daemon validateOpenRequest)
function tunnelInput(v, srcId) {
  const tp = Number(v.target_port), lp = v.local_port === '' || v.local_port == null ? 0 : Number(v.local_port), mc = v.max_connections === '' || v.max_connections == null ? 1 : Number(v.max_connections);
  if (!srcId) return { err: '이 노드의 Master id 모름' };
  if (!v.target_node_id) return { err: '대상 노드 선택' };
  if (v.target_node_id === srcId) return { err: '대상은 다른 노드' };
  if (!Number.isInteger(tp) || tp < 1 || tp > 65535) return { err: '대상 포트 1–65535' };
  if (!Number.isInteger(lp) || lp < 0 || lp > 65535) return { err: '로컬 포트 0(자동)–65535' };
  if (!Number.isInteger(mc) || mc < 1 || mc > 64) return { err: '최대 연결 1–64' };
  const input = { source_node_id: srcId, target_node_id: v.target_node_id, service_id: v.service_id || ('tcp-' + tp), target_host: '127.0.0.1', target_port: tp, local_bind_host: '127.0.0.1', local_port: lp, max_connections: mc };
  return { err: '', input };
}
/* @flows:end */

export { DECIDE, CONTRACT_WHY, parseEnrollCode, ENROLL_ERR, enrollResult, readTmod, tmodPerms, tmodView, ASG_STEPS, ASG_FIX, asgSteps, NET_WRITES, tunnelInput };
