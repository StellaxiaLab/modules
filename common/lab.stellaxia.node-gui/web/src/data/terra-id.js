// Terra ID — Tree(Master)의 외부 신원 입구(P2)를 설정 보드에 싣는 순수 함수.
//
// 원칙: 신뢰는 기본 꺼짐이다. 신뢰 목록이 빈 Tree는 오늘과 똑같다 — 비밀번호 로그인만 받는다.
// 화면은 이 파일의 보기 모델만 그린다(settings-live.js). 계약은 Terra
// docs/implementation/hosted-access/p2-tree-identity-ingress.md §4 (API) · §8 (이 GUI).
//
//   Terra ID 신뢰 (master_admin)   admin.external-issuers.*  — 발급자 한 줄을 켜고 끈다
//   Terra ID로 연결 (로그인한 사람)  users.by-user-id.external-identities.*  — 내 연결 목록 · 연결 · 해제
//
// "없음"과 "못 봤음"은 다르다 — 빈 목록(ok + [])은 없음, 오류 · 길 없음은 못 봤음이다.

import { resultText } from '../api/client.js';

const T = (op) => 'terra.master.' + op;

/** operation 이름 — Master 경로에서 지었다 (PATCH /api/v1/admin/external-issuers → admin.external-issuers.patch). issuer · subject 는 URL 이라 경로에 싣지 않고 본문 · 쿼리로 보낸다 */
export const TERRA_ID_OPS = {
  issuers: T('admin.external-issuers.get'),
  issuerAdd: T('admin.external-issuers.post'),
  issuerPatch: T('admin.external-issuers.patch'),
  issuerDelete: T('admin.external-issuers.delete'),
  links: T('users.by-user-id.external-identities.get'),
  link: T('users.by-user-id.external-identities.post'),
  unlink: T('users.by-user-id.external-identities.delete')
};

/** 교환 입구 — 켠 발급자가 하나라도 있을 때만 열린다(없으면 404) */
export const EXCHANGE_PATH = '/api/v1/auth/external/exchange';

/** 신뢰 목록이 빈 Tree의 문장 (기본) */
export const TRUST_EMPTY_TEXT = '외부 발급자를 신뢰하지 않습니다 — 이 Tree는 비밀번호 로그인만 받습니다 (기본)';

/** 외부 신원 오류 코드 → 사람이 읽는 말 (P1 계약 §2.7 + P2) */
const CODE_TEXT = {
  EXTERNAL_TOKEN_INVALID: '토큰을 받지 않았습니다 — 서명 · 만료 · 발급자 · 대상(aud)이 이 Tree와 맞지 않습니다. 이 Tree가 신뢰하는 발급자의 토큰인지, aud가 tree:<이 Tree id>인지 보고 새로 받아 붙여 넣으세요.',
  EXTERNAL_IDENTITY_CONFLICT: '이 Terra ID 계정은 이미 이 Tree의 다른 사용자에 연결되어 있습니다 — 그 사용자에게서 먼저 연결을 풀어야 합니다.',
  EXTERNAL_MFA_REQUIRED: '이 발급자는 2단계 인증(MFA)을 요구합니다 — Terra ID에서 2단계 인증으로 다시 로그인한 뒤 토큰을 새로 받으세요.',
  EXTERNAL_IDENTITY_NOT_LINKED: '이 Terra ID 계정은 이 Tree의 어느 사용자에도 연결되어 있지 않습니다 (또는 그 사용자가 꺼져 있습니다).',
  EXTERNAL_IDENTITY_SUSPENDED: '이 연결은 정지되어 있습니다 — Tree 관리자에게 문의하세요.',
  RATE_LIMITED: '요청이 너무 잦습니다 — 1분쯤 뒤에 다시 하세요.',
  FORBIDDEN: '권한이 없습니다 — 자기 연결이나 master_admin만 바꿀 수 있습니다.'
};

/** Result → 글. 외부 신원 코드는 위의 말로, 나머지는 클라이언트의 공통 글로 */
export function externalErrorText(r) {
  if (!r) return '응답이 없습니다';
  const code = r.reason || (r.data && r.data.error && r.data.error.code) || '';
  if (CODE_TEXT[code]) return CODE_TEXT[code] + ' (' + code + ')';
  return resultText(r);
}

/** 응답 data 에서 목록 하나 — { key: [...] } 이거나 맨 배열 */
const listOf = (data, key) => (Array.isArray(data) ? data : data && Array.isArray(data[key]) ? data[key] : null);

const p2 = (n) => String(n).padStart(2, '0');
/** RFC3339 → 'YYYY-MM-DD HH:MM' (로컬). 못 읽으면 빈 글 */
export function shortTime(s) {
  if (!s) return '';
  const t = new Date(s);
  if (isNaN(t)) return '';
  return t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes());
}

/**
 * admin.external-issuers.get 응답 → 보기 모델.
 *   state  ok(한 줄 이상) · empty(신뢰 없음 — 기본) · denied(master_admin 아님 → 카드를 숨긴다) · unseen(못 봤음)
 * @param {import('../api/client.js').Result | null | undefined} r
 */
export function issuersView(r) {
  if (!r) return { state: 'unseen', issuers: [], why: '부르지 않았습니다' };
  if (r.kind === 'forbidden' && r.reason !== 'DELEGATION_NOT_OPEN') return { state: 'denied', issuers: [], why: resultText(r) };
  const L = r.kind === 'ok' ? listOf(r.data, 'issuers') : null;
  if (!L) return { state: 'unseen', issuers: [], why: r.kind === 'ok' ? '응답에 issuers 목록이 없습니다' : resultText(r) };
  const issuers = L.filter((x) => x && x.issuer).map((x) => ({
    issuer: String(x.issuer),
    name: x.display_name || '',
    jwksUri: x.jwks_uri || '',
    audience: x.effective_audience || x.audience || '',
    audienceSet: !!(x.effective_audience || x.audience),
    enabled: x.enabled === true,
    mfa: x.require_mfa === true,
    cachedAt: shortTime(x.cached_at),
    kids: [].concat(Array.isArray(x.cached_key_ids) ? x.cached_key_ids : [], Array.isArray(x.pinned_key_ids) ? x.pinned_key_ids : [], Array.isArray(x.key_ids) ? x.key_ids : []).map(String).filter((k, i, a) => a.indexOf(k) === i)
  }));
  const on = issuers.filter((x) => x.enabled).length;
  return { state: issuers.length ? 'ok' : 'empty', issuers, on, why: '' };
}

/**
 * users.by-user-id.external-identities.get 응답 → 보기 모델.
 *   state  ok · empty(연결 없음) · unseen(못 봤음)
 */
export function identitiesView(r) {
  if (!r) return { state: 'unseen', identities: [], why: '부르지 않았습니다' };
  const L = r.kind === 'ok' ? listOf(r.data, 'identities') : null;
  if (!L) return { state: 'unseen', identities: [], why: r.kind === 'ok' ? '응답에 identities 목록이 없습니다' : resultText(r) };
  const identities = L.filter((x) => x && x.issuer && x.subject).map((x) => ({
    issuer: String(x.issuer), subject: String(x.subject),
    status: x.status === 'suspended' ? 'suspended' : x.status === 'linked' ? 'linked' : String(x.status || 'linked'),
    linkedAt: shortTime(x.linked_at)
  }));
  return { state: identities.length ? 'ok' : 'empty', identities, why: '' };
}

/** 연결 상태 → [글, 톤] */
export function linkStatusTag(status) {
  if (status === 'linked') return ['연결됨', 'ok'];
  if (status === 'suspended') return ['정지됨', 'warn'];
  return [status, 'off'];
}

/** 발급자 주소 — https 절대 URL (개발용 http://localhost · 127.0.0.1 은 받는다) */
const isIssuerUrl = (s) => /^https:\/\/[^\s/]+/.test(s) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(s);

/**
 * 발급자 추가 폼 → admin.external-issuers.post 본문. 추가는 늘 꺼진 채로 한다(enabled 를 보내지 않는다 — 기본 false).
 * @param {{ issuer?: string, name?: string, jwks?: string, pinned?: string }} f
 * @returns {{ ok: true, body: object } | { ok: false, msg: string }}
 */
export function issuerAddBody(f) {
  const issuer = String((f && f.issuer) || '').trim().replace(/\/+$/, '');
  if (!issuer) return { ok: false, msg: '발급자 주소(issuer)를 입력하세요' };
  if (!isIssuerUrl(issuer)) return { ok: false, msg: '발급자 주소는 https:// 절대 URL이어야 합니다' };
  const body = { issuer };
  const name = String((f && f.name) || '').trim();
  if (name) body.display_name = name;
  const jwks = String((f && f.jwks) || '').trim();
  if (jwks) {
    if (!isIssuerUrl(jwks)) return { ok: false, msg: 'JWKS 주소는 https:// 절대 URL이어야 합니다' };
    body.jwks_uri = jwks;
  }
  const pinned = String((f && f.pinned) || '').trim();
  if (pinned) {
    const p = pinnedJwks(pinned);
    if (!p.ok) return p;
    body.pinned_jwks = p.value;
  }
  return { ok: true, body };
}

/** 고정 키 묶음 JSON — { keys: [...] } 모양만 받는다 */
export function pinnedJwks(text) {
  let v;
  try { v = JSON.parse(text); } catch (e) { return { ok: false, msg: '고정 키 묶음이 JSON이 아닙니다' }; }
  if (!v || typeof v !== 'object' || !Array.isArray(v.keys) || !v.keys.length) return { ok: false, msg: '고정 키 묶음은 { "keys": [ … ] } 모양이어야 합니다 (JWKS)' };
  return { ok: true, value: v };
}

/** base64url → 글 (브라우저 · node 둘 다) */
function b64urlText(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  if (typeof atob === 'function') return decodeURIComponent(Array.from(atob(b), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  return Buffer.from(b, 'base64').toString('utf8');
}

/**
 * 붙여 넣은 토큰을 보내기 전에 본다 — 서명은 Tree가 검사한다. 여기서는 모양과 iss · aud 만 읽어 보인다.
 * @returns {{ ok: true, token: string, iss: string, aud: string[], exp: number | null } | { ok: false, msg: string }}
 */
export function tokenPeek(raw) {
  const token = String(raw || '').trim().replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, msg: 'Terra ID 로그인 토큰을 붙여 넣으세요' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((x) => !/^[A-Za-z0-9_-]+$/.test(x))) return { ok: false, msg: '토큰 모양이 아닙니다 — 점(.)으로 나뉜 세 조각(JWS)이어야 합니다' };
  let c;
  try { c = JSON.parse(b64urlText(parts[1])); } catch (e) { return { ok: false, msg: '토큰 본문을 읽지 못했습니다' }; }
  const aud = Array.isArray(c.aud) ? c.aud.map(String) : c.aud ? [String(c.aud)] : [];
  return { ok: true, token, iss: String(c.iss || ''), aud, exp: typeof c.exp === 'number' ? c.exp : null };
}

/** 토큰의 aud 가 Tree 대상(tree:<id>)인가 — 아니면 보내기 전에 알린다(최종 판정은 Tree) */
export const audIsTree = (aud) => (aud || []).some((a) => /^tree:\S+/.test(a));
