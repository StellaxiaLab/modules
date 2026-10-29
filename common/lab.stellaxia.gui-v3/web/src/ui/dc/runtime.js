// 보드 실행기 — 캔버스 시안(web/design 의 *.dc.html)을 웹 빌드에서 그대로 돌린다.
//
// 시안 보드는 세 조각이다: 마크업(템플릿) · 로직(class Component extends DCLogic) · 속성 기본값(data-props).
// 빌드 때 tools/dc-board.mjs 가 보드를 ES 모듈로 바꾸고(스크립트는 모듈 코드 — eval · new Function 없음, 앱 CSP script-src 'self' 그대로),
// 여기서는 그 모듈을 DOM 에 붙인다. React 없이 칸 단위로 바꾼다:
//   {{a.b}}                값 경로만(식 없음). 속성 값이 {{…}} 하나면 값 그대로(함수 · 객체 · null), 섞여 있으면 글자로 잇는다
//   <sc-if value>          참일 때만 안을 만든다(거짓이 되면 안의 보드는 componentWillUnmount)
//   <sc-for list as>       목록 차례대로 — 같은 자리의 DOM 을 다시 쓴다(늘면 뒤에 붙이고 줄면 뒤에서 뗀다)
//   <dc-import name …>     다른 보드. 속성은 kebab → camel 로 props, hint-* 는 버린다
//   on*="{{fn}}"           이벤트 — 요소에 리스너 하나, 매 렌더에 함수만 바꾼다. onFocus · onBlur 는 React 처럼 거품(focusin · focusout)
// 로직 쪽 규칙은 시안 실행기와 같다: 템플릿이 보는 값 = { ...props, ...renderVals() }, setState 는 바로 합치고 렌더는 모아서(마이크로태스크).

const BOARDS = new Map();

/** 빌드된 보드 모듈이 스스로 등록한다 */
export function defineBoard(def) { BOARDS.set(def.name, def); return def; }
export function boardDef(name) { return BOARDS.get(name) || null; }

export class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  renderVals() { return {}; }
  setState(patch, cb) {
    const p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    if (p) this.state = Object.assign({}, this.state, p);
    if (this.__host) this.__host.schedule(cb); else if (cb) queueMicrotask(cb);
  }
  forceUpdate(cb) { if (this.__host) this.__host.schedule(cb); }
}

// ───── 템플릿 ─────
const LIT = { true: true, false: false, null: null, undefined: undefined };
const EVENT = { doubleclick: 'dblclick', focus: 'focusin', blur: 'focusout' };
const BOOL_ATTR = new Set(['disabled', 'readonly', 'hidden', 'required', 'multiple', 'selected', 'autofocus', 'open']);
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function getPath(scope, path) {
  if (path in LIT) return LIT[path];
  const seg = path.split('.');
  let v = scope[seg[0]];
  for (let i = 1; i < seg.length && v != null; i++) v = v[seg[i]];
  return v;
}

/** 'left: {{x}}px' → 조각 [['t', 'left: '], ['v', 'x'], ['t', 'px']] · 바인딩이 없으면 null */
function parseText(s) {
  if (!s || s.indexOf('{{') < 0) return null;
  const out = [], re = /\{\{\s*([^}]*?)\s*\}\}/g; let last = 0, m;
  while ((m = re.exec(s))) { if (m.index > last) out.push(['t', s.slice(last, m.index)]); out.push(['v', m[1]]); last = re.lastIndex; }
  if (last < s.length) out.push(['t', s.slice(last)]);
  return out;
}
const evalParts = (parts, scope) => (parts.length === 1 && parts[0][0] === 'v' ? getPath(scope, parts[0][1]) : parts.map((p) => (p[0] === 't' ? p[1] : (() => { const v = getPath(scope, p[1]); return v == null || v === false ? '' : String(v); })())).join(''));

/** 템플릿 DOM → 만들기 함수들 (보드마다 한 번) */
function compileNodes(nodes) { const out = []; for (const n of nodes) { const c = compileNode(n); if (c) out.push(c); } return out; }
function compileNode(n) {
  if (n.nodeType === 3) {
    const parts = parseText(n.nodeValue);
    if (!parts) return { kind: 'static', node: n };
    return { kind: 'text', parts };
  }
  if (n.nodeType !== 1) return null;
  const tag = n.localName;
  if (tag === 'sc-if') return { kind: 'if', parts: parseText(n.getAttribute('value') || '') || [['t', n.getAttribute('value') || '']], kids: compileNodes(n.childNodes) };
  if (tag === 'sc-for') return { kind: 'for', list: (parseText(n.getAttribute('list') || '') || [['v', '']])[0][1], as: n.getAttribute('as') || 'item', kids: compileNodes(n.childNodes) };
  if (tag === 'dc-import') {
    const props = [];
    for (const a of n.attributes) { if (a.name === 'name' || a.name.startsWith('hint-')) continue; props.push([camel(a.name), parseText(a.value) || [['t', a.value]]]); }
    return { kind: 'import', name: n.getAttribute('name'), props };
  }
  const attrs = [], events = [], stat = [];
  for (const a of n.attributes) {
    if (a.name.startsWith('on') && a.name.length > 2) { const p = parseText(a.value); if (p) { const ev = a.name.slice(2); events.push([EVENT[ev] || ev, p]); } continue; }
    const p = parseText(a.value);
    if (p) attrs.push([a.name, p]); else stat.push([a.name, a.value]);
  }
  return { kind: 'el', ns: n.namespaceURI, tag, stat, attrs, events, kids: compileNodes(tag === 'template' ? n.content.childNodes : n.childNodes) };
}

function setAttr(el, name, v) {
  if (name === 'value' && 'value' in el && el.type !== 'file') { const s = v == null ? '' : String(v); if (el.value !== s) el.value = s; return; }
  if (name === 'checked' && 'checked' in el) { el.checked = v === true || v === 'true' || v === 'checked'; return; }
  if (name === 'style') { const s = v == null ? '' : String(v); if (el.__css !== s) { el.__css = s; el.setAttribute('style', s); } return; }
  if (v == null || v === false || (BOOL_ATTR.has(name) && (v === '' || v === 'false'))) { if (el.hasAttribute(name)) el.removeAttribute(name); return; }
  const s = v === true ? '' : String(v);
  if (el.getAttribute(name) !== s) el.setAttribute(name, s);
}

// ───── 보드 인스턴스 ─────
export class BoardHost {
  /** @param {string} name @param {object} props @param {{ wrap?: string }} [o] */
  constructor(name, props, o = {}) {
    const def = boardDef(name);
    if (!def) throw new Error('보드가 없음: ' + name);
    this.def = def; this.name = name; this.rawProps = props || {}; this.alive = true; this.pending = null;
    if (!def.compiled) { const t = document.createElement('template'); t.innerHTML = def.markup; def.compiled = compileNodes(t.content.childNodes); }
    if (def.css && !document.querySelector('style[data-board="' + name + '"]')) { const st = document.createElement('style'); st.dataset.board = name; st.textContent = def.css; document.head.appendChild(st); }
    this.el = document.createElement('div'); this.el.className = 'sc-host'; this.el.dataset.scName = name;
    this.logic = new def.Logic(this.props()); this.logic.__host = this; this.logic.__name = name;
    this.root = { kids: [] };
  }

  props() { const P = Object.assign({}, this.rawProps), D = this.def.props || {}; for (const k in D) if (P[k] === undefined && D[k] !== undefined) P[k] = D[k]; return P; }

  /** 처음 그리고 붙인다 — 붙인 뒤 componentDidMount(안쪽 보드부터) */
  mount(parent) {
    const mounts = [];
    this.renderNow(mounts);
    parent.appendChild(this.el);
    for (const h of mounts) h.didMount();
    this.didMount();
    return this;
  }
  didMount() { if (this.mounted) return; this.mounted = true; if (this.logic.componentDidMount) { try { this.logic.componentDidMount(); } catch (e) { console.error(this.name + '.componentDidMount', e); } } }

  update(props) {
    const old = this.rawProps; let same = true;
    for (const k in props) if (props[k] !== old[k]) { same = false; break; }
    if (same) for (const k in old) if (!(k in props)) { same = false; break; }
    this.rawProps = props;
    if (!same) { const mounts = []; this.renderNow(mounts); for (const h of mounts) h.didMount(); }
  }

  schedule(cb) {
    if (!this.alive) return;
    if (!this.pending) { this.pending = []; queueMicrotask(() => { const q = this.pending; this.pending = null; if (!this.alive) return; const mounts = []; this.renderNow(mounts); for (const h of mounts) h.didMount(); for (const f of q) f(); }); }
    if (cb) this.pending.push(cb);
  }

  renderNow(mounts) {
    const L = this.logic; L.props = this.props();
    let vals = {};
    try { vals = L.renderVals() || {}; } catch (e) { console.error(this.name + '.renderVals', e); }
    const scope = Object.assign({}, L.props, vals);
    this.patch(this.root, this.def.compiled, scope, this.el, null, mounts);
  }

  // 인스턴스 트리 — 노드마다 { kind, el | text | kids | inst | host }
  patch(inst, defs, scope, parent, before, mounts) {
    if (!inst.items) { inst.items = defs.map((d) => this.create(d, scope, parent, before, mounts)); return; }
    for (let i = 0; i < defs.length; i++) this.upd(inst.items[i], defs[i], scope, mounts);
  }

  create(d, scope, parent, before, mounts) {
    const ins = (n) => parent.insertBefore(n, before);
    if (d.kind === 'static') { const n = d.node.cloneNode(true); ins(n); return { node: n }; }
    if (d.kind === 'text') { const n = document.createTextNode(''); ins(n); const it = { node: n }; this.upd(it, d, scope, mounts); return it; }
    if (d.kind === 'el') {
      const el = d.ns && d.ns !== 'http://www.w3.org/1999/xhtml' ? document.createElementNS(d.ns, d.tag) : document.createElement(d.tag);
      for (const [k, v] of d.stat) { try { el.setAttribute(k, v); } catch (e) { /* 잘못된 속성 이름 */ } }
      if (d.events.length) { el.__h = {}; for (const [ev] of d.events) el.addEventListener(ev, (e) => { const f = el.__h[ev]; if (typeof f === 'function') f(e); }); }
      const it = { node: el, kids: { } };
      ins(el);
      this.upd(it, d, scope, mounts, true);
      it.kids.items = d.kids.map((k) => this.create(k, scope, el, null, mounts));
      return it;
    }
    if (d.kind === 'if' || d.kind === 'for') { const mark = document.createComment(d.kind); ins(mark); const it = { node: mark, parent, list: [] }; this.upd(it, d, scope, mounts); return it; }
    if (d.kind === 'import') {
      const p = {}; for (const [k, parts] of d.props) p[k] = evalParts(parts, scope);
      let host = null;
      try { host = new BoardHost(d.name, p); host.parent = this; host.renderNow(mounts); ins(host.el); mounts.push(host); }
      catch (e) { console.error('dc-import ' + d.name, e); const n = document.createComment('dc-import ' + d.name + ' 실패'); ins(n); return { node: n }; }
      return { node: host.el, host };
    }
    return { node: null };
  }

  upd(it, d, scope, mounts, first) {
    if (d.kind === 'static') return;
    if (d.kind === 'text') { const v = evalParts(d.parts, scope), s = v == null || v === false ? '' : String(v); if (it.node.nodeValue !== s) it.node.nodeValue = s; return; }
    if (d.kind === 'el') {
      const el = it.node;
      for (const [k, parts] of d.attrs) setAttr(el, k, evalParts(parts, scope));
      for (const [ev, parts] of d.events) el.__h[ev] = evalParts(parts, scope);
      if (!first) for (let i = 0; i < d.kids.length; i++) this.upd(it.kids.items[i], d.kids[i], scope, mounts);
      return;
    }
    if (d.kind === 'if') {
      const on = !!evalParts(d.parts, scope);
      if (on && !it.on) { it.on = { items: d.kids.map((k) => this.create(k, scope, it.parent, it.node, mounts)) }; }
      else if (on) { for (let i = 0; i < d.kids.length; i++) this.upd(it.on.items[i], d.kids[i], scope, mounts); }
      else if (it.on) { for (const c of it.on.items) this.destroy(c); it.on = null; }
      return;
    }
    if (d.kind === 'for') {
      const raw = getPath(scope, d.list), list = Array.isArray(raw) ? raw : raw ? Array.from(raw) : [];
      // 이미 있는 자리 — 값만 바꾼다
      for (let i = 0; i < Math.min(list.length, it.list.length); i++) { const sc = Object.create(scope); sc[d.as] = list[i]; it.list[i].scope = sc; for (let j = 0; j < d.kids.length; j++) this.upd(it.list[i].items[j], d.kids[j], sc, mounts); }
      // 늘어난 자리 — 끝 표시(comment) 앞에 차례로
      for (let i = it.list.length; i < list.length; i++) { const sc = Object.create(scope); sc[d.as] = list[i]; it.list.push({ scope: sc, items: d.kids.map((k) => this.create(k, sc, it.parent, it.node, mounts)) }); }
      // 줄어든 자리
      while (it.list.length > list.length) { const g = it.list.pop(); for (const c of g.items) this.destroy(c); }
      return;
    }
    if (d.kind === 'import' && it.host) { const p = {}; for (const [k, parts] of d.props) p[k] = evalParts(parts, scope); it.host.update(p); }
  }

  destroy(it) {
    if (!it) return;
    if (it.host) { it.host.unmount(); return; }
    if (it.kids && it.kids.items) for (const c of it.kids.items) this.destroyInner(c);
    if (it.on) { for (const c of it.on.items) this.destroy(c); it.on = null; }
    if (it.list) { for (const g of it.list) for (const c of g.items) this.destroy(c); it.list = []; }
    if (it.node && it.node.parentNode) it.node.parentNode.removeChild(it.node);
  }
  // 떼어 낼 요소 안쪽 — DOM 은 바깥과 같이 떨어지니 보드의 수명만 끝낸다
  destroyInner(it) {
    if (!it) return;
    if (it.host) { it.host.unmount(); return; }
    if (it.kids && it.kids.items) for (const c of it.kids.items) this.destroyInner(c);
    if (it.on) for (const c of it.on.items) this.destroyInner(c);
    if (it.list) for (const g of it.list) for (const c of g.items) this.destroyInner(c);
  }

  unmount() {
    if (!this.alive) return;
    this.alive = false;
    for (const c of this.root.items || []) this.destroyInner(c);
    if (this.logic.componentWillUnmount) { try { this.logic.componentWillUnmount(); } catch (e) { console.error(this.name + '.componentWillUnmount', e); } }
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}

/** 보드 하나를 요소 안에 띄운다 */
export function mountBoard(name, parent, props) { return new BoardHost(name, props).mount(parent); }
