import { describe, expect, it } from 'vitest';
import { composeReadiness, type ReadinessInput } from '../src/data/readiness';
import { failResult, okResult } from './helpers';

const status = (over: Record<string, unknown> = {}) => okResult({ status: 'ok' as const, version: '0.1.0', delegate_door: true, models_registered: 1, sessions: 0, ...over });
const models = (over: Record<string, unknown> = {}) =>
  okResult({ default: 'anthropic', providers: [{ provider: 'anthropic', model: 'claude-opus-5', registered: true, default: true }], ...over });
const creds = (over: Record<string, unknown> = {}) =>
  okResult({ registered: true, principal: 'alice', expired: false, expires_at: '2099-01-01T00:00:00Z', ...over });
const all = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({ status: status(), models: models(), credentials: creds(), ...over });

describe('준비 상태 합성(요구 §6.2 + GAP-2)', () => {
  it('모두 갖춰지면 ready 이고 폐기 여부는 모른다고 적는다', () => {
    const r = composeReadiness(all());
    expect(r.ready).toBe(true);
    expect(r.blocking).toBeNull();
    expect(r.caveat).toContain('폐기 여부는 확인하지 못함');
    expect(r.viewer).toBe('alice');
  });
  it('1 모듈이 꺼져 있으면(503 MODULE_UNAVAILABLE) 다른 단계는 건너뛴다', () => {
    const r = composeReadiness(all({ status: failResult(503, 'MODULE_UNAVAILABLE') }));
    expect(r.ready).toBe(false);
    expect(r.blocking).toBe('module-down');
    expect(r.steps.find((s) => s.id === 'door')?.status).toBe('skipped');
  });
  it('1 세션이 끝났으면(401) 모듈 문제가 아니라 세션 끝이다', () => {
    expect(composeReadiness(all({ status: failResult(401, 'UNAUTHORIZED') })).blocking).toBe('session-ended');
  });
  it('1 연결 실패(코드 없음)는 도달 불가', () => {
    expect(composeReadiness(all({ status: failResult(0, undefined, 'offline') })).blocking).toBe('unreachable');
  });
  it('권한 없음 — status.get 만 되고 나머지가 403 MODULE_PERMISSION_DENIED 면 agent.use 가 없다', () => {
    const denied = failResult(403, 'MODULE_PERMISSION_DENIED');
    const r = composeReadiness(all({ models: denied, credentials: denied }));
    expect(r.blocking).toBe('no-permission');
    expect(r.ready).toBe(false);
    expect(r.steps.find((s) => s.id === 'model')?.status).toBe('skipped');
    expect(r.steps.find((s) => s.id === 'credential')?.status).toBe('skipped');
  });
  it('권한 없음은 둘 중 하나만 403 이어도 선다', () => {
    expect(composeReadiness(all({ credentials: failResult(403, 'MODULE_PERMISSION_DENIED') })).blocking).toBe('no-permission');
  });
  it('2 위임 관문이 없으면 읽기만 허용', () => {
    const r = composeReadiness(all({ status: status({ delegate_door: false }) }));
    expect(r.blocking).toBe('no-door');
    expect(r.readOnly).toBe(true);
  });
  it('3 모델이 없으면 설정 화면으로', () => {
    const r = composeReadiness(all({ models: models({ default: '', providers: [] }) }));
    expect(r.blocking).toBe('no-model');
  });
  it('3 기본 provider 가 registered 가 아니면 모델 없음', () => {
    const r = composeReadiness(all({ models: models({ providers: [{ provider: 'anthropic', model: 'm', registered: false, default: true }] }) }));
    expect(r.blocking).toBe('no-model');
  });
  it('4 자격이 없으면 맡기기 안내', () => {
    const r = composeReadiness(all({ credentials: okResult({ registered: false }) }));
    expect(r.blocking).toBe('no-credential');
    expect(r.viewer).toBeNull();
  });
  it('5 만료됐으면 다시 맡기기 안내', () => {
    expect(composeReadiness(all({ credentials: creds({ expired: true }) })).blocking).toBe('credential-expired');
  });
  it('가장 앞선 실패가 blocking 이고 뒤의 실패도 steps 에 남는다', () => {
    const r = composeReadiness(all({ models: models({ providers: [], default: '' }), credentials: okResult({ registered: false }) }));
    expect(r.blocking).toBe('no-model');
    expect(r.steps.filter((s) => s.status === 'fail').map((s) => s.id)).toEqual(['model', 'credential']);
  });
  it('아직 읽지 못한 단계는 pending 이고 ready 가 아니다', () => {
    const r = composeReadiness({ status: status() });
    expect(r.ready).toBe(false);
    expect(r.blocking).toBeNull();
    expect(r.steps.find((s) => s.id === 'model')?.status).toBe('pending');
  });
  it('degraded 는 막지 않고 경고로 남긴다', () => {
    const r = composeReadiness(all({ status: status({ status: 'degraded' }) }));
    expect(r.ready).toBe(true);
    expect(r.steps.find((s) => s.id === 'module')?.status).toBe('warn');
  });
  it('만료 시각을 알려 준다', () => {
    expect(composeReadiness(all()).expiresAt).toBe('2099-01-01T00:00:00Z');
  });
});
