// 작은 반응형 — 값(signal) · 계산(computed) · 효과(effect).
//
// 시안의 창 컴포넌트는 상태가 하나만 바뀌어도 renderVals() 가 창 전체의 값을 다시 만들고, 템플릿이 그것을 통째로 다시 맞췄다.
// 실제 웹 빌드의 창 층은 바뀐 값에 묶인 DOM 자리만 고친다 — 1초마다 흐르는 값(자원 상태 창의 그래프)이 창 나머지를 건드리지 않는다.
// 바깥 라이브러리 없이 두는 이유: 앱 origin 의 CSP 가 script-src 'self' 라 번들에 들어가면 그만이지만, 쓰는 것이 이 정도라 직접 둔다.
// 더 커지면 같은 모양의 Solid · Preact signals 로 바꿀 수 있다(signal() · computed() · effect() 이름을 그대로 맞춘다).

let current = null;          // 지금 돌고 있는 효과 — 값을 읽으면 여기에 걸린다
let batchDepth = 0;
let owner = null;          // scope() 가 모으는 효과 끄개 목록
const pending = new Set();

const run = (e) => {
  if (e.disposed) return;
  for (const s of e.deps) s.subs.delete(e);
  e.deps.clear();
  const prev = current; current = e;
  try { if (e.cleanup) e.cleanup(); const r = e.fn(); e.cleanup = typeof r === 'function' ? r : null; } finally { current = prev; }
};

const notify = (subs) => {
  for (const e of [...subs]) { if (batchDepth) pending.add(e); else run(e); }
};

/** @template T @param {T} value @returns {{ (): T, set(v: T): void, update(f: (v: T) => T): void, peek(): T }} */
export function signal(value, equals = Object.is) {
  const subs = new Set();
  const read = () => { if (current) { subs.add(current); current.deps.add(s); } return value; };
  const s = { subs };
  read.set = (v) => { if (equals(value, v)) return; value = v; notify(subs); };
  read.update = (f) => read.set(f(value));
  read.peek = () => value;
  return read;
}

/** 다른 값에서 계산되는 값 — 읽힐 때만 다시 계산하지 않고, 기대는 값이 바뀌면 다시 계산해 둔다 */
export function computed(fn) {
  const out = signal(undefined);
  effect(() => { out.set(fn()); });
  const read = () => out();
  read.peek = out.peek;
  return read;
}

/** fn 이 읽은 값이 바뀔 때마다 다시 돈다. fn 이 함수를 돌려주면 다음 실행 전 · 정리 때 부른다. 돌려준 함수로 끈다 */
export function effect(fn) {
  const e = { fn, deps: new Set(), cleanup: null, disposed: false };
  run(e);
  const dispose = () => { e.disposed = true; for (const s of e.deps) s.subs.delete(e); e.deps.clear(); if (e.cleanup) e.cleanup(); };
  if (owner) owner.push(dispose);
  return dispose;
}

/** fn 안에서 만든 효과를 한꺼번에 끈다 — 창을 닫거나 목록 줄이 빠질 때. [fn 의 결과, 끄개] */
export function scope(fn) {
  const list = [], prev = owner; owner = list;
  try { return [fn(), () => { for (const d of list.splice(0)) d(); }]; } finally { owner = prev; }
}

/** 여러 값을 한꺼번에 바꾼다 — 효과는 끝에서 한 번만 */
export function batch(fn) {
  batchDepth++;
  try { fn(); } finally {
    batchDepth--;
    if (!batchDepth) { const list = [...pending]; pending.clear(); for (const e of list) run(e); }
  }
}

/** 효과 밖에서 읽기(구독하지 않는다) */
export function untrack(fn) { const prev = current; current = null; try { return fn(); } finally { current = prev; } }
