// 창 층 — 장면(캔버스) 위에 뜨는 DOM 창들(설정 · 상태 · 자원 · 자원 상태 · 제어기).
//
// 시안(Field.dc.html 의 ctlOpenWin · WSLOT · WSIZE)과 같은 규칙:
//   · 종류마다 동시에 열 수 있는 수가 정해져 있다(slots). 다 차면 가장 뒤에 있던 그 종류의 창을 최소화하고 자리를 쓴다
//   · 같은 (종류, 대상)은 창 하나 — 다시 열면 앞으로(와 onReopen)
//   · 새 창은 계단식(28 · 24px)으로 비켜 놓는다
// 창 내용은 mount(body, ctx) 가 만든다. mount 가 돌려준 함수(또는 scope 끄개)는 창이 닫힐 때 부른다 — 효과가 남지 않는다.
// 이 층은 장면과 따로 그려진다: 창을 끌어도 장면 프레임은 다시 계산되지 않는다.

import { scope, signal } from './signals.js';

export const KINDS = {
  ctl:   { title: '제어기',     slots: 6, size: [1240, 760], see: false },
  star:  { title: '스타메이커', slots: 1, size: [1100, 720], see: false },
  conf:  { title: '설정',       slots: 1, size: [860, 600],  see: false },
  stat:  { title: '상태',       slots: 3, size: [560, 540],  see: true },
  share: { title: '자원',       slots: 1, size: [860, 600],  see: false },
  res:   { title: '자원 상태',  slots: 3, size: [600, 600],  see: true }
};

/** 순수 규칙 — 어느 창을 쓰고 어느 창을 밀어낼지. 시험할 수 있게 DOM 과 떼어 둔다 */
export function placeWindow(wins, kind, key, cap) {
  const same = wins.find((w) => w.kind === kind && w.key === key);
  if (same) return { reuse: same };
  const open = wins.filter((w) => w.kind === kind && !w.min);
  if (open.length < cap) return { evict: null };
  return { evict: open.reduce((a, b) => (a.z <= b.z ? a : b)) };
}

export class WindowLayer {
  /** @param {HTMLElement} root 장면 위 층 (position: relative 의 부모 안) */
  constructor(root, o = {}) {
    this.root = root; this.kinds = Object.assign({}, KINDS, o.kinds || {});
    this.wins = []; this.z = 10; this.n = 0;
    this.list = signal([]);   // 전역 틀의 '창' 목록이 읽는다
  }

  /**
   * @param {string} kind @param {string} key 대상(노드 id 등) @param {{ title: string, mount: (body: HTMLElement, ctx: object) => (void|(() => void)), onReopen?: (w) => void }} o
   */
  open(kind, key, o) {
    const K = this.kinds[kind]; if (!K) throw new Error('모르는 창 종류: ' + kind);
    const p = placeWindow(this.wins, kind, key, K.slots);
    if (p.reuse) { if (p.reuse.min) this.restore(p.reuse); this.front(p.reuse); if (o.onReopen) o.onReopen(p.reuse); return p.reuse; }
    if (p.evict) this.minimize(p.evict);
    const [bw, bh] = K.size, vw = this.root.clientWidth || 1440, vh = this.root.clientHeight || 900, k = this.wins.filter((w) => !w.min).length;
    const sc = Math.min(1, vw * 0.8 / bw, vh * 0.84 / bh), w = Math.round(bw * sc), h = Math.round(bh * sc);
    const W = { id: 'w' + (++this.n), kind, key, title: o.title, x: Math.round((vw - w) / 2 + k * 28), y: Math.round((vh - h) / 2 + k * 24), w, h, z: ++this.z, min: false };
    W.el = this.frame(W, K);
    this.root.appendChild(W.el);
    const ret = scope(() => o.mount(W.body, { win: W, close: () => this.close(W) }));
    W.dispose = () => { ret[1](); if (typeof ret[0] === 'function') ret[0](); };
    this.wins.push(W); this.sync();
    return W;
  }

  frame(W, K) {
    const el = document.createElement('section');
    el.className = 'tw' + (K.see ? ' tw-see' : '');
    el.setAttribute('aria-label', W.title);
    const head = document.createElement('div'); head.className = 'tw-head';
    head.innerHTML = '<span class="tw-p">&gt;_</span><b></b><span class="tw-k"></span><span class="tw-fill"></span><button type="button" class="tw-b" aria-label="최소화">_</button><button type="button" class="tw-b" aria-label="닫기">×</button>';
    head.querySelector('b').textContent = W.title; head.querySelector('.tw-k').textContent = K.title;
    const [bMin, bClose] = head.querySelectorAll('button');
    bMin.onclick = () => this.minimize(W); bClose.onclick = () => this.close(W);
    const body = document.createElement('div'); body.className = 'tw-body';
    el.append(head, body); W.body = body;
    el.addEventListener('pointerdown', () => this.front(W));
    // 끌기 — 머리줄. 위치는 transform 으로만(배치 다시 계산 없음)
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      head.setPointerCapture(e.pointerId);
      const sx = e.clientX - W.x, sy = e.clientY - W.y;
      const mv = (ev) => { W.x = ev.clientX - sx; W.y = Math.max(0, ev.clientY - sy); this.place(W); };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
    });
    this.place(W, el);
    return el;
  }

  place(W, el = W.el) {
    el.style.transform = `translate(${W.x}px, ${W.y}px)`;
    el.style.width = W.w + 'px'; el.style.height = W.h + 'px'; el.style.zIndex = W.z;
    el.style.display = W.min ? 'none' : '';
  }

  front(W) { if (W.z === this.z) return; W.z = ++this.z; this.place(W); this.sync(); }
  minimize(W) { W.min = true; this.place(W); this.sync(); }
  restore(W) { W.min = false; this.place(W); this.sync(); }
  close(W) { W.dispose && W.dispose(); W.el.remove(); this.wins = this.wins.filter((x) => x !== W); this.sync(); }
  sync() { this.list.set(this.wins.map((w) => ({ id: w.id, kind: w.kind, key: w.key, title: w.title, min: w.min, z: w.z }))); }
}
