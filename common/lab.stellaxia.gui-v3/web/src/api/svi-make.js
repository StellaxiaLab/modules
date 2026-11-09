// SVI 창(보드 NodeSvi)의 틀 — 유형(스키마) → 입력 양식 → 선언 · 허가 · 끌어다 연결 · 연결 상태.
//
// 틀의 약속(사용자 제안 2026-11-02): 새 SVI 유형이 내놓을 것은 "어댑터 하나와 그 설정 스키마"뿐. 입력 양식 · 수명(선언 · 해제 · 교체) ·
// 허가 · 연결 화면은 이 틀이 공통으로. 스키마는 모듈 설정과 같은 JSON Schema 부분집합(manifest-v2 configuration.schema).
//
// Terra 의 지금(origin/main 25a5e2c3):
//   선언   terra.daemon.svi.declarations.post — family process | file | net 셋만(additionalProperties false). scope local · cluster(원격 노드도), node.config
//          울타리(svi.runtime: file_roots · process · process_commands · net · net_endpoints)는 설정 파일 + 재시작으로만 — 밖이면 SVI_DECLARATION_OUTSIDE_ENVELOPE
//          declarations.get 이 envelope 를 준다 → 양식이 미리 알린다
//   허가   terra.master.svi.grants.* — 앱 자격: 본인에게 inspect · read · subscribe · bind.source · bind.target, 같은 클러스터 노드에게 read · subscribe · bind.source, 기한 90일 이하
//   연결   terra.master.svi.bindings.post — 만든 사람이 원천에 bind.source · 대상에 bind.target 본인 허가를 가져야(소유자도). 202 비동기
//          observed_state requested · validating · planning · preparing · active · degraded · failed · closing · closed + reason
// Terra 에 아직 없는 것(코어 몫) — 이 틀은 자리만 둔다:
//   모듈이 유형 + 설정 스키마를 내놓는 길(contributions.svi 는 불리언 둘), 유형 목록 operation, 선언을 모듈 어댑터로 넘기는 길
//   → 모듈 유형은 module.json contributions.svi.types[{ id, title, schema, … }](제안)을 읽어 보이기만 하고 '만들기'는 잠근다
//   "유휴"(이어졌지만 흐르지 않음) — binding 에 마지막 프레임 시각 · 수가 없다

import { TerraError } from './terra.js';
import { checkGrant, selfIdOf } from './svi-grant.js';

// ── 유형 ──
const ABS = '^(/|[A-Za-z]:[\\\\/])';   // 절대 경로(Linux · Windows)
/** 내장 유형 — Daemon 선언 API 의 입력(terra-api.json svi.declarations.post)을 유형마다 스키마로 옮긴 것 */
export const BUILTIN_TYPES = [
  { id: 'file', family: 'file', title: '파일', icon: 'file', desc: '파일 하나를 자원으로 — 읽기(처음부터 끝까지 한 번 흘림) 또는 쓰기',
    schema: { type: 'object', required: ['path'], properties: {
      path: { type: 'string', title: '경로', description: '절대 경로 — 울타리(file_roots) 안', pattern: ABS, format: 'path' },
      direction: { type: 'string', title: '방향', enum: ['source', 'sink'], 'x-labels': ['읽기 — 내보냄', '쓰기 — 받음'], default: 'source' } } } },
  { id: 'process', family: 'process', title: '프로그램', icon: 'term', desc: '프로그램 실행 — 표준 입출력을 자원으로',
    schema: { type: 'object', required: ['command'], properties: {
      command: { type: 'string', title: '실행 파일', description: '절대 경로 — 울타리(process · process_commands) 허용분', pattern: ABS, format: 'path' },
      args: { type: 'array', items: { type: 'string' }, title: '인자', description: '빈칸으로 나눔' },
      direction: { type: 'string', title: '방향', enum: ['source', 'sink'], 'x-labels': ['출력 내보냄', '입력 받음'], default: 'source' } } } },
  { id: 'net', family: 'net', title: '네트워크 주소', icon: 'net', desc: 'TCP · UDP 주소 — 연결 또는 수신 · 바이트 송수신',
    schema: { type: 'object', required: ['address'], properties: {
      address: { type: 'string', title: '주소', description: 'tcp://호스트:포트 또는 udp://호스트:포트 — 울타리(net_endpoints) 안', pattern: '^(tcp|udp)://[^\\s/]+:\\d{1,5}$' },
      mode: { type: 'string', title: '방식', enum: ['connect', 'listen'], 'x-labels': ['연결 — 그 주소로 접속', '수신 — 그 주소에서 대기'], default: 'connect' },
      framing: { type: 'string', title: '나눔', enum: ['chunk', 'line'], 'x-labels': ['조각', '줄'], default: 'chunk' },
      direction: { type: 'string', title: '방향', enum: ['source', 'sink'], 'x-labels': ['받은 것 내보냄', '들어온 것 보냄'], default: 'source' } } } },
];
/** 모듈이 내놓은 유형 — module.json contributions.svi.types(제안). 지금 Terra 에는 이 자리가 없어 모듈 목록에 있으면 보이기만 한다 */
export function moduleTypes(mods) {
  const out = [];
  for (const m of Array.isArray(mods) ? mods : []) {
    const C = m && ((m.manifest && m.manifest.contributions) || m.contributions), T = C && C.svi && C.svi.types;
    for (const t of Array.isArray(T) ? T : []) if (t && t.id && t.schema) out.push({ id: (m.id || m.module_id) + '/' + t.id, module: m.id || m.module_id, moduleName: m.name || m.id, title: t.title || t.id, desc: t.description || '', icon: t.icon || 'puzzle', schema: t.schema, family: null });
  }
  return out;
}

// ── 양식 ──
/**
 * 스키마 → 칸. string(enum 이면 고르기 · format path) · integer · number · boolean · array(of string — 빈칸으로)
 * @returns {{ key: string, title: string, desc: string, kind: 'text'|'path'|'enum'|'number'|'bool'|'list', required: boolean, value: any, options?: { v: string, label: string }[], err: string }[]}
 */
export function formFields(schema, values = {}, errs = {}) {
  const P = (schema && schema.properties) || {}, req = new Set((schema && schema.required) || []);
  return Object.keys(P).map((key) => {
    const p = P[key], v = key in values ? values[key] : p.default;
    const kind = p.enum ? 'enum' : p.type === 'boolean' ? 'bool' : p.type === 'integer' || p.type === 'number' ? 'number' : p.type === 'array' ? 'list' : p.format === 'path' ? 'path' : 'text';
    return { key, title: p.title || key, desc: p.description || '', kind, required: req.has(key), value: kind === 'list' ? (Array.isArray(v) ? v.join(' ') : v || '') : v ?? '',
      options: p.enum ? p.enum.map((e, i) => ({ v: e, label: (p['x-labels'] && p['x-labels'][i]) || String(e) })) : undefined, err: errs[key] || '' };
  });
}
/** 값 → 스키마 꼴(목록은 빈칸으로 나눔 · 수는 수로) */
export function castValues(schema, raw = {}) {
  const P = (schema && schema.properties) || {}, out = {};
  for (const k of Object.keys(P)) {
    const p = P[k]; let v = k in raw ? raw[k] : p.default; if (v === '' || v == null) continue;
    if (p.type === 'array') v = Array.isArray(v) ? v : String(v).split(/\s+/).filter(Boolean);
    else if (p.type === 'integer' || p.type === 'number') v = Number(v);
    else if (p.type === 'boolean') v = v === true || v === 'true';
    out[k] = v;
  }
  return out;
}
export const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
/** 이름 · 스키마 검사 → { 칸: 사유 } (빈 객체면 통과) */
export function validate(schema, name, raw) {
  const e = {}, P = (schema && schema.properties) || {}, v = castValues(schema, raw);
  if (!name) e.name = '이름 필요'; else if (!NAME_RE.test(name)) e.name = '소문자 · 숫자 · - 만(앞뒤는 - 아님)';
  for (const k of (schema && schema.required) || []) if (v[k] == null || (Array.isArray(v[k]) && !v[k].length)) e[k] = '필요';
  for (const [k, p] of Object.entries(P)) {
    if (e[k] || v[k] == null) continue;
    if (p.pattern && typeof v[k] === 'string' && !new RegExp(p.pattern).test(v[k])) e[k] = p.format === 'path' ? '절대 경로 필요' : '형식 불일치';
    if (p.enum && !p.enum.includes(v[k])) e[k] = '선택지 밖 값';
    if ((p.type === 'integer' || p.type === 'number') && Number.isNaN(v[k])) e[k] = '숫자 필요';
  }
  return e;
}
/** 내장 유형 → declarations.post 입력 */
export function toDeclaration(type, name, raw, o = {}) {
  if (!type.family) throw new TerraError('NOT_SUPPORTED', type.title + ' — 모듈 유형 자원 만들기 : Terra 미지원', 0);
  const v = castValues(type.schema, raw), d = { family: type.family, name, direction: v.direction || 'source' };
  if (type.family === 'file') d.path = v.path;
  if (type.family === 'process') { d.command = v.command; if (v.args && v.args.length) d.args = v.args; }
  if (type.family === 'net') { d.address = v.address; d.mode = v.mode || 'connect'; d.framing = v.framing || 'chunk'; }
  if (o.replace) d.replace = true;
  return d;
}
/** 울타리(declarations.get 의 envelope) 안인지 미리 — { ok, why } (모르면 ok) */
export function envelopeCheck(env, type, raw) {
  if (!env || !type.family) return { ok: true, why: '' };
  const v = castValues(type.schema, raw), A = (x) => (Array.isArray(x) ? x : []);
  const under = (p, roots) => roots.some((r) => { const R = String(r.path || r).replace(/[\\/]+$/, ''); return p === R || p.startsWith(R + '/') || p.startsWith(R + '\\'); });
  if (type.family === 'file') { const roots = A(env.file_roots); if (!roots.length) return { ok: false, why: '파일 자원 닫힘 (file_roots 비어 있음)' }; if (v.path && !under(v.path, roots)) return { ok: false, why: '열린 폴더 밖 — ' + roots.map((r) => r.path || r).join(', ') }; }
  if (type.family === 'process') { const m = env.process || 'off'; if (m === 'off') return { ok: false, why: '프로그램 자원 닫힘 (process off)' }; if (m === 'allowlist' && v.command && !A(env.process_commands).includes(v.command)) return { ok: false, why: '허용 목록 밖 프로그램 — ' + (A(env.process_commands).join(', ') || '없음') }; }
  if (type.family === 'net') { if (env.net === false || env.net === 'off') return { ok: false, why: '네트워크 자원 닫힘 (net off)' }; const E = A(env.net_endpoints); if (E.length && v.address && !E.some((x) => String(x.address || x) === v.address)) return { ok: false, why: '허용 목록 밖 주소 — ' + E.map((x) => x.address || x).join(', ') }; }
  return { ok: true, why: '' };
}
/** 울타리 요약 한 줄씩 */
export function envelopeLines(env) {
  if (!env) return [];
  const A = (x) => (Array.isArray(x) ? x : []);
  return [['파일', A(env.file_roots).length ? A(env.file_roots).map((r) => (r.path || r) + (r.mode ? ' (' + r.mode + ')' : '')).join(', ') : '닫힘'],
    ['프로그램', (env.process || 'off') === 'off' ? '닫힘' : env.process === 'any' ? '모두' : '허용 목록 — ' + (A(env.process_commands).join(', ') || '없음')],
    ['네트워크', env.net === false || env.net === 'off' || (!env.net && !A(env.net_endpoints).length) ? '닫힘' : A(env.net_endpoints).map((x) => x.address || x).join(', ') || '열림'],
    ['최대 선언', env.max_declarations != null ? String(env.max_declarations) : '—']];
}

// ── 연결 ──
const PAIRS = { stream: ['stream', 'blob'], snapshot: ['command'], blob: ['blob'], collection: ['collection'], command: ['command'], duplex: ['duplex', 'stream'] };
const schemaName = (s) => String(s || '').replace(/@\d+$/, ''), schemaMajor = (s) => (/@(\d+)$/.exec(String(s || '')) || [])[1];
/** 원천 끝 → 대상 끝을 이을 수 있나(terra-svi compatibility.go EvaluateBinding 의 앞부분) — { ok, why } */
export function canLink(src, dst) {
  if (!src || !dst) return { ok: false, why: '' };
  if (src.resId === dst.resId) return { ok: false, why: '같은 자원' };
  if (!['source', 'duplex'].includes(src.dir)) return { ok: false, why: '원천 : 내보냄 없음' };
  if (!['sink', 'duplex'].includes(dst.dir)) return { ok: false, why: '대상 : 받음 없음' };
  if (src.interaction && dst.interaction && !(PAIRS[src.interaction] || []).includes(dst.interaction)) return { ok: false, why: src.interaction + ' → ' + dst.interaction + ' 연결 불가' };
  if (src.schema && dst.schema && schemaName(src.schema) !== schemaName(dst.schema)) return { ok: false, why: '형식 불일치 — ' + src.schema + ' → ' + dst.schema };
  if (src.schema && dst.schema && schemaMajor(src.schema) !== schemaMajor(dst.schema)) return { ok: true, why: '판 다름 — 변환 필요 가능' };
  return { ok: true, why: '' };
}
const REASON = {
  participant_disconnected: '한쪽 노드 연결 끊김', participant_closed: '한쪽 닫음', route_failed: '경로 실패', consumer_requested: '사용자 닫음', source_completed: '원천 끝남(파일 끝 등)',
  resource_withdrawn: '자원 선언 해제', resource_replaced: '자원 교체됨', grant_revoked: '허가 회수', authorization_lost: '권한 잃음', flow_not_allowed: '흐름 허용 목록 밖',
  missing_bind_grant: '연결 허가 없음', no_common_qos_profile: '맞는 품질 없음', target_commit_failed: '대상 확정 실패', source_commit_failed: '원천 확정 실패',
};
export const reasonText = (r) => { if (!r) return ''; const raw = String(r), k = raw.split(':')[0].trim(), t = REASON[k], rest = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).trim() : ''; return t ? t + (rest ? ' — ' + rest : '') : raw; };
/** 연결 상태 → 화면 — 연결됨 · 연결 중 · 끊김(자동 복구) · 실패 · 닫힘, 사유는 한국어로. "유휴"는 Terra 가 보고하지 않는다 */
export function bindingState(b) {
  const o = (b && (b.observed_state || b.state)) || '', r = b && b.reason;
  const S = { active: ['연결됨', 'ok'], degraded: ['끊김', 'warn'], failed: ['실패', 'err'], closing: ['닫는 중', 'dim'], closed: ['닫힘', 'dim'], requested: ['연결 중', 'busy'], validating: ['연결 중', 'busy'], planning: ['연결 중', 'busy'], preparing: ['연결 중', 'busy'] }[o] || [o || '—', 'dim'];
  return { label: S[0], cls: S[1], reason: o === 'active' ? '' : reasonText(r), raw: o, live: o !== 'closed' && o !== 'failed', idle: null };
}

// ── 부르는 것 ──
/**
 * @param {{ invoke: (op: string, input?: object, at?: { node?: string }) => Promise<any> }} terra
 * @param {() => any} topo window.TerraTopology — localId
 * @param {() => any} who window.TerraWho — principal
 */
export function createSviMake(terra, topo, who) {
  const at = (rid) => { const T = topo(); return rid && !(T && T.localId === rid) ? { node: rid } : {}; };
  const A = (d, ...k) => { if (Array.isArray(d)) return d; for (const x of k) if (d && Array.isArray(d[x])) return d[x]; return []; };
  const ep = (r, e) => ({ resId: r.resource_id, resName: r.display_name || r.canonical_name || r.resource_id, node: r.node_id || '', kind: r.kind || '', epId: e.endpoint_id, dir: e.direction || '', interaction: e.interaction || '',
    schema: e.direction === 'sink' ? e.input_schema || e.output_schema || '' : e.output_schema || e.input_schema || '', status: e.status || r.status || '', ops: A(e.operations) });
  let selfP = null;
  /** 본인 사용자 id — 이미 있는 본인 허가의 주체, 없으면 whoami principal('… via 앱' 앞 · 'user:' 뒤) */
  const self = () => selfP || (selfP = terra.invoke('terra.master.svi.grants.get', { subject_type: 'user', limit: 50 }).then((d) => { const g = A(d, 'items', 'grants').find((x) => x.subject && x.subject.type === 'user'); if (g) return g.subject.id; throw 0; })
    .catch(() => { const p = selfIdOf(who()); if (!p) { selfP = null; throw new TerraError('NO_USER', '로그인 사용자 모름', 0); } return p; }));
  const api = {
    /** 그 노드의 선언 · 울타리 + 클러스터의 자원(끝) · 허가 · 연결 */
    async load(rid) {
      const [dec, res, gr, bd, ns] = await Promise.all([
        terra.invoke('terra.daemon.svi.declarations.get', {}, at(rid)).then((d) => ({ ok: true, d }), (e) => ({ ok: false, e })),
        terra.invoke('terra.master.svi.resources.get', { limit: 200 }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, e })),
        terra.invoke('terra.master.svi.grants.get', { limit: 200 }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, e })),
        terra.invoke('terra.master.svi.bindings.get', {}).then((d) => ({ ok: true, d }), (e) => ({ ok: false, e })),
        terra.invoke('terra.master.nodes.get', {}).then((d) => ({ ok: true, d }), (e) => ({ ok: false, e })),
      ]);
      const miss = [['선언', dec], ['자원', res], ['허가', gr], ['연결', bd]].filter(([, x]) => !x.ok).map(([k, x]) => k + ' ' + ((x.e && x.e.code) || ''));
      const D = dec.ok ? dec.d || {} : {}, R = res.ok ? A(res.d, 'items', 'resources') : [];
      return { miss, envelope: D.envelope || null, storeError: D.store_error || '',
        decls: A(D.declarations).map((x) => ({ family: x.family, name: x.name, dir: x.direction, resId: x.resource_id || '', origin: x.origin || '', state: x.state || '', reason: x.reason || '', at: x.declared_at || '', detail: x.path || x.command || x.address || '' })),
        retired: A(D.retired).map((x) => ({ family: x.family, name: x.name })),
        nodes: ns.ok ? A(ns.d, 'nodes').map((n) => ({ id: n.node_id, name: n.display_name || String(n.node_id).slice(0, 10) })) : [],
        eps: R.flatMap((r) => A(r.endpoints).map((e) => ep(r, e))),
        grants: gr.ok ? A(gr.d, 'items', 'grants').map((g) => ({ id: g.grant_id, type: g.subject && g.subject.type, subject: g.subject && g.subject.id, resId: g.resource_id, ops: A(g.operations), expires: g.expires_at || '' })) : [],
        bindings: bd.ok ? A(bd.d, 'items', 'bindings').map((b) => ({ id: b.binding_id, src: b.source || {}, dst: b.target || {}, srcNode: b.source_node_id, dstNode: b.target_node_id, st: bindingState(b), at: b.updated_at || b.created_at || '' })) : [] };
    },
    declare: (rid, input) => terra.invoke('terra.daemon.svi.declarations.post', input, at(rid)),
    undeclare: (rid, family, name) => terra.invoke('terra.daemon.svi.declarations.by-family.by-name.undeclare.post', { family, name }, at(rid)),
    grant: (resId, nodeId, ops, ttl) => api.grantTo('node', nodeId, resId, ops, ttl),
    /** 주체(node · user) 허가 — 위임 가드(svi-grant.js checkGrant)를 먼저 보고 막히면 부르지 않는다. user 는 나 자신만 */
    async grantTo(type, id, resId, ops, ttl) {
      const g = { subject_type: type, subject_id: id, resource_id: resId, operations: ops, ttl_seconds: ttl }, c = checkGrant(g, type === 'user' ? await self() : '');
      if (!c.ok) throw new TerraError('FORBIDDEN', c.why, 0);
      return terra.invoke('terra.master.svi.grants.post', g);
    },
    /** 이 계정의 사용자 id(본인 허가 · '나' 칩) */
    selfId: () => self(),
    /** 바로 아는 사용자 id — whoami 에서(없으면 '') */
    selfNow: () => selfIdOf(who()),
    revoke: (grantId) => terra.invoke('terra.master.svi.grants.by-grant-id.delete', { grant_id: grantId }),
    /** 끌어다 놓기 한 번 — 본인 허가(원천 bind.source · 대상 bind.target, 없으면 7일) → bindings.post */
    async link(src, dst, o = {}) {
      const c = canLink(src, dst); if (!c.ok) throw new TerraError('SVI_BINDING_DENIED', c.why, 0);
      const me = await self(), have = A((await terra.invoke('terra.master.svi.grants.get', { subject_type: 'user', subject_id: me, limit: 200 })), 'items', 'grants');
      const need = [[src.resId, 'bind.source'], [dst.resId, 'bind.target']].filter(([r, op]) => !have.some((g) => g.resource_id === r && A(g.operations).includes(op)));
      for (const [r, op] of need) await terra.invoke('terra.master.svi.grants.post', { subject_type: 'user', subject_id: me, resource_id: r, operations: [op], ttl_seconds: o.ttl || 604800 });
      return terra.invoke('terra.master.svi.bindings.post', { source_resource_id: src.resId, source_endpoint_id: src.epId, target_resource_id: dst.resId, target_endpoint_id: dst.epId, qos_profile: o.qos || 'reliable_ordered',
        idempotency_key: 'gui-v3-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) });
    },
    unlink: (id) => terra.invoke('terra.master.svi.bindings.by-binding-id.delete', { binding_id: id }),
  };
  return api;
}
