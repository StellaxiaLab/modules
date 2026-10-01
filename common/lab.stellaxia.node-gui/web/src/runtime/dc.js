// 작은 템플릿 런타임 — 디자인 캔버스의 .dc.html 문법을 그대로 브라우저에서 돌린다
//  · {{a.b.c}}      : 텍스트 · 속성 안의 값 (점 경로만)
//  · on이벤트="{{f}}" : 이벤트 핸들러 (onClick, onPointerDown, onChange ...)
//  · <sc-for list="{{목록}}" as="이름">, <sc-if value="{{조건}}">
//  · class 화면 extends DCLogic { renderVals() { return { ... } } } + setState
// 상태가 바뀌면 템플릿을 다시 계산해 바뀐 부분만 DOM에 반영한다.

export class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
    this.__render = null;
  }
  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next);
    if (this.__render) this.__render();
  }
  forceUpdate() { if (this.__render) this.__render(); }
}

const HOLE = /\{\{\s*([\w$.]+)\s*\}\}/g;
const ONLY_HOLE = /^\{\{\s*([\w$.]+)\s*\}\}$/;
const EVENTS = {
  onclick: 'click', onpointerdown: 'pointerdown', onpointermove: 'pointermove', onpointerup: 'pointerup',
  onpointerleave: 'pointerleave', onpointerenter: 'pointerenter', onpointercancel: 'pointercancel', onmouseenter: 'mouseenter', onmouseleave: 'mouseleave', onfocus: 'focus', onblur: 'blur', onkeydown: 'keydown', onkeyup: 'keyup',
  oncontextmenu: 'contextmenu', onsubmit: 'submit', onchange: 'change', oninput: 'input', ondblclick: 'dblclick', onwheel: 'wheel'
};

// ── 템플릿 → 트리 ───────────────────────────────────────────
// 브라우저 파서는 <select> 안의 모르는 태그를 버리므로, sc-for / sc-if를 <template>로 바꿔 읽는다
function prep(src) {
  return src
    .replace(/<sc-(for|if)\b/g, '<template data-sc="$1"')
    .replace(/<\/sc-(for|if)>/g, '</template>');
}
function kidsOf(node) {
  return Array.from(node.content ? node.content.childNodes : node.childNodes);
}
function compileNode(node) {
  if (node.nodeType === 3) {
    const t = node.nodeValue;
    if (!t.trim() && !t.includes(' ')) return t.includes('\n') ? null : { k: 'text', parts: split(t) };
    return { k: 'text', parts: split(t) };
  }
  if (node.nodeType !== 1) return null;
  const tag = node.localName;
  const sc = node.getAttribute && node.getAttribute('data-sc');
  if (tag === 'template' && sc) {
    const kids = compileKids(node);
    if (sc === 'for') return { k: 'for', list: hole(node.getAttribute('list')), as: node.getAttribute('as'), kids };
    return { k: 'if', value: hole(node.getAttribute('value')), kids };
  }
  const attrs = [], events = [];
  for (const a of Array.from(node.attributes)) {
    const n = a.name;
    if (n.startsWith('hint-')) continue;
    const ev = EVENTS[n.toLowerCase()];
    if (ev) { events.push({ name: ev, react: n.toLowerCase(), path: hole(a.value) }); continue; }
    attrs.push({ name: n, ns: a.namespaceURI, parts: split(a.value) });
  }
  return { k: 'el', tag, ns: node.namespaceURI, attrs, events, kids: compileKids(node) };
}
function compileKids(node) { return kidsOf(node).map(compileNode).filter(Boolean); }
function hole(v) { const m = ONLY_HOLE.exec((v || '').trim()); return m ? m[1] : null; }
function split(s) {
  const out = [];
  let last = 0, m;
  HOLE.lastIndex = 0;
  while ((m = HOLE.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push({ p: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// ── 값 찾기 ─────────────────────────────────────────────────
function lookup(scope, path) {
  if (path === 'true') return true;
  if (path === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
  const segs = path.split('.');
  let v;
  for (let s = scope; s; s = s.parent) {
    if (s.vars && Object.prototype.hasOwnProperty.call(s.vars, segs[0])) { v = s.vars[segs[0]]; break; }
  }
  for (let i = 1; i < segs.length && v != null; i++) v = v[segs[i]];
  return v;
}
function str(parts, scope) {
  if (parts.length === 1 && typeof parts[0] === 'object') {
    const v = lookup(scope, parts[0].p);
    return v == null || v === false ? null : String(v);
  }
  return parts.map((q) => typeof q === 'string' ? q : (() => { const v = lookup(scope, q.p); return v == null ? '' : String(v); })()).join('');
}

// ── 가상 트리 ──────────────────────────────────────────────
function build(nodes, scope, out) {
  for (const n of nodes) {
    if (n.k === 'text') out.push({ t: str(n.parts, scope) || '' });
    else if (n.k === 'if') { if (lookup(scope, n.value)) build(n.kids, scope, out); }
    else if (n.k === 'for') {
      const list = lookup(scope, n.list) || [];
      for (let i = 0; i < list.length; i++) build(n.kids, { parent: scope, vars: { [n.as]: list[i] } }, out);
    } else {
      const attrs = {};
      for (const a of n.attrs) { const v = str(a.parts, scope); if (v !== null) attrs[a.name] = v; }
      const events = {};
      for (const e of n.events) {
        const f = e.path ? lookup(scope, e.path) : null;
        if (typeof f !== 'function') continue;
        // React처럼: 입력칸의 onChange는 값이 바뀔 때마다(input) 불린다
        const type = e.name === 'change' && (n.tag === 'input' || n.tag === 'textarea') ? 'input' : e.name;
        events[type] = f;
      }
      const kids = [];
      build(n.kids, scope, kids);
      out.push({ tag: n.tag, ns: n.ns, attrs, events, kids });
    }
  }
  return out;
}

// ── DOM 반영 ────────────────────────────────────────────────
function create(v) {
  if (v.t !== undefined) return document.createTextNode(v.t);
  const el = document.createElementNS(v.ns, v.tag);
  el.__v = { tag: v.tag, ns: v.ns, attrs: {}, events: {}, kids: [] };
  patchEl(el, v);
  return el;
}
function same(el, v) {
  if (v.t !== undefined) return el.nodeType === 3;
  return el.nodeType === 1 && el.__v && el.__v.tag === v.tag && el.__v.ns === v.ns;
}
function patchEl(el, v) {
  const old = el.__v;
  for (const k in old.attrs) if (!(k in v.attrs)) el.removeAttribute(k);
  for (const k in v.attrs) {
    if (old.attrs[k] === v.attrs[k] && k !== 'value') continue;
    if (k === 'value' && (v.tag === 'input' || v.tag === 'select' || v.tag === 'textarea')) continue;
    if (k === 'checked' && v.tag === 'input') continue;
    el.setAttribute(k, v.attrs[k]);
  }
  el.__h = el.__h || {};
  el.__reg = el.__reg || {};   // 이미 붙인 리스너 종류 — 핸들러가 잠시 비었다가 다시 생겨도 리스너를 두 번 붙이지 않는다
  for (const type in v.events) {
    if (!el.__reg[type]) { el.__reg[type] = true; el.addEventListener(type, (e) => { const f = el.__h[type]; if (f) f(e); }); }
    el.__h[type] = v.events[type];
  }
  for (const type in el.__h) if (!(type in v.events)) el.__h[type] = null;
  patchKids(el, v.kids);
  // 입력값은 속성이 아니라 값으로 (자식 option이 만들어진 뒤에)
  if (v.tag === 'input' && (v.attrs.type === 'checkbox' || v.attrs.type === 'radio')) el.checked = 'checked' in v.attrs;
  if ('value' in v.attrs && (v.tag === 'input' || v.tag === 'select' || v.tag === 'textarea')) {
    if (el.value !== v.attrs.value) el.value = v.attrs.value;
  }
  el.__v = v;
}
function patchKids(parent, vkids) {
  const dom = Array.from(parent.childNodes);
  for (let i = 0; i < vkids.length; i++) {
    const v = vkids[i], cur = dom[i];
    if (cur && same(cur, v)) {
      if (v.t !== undefined) { if (cur.nodeValue !== v.t) cur.nodeValue = v.t; }
      else patchEl(cur, v);
    } else {
      const el = create(v);
      if (cur) parent.replaceChild(el, cur); else parent.appendChild(el);
    }
  }
  for (let i = dom.length - 1; i >= vkids.length; i--) parent.removeChild(dom[i]);
}

// ── 화면 띄우기 ─────────────────────────────────────────────
export function mount(Component, { template, target, props } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = prep(template);
  const tree = compileKids(tpl);
  const comp = new Component(props || {});
  let queued = false, mounted = false;
  const render = () => {
    queued = false;
    const vals = comp.renderVals();
    patchKids(target, build(tree, { vars: vals }, []));
  };
  comp.__render = () => { if (!mounted) return; if (!queued) { queued = true; queueMicrotask(render); } };
  render();
  mounted = true;
  if (comp.componentDidMount) comp.componentDidMount();
  window.addEventListener('pagehide', () => { if (comp.componentWillUnmount) comp.componentWillUnmount(); });
  return comp;
}

// 고정 크기 화면을 창에 맞춰 줄인다 (늘리지는 않음)
export function fit(stage, w, h) {
  const apply = () => {
    const k = Math.min(1, (window.innerWidth - 24) / w, (window.innerHeight - 24) / h);
    stage.style.transform = 'scale(' + k + ')';
    stage.parentElement.style.width = Math.ceil(w * k) + 'px';
    stage.parentElement.style.height = Math.ceil(h * k) + 'px';
  };
  apply();
  window.addEventListener('resize', apply);
}
