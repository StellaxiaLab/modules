// AGENT-MSG: 권한 없음(agent.use)과 도달 범위 밖을 화면이 다른 문구로 말한다.
import { describe, expect, it } from 'vitest';
import { GATEWAY_ERROR_CODES } from '../src/api/types';
import { describeCallCode, describeCode, describeFailure } from '../src/data/errors';
import { composeReadiness } from '../src/data/readiness';
import { failResult } from './helpers';

const REACH = '이 자격의 도달 범위(노드·위임 범위) 밖입니다 — 더 넓은 범위의 자격으로 다시 시도하세요';
const PERMISSION = '이 계정에 agent.use(또는 필요한) 권한이 없습니다 — 관리자에게 부여를 요청하세요';

describe('권한 부족 대 도달 범위 밖', () => {
  it('MODULE_REACH_DENIED 는 Gateway 코드이고 도달 범위 문구다', () => {
    expect(GATEWAY_ERROR_CODES).toContain('MODULE_REACH_DENIED');
    const info = describeFailure(failResult(403, 'MODULE_REACH_DENIED', 'raw'));
    expect(info.message).toBe(REACH);
    expect(info.message).not.toContain('agent.use');
  });
  it('옛 Gateway 의 MODULE_PERMISSION_DENIED + "도달 범위" 문구도 도달 범위 문구다', () => {
    const info = describeFailure(failResult(403, 'MODULE_PERMISSION_DENIED', '호출이 이 자격의 도달 범위 밖입니다'));
    expect(info.message).toBe(REACH);
  });
  it('MODULE_PERMISSION_DENIED 의 그 밖은 권한 문구다', () => {
    const info = describeFailure(failResult(403, 'MODULE_PERMISSION_DENIED', '호출에 필요한 권한이 없습니다: lab.stellaxia.agent.models.list'));
    expect(info.message).toBe(PERMISSION);
    expect(describeCode('MODULE_PERMISSION_DENIED').message).toBe(PERMISSION);
  });
  it('메시지가 빠진 권한 이름을 실으면 그 이름을 쓴다', () => {
    const info = describeFailure(failResult(403, 'MODULE_PERMISSION_DENIED', '필요한 권한: node.reboot'));
    expect(info.message).toContain('node.reboot');
    expect(info.message).toContain('관리자에게 부여를 요청하세요');
  });
  it('"로그인한 호출자" 문구는 다시 로그인하라는 문구다', () => {
    const info = describeFailure(failResult(403, 'MODULE_PERMISSION_DENIED', '이 operation은 로그인한 호출자가 필요합니다: x'));
    expect(info.message).toBe('다시 로그인해 주세요');
  });
  it('call 줄 코드들의 문구', () => {
    expect(describeCallCode('MODULE_REACH_DENIED').message).toBe(REACH);
    expect(describeCallCode('AGENT_GRANT_DENIED').message).toBe('이 세션에는 노드를 조회·호출할 수 있는 권한이 없습니다');
    expect(describeCallCode('DELEGATION_NOT_OPEN').message).toBe('위임 자격에는 열려 있지 않은 operation입니다');
    expect(describeCallCode('OPERATION_NOT_REMOTE').message).toBe('대상 노드가 원격으로 열지 않은 operation입니다');
    expect(describeCallCode('NODE_OFFLINE').message).toBe('노드가 오프라인입니다');
    expect(describeCode('MODULE_UNAVAILABLE').message).toBe('모듈이 꺼져 있거나 닿지 않습니다');
  });
  it('준비 상태: 도달 범위 밖은 권한 없음과 다른 단계로 선다', () => {
    const reach = failResult(403, 'MODULE_REACH_DENIED', 'x');
    const r = composeReadiness({ models: reach, credentials: reach, status: { ok: true, status: 200, data: { status: 'ok', delegate_door: true } } as never });
    expect(r.blocking).toBe('reach-denied');
    const old = failResult(403, 'MODULE_PERMISSION_DENIED', '도달 범위 밖');
    expect(composeReadiness({ models: old, credentials: old, status: { ok: true, status: 200, data: { status: 'ok', delegate_door: true } } as never }).blocking).toBe('reach-denied');
  });
});
