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
export const FRAME_PROTOCOL = 1;
export const FRAME_HELLO = 'terra.frame.hello';
export const FRAME_INIT = 'terra.frame.init';
export const FRAME_TOKEN = 'terra.frame.token';
export const FRAME_SIGNED_OUT = 'terra.frame.signedOut';
export const FRAME_REFRESH = 'terra.frame.refresh';
export const FRAME_VALUE = 'terra.frame.value';
export const FRAME_EMIT = 'terra.frame.emit';
/** 호스트 비밀번호 칸(설계 §4.9). frame이 `init.features`에 `secret`을 실었을 때만 쓴다. */
export const FRAME_SECRET_PLACE = 'terra.frame.secret.place';
export const FRAME_SECRET_HIDE = 'terra.frame.secret.hide';
export const FRAME_SECRET_FOCUS = 'terra.frame.secret.focus';
export const FRAME_SECRET_SUBMIT = 'terra.frame.secret.submit';
export const FRAME_SECRET_STATE = 'terra.frame.secret.state';
export const FRAME_SECRET_KEY = 'terra.frame.secret.key';
export const FRAME_SECRET_SENT = 'terra.frame.secret.sent';
/** 기억된 로그인(auto). frame이 `init.features`에 `remember`를 실었을 때만 쓴다. */
export const FRAME_SECRET_RESUME = 'terra.frame.secret.resume';
export const FRAME_SECRET_FORGET = 'terra.frame.secret.forget';
const DEFAULT_TIMEOUT_MS = 5_000;
/** frame에 `hello`를 보내고 `init`을 기다린다. */
export function connectTerra(options = {}) {
    const win = options.window ?? globalThis.window;
    const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (win.parent === win) {
        const dev = devFrame(options, doFetch);
        return dev
            ? Promise.resolve(dev)
            : Promise.reject(new Error('terra.web/frame 밖 — 단독 실행 : devToken · devModuleId 필요'));
    }
    return new Promise((resolve, reject) => {
        let parentOrigin = '';
        let connected = false;
        let token;
        let permissions = [];
        let absence;
        let value;
        let ids = { appId: '', moduleId: '', sceneId: '', apiBase: '' };
        let waiting = [];
        let features = [];
        let remembered;
        let secretState = { shown: false, focused: false, empty: true };
        const tokenListeners = new Set();
        const valueListeners = new Set();
        const secretStateListeners = new Set();
        const secretKeyListeners = new Set();
        const secretSentListeners = new Set();
        const setToken = (next, nextPermissions, reason) => {
            token = typeof next === 'string' && next ? next : undefined;
            permissions = Array.isArray(nextPermissions)
                ? nextPermissions.filter((item) => typeof item === 'string')
                : [];
            absence = token ? undefined : typeof reason === 'string' ? reason : 'NO_SESSION';
            tokenListeners.forEach((listener) => listener(token));
            const pending = waiting;
            waiting = [];
            pending.forEach((done) => done(token));
        };
        const setValue = (next) => {
            value = next;
            valueListeners.forEach((listener) => listener(value));
        };
        const post = (message) => {
            win.parent.postMessage(message, parentOrigin);
        };
        const refresh = () => new Promise((done) => {
            const finish = (next) => {
                clearTimeout(timer);
                done(next);
            };
            const timer = setTimeout(() => {
                waiting = waiting.filter((candidate) => candidate !== finish);
                done(token);
            }, timeoutMs);
            waiting.push(finish);
            post({ type: FRAME_REFRESH });
        });
        const place = (rect, placeOptions = {}) => post({
            type: FRAME_SECRET_PLACE,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            ...(placeOptions.style ? { style: { ...placeOptions.style } } : {}),
            ...(placeOptions.label ? { label: placeOptions.label } : {}),
            ...(placeOptions.placeholder ? { placeholder: placeOptions.placeholder } : {})
        });
        const secret = {
            place,
            follow: (element, placeOptions) => follow(element, (rect) => place(rect, placeOptions)),
            hide: () => post({ type: FRAME_SECRET_HIDE }),
            focus: () => post({ type: FRAME_SECRET_FOCUS }),
            submit: (fields = {}) => post({ type: FRAME_SECRET_SUBMIT, fields: { ...fields } }),
            state: () => ({ ...secretState }),
            onState: (listener) => subscribe(secretStateListeners, listener),
            onKey: (listener) => subscribe(secretKeyListeners, listener),
            onSent: (listener) => subscribe(secretSentListeners, listener)
        };
        const remember = {
            remembered: () => (remembered ? { ...remembered } : undefined),
            resume: (fields = {}) => post({ type: FRAME_SECRET_RESUME, fields: { ...fields } }),
            forget: () => {
                remembered = undefined;
                post({ type: FRAME_SECRET_FORGET });
            }
        };
        const frame = {
            get appId() {
                return ids.appId;
            },
            get moduleId() {
                return ids.moduleId;
            },
            get sceneId() {
                return ids.sceneId;
            },
            get apiBase() {
                return ids.apiBase;
            },
            dev: false,
            token: () => token,
            permissions: () => permissions.slice(),
            absence: () => absence,
            value: () => value,
            fetch: (path, init) => sendWithToken(doFetch, ids.apiBase, path, init, () => token, refresh),
            refresh,
            emit: (event, eventValue) => post({ type: FRAME_EMIT, event, value: eventValue }),
            features: () => features.slice(),
            get secret() {
                return features.includes('secret') ? secret : undefined;
            },
            get remember() {
                return features.includes('remember') ? remember : undefined;
            },
            onToken: (listener) => subscribe(tokenListeners, listener),
            onValue: (listener) => subscribe(valueListeners, listener),
            close: () => {
                win.removeEventListener('message', listener);
                tokenListeners.clear();
                valueListeners.clear();
                secretStateListeners.clear();
                secretKeyListeners.clear();
                secretSentListeners.clear();
            }
        };
        const listener = (event) => {
            // 부모 창이 보낸 것만 받는다. init 뒤로는 init을 준 origin에서 온 것만 받는다.
            if (event.source !== win.parent)
                return;
            if (connected && event.origin !== parentOrigin)
                return;
            const data = event.data;
            if (!data || typeof data !== 'object')
                return;
            switch (data.type) {
                case FRAME_INIT:
                    if (!connected)
                        parentOrigin = event.origin;
                    ids = {
                        appId: text(data.appId),
                        moduleId: text(data.moduleId),
                        sceneId: text(data.sceneId),
                        apiBase: text(data.apiBase)
                    };
                    features = Array.isArray(data.features)
                        ? data.features.filter((item) => typeof item === 'string')
                        : [];
                    remembered = readRemembered(data.remembered);
                    setToken(data.token, data.permissions, data.reason);
                    if (!connected) {
                        connected = true;
                        value = data.value;
                        clearTimeout(timer);
                        resolve(frame);
                    }
                    else {
                        setValue(data.value);
                    }
                    return;
                case FRAME_TOKEN:
                    if (connected)
                        setToken(data.token, data.permissions, undefined);
                    return;
                case FRAME_SIGNED_OUT:
                    if (connected)
                        setToken(undefined, [], data.reason);
                    return;
                case FRAME_VALUE:
                    if (connected)
                        setValue(data.value);
                    return;
                case FRAME_SECRET_STATE:
                    if (!connected)
                        return;
                    secretState = { shown: data.shown === true, focused: data.focused === true, empty: data.empty !== false };
                    secretStateListeners.forEach((listener) => listener({ ...secretState }));
                    return;
                case FRAME_SECRET_KEY:
                    if (connected && isSecretKey(data.key)) {
                        const key = data.key;
                        secretKeyListeners.forEach((listener) => listener(key));
                    }
                    return;
                case FRAME_SECRET_SENT:
                    if (connected)
                        secretSentListeners.forEach((listener) => listener());
                    return;
                default:
                    return;
            }
        };
        const timer = setTimeout(() => {
            if (connected)
                return;
            win.removeEventListener('message', listener);
            const dev = devFrame(options, doFetch);
            if (dev) {
                resolve(dev);
                return;
            }
            reject(new Error(`terra.web/frame 응답 없음 — ${FRAME_INIT} ${timeoutMs}ms 초과`));
        }, timeoutMs);
        win.addEventListener('message', listener);
        // hello에는 비밀이 없다. 부모의 origin을 아직 모르므로 '*'로 보낸다.
        win.parent.postMessage({ type: FRAME_HELLO, protocol: FRAME_PROTOCOL }, '*');
    });
}
/** 단독 개발용 frame. frame이 없으므로 값도 이벤트도 흐르지 않는다. */
function devFrame(options, doFetch) {
    const moduleId = options.devModuleId?.trim() ?? '';
    const token = options.devToken?.trim() || undefined;
    if (!moduleId && !token)
        return undefined;
    const apiBase = moduleId ? `/api/modules/${encodeURIComponent(moduleId)}` : '';
    const renewed = () => Promise.resolve(token);
    return {
        appId: '',
        moduleId,
        sceneId: '',
        apiBase,
        dev: true,
        token: () => token,
        permissions: () => [],
        absence: () => (token ? undefined : 'NO_SESSION'),
        value: () => undefined,
        fetch: (path, init) => sendWithToken(doFetch, apiBase, path, init, () => token, renewed),
        refresh: renewed,
        emit: () => undefined,
        features: () => [],
        secret: undefined,
        remember: undefined,
        onToken: () => () => undefined,
        onValue: () => () => undefined,
        close: () => undefined
    };
}
async function sendWithToken(doFetch, apiBase, path, init, current, refresh) {
    const relative = !/^[a-z][a-z0-9+.-]*:/i.test(path) && !path.startsWith('//');
    const url = relative && !path.startsWith('/api/') ? `${apiBase}${path.startsWith('/') ? '' : '/'}${path}` : path;
    const attempt = (bearer) => {
        const headers = new Headers(init?.headers);
        if (relative && bearer)
            headers.set('Authorization', `Bearer ${bearer}`);
        return doFetch(url, { ...init, headers });
    };
    const first = await attempt(current());
    if (first.status !== 401 || !relative || !current())
        return first;
    const renewed = await refresh();
    if (!renewed)
        return first;
    return attempt(renewed);
}
/**
 * 요소의 자리를 재어 `place`로 보낸다. 창 크기·스크롤·요소 크기 변화는 한 프레임에 한 번으로 모은다.
 * 자리가 같으면 보내지 않는다.
 */
function follow(element, send) {
    const view = element.ownerDocument?.defaultView ?? undefined;
    const raf = view?.requestAnimationFrame
        ? view.requestAnimationFrame.bind(view)
        : (run) => setTimeout(run, 16);
    const caf = view?.cancelAnimationFrame ? view.cancelAnimationFrame.bind(view) : (id) => clearTimeout(id);
    let last = '';
    let pending = 0;
    let stopped = false;
    const measure = () => {
        pending = 0;
        if (stopped)
            return;
        const box = element.getBoundingClientRect();
        const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
        const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
        if (key === last)
            return;
        last = key;
        send(rect);
    };
    const schedule = () => {
        if (!pending && !stopped)
            pending = raf(measure);
    };
    const Observer = view?.ResizeObserver;
    const observer = Observer ? new Observer(schedule) : undefined;
    observer?.observe(element);
    view?.addEventListener('resize', schedule);
    view?.addEventListener('scroll', schedule, true);
    measure();
    return {
        update: () => {
            last = '';
            measure();
        },
        stop: () => {
            stopped = true;
            if (pending)
                caf(pending);
            observer?.disconnect();
            view?.removeEventListener('resize', schedule);
            view?.removeEventListener('scroll', schedule, true);
        }
    };
}
function readRemembered(value) {
    const email = value && typeof value === 'object' ? value.email : undefined;
    return typeof email === 'string' && email.trim() ? { email: email.trim() } : undefined;
}
function isSecretKey(value) {
    return value === 'Enter' || value === 'Tab' || value === 'ShiftTab' || value === 'Escape';
}
function subscribe(listeners, listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
function text(value) {
    return typeof value === 'string' ? value : '';
}
