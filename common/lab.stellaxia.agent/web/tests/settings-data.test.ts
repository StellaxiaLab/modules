import { describe, expect, it } from 'vitest';
import type { CredentialFacts, McpListResponse, ModelsListResponse } from '../src/api/types';
import { LIMIT_DEFAULTS, credentialView, expiryText, mcpView, modelsView, openSessions, revokeCommand, safeBaseUrl } from '../src/data/settings';
import { snap } from './helpers';

/** 서버가 (계약을 어기고) 비밀을 실어 보내도 화면 모델에는 들어오지 않아야 한다 — 허용 목록으로만 옮긴다. */
const LEAK = 'sk-ant-LEAK-0123456789';

describe('settings 데이터 — 모델 목록(키는 절대 보이지 않는다)', () => {
  it('provider·model·base_url·기본·등록 여부만 옮기고 나머지 칸은 버린다', () => {
    const data = {
      default: 'anthropic',
      providers: [
        { provider: 'anthropic', model: 'test-model', base_url: '', registered: true, default: true, api_key: LEAK, key_hint: 'sk-…ak' },
        { provider: 'other', model: 'm2', base_url: 'https://gw.example.test/v1', registered: false, default: false },
      ],
      api_key: LEAK,
    } as unknown as ModelsListResponse;
    const view = modelsView(data);
    expect(view.defaultProvider).toBe('anthropic');
    expect(view.rows).toEqual([
      { provider: 'anthropic', model: 'test-model', baseUrl: null, baseUrlMasked: false, registered: true, isDefault: true },
      { provider: 'other', model: 'm2', baseUrl: 'https://gw.example.test/v1', baseUrlMasked: false, registered: false, isDefault: false },
    ]);
    expect(JSON.stringify(view)).not.toContain(LEAK);
    expect(JSON.stringify(view)).not.toContain('key_hint');
  });

  it('기본 여부는 default 칸이나 최상위 default 이름 어느 쪽이든 따른다', () => {
    const view = modelsView({ default: 'b', providers: [{ provider: 'a', model: 'x', registered: true, default: false }, { provider: 'b', model: 'y', registered: true, default: false }] });
    expect(view.rows.map((r) => r.isDefault)).toEqual([false, true]);
  });

  it('providers 가 배열이 아니면 빈 목록이다', () => {
    expect(modelsView({ providers: null } as unknown as ModelsListResponse).rows).toEqual([]);
  });

  it('base_url 의 사용자 정보·쿼리·해시는 가린다 — 키가 주소에 실려 있을 수 있다(I1)', () => {
    expect(safeBaseUrl('https://user:pw-SECRET@gw.example.test/v1?api_key=SECRET#frag')).toEqual({ text: 'https://gw.example.test/v1', masked: true });
    expect(safeBaseUrl('https://gw.example.test/v1')).toEqual({ text: 'https://gw.example.test/v1', masked: false });
    expect(safeBaseUrl('')).toBeNull();
    expect(safeBaseUrl(undefined)).toBeNull();
    // 주소로 읽을 수 없는 글은 통째로 가린다 — 무엇이 들었는지 모르므로 그대로 보이지 않는다.
    expect(safeBaseUrl('not a url sk-SECRET')).toEqual({ text: '(주소 형식이 아님 — 표시하지 않음)', masked: true });
  });
});

describe('settings 데이터 — 자격 사실(credentials.get 의 사실만)', () => {
  const base: CredentialFacts = {
    registered: true,
    principal: 'alice',
    delegate: 'agent:agn_7f3a91c2',
    permissions: ['node.read', 'file.read'],
    reach: 'node',
    expires_at: '2030-01-01T00:00:00Z',
    expired: false,
    unattended: false,
  };

  it('미등록이면 나머지 칸이 비어 있다', () => {
    const v = credentialView({ registered: false });
    expect(v.state).toBe('none');
    expect(v.principal).toBeNull();
    expect(v.delegateId).toBeNull();
    expect(v.permissions).toEqual([]);
  });

  it('등록·만료 전 / 만료를 가른다 — 서버가 계산한 expired 를 따른다', () => {
    expect(credentialView(base).state).toBe('active');
    expect(credentialView({ ...base, expired: true }).state).toBe('expired');
  });

  it('대리인 id 에서 agent: 접두를 뗀다', () => {
    expect(credentialView(base).delegateId).toBe('agn_7f3a91c2');
    expect(credentialView({ ...base, delegate: 'agn_plain' }).delegateId).toBe('agn_plain');
  });

  it('대리인 id 가 명령에 안전한 글자가 아니면 id 를 쓰지 않는다 — 셸에 붙여넣는 글이다(I7)', () => {
    for (const bad of ['agent:agn_1; rm -rf /', 'agn_1 && curl x', '$(id)', 'agn`1`', '', 'agent:', 'a'.repeat(200)]) {
      const v = credentialView({ ...base, delegate: bad });
      expect(v.delegateId, bad).toBeNull();
      expect(v.delegate, bad).toBeNull(); // 알아볼 수 없는 글은 화면에도 올리지 않는다
      expect(v.delegateUnreadable, bad).toBe(bad !== '');
    }
    expect(revokeCommand(null)).toBeNull();
  });

  it('폐기 명령은 terra agent revoke <id> 다', () => {
    expect(revokeCommand('agn_7f3a91c2')).toBe('terra agent revoke agn_7f3a91c2');
  });

  it('값이 아닌 사실만 옮긴다 — 알 수 없는 칸(자격 문자열 따위)은 버린다', () => {
    const smuggled = { ...base, credential: 'tsa_SMUGGLED', token: 'tsa_SMUGGLED2' } as unknown as CredentialFacts;
    const text = JSON.stringify(credentialView(smuggled));
    expect(text).not.toContain('tsa_SMUGGLED');
  });

  it('권한·사전 승인 목록은 글자만 남긴다', () => {
    const v = credentialView({ ...base, permissions: ['a', 7, null, 'b'] as unknown as string[], unattended: true, pre_approved: ['op.one', 3 as unknown as string] });
    expect(v.permissions).toEqual(['a', 'b']);
    expect(v.unattended).toBe(true);
    expect(v.preApproved).toEqual(['op.one']);
  });

  it('만료까지 남은 시간은 양수일 때만 말하고, 아니면 절대 시각만 쓴다', () => {
    const at = Date.parse('2030-01-01T00:00:00Z');
    expect(expiryText(credentialView(base), at - (7 * 3600 + 3 * 60) * 1000)).toBe('7시간 3분 뒤');
    expect(expiryText(credentialView(base), at - 90 * 1000)).toBe('1분 뒤');
    expect(expiryText(credentialView(base), at - 20 * 1000)).toBe('1분 안');
    expect(expiryText(credentialView(base), at + 1000)).toBe('');
    expect(expiryText(credentialView({ registered: true }), 0)).toBe('');
  });
});

describe('settings 데이터 — MCP 서버(읽기 전용, env 값은 어디에도 없다)', () => {
  it('이름·명령·도구 수·읽기 전용 수·env 이름만 옮긴다', () => {
    const data: McpListResponse = {
      servers: [
        {
          name: 'filesystem',
          command: 'npx',
          args: ['-y', '@mcp/server-fs'],
          env: ['ROOT_DIR'],
          tools: [{ name: 'read', read_only: true }, { name: 'list', read_only: true }, { name: 'write', read_only: false }, { name: 'rm' }],
          dropped: ['bad name'],
          registered_ms: 1,
        },
      ],
    };
    expect(mcpView(data)).toEqual([{ name: 'filesystem', commandLine: 'npx -y @mcp/server-fs', envNames: ['ROOT_DIR'], tools: 4, readOnly: 2, dropped: 1 }]);
  });

  it('env 가 값 지도로 와도 이름만 남긴다 — 값은 버린다(I1·I19)', () => {
    const data = { servers: [{ name: 'x', command: 'cmd', env: { API_TOKEN: 'mcp-env-SECRET-VALUE', B: 'v2' } }] } as unknown as McpListResponse;
    const rows = mcpView(data);
    expect(rows[0]?.envNames).toEqual(['API_TOKEN', 'B']);
    expect(JSON.stringify(rows)).not.toContain('SECRET-VALUE');
    expect(JSON.stringify(rows)).not.toContain('v2');
  });

  it('비밀처럼 보이는 인자의 값은 가린다', () => {
    const data = { servers: [{ name: 'x', command: 'srv', args: ['--token=abc123', '--api-key', 'abc456', '--password', 'pw', '--root', '/data', 'SECRET_LOOKING'] }] } as unknown as McpListResponse;
    const line = mcpView(data)[0]?.commandLine ?? '';
    expect(line).not.toContain('abc123');
    expect(line).not.toContain('abc456');
    expect(line).not.toContain('pw');
    expect(line).toContain('--root /data');
    expect(line).toContain('--token=…');
    expect(line).toContain('--api-key …');
  });

  it('이름이 없는 서버는 버린다. servers 가 배열이 아니면 빈 목록', () => {
    expect(mcpView({ servers: [{ command: 'x' }, { name: '' }, { name: 'ok' }] })).toHaveLength(1);
    expect(mcpView({ servers: 'x' } as unknown as McpListResponse)).toEqual([]);
  });
});

describe('settings 데이터 — 한도 기본값 · 열린 세션', () => {
  it('새 세션 폼이 채우는 값과 같다(모듈 기본값): 24 · 900 · 무제한', () => {
    expect(LIMIT_DEFAULTS).toMatchObject({ maxSteps: 24, maxSeconds: 900, tokenBudget: null });
    expect(LIMIT_DEFAULTS.stepsRange).toEqual({ min: 1, max: 100 });
    expect(LIMIT_DEFAULTS.secondsRange).toEqual({ min: 1, max: 7200 });
  });

  it('열린 세션은 종료 상태(done·cancelled·failed·archived)가 아닌 것이다 — idle 도 열려 있다', () => {
    const rows = [snap({ session_id: 'a', state: 'idle' }), snap({ session_id: 'b', state: 'running' }), snap({ session_id: 'c', state: 'done' }), snap({ session_id: 'd', state: 'archived' }), snap({ session_id: 'e', state: 'waiting-approval' })];
    expect(openSessions(rows).map((s) => s.session_id)).toEqual(['a', 'b', 'e']);
  });
});
