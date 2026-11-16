// op 콘솔 — Gateway 카탈로그의 모든 operation 을 GUI 에서 부르는 범용 화면의 순수 함수 층 (ADR-GW-014 P17-1).
//
//   카탈로그(GET /api/v1/catalog · /catalog/operations/{id}) → 목록 · 검색 · 분류 → 입력 스키마 폼 → 등급별 호출
//
//   등급  T0 읽기 · T1 쓰기 · T2 앱 확인 창(이 화면의 두 번 누르기) · T3 승인 문 · T4 승인 문 + 재인증
//         계약 execution.approval.tier 가 T3 · T4 를 정한다(카탈로그가 그대로 실어 준다). 그 밖은 위험도로:
//         read → T0 · dangerous / privileged 이거나 확인(confirmationMode)이 required → T2 · 나머지 → T1
//   길    T0 · T1 · T2 는 앱 토큰으로 곧장(transport.invoke). T3 · T4 는 호스트의 승인 문(approveOp) — 사람이 승인해야 호스트가 사람 세션으로 부른다
//   잠금  T0~T2 는 gates.js(앱 토큰에 열렸나 · 사람 권한 · 이 노드에서만). T3 · T4 는 게이트가 아니라 승인 문이 있느냐(Terra 셸 안 앱) 만 본다
//   결과  secret_result 로 선언된 칸은 승인 문 화면에만 보인다 — 호스트가 페이지에 안 주므로(withheld) 콘솔은 '숨김' 줄만 낸다
//
// 보드(design/OpConsole.dc.html)는 이 파일의 사본을 든다(tests/opconsole-board.test.mjs 가 같은지 본다).

export const TIERS = [['T0', '읽기'], ['T1', '쓰기'], ['T2', '앱 확인'], ['T3', '승인 문'], ['T4', '승인+재인증']];
const TIER_NAME = Object.fromEntries(TIERS);

/** 카탈로그 항목 하나의 등급 */
export function tierOf(op) {
  const ex = (op && op.execution) || {}, ap = ex.approval;
  if (ap && (ap.tier === 'T3' || ap.tier === 'T4')) return ap.tier;
  const risk = ex.risk || '', conf = ex.confirmationMode || '';
  if (risk === 'read') return 'T0';
  if (risk === 'dangerous' || risk === 'privileged' || conf === 'required' || conf === 'always') return 'T2';
  return risk ? 'T1' : (/\.(get|list)$/.test(op.operationId || '') ? 'T0' : 'T1');   // 계약이 위험도를 안 적었으면 이름으로 짐작(읽기 동사만) — 모르면 쓰기로 보수적으로
}

/** 카탈로그 응답 → 콘솔 목록 항목 */
export function normalizeCatalog(raw) {
  const list = Array.isArray(raw) ? raw : (raw && (raw.operations || raw.items)) || [];
  return list.filter((o) => o && o.operationId).map((o) => {
    const ex = o.execution || {}, ap = ex.approval || null;
    return {
      id: o.operationId, title: o.title || '', summary: o.summary || '', category: o.category || categoryOf(o.operationId), tags: o.tags || [],
      tier: tierOf(o), risk: ex.risk || '', perms: o.permissions || [], out: (o.output && o.output.mode) || '',
      scopes: (o.availability && o.availability.scopes) || [], approval: ap ? { tier: ap.tier, impact: ap.impact || '', inputs: ap.inputs || [], sw: ap.switch || '', secret: ap.secret_result || [] } : null,
      stream: ((o.output && o.output.mode) || '') === 'stream',
    };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
}
/** 분류가 비었을 때 — terra.daemon.modules.get → 'daemon · modules' 처럼 id 앞 두 마디 */
export function categoryOf(id) { const p = String(id).split('.'); return p.length > 2 ? p[1] + ' · ' + p[2] : p[1] || p[0] || '기타'; }

/** 분류 칩 — [[이름, 개수], …] 개수 많은 순 */
export function categories(items) {
  const m = new Map(); for (const o of items) m.set(o.category, (m.get(o.category) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
/** 검색(공백으로 나눈 낱말이 모두 id · 제목 · 요약 · 태그 · 분류에 든다) · 분류 · 등급 */
export function filterOps(items, f = {}) {
  const words = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((o) => {
    if (f.cat && o.category !== f.cat) return false;
    if (f.tier && o.tier !== f.tier) return false;
    if (!words.length) return true;
    const hay = (o.id + ' ' + o.title + ' ' + o.summary + ' ' + o.category + ' ' + o.tags.join(' ')).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ── 입력 스키마 → 폼 ──
const pickType = (s) => { const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type; return t || (s.enum ? 'string' : s.properties ? 'object' : s.items ? 'array' : 'string'); };
/**
 * JSON Schema(최상위 object) → 칸 목록. 평평한 입력이라 최상위 속성만 칸이 된다.
 * 칸 종류 kind : text · number · bool · enum · json(배열 · 객체 — JSON 으로 적는다)
 * 스키마가 object 가 아니거나 속성이 없으면 { fields: [], free: true } — 칸 없이 JSON 한 칸(자유 입력)
 */
export function formFields(schema) {
  const s = schema && typeof schema === 'object' ? schema : null;
  if (!s || !s.properties || typeof s.properties !== 'object') return { fields: [], free: !s || pickType(s) === 'object' || !s.type };
  const req = new Set(Array.isArray(s.required) ? s.required : []);
  const fields = Object.entries(s.properties).map(([key, p]) => {
    const sc = p && typeof p === 'object' ? p : {}, t = pickType(sc);
    const kind = sc.enum ? 'enum' : t === 'boolean' ? 'bool' : t === 'integer' || t === 'number' ? 'number' : t === 'array' || t === 'object' ? 'json' : 'text';
    return { key, label: sc.title || key, desc: sc.description || '', kind, type: t, required: req.has(key), enum: sc.enum ? sc.enum.map(String) : [], def: sc.default, secret: sc.format === 'password' || sc.writeOnly === true, fmt: sc.format || '' };
  });
  return { fields, free: false };
}
/** 칸의 처음 값(문자열 — 입력 칸이 든다) */
export function initialValues(fields) {
  const v = {}; for (const f of fields) v[f.key] = f.def === undefined ? (f.kind === 'bool' ? 'false' : '') : f.kind === 'json' ? JSON.stringify(f.def) : String(f.def);
  return v;
}
/**
 * 칸 값(문자열) → 입력 JSON. 빈 칸은 안 보낸다(필수면 오류). 오류는 { 칸: 문구 }
 * @returns {{ ok: boolean, input: Record<string, unknown>, errors: Record<string, string> }}
 */
export function buildInput(fields, values) {
  const input = {}, errors = {};
  for (const f of fields) {
    const raw = values[f.key] == null ? '' : String(values[f.key]), blank = raw.trim() === '';
    if (f.kind === 'bool') { if (raw === 'true' || raw === 'false') input[f.key] = raw === 'true'; else if (f.required) errors[f.key] = '필수'; continue; }
    if (blank) { if (f.required) errors[f.key] = '필수'; continue; }
    if (f.kind === 'number') { const n = Number(raw); if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) errors[f.key] = f.type === 'integer' ? '정수만' : '숫자만'; else input[f.key] = n; continue; }
    if (f.kind === 'enum') { if (!f.enum.includes(raw)) errors[f.key] = '목록에 없는 값'; else input[f.key] = f.type === 'integer' || f.type === 'number' ? Number(raw) : raw; continue; }
    if (f.kind === 'json') { try { const v = JSON.parse(raw); if ((f.type === 'array') !== Array.isArray(v) || (f.type === 'object' && (v === null || typeof v !== 'object'))) errors[f.key] = f.type === 'array' ? '배열([…])로' : '객체({…})로'; else input[f.key] = v; } catch { errors[f.key] = 'JSON 이 아님'; } continue; }
    input[f.key] = raw;
  }
  return { ok: !Object.keys(errors).length, input, errors };
}
/** 자유 입력(스키마 없음) — 빈 칸이면 {} , 아니면 JSON 객체 */
export function buildFree(text) {
  const t = String(text || '').trim(); if (!t) return { ok: true, input: {}, errors: {} };
  try { const v = JSON.parse(t); if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, input: v, errors: {} }; return { ok: false, input: {}, errors: { _free: '객체({…})로' } }; }
  catch { return { ok: false, input: {}, errors: { _free: 'JSON 이 아님' } }; }
}

// ── 잠금 ──
/**
 * 이 op 를 지금 부를 수 있나. 칩 : '' · 'app'(앱 토큰에 닫힘) · 'perm'(계정 권한) · 'local'(이 노드에서만) · 'door'(승인 문 없음) · 'dead'(없음)
 * @param {{ tier: string, id: string }} item
 * @param {{ gate?: (op: string, o?: object) => { open: boolean, needs?: string, why?: string }, canApprove?: boolean, remote?: boolean }} ctx  gate = window.TerraGate (없으면 시안 — 막지 않음)
 * @returns {{ locked: boolean, chip: string, why: string }}
 */
export function lockOf(item, ctx = {}) {
  if (item.tier === 'T3' || item.tier === 'T4') {
    if (!ctx.canApprove) return { locked: true, chip: 'door', why: '승인 문 없음 — Terra 셸 안에서 열어야 부를 수 있음 · 터미널 : ' + cliLine(item.id) };
    return { locked: false, chip: '', why: '' };
  }
  if (!ctx.gate) return { locked: false, chip: '', why: '' };
  const g = ctx.gate(item.id, { remote: !!ctx.remote });
  if (g.open) return { locked: false, chip: '', why: '' };
  const chip = g.needs === 'user-perm' ? 'perm' : g.needs === 'local' ? 'local' : 'app';
  return { locked: true, chip, why: String(g.why || '잠김').replace(/^잠김 : /, '') + ' · 터미널 : ' + cliLine(item.id) };
}
export const CHIP_TEXT = { app: '앱 토큰에 닫힘', perm: '계정 권한 없음', local: '이 노드에서만', door: '승인 문 없음', dead: '없음' };

/** CLI 로 같은 일을 하는 줄 */
export function cliLine(id, input) { return 'terra module call ' + id + (input && Object.keys(input).length ? " --input '" + JSON.stringify(input) + "'" : ''); }

/** 단추 글자 — 등급마다 다르다 */
export function buttonText(tier, arm) {
  if (tier === 'T0') return '읽기';
  if (tier === 'T1') return '실행';
  if (tier === 'T2') return arm ? '한 번 더 눌러 실행' : '실행 …';
  return tier === 'T4' ? '승인 문으로 · 재인증' : '승인 문으로';
}

/**
 * 호출 한 번. 던지지 않고 { ok, … } 로 돌려준다.
 * @param {{ item: object, input: object, node?: string }} q  node = 대상 노드 id(rid · 빈 값 = 이 노드)
 * @param {{ invoke: (rid: string, op: string, input: object) => Promise<any>, invokeLocal: (op: string, input: object) => Promise<any>, approve?: (op: string, input: object) => Promise<any>, textOf?: (op: string, e: any, ctx?: object) => string }} d
 * @returns {Promise<{ ok: boolean, data?: any, text?: string, code?: string, withheld?: string[], via: 'door'|'app', sec?: boolean }>}
 */
export async function runOp(q, d) {
  const { item, input } = q, door = item.tier === 'T3' || item.tier === 'T4';
  if (door) {
    if (!d.approve) return { ok: false, via: 'door', code: 'APPROVAL_UNAVAILABLE', text: '승인 문 없음 — Terra 셸 안에서 열기' };
    const r = await d.approve(item.id, input);
    if (r && r.ok) return { ok: true, via: 'door', data: r.data, withheld: r.withheld || [] };
    return { ok: false, via: 'door', code: (r && r.code) || 'APPROVAL_FAILED', text: (r && r.text) || '', silent: !r || !r.text };   // 빈 문구 = 사람이 거절함 — 조용히
  }
  try {
    const data = q.node ? await d.invoke(q.node, item.id, input) : await d.invokeLocal(item.id, input);
    return { ok: true, via: 'app', data, withheld: [] };
  } catch (e) {
    const code = (e && e.code) || 'ERROR';
    return { ok: false, via: 'app', code, text: d.textOf ? d.textOf(item.id, e, q.node ? { node: q.node } : {}) : String((e && e.message) || code) };
  }
}

/** 결과를 보일 글자 — 최대 n 글자 */
export function resultText(data, n = 6000) {
  let s; try { s = typeof data === 'string' ? data : JSON.stringify(data === undefined ? null : data, null, 2); } catch { s = String(data); }
  return s.length > n ? s.slice(0, n) + '\n… (' + (s.length - n) + '자 더 — CLI 로 전체)' : s;
}
export const tierName = (t) => TIER_NAME[t] || t;
