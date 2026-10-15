import { describe, expect, it } from 'vitest';
import { CALL_ERROR_CODES, CONTRACT_ERROR_CODES, GATEWAY_ERROR_CODES, OBSERVED_ERROR_CODES, RECORD_ERROR_CODES } from '../src/api/types';
import { ERROR_DICTIONARY, describeCallCode, describeCode, describeFailure } from '../src/data/errors';
import { failResult, loadContract } from './helpers';

describe('오류 사전 완전성', () => {
  const contract = loadContract();
  const contractCodes = Object.keys(contract.errors).sort();

  it('계약 오류는 15개이고 타입 목록과 같다(계약이 바뀌면 여기서 깨진다)', () => {
    expect(contractCodes).toHaveLength(15);
    expect([...CONTRACT_ERROR_CODES].sort()).toEqual(contractCodes);
  });
  it('계약 오류 15개를 모두 사전이 덮는다 — 문구와 행동이 있다', () => {
    for (const code of contractCodes) {
      const info = ERROR_DICTIONARY[code];
      expect(info, code).toBeDefined();
      expect(info?.message.length, code).toBeGreaterThan(0);
      expect(info?.action, code).toBeTruthy();
    }
  });
  it('계약의 HTTP 상태와 사전의 상태가 같다(HTTP 로 나오지 않는 MODEL_UNAVAILABLE 만 예외 표시)', () => {
    for (const code of contractCodes) {
      const spec = contract.errors[code];
      const info = ERROR_DICTIONARY[code];
      expect(info?.http, code).toBe(spec?.httpStatus);
    }
  });
  it('Gateway·브리지 오류 8개(MODULE_PERMISSION_DENIED 포함)를 모두 덮는다', () => {
    expect(GATEWAY_ERROR_CODES).toHaveLength(8);
    expect(GATEWAY_ERROR_CODES).toContain('MODULE_PERMISSION_DENIED');
    for (const code of GATEWAY_ERROR_CODES) {
      expect(ERROR_DICTIONARY[code], code).toBeDefined();
      expect(ERROR_DICTIONARY[code]?.source, code).toBe('gateway');
    }
  });
  it('기록의 error 코드와 call 줄의 error_code 도 덮는다', () => {
    for (const code of [...RECORD_ERROR_CODES, ...CALL_ERROR_CODES]) expect(ERROR_DICTIONARY[code], code).toBeDefined();
  });
  it('실제 스택에서 만난 코드(OBSERVED)를 모두 덮는다 — 문구와 행동이 있고 알려진 코드다', () => {
    expect([...OBSERVED_ERROR_CODES].sort()).toEqual(
      [
        'DELEGATION_NOT_OPEN',
        'GATEWAY_MALFORMED_RESPONSE',
        'MODULE_ROUTE_NOT_FOUND',
        'OPERATION_NOT_FOUND',
        'TERRA_ENCODE_FAILED',
        'TERRA_INTERNAL',
        'TERRA_INVALID_ARGUMENTS',
        'TERRA_UNKNOWN_TOOL',
      ].sort(),
    );
    for (const code of OBSERVED_ERROR_CODES) {
      const info = describeCode(code);
      expect(info.known, code).toBe(true);
      expect(info.message.length, code).toBeGreaterThan(0);
      expect(info.message, code).toMatch(/[가-힣]/); // 영어 원문이 아니라 한국어 문구
    }
  });
  it('MODULE_ROUTE_NOT_FOUND 는 모듈 재시작 도중 잠시 나오므로 잠시 뒤 다시 시도하는 계열이다', () => {
    const info = describeCode('MODULE_ROUTE_NOT_FOUND');
    expect(info.action).toBe('retry-later');
    expect(info.http).toBe(404);
    expect(info.message).toContain('잠시 뒤');
  });
  it('call 줄에 나오는 코드는 call 출처, Gateway 응답 코드는 gateway 출처다', () => {
    for (const code of ['TERRA_UNKNOWN_TOOL', 'TERRA_INVALID_ARGUMENTS', 'TERRA_INTERNAL', 'TERRA_ENCODE_FAILED', 'GATEWAY_MALFORMED_RESPONSE']) expect(describeCode(code).source, code).toBe('call');
    for (const code of ['OPERATION_NOT_FOUND', 'MODULE_ROUTE_NOT_FOUND', 'DELEGATION_NOT_OPEN']) expect(describeCode(code).source, code).toBe('gateway');
  });
  it('사전에 계약 밖의 이름 없는 코드가 섞이지 않는다(키와 code 필드가 같다)', () => {
    for (const [key, info] of Object.entries(ERROR_DICTIONARY)) expect(info.code).toBe(key);
  });
});

describe('describeCode — 모르는 코드도 안전하게', () => {
  it('HTTP_<n> 은 상태로 푼다', () => {
    const info = describeCode('HTTP_502');
    expect(info.known).toBe(true);
    expect(info.message).toContain('502');
  });
  it('모르는 코드는 일반 문구 + 원문 접기', () => {
    const info = describeCode('SOMETHING_NEW');
    expect(info.known).toBe(false);
    expect(info.showRaw).toBe(true);
    expect(info.message.length).toBeGreaterThan(0);
  });
  it('코드가 없으면 일반 문구', () => {
    expect(describeCode(undefined).known).toBe(false);
  });
});

describe('describeFailure — 상황별 갈래', () => {
  it('CREDENTIAL_MISSING 은 expired 로 온보딩과 갱신을 가른다', () => {
    expect(describeFailure(failResult(409, 'CREDENTIAL_MISSING'), { credentialExpired: true }).action).toBe('renew-credential');
    expect(describeFailure(failResult(409, 'CREDENTIAL_MISSING'), { credentialExpired: false }).action).toBe('onboard-credential');
    expect(describeFailure(failResult(409, 'CREDENTIAL_MISSING')).action).toBe('onboard-credential');
  });
  it('MODULE_PERMISSION_DENIED 는 권한 부족과 reach 밖이 같은 문구라 scopes 대조를 안내한다(GAP-2)', () => {
    const info = describeFailure(failResult(403, 'MODULE_PERMISSION_DENIED'));
    expect(info.action).toBe('request-permission');
    expect(info.message).toContain('agent.use');
  });
  it('call 줄의 MODULE_PERMISSION_DENIED 는 사용자 계정의 agent.use 가 아니라 위임 자격의 권한 부족으로 안내한다(B3)', () => {
    const info = describeCallCode('MODULE_PERMISSION_DENIED');
    expect(info.code).toBe('MODULE_PERMISSION_DENIED');
    expect(info.message).toContain('위임 자격');
    expect(info.message).not.toContain('agent.use 권한이 없');
    expect(info.action).toBe('inform');
    // 같은 코드가 호출 응답(상태 줄·목록 …)으로 오면 여전히 계정 권한 문구다.
    expect(describeCode('MODULE_PERMISSION_DENIED').message).toContain('agent.use');
  });
  it('call 줄의 다른 코드는 그대로 사전을 따른다', () => {
    expect(describeCallCode('TERRA_APPROVAL_DENIED')).toBe(describeCode('TERRA_APPROVAL_DENIED'));
    expect(describeCallCode('HTTP_500').message).toContain('500');
  });
  it('APPROVAL_NOT_FOUND 는 크게 띄우지 않고 세션을 새로 읽는다', () => {
    const info = describeFailure(failResult(404, 'APPROVAL_NOT_FOUND'));
    expect(info.quiet).toBe(true);
    expect(info.action).toBe('refresh-session');
  });
  it('코드가 없고 outcomeUnknown 이면 결과를 모르니 messages.list 로 확인하라고 한다(I17)', () => {
    const info = describeFailure(failResult(0, undefined, 'timeout', true));
    expect(info.action).toBe('verify-outcome');
  });
  it('코드가 없는 네트워크 실패는 연결 문제로 푼다', () => {
    expect(describeFailure(failResult(0, undefined, 'offline')).action).toBe('retry-later');
  });
  it('HTTP 상태만 있고 코드가 없으면 상태로 푼다(401 은 세션 끝)', () => {
    expect(describeFailure(failResult(401, undefined)).code).toBe('UNAUTHORIZED');
  });
  it('원문은 항상 접어서 함께 돌려준다', () => {
    expect(describeFailure(failResult(502, 'MCP_SERVER_FAILED', 'exec: not found')).raw).toBe('exec: not found');
  });
});
