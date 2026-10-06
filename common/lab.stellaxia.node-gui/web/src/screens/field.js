// 필드 편집기 — 디자인 캔버스 원본 design/FieldEditor.dc.html 에서 옮긴 화면 로직 (module 변형 · tools/gen-pages.py로 다시 만든다)
// 데이터를 바꿔 끼우는 곳은 src/boot/module.js · src/data/*.js — 이 파일은 손으로 고치지 않는다
import { DCLogic } from '../runtime/dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    const skins = this.fieldSkins();
    this.state = {
      skins,
      curId: skins[0].id,
      name: skins[0].name,
      data: this._loadedRef = this.copySkin(skins[0]),
      // 애니메이션: 프레임 = 윗면 · 띠 · 옆면 · 확장면 · 테두리 픽셀 한 벌 (부모 디자인 · 높이 · 패턴은 모든 프레임이 같이 쓴다). 주기 1초 고정
      frames: this.slotsOf(skins[0]), fi: 0, anim: this.keyCount(skins[0].frames) > 1, step: 2,
      playing: false, pf: 0, pt: 0, pg: -1, confirmBasic: false,
      color: '#58b066',
      tool: 'pen',
      rimKind: 'leaf',
      sideKind: 'side',
      bandKind: 'band',
      parentDef: this.parentDefault(),   // 부모 필드 기본 디자인 (전용 디자인이 없는 모든 필드가 따른다)
      recent: [],
      saved: true,
      yaw: 25,
      pitch: 35,
      role3d: 'leaf',
      active: 'top',
      sel: null,
      clip: null,
      pasting: false,
      adj: null,
      hist: []
    };
  }
  // ───── 애니메이션 확장 (자재 · 건물 · 필드 편집기가 같은 모양) ─────
  // 모든 애니메이션은 1초 = 16칸 고정 (프레임을 서로 맞추려고). frames = 칸 배열(16 × 초), null = 빈 칸 → 앞 프레임을 그대로 보인다
  // 빠르게 = 16칸을 다 채움 · 느리게 = 4칸에 하나만. 자재는 1초(16칸) 고정 · 필드 · 건물은 4초(64칸)까지. 칸 0에는 늘 프레임이 있다
  heldIdx(fr, i) { let k = Math.max(0, Math.min(fr.length - 1, i)); while (k > 0 && !fr[k]) k--; return k; }
  animKeys(fr) { return fr.filter(Boolean).length; }
  // 지금 칸을 목록에 되돌려 넣은 목록. 빈 칸을 골라 아무것도 안 그렸으면 빈 칸 그대로 (그리면 그 칸에 새 프레임이 생긴다)
  framesNow() {
    const fr = this.state.frames.slice(), i = this.state.fi;
    if (fr[i] || this.curRef() !== this._loadedRef) fr[i] = this.frameCur();
    return fr;
  }
  slotFilled(i) { return i === this.state.fi ? !!this.state.frames[i] || this.curRef() !== this._loadedRef : !!this.state.frames[i]; }
  animGo(i, fr0) {
    const fr = fr0 || this.framesNow();
    if (i < 0 || i >= fr.length) return;
    this.setState(Object.assign({ frames: fr, fi: i }, this.frameLoad(fr[this.heldIdx(fr, i)])));
  }
  animPlay(on) {
    clearInterval(this._playT);
    if (!on) { this.setState({ playing: false }); return; }
    const t0 = Date.now();
    this.setState({ playing: true, pf: 0, pt: 0, frames: this.framesNow() });
    // 틱 = 1/16초. 재생 칸 pt · 보이는 프레임 pf(빈 칸이면 앞 프레임)
    this._playT = setInterval(() => {
      const fr = this.state.frames, g = Math.floor((Date.now() - t0) / 62.5), t = g % fr.length, pf = this.heldIdx(fr, t);
      if (g !== this.state.pg) this.setState({ pf, pt: t, pg: g });
    }, 31);
  }
  animVals(opts) {
    const S = this.state, fr = S.frames, len = fr.length, anim = S.anim, maxLen = opts.maxLen || 1, step = S.step || 2;
    const keys = fr.map((f, i) => this.slotFilled(i)), nKeys = keys.filter(Boolean).length;
    const tab = (label, on, pick, tip) => ({ label, tip: tip || '', on: on ? 'true' : 'false', bg: on ? '#ede9e1' : 'transparent', fg: on ? '#111111' : '#9aa1ab', fw: on ? 600 : 400, sh: on ? '0 1px 2px rgba(0,0,0,0.35)' : 'none', pick });
    const edit = (fn) => () => { if (S.playing) this.animPlay(false); fn(); };
    const filledHere = keys[S.fi], held = this.heldIdx(fr, S.fi);
    const move = (d) => edit(() => {
      const f = this.framesNow(), j = S.fi + d;
      if (!f[S.fi] || j < 0 || j >= len) return;
      const t = f[S.fi]; f[S.fi] = f[j]; f[j] = t;
      if (!f[0]) return;                                   // 칸 0은 비울 수 없다
      this.animGo(j, f); this.setState({ saved: false });
    });
    const cur = S.playing ? S.pt : S.fi;
    const slots = fr.map((f, i) => {
      const has = keys[i], on = i === S.fi, head = S.playing && i === S.pt;
      const img = has && opts.thumb ? opts.thumb(i === S.fi ? this.frameCur() : f) : '';
      const hk = this.heldIdx(fr, i);
      return {
        num: has ? String(i + 1) : '', label: '칸 ' + (i + 1) + ' · ' + (Math.floor(i / 16) + 1) + '초' + (has ? ' — 프레임' : ' — 빈 칸 (칸 ' + (hk + 1) + '의 프레임이 이어짐)'),
        sel: on ? 'true' : 'false', img, imgDisp: img ? 'block' : 'none', holdDisp: has ? 'none' : 'block',
        border: on ? '2px solid #ffd84d' : has ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.07)',
        bg: has ? (img ? '#1a1e25' : 'rgba(122,167,255,0.16)') : (i % 4 === 0 ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.025)'),
        ring: head ? '0 0 0 2px #3ecf8e' : 'none', numFg: on ? '#ffd84d' : '#9aa1ab',
        pick: edit(() => this.animGo(i))
      };
    });
    const lens = [];
    for (let L = 1; L <= maxLen; L++) { const over = keys.slice(16 * L).some(Boolean); lens.push({ v: String(L), t: L + '초 · ' + 16 * L + '칸' + (over ? ' (뒤 칸에 프레임이 있어 못 줄임)' : '') }); }
    return {
      disp: anim ? 'flex' : 'none', slotH: len > 32 ? (opts.slotHS || 22) : len > 16 ? (opts.slotHM || 30) : (opts.slotH || 44),
      types: [
        tab(opts.basicLabel, !anim, () => { if (!anim) return; if (nKeys > 1 || len > 16) this.setState({ confirmBasic: true }); else this.setState({ anim: false }); }),
        tab(opts.animLabel, anim, () => this.setState({ anim: true, confirmBasic: false }))
      ], typeLabel: opts.typeLabel,
      cur: String(cur + 1), len: String(len),
      slotInfo: '프레임 ' + nKeys + '개 · ' + (filledHere ? '이 칸은 프레임' : '빈 칸 — 칸 ' + (held + 1) + '의 프레임이 보임 · 그리면 이 칸에 새 프레임'),
      slotFg: filledHere ? '#9aa1ab' : '#7aa7ff',
      lenDisp: maxLen > 1 ? 'flex' : 'none', lenFixDisp: maxLen > 1 ? 'none' : 'inline', lenVal: String(len / 16), lens,
      setLen: (e) => {
        if (S.playing) this.animPlay(false);
        const L = Number(e.target.value), n = 16 * L, f = this.framesNow();
        if (f.slice(n).some(Boolean)) return;
        const nf = n > f.length ? f.concat(new Array(n - f.length).fill(null)) : f.slice(0, n);
        const fi = Math.min(S.fi, n - 1);
        this.setState(Object.assign({ frames: nf, fi, saved: false }, this.frameLoad(nf[this.heldIdx(nf, fi)])));
      },
      steps: [[1, '1칸', '16칸을 다 채우는 빠른 움직임'], [2, '2칸', '초당 8프레임'], [4, '4칸', '초당 4프레임']].map(([v, l, tip]) => tab(l, step === v, () => this.setState({ step: v }), tip)),
      stepLabel: step + '칸',
      dupTip: '지금 보이는 프레임을 ' + step + '칸 뒤에 복제하고 그 칸으로 (그 칸에 이미 프레임이 있으면 옮겨 가기만)',
      dup: edit(() => {
        const f = this.framesNow(), j = S.fi + step;
        if (j >= len) return;
        if (!f[j]) f[j] = opts.copy(f[this.heldIdx(f, S.fi)]);
        this.animGo(j, f); this.setState({ saved: false });
      }),
      dupFg: S.fi + step < len ? '#ede9e1' : '#4b515b',
      fillLabel: filledHere ? '빈 칸으로' : '이 칸에 프레임 넣기',
      fillTip: filledHere ? (S.fi === 0 ? '칸 0은 비울 수 없습니다' : '이 칸의 프레임을 지워 앞 프레임이 이어지게') : '앞 프레임을 복사해 이 칸에 넣기',
      fill: edit(() => {
        const f = this.framesNow();
        if (filledHere) { if (S.fi === 0) return; f[S.fi] = null; }
        else f[S.fi] = opts.copy(f[this.heldIdx(f, S.fi)]);
        this.animGo(S.fi, f); this.setState({ saved: false });
      }),
      left: move(-1), right: move(1),
      leftFg: filledHere && S.fi > 0 ? '#ede9e1' : '#4b515b', rightFg: filledHere && S.fi < len - 1 && (S.fi > 0 || keys[1]) ? '#ede9e1' : '#4b515b',
      toggle: () => { if (nKeys < 2) return; this.animPlay(!S.playing); },
      playIcon: S.playing ? '❚❚' : '▶', playLabel: nKeys < 2 ? '프레임이 2개 이상이면 재생' : S.playing ? '멈춤' : '재생',
      playLine: S.playing ? 'rgba(62,207,142,0.55)' : 'rgba(255,255,255,0.18)', playBg: S.playing ? 'rgba(62,207,142,0.14)' : 'rgba(255,255,255,0.04)', playFg: nKeys < 2 ? '#4b515b' : S.playing ? '#3ecf8e' : '#ede9e1',
      slots,
      confirmDisp: S.confirmBasic ? 'flex' : 'none', dropN: String(Math.max(0, nKeys - 1)),
      confirmYes: () => {
        if (S.playing) this.animPlay(false);
        const f = this.framesNow(), keep = f[this.heldIdx(f, S.fi)], nf = [keep].concat(new Array(15).fill(null));
        this.setState(Object.assign({ frames: nf, fi: 0, anim: false, confirmBasic: false, saved: false }, this.frameLoad(keep)));
      },
      confirmNo: () => this.setState({ confirmBasic: false })
    };
  }
  copyFrame(f) { const o = { top: f.top.slice(), band: f.band.slice(), side: f.side.slice(), fill: f.fill.slice(), rim: { leaf: f.rim.leaf.slice(), tree: f.rim.tree.slice(), both: f.rim.both.slice() } }; if (f.hexTop) o.hexTop = f.hexTop.slice(); return o; }
  frameCur() { return this.copyFrame(this.state.data); }
  curRef() { return this.state.data; }
  frameLoad(f) { const data = Object.assign({}, this.state.data, this.copyFrame(f)); this._loadedRef = data; return { data, hist: [], sel: null, adj: null, pasting: false }; }
  keyCount(fr) { return fr ? fr.filter(Boolean).length : 1; }
  slotsOf(sk) { return sk.frames && sk.frames.length ? sk.frames.map((f) => f ? this.copyFrame(f) : null) : [this.copyFrame(sk)].concat(new Array(15).fill(null)); }
  componentWillUnmount() { clearInterval(this._playT); }
  // 프레임 칸 그림: 윗면(마름모) + 띠 · 옆면 두 쪽
  thumb(f) {
    if (typeof document === 'undefined') return '';
    // 육각 통째면 윗면 한 장의 가운데 16×16을 칸 그림으로
    const hx = f.hexTop && this.state && this.state.data && this.state.data.pattern && this.state.data.pattern.type === 'hex';
    const top = hx ? (() => { const G = this.hexGrid(), o = [], x0 = (G.HW - 16) / 2, y0 = (G.HH - 16) / 2; for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) o.push(f.hexTop[(y0 + j) * G.HW + x0 + i]); return o; })() : f.top;
    const key = top.join('') + f.band.join('') + f.side.slice(0, 64).join('');
    this._thumbs = this._thumbs || new Map();
    if (this._thumbs.has(key)) return this._thumbs.get(key);
    const cv = document.createElement('canvas'); cv.width = cv.height = 48;
    const g = cv.getContext('2d'), U = 22 / 16, V = 11 / 16;
    const face = (px, w, h, m, k) => { g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); px.forEach((c, i) => { if (Math.floor(i / w) < h) { g.fillStyle = this.scaleC(c, k); g.fillRect(i % w, Math.floor(i / w), 1.05, 1.05); } }); };
    const sideCol = f.band.concat(f.side.slice(0, 16 * 14));
    face(top, 16, 16, [U, V, -U, V, 24, 2], 1);
    face(sideCol, 16, 16, [U, V, 0, 22 / 16 * 0.9, 2, 13], 0.85);
    face(sideCol, 16, 16, [U, -V, 0, 22 / 16 * 0.9, 24, 24], 0.68);
    const url = cv.toDataURL('image/png');
    this._thumbs.set(key, url);
    return url;
  }
  copySkin(s) {
    return {
      top: s.top.slice(), band: s.band.slice(), side: s.side.slice(), fill: s.fill.slice(),
      rim: { leaf: s.rim.leaf.slice(), tree: s.rim.tree.slice(), both: s.rim.both.slice() },
      lift: s.lift || 0, pattern: Object.assign({}, s.pattern),
      parent: this.copyParent(s.parent),
      ...(s.hexTop ? { hexTop: s.hexTop.slice() } : {})
    };
  }
  getArr(data, key) {
    if (key.indexOf('parent.') === 0) return this.parentOf(data)[key.slice(7)];
    return key.indexOf('rim.') === 0 ? data.rim[key.slice(4)] : data[key];
  }
  withArr(data, key, arr) {
    // 부모 디자인을 고치면: 기본을 따르던 필드는 그 자리에서 기본을 복사해 이 필드 전용이 된다
    if (key.indexOf('parent.') === 0) return Object.assign({}, data, { parent: Object.assign(this.copyParent(this.parentOf(data)), { [key.slice(7)]: arr }) });
    if (key.indexOf('rim.') === 0) return Object.assign({}, data, { rim: Object.assign({}, data.rim, { [key.slice(4)]: arr }) });
    return Object.assign({}, data, { [key]: arr });
  }
  rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  hexRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  rgbHex(c) { return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  tone(h, d) { return this.rgbHex(this.hexRgb(h).map((v) => v + d)); }
  scaleC(h, f) { return this.rgbHex(this.hexRgb(h).map((v) => v * f)); }
  avgC(arr) {
    const s = [0, 0, 0];
    arr.forEach((h) => this.hexRgb(h).forEach((v, i) => { s[i] += v; }));
    return this.rgbHex(s.map((v) => v / arr.length));
  }
  toHsl(hex) {
    const [r, g, b] = this.hexRgb(hex).map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  fromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return this.rgbHex([r + m, g + m, b + m].map((v) => v * 255));
  }
  shiftHsl(hex, dh, ds, dl) {
    let [h, s, l] = this.toHsl(hex);
    h = ((h + dh) % 360 + 360) % 360;
    s = Math.max(0, Math.min(1, ds >= 0 ? s + (1 - s) * ds / 100 : s * (1 + ds / 100)));
    l = Math.max(0, Math.min(1, l + dl / 100));
    return this.fromHsl(h, s, l);
  }

  // 부모 필드 기본 디자인 — 모든 필드 스킨이 따로 정하지 않으면 이것을 쓴다 (필드 편집기와 같은 값)
  parentDefault() {
    const gen = (w, h, seed, fn) => { const r = this.rng(seed), out = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(fn(i, j, r)); return out; };
    return {
      lift: 58,
      // 전용 띠: 보라 바탕에 밝은 마름모 점 — 옆면 맨 위를 한 바퀴 두른다
      band: gen(16, 2, 910, (i, j) => j === 0 ? (i % 4 === 1 ? '#ede9fe' : i % 4 === 3 ? '#a78bfa' : '#7c3aed') : (i % 4 === 1 ? '#a78bfa' : '#5b21b6')),
      // 전용 테두리: 밝은 보라 · 보라를 번갈아, 안쪽 줄은 짙은 보라
      rim: gen(16, 2, 911, (i, j) => j === 0 ? (i % 4 === 0 ? '#ddd6fe' : '#8b5cf6') : (i % 8 === 4 ? '#c4b5fd' : '#6d28d9'))
    };
  }
  // 스킨의 부모 디자인: 스킨 전용이 있으면 그것, 없으면 지금의 기본 디자인
  parentOf(sk) { return sk.parent || (this.state && this.state.parentDef) || this.parentDefault(); }
  copyParent(pd) { return pd ? { lift: pd.lift, band: pd.band.slice(), rim: pd.rim.slice() } : null; }
  // ───── 필드 타일 (노드 화면 · 필드 편집기가 같은 코드) ─────
  // 스킨 = 픽셀 데이터: 윗면 16×16 · 띠 16×2 · 옆면 16×16 · 확장 옆면 16×16 · 노드 테두리 16×2 × (Leaf · Tree · Tree·Leaf)
  // 필드 프레임: 칸 배열(1초 = 16칸, 4초 = 64칸까지). 프레임 = 윗면 · 띠 · 옆면 · 확장면 · 테두리, 빈 칸(null) = 앞 프레임 유지
  normFrames(sk) {
    const src = sk.frames && sk.frames.length ? sk.frames : [{}].concat(new Array(15).fill(null));
    const fr = src.map((f) => !f ? null : ({
      top: f.top || sk.top, band: f.band || sk.band, side: f.side || sk.side,
      fill: f.fill || (f.side ? f.side.map((c) => this.scaleC(c, 0.72)) : sk.fill),
      rim: f.rim || sk.rim
    }));
    return Object.assign(sk, { frames: fr, top: fr[0].top, band: fr[0].band, side: fr[0].side, fill: fr[0].fill, rim: fr[0].rim });
  }
  fieldSkins() {
    const gen = (w, h, seed, fn) => { const r = this.rng(seed), out = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(fn(i, j, r)); return out; };
    return [
      { id: 'grass', name: '잔디',
        top: gen(16, 16, 101, (i, j, r) => r() < 0.1 ? this.tone('#86d690', (r() - 0.5) * 16) : this.tone('#58b066', (r() - 0.5) * 20)),
        band: gen(16, 2, 102, (i, j, r) => this.tone(j === 0 ? '#4c9d5a' : '#3f8a4e', (r() - 0.5) * 10)),
        side: gen(16, 16, 103, (i, j, r) => (j < 3 && r() < 0.5 - j * 0.15) ? this.tone('#3f8a4e', (r() - 0.5) * 10) : this.tone('#2f6b42', (r() - 0.5) * 14)) },
      { id: 'soil', name: '흙',
        top: gen(16, 16, 201, (i, j, r) => { const q = r(); return q < 0.06 ? '#d2a174' : q < 0.13 ? '#6e4424' : this.tone('#a8744a', (r() - 0.5) * 18); }),
        band: gen(16, 2, 202, (i, j, r) => this.tone(j === 0 ? '#b98559' : '#9e6b41', (r() - 0.5) * 10)),
        side: gen(16, 16, 203, (i, j, r) => r() < 0.04 ? '#8e6a4a' : this.tone(j === 5 || j === 11 ? '#5a391f' : '#6f4729', (r() - 0.5) * 14)) },
      { id: 'concrete', name: '콘크리트',
        top: gen(16, 16, 301, (i, j, r) => (i === 0 || j === 0) ? '#9fa29f' : r() < 0.07 ? '#8e918e' : this.tone('#b8bbb7', (r() - 0.5) * 10)),
        band: gen(16, 2, 302, (i, j, r) => this.tone(j === 0 ? '#cdd0cc' : '#aeb1ad', (r() - 0.5) * 6)),
        side: gen(16, 16, 303, (i, j, r) => this.tone(j === 7 ? '#6a6d6b' : '#838684', (r() - 0.5) * 10)) },
      { id: 'metal', name: '금속 판',
        top: gen(16, 16, 401, (i, j, r) => (i + j) % 8 === 0 ? '#b3c0cc' : (i + j) % 8 === 1 ? '#6b7885' : ((i % 8 === 2 || i % 8 === 6) && (j % 8 === 2 || j % 8 === 6)) ? '#5d6875' : this.tone('#8795a3', (r() - 0.5) * 6)),
        band: gen(16, 2, 402, (i, j, r) => this.tone(j === 0 ? '#b3c0cc' : '#98a5b2', (r() - 0.5) * 4)),
        side: gen(16, 16, 403, (i, j, r) => (i % 8 === 3 && (j === 3 || j === 12)) ? '#39424d' : this.tone('#56616e', (j === 0 ? 12 : 0) + (r() - 0.5) * 6)) },
      // 보도블록: 집 · 가게 앞에 까는 포장 — 엇갈려 쌓은 연한 벽돌 판
      { id: 'paver', name: '보도블록',
        top: gen(16, 16, 501, (i, j, r) => { const row = j >> 2, seam = j % 4 === 3 || (i + (row % 2) * 4) % 8 === 7; return seam ? this.tone('#8f887c', (r() - 0.5) * 6) : this.tone(row % 2 ? '#d9cdb8' : '#cbbfa8', (r() - 0.5) * 12); }),
        band: gen(16, 2, 502, (i, j, r) => this.tone(j === 0 ? '#b9ad97' : '#9d927e', (r() - 0.5) * 6)),
        side: gen(16, 16, 503, (i, j, r) => j < 2 ? this.tone('#8f887c', (r() - 0.5) * 6) : r() < 0.06 ? '#6e5a44' : this.tone('#7d6650', (r() - 0.5) * 14)) },
      // 물 (애니메이션 필드 예시): 윗면 물결 · 띠 물거품 · 옆면 기포가 흐른다 (1초 16칸 · 초당 8프레임)
      ...(() => {
        // 8프레임을 2칸마다 → 초당 8프레임. 무늬는 16픽셀마다 되풀이되므로 한 프레임에 2픽셀씩 흘러 1초에 딱 한 바퀴 (이음매 없음)
        const mix = (a, b, t) => { const A = this.hexRgb(a), B = this.hexRgb(b), u = Math.max(0, Math.min(1, t)); return this.rgbHex(A.map((v, q) => v + (B[q] - v) * u)); };
        const TAU = Math.PI * 2;
        const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({
          // 윗면: 엇갈린 두 물결을 겹쳐 밝고 어두운 결 · 마루에는 반짝임
          top: gen(16, 16, 601, (i, j, r) => {
            const v = Math.sin(TAU * ((i + j) / 16 - k / 8)) + 0.6 * Math.sin(TAU * ((i - 2 * j) / 16 + k / 8)) + (r() - 0.5) * 0.35;
            return v > 1.25 ? '#e2f4ff' : v > 0.95 ? '#9fd0f5' : mix('#236aae', '#4f9ade', (v + 1.6) / 3.2);
          }),
          // 띠: 물가의 거품이 옆으로 흐른다
          band: gen(16, 2, 602, (i, j, r) => j === 0 ? ((i + k * 2) % 8 < 3 ? '#f2fbff' : (i + k * 2) % 8 === 3 ? '#cbe9fb' : mix('#8fc9f0', '#a9d8f5', r())) : mix('#4f97d4', '#5ea6de', r())),
          // 옆면: 아래로 갈수록 깊은 물빛 · 기포가 위로 오른다
          side: gen(16, 16, 603, (i, j, r) => {
            const bub = i % 4 === 1 && ((j + k * 2 + i * 5) % 16 === 0), tail = i % 4 === 1 && ((j + k * 2 + i * 5) % 16 === 1);
            return bub ? '#a9d6f7' : tail ? '#5f9fd6' : mix('#2d6bab', '#16406f', j / 15 + (r() - 0.5) * 0.12);
          })
        }));
        const slots = new Array(16).fill(null); frames.forEach((f, k) => { slots[k * 2] = f; });
        return [{ id: 'water', name: '물', top: frames[0].top, band: frames[0].band, side: frames[0].side, frames: slots }];
      })(),
    ].map((sk) => Object.assign({
      lift: 26,
      fill: sk.side.map((c) => this.scaleC(c, 0.72)),
      // 노드 역할별 테두리: Leaf 파랑 · Tree 호박색 · Tree·Leaf 둘을 번갈아
      rim: {
        leaf: gen(16, 2, 900, (i, j) => j === 0 ? (i % 4 === 0 ? '#9cc0ff' : '#6f9cf0') : '#4f7fd9'),
        tree: gen(16, 2, 901, (i, j) => j === 0 ? (i % 4 === 0 ? '#ffd88a' : '#f0b442') : '#c98a1c'),
        both: gen(16, 2, 902, (i, j) => (Math.floor(i / 2) % 2 === 0) ? (j === 0 ? '#6f9cf0' : '#4f7fd9') : (j === 0 ? '#f0b442' : '#c98a1c'))
      },
      // 부모 디자인: null = 기본 디자인을 따름. 금속 판은 예시로 전용 디자인(청록 띠 · 흰 테두리)을 가진다
      parent: sk.id === 'metal' ? {
        lift: 64,
        band: gen(16, 2, 920, (i, j) => j === 0 ? (i % 2 === 0 ? '#5eead4' : '#0f766e') : '#115e59'),
        rim: gen(16, 2, 921, (i, j) => j === 0 ? (i % 4 === 0 ? '#ffffff' : '#ccfbf1') : '#14b8a6')
      } : null,
      pattern: { type: 'grid', scale: 1 }
    }, sk)).map((sk) => this.normFrames(sk));
  }
  roundedPoints(pts, r, seg) {
    const n = pts.length, out = [];
    const cut = (from, to) => {
      const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy);
      const t = Math.min(r / len, 0.5);
      return [from[0] + dx * t, from[1] + dy * t];
    };
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = cut(p, pts[(i - 1 + n) % n]), b = cut(p, pts[(i + 1) % n]);
      for (let j = 0; j <= seg; j++) {
        const t = j / seg, u = 1 - t;
        out.push([u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]]);
      }
    }
    return out;
  }
  hull(points) {
    const P = points.slice().sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    P.forEach((p) => { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); });
    P.slice().reverse().forEach((p) => { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); });
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  tileModel() {
    if (this._tm) return this._tm;
    const A = 80, B = 36, H = 38, D = 56, R = 12, BH = 6;
    const K = H / (A * Math.sqrt(3) / 2), C = Math.sqrt(1 - K * K);
    const scr = this.roundedPoints([[-B, -H], [B, -H], [A, 0], [B, H], [-B, H], [-A, 0]], R, 8);
    let w = scr.map((p) => [p[0], p[1] / K]).reverse();
    let s0 = 0;
    w.forEach((p, i) => { if (Math.abs(p[0]) < Math.abs(w[s0][0]) + 1e-9 && p[1] < 0) s0 = i; });
    w = w.slice(s0).concat(w.slice(0, s0));
    const cum = [0];
    for (let i = 1; i <= w.length; i++) cum.push(cum[i - 1] + Math.hypot(w[i % w.length][0] - w[i - 1][0], w[i % w.length][1] - w[i - 1][1]));
    const L = cum[w.length];
    const BHw = BH / C, Dw = D / C, P = (Dw - BHw) / 16;
    this._tm = { A, B, H, D, BH, K, C, w, cum, L, BHw, Dw, P };
    return this._tm;
  }
  insetOutline(d) {
    const M = this.tileModel();
    M.insets = M.insets || {};
    if (M.insets[d]) return M.insets[d];
    const w = M.w, n = w.length;
    const nrm = (a, b) => { let x = b[1] - a[1], y = -(b[0] - a[0]); const l = Math.hypot(x, y) || 1; x /= l; y /= l; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; return x * mx + y * my < 0 ? [-x, -y] : [x, y]; };
    M.insets[d] = w.map((p, i) => {
      const n1 = nrm(w[(i - 1 + n) % n], p), n2 = nrm(p, w[(i + 1) % n]);
      let x = n1[0] + n2[0], y = n1[1] + n2[1];
      const l = Math.hypot(x, y) || 1;
      return [p[0] - x / l * d, p[1] - y / l * d];
    });
    return M.insets[d];
  }
  arcPts(u1, u2, wAlt) {
    const { cum } = this.tileModel(), w = wAlt || this.tileModel().w, n = w.length;
    const at = (u) => {
      let i = 0;
      while (i < n - 1 && cum[i + 1] < u) i++;
      const t = (u - cum[i]) / ((cum[i + 1] - cum[i]) || 1), a = w[i], b = w[(i + 1) % n];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    const out = [at(u1)];
    for (let i = 0; i < n; i++) if (cum[i] > u1 && cum[i] < u2) out.push(w[i]);
    out.push(at(u2));
    return out;
  }
  pixRects(px, w, h) {
    const rects = [];
    for (let j = 0; j < h; j++) {
      let i = 0;
      while (i < w) {
        const c = px[j * w + i];
        let k = i + 1;
        while (k < w && px[j * w + k] === c) k++;
        rects.push({ x: i, y: j, w: k - i + 0.04, h: 1.04, fill: c });
        i = k;
      }
    }
    return rects;
  }
  // ───── 윗면 '육각 통째' (16×16 되풀이 대신 윗면 전체를 한 장으로 그리기) ─────
  // 격자 HW × HH 칸, 칸 한 변 = 무늬 픽셀과 같은 세계 길이 P. 가운데가 타일 중심. 육각 밖 칸은 편집하지 않는다(가장자리 둥근 부분은 안쪽 칸 색이 이어짐)
  hexGrid() { return { P: this.tileModel().P, HW: 44, HH: 38 }; }
  hexIn(i, j) {
    const { P, HW, HH } = this.hexGrid(), x = (i + 0.5 - HW / 2) * P, y = (j + 0.5 - HH / 2) * P, ap = 38 / this.tileModel().K + P * 0.5;
    return Math.abs(y) <= ap && Math.abs(x) * 0.866 + Math.abs(y) * 0.5 <= ap;
  }
  // 16×16 되풀이 무늬를 육각 한 장으로 옮긴다 (보이는 모습 그대로 — 중심을 맞춰 칸을 이어 붙인다)
  hexFromTile(top) {
    const { HW, HH } = this.hexGrid(), out = [], m = (v) => ((v % 16) + 16) % 16;
    for (let j = 0; j < HH; j++) for (let i = 0; i < HW; i++) out.push(top[m(j - HH / 2) * 16 + m(i - HW / 2)]);
    return out;
  }
  // 윗면 패턴: 격자 · 벽돌 엇갈림 · 거울 대칭 · 45° 회전 × 크기 · 육각 통째
  topPattern(sk, proj, prefix, rotA) {
    const M = this.tileModel(), f = (v) => Math.round(v * 1000) / 1000;
    const pt = sk.pattern || { type: 'grid', scale: 1 }, P = M.P * (pt.scale || 1), px = sk.top;
    let w = 16, h = 16, arr = px;
    if (pt.type === 'brick') {
      h = 32; arr = [];
      for (let j = 0; j < 32; j++) for (let i = 0; i < 16; i++) arr.push(j < 16 ? px[j * 16 + i] : px[(j - 16) * 16 + (i + 8) % 16]);
    } else if (pt.type === 'mirror') {
      w = 32; h = 32; arr = [];
      for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) arr.push(px[(j < 16 ? j : 31 - j) * 16 + (i < 16 ? i : 31 - i)]);
    }
    // 육각 통째: 윗면 전체가 한 장 — 무늬 원점을 타일 중심에서 반 장만큼 당겨 가운데를 맞춘다 (크기 배율은 쓰지 않음)
    if (pt.type === 'hex' && sk.hexTop) {
      const G = this.hexGrid(), Ph = G.P, ra = rotA || 0, c1 = Math.cos(ra), s1 = Math.sin(ra), ox = -G.HW * Ph / 2, oy = -G.HH * Ph / 2;
      const O0 = proj(0, 0, 0), Uh = proj(Ph * c1, Ph * s1, 0), Vh = proj(-Ph * s1, Ph * c1, 0), Oh = proj(ox * c1 - oy * s1, ox * s1 + oy * c1, 0);
      return { id: prefix + '-top', w: G.HW, h: G.HH, m: 'matrix(' + [Uh[0] - O0[0], Uh[1] - O0[1], Vh[0] - O0[0], Vh[1] - O0[1], Oh[0], Oh[1]].map(f).join(' ') + ')', rects: this.pixRects(sk.hexTop, G.HW, G.HH) };
    }
    const a = pt.type === 'diamond' ? Math.PI / 4 : 0, ca = Math.cos(a), sa = Math.sin(a);
    const O = proj(0, 0, 0), U = proj(P * ca, P * sa, 0), V = proj(-P * sa, P * ca, 0);
    return { id: prefix + '-top', w, h, m: 'matrix(' + [U[0] - O[0], U[1] - O[1], V[0] - O[0], V[1] - O[1], O[0], O[1]].map(f).join(' ') + ')', rects: this.pixRects(arr, w, h) };
  }
  // role: false(일반 필드) · 'leaf' · 'tree' · 'both' — 노드 필드면 솟고, 확장 옆면으로 메우고, 역할 테두리가 둘린다
  //       'parent' — 부모 필드: 부모 높이만큼 더 솟고, 옆면 띠 · 테두리를 부모 전용 무늬로 두른다
  bakeTile(sk, view, prefix, role) {
    const M = this.tileModel(), f = (v) => Math.round(v * 100) / 100;
    const ya = (view.yaw || 0) * Math.PI / 180, cy = Math.cos(ya), sy = Math.sin(ya);
    const sp = view.pitch === undefined ? M.K : Math.sin(view.pitch * Math.PI / 180), cp = Math.sqrt(1 - sp * sp);
    const sc = view.scale || 1;
    const proj = (x, y, z) => { const xr = x * cy - y * sy, yr = x * sy + y * cy; return [xr * sc, (yr * sp - z * cp) * sc]; };
    const str = (arr) => arr.map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
    const light = (nx, ny) => Math.round((0.58 + 0.42 * ((nx * -0.8 + ny * 0.6) + 1) / 2) * 25) / 25;
    const topPat = this.topPattern(sk, proj, prefix);
    const top = str(M.w.map((p) => proj(p[0], p[1], 0)));
    const pd = role === 'parent' ? this.parentOf(sk) : null;
    const bottom = -M.Dw - (pd ? pd.lift : role ? (sk.lift || 0) : 0) / M.C;
    const base = str(this.hull(M.w.map((p) => proj(p[0], p[1], 0)).concat(M.w.map((p) => proj(p[0], p[1], bottom)))));
    const rows = [];
    for (let j = 0; j < 2; j++) rows.push({ px: pd ? pd.band : sk.band, j, z0: -j * M.BHw / 2, z1: -(j + 1) * M.BHw / 2 });
    for (let j = 0; j < 16; j++) rows.push({ px: sk.side, j, z0: -M.BHw - j * M.P, z1: -M.BHw - (j + 1) * M.P });
    for (let j = 0; -M.Dw - j * M.P > bottom + 1e-6; j++) rows.push({ px: sk.fill, j: j % 16, z0: -M.Dw - j * M.P, z1: Math.max(bottom, -M.Dw - (j + 1) * M.P) });
    const nCol = Math.ceil(M.L / M.P - 1e-9);
    const cols = [];
    for (let k = 0; k < nCol; k++) {
      const u0 = k * M.P, u1 = Math.min(M.L, (k + 1) * M.P), pts = this.arcPts(u0, u1);
      const a = pts[0], b = pts[pts.length - 1], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let nx = b[1] - a[1], ny = -(b[0] - a[0]);
      if (nx * mid[0] + ny * mid[1] < 0) { nx = -nx; ny = -ny; }
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      cols.push({ k, u0, u1, vis: nx * sy + ny * cy > 0.001, lf: light(nx, ny) });
    }
    const polys = [];
    let cells = 0;
    rows.forEach((r) => {
      let run = null;
      const flush = () => {
        if (!run) return;
        const edge = this.arcPts(run.u0, run.u1);
        polys.push({ pts: str(edge.map((p) => proj(p[0], p[1], r.z0)).concat(edge.slice().reverse().map((p) => proj(p[0], p[1], r.z1)))), c: run.c });
        run = null;
      };
      cols.forEach((cl) => {
        if (!cl.vis) { flush(); return; }
        cells++;
        const c = this.scaleC(r.px[r.j * 16 + (cl.k % 16)], cl.lf);
        if (run && run.c === c) run.u1 = cl.u1; else { flush(); run = { u0: cl.u0, u1: cl.u1, c }; }
      });
      flush();
    });
    const rimPolys = [];
    if (role) {
      const rimPx = pd ? pd.rim : sk.rim[role];
      for (let j = 0; j < 2; j++) {
        const wo = this.insetOutline(j * M.P), wi = this.insetOutline((j + 1) * M.P);
        let run = null;
        const flush = () => {
          if (!run) return;
          const a = this.arcPts(run.u0, run.u1, wo), b = this.arcPts(run.u0, run.u1, wi);
          rimPolys.push({ pts: str(a.map((p) => proj(p[0], p[1], 0)).concat(b.reverse().map((p) => proj(p[0], p[1], 0)))), c: run.c });
          run = null;
        };
        cols.forEach((cl) => {
          const c = rimPx[j * 16 + (cl.k % 16)];
          if (run && run.c === c) run.u1 = cl.u1; else { flush(); run = { u0: cl.u0, u1: cl.u1, c }; }
        });
        flush();
      }
    }
    const group = (list) => {
      const m = new Map();
      list.forEach((p) => m.set(p.c, (m.get(p.c) || '') + 'M' + p.pts.split(' ').join(' L') + ' Z '));
      return Array.from(m, ([c, d]) => ({ c, d: d.trim() }));
    };
    const paths = group(polys), rim = group(rimPolys);
    return { top, topPat, base, baseFill: this.scaleC(this.avgC(sk.side), 0.8), paths, rim, cells, count: polys.length + rimPolys.length, els: paths.length + rim.length };
  }

  renderVals() {
    const data = this.state.data, CELL = 12;
    const HG = this.hexGrid(), hexMode = !!(data.pattern && data.pattern.type === 'hex' && data.hexTop);
    const WOF = (key) => key === 'hexTop' ? HG.HW : 16, maskOK = (key, x, y) => key !== 'hexTop' || this.hexIn(x, y);
    const rimKind = this.state.rimKind, sideKind = this.state.sideKind, bandKind = this.state.bandKind;
    const sel = this.state.sel;
    const commitAdj = () => { if (this.state.adj) this.setState({ adj: null }); };
    // 편집 컴포넌트 4개: 테두리(Leaf · Tree · Tree·Leaf) · 윗면 · 옆면 띠 · 옆면(옆면 · 확장면)
    // 한 번에 하나만 활성 — 도구는 활성 컴포넌트에만 먹고, 활성 컴포넌트의 기능은 팔레트 아래에 뜬다
    const active = this.state.active;
    const activate = (id) => { if (this.state.active !== id) { commitAdj(); this.setState({ active: id, sel: null, pasting: false }); } };
    const tab = (label, on, pick) => ({ label, sel: on ? 'true' : 'false', bg: on ? '#ede9e1' : 'transparent', fg: on ? '#111111' : '#9aa1ab', fw: on ? 600 : 400, sh: on ? '0 1px 2px rgba(0,0,0,0.35)' : 'none', pick });
    const RIMK = [['leaf', 'Leaf'], ['tree', 'Tree'], ['both', 'Tree·Leaf'], ['parent', '부모']], SIDEK = [['side', '옆면'], ['fill', '확장면']], BANDK = [['band', '일반'], ['parent', '부모']];
    const defs = [
      { id: 'rim', key: rimKind === 'parent' ? 'parent.rim' : 'rim.' + rimKind, label: '노드 테두리', kindLabel: RIMK.find((k) => k[0] === rimKind)[1], h: 2,
        kinds: RIMK.map(([k, l]) => tab(l, rimKind === k, () => { commitAdj(); this.setState({ rimKind: k, active: 'rim', sel: null }); })) },
      // 윗면: 패턴이 '육각 통째'면 윗면 전체 한 장(44 × 38, 육각 밖 칸은 흐리게 · 편집 안 됨)
      hexMode ? { id: 'top', key: 'hexTop', label: '윗면 · 육각 통째', h: HG.HH, w: HG.HW, cell: 5, kinds: [] } : { id: 'top', key: 'top', label: '윗면', h: 16, kinds: [] },
      { id: 'band', key: bandKind === 'parent' ? 'parent.band' : 'band', label: '옆면 띠', kindLabel: BANDK.find((k) => k[0] === bandKind)[1], h: 2,
        kinds: BANDK.map(([k, l]) => tab(l, bandKind === k, () => { commitAdj(); this.setState({ bandKind: k, active: 'band', sel: null }); })) },
      { id: 'side', key: sideKind, label: '옆면', kindLabel: SIDEK.find((k) => k[0] === sideKind)[1], h: 16,
        kinds: SIDEK.map(([k, l]) => tab(l, sideKind === k, () => { commitAdj(); this.setState({ sideKind: k, active: 'side', sel: null }); })) }
    ];
    const comps = defs.map((d) => {
      const arr = this.getArr(data, d.key), on = active === d.id;
      const inSel = on && sel && sel.key === d.key;
      return {
        label: d.label, size: (d.w || 16) + ' × ' + d.h, kinds: d.kinds, hasKinds: d.kinds.length > 0, cell: d.cell || CELL,
        cur: on ? 'true' : 'false', tip: on ? '' : '눌러서 활성화', state: on ? '편집 중' : '비활성',
        border: on ? '1px solid rgba(255,216,77,0.55)' : '1px solid rgba(255,255,255,0.08)', bg: on ? 'rgba(255,216,77,0.045)' : 'rgba(255,255,255,0.02)',
        dot: on ? '#ffd84d' : '#4b515b', fg: on ? '#ede9e1' : '#9aa1ab', op: on ? 1 : 0.55,
        cardCursor: on ? 'default' : 'pointer', cursor: on ? (this.state.pasting ? 'copy' : this.state.tool === 'select' ? 'cell' : 'crosshair') : 'pointer',
        pxClass: on ? 'px' : '',
        activate: () => activate(d.id),
        gw: (d.w || 16) * (d.cell || CELL), gh: d.h * (d.cell || CELL),
        px: (() => { const W = d.w || 16, CL = d.cell || CELL; return arr.map((c, i) => { const x = i % W, y = Math.floor(i / W); return { x: x * CL, y: y * CL, c, op: maskOK(d.key, x, y) ? 1 : 0.28, key: d.key + ',' + x + ',' + y }; }); })(),
        sx: inSel ? Math.min(sel.x0, sel.x1) * (d.cell || CELL) : 0, sy: inSel ? Math.min(sel.y0, sel.y1) * (d.cell || CELL) : 0,
        sw: inSel ? (Math.abs(sel.x1 - sel.x0) + 1) * (d.cell || CELL) : 0, sh: inSel ? (Math.abs(sel.y1 - sel.y0) + 1) * (d.cell || CELL) : 0, sop: inSel ? 1 : 0
      };
    });
    const compOfKey = (key) => key.indexOf('rim.') === 0 || key === 'parent.rim' ? 'rim' : key === 'parent.band' ? 'band' : (key === 'side' || key === 'fill') ? 'side' : key === 'hexTop' ? 'top' : key;

    // ───── 활성 컴포넌트 기능 (팔레트 아래) ─────
    const ad = defs.find((d) => d.id === active), aKey = ad.key, aArr = this.getArr(data, aKey);
    const adj = this.state.adj, a = adj && adj.key === aKey ? adj : null, cur = a || { h: 0, s: 0, l: 0 };
    const applyAdj = (h, s, l) => {
      const base = a ? a.base : aArr.slice();
      this.setState({ data: this.withArr(this.state.data, aKey, base.map((c) => this.shiftHsl(c, h, s, l))), adj: { key: aKey, base, h, s, l }, saved: false, hist: a ? this.state.hist : this.state.hist.concat([this.state.data]).slice(-40) });
    };
    const HUES = [['빨강', 0], ['주황', 30], ['노랑', 50], ['초록', 125], ['청록', 180], ['파랑', 220], ['보라', 275], ['분홍', 330]];
    // 색상 칩: 지금 무늬의 평균 색상이 그 색이 되도록 한 번에 돌린다 (파랑 → 노랑)
    const hues = HUES.map(([name, hue]) => ({
      name, c: this.fromHsl(hue, 0.7, 0.55),
      pick: () => {
        const base = a ? a.base : aArr;
        let xs = 0, ys = 0;
        base.forEach((c) => { const [hh, ss] = this.toHsl(c); xs += Math.cos(hh * Math.PI / 180) * ss; ys += Math.sin(hh * Math.PI / 180) * ss; });
        let dh = Math.round((hue - Math.atan2(ys, xs) * 180 / Math.PI) / 2) * 2;
        dh = ((dh + 180) % 360 + 360) % 360 - 180;
        applyAdj(dh, cur.s, cur.l);
      }
    }));

    // ───── 도구 ─────
    const parse = (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-px]') : null;
      if (!el) return null;
      const [key, x, y] = el.getAttribute('data-px').split(',');
      return { key, x: Number(x), y: Number(y) };
    };
    const H = (key) => this.getArr(this.state.data, key).length / WOF(key);
    const pushHist = () => this.state.hist.concat([this.state.data]).slice(-40);
    const setPx = (key, changes, keepHist) => {
      const arr = this.getArr(this.state.data, key).slice();
      let changed = false;
      const W = WOF(key);
      changes.forEach(([x, y, c]) => { const i = y * W + x; if (x >= 0 && x < W && y >= 0 && y < H(key) && maskOK(key, x, y) && arr[i] !== c) { arr[i] = c; changed = true; } });
      if (!changed) return;
      const rec = [this.state.color].concat(this.state.recent.filter((c) => c !== this.state.color)).slice(0, 12);
      this.setState({ data: this.withArr(this.state.data, key, arr), saved: false, recent: rec, hist: keepHist ? this.state.hist : pushHist(), adj: null });
    };
    const spray = (p) => {
      const ch = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5 && Math.random() < 0.35) ch.push([p.x + dx, p.y + dy, this.state.color]);
      return ch;
    };
    const flood = (p) => {
      const W = WOF(p.key), arr = this.getArr(this.state.data, p.key), h = arr.length / W, target = arr[p.y * W + p.x];
      if (target === this.state.color) return [];
      const seen = new Set(), stack = [[p.x, p.y]], ch = [];
      while (stack.length) {
        const [x, y] = stack.pop(), k = x + ',' + y;
        if (x < 0 || y < 0 || x >= W || y >= h || seen.has(k) || arr[y * W + x] !== target || !maskOK(p.key, x, y)) continue;
        seen.add(k); ch.push([x, y, this.state.color]);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      return ch;
    };
    const pasteAt = (p) => {
      const cb = this.state.clip;
      if (!cb) return;
      const ch = [];
      for (let y = 0; y < cb.h; y++) for (let x = 0; x < cb.w; x++) ch.push([p.x + x, p.y + y, cb.px[y * cb.w + x]]);
      setPx(p.key, ch);
      this.setState({ pasting: false });
    };
    const down = (e) => {
      const root = e.currentTarget.closest ? e.currentTarget.closest('main') : null;
      if (root) { root.tabIndex = -1; root.focus({ preventScroll: true }); }
      const p = parse(e);
      if (!p || compOfKey(p.key) !== this.state.active) return; // 비활성 카드: 카드가 눌리며 활성화만
      if (this.state.pasting) { pasteAt(p); return; }
      const tool = this.state.tool;
      if (tool === 'pick') { this.setState({ color: this.getArr(this.state.data, p.key)[p.y * WOF(p.key) + p.x], tool: 'pen' }); return; }
      if (tool === 'select') { this.selecting = true; this.setState({ sel: { key: p.key, x0: p.x, y0: p.y, x1: p.x, y1: p.y } }); return; }
      if (tool === 'bucket') { setPx(p.key, flood(p)); return; }
      this.stroke = { key: p.key, first: true };
      if (tool === 'pen') setPx(p.key, [[p.x, p.y, this.state.color]]);
      if (tool === 'spray') setPx(p.key, spray(p));
      this.stroke.first = false;
    };
    const move = (e) => {
      const p = parse(e);
      if (!p || compOfKey(p.key) !== this.state.active) return;
      if (this.selecting) {
        const s = this.state.sel;
        if (s && s.key === p.key && (s.x1 !== p.x || s.y1 !== p.y)) this.setState({ sel: Object.assign({}, s, { x1: p.x, y1: p.y }) });
        return;
      }
      if (!this.stroke || this.stroke.key !== p.key) return;
      if (this.state.tool === 'pen') setPx(p.key, [[p.x, p.y, this.state.color]], true);
      if (this.state.tool === 'spray') setPx(p.key, spray(p), true);
    };
    const up = () => { this.stroke = null; this.selecting = false; };
    const copy = () => {
      const s = this.state.sel;
      if (!s) return;
      const arr = this.getArr(this.state.data, s.key);
      const x0 = Math.min(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), w = Math.abs(s.x1 - s.x0) + 1, h = Math.abs(s.y1 - s.y0) + 1, px = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.push(arr[(y0 + y) * WOF(s.key) + x0 + x]);
      this.setState({ clip: { w, h, px } });
    };
    const fillSel = () => {
      const s = this.state.sel;
      if (!s) return;
      const ch = [];
      for (let y = Math.min(s.y0, s.y1); y <= Math.max(s.y0, s.y1); y++) for (let x = Math.min(s.x0, s.x1); x <= Math.max(s.x0, s.x1); x++) ch.push([x, y, this.state.color]);
      setPx(s.key, ch);
    };
    const undo = () => {
      const h = this.state.hist;
      if (!h.length) return;
      this.setState({ data: h[h.length - 1], hist: h.slice(0, -1), adj: null, saved: false });
    };
    const key = (e) => {
      const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
      if (mod && k === 'c') { e.preventDefault(); copy(); }
      else if (mod && k === 'v') { e.preventDefault(); if (this.state.clip) this.setState({ pasting: true }); }
      else if (mod && k === 'z') { e.preventDefault(); undo(); }
      else if (k === 'escape') this.setState({ sel: null, pasting: false });
    };
    const TOOLS = [
      { id: 'pen', label: '연필', tip: '한 칸씩 · 끌면 이어서' },
      { id: 'spray', label: '스프레이', tip: '누른 채 끌면 주변에 흩뿌림' },
      { id: 'bucket', label: '페인트', tip: '이어진 같은 색을 한 번에' },
      { id: 'select', label: '범위 선택', tip: '끌어서 사각형 선택' },
      { id: 'pick', label: '스포이드', tip: '칸의 색을 가져옴' }
    ];
    const tools = TOOLS.map((t) => {
      const on = this.state.tool === t.id && !this.state.pasting;
      return { label: t.label, tip: t.tip, pressed: on ? 'true' : 'false', border: on ? '1px solid #ede9e1' : '1px solid rgba(255,255,255,0.14)', bg: on ? '#ede9e1' : 'rgba(255,255,255,0.04)', fw: on ? 600 : 400, pick: () => this.setState({ tool: t.id, pasting: false }) };
    });
    const selTxt = sel ? '선택 ' + (Math.abs(sel.x1 - sel.x0) + 1) + '×' + (Math.abs(sel.y1 - sel.y0) + 1) : '';
    const clipTxt = this.state.clip ? '클립보드 ' + this.state.clip.w + '×' + this.state.clip.h : '';
    const status = this.state.pasting ? '붙여넣을 칸(왼쪽 위)을 클릭하세요 · 다른 부분에도 붙일 수 있음' : [selTxt, clipTxt].filter(Boolean).join(' · ');

    // ───── 윗면 패턴 ─────
    const PT = [['grid', '격자 반복'], ['brick', '벽돌 엇갈림'], ['mirror', '거울 대칭'], ['diamond', '45° 회전'], ['hex', '육각 통째']];
    const patT = (data.pattern && data.pattern.type) || 'grid', patScale = (data.pattern && data.pattern.scale) || 1;
    const setPattern = (p) => this.setState({ data: Object.assign({}, this.state.data, { pattern: Object.assign({}, this.state.data.pattern, p) }), saved: false, hist: pushHist() });
    // 육각 통째로 바꾸면: 지금 16×16 무늬를 윗면 한 장으로 옮겨 시작한다 (모든 프레임에). 되풀이 타입으로 돌아가도 육각 그림은 남겨 둔다
    const toHex = () => {
      const D0 = this.state.data, hexTop = D0.hexTop || this.hexFromTile(D0.top);
      const frames = this.state.frames.map((f) => f && !f.hexTop ? Object.assign({}, f, { hexTop: this.hexFromTile(f.top) }) : f);
      const data = Object.assign({}, D0, { hexTop, pattern: Object.assign({}, D0.pattern, { type: 'hex' }) });
      this._loadedRef = this._loadedRef === D0 ? data : this._loadedRef;
      this.setState({ data, frames, saved: false, hist: pushHist(), sel: null });
    };
    const patTypes = PT.map(([id, label]) => ({ label, pressed: patT === id ? 'true' : 'false', border: patT === id ? '1px solid #ede9e1' : '1px solid rgba(255,255,255,0.14)', bg: patT === id ? '#ede9e1' : 'rgba(255,255,255,0.04)', fw: patT === id ? 600 : 400, pick: () => id === 'hex' ? toHex() : setPattern({ type: id }) }));
    const patHint = { grid: '16×16을 그대로 되풀이', brick: '한 줄 걸러 반 칸(8픽셀) 밀어 되풀이', mirror: '좌우 · 상하로 뒤집어 32×32로 이음매를 감춤', diamond: '격자를 45° 돌려서 깔기', hex: '윗면 전체(44 × 38)를 한 장으로 — 되풀이 없음. 흐린 칸은 육각 밖 · 크기 배율은 쓰지 않음' }[patT];

    // ───── 모니터링 ─────
    const role3 = this.state.role3d;
    // 재생 중: 프레임 pf를 그린다. 같은 프레임 · 시점이면 구운 결과를 다시 쓴다 (틱마다 7장을 새로 굽지 않게)
    const playing = this.state.playing, pdata = playing ? Object.assign({}, data, this.state.frames[this.state.pf]) : data;
    const pvKey = playing ? [this.state.pf, this.state.yaw, this.state.pitch, role3].join('|') : null;
    if (!playing) this._pv = null;
    const pv = pvKey && this._pv && this._pv[pvKey] ? this._pv[pvKey] : (() => {
      const b3 = this.bakeTile(pdata, { yaw: this.state.yaw, pitch: this.state.pitch, scale: 1.5 }, 'fe3', role3);
      const b2 = this.bakeTile(pdata, {}, 'fe2', false);
      const fieldDefs = [['fe-tile', false], ['fe-tile-leaf', 'leaf'], ['fe-tile-tree', 'tree'], ['fe-tile-both', 'both'], ['fe-tile-parent', 'parent']]
        .map(([id, r]) => Object.assign({ id }, r ? this.bakeTile(pdata, {}, 'fe2', r) : b2));
      const out = { b3, b2, fieldDefs };
      if (pvKey) { this._pv = this._pv || {}; this._pv[pvKey] = out; }
      return out;
    })();
    const b3 = pv.b3, b2 = pv.b2, fieldDefs = pv.fieldDefs;
    const lift = data.lift || 0, PD = this.parentOf(data), pLift = PD.lift;
    // 클러스터 한 장: 가운데 부모, 둘레에 부모와 바로 이어진 자식(Leaf · Tree · Tree·Leaf)과 빈 필드
    const cluster = [[0, -92, false], [-130, -46, 'both'], [130, -46, false], [-130, 46, 'leaf'], [0, 0, 'parent'], [130, 46, 'tree']]
      .sort((a, b) => a[1] - b[1])
      .map(([x, y, r]) => ({ href: '#fe-tile' + (r ? '-' + r : ''), T: 'translate(' + x + ' ' + (y - (r === 'parent' ? pLift : r ? lift : 0)) + ')' }));
    const roleTabs = [[false, '일반'], ['leaf', 'Leaf'], ['tree', 'Tree'], ['both', 'Tree·Leaf'], ['parent', '부모']].map(([r, label]) => {
      const on = role3 === r;
      return { label, pressed: on ? 'true' : 'false', border: on ? '1px solid #ede9e1' : '1px solid rgba(255,255,255,0.14)', bg: on ? '#ede9e1' : 'rgba(255,255,255,0.04)', fw: on ? 600 : 400, pick: () => this.setState({ role3d: r }) };
    });
    const oDown = (e) => { this.orbit = { x: e.clientX, y: e.clientY, yaw: this.state.yaw, pitch: this.state.pitch }; };
    const oMove = (e) => {
      const o = this.orbit;
      if (!o) return;
      this.setState({ yaw: o.yaw + (e.clientX - o.x) * 0.5, pitch: Math.max(8, Math.min(88, o.pitch + (e.clientY - o.y) * 0.3)) });
    };
    const oUp = () => { this.orbit = null; };
    const fieldPitch = Math.asin(this.tileModel().K) * 180 / Math.PI;
    const yawN = ((Math.round(this.state.yaw) % 360) + 360) % 360;

    // ───── 팔레트 · 스킨 ─────
    const PAL = ['#1b1f24', '#3a4049', '#5f6772', '#8a929c', '#b5bcc4', '#ffffff',
      '#5a2d1c', '#8a4b2d', '#a8744a', '#d08a5c', '#e8b98a', '#d6b37f',
      '#1f4d2b', '#2f6b42', '#3f8a4e', '#58b066', '#86d690', '#9bd18b',
      '#1e3a5f', '#4f7fd9', '#6f9cf0', '#9cc0ff', '#8cc3d6', '#2e5f8a',
      '#c98a1c', '#f0b442', '#ffd88a', '#e0a23a', '#a65f00', '#d33d52',
      '#56616e', '#8795a3', '#b3c0cc', '#838684', '#b8bbb7', '#cdd0cc'];
    const palette = PAL.map((hex) => ({
      hex, pressed: hex === this.state.color ? 'true' : 'false',
      border: hex === this.state.color ? '2px solid #0d0f13' : '1px solid rgba(255,255,255,0.10)',
      pick: () => this.setState({ color: hex, tool: this.state.tool === 'pick' ? 'pen' : this.state.tool })
    }));
    const skins = this.state.skins;
    // 저장: 공통 부분(부모 디자인 · 높이 · 패턴) + 프레임 목록. 스킨의 기본 픽셀 = 첫 프레임
    const skinOut = () => { const fr = this.state.anim ? this.framesNow() : [this.frameCur()].concat(new Array(15).fill(null)); return Object.assign(this.copySkin(data), this.copyFrame(fr[0]), { frames: fr }); };
    const save = () => this.setState({ skins: skins.map((s) => s.id === this.state.curId ? Object.assign({}, s, { name: this.state.name }, skinOut()) : s), saved: true });
    const saveAs = () => {
      const id = 'f' + (skins.length + 1), name = this.state.name + ' 사본';
      this.setState({ skins: skins.concat([Object.assign({ id, name }, skinOut())]), curId: id, name, saved: true });
    };
    const newSkin = () => {
      const id = 'f' + (skins.length + 1), cur = skins[0];
      const blank = Object.assign(this.copySkin(cur), { top: new Array(256).fill('#b8bbb7'), band: new Array(32).fill('#9fa29f'), side: new Array(256).fill('#838684'), fill: new Array(256).fill('#5f6260'), pattern: { type: 'grid', scale: 1 } });
      if (this.state.playing) this.animPlay(false);
      this.setState({ skins: skins.concat([Object.assign({ id, name: '새 필드' }, blank, { frames: [this.copyFrame(blank)].concat(new Array(15).fill(null)) })]), curId: id, name: '새 필드', data: this._loadedRef = this.copySkin(blank), frames: [this.copyFrame(blank)].concat(new Array(15).fill(null)), fi: 0, anim: false, confirmBasic: false, saved: true, hist: [], sel: null, adj: null });
    };
    const pickSkin = (e) => {
      const s = skins.find((x) => x.id === e.target.value);
      if (!s) return;
      if (this.state.playing) this.animPlay(false);
      const fr = this.slotsOf(s);
      this.setState({ curId: s.id, name: s.name, data: this._loadedRef = Object.assign(this.copySkin(s), this.copyFrame(fr[0])), frames: fr, fi: 0, anim: this.keyCount(fr) > 1, confirmBasic: false, saved: true, hist: [], sel: null, adj: null });
    };
    const own = !!data.parent;
    const setParent = (pd, extra) => this.setState(Object.assign({ data: Object.assign({}, this.state.data, { parent: pd }), saved: false, hist: pushHist(), adj: null }, extra || {}));
    const pc = {
      own,
      chip: own ? '이 필드 전용' : '기본 디자인 따름',
      chipBg: own ? 'rgba(189,132,255,0.07)' : 'rgba(255,255,255,0.025)', chipFg: own ? '#cfa8ff' : '#9aa1ab', chipLine: own ? 'rgba(189,132,255,0.45)' : 'rgba(255,255,255,0.10)',
      note: own ? '이 필드에만 쓰입니다 — 다른 필드는 기본 디자인 그대로' : '띠 · 테두리 · 높이를 고치면 이 필드 전용으로 갈라집니다',
      lift: pLift,
      setLift: (e) => setParent(Object.assign(this.copyParent(PD), { lift: Number(e.target.value) })),
      reset: () => { if (own) setParent(null); },
      resetFg: own ? '#ede9e1' : '#5d646e',
      makeDefault: () => { if (own) setParent(null, { parentDef: this.copyParent(data.parent), skins: this.state.skins }); },
      makeFg: own ? '#ede9e1' : '#5d646e',
      band: PD.band.map((c, i) => ({ c, x: (i % 16) * 7, y: Math.floor(i / 16) * 7 })),
      rim: PD.rim.map((c, i) => ({ c, x: (i % 16) * 7, y: Math.floor(i / 16) * 7 })),
      editBand: () => { commitAdj(); this.setState({ bandKind: 'parent', active: 'band', sel: null }); },
      editRim: () => { commitAdj(); this.setState({ rimKind: 'parent', active: 'rim', sel: null }); },
      view: () => this.setState({ role3d: 'parent' }),
      users: this.state.skins.filter((x) => x.id !== this.state.curId && !x.parent).map((x) => x.name).concat(own ? [] : [this.state.name]).join(' · ') || '없음'
    };
    return {
      pc,
      name: this.state.name,
      setName: (e) => this.setState({ name: e.target.value, saved: false }),
      saveText: this.state.saved ? '저장됨' : '저장 안 됨',
      saveColor: this.state.saved ? '#3ecf8e' : '#f5b83d',
      save, saveAs, newSkin, pickSkin,
      skinList: skins.map((s) => { const on = s.id === this.state.curId, fr = this.keyCount(s.frames); return { name: on ? this.state.name : s.name, img: this.thumb(on ? this.frameCur() : this.copyFrame(s.frames && s.frames[0] ? s.frames[0] : s)), on: on ? 'true' : 'false', fw: on ? 600 : 500, meta: s.id + (fr > 1 ? ' · ' + fr + '프레임' : ''), playDisp: fr > 1 ? 'inline-flex' : 'none', pick: () => { if (!on) pickSkin({ target: { value: s.id } }); } }; }),
      curId: this.state.curId,
      // 2프레임 이상 = 애니메이션 필드: 목록에 ▶️
      skinOptions: skins.map((s) => ({ id: s.id, label: (this.keyCount(s.frames) > 1 ? '▸ ' : '') + s.name })),
      an: this.animVals({ typeLabel: '필드', basicLabel: '일반 필드', animLabel: '애니메이션 필드', thumb: (f) => this.thumb(f), copy: (f) => this.copyFrame(f), slotH: 44, slotHM: 32, slotHS: 24, maxLen: 4 }),
      comps, cell: CELL, tools, status,
      cursor: this.state.pasting ? 'copy' : this.state.tool === 'select' ? 'cell' : 'crosshair',
      down, move, up, key, copy, fillSel, undo,
      pasteMode: () => { if (this.state.clip) this.setState({ pasting: !this.state.pasting }); },
      pasteBorder: this.state.pasting ? '1px solid #ffd84d' : '1px solid rgba(255,255,255,0.18)',
      pasteBg: this.state.pasting ? 'rgba(255,216,77,0.14)' : 'rgba(255,255,255,0.04)',
      pasteColor: this.state.clip ? '#ede9e1' : '#5d646e',
      copyColor: sel ? '#ede9e1' : '#5d646e',
      undoColor: this.state.hist.length ? '#ede9e1' : '#5d646e',
      patTypes, patScale, patHint,
      actLabel: ad.label + (ad.kindLabel ? ' · ' + ad.kindLabel : ''),
      actScope: (ad.id === 'rim' ? ad.kindLabel + ' 테두리' : (ad.kindLabel || ad.label)) + ' 전체 픽셀',
      hues, adjH: cur.h, adjS: cur.s, adjL: cur.l,
      setH: (e) => applyAdj(Number(e.target.value), cur.s, cur.l),
      setS: (e) => applyAdj(cur.h, Number(e.target.value), cur.l),
      setL: (e) => applyAdj(cur.h, cur.s, Number(e.target.value)),
      commitAdj: () => this.setState({ adj: null }),
      cancelAdj: () => { if (a) this.setState({ data: this.withArr(this.state.data, aKey, a.base), adj: null }); },
      adjBtn: a ? '#ede9e1' : '#5d646e',
      showPattern: active === 'top',
      showLift: active === 'side' && sideKind === 'fill',
      setPatScale: (e) => setPattern({ scale: Number(e.target.value) }),
      lift,
      setLift: (e) => this.setState({ data: Object.assign({}, this.state.data, { lift: Number(e.target.value) }), saved: false }),
      b3, b2, fieldDefs, cluster, roleTabs, oDown, oMove, oUp,
      yawLabel: '방위 ' + yawN + '°',
      pitchLabel: '기울기 ' + Math.round(this.state.pitch) + '°',
      resetView: () => this.setState({ yaw: 0, pitch: fieldPitch }),
      color: this.state.color,
      setColor: (e) => this.setState({ color: e.target.value }),
      palette,
      recent: this.state.recent.map((hex) => ({ hex, pick: () => this.setState({ color: hex }) }))
    };
  }
}
