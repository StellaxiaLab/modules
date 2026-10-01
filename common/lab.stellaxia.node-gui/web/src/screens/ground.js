// 그라운드 편집기 — 디자인 캔버스 원본 design/GroundEditor.dc.html 에서 옮긴 화면 로직 (tools/gen-pages.py로 다시 만든다)
// 데이터 연동 지점은 docs/api/frontend-api.md 참고
import { DCLogic } from '../runtime/dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    const skins = this.groundSkins();
    this.state = {
      skins, curId: skins[0].id, name: skins[0].name,
      data: this._loadedRef = this.dataOf(skins[0], skins[0].frames[0]),
      frames: skins[0].frames.map((f) => f ? this.copyFrame(f) : null), fi: 0, anim: this.keyCount(skins[0].frames) > 1, step: 2,
      playing: false, pf: 0, pt: 0, pg: -1, confirmBasic: false,
      color: '#93c775', tool: 'pen', recent: [], saved: true, rot: 0, shape: 'cluster', hist: []
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
    const S = this.state, fr = S.frames, len = fr.length, anim = S.anim, maxLen = opts.maxLen || 1, step = S.step || 4;
    const keys = fr.map((f, i) => this.slotFilled(i)), nKeys = keys.filter(Boolean).length;
    const tab = (label, on, pick, tip) => ({ label, tip: tip || '', on: on ? 'true' : 'false', bg: on ? '#ffffff' : 'transparent', fg: on ? '#16191f' : '#5b6472', fw: on ? 600 : 400, sh: on ? '0 1px 2px rgba(22,25,31,0.14)' : 'none', pick });
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
        border: on ? '2px solid #2563eb' : has ? '1px solid #b6c3d6' : '1px solid #e3e8ef',
        bg: has ? (img ? '#f7f8fa' : '#dde8fd') : (i % 4 === 0 ? '#f4f6f9' : '#fafbfc'),
        ring: head ? '0 0 0 2px #1f9d55' : 'none', numFg: on ? '#2563eb' : '#5b6472',
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
      slotFg: filledHere ? '#5b6472' : '#2563eb',
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
      dupFg: S.fi + step < len ? '#2563eb' : '#b6bfcc',
      fillLabel: filledHere ? '빈 칸으로' : '이 칸에 프레임 넣기',
      fillTip: filledHere ? (S.fi === 0 ? '칸 0은 비울 수 없습니다' : '이 칸의 프레임을 지워 앞 프레임이 이어지게') : '앞 프레임을 복사해 이 칸에 넣기',
      fill: edit(() => {
        const f = this.framesNow();
        if (filledHere) { if (S.fi === 0) return; f[S.fi] = null; }
        else f[S.fi] = opts.copy(f[this.heldIdx(f, S.fi)]);
        this.animGo(S.fi, f); this.setState({ saved: false });
      }),
      left: move(-1), right: move(1),
      leftFg: filledHere && S.fi > 0 ? '#16191f' : '#b6bfcc', rightFg: filledHere && S.fi < len - 1 && (S.fi > 0 || keys[1]) ? '#16191f' : '#b6bfcc',
      toggle: () => { if (nKeys < 2) return; this.animPlay(!S.playing); },
      playIcon: S.playing ? '❚❚' : '▶', playLabel: nKeys < 2 ? '프레임이 2개 이상이면 재생' : S.playing ? '멈춤' : '재생',
      playLine: S.playing ? '#1f9d55' : '#d8dde5', playBg: S.playing ? '#e8f6ee' : '#ffffff', playFg: nKeys < 2 ? '#b6bfcc' : S.playing ? '#1f7a4d' : '#16191f',
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

  // 프레임 = 16×16 되풀이 무늬(top) + (육각 통째면) 칸 전체 그림(hexTop). 타입 · 두께 색은 모든 프레임 공통
  copyFrame(f) { const o = { top: f.top.slice() }; if (f.hexTop) o.hexTop = f.hexTop.slice(); return o; }
  dataOf(sk, f) { return Object.assign({ edge: sk.edge, mode: sk.mode || 'tile' }, this.copyFrame(f)); }
  frameCur() { return this.copyFrame(this.state.data); }
  curRef() { return this.state.data; }
  frameLoad(f) { const D0 = this.state.data, data = Object.assign({ edge: D0.edge, mode: D0.mode }, this.copyFrame(f)); if (D0.mode === 'hex' && !data.hexTop) data.hexTop = this.gHexFromTile(data.top); this._loadedRef = data; return { data, hist: [] }; }
  keyCount(fr) { return fr ? fr.filter(Boolean).length : 1; }
  componentWillUnmount() { clearInterval(this._playT); }
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
  avgC(arr) { const s = [0, 0, 0]; arr.forEach((h) => this.hexRgb(h).forEach((v, i) => { s[i] += v; })); return this.rgbHex(s.map((v) => v / arr.length)); }
  pixRects(px, w, h) {
    const rects = [];
    for (let j = 0; j < h; j++) { let i = 0; while (i < w) { const c = px[j * w + i]; let k = i + 1; while (k < w && px[j * w + k] === c) k++; rects.push({ x: i, y: j, w: k - i + 0.04, h: 1.04, fill: c }); i = k; } }
    return rects;
  }
  // 노드 화면과 같은 투시 · 칸 배치 (필드 타일 모델에서 필요한 값만)
  tileModel() { const K = 38 / (80 * Math.sqrt(3) / 2), C = Math.sqrt(1 - K * K); return { K, C, P: (56 - 6) / C / 16 }; }
  cellXY(key) { const [c, r] = key.split('-').map(Number); return { cx: 183 + c * 130, cy: 150 + r * 92 + (c % 2 === 1 ? 46 : 0) }; }
  // ───── 그라운드: 높이가 0인 바닥 필드 (리전과 같은 높이 — 필드 바닥면) ─────
  // 리전(육각 칸)마다 깔 수 있고, 필드가 놓인 칸에는 늘 깔린다. 건물은 놓을 수 있지만 노드는 둘 수 없다
  // 스킨 = 윗면 16×16 무늬 + 가장자리 두께 색(edge). 애니메이션은 필드와 같은 칸 모델(1초 16칸 · 빈 칸은 앞 프레임) — 4초까지
  groundSkins() {
    const gen = (w, h, seed, fn) => { const r = this.rng(seed), out = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(fn(i, j, r)); return out; };
    const mix = (a, b, t) => { const A = this.hexRgb(a), B = this.hexRgb(b), u = Math.max(0, Math.min(1, t)); return this.rgbHex(A.map((v, q) => v + (B[q] - v) * u)); };
    const TAU = Math.PI * 2;
    const list = [
      { id: 'meadow', name: '풀밭', edge: '#5f8f48',
        top: gen(16, 16, 1101, (i, j, r) => { const q = r(); return q < 0.04 ? '#f3efb0' : q < 0.08 ? '#b9dc8e' : this.tone('#93c775', (r() - 0.5) * 18); }) },
      { id: 'sand', name: '모래', edge: '#cfad73',
        top: gen(16, 16, 1201, (i, j, r) => { const q = r(); return q < 0.05 ? '#fff6dc' : q < 0.09 ? '#d2b07a' : this.tone('#efdcb0', (r() - 0.5) * 12); }) },
      { id: 'gravel', name: '자갈', edge: '#85817a',
        top: gen(16, 16, 1301, (i, j, r) => { const q = r(); return q < 0.16 ? this.tone('#a9a59c', (r() - 0.5) * 18) : q < 0.26 ? '#8d897f' : this.tone('#c8c4bb', (r() - 0.5) * 10); }) },
      { id: 'soilg', name: '맨땅', edge: '#8b6440',
        top: gen(16, 16, 1501, (i, j, r) => { const q = r(); return q < 0.05 ? '#c79a6c' : q < 0.1 ? '#7b5331' : this.tone('#b08459', (r() - 0.5) * 14); }) },
      // 광장 (육각 통째 예시): 리전 한 칸을 한 장으로 — 가운데 원형 문양 · 바퀴살 · 둘레 포석
      (() => {
        const G = this.gHexGrid(), r0 = this.rng(1601), hexTop = [];
        for (let j = 0; j < G.GH; j++) for (let i = 0; i < G.GW; i++) {
          const x = i + 0.5 - G.GW / 2, y = (j + 0.5 - G.GH / 2) * 1.1, d = Math.hypot(x, y), a = Math.atan2(y, x), q = r0();
          const spoke = Math.abs(Math.sin(a * 4)) < 0.12 && d > 5 && d < 15;
          hexTop.push(d < 2.2 ? '#c98a1c' : d < 4 ? '#f0d58a' : spoke ? '#b9a27a' : Math.abs(d - 15.5) < 1 ? '#8f7c5c' : d < 15 ? this.tone('#e6d6b2', (q - 0.5) * 12)
            : ((i + (j >> 1)) % 4 === 0 || j % 3 === 0) ? this.tone('#a79e8f', (q - 0.5) * 8) : this.tone('#cdc4b3', (q - 0.5) * 14));
        }
        const top = gen(16, 16, 1602, (i, j, r) => this.tone('#cdc4b3', (r() - 0.5) * 14));
        return { id: 'plaza', name: '광장 (육각 통째)', edge: '#8f7c5c', mode: 'hex', top, frames: [{ top, hexTop }].concat(new Array(15).fill(null)) };
      })(),
      // 물가 모래 (애니메이션 예시): 젖은 모래 위로 얇은 물막이 비스듬히 밀려온다 — 8프레임을 2칸마다 (초당 8프레임), 16픽셀마다 한 바퀴라 이음매 없음
      (() => {
        const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({
          top: gen(16, 16, 1401, (i, j, r) => {
            const w = Math.sin(TAU * ((i + 2 * j) / 16 - k / 8)), n = r();
            return w > 0.9 ? '#f4fbfa' : w > 0.62 ? '#a8dcd6' : w > 0.45 ? '#cfe3d4' : mix('#d8bf8e', '#c7a877', n * 0.6);
          })
        }));
        const slots = new Array(16).fill(null); frames.forEach((f, k) => { slots[k * 2] = f; });
        return { id: 'tide', name: '물가 모래', edge: '#b8966a', top: frames[0].top, frames: slots };
      })()
    ];
    return list.map((s) => Object.assign({}, s, { frames: s.frames && s.frames.length ? s.frames : [{ top: s.top }].concat(new Array(15).fill(null)) }));
  }
  // 그라운드 윤곽: 칸마다 리전 격자의 보로노이 칸(= 리전보다 사방으로 리전 사이 간격의 절반만큼 큰 육각) 그대로 — 이웃 그라운드와 틈 · 겹침 없이 맞붙는다
  // 꼭짓점은 그 꼭짓점을 함께 쓰는 이웃 칸에 그라운드가 하나도 없을 때만 둥글게 깎는다 (이웃이 있는 곳은 곧은 이음 그대로 — 부드러운 이음 패딩 없음)
  // 칸 윤곽은 모두 같은 방향으로 돌아, 한 경로(path)에 모아 칠하면 맞닿은 변에 이음 선이 생기지 않는다. 칸 목록이 같으면 다시 계산하지 않는다
  groundGeo(keys) {
    const sig = keys.slice().sort().join(',');
    if (this._gg && this._gg.sig === sig) return this._gg;
    const K = this.tileModel().K, D = 56, RC = 18, SEG = 6;
    const f1 = (v) => Math.round(v * 10) / 10;
    const has = new Set(keys);
    const NB = [[0, 92 / K], [0, -92 / K], [130, 46 / K], [130, -46 / K], [-130, 46 / K], [-130, -46 / K]];
    // 보로노이 칸 (세계 좌표에서 이웃 6칸과의 수직 이등분선으로 자른 사각형) — 모든 칸이 같은 모양
    let cell = [[-200, -200], [200, -200], [200, 200], [-200, 200]];
    NB.forEach(([ax, ay]) => {
      const mx = ax / 2, my = ay / 2, inside = (p) => (p[0] - mx) * ax + (p[1] - my) * ay <= 0, out = [];
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i], b = cell[(i + 1) % cell.length], ia = inside(a), ib = inside(b);
        if (ia) out.push(a);
        if (ia !== ib) { const da = (a[0] - mx) * ax + (a[1] - my) * ay, db = (b[0] - mx) * ax + (b[1] - my) * ay, t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      cell = out;
    });
    // 꼭짓점마다 그 꼭짓점을 함께 쓰는 이웃 방향(2개)
    const shareOf = cell.map((v) => NB.map((n, i) => ({ i, d: Math.abs(Math.hypot(v[0] - n[0], v[1] - n[1]) - Math.hypot(v[0], v[1])) })).filter((o) => o.d < 1).map((o) => o.i));
    const nbKey = (c, r, i) => {
      // 세계 좌표 이웃 방향 → 칸 키 (홀수 열은 반 칸 아래)
      const odd = c % 2 === 1, [ax, ay] = NB[i], dc = ax > 0 ? 1 : ax < 0 ? -1 : 0;
      if (!dc) return c + '-' + (r + (ay > 0 ? 1 : -1));
      const dr = ay > 0 ? (odd ? 1 : 0) : (odd ? 0 : -1);
      return (c + dc) + '-' + (r + dr);
    };
    const cells = {};
    let all = '';
    keys.forEach((k) => {
      const [c, r] = k.split('-').map(Number), p = this.cellXY(k), cx = p.cx, cy = p.cy / K, n = cell.length, pts = [];
      cell.forEach((v, i) => {
        const lonely = !shareOf[i].some((j) => has.has(nbKey(c, r, j)));
        if (!lonely) { pts.push(v); return; }
        const a = cell[(i - 1 + n) % n], b = cell[(i + 1) % n];
        const cut = (q) => { const dx = q[0] - v[0], dy = q[1] - v[1], l = Math.hypot(dx, dy), t = Math.min(RC / l, 0.5); return [v[0] + dx * t, v[1] + dy * t]; };
        const s = cut(a), e = cut(b);
        for (let j = 0; j <= SEG; j++) { const t = j / SEG, u = 1 - t; pts.push([u * u * s[0] + 2 * u * t * v[0] + t * t * e[0], u * u * s[1] + 2 * u * t * v[1] + t * t * e[1]]); }
      });
      const d = 'M' + pts.map((q) => f1(cx + q[0]) + ' ' + f1((cy + q[1]) * K + D)).join(' L') + ' Z';
      cells[k] = d; all += d + ' ';
    });
    this._gg = { sig, d: all.trim(), cells };
    return this._gg;
  }
  // 그라운드 '육각 통째' 격자: 보로노이 칸(가로 ±92 · 세로 ±83.85, 세계 단위) 전체를 한 장으로 — GW × GH 칸, 칸 한 변 = P
  gHexGrid() { return { P: this.tileModel().P, GW: 50, GH: 46 }; }
  gHexIn(i, j) {
    const { P, GW, GH } = this.gHexGrid(), K = this.tileModel().K, x = Math.abs((i + 0.5 - GW / 2) * P), y = Math.abs((j + 0.5 - GH / 2) * P), m = P * 0.6;
    return y <= 46 / K + m && x * 130 + y * 46 / K <= (130 * 130 + (46 / K) * (46 / K)) / 2 + m * 154;
  }
  gHexFromTile(top) {
    const { GW, GH } = this.gHexGrid(), out = [], m = (v) => ((v % 16) + 16) % 16;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) out.push(top[m(j - GH / 2) * 16 + m(i - GW / 2)]);
    return out;
  }
  // 육각 통째 그림을 rot × 60° 돌린 칸 배열 (칸 중심을 거꾸로 돌려 원래 칸에서 읽는다 — 칸 밖이면 제자리 색)
  gHexRot(arr, rot) {
    if (!rot) return arr;
    const { GW, GH } = this.gHexGrid(), a = -rot * Math.PI / 3, c = Math.cos(a), s = Math.sin(a), K = this.tileModel().K, out = arr.slice();
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const x = i + 0.5 - GW / 2, y = (j + 0.5 - GH / 2), sx = Math.round(x * c - y * s - 0.5 + GW / 2), sy = Math.round(x * s + y * c - 0.5 + GH / 2);
      if (sx >= 0 && sx < GW && sy >= 0 && sy < GH && this.gHexIn(sx, sy)) out[j * GW + i] = arr[sy * GW + sx];
    }
    return out;
  }
  // 칸 배열 → 투명 바탕 PNG (육각 밖은 비움). 같은 그림은 다시 굽지 않는다
  gHexImg(arr) {
    if (typeof document === 'undefined') return '';
    const key = arr.join('');
    this._ghImg = this._ghImg || new Map();
    if (this._ghImg.has(key)) return this._ghImg.get(key);
    const { GW, GH } = this.gHexGrid(), cv = document.createElement('canvas'); cv.width = GW; cv.height = GH;
    const q = cv.getContext('2d');
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (this.gHexIn(i, j)) { q.fillStyle = arr[j * GW + i]; q.fillRect(i, j, 1, 1); }
    const url = cv.toDataURL('image/png');
    this._ghImg.set(key, url);
    return url;
  }
  // 그라운드 윗면 무늬 (세계 좌표에 고정 · 회전 rot × 60°): 한 스킨 · 회전 · 프레임마다 패턴 하나
  //   16×16 되풀이: 픽셀 사각형 무늬 · 육각 통째: 리전 격자 주기(가로 260 × 세로 92/K)의 무늬 한 장에 칸 그림 5장(가운데 · 네 모서리)을 놓는다
  groundPattern(sk, rot, k) {
    const M = this.tileModel(), K = M.K, P = M.P, a = rot * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a), f = (v) => Math.round(v * 1000) / 1000;
    const fr = sk.frames[k] || sk.frames[0], id = 'gp-' + sk.id + '-' + rot + '-' + k;
    if (sk.mode === 'hex' && fr.hexTop) {
      const G = this.gHexGrid(), href = this.gHexImg(this.gHexRot(fr.hexTop, rot)), w = G.GW * P, h = G.GH * P, TH = 92 / K;
      const imgs = [[0, 0], [260, 0], [0, TH], [260, TH], [130, TH / 2]].map(([x, y]) => ({ href, x: f(x - w / 2), y: f(y - h / 2), w: f(w), h: f(h) }));
      return { id, w: 260, h: f(TH), m: 'matrix(1 0 0 ' + f(K) + ' 183 206)', rects: [], imgs };
    }
    return { id, w: 16, h: 16, m: 'matrix(' + [P * ca, P * sa * K, -P * sa, P * ca * K, 0, 56].map(f).join(' ') + ')', rects: this.pixRects(fr.top, 16, 16), imgs: [] };
  }



  thumb(f0) {
    if (typeof document === 'undefined') return '';
    // 육각 통째면 가운데 16×16을 칸 그림으로
    const f = f0.hexTop && (f0.mode === 'hex' || (this.state && this.state.data && this.state.data.mode === 'hex')) ? { top: (() => { const G = this.gHexGrid(), o = [], x0 = (G.GW - 16) / 2, y0 = (G.GH - 16) / 2; for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) o.push(f0.hexTop[(y0 + j) * G.GW + x0 + i]); return o; })() } : f0;
    const key = f.top.join('');
    this._thumbs = this._thumbs || new Map();
    if (this._thumbs.has(key)) return this._thumbs.get(key);
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    f.top.forEach((c, i) => { g.fillStyle = c; g.fillRect(i % 16, Math.floor(i / 16), 1, 1); });
    const url = cv.toDataURL('image/png');
    this._thumbs.set(key, url);
    return url;
  }
  // 칠하기: 되풀이면 top(16×16), 육각 통째면 hexTop(50×46 — 칸 밖은 못 칠함)
  paint(i, first) {
    const S = this.state, hx = S.data.mode === 'hex', key = hx ? 'hexTop' : 'top', arr = S.data[key], W = hx ? this.gHexGrid().GW : 16, Hh = arr.length / W;
    const ok = (q) => !hx || this.gHexIn(q % W, Math.floor(q / W));
    if (!ok(i)) return;
    if (S.tool === 'pick') { this.setState({ color: arr[i], tool: 'pen' }); return; }
    const hist = first ? S.hist.concat([S.data]).slice(-40) : S.hist;
    const nt = arr.slice();
    if (S.tool === 'fill') {
      const from = arr[i]; if (from === S.color) return;
      const st = [i], seen = new Set();
      while (st.length) { const q = st.pop(); if (seen.has(q) || nt[q] !== from || !ok(q)) continue; seen.add(q); nt[q] = S.color; const x = q % W, y = (q - x) / W; if (x > 0) st.push(q - 1); if (x < W - 1) st.push(q + 1); if (y > 0) st.push(q - W); if (y < Hh - 1) st.push(q + W); }
    } else { if (nt[i] === S.color) return; nt[i] = S.color; }
    const recent = [S.color].concat(S.recent.filter((c) => c !== S.color)).slice(0, 16);
    this.setState({ data: Object.assign({}, S.data, { [key]: nt }), hist, saved: false, recent });
  }
  loadSkin(sk) {
    clearInterval(this._playT);
    const fr = sk.frames.map((f) => f ? this.copyFrame(f) : null), data = this.dataOf(sk, fr[0]);
    this._loadedRef = data;
    this.setState({ curId: sk.id, name: sk.name, data, frames: fr, fi: 0, anim: this.keyCount(fr) > 1, playing: false, hist: [], saved: true, confirmBasic: false });
  }
  renderVals() {
    const S = this.state;
    const shown = S.playing ? (S.frames[S.pf] || S.frames[0]) : S.data;
    // 미리보기 칸 배치
    const SHAPES = { cluster: ['1-1', '2-1', '1-2', '3-1', '2-2', '1-3', '3-2'], line: ['0-1', '1-1', '2-1', '3-1', '4-1'], ring: ['1-1', '2-0', '3-1', '3-2', '2-2', '1-2'] };
    const keys = SHAPES[S.shape] || SHAPES.cluster;
    const GG = this.groundGeo(keys), M = this.tileModel();
    const pts = keys.map((k) => this.cellXY(k));
    const x0 = Math.min(...pts.map((p) => p.cx)) - 140, x1 = Math.max(...pts.map((p) => p.cx)) + 140;
    const y0 = Math.min(...pts.map((p) => p.cy)) - 80, y1 = Math.max(...pts.map((p) => p.cy)) + 180;
    const sk = { id: 'pv', mode: S.data.mode, frames: [this.copyFrame(shown.hexTop || S.data.mode !== 'hex' ? shown : Object.assign({}, shown, { hexTop: this.gHexFromTile(shown.top) }))] }, pat = this.groundPattern(sk, S.rot, 0);
    const hexPts = (cx, cy) => [[-36, -38], [36, -38], [80, 0], [36, 38], [-36, 38], [-80, 0]].map((p) => (cx + p[0]) + ',' + (cy + 56 + p[1])).join(' ');
    const fk = keys[Math.floor(keys.length / 2)], fp = this.cellXY(fk);
    const pv = {
      vb: [x0, y0, x1 - x0, y1 - y0].join(' '), d: GG.d, m: pat.m, rects: pat.rects, imgs: pat.imgs || [], pw: pat.w, ph: pat.h, edge: S.data.edge,
      regions: keys.map((k) => { const p = this.cellXY(k); return { pts: hexPts(p.cx, p.cy), op: 0.55 }; }),
      fieldT: 'translate(' + fp.cx + ' ' + fp.cy + ')',
      fieldTop: '-36,-38 36,-38 80,0 36,38 -36,38 -80,0',
      fieldSide: '-80,0 -36,38 36,38 80,0 80,56 36,94 -36,94 -80,56'
    };
    const hxm = S.data.mode === 'hex', GH = this.gHexGrid(), PW = hxm ? GH.GW : 16, PS = hxm ? 7 : 24, parr = hxm ? (shown.hexTop || S.data.hexTop) : shown.top;
    const px = parr.map((c, i) => { const x = i % PW, y = Math.floor(i / PW); return { i: String(i), x: 2 + x * PS, y: 2 + y * PS, s: PS, c, op: !hxm || this.gHexIn(x, y) ? 1 : 0.25 }; });
    // 패턴 타입 바꾸기: 육각 통째로 가면 지금 16×16 무늬를 칸 한 장으로 옮겨 시작 (모든 프레임). 되풀이로 돌아가도 육각 그림은 남겨 둔다
    const setMode = (m) => {
      if (S.data.mode === m) return;
      if (S.playing) this.animPlay(false);
      const conv = (f) => f && m === 'hex' && !f.hexTop ? Object.assign({}, f, { hexTop: this.gHexFromTile(f.top) }) : f;
      const data = Object.assign({}, conv(S.data), { mode: m });
      this._loadedRef = this._loadedRef === S.data ? data : this._loadedRef;
      this.setState({ data, frames: S.frames.map(conv), hist: S.hist.concat([S.data]).slice(-40), saved: false });
    };
    const at = (e) => { const t = e.target && e.target.getAttribute ? e.target.getAttribute('data-px') : null; return t === null ? -1 : Number(t); };
    const PAL = ['#93c775', '#6fae55', '#4f8f3f', '#b9dc8e', '#f3efb0', '#e8d9a0', '#efdcb0', '#d2b07a', '#c7a877', '#a8744a', '#8b6440', '#6e4424', '#c8c4bb', '#a9a59c', '#8d897f', '#6b675f',
      '#f4fbfa', '#a8dcd6', '#6fbfd0', '#3f8fb0', '#ffffff', '#d9dee6', '#9aa3ae', '#3a4049', '#e8a0a0', '#d86a5a', '#f0b442', '#ffd88a', '#b6a1e0', '#7d67c8', '#1f9d55', '#16191f'];
    return {
      curId: S.curId, name: S.name,
      skinOptions: S.skins.map((k) => ({ id: k.id, label: k.name + (this.keyCount(k.frames) > 1 ? ' ▶' : '') })),
      pickSkin: (e) => { const k = S.skins.find((x) => x.id === e.target.value); if (k) this.loadSkin(k); },
      setName: (e) => this.setState({ name: e.target.value, saved: false }),
      saveText: S.saved ? '저장됨' : '저장 안 됨', saveColor: S.saved ? '#1f7a4d' : '#a65f00',
      save: () => {
        const fr = this.framesNow(), sk = { id: S.curId, name: S.name, edge: S.data.edge, mode: S.data.mode, top: fr[0].top, frames: S.anim ? fr : [fr[0]].concat(new Array(15).fill(null)) };
        this.setState({ skins: S.skins.map((k) => k.id === S.curId ? sk : k), frames: fr, saved: true });
      },
      saveAs: () => {
        const fr = this.framesNow(), id = 'g' + Date.now().toString(36), sk = { id, name: S.name + ' 사본', edge: S.data.edge, mode: S.data.mode, top: fr[0].top, frames: fr };
        this.setState({ skins: S.skins.concat([sk]), curId: id, name: sk.name, frames: fr, saved: true });
      },
      newSkin: () => { const top = new Array(256).fill('#93c775'); this.loadSkin({ id: 'g' + Date.now().toString(36), name: '새 그라운드', edge: '#5f8f48', mode: 'tile', frames: [{ top }].concat(new Array(15).fill(null)) }); this.setState({ saved: false }); },
      rotDeg: String(S.rot * 60), rotate: () => this.setState({ rot: (S.rot + 1) % 6 }),
      shapes: [['cluster', '뭉치'], ['line', '한 줄'], ['ring', '고리']].map(([id, label]) => ({ label, on: S.shape === id ? 'true' : 'false', bg: S.shape === id ? '#ffffff' : 'transparent', fw: S.shape === id ? 600 : 400, pick: () => this.setState({ shape: id }) })),
      pv,
      an: this.animVals({ typeLabel: '그라운드', basicLabel: '일반 그라운드', animLabel: '애니메이션 그라운드', thumb: (f) => this.thumb(f), copy: (f) => this.copyFrame(f), slotH: 40, slotHM: 30, slotHS: 22, maxLen: 4 }),
      frameNote: S.anim ? '칸 ' + (S.fi + 1) + '의 프레임' : '일반 (프레임 하나)',
      gridLabel: hxm ? GH.GW + ' × ' + GH.GH : '16 × 16',
      modes: [['tile', '16×16 반복', '16×16 무늬를 세계 좌표에 되풀이 — 이웃 칸과 이음매 없이 이어짐'], ['hex', '육각 통째', '리전 한 칸(보로노이 칸) 전체를 한 장으로 — 칸마다 같은 그림이 놓임']].map(([id, label, tip]) => ({ label, tip, on: S.data.mode === id ? 'true' : 'false', bg: S.data.mode === id ? '#ffffff' : 'transparent', fg: S.data.mode === id ? '#16191f' : '#5b6472', fw: S.data.mode === id ? 600 : 400, sh: S.data.mode === id ? '0 1px 2px rgba(22,25,31,0.14)' : 'none', pick: () => setMode(id) })),
      modeHint: hxm ? '칸 전체를 한 장으로 — 흐린 칸은 칸 밖(이웃 칸 자리). 회전하면 그림이 칸 중심으로 돈다' : '16칸마다 되풀이 — 가장자리가 이어지게 그리세요',
      px,
      down: (e) => { if (S.playing) this.animPlay(false); const i = at(e); if (i < 0) return; this._drawing = true; this.paint(i, true); },
      move: (e) => { if (!this._drawing || this.state.tool !== 'pen') return; const i = at(e); if (i >= 0) this.paint(i, false); },
      up: () => { this._drawing = false; },
      edge: S.data.edge,
      edgeFromColor: () => this.setState({ data: Object.assign({}, S.data, { edge: S.color }), saved: false }),
      edgeAuto: () => this.setState({ data: Object.assign({}, S.data, { edge: this.scaleC(this.avgC(S.data.top), 0.78) }), saved: false }),
      tools: [['pen', '펜', '한 칸씩 칠하기 (끌면 이어서)'], ['fill', '채우기', '같은 색으로 이어진 칸을 한 번에'], ['pick', '스포이드', '누른 칸의 색을 고르기']].map(([id, label, tip]) => ({ label, tip, pressed: S.tool === id ? 'true' : 'false', border: S.tool === id ? '2px solid #2563eb' : '1px solid #d8dde5', bg: S.tool === id ? '#e6eefc' : '#ffffff', fw: S.tool === id ? 600 : 400, pick: () => this.setState({ tool: id }) })),
      undo: () => { if (!S.hist.length) return; this.setState({ data: S.hist[S.hist.length - 1], hist: S.hist.slice(0, -1) }); },
      undoColor: S.hist.length ? '#16191f' : '#b6bfcc',
      shiftPx: () => { if (S.data.mode === 'hex') return; const t = S.data.top, nt = t.map((_, i) => { const x = i % 16, y = (i - x) / 16; return t[((y + 15) % 16) * 16 + (x + 15) % 16]; }); this.setState({ data: Object.assign({}, S.data, { top: nt }), hist: S.hist.concat([S.data]).slice(-40), saved: false }); },
      status: S.playing ? '재생 중 — 칸을 누르면 멈추고 그 칸으로' : S.tool === 'fill' ? '누른 칸과 이어진 같은 색을 모두 칠합니다' : S.tool === 'pick' ? '색을 고를 칸을 누르세요' : '누르거나 끌어서 칠하기. 무늬는 16칸마다 되풀이되니 가장자리가 이어지게 그리세요',
      color: S.color, setColor: (e) => this.setState({ color: e.target.value }),
      palette: PAL.map((hex) => ({ hex, pressed: hex === S.color ? 'true' : 'false', border: hex === S.color ? '2px solid #2563eb' : '1px solid rgba(22,25,31,0.15)', pick: () => this.setState({ color: hex, tool: S.tool === 'pick' ? 'pen' : S.tool }) })),
      recent: S.recent.map((hex) => ({ hex, pick: () => this.setState({ color: hex }) })),
      skinList: S.skins.map((k) => ({ name: k.name, img: this.thumb(k.id === S.curId ? S.data : Object.assign({ mode: k.mode }, k.frames[0])), on: k.id === S.curId ? 'true' : 'false', border: k.id === S.curId ? '2px solid #2563eb' : '1px solid #d8dde5', fw: k.id === S.curId ? 600 : 400, playDisp: this.keyCount(k.frames) > 1 ? 'inline' : 'none', pick: () => this.loadSkin(k) }))
    };
  }
}
