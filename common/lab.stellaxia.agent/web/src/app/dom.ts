// DOM 도우미 — 모든 동적 텍스트는 textContent(텍스트 노드)로만 넣는다(I1·I7).
// innerHTML·insertAdjacentHTML·outerHTML 은 이 앱 어디에도 쓰지 않는다 — tests/no-html-insertion.test.ts 가 소스를 훑어 막는다.
// 모델·외부 텍스트에 들어 있는 `<b>`·`{{…}}` 는 글자 그대로 나온다.

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  /** 클래스 이름(공백 구분). */
  class?: string;
  /** 속성(aria-*, role, data-* …). undefined·null·false 는 붙이지 않는다. true 는 빈 값으로 붙인다. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** DOM 프로퍼티(disabled, value, type …). */
  props?: Record<string, unknown>;
  /** 이벤트 리스너. */
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

export function setAttrs(el: Element, attrs: NonNullable<Props['attrs']>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.attrs) setAttrs(el, props.attrs);
  if (props.props) Object.assign(el, props.props);
  if (props.on) {
    for (const [type, listener] of Object.entries(props.on)) {
      el.addEventListener(type, listener as EventListener);
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

/** 자식을 통째로 바꾼다. */
export function setChildren(parent: Node, children: readonly Child[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  append(parent, children);
}

/** 텍스트만 바뀌었으면 건드리지 않는다 — 스크린 리더가 같은 글을 다시 읽지 않게. */
export function setText(el: Node, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setClass(el: Element, className: string): void {
  if (el.className !== className) el.className = className;
}

// ── 키 기준 맞추기 ──────────────────────────────────────────────────────
// 폴링마다 목록을 통째로 다시 그리면 키보드 초점이 사라진다. 같은 키의 노드는 그대로 두고 갱신만 한다.

export interface Reconciler<T> {
  key(item: T): string;
  create(item: T): HTMLElement;
  update(el: HTMLElement, item: T): void;
}

export function reconcile<T>(container: HTMLElement, items: readonly T[], r: Reconciler<T>): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const key = (child as HTMLElement).dataset['key'];
    if (key !== undefined) existing.set(key, child as HTMLElement);
  }
  let cursor: Node | null = container.firstChild;
  const wanted = new Set<string>();
  for (const item of items) {
    const key = r.key(item);
    wanted.add(key);
    let el = existing.get(key);
    if (!el) {
      el = r.create(item);
      el.dataset['key'] = key;
    }
    r.update(el, item);
    if (el === cursor) cursor = cursor.nextSibling;
    else container.insertBefore(el, cursor);
  }
  for (const [key, el] of existing) if (!wanted.has(key)) el.remove();
}

// ── 아이콘 ──────────────────────────────────────────────────────────────
// 시연의 <symbol> 스프라이트를 DOM 으로 만든다. 경로 값은 모두 이 파일의 상수다.

type Shape = readonly ['path', string] | readonly ['circle', number, number, number] | readonly ['rect', number, number, number, number, number?];

const ICONS: Record<string, readonly Shape[]> = {
  spark: [['circle', 12, 12, 2.4], ['path', 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6']],
  key: [['circle', 8, 14, 4], ['path', 'M11 11l9-9M16 6l3 3M14 8l2 2']],
  shield: [['path', 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z']],
  lock: [['rect', 5, 11, 14, 10, 2], ['path', 'M8 11V8a4 4 0 0 1 8 0v3']],
  check: [['path', 'M5 12l5 5 9-10']],
  warn: [['path', 'M12 3l10 18H2z'], ['path', 'M12 10v5M12 18v.01']],
  info: [['circle', 12, 12, 9], ['path', 'M12 11v6M12 7.5v.01']],
  x: [['path', 'M6 6l12 12M18 6L6 18']],
  plus: [['path', 'M12 5v14M5 12h14']],
  up: [['path', 'M12 19V5M5 12l7-7 7 7']],
  stop: [['rect', 6, 6, 12, 12, 1]],
  chevr: [['path', 'M9 6l6 6-6 6']],
  eye: [['path', 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'], ['circle', 12, 12, 3]],
  gear: [['circle', 12, 12, 3], ['path', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1']],
  cube: [['path', 'M12 3l8 4.5v9L12 21l-8-4.5v-9z'], ['path', 'M12 12l8-4.5M12 12v9M12 12L4 7.5']],
  clock: [['circle', 12, 12, 9], ['path', 'M12 7v5l3 2']],
  term: [['path', 'M4 6l5 6-5 6M12 18h8']],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 장식 아이콘 — 스크린 리더에는 숨긴다. 뜻은 항상 옆의 글자가 말한다. */
export function icon(name: keyof typeof ICONS | string, size: 's' | 'm' | 'l' = 'm'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', size === 'm' ? 'ic' : `ic ${size}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const shape of ICONS[name] ?? []) {
    const node = document.createElementNS(SVG_NS, shape[0]);
    if (shape[0] === 'path') node.setAttribute('d', shape[1]);
    else if (shape[0] === 'circle') {
      node.setAttribute('cx', String(shape[1]));
      node.setAttribute('cy', String(shape[2]));
      node.setAttribute('r', String(shape[3]));
    } else {
      node.setAttribute('x', String(shape[1]));
      node.setAttribute('y', String(shape[2]));
      node.setAttribute('width', String(shape[3]));
      node.setAttribute('height', String(shape[4]));
      if (shape[5] !== undefined) node.setAttribute('rx', String(shape[5]));
    }
    svg.appendChild(node);
  }
  return svg;
}
