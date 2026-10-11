// TokenTransport — 개발용(`npm run dev`) 전송. 사용자 토큰을 `Authorization: Bearer` 로 Gateway 에 직접 싣는다.
//
// 안전 규칙:
//  - 토큰은 이 인스턴스의 클로저(비공개 필드)에만 있다. 로그·저장소(localStorage/sessionStorage/IndexedDB)·
//    URL·오류 메시지·JSON 직렬화에 나오지 않는다.
//  - 토큰은 `VITE_TERRA_DEV_TOKEN` 에서만 온다 — 그리고 개발 서버(import.meta.env.DEV)에서만.
//    프로덕션 빌드에서는 `import.meta.env.DEV` 가 false 로 접혀 토큰 읽기 자체가 번들에서 사라진다.
//  - 경로 제한·메서드·시간 제한은 브리지와 같은 파이프라인을 지난다(전송이 바뀌어도 동작이 같다).
// 셸 브리지의 X-Terra-Scope-Permissions 축소는 여기 없다 — 토큰 자체의 권한이 그대로 쓰인다(개발 전용인 이유).

import { execute, type PipelineOptions } from './pipeline';
import type { AgentTransport, TransportRequest, TransportResult } from './types';

export interface TokenTransportOptions extends PipelineOptions {
  /** 사용자 토큰. 이 값은 저장되지 않는다(메모리에만). */
  token: string;
  /** Gateway 주소. 기본은 같은 origin(개발 서버 프록시). */
  gatewayUrl?: string;
  fetchImpl?: typeof fetch;
}

export class TokenTransport implements AgentTransport {
  readonly kind = 'token' as const;

  readonly #token: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #options: PipelineOptions;

  constructor(options: TokenTransportOptions) {
    if (!options.token) throw new Error('TokenTransport: 토큰이 비어 있습니다');
    this.#token = options.token;
    this.#base = (options.gatewayUrl ?? '').replace(/\/+$/, '');
    this.#fetch = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    const { token: _token, gatewayUrl: _url, fetchImpl: _fetch, ...pipeline } = options;
    void _token;
    void _url;
    void _fetch;
    this.#options = pipeline;
  }

  request<T = unknown>(req: TransportRequest): Promise<TransportResult<T>> {
    return execute<T>((r, signal) => this.#send(r, signal), req, this.#options);
  }

  async #send(req: TransportRequest, signal: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${this.#token}` };
    const init: RequestInit = { method: req.method, headers, signal };
    if (req.body !== undefined && req.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }
    const response = await this.#fetch(this.#base + req.path, init);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined; // 빈 본문·HTML — 상태 코드로 판단한다
    }
    return { ok: response.ok, status: response.status, data };
  }

  /** 콘솔·JSON 에 찍혀도 토큰이 나오지 않는다. */
  toJSON(): { kind: 'token' } {
    return { kind: 'token' };
  }
}

/** 개발 서버에서 `VITE_TERRA_DEV_TOKEN` 이 있을 때만 토큰 전송을 만든다. 그 밖에는 undefined. */
export function createDevTokenTransport(options: Omit<TokenTransportOptions, 'token' | 'gatewayUrl'> = {}): TokenTransport | undefined {
  // 정적 치환을 위해 `import.meta.env.DEV` 를 직접 쓴다 — 프로덕션 빌드에서 이 분기 전체가 사라진다.
  if (import.meta.env.DEV) {
    const token = import.meta.env.VITE_TERRA_DEV_TOKEN;
    if (typeof token === 'string' && token.trim()) {
      const gateway = import.meta.env.VITE_TERRA_GATEWAY_URL;
      return new TokenTransport({
        ...options,
        token: token.trim(),
        ...(typeof gateway === 'string' && gateway ? { gatewayUrl: gateway } : {}),
      });
    }
  }
  return undefined;
}
