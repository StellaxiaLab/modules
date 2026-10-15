// 본문·질의 검증 — api.go 의 decodeBody(DisallowUnknownFields)·queryInt·principal 과 같은 규칙.
// 계약의 입력 스키마가 모두 additionalProperties:false 이므로 모르는 필드는 호출자의 버그이고 400 이다.
// Go 의 encoding/json 처럼 null 은 "안 줌"과 같다(영값).

import { ApiError } from './errors.mjs';

const MAX_BODY = 1 << 20; // io.LimitReader(r.Body, 1<<20)

const goType = { string: 'string', bool: 'bool', int: 'int', strings: '[]string', strmap: 'map[string]string' };

function typeOk(kind, value) {
  switch (kind) {
    case 'string': return typeof value === 'string';
    case 'bool': return typeof value === 'boolean';
    case 'int': return typeof value === 'number' && Number.isInteger(value);
    case 'strings': return Array.isArray(value) && value.every((v) => v === null || typeof v === 'string');
    case 'strmap': return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((v) => v === null || typeof v === 'string');
    default: return false;
  }
}

function jsonKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value === 'object' ? 'object' : typeof value;
}

/**
 * @param {string} raw    요청 본문 원문(없으면 빈 문자열)
 * @param {Record<string,'string'|'bool'|'int'|'strings'|'strmap'>} fields  받는 필드와 Go 타입
 * @returns {Record<string, any>} 준 필드만 든 객체(null 은 뺀다)
 */
export function decodeBody(raw, fields) {
  if (!raw || raw.length === 0) return {};
  const text = Buffer.byteLength(raw) > MAX_BODY ? raw.slice(0, MAX_BODY) : raw;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new ApiError('INVALID_REQUEST', `cannot read the body: ${cause.message}`);
  }
  if (parsed === null) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('INVALID_REQUEST', `cannot read the body: json: cannot unmarshal ${jsonKind(parsed)} into Go value of type struct`);
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.hasOwn(fields, key)) {
      throw new ApiError('INVALID_REQUEST', `cannot read the body: json: unknown field "${key}"`);
    }
    if (value === null) continue;
    if (!typeOk(fields[key], value)) {
      throw new ApiError('INVALID_REQUEST', `cannot read the body: json: cannot unmarshal ${jsonKind(value)} into Go struct field .${key} of type ${goType[fields[key]]}`);
    }
    out[key] = value;
  }
  return out;
}

/** strconv.Atoi + 음수 거부. 질의 문자열이 비면 fallback. */
export function queryInt(url, name, fallback) {
  const raw = (url.searchParams.get(name) ?? '').trim();
  if (raw === '') return fallback;
  if (!/^[+-]?\d+$/.test(raw) || Number(raw) < 0) {
    throw new ApiError('INVALID_REQUEST', `${name} must be a non-negative integer`);
  }
  return Number(raw);
}

/** X-Terra-Principal — Gateway 가 찍는 호출자. 없거나 anonymous 면 400(M-1). */
export function principalOf(headers) {
  const name = String(headers['x-terra-principal'] ?? '').trim();
  if (name === '' || name === 'anonymous') {
    throw new ApiError('INVALID_REQUEST', 'the caller\'s principal is missing; this surface is reached through the Gateway');
  }
  return name;
}
