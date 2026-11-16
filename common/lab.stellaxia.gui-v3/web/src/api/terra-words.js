// Terra 터미널의 낱말 확장 — CLI 의 O · A · R 명령을 operation 으로 잇는 순수 함수 층 (ADR-GW-014 P17-2).
//
//   낱말 표(terra-words.json — tools/gen-terra-words.mjs 가 terra-docs 의 CLI 표면 지도에서 뽑음)
//     → 가장 긴 앞부분 일치로 명령 찾기 → 위치 인자 · 이름=값 → 입력 JSON → 등급대로 부르기(op 콘솔의 runOp · lockOf 를 그대로 쓴다)
//   등급  T0 · T1 곧장 · T2 터미널 안 확인(yes) · T3 · T4 호스트 승인 문(approve). 앱 토큰에 닫힌 op 는 이유 + CLI 줄로 거절
//   변수  set <이름>=<값> · vars · echo — $이름 은 줄을 낱말로 가르기 전에 펼친다(값은 SAFE_WORD 만 — 셸 문법이 새로 들어오지 않는다)
//   출력  set output table|json — 일반 낱말의 결과 꼴(손으로 만든 낱말 · api 는 그대로)

import WORDS from './terra-words.json' with { type: 'json' };

/** 표 한 줄 — 시험이 모양을 본다 */
export const TERRA_WORDS = Object.freeze(WORDS.words);

const BY_CMD = new Map();
for (const w of TERRA_WORDS) { BY_CMD.set(w.cmd, w); for (const a of w.aliases || []) if (!BY_CMD.has(a)) BY_CMD.set(a, w); }

/** 손으로 만든 낱말(shells.js terraCmd)이 이미 맡은 명령 — 표에서 같은 이름이어도 손 낱말이 먼저다 */
export const HAND_PATHS = new Set(['status', 'whoami', 'agent whoami', 'auth whoami', 'node list', 'node get', 'node status', 'network status', 'network node', 'route graph', 'route candidates', 'route diagnose', 'route explain',
  'session list', 'probe list', 'module list', 'task list', 'task get', 'daemon status']);

/** 앞부분이 가장 길게 맞는 표 줄과 남은 낱말. 없으면 null */
export function lookup(words, extra = []) {
  for (let n = Math.min(words.length, 5); n >= 1; n--) { const key = words.slice(0, n).join(' '), w = extra.find((x) => x.cmd === key) || BY_CMD.get(key); if (w) return { word: w, rest: words.slice(n), used: n }; }
  return null;
}

/** 변수 이름 */
export const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
/** 값에 허용하는 글자 — shells.js 의 SAFE_WORD 와 같다(낱말 하나) */
export const VAR_VALUE = /^[A-Za-z0-9가-힣._:@/=+,%-]*$/;

/** $이름 펼치기. 모르는 변수는 오류. $( · ${ 같은 것은 건드리지 않아 뒤의 낱말 검사가 거절한다 */
export function expandVars(line, vars) {
  return String(line).replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => { if (!Object.hasOwn(vars, name)) throw Object.assign(new Error('변수 없음 : $' + name + ' — set ' + name + '=<값> (vars 로 목록)'), { code: 'BAD_INPUT' }); return vars[name]; });
}

/**
 * 명령 뒤 낱말 → 입력 문자열 맵. 위치 인자는 op id 의 by-<이름> 자리를 차례로 채우고, 이름=값 · --이름=값 · --이름(참)은 그 이름으로.
 * 노드는 node=<노드> · --node=<노드>(현재 노드 대신) 로 따로 받는다.
 * @returns {{ input: Record<string,string>, node: string, errors: string[] }}
 */
export function parseArgs(word, rest) {
  const input = {}, errors = [], pos = [...(word.pos || [])]; let node = '';
  for (const t of rest) {
    let m;
    if ((m = /^--?([A-Za-z_][\w-]*)=(.*)$/.exec(t))) { const k = m[1].replace(/-/g, '_'); if (k === 'node') node = m[2]; else input[k] = m[2]; }
    else if ((m = /^--([A-Za-z_][\w-]*)$/.exec(t))) input[m[1].replace(/-/g, '_')] = 'true';
    else if ((m = /^([A-Za-z_][\w.-]*)=(.*)$/.exec(t))) { if (m[1] === 'node') node = m[2]; else input[m[1]] = m[2]; }
    else if (pos.length) input[pos.shift()] = t;
    else errors.push(t + ' — 받는 자리 없음' + (word.pos && word.pos.length ? ' (위치 인자 : ' + word.pos.join(' ') + ')' : '') + ' · 이름=값 으로');
  }
  for (const p of word.pos || []) if (!(p in input)) errors.push(p + ' — 필요(' + usageOf(word) + ')');
  return { input, node, errors };
}

export function usageOf(w) { return w.cmd + (w.usage ? ' ' + w.usage : (w.pos || []).map((p) => ' <' + p + '>').join('')); }

/** 입력 맵을 스키마에 맞춰 값 꼴로. 스키마가 없으면(조회 실패) 글자 그대로 — 서버가 판정한다. opc = op-console.js 의 formFields · buildInput */
export function coerce(input, schema, opc) {
  if (!schema) return { ok: true, input, secret: [] };
  const F = opc.formFields(schema);
  if (F.free || !F.fields.length) return { ok: true, input, secret: [] };
  const known = new Set(F.fields.map((f) => f.key)), errors = [];
  for (const k of Object.keys(input)) if (!known.has(k)) errors.push(k + ' — 이 op 의 입력 칸이 아님(칸 : ' + F.fields.map((f) => f.key).join(' ') + ')');
  const secret = F.fields.filter((f) => f.secret && f.key in input).map((f) => f.key);
  const B = opc.buildInput(F.fields, input);
  for (const [k, v] of Object.entries(B.errors)) errors.push(k + ' — ' + v);
  return errors.length ? { ok: false, errors, secret } : { ok: true, input: B.input, secret };
}

// ── 결과 글자 ──
const cell = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const wid = (s) => { let w = 0; for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힣一-鿿]/.test(ch) ? 2 : 1; return w; };
const padTo = (s, n) => s + ' '.repeat(Math.max(1, n - wid(s)));
const isRec = (o) => o && typeof o === 'object' && !Array.isArray(o);

/** 결과 → 줄들. mode json 이면 그대로 JSON. table 이면 객체 배열은 표 · 객체는 이름/값 줄 · 그 밖은 JSON */
export function formatResult(data, mode = 'table', max = 400) {
  let lines;
  if (mode === 'json' || data === undefined || data === null || typeof data !== 'object') lines = JSON.stringify(data === undefined ? null : data, null, 2).split('\n');
  else {
    let list = Array.isArray(data) ? data : null;
    if (!list && isRec(data)) { const arrs = Object.entries(data).filter(([, v]) => Array.isArray(v) && v.length && v.every(isRec)); if (arrs.length === 1 && Object.values(data).every((v) => v === arrs[0][1] || typeof v !== 'object')) list = arrs[0][1]; }
    if (list && list.length && list.every(isRec)) {
      const cols = []; for (const r of list) for (const k of Object.keys(r)) if (!cols.includes(k) && cols.length < 8) cols.push(k);
      const rows = list.map((r) => cols.map((k) => clip(cell(r[k]), 28))), W = cols.map((c, i) => Math.max(wid(c), ...rows.map((r) => wid(r[i]))) + 2);
      lines = [cols.map((c, i) => padTo(c, W[i])).join('').trimEnd(), ...rows.map((r) => r.map((v, i) => padTo(v, W[i])).join('').trimEnd())];
      if (isRec(data) && Object.keys(data).length > 1) lines.unshift(...Object.entries(data).filter(([, v]) => typeof v !== 'object').map(([k, v]) => padTo(k, 18) + v), '');
    } else if (list && !list.length) lines = ['(없음)'];
    else if (isRec(data) && Object.keys(data).length) { const w = Math.min(24, Math.max(...Object.keys(data).map((k) => wid(k))) + 2); lines = Object.entries(data).map(([k, v]) => padTo(k, w) + clip(cell(v), 90)); }
    else lines = JSON.stringify(data, null, 2).split('\n');
  }
  return lines.length > max ? lines.slice(0, max).concat(['… (' + (lines.length - max) + '줄 더 — op 콘솔 · CLI 로 전체)']) : lines;
}

/** 입력 한 줄 요약(확인 줄용) */
export function inputLine(input) { const e = Object.entries(input || {}); return e.length ? e.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ') : '(입력 없음)'; }

/** 거절 문구 — kind 마다 */
export function refusal(w) {
  const ops = (w.ops || (w.op ? [w.op] : [])).join(' · ');
  if (w.kind === 'multi') return { code: 'NOT_HERE', why: w.cmd + ' — operation 이 여럿(' + ops + ')을 엮는 명령', where: '각 창, 또는 op 콘솔에서 op 를 골라 하나씩(`api` 는 읽기만)' };
  if (w.kind === 'stream') return { code: 'NOT_HERE', why: w.cmd + ' — 스트림 · 감시(' + ops + ')라 한 줄 응답이 아님', where: '기록 창 · 해당 창의 실시간 보기, 또는 그 노드의 terra CLI' };
  if (w.kind === 'direct') return { code: 'NOT_HERE', why: w.cmd + ' — Gateway 직접 길(' + ops + ')이라 operation 호출 밖' + (/auth login/.test(w.cmd) ? ' · 웹은 비밀번호를 받지 않음' : ''), where: /module (ops|describe|example)/.test(w.cmd) ? 'op 콘솔(카탈로그 · 입력 스키마)' : '로고 › 계정 · 노드 상태 창, 또는 terra CLI' };
  if (w.kind === 'shape') return { code: 'NOT_HERE', why: w.cmd + ' — CLI 인자 꼴(' + (w.usage || '') + ')이 operation 입력과 달라 터미널이 옮기지 못함', where: 'op 콘솔(스키마 폼) 또는 해당 창' };
  return null;
}

/** op id 의 by-<이름> 마디 → 위치 인자가 채우는 입력 이름 (tools/gen-terra-words.mjs 의 posOf 와 같다) */
export function posOf(op) { return op.split('.').filter((s) => s.startsWith('by-')).map((s) => s.slice(3).replace(/-/g, '_')); }
