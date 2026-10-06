// 자재 편집기 — 디자인 캔버스 원본 design/MaterialEditor.dc.html 에서 옮긴 화면 로직 (module 변형 · tools/gen-pages.py로 다시 만든다)
// 데이터를 바꿔 끼우는 곳은 src/boot/module.js · src/data/*.js — 이 파일은 손으로 고치지 않는다
import { DCLogic } from '../runtime/dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    const mats = this.makeMats();
    const m = mats[1];
    this.state = {
      mats,
      curId: m.id,
      name: m.name,
      faces: this._loadedRef = this.copyFaces(m.faces),
      // 커스텀 자재(8³ 블럭)일 때: kind = 'custom', vox = 512칸(x + y·8 + z·64, null = 빈 칸) · vhover · vplacing = 설치 준비 (건물 편집기와 같은 조작)
      kind: 'cube', vox: null, layer: 0, ghost: true, vhover: null, vplacing: false,
      // 애니메이션: 프레임 목록 · 지금 편집 중인 프레임(fi) · 재생 중 보이는 프레임(pf). 자재 주기는 1초 고정
      frames: this.slotsOf(m), fi: 0, anim: this.keyCount(m.frames) > 1, step: 2,
      playing: false, pf: 0, pt: 0, pg: -1, confirmBasic: false,
      color: '#b0603f',
      tool: 'pen',
      sel: 'py',
      recent: [],
      saved: true,
      rsel: null,
      clip: null,
      pasting: false,
      hist: [],
      adj: null,
      adjAll: false,
      yaw: 45,
      pitch: this.fieldPitch()
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
  // 프레임 = 큐브 자재는 6면 { pz, nz, … } · 커스텀 자재는 { vox } — 애니메이션 칸 기능은 둘 다 같은 코드를 쓴다
  copyFrame(f) { return f && f.vox ? { vox: f.vox.slice() } : this.copyFaces(f); }
  frameCur() { return this.state.kind === 'custom' ? { vox: this.state.vox.slice() } : this.copyFaces(this.state.faces); }
  curRef() { return this.state.kind === 'custom' ? this.state.vox : this.state.faces; }
  frameLoad(f) {
    if (f && f.vox) { const vox = f.vox.slice(); this._loadedRef = vox; return { vox, hist: [], rsel: null, adj: null, pasting: false }; }
    const faces = this.copyFaces(f); this._loadedRef = faces; return { faces, hist: [], rsel: null, adj: null, pasting: false };
  }
  slotsOf(m) {
    if (m.kind === 'custom') return m.frames && m.frames.length ? m.frames.map((f) => f ? this.copyFrame(f) : null) : [{ vox: m.vox.slice() }].concat(new Array(15).fill(null));
    return m.frames && m.frames.length ? m.frames.map((f) => f ? this.copyFaces(f) : null) : [this.copyFaces(m.faces)].concat(new Array(15).fill(null));
  }
  // ───── 커스텀 자재: 8 × 8 × 8 색 블럭 (VN = 한 변 칸 수) ─────
  // 좌표: x = 오른쪽, y = 앞, z = 위. 칸 번호 = x + y·8 + z·64 (값 = 색 또는 null)
  get VN() { return 8; }
  vi(x, y, z) { return x + y * 8 + z * 64; }
  // 블럭을 등각으로 그린 그림(data URL). 보이는 면만(옆 칸이 비었고 카메라 쪽을 보는 면) 먼 것부터 칠한다. 같은 그림은 한 번만
  voxImg(vox, W, H, yaw, pitch, Zs, ox, oy) {
    if (typeof document === 'undefined') return '';
    let sig = W + '|' + H + '|' + Math.round(yaw) + '|' + Math.round(pitch) + '|';
    for (let i = 0; i < vox.length; i++) if (vox[i]) sig += i + vox[i];
    this._voxImgs = this._voxImgs || new Map();
    if (this._voxImgs.has(sig)) return this._voxImgs.get(sig);
    const cv = document.createElement('canvas'), R = 2; cv.width = W * R; cv.height = H * R;
    const g = cv.getContext('2d'); g.scale(R, R);
    const ya = yaw * Math.PI / 180, pa = pitch * Math.PI / 180, cy = Math.cos(ya), sy = Math.sin(ya), sp = Math.sin(pa), cp = Math.cos(pa);
    const P = (x, y, z) => { const wx = x - 0.5, wy = y - 0.5, wz = z - 0.5, xr = wx * cy - wy * sy, yr = wx * sy + wy * cy; return [ox + xr * Zs, oy + (yr * sp - wz * cp) * Zs, yr * cp + wz * sp]; };
    // 바닥 판(그림자 자리)
    g.fillStyle = 'rgba(22,25,31,0.07)'; g.beginPath(); [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([a, b], k) => { const q = P(a, b, 0); k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fill();
    const SIDES = [{ id: 'px', n: [1, 0], d: [1, 0, 0] }, { id: 'nx', n: [-1, 0], d: [-1, 0, 0] }, { id: 'py', n: [0, 1], d: [0, 1, 0] }, { id: 'ny', n: [0, -1], d: [0, -1, 0] }]
      .filter((f) => f.n[0] * sy + f.n[1] * cy > 0.001)
      .map((f) => Object.assign(f, { lf: this.lightF(f.id, f.n[0] * cy - f.n[1] * sy, f.n[0] * sy + f.n[1] * cy) }));
    const N = this.VN, has = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < N && !!vox[this.vi(x, y, z)];
    const list = [];
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = vox[this.vi(x, y, z)]; if (c) list.push([x, y, z, c, P((x + 0.5) / N, (y + 0.5) / N, (z + 0.5) / N)[2]]); }
    list.sort((a, b) => a[4] - b[4]);
    const u = 1 / N, quad = (pts, col) => { g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 0.35; g.beginPath(); pts.forEach((q, k) => { const r = P(q[0], q[1], q[2]); k ? g.lineTo(r[0], r[1]) : g.moveTo(r[0], r[1]); }); g.closePath(); g.fill(); g.stroke(); };
    list.forEach(([x, y, z, c]) => {
      const x0 = x * u, x1 = x0 + u, y0 = y * u, y1 = y0 + u, z0 = z * u, z1 = z0 + u;
      SIDES.forEach((f) => {
        if (has(x + f.d[0], y + f.d[1], z)) return;
        const pts = f.id === 'px' ? [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] : f.id === 'nx' ? [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]]
          : f.id === 'py' ? [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] : [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
        quad(pts, this.scaleC(c, f.lf));
      });
      if (!has(x, y, z + 1)) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c);
    });
    const url = cv.toDataURL('image/png');
    if (this._voxImgs.size > 120) this._voxImgs.clear();
    this._voxImgs.set(sig, url);
    return url;
  }
  // 예시 커스텀 자재 (8³): 나무 울타리 · 삽 · 횃불(애니메이션)
  customMats() {
    const N = this.VN, empty = () => new Array(N * N * N).fill(null), r = this.rng(310);
    const put = (v, x, y, z, c) => { if (x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < N) v[this.vi(x, y, z)] = c; };
    const wood = () => this.tone('#a8784a', (r() - 0.5) * 22), dark = () => this.tone('#7a5232', (r() - 0.5) * 14);
    // 울타리: 양 끝 기둥(높이 6) + 가로대 2줄
    const fence = empty();
    [0, 7].forEach((x) => { for (let z = 0; z < 6; z++) put(fence, x, 4, z, z === 5 ? dark() : wood()); });
    [1, 3].forEach((z) => { for (let x = 1; x < 7; x++) put(fence, x, 4, z, wood()); });
    // 삽: 날(아래) · 자루 · 손잡이
    const shovel = empty();
    for (let z = 3; z < 8; z++) put(shovel, 3, 4, z, this.tone('#8a5a36', (r() - 0.5) * 16));
    [2, 4].forEach((x) => put(shovel, x, 4, 7, this.tone('#5f4128', (r() - 0.5) * 8)));
    for (let z = 0; z < 3; z++) for (let x = 2; x <= 4; x++) { if (z === 0 && x !== 3) continue; put(shovel, x, 4, z, this.tone(z === 2 ? '#6d7884' : '#aab4bf', (r() - 0.5) * 12)); }
    // 횃불: 막대(높이 1 ~ 4) + 불꽃(프레임마다 키 · 기울기)
    const torch = (k) => {
      const v = empty(), q = this.rng(400 + k);
      for (let z = 0; z < 4; z++) put(v, 3, 3, z, this.tone('#7a5232', (q() - 0.5) * 14));
      const H = [3, 4, 3, 4][k], lean = [0, 1, 0, -1][k];
      for (let z = 0; z < H; z++) {
        const x = z >= 2 ? 3 + Math.max(0, lean) : 3, y = z >= 2 ? 3 + Math.max(0, -lean) : 3;
        put(v, x, y, 4 + z, z === 0 ? '#fff1b0' : z === H - 1 ? '#e8582a' : '#ffb22e');
        if (z === 0) { put(v, 4, 3, 4, '#ff9a2a'); put(v, 3, 4, 4, '#ff9a2a'); }
      }
      return { vox: v };
    };
    const tf = new Array(16).fill(null); [0, 1, 2, 3].forEach((k) => { tf[k * 4] = torch(k); });
    return [
      { id: 'c1', name: '나무 울타리', set: '커스텀 자재', kind: 'custom', vox: fence },
      { id: 'c2', name: '삽', set: '커스텀 자재', kind: 'custom', vox: shovel },
      { id: 'c3', name: '횃불 (불꽃)', set: '커스텀 자재', kind: 'custom', type: 'anim', vox: tf[0].vox, frames: tf }
    ];
  }
  componentWillUnmount() { clearInterval(this._playT); }
  // 프레임 칸 그림: 작은 큐브(위 · 앞 · 오른쪽 면). 같은 그림은 한 번만 그린다
  thumb(faces) {
    if (typeof document === 'undefined') return '';
    if (faces && faces.vox) return this.voxImg(faces.vox, 48, 48, 45, this.fieldPitch(), 30, 24, 26);
    const key = faces.pz.join('') + faces.py.join('') + faces.px.join('');
    this._thumbs = this._thumbs || new Map();
    if (this._thumbs.has(key)) return this._thumbs.get(key);
    const cv = document.createElement('canvas'); cv.width = cv.height = 48;
    const g = cv.getContext('2d'), U = 22 / 8, V = 11 / 8;
    const face = (px, m, f) => { g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); px.forEach((c, k) => { g.fillStyle = this.scaleC(c, f); g.fillRect(k % 8, Math.floor(k / 8), 1.04, 1.04); }); };
    face(faces.pz, [U, V, -U, V, 24, 2], 1);
    face(faces.py, [U, V, 0, U, 2, 13], 0.82);
    face(faces.px, [U, -V, 0, U, 24, 24], 0.66);
    const url = cv.toDataURL('image/png');
    this._thumbs.set(key, url);
    return url;
  }
  copyFaces(f) { const o = {}; Object.keys(f).forEach((k) => { o[k] = f[k].slice(); }); return o; }

  // ───── 공용 (건물 편집기 · 노드 화면과 같은 코드) ─────
  geo() {
    const K = 38 / (80 * Math.sqrt(3) / 2);
    return { K, C: Math.sqrt(1 - K * K) };
  }
  fieldPitch() { return Math.asin(this.geo().K) * 180 / Math.PI; }
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

  tex(kind, seed) {
    const r = this.rng(seed), out = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      let c;
      if (kind === 'concrete') c = r() < 0.08 ? this.tone('#c4c7c3', -30) : this.tone('#c4c7c3', (r() - 0.5) * 18);
      else if (kind === 'brick') {
        const mortar = j === 3 || j === 7 || (j < 3 && i === 3) || (j > 3 && j < 7 && i === 7);
        c = mortar ? this.tone('#d9d2c7', (r() - 0.5) * 8) : this.tone('#b0603f', (r() - 0.5) * 24);
      } else if (kind === 'glass') {
        if (i === 0 || j === 0 || i === 7 || j === 7) c = '#4d6b7a';
        else if ((i + j === 5 || i + j === 6) && i > 1) c = '#d4ecf4';
        else c = this.tone('#8cc3d6', (r() - 0.5) * 8);
      } else if (kind === 'roof') c = this.tone('#505b6a', (j % 2 === 1 ? -18 : 0) + (r() - 0.5) * 10);
      else if (kind === 'wood') c = j === 2 || j === 5 ? '#6f4a2a' : this.tone('#a8784a', (r() - 0.5) * 20);
      else if (kind === 'grassTop') c = this.tone('#5aa85f', (r() - 0.5) * 26);
      else if (kind === 'grassSide') c = j < 2 && !(j === 1 && r() < 0.45) ? this.tone('#5aa85f', (r() - 0.5) * 20) : this.tone('#8a5a36', (r() - 0.5) * 20);
      else if (kind === 'dirt') c = this.tone('#8a5a36', (r() - 0.5) * 20);
      else if (kind === 'metal') {
        if ((i === 1 || i === 6) && (j === 1 || j === 6)) c = '#6d7884';
        else c = this.tone('#9ca7b2', (j === 0 || j === 7 ? -20 : 0) + (r() - 0.5) * 8);
      }
      else if (kind === 'flag') c = (j === 3 || j === 4) ? this.tone('#f4f7ff', (r() - 0.5) * 6) : this.tone('#2563eb', (i % 2 === j % 2 ? 8 : -6) + (r() - 0.5) * 8);
      else if (kind === 'pole') c = this.tone(i === 0 || i === 7 ? '#5f6772' : i < 4 ? '#c9d0d8' : '#9aa4b0', (r() - 0.5) * 6);
      // ── 집 짓기용 자재 (8×8 · 옆면은 j가 아래로) ──
      else if (kind === 'plaster') c = r() < 0.06 ? this.tone('#e6dcc6', -14) : this.tone('#efe6d2', (r() - 0.5) * 10);
      else if (kind === 'tile') c = j % 2 === 1 ? this.tone('#8f3a26', (r() - 0.5) * 8) : ((i + (j >> 1) * 2) % 4 === 0 ? this.tone('#a94a31', (r() - 0.5) * 8) : this.tone('#c85c3c', (r() - 0.5) * 14));
      else if (kind === 'slate') c = j % 2 === 1 ? this.tone('#33475f', (r() - 0.5) * 6) : ((i + (j >> 1) * 3) % 4 === 0 ? this.tone('#3e5776', (r() - 0.5) * 6) : this.tone('#4f6d91', (r() - 0.5) * 12));
      else if (kind === 'window') {
        if (j === 7) c = this.tone('#8a6a4a', (r() - 0.5) * 8);
        else if (i === 0 || i === 7 || j === 0 || j === 3) c = this.tone('#f4f1ea', (r() - 0.5) * 4);
        else if (i + j === 4 || i + j === 5 || i + j === 9) c = '#d6eef7';
        else c = this.tone('#6fa8c6', (r() - 0.5) * 8);
      } else if (kind === 'door') {
        if (i === 0 || i === 7 || j === 0) c = this.tone('#5e3b20', (r() - 0.5) * 6);
        else if (i === 5 && j === 4) c = '#e3bb4c';
        else if (i === 3) c = this.tone('#6e4526', (r() - 0.5) * 6);
        else c = this.tone('#935f35', (r() - 0.5) * 12);
      } else if (kind === 'stone') {
        const row = j >> 2, mortar = j % 4 === 3 || (i + row * 2) % 4 === 3;
        c = mortar ? this.tone('#6c6f72', (r() - 0.5) * 6) : this.tone('#a3a6a8', (r() - 0.5) * 22);
      } else if (kind === 'leaves') { const q = r(); c = q < 0.15 ? this.tone('#2d6a34', (r() - 0.5) * 10) : q < 0.3 ? this.tone('#67b86b', (r() - 0.5) * 10) : this.tone('#45944a', (r() - 0.5) * 16); }
      else if (kind === 'log') c = (i % 3 === 0) ? this.tone('#553621', (r() - 0.5) * 8) : this.tone('#7a5232', (r() - 0.5) * 14);
      else if (kind === 'logTop') { const d = Math.max(Math.abs(i - 3.5), Math.abs(j - 3.5)); c = d > 3 ? '#5a3a22' : (Math.floor(d) % 2 === 0 ? this.tone('#d8b27c', (r() - 0.5) * 6) : this.tone('#b98f5a', (r() - 0.5) * 6)); }
      else if (kind === 'awning') c = j === 7 ? ((i >> 1) % 2 ? '#a8332a' : '#d8cfc2') : ((i >> 1) % 2 ? this.tone('#d94c3d', (r() - 0.5) * 6) : this.tone('#fbf5ec', (r() - 0.5) * 4));
      else if (kind === 'flowers') { const q = r(); c = q < 0.1 ? '#f25f7a' : q < 0.18 ? '#ffd24a' : q < 0.23 ? '#ffffff' : q < 0.28 ? '#9b7bf2' : this.tone('#4f9e55', (r() - 0.5) * 22); }
      else if (kind === 'plank') c = j % 3 === 2 ? this.tone('#8a6038', (r() - 0.5) * 6) : ((i + j * 3) % 8 === 0 ? this.tone('#9c6f43', 0) : this.tone('#c39461', (r() - 0.5) * 14));
      else c = '#cccccc';
      out.push(c);
    }
    return out;
  }
  // ───── 애니메이션 자재 (노드 화면 · 건물 편집기 · 자재 편집기가 같은 코드) ─────
  // 모든 애니메이션은 1초 = 16칸(틱) 고정. frames = 칸 배열(길이 16 × 초), 빈 칸(null)은 앞 프레임을 그대로 보인다
  // 자재는 1초(16칸) 고정 · 필드 · 건물은 4초(64칸)까지. 1프레임 = 일반 타입
  lerpC(a, b, t) { const A = this.hexRgb(a), B = this.hexRgb(b); return this.rgbHex(A.map((v, i) => v + (B[i] - v) * t)); }
  animTex(kind, seed, k, n, id) {
    const r = this.rng(seed), out = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      let c;
      if (kind === 'flagWave') {
        // 깃발 천: 가로로 흐르는 물결(한 폭 = 8픽셀, 8프레임에 한 칸씩). 흰 띠는 물결 따라 오르내리고, 빛을 받는 비탈은 밝게 · 반대쪽은 어둡게
        const ph = (i / 8 - k / n) * Math.PI * 2, w = Math.sin(ph) * 1.25, lit = Math.cos(ph);
        const jj = j - Math.round(w), fold = Math.abs(lit) < 0.25 && j > 0 && j < 7;
        const base = (jj === 3 || jj === 4) ? '#f4f7ff' : (jj === 2 || jj === 5) ? '#9bb8f5' : '#2563eb';
        c = this.tone(base, lit * 20 - (fold ? 10 : 0) + (r() - 0.5) * 6);
      } else if (kind === 'beacon') {
        // 경광등: 불빛이 한 바퀴 돈다(8프레임). 옆면은 빛이 그 면을 지날 때 밝아지고, 윗면은 가운데 전구가 늘 빛난다
        const face = { px: 0, py: 90, nx: 180, ny: 270 }[id], beam = k / n * 360;
        const d = Math.hypot(i - 3.5, j - 3.5), frameC = i === 0 || i === 7 || j === 0 || j === 7;
        let on;
        if (face === undefined) on = 0.55 + 0.45 * Math.cos(k / n * Math.PI * 4);
        else { const dd = ((beam - face + 540) % 360) - 180; on = Math.pow(Math.max(0, Math.cos(dd * Math.PI / 180)), 3); }
        const sweep = face === undefined ? 0 : Math.max(0, 1 - Math.abs(i - 3.5 - (((beam - face + 540) % 360) - 180) / 30) / 2.5);
        c = frameC ? this.tone('#3a4049', (r() - 0.5) * 8)
          : d < 1.3 ? this.lerpC('#7a1a14', '#fff1ea', on)
          : d < 2.6 ? this.lerpC('#521612', '#ff5a4d', Math.min(1, on + sweep * 0.4))
          : this.lerpC('#3a1d1d', '#ff9a8a', Math.min(1, on * 0.55 + sweep * 0.5));
      } else c = '#cccccc';
      out.push(c);
    }
    return out;
  }
  animMats() {
    const fr = (kind, seed, n) => Array.from({ length: n }, (_, k) => { const f = {}; ['pz', 'nz', 'px', 'nx', 'py', 'ny'].forEach((id, q) => { f[id] = this.animTex(kind, seed + q, k, n, id); }); return f; });
    // 8프레임을 2칸마다 → 1초 16칸
    const slots = (list, step) => { const out = new Array(16).fill(null); list.forEach((f, k) => { out[k * step] = f; }); return out; };
    const wave = slots(fr('flagWave', 210, 8), 2), bea = slots(fr('beacon', 220, 8), 2);
    return [
      { id: 'm21', name: '깃발 천 (펄럭)', set: '애니메이션 자재', type: 'anim', faces: wave[0], frames: wave },
      { id: 'm22', name: '경광등', set: '애니메이션 자재', type: 'anim', faces: bea[0], frames: bea }
    ];
  }
  // 칸 i에 보이는 프레임의 칸 번호: i부터 거꾸로 첫 프레임 (빈 칸 = 앞 프레임 유지)
  holdAt(fr, i) { const n = fr.length; let k = ((i || 0) % n + n) % n; while (k > 0 && !fr[k]) k--; return k; }
  keyCount(fr) { return fr ? fr.filter(Boolean).length : 1; }
  // 자재의 칸 f에 보이는 6면 (프레임이 없으면 일반 자재)
  matFrame(m, f) { return m.frames && m.frames.length ? m.frames[this.holdAt(m.frames, f)] : m.faces; }
  makeMats() {
    const all = (kind, seed) => ({ pz: this.tex(kind, seed), nz: this.tex(kind, seed + 1), px: this.tex(kind, seed + 2), nx: this.tex(kind, seed + 3), py: this.tex(kind, seed + 4), ny: this.tex(kind, seed + 5) });
    const grass = Object.assign(all('grassSide', 60), { pz: this.tex('grassTop', 66), nz: this.tex('dirt', 67) });
    return [
      { id: 'm1', name: '콘크리트', set: '자재 1셋', faces: all('concrete', 10) },
      { id: 'm2', name: '벽돌', set: '자재 1셋', faces: all('brick', 20) },
      { id: 'm3', name: '유리', set: '자재 1셋', faces: all('glass', 30) },
      { id: 'm4', name: '지붕', set: '자재 1셋 / 자재 폴더', faces: all('roof', 40) },
      { id: 'm5', name: '목재', set: '자재 2셋', faces: all('wood', 50) },
      { id: 'm6', name: '잔디 블록', set: '자재 2셋', faces: grass },
      { id: 'm7', name: '금속', set: '자재 2셋', faces: all('metal', 70) },
      { id: 'm8', name: '깃발 천', set: '자재 2셋', faces: all('flag', 80) },
      { id: 'm9', name: '깃대', set: '자재 2셋', faces: all('pole', 90) },
      { id: 'm10', name: '회벽', set: '집 자재', faces: all('plaster', 100) },
      { id: 'm11', name: '기와', set: '집 자재', faces: all('tile', 110) },
      { id: 'm12', name: '슬레이트', set: '집 자재', faces: all('slate', 120) },
      { id: 'm13', name: '창문', set: '집 자재', faces: all('window', 130) },
      { id: 'm14', name: '나무 문', set: '집 자재', faces: all('door', 140) },
      { id: 'm15', name: '돌', set: '집 자재', faces: all('stone', 150) },
      { id: 'm16', name: '나뭇잎', set: '집 자재 / 조경', faces: all('leaves', 160) },
      { id: 'm17', name: '통나무', set: '집 자재 / 조경', faces: Object.assign(all('log', 170), { pz: this.tex('logTop', 176), nz: this.tex('logTop', 177) }) },
      { id: 'm18', name: '차양', set: '집 자재', faces: all('awning', 180) },
      { id: 'm19', name: '꽃밭', set: '집 자재 / 조경', faces: Object.assign(all('grassSide', 190), { pz: this.tex('flowers', 196) }) },
      { id: 'm20', name: '마루', set: '집 자재', faces: all('plank', 200) }
    ].concat(this.animMats(), this.customMats());
  }
  // 면마다 픽셀 무늬가 붙는 방향 (전개도의 가로 = U, 세로 = V)
  dirMap() {
    return {
      pz: { n: [0, 0, 1], c0: [0, 0, 1], U: [1, 0, 0], V: [0, 1, 0] },
      nz: { n: [0, 0, -1], c0: [1, 0, 0], U: [-1, 0, 0], V: [0, 1, 0] },
      py: { n: [0, 1, 0], c0: [0, 1, 1], U: [1, 0, 0], V: [0, 0, -1] },
      px: { n: [1, 0, 0], c0: [1, 1, 1], U: [0, -1, 0], V: [0, 0, -1] },
      ny: { n: [0, -1, 0], c0: [1, 0, 1], U: [-1, 0, 0], V: [0, 0, -1] },
      nx: { n: [-1, 0, 0], c0: [0, 0, 1], U: [0, 1, 0], V: [0, 0, -1] }
    };
  }
  lightF(id, nx, ny) {
    if (id === 'pz') return 1;
    const t = ((nx * -0.8 + ny * 0.6) + 1) / 2;
    return 0.55 + 0.45 * t;
  }

  // 커스텀 자재 화면 값 — 건물 편집기의 설계 화면과 같은 투시 · 조작 (블럭 = 색)
  voxVals(custom) {
    const S = this.state, N = this.VN;
    const off = { disp: 'none', tree: [], plate: [], faces: [], cube: [], rim: '', outline: '', cursor: 'default', total: '0', down: () => {}, move: () => {}, up: () => {}, leave: () => {}, ctx: () => {}, key: () => {}, cubeClick: () => {} };
    if (!custom || !S.vox) return off;
    const playing = S.playing, vox = playing && S.frames[S.pf] && S.frames[S.pf].vox ? S.frames[S.pf].vox : S.vox;
    const has = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < N && !!vox[this.vi(x, y, z)];
    const inB = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < N;
    // 투시: 건물 편집기와 같은 식 (판 폭 160 → 화면 3배)
    const s = 160 / N, cN = N / 2, ZS = 3.0, EX = 468, EY = 560;
    const ya = S.yaw * Math.PI / 180, pa = S.pitch * Math.PI / 180, cy = Math.cos(ya), sy = Math.sin(ya), sp = Math.sin(pa), cp = Math.cos(pa);
    const PW = (wx, wy, wz) => { const xr = wx * cy - wy * sy, yr = wx * sy + wy * cy; return [EX + xr * ZS, EY + (yr * sp - wz * cp) * ZS, yr * cp + wz * sp]; };
    const PG = (X, Y, Z) => PW((X - cN) * s, (Y - cN) * s, Z * s);
    const f = (v) => Math.round(v * 10) / 10, str = (arr) => arr.map((q) => f(q[0]) + ',' + f(q[1])).join(' ');
    const hover = S.vhover;
    const plate = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = x + ',' + y + ',0';
      plate.push({ pts: str([PG(x, y, 0), PG(x + 1, y, 0), PG(x + 1, y + 1, 0), PG(x, y + 1, 0)]), target: t, fill: hover === t && !has(x, y, 0) ? 'rgba(255,216,77,0.30)' : ((x + y) % 2 ? '#1c2028' : '#161a20') });
    }
    const sq = (k) => [[-k, -k], [N + k, -k], [N + k, N + k], [-k, N + k]];
    const rim = str(sq(0.35).map(([a, b]) => PG(a, b, 0))), outline = str(sq(0).map(([a, b]) => PG(a, b, 0)));
    const DM = this.dirMap(), ids = ['pz', 'px', 'nx', 'py', 'ny'];
    const cornersOf = (id, x, y, z) => ({
      pz: [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]],
      px: [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]],
      nx: [[x, y, z], [x, y + 1, z], [x, y + 1, z + 1], [x, y, z + 1]],
      py: [[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]],
      ny: [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]]
    }[id]);
    const faces = [];
    const pushCube = (x, y, z, col, ghost) => ids.forEach((id) => {
      const [dx, dy, dz] = DM[id].n;
      if (!ghost && has(x + dx, y + dy, z + dz)) return;
      if (id !== 'pz' && dx * sy + dy * cy <= 0.001) return;
      const pts = cornersOf(id, x, y, z).map((q) => PG(...q)), nb = [x + dx, y + dy, z + dz];
      const lf = this.lightF(id, DM[id].n[0] * cy - DM[id].n[1] * sy, DM[id].n[0] * sy + DM[id].n[1] * cy);
      faces.push({ pts: str(pts), fill: this.scaleC(col, lf), stroke: ghost ? '#ffd84d' : 'rgba(22,25,31,0.22)', sw: ghost ? 1.5 : 0.9, op: ghost ? (S.vplacing ? 0.85 : 0.6) : 1, pe: ghost ? 'none' : 'auto',
        target: inB(...nb) ? nb.join(',') : '', block: x + ',' + y + ',' + z, near: pts.reduce((a, q) => a + q[2], 0) / 4 + (ghost ? 0.01 : 0) });
    });
    let total = 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = vox[this.vi(x, y, z)]; if (c) { total++; pushCube(x, y, z, c, false); } }
    if (hover && !playing) { const [hx, hy, hz] = hover.split(',').map(Number); if (inB(hx, hy, hz) && !has(hx, hy, hz)) pushCube(hx, hy, hz, S.color, true); }
    faces.sort((a, b) => a.near - b.near);
    // 시점 큐브 (건물 편집기와 같음)
    const CPW = (x, y, z) => { const xr = x * cy - y * sy, yr = x * sy + y * cy; return [70 + xr * 40, 70 + (yr * sp - z * cp) * 40, yr * cp + z * sp]; };
    const cube = [
      { id: 'pz', label: 'T', n: [0, 0, 1], c: [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]] },
      { id: 'px', label: 'R', n: [1, 0, 0], c: [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]] },
      { id: 'nx', label: 'L', n: [-1, 0, 0], c: [[-.5, -.5, -.5], [-.5, .5, -.5], [-.5, .5, .5], [-.5, -.5, .5]] },
      { id: 'py', label: 'F', n: [0, 1, 0], c: [[-.5, .5, -.5], [.5, .5, -.5], [.5, .5, .5], [-.5, .5, .5]] },
      { id: 'ny', label: 'B', n: [0, -1, 0], c: [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]] }
    ].filter((q) => q.id === 'pz' || q.n[0] * sy + q.n[1] * cy > 0.02).map((q) => {
      const pts = q.c.map((p) => CPW(...p));
      return { id: q.id, label: q.label, pts: str(pts), lx: f(pts.reduce((a, p) => a + p[0], 0) / 4), ly: f(pts.reduce((a, p) => a + p[1], 0) / 4),
        fill: this.scaleC('#6a7486', this.lightF(q.id, q.n[0] * cy - q.n[1] * sy, q.n[0] * sy + q.n[1] * cy)), near: pts.reduce((a, p) => a + p[2], 0) / 4 };
    }).sort((a, b) => a.near - b.near);
    const cubeClick = (e) => {
      const g = e.target.closest ? e.target.closest('[data-face]') : null, id = g ? g.getAttribute('data-face') : '';
      const snap = { pz: { pitch: 88 }, py: { yaw: 0, pitch: 18 }, ny: { yaw: 180, pitch: 18 }, px: { yaw: 90, pitch: 18 }, nx: { yaw: 270, pitch: 18 } }[id];
      if (snap) this.setState(snap);
    };
    // 조작 — 건물 편집기와 같다: 좌클릭 끌기 회전 · 블록 좌클릭 제거 · 우클릭 누르고 있기 설치 준비 · 떼면 설치
    const setVox = (i, c) => { const cur = this.state.vox, arr = cur.slice(); if (arr[i] === c) return; arr[i] = c;
      const rec = c ? [c].concat(this.state.recent.filter((x) => x !== c)).slice(0, 8) : this.state.recent;
      this.setState({ vox: arr, saved: false, recent: rec, hist: this.state.hist.concat([cur]).slice(-40), vhover: null }); };
    const targetOf = (e) => { const hit = e.target && e.target.closest ? e.target.closest('[data-target]') : null; return hit ? hit.getAttribute('data-target') || null : null; };
    const down = (e) => {
      if (this.state.playing) { this.animPlay(false); return; }
      const root = e.currentTarget.closest ? e.currentTarget.closest('main') : null;
      if (root) { root.tabIndex = -1; root.focus({ preventScroll: true }); }
      if (e.button === 2) { this.setState({ vplacing: true, vhover: targetOf(e) }); return; }
      if (e.button !== 0) return;
      const hb = e.target.closest ? e.target.closest('[data-block]') : null;
      this.vdrag = { x: e.clientX, y: e.clientY, yaw: this.state.yaw, pitch: this.state.pitch, moved: false, block: hb ? hb.getAttribute('data-block') : '' };
    };
    const move = (e) => {
      const d = this.vdrag;
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        d.moved = true;
        this.setState({ yaw: d.yaw + dx * 0.45, pitch: Math.max(8, Math.min(88, d.pitch + dy * 0.3)) });
        return;
      }
      const t = targetOf(e);
      if (t !== this.state.vhover) this.setState({ vhover: t });
    };
    const up = (e) => {
      if (e.button === 2) {
        if (!this.state.vplacing) return;
        const t = this.state.vhover; this.setState({ vplacing: false });
        if (!t) return;
        const [x, y, z] = t.split(',').map(Number);
        if (!inB(x, y, z) || has(x, y, z)) return;
        setVox(this.vi(x, y, z), this.state.color);
        return;
      }
      const d = this.vdrag; this.vdrag = null;
      if (d && !d.moved && d.block) { const [x, y, z] = d.block.split(',').map(Number); setVox(this.vi(x, y, z), null); }
    };
    const leave = () => { this.vdrag = null; if (this.state.vhover || this.state.vplacing) this.setState({ vhover: null, vplacing: false }); };
    const key = (e) => {
      const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); const h = this.state.hist; if (h.length) this.setState({ vox: h[h.length - 1], hist: h.slice(0, -1), saved: false }); }
      else if (k === 'escape') this.setState({ vhover: null, vplacing: false });
    };
    return { disp: 'flex', tree: this.voxTree(), plate, faces, cube, rim, outline, cursor: this.vdrag && this.vdrag.moved ? 'grabbing' : 'crosshair', total: String(total), down, move, up, leave, ctx: (e) => e.preventDefault(), key, cubeClick };
  }
  // 왼쪽 자재 리스트 (셋 → 자재). 누르면 그 자재를 연다 — 큐브 자재를 고르면 큐브 자재 화면으로 돌아간다
  voxTree() {
    const S = this.state, out = [], sets = [];
    S.mats.forEach((m) => { if (sets.indexOf(m.set) < 0) sets.push(m.set); });
    sets.sort((a, b) => (a === '커스텀 자재' ? -1 : b === '커스텀 자재' ? 1 : 0));
    sets.forEach((st) => {
      out.push({ isSet: true, isMat: false, label: st });
      S.mats.filter((m) => m.set === st).forEach((m) => {
        const on = m.id === S.curId, custom = m.kind === 'custom', fr = this.keyCount(m.frames);
        const v = on && custom && S.vox ? S.vox : custom ? m.vox : null;
        let n = 0; if (v) for (let i = 0; i < v.length; i++) if (v[i]) n++;
        out.push({ isSet: false, isMat: true, label: m.name, img: custom ? this.voxImg(v, 30, 30, 45, this.fieldPitch(), 19, 15, 17) : this.thumb(on && !custom ? S.faces : m.faces),
          meta: custom ? '8³ · 블럭 ' + n + (fr > 1 ? ' · ' + fr + '프레임' : '') : '큐브 · 6면' + (fr > 1 ? ' · ' + fr + '프레임' : ''), playDisp: fr > 1 ? 'inline' : 'none',
          pressed: on ? 'true' : 'false', border: on ? '1px solid rgba(255,255,255,0.18)' : '1px solid transparent', bg: on ? 'rgba(255,255,255,0.09)' : 'transparent', fw: on ? 600 : 500, state: on ? '편집 중' : '',
          pick: () => { if (!on && this._pickMat) this._pickMat({ target: { value: m.id } }); } });
      });
    });
    return out;
  }
  renderVals() {
    const faces = this.state.faces, rsel = this.state.rsel;
    const CELL = 16, FACE = CELL * 8, GAP = 14, OX = 40, OY = 34;
    // 전개도: 옆면 띠 [오른쪽 · 뒤 · 왼쪽 · 앞], 앞 위에 윗면, 뒤 아래에 아랫면
    const layout = [
      { id: 'px', label: '오른쪽', col: 0, row: 1 },
      { id: 'ny', label: '뒤', col: 1, row: 1 },
      { id: 'nx', label: '왼쪽', col: 2, row: 1 },
      { id: 'py', label: '앞', col: 3, row: 1 },
      { id: 'pz', label: '위', col: 3, row: 0 },
      { id: 'nz', label: '아래', col: 1, row: 2 }
    ];
    const net = layout.map((L) => {
      const ox = OX + L.col * (FACE + GAP), oy = OY + L.row * (FACE + GAP);
      return {
        ox: ox - 2, oy: oy - 2, size: FACE + 4,
        ring: this.state.sel === L.id ? '#ffd84d' : 'rgba(255,255,255,0.06)',
        label: L.label + (this.state.sel === L.id ? ' · 선택' : ''),
        lx: ox + FACE / 2, ly: L.row === 2 ? oy + FACE + 18 : oy - 8,
        sx: rsel && rsel.id === L.id ? ox + Math.min(rsel.x0, rsel.x1) * CELL : 0, sy: rsel && rsel.id === L.id ? oy + Math.min(rsel.y0, rsel.y1) * CELL : 0,
        sw: rsel && rsel.id === L.id ? (Math.abs(rsel.x1 - rsel.x0) + 1) * CELL : 0, sh: rsel && rsel.id === L.id ? (Math.abs(rsel.y1 - rsel.y0) + 1) * CELL : 0,
        sop: rsel && rsel.id === L.id ? 1 : 0,
        px: faces[L.id].map((c, i) => ({ x: ox + (i % 8) * CELL, y: oy + Math.floor(i / 8) * CELL, c, key: L.id + ',' + i }))
      };
    });

    const pushHist = () => this.state.hist.concat([this.state.faces]).slice(-40);
    const setPx = (id, changes, keepHist) => {
      const cur = this.state.faces, arr = cur[id].slice();
      let changed = false;
      changes.forEach(([x, y, c]) => { if (x >= 0 && x < 8 && y >= 0 && y < 8 && arr[y * 8 + x] !== c) { arr[y * 8 + x] = c; changed = true; } });
      if (!changed) { if (this.state.sel !== id) this.setState({ sel: id }); return; }
      const rec = [this.state.color].concat(this.state.recent.filter((c) => c !== this.state.color)).slice(0, 8);
      this.setState({ faces: Object.assign({}, cur, { [id]: arr }), sel: id, saved: false, recent: rec, hist: keepHist ? this.state.hist : pushHist(), adj: null });
    };
    const spray = (p) => {
      const ch = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.random() < (dx || dy ? 0.3 : 0.7)) ch.push([p.x + dx, p.y + dy, this.state.color]);
      return ch;
    };
    const flood = (p) => {
      const arr = this.state.faces[p.id], target = arr[p.y * 8 + p.x];
      if (target === this.state.color) return [];
      const seen = new Set(), stack = [[p.x, p.y]], ch = [];
      while (stack.length) {
        const [x, y] = stack.pop();
        if (x < 0 || y < 0 || x >= 8 || y >= 8 || seen.has(y * 8 + x) || arr[y * 8 + x] !== target) continue;
        seen.add(y * 8 + x); ch.push([x, y, this.state.color]);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      return ch;
    };
    const parse = (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-px]') : null;
      if (!el) return null;
      const [id, si] = el.getAttribute('data-px').split(','), i = Number(si);
      return { id, x: i % 8, y: Math.floor(i / 8) };
    };
    const down = (e) => {
      const root = e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest('main') : null;
      if (root) { root.tabIndex = -1; root.focus({ preventScroll: true }); }
      const p = parse(e);
      if (!p) return;
      if (this.state.sel !== p.id && this.state.adj) this.setState({ adj: null });
      if (this.state.pasting) {
        const cb = this.state.clip, ch = [];
        for (let y = 0; y < cb.h; y++) for (let x = 0; x < cb.w; x++) ch.push([p.x + x, p.y + y, cb.px[y * cb.w + x]]);
        setPx(p.id, ch);
        this.setState({ pasting: false });
        return;
      }
      const tool = this.state.tool;
      if (tool === 'pick') { this.setState({ color: this.state.faces[p.id][p.y * 8 + p.x], tool: 'pen', sel: p.id }); return; }
      if (tool === 'select') { this.selecting = true; this.setState({ sel: p.id, rsel: { id: p.id, x0: p.x, y0: p.y, x1: p.x, y1: p.y } }); return; }
      if (tool === 'bucket') { setPx(p.id, flood(p)); return; }
      if (tool === 'fill') { const ch = []; for (let k = 0; k < 64; k++) ch.push([k % 8, Math.floor(k / 8), this.state.color]); setPx(p.id, ch); return; }
      this.painting = p.id;
      setPx(p.id, tool === 'spray' ? spray(p) : [[p.x, p.y, this.state.color]]);
    };
    const move = (e) => {
      const p = parse(e);
      if (!p) return;
      if (this.selecting) {
        const s = this.state.rsel;
        if (s && s.id === p.id && (s.x1 !== p.x || s.y1 !== p.y)) this.setState({ rsel: Object.assign({}, s, { x1: p.x, y1: p.y }) });
        return;
      }
      if (!this.painting) return;
      setPx(p.id, this.state.tool === 'spray' ? spray(p) : [[p.x, p.y, this.state.color]], true);
    };
    const up = () => { this.painting = null; this.selecting = false; };
    const copy = () => {
      const s = this.state.rsel;
      if (!s) return;
      const arr = this.state.faces[s.id];
      const x0 = Math.min(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), w = Math.abs(s.x1 - s.x0) + 1, h = Math.abs(s.y1 - s.y0) + 1, px = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.push(arr[(y0 + y) * 8 + x0 + x]);
      this.setState({ clip: { w, h, px } });
    };
    const fillSel = () => {
      const s = this.state.rsel;
      if (!s) return;
      const ch = [];
      for (let y = Math.min(s.y0, s.y1); y <= Math.max(s.y0, s.y1); y++) for (let x = Math.min(s.x0, s.x1); x <= Math.max(s.x0, s.x1); x++) ch.push([x, y, this.state.color]);
      setPx(s.id, ch);
    };
    const undo = () => {
      const h = this.state.hist;
      if (!h.length) return;
      if (this.state.kind === 'custom') { this.setState({ vox: h[h.length - 1], hist: h.slice(0, -1), saved: false }); return; }
      this.setState({ faces: h[h.length - 1], hist: h.slice(0, -1), adj: null, saved: false });
    };
    const key = (e) => {
      const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
      if (mod && k === 'c') { e.preventDefault(); copy(); }
      else if (mod && k === 'v') { e.preventDefault(); if (this.state.clip) this.setState({ pasting: true }); }
      else if (mod && k === 'z') { e.preventDefault(); undo(); }
      else if (k === 'escape') this.setState({ rsel: null, pasting: false });
    };

    // 미리보기 큐브 — 픽셀마다 사각형 하나
    const ya = this.state.yaw * Math.PI / 180, pa = this.state.pitch * Math.PI / 180;
    const cy = Math.cos(ya), sy = Math.sin(ya), sp = Math.sin(pa), cp = Math.cos(pa);
    const Z = 100, X0 = 150, Y0 = 150;
    const P = (x, y, z) => {
      const wx = x - 0.5, wy = y - 0.5, wz = z - 0.5;
      const xr = wx * cy - wy * sy, yr = wx * sy + wy * cy;
      return [X0 + xr * Z, Y0 + (yr * sp - wz * cp) * Z, yr * cp + wz * sp];
    };
    const f = (v) => Math.round(v * 10) / 10;
    const DM = this.dirMap();
    const vis = ['pz', 'px', 'nx', 'py', 'ny'].filter((id) => id === 'pz' || DM[id].n[0] * sy + DM[id].n[1] * cy > 0.001);
    const preview = [];
    const pvF = this.state.playing ? this.state.frames[this.state.pf] : null, pvFaces = pvF && !pvF.vox ? pvF : faces;   // 커스텀 자재는 큐브 미리보기를 쓰지 않는다
    if (this.state.kind !== 'custom') vis.forEach((id) => {
      const d = DM[id];
      const lf = this.lightF(id, d.n[0] * cy - d.n[1] * sy, d.n[0] * sy + d.n[1] * cy);
      pvFaces[id].forEach((c, k) => {
        const i = k % 8, j = Math.floor(k / 8);
        const at = (a, b) => P(d.c0[0] + d.U[0] * a + d.V[0] * b, d.c0[1] + d.U[1] * a + d.V[1] * b, d.c0[2] + d.U[2] * a + d.V[2] * b);
        const q = [at(i / 8, j / 8), at((i + 1) / 8, j / 8), at((i + 1) / 8, (j + 1) / 8), at(i / 8, (j + 1) / 8)];
        preview.push({ pts: q.map((p) => f(p[0]) + ',' + f(p[1])).join(' '), c: this.scaleC(c, lf) });
      });
    });
    const pDown = (e) => { this.orbit = { x: e.clientX, y: e.clientY, yaw: this.state.yaw, pitch: this.state.pitch }; };
    const pMove = (e) => {
      const o = this.orbit;
      if (!o) return;
      this.setState({ yaw: o.yaw + (e.clientX - o.x) * 0.5, pitch: Math.max(8, Math.min(88, o.pitch + (e.clientY - o.y) * 0.3)) });
    };
    const pUp = () => { this.orbit = null; };

    const PAL = ['#1b1f24', '#3a4049', '#5f6772', '#8a929c', '#b5bcc4', '#dde1e6', '#ffffff', '#f3efe6',
      '#5a2d1c', '#8a4b2d', '#b0603f', '#d08a5c', '#e8b98a', '#6f4a2a', '#a8784a', '#d6b37f',
      '#1f4d2b', '#2f7a41', '#5aa85f', '#9bd18b', '#1e3a5f', '#2e5f8a', '#4d8fc0', '#8cc3d6',
      '#4a2a5e', '#7b4fa0', '#b04a6a', '#d33d52', '#e0a23a', '#f2d15c', '#a65f00', '#4d6b7a'];
    const palette = PAL.map((hex) => ({
      hex,
      pressed: hex === this.state.color ? 'true' : 'false',
      border: hex === this.state.color ? '2px solid #0d0f13' : '1px solid rgba(255,255,255,0.10)',
      pick: () => this.setState({ color: hex, tool: this.state.tool === 'pick' ? 'pen' : this.state.tool })
    }));
    const TOOLS = [
      { id: 'pen', label: '연필', tip: '한 칸씩 · 끌면 이어서' },
      { id: 'spray', label: '스프레이', tip: '누른 채 끌면 주변에 흩뿌림' },
      { id: 'bucket', label: '페인트', tip: '이어진 같은 색을 한 번에' },
      { id: 'fill', label: '면 채우기', tip: '면 전체를 한 색으로' },
      { id: 'select', label: '범위 선택', tip: '끌어서 사각형 선택 (한 면 안에서)' },
      { id: 'pick', label: '스포이드', tip: '칸의 색을 가져옴' }
    ];
    const custom = this.state.kind === 'custom';
    const VTOOLS = [
      { id: 'pen', label: '블럭 놓기', tip: '칸에 지금 색 블럭 · 끌면 이어서' },
      { id: 'erase', label: '지우개', tip: '블럭을 빼서 빈 칸으로 · 끌면 이어서' },
      { id: 'bucket', label: '페인트', tip: '이 층에서 이어진 같은 칸(같은 색 또는 빈 칸)을 한 번에' },
      { id: 'fill', label: '층 채우기', tip: '이 층 256칸을 한 색으로' },
      { id: 'pick', label: '스포이드', tip: '칸의 색을 가져옴' }
    ];
    const tools = (custom ? VTOOLS : TOOLS).map((t) => ({
      label: t.label, tip: t.tip,
      pressed: this.state.tool === t.id ? 'true' : 'false',
      border: this.state.tool === t.id ? '1px solid #ede9e1' : '1px solid rgba(255,255,255,0.14)',
      bg: this.state.tool === t.id ? '#ede9e1' : 'rgba(255,255,255,0.04)',
      fw: this.state.tool === t.id ? 600 : 400,
      pick: () => this.setState({ tool: t.id, pasting: false })
    }));
    const sel = this.state.sel;
    const copyTo = (targets) => {
      const next = Object.assign({}, faces);
      targets.forEach((id) => { if (id !== sel) next[id] = faces[sel].slice(); });
      this.setState({ faces: next, saved: false, hist: pushHist(), adj: null });
    };
    // 색 한꺼번에 바꾸기 — 선택한 면, 또는 6면 전부
    const FACE_IDS = ['pz', 'nz', 'px', 'nx', 'py', 'ny'];
    const targets = this.state.adjAll ? FACE_IDS : [sel];
    const adj = this.state.adj, a = adj && adj.targets.join() === targets.join() ? adj : null, cur = a || { h: 0, s: 0, l: 0 };
    const applyAdj = (h, s, l) => {
      const base = a ? a.base : this.copyFaces(faces), next = Object.assign({}, faces);
      targets.forEach((id) => { next[id] = base[id].map((c) => this.shiftHsl(c, h, s, l)); });
      this.setState({ faces: next, adj: { targets, base, h, s, l }, saved: false, hist: a ? this.state.hist : pushHist() });
    };
    const HUES = [['빨강', 0], ['주황', 30], ['노랑', 50], ['초록', 125], ['청록', 180], ['파랑', 220], ['보라', 275], ['분홍', 330]];
    const hues = HUES.map(([name, hue]) => ({
      name, c: this.fromHsl(hue, 0.7, 0.55),
      pick: () => {
        const base = a ? a.base : faces;
        let xs = 0, ys = 0;
        targets.forEach((id) => base[id].forEach((c) => { const [hh, ss] = this.toHsl(c); xs += Math.cos(hh * Math.PI / 180) * ss; ys += Math.sin(hh * Math.PI / 180) * ss; }));
        let dh = Math.round((hue - Math.atan2(ys, xs) * 180 / Math.PI) / 2) * 2;
        dh = ((dh + 180) % 360 + 360) % 360 - 180;
        applyAdj(dh, cur.s, cur.l);
      }
    }));
    const tab = (label, on, pick) => ({ label, sel: on ? 'true' : 'false', bg: on ? '#ede9e1' : 'transparent', fg: on ? '#111111' : '#9aa1ab', fw: on ? 600 : 400, sh: on ? '0 1px 2px rgba(0,0,0,0.35)' : 'none', pick });
    const scopes = [tab('이 면', !this.state.adjAll, () => this.setState({ adjAll: false, adj: null })), tab('6면 전부', this.state.adjAll, () => this.setState({ adjAll: true, adj: null }))];
    const FACE_NAME = { px: '오른쪽', ny: '뒤', nx: '왼쪽', py: '앞', pz: '위', nz: '아래' };
    const selTxt = rsel ? '선택 ' + FACE_NAME[rsel.id] + ' ' + (Math.abs(rsel.x1 - rsel.x0) + 1) + '×' + (Math.abs(rsel.y1 - rsel.y0) + 1) : '';
    const clipTxt = this.state.clip ? '클립보드 ' + this.state.clip.w + '×' + this.state.clip.h : '';
    const status = this.state.pasting ? '붙여넣을 칸(왼쪽 위)을 클릭 · 다른 면에도 붙일 수 있음' : [selTxt, clipTxt].filter(Boolean).join(' · ');
    const mats = this.state.mats;
    // 저장할 자재 내용 (큐브 자재 = 6면 · 커스텀 자재 = 블럭)
    const body = (fr, anim) => custom ? { kind: 'custom', vox: fr[0].vox.slice(), frames: anim ? fr : null, type: anim ? 'anim' : 'basic' } : { faces: this.copyFaces(fr[0]), frames: anim ? fr : null, type: anim ? 'anim' : 'basic' };
    const save = () => {
      const fr = this.framesNow(), anim = this.state.anim && this.keyCount(fr) > 1;
      const next = mats.map((m) => m.id === this.state.curId ? Object.assign({}, m, { name: this.state.name }, body(fr, anim)) : m);
      this.setState({ mats: next, saved: true });
    };
    const saveAs = () => {
      const id = 'm' + (mats.length + 1) + 'x';
      const name = this.state.name + ' 사본';
      const cur = mats.find((m) => m.id === this.state.curId);
      const fr = this.framesNow(), anim = this.state.anim && this.keyCount(fr) > 1;
      this.setState({ mats: mats.concat([Object.assign({ id, name, set: cur ? cur.set : (custom ? '커스텀 자재' : '자재 1셋') }, body(fr, anim))]), curId: id, name, saved: true });
    };
    const newMat = () => {
      const blank = {};
      ['pz', 'nz', 'px', 'nx', 'py', 'ny'].forEach((k) => { blank[k] = new Array(64).fill('#c4c7c3'); });
      const id = 'm' + (mats.length + 1) + 'n';
      if (this.state.playing) this.animPlay(false);
      this.setState({ mats: mats.concat([{ id, name: '새 자재', set: '자재 1셋', faces: this.copyFaces(blank) }]), curId: id, name: '새 자재', kind: 'cube', tool: 'pen', faces: this._loadedRef = blank, frames: [this.copyFaces(blank)].concat(new Array(15).fill(null)), fi: 0, anim: false, confirmBasic: false, saved: true, hist: [], rsel: null, adj: null });
    };
    // 새 커스텀 자재: 빈 8³
    const newCustom = () => {
      const vox = new Array(this.VN ** 3).fill(null), id = 'c' + (mats.length + 1) + 'n';
      if (this.state.playing) this.animPlay(false);
      this.setState({ mats: mats.concat([{ id, name: '새 커스텀 자재', set: '커스텀 자재', kind: 'custom', vox: vox.slice() }]), curId: id, name: '새 커스텀 자재', kind: 'custom', tool: 'pen', vox: this._loadedRef = vox, layer: 0, frames: [{ vox: vox.slice() }].concat(new Array(15).fill(null)), fi: 0, anim: false, confirmBasic: false, saved: true, hist: [], rsel: null, adj: null, pasting: false });
    };
    const pickMat = (e) => {
      const m = mats.find((x) => x.id === e.target.value);
      if (!m) return;
      if (this.state.playing) this.animPlay(false);
      const fr = this.slotsOf(m);
      if (m.kind === 'custom') {
        // 커스텀 자재: 블럭이 있는 가장 낮은 층부터 보여 준다
        const v = fr[0].vox.slice(), z0 = 0;
        this.setState({ curId: m.id, name: m.name, kind: 'custom', tool: VTOOLS.some((t) => t.id === this.state.tool) ? this.state.tool : 'pen', vox: this._loadedRef = v, layer: z0, frames: fr, fi: 0, anim: this.keyCount(fr) > 1, confirmBasic: false, saved: true, hist: [], rsel: null, adj: null, pasting: false });
        return;
      }
      this.setState({ curId: m.id, name: m.name, kind: 'cube', tool: TOOLS.some((t) => t.id === this.state.tool) ? this.state.tool : 'pen', faces: this._loadedRef = this.copyFaces(fr[0]), frames: fr, fi: 0, anim: this.keyCount(fr) > 1, confirmBasic: false, saved: true, hist: [], rsel: null, adj: null });
    };
    this._pickMat = pickMat;   // 커스텀 화면의 자재 리스트가 쓴다
    const yawN = ((Math.round(this.state.yaw) % 360) + 360) % 360;
    return {
      name: this.state.name,
      setName: (e) => this.setState({ name: e.target.value, saved: false }),
      saveText: this.state.saved ? '저장됨' : '저장 안 됨',
      saveColor: this.state.saved ? '#3ecf8e' : '#f5b83d',
      save, saveAs, newMat, pickMat,
      curId: this.state.curId,
      // 2프레임 이상 = 애니메이션 자재: 목록에 ▶️
      matOptions: mats.map((m) => ({ id: m.id, label: (this.keyCount(m.frames) > 1 ? '▸ ' : '') + (m.kind === 'custom' ? '[커스텀] ' : '') + m.name + ' — ' + m.set, selected: m.id === this.state.curId })),
      an: this.animVals({ typeLabel: '자재', basicLabel: custom ? '일반' : '일반 자재', animLabel: custom ? '애니메이션' : '애니메이션 자재', thumb: (f) => this.thumb(f), copy: (f) => this.copyFrame(f), slotH: 46, maxLen: 1 }),
      newCustom, vx: this.voxVals(custom), matTree: custom ? [] : this.voxTree(),
      cubeFlex: custom ? 'none' : 'flex', cubeInline: custom ? 'none' : 'inline-block', cubeBlock: custom ? 'none' : 'block',
      kindLabel: custom ? '커스텀 · 8³' : '큐브 · 6면', kindBg: custom ? 'rgba(189,132,255,0.12)' : 'rgba(255,255,255,0.05)', kindFg: custom ? '#cfa8ff' : '#b4bac3',
      kindTip: custom ? '8 × 8 × 8 칸에 색 블럭을 쌓아 만드는 자재 — 울타리 · 작은 도구처럼 블럭보다 작은 물건' : '여섯 면에 8 × 8 픽셀을 그리는 블럭 자재',
      helpText: '면마다 8 × 8 픽셀 · 전개도를 접으면 큐브가 됩니다 (앞 위에 윗면, 뒤 아래에 아랫면) · 면을 누르면 그 면이 선택되고, 선택한 면의 기능은 오른쪽 팔레트 아래에 있습니다 · 단축키 Ctrl+C · Ctrl+V · Ctrl+Z · Esc',
      tools,
      copySides: () => copyTo(['px', 'ny', 'nx', 'py']),
      copyAll: () => copyTo(['pz', 'nz', 'px', 'ny', 'nx', 'py']),
      net, cell: CELL,
      netCursor: this.state.pasting ? 'copy' : this.state.tool === 'select' ? 'cell' : this.state.tool === 'pick' ? 'copy' : 'crosshair',
      down, move, up, key, copy, fillSel, undo, status,
      pasteMode: () => { if (this.state.clip) this.setState({ pasting: !this.state.pasting }); },
      pasteBorder: this.state.pasting ? '1px solid #ffd84d' : '1px solid rgba(255,255,255,0.18)',
      pasteBg: this.state.pasting ? 'rgba(255,216,77,0.14)' : 'rgba(255,255,255,0.04)',
      pasteColor: this.state.clip ? '#ede9e1' : '#5d646e',
      copyColor: rsel ? '#ede9e1' : '#5d646e',
      undoColor: this.state.hist.length ? '#ede9e1' : '#5d646e',
      faceLabel: FACE_NAME[sel] + ' 면',
      scopes, hues, adjH: cur.h, adjS: cur.s, adjL: cur.l,
      setH: (e) => applyAdj(Number(e.target.value), cur.s, cur.l),
      setS: (e) => applyAdj(cur.h, Number(e.target.value), cur.l),
      setL: (e) => applyAdj(cur.h, cur.s, Number(e.target.value)),
      commitAdj: () => this.setState({ adj: null }),
      cancelAdj: () => { if (a) { const next = Object.assign({}, this.state.faces); a.targets.forEach((id) => { next[id] = a.base[id]; }); this.setState({ faces: next, adj: null }); } },
      adjBtn: a ? '#ede9e1' : '#5d646e',
      color: this.state.color,
      setColor: (e) => this.setState({ color: e.target.value }),
      palette,
      recent: this.state.recent.map((hex) => ({ hex, pick: () => this.setState({ color: hex }) })),
      preview, pDown, pMove, pUp,
      yawLabel: yawN + '°',
      pitchLabel: Math.round(this.state.pitch) + '°',
      resetView: () => this.setState({ yaw: 45, pitch: this.fieldPitch() })
    };
  }
}
