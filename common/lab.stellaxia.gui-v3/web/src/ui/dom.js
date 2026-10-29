// DOM 묶기 — h() 로 요소를 만들고, 함수인 값은 signal 에 묶어 그 자리만 고친다.
//
//   h('button', { class: () => on() ? 'nx-tab on' : 'nx-tab', onClick: pick }, '설치됨', () => n())
//   · on* 은 이벤트, 함수인 속성 · 자식은 반응형(값이 바뀌면 그 속성 · 글자만), 나머지는 한 번
//   · disabled · readonly · checked 처럼 켜고 끄는 속성은 null/false 면 뺀다
//   · keyed(items, key, render) 는 목록 — 열쇠가 같은 줄은 DOM 을 다시 만들지 않고 자리만 옮긴다
// 문서 객체가 없는 곳(Node 시험)에서는 쓰지 않는다 — 시험은 signals · 순수 로직만 본다.

import { effect, scope, signal, untrack } from './signals.js';

const BOOL = new Set(['disabled', 'readonly', 'checked', 'hidden', 'selected', 'open']);

function setProp(el, k, v) {
  if (k === 'class') el.className = v ?? '';
  else if (k === 'style' && typeof v === 'object' && v) Object.assign(el.style, v);
  else if (k === 'value') { if (el.value !== String(v ?? '')) el.value = v ?? ''; }
  else if (BOOL.has(k)) { if (v == null || v === false) el.removeAttribute(k); else el.setAttribute(k, ''); if (k === 'checked') el.checked = !!v; }
  else if (v == null || v === false) el.removeAttribute(k);
  else el.setAttribute(k, v === true ? '' : String(v));
}

/** @param {string} tag @param {object|null} props @param  {...any} kids */
export function h(tag, props, ...kids) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'ref' && typeof v === 'function') v(el);
    else if (typeof v === 'function') effect(() => setProp(el, k, v()));
    else setProp(el, k, v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    if (typeof c === 'function') {
      // 반응형 자식 — 글자면 글자 노드 하나, 노드면 그 자리를 바꾼다
      let node = document.createTextNode('');
      el.appendChild(node);
      effect(() => {
        const v = c();
        if (v instanceof Node) { if (node !== v) { node.replaceWith(v); node = v; } }
        else { if (!(node instanceof Text)) { const t = document.createTextNode(''); node.replaceWith(t); node = t; } const s = v == null ? '' : String(v); if (node.data !== s) node.data = s; }
      });
    } else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * 열쇠 목록 — items() 가 바뀌면 줄을 맞춘다. 같은 열쇠의 줄은 그대로 두고(그 줄 안의 반응형 값이 알아서 고친다) 새 줄만 만든다.
 * @template T @param {() => T[]} items @param {(t: T) => string} key @param {(t: () => T, i: number) => Node} render
 */
export function keyed(items, key, render) {
  const box = document.createDocumentFragment(), start = document.createComment('['), end = document.createComment(']');
  box.append(start, end);
  let rows = new Map();
  effect(() => {
    const list = items(), next = new Map(), parent = start.parentNode;
    if (!parent) return;
    let at = start;
    list.forEach((t, i) => {
      const k = key(t); let row = rows.get(k);
      if (!row) { const sig = signal(t), [node, dispose] = untrack(() => scope(() => render(sig, i))); row = { sig, node, dispose }; }
      else row.sig.set(t);
      next.set(k, row);
      if (at.nextSibling !== row.node) parent.insertBefore(row.node, at.nextSibling);
      at = row.node;
    });
    for (const [k, row] of rows) if (!next.has(k)) { row.dispose(); row.node.remove(); }
    rows = next;
  });
  return box;
}
