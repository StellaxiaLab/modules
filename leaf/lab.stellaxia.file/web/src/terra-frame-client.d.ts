/**
 * `terra.web/frame` 안에서 도는 웹 프로그램의 참조 클라이언트 (웹 프로그램 감싸기 설계 §7).
 *
 * 의존성이 없다. 빌드한 파일 하나(`dist/terra-frame-client.js`)를 모듈의 웹 빌드에
 * 복사해 써도 되고, 설계 §4.4의 메시지 표를 보고 직접 짜도 된다. 프로토콜이 계약이다.
 *
 *   const terra = await connectTerra();
 *   const res = await terra.fetch('/v1/materials'); // → /api/modules/<모듈>/v1/materials + Authorization
 *
 * 토큰은 메모리에만 둔다. localStorage에 두지 않는다. 수명이 짧고 frame이 언제든 새로 준다.
 * 토큰은 상대 경로 요청에만 붙인다. 절대 URL은 다른 origin일 수 있으므로 붙이지 않는다.
 */
export declare const FRAME_PROTOCOL = 1;
export declare const FRAME_HELLO = "terra.frame.hello";
export declare const FRAME_INIT = "terra.frame.init";
export declare const FRAME_TOKEN = "terra.frame.token";
export declare const FRAME_SIGNED_OUT = "terra.frame.signedOut";
export declare const FRAME_REFRESH = "terra.frame.refresh";
export declare const FRAME_VALUE = "terra.frame.value";
export declare const FRAME_EMIT = "terra.frame.emit";
/** 호스트 비밀번호 칸(설계 §4.9). frame이 `init.features`에 `secret`을 실었을 때만 쓴다. */
export declare const FRAME_SECRET_PLACE = "terra.frame.secret.place";
export declare const FRAME_SECRET_HIDE = "terra.frame.secret.hide";
export declare const FRAME_SECRET_FOCUS = "terra.frame.secret.focus";
export declare const FRAME_SECRET_SUBMIT = "terra.frame.secret.submit";
export declare const FRAME_SECRET_STATE = "terra.frame.secret.state";
export declare const FRAME_SECRET_KEY = "terra.frame.secret.key";
export declare const FRAME_SECRET_SENT = "terra.frame.secret.sent";
/** 기억된 로그인(auto). frame이 `init.features`에 `remember`를 실었을 때만 쓴다. */
export declare const FRAME_SECRET_RESUME = "terra.frame.secret.resume";
export declare const FRAME_SECRET_FORGET = "terra.frame.secret.forget";
/**
 * 토큰이 없을 때 호스트가 알려 주는 이유(설계 §4.4). `HOST_UNSUPPORTED`는 frame이 아니라 셸 앱 목록이 보낸다.
 * 그 호스트는 이 규약으로 토큰을 주지 않는다(앱 호스트 프로토콜 통합 설계 P3).
 */
export type TokenAbsence = 'NO_SESSION' | 'SCOPE_TOKEN_DENIED' | 'NO_APP_ORIGIN' | 'TOKEN_UNAVAILABLE' | 'HOST_UNSUPPORTED';
/** 웹 뷰포트 기준 CSS px. `getBoundingClientRect()` 그대로 주면 된다. */
export interface SecretRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** 호스트 칸에 줄 수 있는 모양 토큰. 이 밖의 키와 CSS 함수(`url(`·`var(` 등)는 호스트가 버린다. */
export interface SecretStyle {
    fontFamily?: string;
    fontSize?: string | number;
    fontWeight?: string | number;
    color?: string;
    caret?: string;
    background?: string;
    border?: string;
    radius?: string | number;
    padding?: string | number;
    letterSpacing?: string | number;
    textAlign?: string;
}
export interface SecretPlaceOptions {
    style?: SecretStyle;
    /** 칸의 `aria-label`. 기본 "비밀번호". */
    label?: string;
    placeholder?: string;
}
/** 호스트가 알려 주는 칸의 상태. 값도 길이도 오지 않는다. `empty`만 안다. */
export interface SecretFieldState {
    shown: boolean;
    focused: boolean;
    empty: boolean;
}
/** 칸에서 눌린 이동·제출 키. 호스트는 기본 동작을 막고 웹에 맡긴다. */
export type SecretKey = 'Enter' | 'Tab' | 'ShiftTab' | 'Escape';
/**
 * 호스트 비밀번호 칸(설계 §4.9). 비밀번호 `<input>`은 호스트 문서에 있고, 이 웹은 그 값을 읽을 수 없다.
 * 웹은 자리·모양을 주고, 비밀이 아닌 값과 함께 제출을 부탁한다. 결과는 토큰(`onToken`) 또는 Scene이
 * `bind`로 넘기는 값(`onValue`)으로 온다.
 */
export interface SecretField {
    /** 칸을 이 자리에 둔다. 배치가 바뀔 때마다 다시 부른다. */
    place(rect: SecretRect, options?: SecretPlaceOptions): void;
    /**
     * 요소의 자리를 따라 칸을 둔다. 창 크기·스크롤·요소 크기가 바뀌면 다시 놓는다.
     * 연출처럼 요소가 스스로 움직이면 돌려받은 `update()`를 부른다.
     */
    follow(element: Element, options?: SecretPlaceOptions): {
        stop(): void;
        update(): void;
    };
    /** 칸을 걷는다. 호스트는 값도 지운다. */
    hide(): void;
    /** 호스트 칸에 포커스를 준다. */
    focus(): void;
    /** 비밀이 아닌 값(아이디 등)과 함께 제출한다. 호스트가 칸의 값을 더해 Scene이 선언한 이벤트로 넘긴다. */
    submit(fields?: Record<string, string | number | boolean>): void;
    state(): SecretFieldState;
    onState(listener: (state: SecretFieldState) => void): () => void;
    onKey(listener: (key: SecretKey) => void): () => void;
    /** 호스트가 제출을 Scene에 넘겼다. 결과가 온 것은 아니다. */
    onSent(listener: () => void): () => void;
}
/**
 * 기억된 로그인(auto). 기억하는 것은 Gateway이고(Master refresh token을 OS 보호 저장소로 봉한다),
 * 이 웹이 아는 것은 기억된 id뿐이다. 로그인 화면에서 auto를 켜고 제출하면(`submit`의 `auto: true`)
 * 기억되고, 다음에 `resume`으로 비밀번호 없이 들어간다.
 */
export interface RememberedLoginAccess {
    /** 이 Scene에 기억된 id. 없으면 undefined. */
    remembered(): {
        email: string;
    } | undefined;
    /** 기억된 로그인으로 들어간다. 결과는 `submit`과 같은 길(`onToken`·`onValue`)로 온다. */
    resume(fields?: Record<string, string | number | boolean>): void;
    /** 기억을 지운다(auto 해제). */
    forget(): void;
}
export interface TerraFrame {
    readonly appId: string;
    readonly moduleId: string;
    readonly sceneId: string;
    /** `/api/modules/<모듈 id>`. 자기 모듈 API의 뿌리다. */
    readonly apiBase: string;
    /** frame 없이 `devToken`으로 섰는가(설계 Q8). */
    readonly dev: boolean;
    /** 지금의 스코프 토큰. 없으면 undefined. */
    token(): string | undefined;
    /** 토큰이 실은 권한. */
    permissions(): string[];
    /** 토큰이 없는 이유. 토큰이 있으면 undefined. */
    absence(): TokenAbsence | undefined;
    /** Scene이 `bind`로 넘긴 마지막 값. */
    value(): unknown;
    /**
     * 요청을 보낸다. 상대 경로는 `apiBase`를 앞에 붙인다(`/api/`로 시작하면 그대로 둔다).
     * 상대 경로면 토큰을 붙이고, 401이면 한 번 갱신을 요청해 다시 보낸다.
     */
    fetch(path: string, init?: RequestInit): Promise<Response>;
    /** frame에 재발급을 요청하고 새 토큰을 기다린다. */
    refresh(): Promise<string | undefined>;
    /** Scene의 `on`에 선언된 이벤트를 낸다. 선언되지 않은 이벤트는 Scene이 버린다. */
    emit(event: string, value?: unknown): void;
    /** 호스트가 말한 기능(`init.features`). 이전 Terra는 비어 있다. */
    features(): string[];
    /** 호스트 비밀번호 칸. 호스트가 `secret` 기능을 말하지 않았으면 undefined다 — 그때는 Scene의 로그인에 맡긴다. */
    readonly secret: SecretField | undefined;
    /** 기억된 로그인. 호스트가 `remember` 기능을 말하지 않았으면 undefined다. */
    readonly remember: RememberedLoginAccess | undefined;
    onToken(listener: (token: string | undefined) => void): () => void;
    onValue(listener: (value: unknown) => void): () => void;
    /** 메시지 리스너를 걷는다. */
    close(): void;
}
/** 시험이 창을 바꿔 끼우는 자리. 브라우저에서는 `window` 그 자체다. */
export interface FrameWindow {
    readonly parent: {
        postMessage(message: unknown, targetOrigin: string): void;
    };
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
export interface ConnectOptions {
    /** `init`을 기다리는 시간. 기본 5초. `refresh`의 대기에도 쓴다. */
    timeoutMs?: number;
    /**
     * 단독 개발용 토큰이다(설계 Q8). frame 밖에서 돌거나 `init`이 오지 않으면 이 토큰으로 선다.
     * CLI 세션으로 `terra.gateway.gui.apps.by-id.token.post`를 불러 받는다. 제품에서는 쓰지 않는다.
     */
    devToken?: string;
    /** 단독 개발 때의 모듈 id. `apiBase`가 `/api/modules/<devModuleId>`가 된다. */
    devModuleId?: string;
    window?: FrameWindow;
    fetch?: typeof fetch;
}
/** frame에 `hello`를 보내고 `init`을 기다린다. */
export declare function connectTerra(options?: ConnectOptions): Promise<TerraFrame>;
