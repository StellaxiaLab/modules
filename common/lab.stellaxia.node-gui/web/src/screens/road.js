// 도로 편집기 — 디자인 캔버스 원본 design/RoadEditor.dc.html 에서 옮긴 화면 로직 (module 변형 · tools/gen-pages.py로 다시 만든다)
// 데이터를 바꿔 끼우는 곳은 src/boot/module.js · src/data/*.js — 이 파일은 손으로 고치지 않는다
import { DCLogic } from '../runtime/dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.MATS = this.makeMats().concat(this.animMats());
    const bps = this.loadRoads();
    this.state = {
      bps,
      cur: 0,
      N: bps[0].N,
      blocks: this._loadedRef = bps[0].blocks.map((b) => b.slice()),
      // 애니메이션: 프레임 = 블록 배치 한 벌. 주기 1~4초 · 초당 최대 16프레임. 재생 중엔 pf(프레임) · pt(틱)로 그린다
      frames: this.bpFrames(bps[0]), fi: 0, anim: this.keyCount(bps[0].frames) > 1, step: 2,
      playing: false, pf: 0, pt: 0, pg: -1, confirmBasic: false,
      yaw: 45,
      pitch: this.fieldPitch(),
      active: 'm1',
      hover: null,
      dragging: false,
      exported: null,
      saved: true,
      sets: this.matSets(),
      folderOpen: { '자재 폴더': true },
      dropped: 0,
      orient: 0,
      placing: false,
      bpSets: this.bpSets(bps),
      bpOpen: {},
      hub: Object.assign({}, bps[0].hub), mask: 63, ghost: true, exportNote: '', noteC: '#9aa1ab',
      bpDrag: null,
      note: '',
      // 이벤트: ev = 지금 편집 중인 것('base' = 기본 모습) · evs = 이벤트별 디자인 · custom = 사용자 이벤트 · baseD = 이벤트를 고치는 동안 맡아 둔 기본 모습
      ev: 'base', evs: Object.assign({}, bps[0].events || {}), custom: (bps[0].customEvents || []).slice(), baseD: null, evNew: null
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
    const tab = (label, on, pick, tip) => ({ label, tip: tip || '', on: on ? 'true' : 'false', bg: on ? '#ede9e1' : 'transparent', fg: on ? '#111111' : '#9aa1ab', fw: on ? 600 : 400, sh: 'none', pick });
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
        border: on ? '2px solid #ffd84d' : has ? '1px solid rgba(255,255,255,0.24)' : '1px solid rgba(255,255,255,0.07)',
        bg: has ? (img ? '#1b1f26' : 'rgba(255,255,255,0.16)') : (i % 4 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.025)'),
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
      dupFg: S.fi + step < len ? '#ffd84d' : '#6b7280',
      fillLabel: filledHere ? '빈 칸으로' : '이 칸에 프레임 넣기',
      fillTip: filledHere ? (S.fi === 0 ? '칸 0은 비울 수 없습니다' : '이 칸의 프레임을 지워 앞 프레임이 이어지게') : '앞 프레임을 복사해 이 칸에 넣기',
      fill: edit(() => {
        const f = this.framesNow();
        if (filledHere) { if (S.fi === 0) return; f[S.fi] = null; }
        else f[S.fi] = opts.copy(f[this.heldIdx(f, S.fi)]);
        this.animGo(S.fi, f); this.setState({ saved: false });
      }),
      left: move(-1), right: move(1),
      leftFg: filledHere && S.fi > 0 ? '#ede9e1' : '#4b5260', rightFg: filledHere && S.fi < len - 1 && (S.fi > 0 || keys[1]) ? '#ede9e1' : '#4b5260',
      toggle: () => { if (nKeys < 2) return; this.animPlay(!S.playing); },
      playIcon: S.playing ? '❚❚' : '▶', playOn: !!S.playing, playOff: !S.playing, playLabel: nKeys < 2 ? '프레임이 2개 이상이면 재생' : S.playing ? '멈춤' : '재생',
      playLine: S.playing ? 'rgba(62,207,142,0.55)' : 'rgba(255,255,255,0.18)', playBg: S.playing ? 'rgba(62,207,142,0.12)' : 'rgba(255,255,255,0.04)', playFg: nKeys < 2 ? '#4b5260' : S.playing ? '#3ecf8e' : '#ede9e1',
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
  // ───── 이벤트 (건물 · 도로 공통) — 동작 · 대기 · 정지 · 실패 + 사용자 이벤트 + 도로 방향(들어옴 · 나감 · 양방향) ─────
  //   이벤트마다 디자인 한 벌(블록 · 프레임 · 합류). 디자인이 없는 이벤트는 맵에서 기본 모습에 효과를 입힌다
  evtCommonE() { return [{ id: 'run', name: '동작', c: '#3ecf8e' }, { id: 'wait', name: '대기', c: '#f5b83d' }, { id: 'stop', name: '정지', c: '#9aa1ab' }, { id: 'fail', name: '실패', c: '#ff5d5d' }]; }
  evtDirsE() { return [{ id: 'dir-in', name: '들어옴', c: '#7aa7ff', ico: 'M12 4v12M6 10l6 6 6-6M4 20h16' }, { id: 'dir-out', name: '나감', c: '#b48cff', ico: 'M12 16V4M6 10l6-6 6 6M4 20h16' }, { id: 'dir-both', name: '양방향', c: '#3ec6d6', ico: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7' }]; }
  evCurD() {
    const fr = this.framesNow(), anim = this.state.anim && (this.keyCount(fr) > 1 || fr.length > 16);
    const d = { blocks: fr[0].map((b) => b.slice()), frames: anim ? fr.map((f) => (f ? f.map((b) => b.slice()) : null)) : null, period: anim ? fr.length / 16 : 1 };
    d.hub = Object.assign({}, this.state.hub);
    return d;
  }
  evNorm(d) { return JSON.stringify([d.blocks || [], d.frames || null, d.hub || null]); }
  // 지금 칸들을 그 자리(기본 / 이벤트)에 되돌려 넣는다. 아직 디자인이 없는 이벤트는 고쳤을 때만 생긴다
  evCommit() {
    const S = this.state, cur = this.evCurD(), evs = Object.assign({}, S.evs || {});
    const base = S.ev === 'base' ? cur : (S.baseD || cur);
    if (S.ev !== 'base' && (evs[S.ev] || this.evNorm(cur) !== this._evSnap)) evs[S.ev] = cur;
    return { base, evs };
  }
  evLoad(id, base, evs) {
    const d = id === 'base' ? base : (evs[id] || base);
    const fr = d.frames && d.frames.length ? d.frames.map((f) => (f ? f.map((b) => b.slice()) : null)) : [(d.blocks || []).map((b) => b.slice())].concat(new Array(15).fill(null));
    this._evSnap = this.evNorm({ blocks: fr[0], frames: d.frames && d.frames.length && (this.keyCount(fr) > 1 || fr.length > 16) ? fr : null, hub: Object.assign({}, base.hub, d.hub || {}) });
    this.setState(Object.assign({ ev: id, evs, baseD: id === 'base' ? null : base, frames: fr, fi: 0, anim: this.keyCount(fr) > 1, confirmBasic: false, hover: null }, this.frameLoad(fr[0]), { hub: Object.assign({}, base.hub, d.hub || {}) }));
  }
  evSwitch(id) {
    if (this.state.playing) this.animPlay(false);
    if (id === this.state.ev) return;
    const r = this.evCommit();
    this.evLoad(id, r.base, r.evs);
  }
  // 이벤트 디자인 지우기 (공통 · 방향 = 디자인만 지워 기본 모습 사용 · 사용자 이벤트 = 이벤트째 삭제)
  evDrop(id) {
    const r = this.evCommit(), evs = Object.assign({}, r.evs); delete evs[id];
    const custom = this.state.custom.filter((c) => c.id !== id);
    this.setState({ custom, saved: false, note: '' });
    this.evLoad('base', r.base, evs);
  }
  evAdd(name) {
    const nm = String(name || '').trim(); if (!nm) { this.setState({ evNew: null }); return; }
    const id = 'c-' + Date.now().toString(36), r = this.evCommit();
    this.setState({ custom: this.state.custom.concat([{ id, name: nm }]), evNew: null, saved: false });
    this.evLoad(id, r.base, r.evs);
  }
  evBar() {
    const S = this.state, evs = S.evs || {}, modified = S.ev !== 'base' && !evs[S.ev] && this._evSnap && this.evNorm(this.evCurD()) !== this._evSnap;
    const has = (id) => id === 'base' || !!evs[id] || (id === S.ev && modified);
    const chip = (e, grp) => { const on = S.ev === e.id, d = has(e.id);
      return { id: e.id, ico: e.ico || '', label: (e.g ? e.g + ' ' : '') + e.name, grp, on: on ? 'true' : 'false', bg: on ? '#ede9e1' : d ? (e.c && e.c.length === 7 ? e.c + '1a' : 'rgba(255,255,255,0.05)') : 'transparent', fg: on ? '#111111' : d ? (e.c || '#ede9e1') : '#6b7280',
        line: on ? '#ede9e1' : d ? (e.c ? e.c + '80' : 'rgba(255,255,255,0.18)') : 'rgba(255,255,255,0.14)', style: d ? 'solid' : 'dashed', dot: on && e.id === 'base' ? '#111111' : (e.c || '#ede9e1'), dotOp: d ? 1 : 0.35, tip: e.name + (d ? ' — 디자인 있음' : ' — 디자인 없음 (기본 모습 + 효과)'), pick: () => this.evSwitch(e.id) }; };
    const all = [chip({ id: 'base', name: '기본', c: '#b4bac3' }, 'base')].concat(this.evtCommonE().map((e) => chip(e, 'common')), this.evtDirsE().map((e) => chip(e, 'dir')), S.custom.map((e) => chip(Object.assign({ c: '#ff6ca2' }, e), 'custom')));
    const cur = all.find((c) => c.id === S.ev) || all[0], isCustom = S.custom.some((c) => c.id === S.ev), isDir = /^dir-/.test(S.ev);
    const info = S.ev === 'base' ? '기본 모습 — 이벤트에 디자인이 없으면 이 모습에 효과(대기 = 호박빛 · 정지 = 잿빛 · 실패 = 붉은 깜빡임)를 입힌다'
      : has(S.ev) ? cur.label + ' 디자인' + (isDir ? ' — 흐름이 그 방향인 팔만 이 모습 (합류는 기본)' : ' — 이 상태일 때 맵에서 이 모습')
      : cur.label + ' — 아직 디자인이 없다. 기본 모습을 복사해 보여 주는 중 · 고치면 이 이벤트 디자인이 생긴다';
    return {
      common: all.filter((c) => c.grp === 'base' || c.grp === 'common'), dirs: all.filter((c) => c.grp === 'dir'), custom: all.filter((c) => c.grp === 'custom'),
      dirDisp: 'flex', info, infoC: S.ev === 'base' ? '#9aa1ab' : has(S.ev) ? '#3ecf8e' : '#f5b83d',
      dropDisp: S.ev !== 'base' && (has(S.ev) || isCustom) ? 'inline-block' : 'none', dropLabel: isCustom ? '이벤트 삭제' : '디자인 지우기 (기본 사용)', drop: () => this.evDrop(S.ev),
      newOn: S.evNew !== null && S.evNew !== undefined, newOff: !(S.evNew !== null && S.evNew !== undefined), newVal: S.evNew || '',
      newStart: () => this.setState({ evNew: '' }), newInput: (e) => this.setState({ evNew: e.target.value }), newKey: (e) => { if (e.key === 'Enter') this.evAdd(e.target.value); else if (e.key === 'Escape') this.setState({ evNew: null }); },
      newOk: () => this.evAdd(S.evNew), newCancel: () => this.setState({ evNew: null })
    };
  }
  // 설계도의 칸 배열 (프레임이 없으면 1초 16칸에 프레임 하나)
  bpFrames(bp) { return bp.frames && bp.frames.length ? bp.frames.map((f) => f ? f.map((b) => b.slice()) : null) : [bp.blocks.map((b) => b.slice())].concat(new Array(15).fill(null)); }
  frameCur() { return this.state.blocks.map((b) => b.slice()); }
  curRef() { return this.state.blocks; }
  frameLoad(f) { const blocks = f.map((b) => b.slice()); this._loadedRef = blocks; return { blocks, hover: null, exported: null }; }
  componentWillUnmount() { clearInterval(this._playT); }
  // ───── 공용 (건물 편집기 · 자재 편집기 · 노드 화면이 같은 코드) ─────
  // 필드 타일 = 정육각형(반지름 80)을 윗면 반높이 38px로 눌러 본 모습 → K = sin(기울기)
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
  avgC(arr) {
    const s = [0, 0, 0];
    arr.forEach((h) => this.hexRgb(h).forEach((v, i) => { s[i] += v; }));
    return this.rgbHex(s.map((v) => v / arr.length));
  }
  // 8 × 8 픽셀 자재 무늬
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
    const roof = Object.assign(all('roof', 40), {});
    return [
      { id: 'm1', name: '콘크리트', faces: all('concrete', 10) },
      { id: 'm2', name: '벽돌', faces: all('brick', 20) },
      { id: 'm3', name: '유리', faces: all('glass', 30) },
      { id: 'm4', name: '지붕', faces: roof },
      { id: 'm5', name: '목재', faces: all('wood', 50) },
      { id: 'm6', name: '잔디 블록', faces: grass },
      { id: 'm7', name: '금속', faces: all('metal', 70) },
      { id: 'm8', name: '깃발 천', faces: all('flag', 80) },
      { id: 'm9', name: '깃대', faces: all('pole', 90) },
      { id: 'm10', name: '회벽', faces: all('plaster', 100) },
      { id: 'm11', name: '기와', faces: all('tile', 110) },
      { id: 'm12', name: '슬레이트', faces: all('slate', 120) },
      { id: 'm13', name: '창문', faces: all('window', 130) },
      { id: 'm14', name: '나무 문', faces: all('door', 140) },
      { id: 'm15', name: '돌', faces: all('stone', 150) },
      { id: 'm16', name: '나뭇잎', faces: all('leaves', 160) },
      { id: 'm17', name: '통나무', faces: Object.assign(all('log', 170), { pz: this.tex('logTop', 176), nz: this.tex('logTop', 177) }) },
      { id: 'm18', name: '차양', faces: all('awning', 180) },
      { id: 'm19', name: '꽃밭', faces: Object.assign(all('grassSide', 190), { pz: this.tex('flowers', 196) }) },
      { id: 'm20', name: '마루', faces: all('plank', 200) }
    ];
  }
  matSets() {
    return [
      { name: '자재 1셋', items: ['m1', 'm2', 'm3', { folder: '자재 폴더', items: ['m4'] }] },
      { name: '자재 2셋', items: ['m5', 'm6', 'm7', 'm8', 'm9'] },
      { name: '집 자재', items: ['m10', 'm11', 'm12', 'm13', 'm14', 'm15', { folder: '조경', items: ['m16', 'm17', 'm19'] }, 'm18', 'm20'] },
      { name: '애니메이션 자재', items: ['m21', 'm22'] }
    ];
  }
  // 면마다 픽셀 무늬가 붙는 방향: c0 = 무늬의 왼쪽 위 모서리, U = 오른쪽, V = 아래쪽
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
  // 블록 방향: 24가지 회전 (R = 세로축 90°, T = 앞면이 위로 가게 90°)
  rotations() {
    if (this._rots) return this._rots;
    const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
    const RZ = [[0, -1, 0], [1, 0, 0], [0, 0, 1]], RX = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
    const list = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]]], key = (M) => M.map((r) => r.join(',')).join(';');
    const seen = new Set([key(list[0])]);
    for (let i = 0; i < list.length; i++) [RZ, RX].forEach((G) => {
      const M = mul(G, list[i]);
      if (!seen.has(key(M))) { seen.add(key(M)); list.push(M); }
    });
    const idx = (M) => list.findIndex((L) => key(L) === key(M));
    this._rots = { list, rotR: list.map((M) => idx(mul(RZ, M))), rotT: list.map((M) => idx(mul(RX, M))) };
    return this._rots;
  }
  vecKey(v) { return v[2] === 1 ? 'pz' : v[2] === -1 ? 'nz' : v[0] === 1 ? 'px' : v[0] === -1 ? 'nx' : v[1] === 1 ? 'py' : 'ny'; }
  // 세계 방향 id 면에 보이는 자재 면(L)과, 그 무늬의 모서리·방향을 블록 방향 o로 돌려 구한다
  frameFor(o, id) {
    const M = this.rotations().list[o || 0], DM = this.dirMap();
    const ap = (v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
    const apT = (v) => [0, 1, 2].map((i) => M[0][i] * v[0] + M[1][i] * v[1] + M[2][i] * v[2]);
    const L = this.vecKey(apT(DM[id].n)), d = DM[L];
    const c = ap(d.c0.map((v) => v - 0.5)).map((v) => v + 0.5);
    return { L, c0: c, U: ap(d.U), V: ap(d.V) };
  }
  lightF(id, nx, ny) {
    if (id === 'pz') return 1;
    const t = ((nx * -0.8 + ny * 0.6) + 1) / 2;
    return 0.55 + 0.45 * t;
  }
  planeOf(id, x, y, z) { return { pz: z + 1, px: x + 1, nx: x, py: y + 1, ny: y }[id]; }
  uvOf(id, x, y, z) { return id === 'pz' ? [x, y] : (id === 'px' || id === 'nx') ? [y, z] : [x, z]; }
  to3(id, plane, u, v) { return id === 'pz' ? [u, v, plane] : (id === 'px' || id === 'nx') ? [plane, u, v] : [u, plane, v]; }
  blockOnPlane(id, p) { return { pz: [0, 0, p - 1], px: [p - 1, 0, 0], nx: [p, 0, 0], py: [0, p - 1, 0], ny: [0, p, 0] }[id]; }
  // 투영이 평행(아핀)이라 한 평면의 모든 블록 면은 같은 무늬 변환 하나로 정확히 덮인다
  pattern(id, px, f, O, U, V) {
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const rects = [];
    for (let j = 0; j < 8; j++) {
      let i = 0;
      while (i < 8) {
        const col = this.scaleC(px[j * 8 + i], f);
        let k = i + 1;
        while (k < 8 && this.scaleC(px[j * 8 + k], f) === col) k++;
        rects.push({ x: i / 8, y: j / 8, w: r3((k - i) / 8 + 0.008), h: 0.133, fill: col });
        i = k;
      }
    }
    return { id, m: 'matrix(' + [U[0], U[1], V[0], V[1], O[0], O[1]].map(r3).join(' ') + ')', rects };
  }
  outline(cells) {
    const key = (p) => p[0] + ',' + p[1];
    const edges = new Map();
    const add = (a, b) => {
      const rk = key(b) + '>' + key(a);
      if (edges.has(rk)) edges.delete(rk); else edges.set(key(a) + '>' + key(b), [a, b]);
    };
    cells.forEach(([u, v]) => {
      add([u, v], [u + 1, v]); add([u + 1, v], [u + 1, v + 1]);
      add([u + 1, v + 1], [u, v + 1]); add([u, v + 1], [u, v]);
    });
    const out = new Map();
    edges.forEach(([a, b]) => { const k = key(a); if (!out.has(k)) out.set(k, []); out.get(k).push(b); });
    const loops = [];
    out.forEach((list, start) => {
      while (list.length) {
        const pts = [start.split(',').map(Number)];
        let cur = list.pop(), guard = 0;
        while (key(cur) !== start && guard++ < 99999) { pts.push(cur); cur = out.get(key(cur)).pop(); }
        loops.push(pts.filter((p, i) => {
          const a = pts[(i - 1 + pts.length) % pts.length], c = pts[(i + 1) % pts.length];
          return (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]) !== 0;
        }));
      }
    });
    return loops;
  }
  hull2(points) {
    const P = points.slice().sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    P.forEach((p) => { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    P.slice().reverse().forEach((p) => { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); });
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  // 3D 설계도 → 필드 투시의 2D 벡터 4장 (0~3회 회전). 합친 면 하나 = 경로 하나 + 무늬 하나
  exportModel(bp, prefix) {
    const { K, C } = this.geo();
    const N = bp.N, s = 160 / N, c = N / 2, blocks = bp.blocks;
    const mat = (id) => this.MATS.find((m) => m.id === id) || this.MATS[0];
    const occ = new Set(blocks.map((b) => b[0] + ',' + b[1] + ',' + b[2]));
    const has = (x, y, z) => occ.has(x + ',' + y + ',' + z);
    const DM = this.dirMap(), ids = ['pz', 'px', 'nx', 'py', 'ny'];
    const f2 = (v) => Math.round(v * 100) / 100;
    const views = [];
    let unit0 = 0;
    for (let r = 0; r < 4; r++) {
      const th = (45 + 90 * r) * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
      const proj = (X, Y, Z) => {
        const wx = (X - c) * s, wy = (Y - c) * s, wz = Z * s;
        const xr = wx * ct - wy * st, yr = wx * st + wy * ct;
        return [xr, yr * K - wz * C, yr * C + wz * K];
      };
      const groups = new Map();
      let unit = 0;
      blocks.forEach(([x, y, z, m, o]) => ids.forEach((id) => {
        const [dx, dy, dz] = DM[id].n;
        if (has(x + dx, y + dy, z + dz)) return;
        if (id !== 'pz' && dx * st + dy * ct <= 0.001) return;
        const plane = this.planeOf(id, x, y, z), gk = id + '|' + plane + '|' + m + '|' + (o || 0);
        if (!groups.has(gk)) groups.set(gk, { id, plane, m, o: o || 0, cells: [] });
        groups.get(gk).cells.push(this.uvOf(id, x, y, z));
        unit++;
      }));
      if (r === 0) unit0 = unit;
      const polys = [], patterns = [];
      let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, gi = 0;
      groups.forEach((g) => {
        const d = DM[g.id], fr = this.frameFor(g.o, g.id), pid = prefix + '-' + r + '-' + (gi++);
        const b0 = this.blockOnPlane(g.id, g.plane);
        const c0 = [b0[0] + fr.c0[0], b0[1] + fr.c0[1], b0[2] + fr.c0[2]];
        const O = proj(...c0);
        const Up = proj(c0[0] + fr.U[0], c0[1] + fr.U[1], c0[2] + fr.U[2]);
        const Vp = proj(c0[0] + fr.V[0], c0[1] + fr.V[1], c0[2] + fr.V[2]);
        const lf = this.lightF(g.id, d.n[0] * ct - d.n[1] * st, d.n[0] * st + d.n[1] * ct);
        const px = mat(g.m).faces[fr.L];
        patterns.push(this.pattern(pid, px, lf, O, [Up[0] - O[0], Up[1] - O[1]], [Vp[0] - O[0], Vp[1] - O[1]]));
        const edge = this.scaleC(this.avgC(px), lf);
        const set = new Set(g.cells.map((q) => q[0] + ',' + q[1])), seen = new Set();
        g.cells.forEach((q0) => {
          const k0 = q0[0] + ',' + q0[1];
          if (seen.has(k0)) return;
          const comp = [], stack = [q0];
          seen.add(k0);
          while (stack.length) {
            const q = stack.pop();
            comp.push(q);
            [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => {
              const k = (q[0] + a) + ',' + (q[1] + b);
              if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push([q[0] + a, q[1] + b]); }
            });
          }
          let near = 0, cnt = 0, dd = '';
          this.outline(comp).forEach((loop) => {
            loop.forEach((p, i) => {
              const q = proj(...this.to3(g.id, g.plane, p[0], p[1]));
              near += q[2]; cnt++;
              minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]);
              miny = Math.min(miny, q[1]); maxy = Math.max(maxy, q[1]);
              dd += (i === 0 ? 'M' : 'L') + f2(q[0]) + ' ' + f2(q[1]) + ' ';
            });
            dd += 'Z ';
          });
          polys.push({ d: dd.trim(), fill: 'url(#' + pid + ')', edge, near: near / cnt });
        });
      });
      polys.sort((a, b) => a.near - b.near);
      // 그림자: 빛(왼쪽 앞 위)의 반대편 바닥으로. 기둥(x, y)마다 위·아래 모서리 8점의 볼록 껍질을 한 경로에 모은다
      const SH = [0.8 * 0.84, -0.6 * 0.84];
      const colMap = new Map();
      blocks.forEach(([x, y, z]) => {
        const k = x + ',' + y, cc = colMap.get(k);
        if (!cc) colMap.set(k, [x, y, z, z]); else { cc[2] = Math.min(cc[2], z); cc[3] = Math.max(cc[3], z); }
      });
      let shadow = '';
      colMap.forEach(([x, y, z0, z1]) => {
        const pts = [];
        [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].forEach(([X, Y]) => {
          const wx = (X - c) * s, wy = (Y - c) * s;
          const xr = wx * ct - wy * st, yr = wx * st + wy * ct;
          [z0 * s, (z1 + 1) * s].forEach((h) => pts.push([xr + SH[0] * h, (yr + SH[1] * h) * K]));
        });
        const hl = this.hull2(pts);
        hl.forEach((p) => { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); });
        shadow += hl.map((p, i) => (i ? 'L' : 'M') + f2(p[0]) + ' ' + f2(p[1])).join(' ') + ' Z ';
      });
      views.push({ paths: polys.map((p) => ({ d: p.d, fill: p.fill, edge: p.edge })), patterns, shadow: shadow.trim() || 'M0 0', count: polys.length, bbox: [minx, miny, maxx, maxy] });
    }
    return { views, blocks: blocks.length, unit: unit0, merged: views[0].count };
  }
  // 육각형 설치 범위: 타일 육각형을 설계도 좌표로 옮긴 것 (회전 0 = 45°)
  // 설치 범위 = 팔 하나: 그라운드 육각형(가운데 → 변 80)을 6등분한 정삼각형. safe = 합류에 덮이지 않는 칸
  //   hex = 그라운드 육각형 윤곽(점선) · tri = 팔 삼각형 (바닥판)
  region(N) {
    const hr = (this.state && this.state.hub && this.state.hub.r) || 40;
    if (this._region && this._region.N === N && this._region.hr === hr) return this._region;
    const cells = new Map();
    this.roadCells(N).forEach((k) => { const [x, y] = k.split(',').map(Number); cells.set(k, { safe: !this.roadUnderHub(x, y, N, hr) }); });
    const RG = 80 / Math.cos(Math.PI / 6), t30 = Math.tan(Math.PI / 6);
    const hex = [0, 1, 2, 3, 4, 5].map((k) => [RG * Math.cos(k * Math.PI / 3), RG * Math.sin(k * Math.PI / 3)]);
    const tri = [[0, 0], [80 * t30, 80], [-80 * t30, 80]];
    this._region = { N, hr, cells, hex, tri };
    return this._region;
  }

  box(x0, x1, y0, y1, z0, z1, m) {
    const out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push([x, y, z, m]);
    return out;
  }
  // 기본 설계도는 24 × 24. 샘플은 8칸 기준으로 그린 뒤 블록 하나를 3×3×3으로 키워 같은 크기로 옮긴다
  // 기본 설계도 (16칸 격자). 집 · 가게 · 나무 · 정원과 노드용 건물 3종. 블록 = [x, y, z, 자재]
  // 앞 = y가 작은 쪽. 지붕은 계단식(블록만으로), 박공 벽은 지붕 안쪽으로 한 칸 들여 회벽을 채운다
  samples() {
    const mk = () => {
      const M = new Map();
      const api = {
        box: (x0, x1, y0, y1, z0, z1, m) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) M.set(x + ',' + y + ',' + z, m); return api; },
        del: (x0, x1, y0, y1, z0, z1) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) M.delete(x + ',' + y + ',' + z); return api; },
        // 박공 지붕 — 용마루가 x축을 따라간다(앞뒤로 경사). y0..y1 = 처마 포함 폭, x0..x1 = 길이, z0 = 첫 단
        gableX: (x0, x1, y0, y1, z0, roof, wall) => {
          for (let k = 0; y0 + k <= y1 - k; k++) {
            const a = y0 + k, b = y1 - k, z = z0 + k, top = b - a <= 1;
            api.box(x0, x1, a, a, z, z, roof).box(x0, x1, b, b, z, z, roof);
            if (top) api.box(x0, x1, a, b, z, z, roof);
            else api.box(x0 + 1, x1 - 1, a + 1, b - 1, z, z, wall);
          }
          return api;
        },
        // 박공 지붕 — 용마루가 y축을 따라간다(좌우로 경사)
        gableY: (x0, x1, y0, y1, z0, roof, wall) => {
          for (let k = 0; x0 + k <= x1 - k; k++) {
            const a = x0 + k, b = x1 - k, z = z0 + k, top = b - a <= 1;
            api.box(a, a, y0, y1, z, z, roof).box(b, b, y0, y1, z, z, roof);
            if (top) api.box(a, b, y0, y1, z, z, roof);
            else api.box(a + 1, b - 1, y0 + 1, y1 - 1, z, z, wall);
          }
          return api;
        },
        // 모임 지붕 — 사방으로 경사
        hip: (x0, x1, y0, y1, z0, roof) => { for (let k = 0; x0 + k <= x1 - k && y0 + k <= y1 - k; k++) api.box(x0 + k, x1 - k, y0 + k, y1 - k, z0 + k, z0 + k, roof); return api; },
        // 타일 위 팔각 영역(건물 편집기의 영역과 같다) 밖의 블록은 뺀다
        out: () => Array.from(M, ([k, m]) => k.split(',').map(Number).concat([m])).filter(([x, y]) => { const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5); return dx <= 5.5 && dy <= 5.5 && dx + dy <= 8; })
      };
      return api;
    };
    // 오두막: 돌 기단 · 회벽 · 모서리 기둥 · 기와 박공 지붕 · 벽돌 굴뚝 · 앞마당 꽃밭과 돌길
    const cottage = mk()
      .box(4, 11, 4, 11, 0, 0, 'm15').box(4, 11, 4, 11, 1, 4, 'm10')
      .box(4, 4, 4, 4, 1, 4, 'm5').box(11, 11, 4, 4, 1, 4, 'm5').box(4, 4, 11, 11, 1, 4, 'm5').box(11, 11, 11, 11, 1, 4, 'm5')
      .box(7, 8, 4, 4, 1, 2, 'm14').box(5, 5, 4, 4, 2, 3, 'm13').box(10, 10, 4, 4, 2, 3, 'm13')
      .box(4, 4, 7, 8, 2, 3, 'm13').box(11, 11, 7, 8, 2, 3, 'm13').box(6, 6, 11, 11, 2, 3, 'm13').box(9, 9, 11, 11, 2, 3, 'm13')
      .gableX(3, 12, 3, 12, 5, 'm11', 'm10')
      .box(9, 9, 9, 9, 5, 10, 'm2')
      .box(7, 8, 2, 3, 0, 0, 'm15').box(5, 6, 2, 3, 0, 0, 'm19').box(9, 10, 2, 3, 0, 0, 'm19');
    // 통나무집: 통나무 벽 · 마루 현관과 기둥 · 나무 박공 지붕 · 돌 굴뚝
    const cabin = mk()
      .box(5, 10, 5, 11, 0, 3, 'm17')
      .box(7, 8, 5, 5, 0, 1, 'm14').box(5, 5, 7, 8, 1, 2, 'm13').box(10, 10, 7, 8, 1, 2, 'm13').box(5, 5, 5, 5, 2, 2, 'm13').box(10, 10, 5, 5, 2, 2, 'm13')
      .box(5, 10, 2, 4, 0, 0, 'm20').box(5, 5, 2, 2, 1, 3, 'm5').box(10, 10, 2, 2, 1, 3, 'm5')
      .gableY(4, 11, 2, 12, 4, 'm5', 'm17')
      .box(11, 11, 9, 10, 0, 8, 'm15');
    // 2층 주택: 돌 기단 · 1층 회벽 · 나무 띠 · 2층 회벽 · 발코니 · 슬레이트 모임 지붕
    const townhouse = mk()
      .box(4, 11, 5, 11, 0, 0, 'm15').box(4, 11, 5, 11, 1, 3, 'm10').box(4, 11, 5, 11, 4, 4, 'm5').box(4, 11, 5, 11, 5, 7, 'm10')
      .box(7, 8, 5, 5, 1, 2, 'm14').box(5, 5, 5, 5, 2, 3, 'm13').box(10, 10, 5, 5, 2, 3, 'm13')
      .box(5, 6, 5, 5, 6, 7, 'm13').box(9, 10, 5, 5, 6, 7, 'm13')
      .box(4, 4, 7, 7, 2, 3, 'm13').box(4, 4, 9, 9, 2, 3, 'm13').box(4, 4, 7, 7, 6, 7, 'm13').box(4, 4, 9, 9, 6, 7, 'm13')
      .box(11, 11, 7, 7, 2, 3, 'm13').box(11, 11, 9, 9, 2, 3, 'm13').box(11, 11, 8, 8, 6, 7, 'm13')
      .box(6, 9, 3, 4, 4, 4, 'm20').box(6, 6, 3, 3, 5, 5, 'm5').box(9, 9, 3, 3, 5, 5, 'm5').box(7, 8, 3, 3, 5, 5, 'm5')
      .hip(3, 12, 4, 12, 8, 'm12');
    // 가게: 벽돌 · 큰 유리 진열창 · 줄무늬 차양 · 평지붕과 난간 · 옥상 물탱크
    const shop = mk()
      .box(3, 12, 5, 11, 0, 4, 'm2')
      .box(4, 6, 5, 5, 0, 2, 'm3').box(9, 11, 5, 5, 0, 2, 'm3').box(7, 8, 5, 5, 0, 2, 'm14')
      .box(5, 6, 5, 5, 3, 3, 'm13').box(9, 10, 5, 5, 3, 3, 'm13').box(3, 3, 7, 9, 2, 3, 'm13').box(12, 12, 7, 9, 2, 3, 'm13')
      .box(3, 12, 3, 4, 3, 3, 'm18')
      .box(3, 12, 5, 11, 5, 5, 'm1').box(4, 11, 6, 10, 5, 5, 'm4').del(4, 11, 6, 10, 5, 5).box(4, 11, 6, 10, 4, 4, 'm4')
      .box(8, 10, 8, 9, 5, 6, 'm7');
    // 나무: 통나무 줄기 + 나뭇잎 덩어리
    const tree = mk().box(7, 8, 7, 8, 0, 5, 'm17');
    for (let x = 3; x <= 12; x++) for (let y = 3; y <= 12; y++) for (let z = 4; z <= 12; z++) {
      const d = ((x - 7.5) ** 2 + (y - 7.5) ** 2) / 20 + ((z - 8) ** 2) / 14;
      if (d <= 1 && !((x === 3 || x === 12) && (y === 3 || y === 12))) tree.box(x, x, y, y, z, z, 'm16');
    }
    tree.box(7, 8, 7, 8, 0, 5, 'm17');
    // 정원: 잔디 판 · 꽃밭 두 줄 · 돌길 · 나무 울타리 · 벤치
    const garden = mk()
      .box(3, 12, 3, 12, 0, 0, 'm6').box(7, 8, 3, 12, 0, 0, 'm15')
      .box(4, 5, 5, 10, 1, 1, 'm19').box(10, 11, 5, 10, 1, 1, 'm19');
    for (let i = 3; i <= 12; i += 3) garden.box(i, i, 3, 3, 1, 1, 'm5').box(i, i, 12, 12, 1, 1, 'm5').box(3, 3, i, i, 1, 1, 'm5').box(12, 12, i, i, 1, 1, 'm5');
    garden.box(4, 6, 12, 12, 1, 1, 'm5').box(9, 11, 12, 12, 1, 1, 'm5').box(9, 10, 11, 11, 1, 1, 'm20');
    // 노드용: 관제탑 · 창고 · 중계소 (예전 8칸 설계도를 16칸으로 다시)
    const tower = mk()
      .box(4, 11, 4, 11, 0, 0, 'm1').box(6, 9, 6, 9, 1, 9, 'm1')
      .box(7, 8, 6, 6, 2, 3, 'm13').box(7, 8, 6, 6, 6, 7, 'm13').box(6, 6, 7, 8, 4, 5, 'm13').box(9, 9, 7, 8, 4, 5, 'm13')
      .box(7, 8, 6, 6, 1, 1, 'm14')
      .box(5, 10, 5, 10, 10, 11, 'm3').box(5, 10, 5, 10, 12, 12, 'm7').box(7, 7, 7, 7, 13, 15, 'm9');
    const warehouse = mk()
      .box(3, 12, 5, 11, 0, 3, 'm2').box(6, 9, 5, 5, 0, 2, 'm7').box(4, 4, 5, 5, 2, 2, 'm13').box(11, 11, 5, 5, 2, 2, 'm13')
      .box(3, 12, 5, 11, 4, 4, 'm7').box(3, 12, 6, 10, 5, 5, 'm7').box(3, 12, 7, 9, 6, 6, 'm7')
      .box(3, 12, 3, 4, 0, 0, 'm1');
    const relay = mk()
      .box(3, 12, 3, 12, 0, 0, 'm6').box(4, 9, 5, 10, 1, 3, 'm1').box(4, 9, 5, 10, 4, 4, 'm7')
      .box(6, 7, 5, 5, 1, 2, 'm14').box(8, 8, 5, 5, 2, 2, 'm3').box(4, 4, 7, 8, 2, 2, 'm3');
    for (let z = 1; z <= 13; z++) relay.box(10, 10, 10, 10, z, z, 'm7').box(11, 11, 11, 11, z, z, 'm7').box(z % 2 ? 11 : 10, z % 2 ? 11 : 10, z % 2 ? 10 : 11, z % 2 ? 10 : 11, z, z, 'm9');
    relay.box(9, 12, 9, 12, 14, 14, 'm7').box(10, 11, 10, 11, 15, 15, 'm3');
    // 풍차 (애니메이션 건물 예시): 날개를 11.25°씩 돌린 배치 8장을 2칸마다 → 초당 8프레임 (날개 4개라 90°마다 같은 모양 = 한 바퀴 4초)
    // 날개 = 나무 살(m5) + 한쪽 돛천(m10). 지붕 위 깃발은 애니메이션 자재(m21)
    const millBase = () => mk().box(4, 11, 4, 11, 0, 0, 'm15').box(5, 10, 5, 10, 1, 1, 'm15').box(6, 9, 6, 9, 2, 8, 'm10')
      .box(5, 10, 5, 10, 5, 5, 'm20').box(7, 8, 6, 6, 2, 3, 'm14').box(6, 6, 7, 8, 6, 7, 'm13').box(9, 9, 7, 8, 6, 7, 'm13').box(7, 8, 9, 9, 6, 7, 'm13')
      .hip(5, 10, 5, 10, 9, 'm11').box(7, 8, 5, 5, 7, 8, 'm7')
      .box(7, 7, 7, 7, 12, 15, 'm9').box(8, 10, 7, 7, 14, 15, 'm21');
    const millAt = (deg) => {
      const a = millBase();
      for (let x = 2; x <= 13; x++) for (let z = 2; z <= 14; z++) {
        const px = x + 0.5 - 8, pz = z + 0.5 - 8;
        for (let q = 0; q < 4; q++) {
          const th = (deg + q * 90) * Math.PI / 180, dx = Math.cos(th), dz = Math.sin(th);
          const al = px * dx + pz * dz, ac = -px * dz + pz * dx;
          if (al < 1.1 || al > 4.7) continue;
          if (Math.abs(ac) < 0.55) a.box(x, x, 4, 4, z, z, 'm5');
          else if (ac >= 0.55 && ac < 1.85 && al > 1.6) a.box(x, x, 4, 4, z, z, 'm10');
        }
      }
      return a.box(7, 8, 4, 4, 7, 8, 'm7').out();
    };
    const mill = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => millAt(k * 11.25));
    const millA = mill[0], millFrames = new Array(16).fill(null);
    mill.forEach((f, k) => { millFrames[k * 2] = f; });
    return [
      { id: 'tower', name: '관제탑', N: 16, blocks: tower.out() },
      { id: 'warehouse', name: '창고', N: 16, blocks: warehouse.out() },
      { id: 'relay', name: '중계소', N: 16, blocks: relay.out() },
      { id: 'cottage', name: '오두막', N: 16, blocks: cottage.out() },
      { id: 'cabin', name: '통나무집', N: 16, blocks: cabin.out() },
      { id: 'townhouse', name: '2층 주택', N: 16, blocks: townhouse.out() },
      { id: 'shop', name: '가게', N: 16, blocks: shop.out() },
      { id: 'tree', name: '나무', N: 16, blocks: tree.out() },
      { id: 'garden', name: '정원', N: 16, blocks: garden.out() },
      // 1초 16칸 중 짝수 칸마다 프레임(초당 8프레임), 홀수 칸은 빈 칸(앞 프레임 유지)
      { id: 'windmill', name: '풍차', N: 16, period: 1, blocks: millA, frames: millFrames }
    ];
  }

  bpSets(bps) {
    const base = ['stone', 'garden', 'rail'], mine = (bps || []).map((b) => b.id).filter((id) => base.indexOf(id) < 0);
    return [{ name: '기본 도로', items: base }, { name: '내 도로', items: mine }];
  }
  // 도로 목록 = 기본 설계 + 내보낸 것(localStorage 'terra.gui.roads', 같은 id면 내보낸 것)
  loadRoads() {
    let mine = [];
    try { mine = JSON.parse(window.localStorage.getItem('terra.gui.roads') || '[]') || []; } catch (e) { mine = []; }
    mine = mine.filter((r) => r && r.id && (r.frames || r.blocks)).map((r) => this.roadNorm(r));
    return this.roadSamples().filter((r) => !mine.some((m) => m.id === r.id)).concat(mine).map((r) => Object.assign({}, r, { blocks: r.blocks || [] }));
  }

  // 다른 설계도를 지금 설계도에 합칠 자리: 끝 칸(tx, ty, tz)에 바닥 가운데를 맞추고 r번 90° 돌린다
  placeBp(src, t, r) {
    if (!src.length) return [];
    const xs = src.map((b) => b[0]), ys = src.map((b) => b[1]), zs = src.map((b) => b[2]);
    const cx = (Math.min(...xs) + Math.max(...xs) + 1) / 2, cy = (Math.min(...ys) + Math.max(...ys) + 1) / 2, z0 = Math.min(...zs);
    const rots = this.rotations();
    return src.map(([x, y, z, m, o]) => {
      let dx = x + 0.5 - cx, dy = y + 0.5 - cy, oo = o || 0;
      for (let k = 0; k < r; k++) { const nx = -dy; dy = dx; dx = nx; oo = rots.rotR[oo]; }
      return [Math.floor(t[0] + 0.5 + dx), Math.floor(t[1] + 0.5 + dy), t[2] + z - z0, m, oo];
    });
  }
  samples8() {
    const b = (...a) => this.box(...a);
    return [
      { id: 'tower', name: '관제탑', N: 8, blocks: [].concat(b(2, 5, 2, 5, 0, 0, 'm1'), b(3, 4, 3, 4, 1, 3, 'm1'), b(3, 4, 3, 4, 4, 4, 'm3'), b(3, 3, 3, 3, 5, 5, 'm4')) },
      { id: 'warehouse', name: '창고', N: 8, blocks: [].concat(b(2, 5, 2, 4, 0, 1, 'm2'), b(2, 5, 2, 4, 2, 2, 'm4')) },
      { id: 'relay', name: '중계소', N: 8, blocks: [].concat(b(2, 5, 2, 3, 0, 1, 'm3'), b(2, 3, 4, 5, 0, 2, 'm1'), b(4, 5, 4, 5, 0, 0, 'm6')) }
    ];
  }

  // ───── 편집기 화면 (3D, 자유 회전) ─────
  renderVals() {
    const mat = (id) => this.MATS.find((m) => m.id === id) || this.MATS[0];
    const N = this.state.N, s = 160 / N, cN = N / 2, zMax = N;
    const reg = this.region(N);
    // 재생 중: 프레임 pf의 배치 · 애니메이션 자재는 1초 주기로 (편집은 멈춘 뒤에)
    const playing = this.state.playing, blocks = playing ? (this.state.frames[this.state.pf] || this.state.blocks) : this.state.blocks;
    const mfOf = (m) => playing && m.frames ? this.state.pt % 16 : 0;   // 자재는 16칸을 1초마다 되풀이 (빈 칸은 matFrame이 앞 프레임으로)
    const occ = new Set(blocks.map((b) => b[0] + ',' + b[1] + ',' + b[2]));
    const has = (x, y, z) => occ.has(x + ',' + y + ',' + z);
    const inB = (x, y, z) => z >= 0 && z < zMax && reg.cells.has(x + ',' + y);
    const ZS = 3.0, EX = 480, EY = 560;
    const ya = this.state.yaw * Math.PI / 180, pa = this.state.pitch * Math.PI / 180;
    const cy = Math.cos(ya), sy = Math.sin(ya), sp = Math.sin(pa), cp = Math.cos(pa);
    const PW = (wx, wy, wz) => {
      const xr = wx * cy - wy * sy, yr = wx * sy + wy * cy;
      return [EX + xr * ZS, EY + (yr * sp - wz * cp) * ZS, yr * cp + wz * sp];
    };
    const PG = (X, Y, Z) => PW((X - cN) * s, (Y - cN) * s, Z * s);
    const f = (v) => Math.round(v * 10) / 10;
    const str = (arr) => arr.map((q) => f(q[0]) + ',' + f(q[1])).join(' ');
    const cellPx = s * ZS;

    const hover = this.state.active ? this.state.hover : null;
    const plate = [];
    reg.cells.forEach((info, k) => {
      const [x, y] = k.split(',').map(Number);
      const t = x + ',' + y + ',0';
      plate.push({
        pts: str([PG(x, y, 0), PG(x + 1, y, 0), PG(x + 1, y + 1, 0), PG(x, y + 1, 0)]),
        target: t,
        fill: hover === t && !has(x, y, 0) ? 'rgba(255,216,77,0.45)' : (info.safe ? '#1e2229' : '#34373d')
      });
    });
    const plateRim = str(reg.tri.map(([a, b]) => PW(a * 1.06, b * 1.03 - 1, 0)));
    const hexOutline = str(reg.hex.map(([a, b]) => PW(a, b, 0)));

    // 면: 자재 픽셀 무늬를 (자재, 방향, 평면)마다 패턴 하나로
    const DM = this.dirMap(), ids = ['pz', 'px', 'nx', 'py', 'ny'];
    const patMap = new Map(), pats = [];
    const patFor = (m, id, plane, o) => {
      const key = m + '|' + id + '|' + plane + '|' + o;
      if (patMap.has(key)) return patMap.get(key);
      const d = DM[id], fr = this.frameFor(o, id), pid = 'e' + pats.length;
      const b0 = this.blockOnPlane(id, plane);
      const c0 = [b0[0] + fr.c0[0], b0[1] + fr.c0[1], b0[2] + fr.c0[2]];
      const O = PG(...c0), Up = PG(c0[0] + fr.U[0], c0[1] + fr.U[1], c0[2] + fr.U[2]), Vp = PG(c0[0] + fr.V[0], c0[1] + fr.V[1], c0[2] + fr.V[2]);
      const lf = this.lightF(id, d.n[0] * cy - d.n[1] * sy, d.n[0] * sy + d.n[1] * cy);
      const mpx = this.matFrame(mat(m), mfOf(mat(m)))[fr.L];
      pats.push(this.pattern(pid, mpx, lf, O, [Up[0] - O[0], Up[1] - O[1]], [Vp[0] - O[0], Vp[1] - O[1]]));
      const v = { url: 'url(#' + pid + ')', edge: this.scaleC(this.avgC(mpx), lf) };
      patMap.set(key, v);
      return v;
    };
    const cornersOf = (id, x, y, z) => ({
      pz: [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]],
      px: [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]],
      nx: [[x, y, z], [x, y + 1, z], [x, y + 1, z + 1], [x, y, z + 1]],
      py: [[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]],
      ny: [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]]
    }[id]);
    const faces = [];
    const sw = f(Math.min(0.9, cellPx / 14));
    const pushCube = (x, y, z, mid, o, ghost) => ids.forEach((id) => {
      const [dx, dy, dz] = DM[id].n;
      if (!ghost && has(x + dx, y + dy, z + dz)) return;
      if (id !== 'pz' && dx * sy + dy * cy <= 0.001) return;
      const pts = cornersOf(id, x, y, z).map((q) => PG(...q));
      const near = pts.reduce((a, q) => a + q[2], 0) / 4 + (ghost ? 0.01 : 0);
      const nb = [x + dx, y + dy, z + dz];
      const p = patFor(mid, id, this.planeOf(id, x, y, z), o || 0);
      faces.push({
        pts: str(pts),
        fill: p.url,
        stroke: ghost ? '#ffd84d' : 'rgba(22,25,31,0.22)',
        sw: ghost ? 1.5 : sw,
        op: ghost ? (this.state.placing ? 0.85 : 0.6) : 1,
        pe: ghost ? 'none' : 'auto',
        target: inB(...nb) ? nb.join(',') : '',
        block: x + ',' + y + ',' + z,
        near
      });
    });
    blocks.forEach(([x, y, z, mid, o]) => pushCube(x, y, z, mid, o, false));
    // 나머지 다섯 팔 (흐리게 · 단색) — 맵에서 여러 방향으로 놓였을 때의 모습. 합류에 덮이는 칸은 뺀다
    if (this.state.ghost) {
      const vis = blocks.filter(([x, y]) => !this.roadUnderHub(x, y, N, (this.state.hub || {}).r || 40));
      for (let k = 1; k < 6; k++) {
        const th = k * Math.PI / 3, ct = Math.cos(th), st = Math.sin(th);
        const PR = (X, Y, Z) => { const wx = (X - cN) * s, wy = (Y - cN) * s; return PW(wx * ct - wy * st, wx * st + wy * ct, Z * s); };
        vis.forEach(([x, y, z, mid]) => ids.forEach((id) => {
          const [dx, dy, dz] = DM[id].n;
          if (has(x + dx, y + dy, z + dz)) return;
          const rx = dx * ct - dy * st, ry = dx * st + dy * ct;
          if (id !== 'pz' && rx * sy + ry * cy <= 0.001) return;
          const pts = cornersOf(id, x, y, z).map((q) => PR(...q)), m = mat(mid);
          const lf = this.lightF(id, rx * cy - ry * sy, rx * sy + ry * cy), col = this.scaleC(this.avgC(this.matFrame(m, 0)[id]), lf);
          faces.push({ pts: str(pts), fill: col, stroke: 'rgba(22,25,31,0.12)', sw: 0.5, op: 0.42, pe: 'none', target: '', block: '', near: pts.reduce((a, q) => a + q[2], 0) / 4 });
        }));
      }
    }
    // 합류: 가운데 정육각 기둥 (높이 = 블록 단, 무늬 = 윗면 · 옆면 자재)
    {
      const hb = this.state.hub || { h: 1, top: 'm1', side: 'm1' }, H = Math.max(0, hb.h || 0) * s, rh = hb.r || 40;
      if (hb.h > 0) {
        const V = [0, 1, 2, 3, 4, 5].map((k) => [rh * Math.cos(k * Math.PI / 3), rh * Math.sin(k * Math.PI / 3)]), TS = 20;
        const pxS = this.matFrame(mat(hb.side), 0).py, pxT = this.matFrame(mat(hb.top), 0).pz;
        for (let k = 0; k < 6; k++) {
          const a = V[k], b = V[(k + 1) % 6], na = k * Math.PI / 3 + Math.PI / 6, nx = Math.cos(na), ny = Math.sin(na);
          if (nx * sy + ny * cy <= 0.001) continue;
          const lf = this.lightF('px', nx * cy - ny * sy, nx * sy + ny * cy), pid = 'hs' + k;
          const ex = (b[0] - a[0]) / rh * TS, ey = (b[1] - a[1]) / rh * TS;
          const O = PW(a[0], a[1], H), Up = PW(a[0] + ex, a[1] + ey, H), Vp = PW(a[0], a[1], H - TS);
          pats.push(this.pattern(pid, pxS, lf, O, [Up[0] - O[0], Up[1] - O[1]], [Vp[0] - O[0], Vp[1] - O[1]]));
          const q = [PW(a[0], a[1], 0), PW(b[0], b[1], 0), PW(b[0], b[1], H), PW(a[0], a[1], H)];
          faces.push({ pts: str(q), fill: 'url(#' + pid + ')', stroke: 'rgba(22,25,31,0.3)', sw: 0.8, op: 1, pe: 'none', target: '', block: '', near: q.reduce((u, p) => u + p[2], 0) / 4 });
        }
        const O = PW(-rh, -rh, H), Up = PW(-rh + TS, -rh, H), Vp = PW(-rh, -rh + TS, H);
        pats.push(this.pattern('ht', pxT, 1, O, [Up[0] - O[0], Up[1] - O[1]], [Vp[0] - O[0], Vp[1] - O[1]]));
        const top = V.map((v) => PW(v[0], v[1], H));
        faces.push({ pts: str(top), fill: 'url(#ht)', stroke: 'rgba(22,25,31,0.3)', sw: 0.8, op: 1, pe: 'none', target: '', block: '', near: top.reduce((u, p) => u + p[2], 0) / 6 + 0.02 });
      }
    }
    if (hover) {
      const [hx, hy, hz] = hover.split(',').map(Number);
      if (inB(hx, hy, hz) && !has(hx, hy, hz)) pushCube(hx, hy, hz, this.state.active, this.state.orient, true);
    }
    const bd = this.state.bpDrag;
    let dropInfo = null;
    if (bd && bd.over) {
      const src = this.state.bps.find((b) => b.id === bd.id);
      const srcBlocks = src ? (src.id === this.state.bps[this.state.cur].id ? blocks : src.blocks) : [];
      const placed = this.placeBp(srcBlocks, bd.over.split(',').map(Number), bd.rot || 0);
      const ok = placed.filter(([x, y, z]) => inB(x, y, z) && !has(x, y, z));
      const gOcc = new Set(ok.map((b) => b[0] + ',' + b[1] + ',' + b[2]));
      ok.forEach(([x, y, z, m, o]) => ids.forEach((id) => {
        const [dx, dy, dz] = DM[id].n;
        if (gOcc.has((x + dx) + ',' + (y + dy) + ',' + (z + dz))) return;
        if (id !== 'pz' && dx * sy + dy * cy <= 0.001) return;
        const pts = cornersOf(id, x, y, z).map((q) => PG(...q));
        faces.push({ pts: str(pts), fill: patFor(m, id, this.planeOf(id, x, y, z), o || 0).url, stroke: '#ffd84d', sw: 0.6, op: 0.7, pe: 'none', target: '', block: '', near: pts.reduce((a, q) => a + q[2], 0) / 4 + 0.01 });
      }));
      dropInfo = { ok, skip: placed.length - ok.length };
    }
    faces.sort((a, b) => a.near - b.near);

    // 시점 큐브
    const CPW = (x, y, z) => {
      const xr = x * cy - y * sy, yr = x * sy + y * cy;
      return [70 + xr * 40, 70 + (yr * sp - z * cp) * 40, yr * cp + z * sp];
    };
    const cubeFaces = [
      { id: 'pz', label: 'T', n: [0, 0, 1], c: [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]] },
      { id: 'px', label: 'R', n: [1, 0, 0], c: [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]] },
      { id: 'nx', label: 'L', n: [-1, 0, 0], c: [[-.5, -.5, -.5], [-.5, .5, -.5], [-.5, .5, .5], [-.5, -.5, .5]] },
      { id: 'py', label: 'F', n: [0, 1, 0], c: [[-.5, .5, -.5], [.5, .5, -.5], [.5, .5, .5], [-.5, .5, .5]] },
      { id: 'ny', label: 'B', n: [0, -1, 0], c: [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]] }
    ];
    const cube = cubeFaces
      .filter((q) => q.id === 'pz' || q.n[0] * sy + q.n[1] * cy > 0.02)
      .map((q) => {
        const pts = q.c.map((p) => CPW(...p));
        return {
          id: q.id, label: q.label, pts: str(pts),
          lx: f(pts.reduce((a, p) => a + p[0], 0) / 4), ly: f(pts.reduce((a, p) => a + p[1], 0) / 4),
          fill: this.scaleC('#5f7fbf', this.lightF(q.id, q.n[0] * cy - q.n[1] * sy, q.n[0] * sy + q.n[1] * cy)),
          near: pts.reduce((a, p) => a + p[2], 0) / 4
        };
      })
      .sort((a, b) => a.near - b.near);

    // 조작
    // 좌클릭 끌기 = 회전 · 좌클릭 = 블록 제거 · 우클릭 누르고 있기 = 설치 준비(R/T로 방향) · 떼면 설치
    const targetOf = (e) => {
      const hit = e.target && e.target.closest ? e.target.closest('[data-target]') : null;
      return hit ? hit.getAttribute('data-target') || null : null;
    };
    const down = (e) => {
      if (this.state.playing) { this.animPlay(false); return; }   // 재생 중 설계 화면을 누르면 멈추고, 편집은 그다음부터
      const root = e.currentTarget.closest ? e.currentTarget.closest('main') : null;
      if (root) { root.tabIndex = -1; root.focus({ preventScroll: true }); }
      if (e.button === 2) {
        if (this.state.active) this.setState({ placing: true, hover: targetOf(e) });
        return;
      }
      if (e.button !== 0) return;
      const hb = e.target.closest ? e.target.closest('[data-block]') : null;
      this.drag = { x: e.clientX, y: e.clientY, yaw: this.state.yaw, pitch: this.state.pitch, moved: false, block: hb ? hb.getAttribute('data-block') : '' };
    };
    const move = (e) => {
      if (this.state.bpDrag) {
        const t = targetOf(e);
        if (t !== this.state.bpDrag.over) this.setState({ bpDrag: Object.assign({}, this.state.bpDrag, { over: t }) });
        return;
      }
      const d = this.drag;
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        d.moved = true;
        this.setState({ dragging: true, yaw: d.yaw + dx * 0.45, pitch: Math.max(8, Math.min(88, d.pitch + dy * 0.3)) });
        return;
      }
      if (!this.state.active) return;
      const t = targetOf(e);
      if (t !== this.state.hover) this.setState({ hover: t });
    };
    const up = (e) => {
      if (this.state.bpDrag) {
        if (dropInfo && dropInfo.ok.length) {
          const nm = (this.state.bps.find((b) => b.id === this.state.bpDrag.id) || {}).name;
          this.setState({ blocks: this.state.blocks.concat(dropInfo.ok), saved: false, note: nm + ' 블록 ' + dropInfo.ok.length + '개를 합쳤습니다' + (dropInfo.skip ? ' · 범위 밖이거나 겹친 ' + dropInfo.skip + '개는 뺐습니다' : '') });
        }
        return; // 끌기 정리는 바깥(rootUp)에서
      }
      if (e.button === 2) {
        if (!this.state.placing) return;
        const t = this.state.hover;
        this.setState({ placing: false });
        if (!t || !this.state.active) return;
        const [x, y, z] = t.split(',').map(Number);
        if (!inB(x, y, z) || has(x, y, z)) return;
        this.setState({ blocks: this.state.blocks.concat([[x, y, z, this.state.active, this.state.orient]]), saved: false, hover: null });
        return;
      }
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && d.block) {
        this.setState({ blocks: this.state.blocks.filter((b) => b.slice(0, 3).join(',') !== d.block), saved: false, hover: null });
      } else if (d) this.setState({ dragging: false });
    };
    const leave = () => { this.drag = null; this.setState({ dragging: false, hover: null, placing: false, bpDrag: this.state.bpDrag ? Object.assign({}, this.state.bpDrag, { over: null }) : null }); };
    const ctx = (e) => { e.preventDefault(); };
    const key = (e) => {
      const k = e.key;
      if (this.state.bpDrag) return; // 끄는 중의 R은 설계도 회전 (rootKey)
      const rots = this.rotations();
      if (k === 'r' || k === 'R' || k === 'ㄱ') { e.preventDefault(); this.setState({ orient: rots.rotR[this.state.orient] }); }
      else if (k === 't' || k === 'T' || k === 'ㅅ') { e.preventDefault(); this.setState({ orient: rots.rotT[this.state.orient] }); }
      else if (k === 'Escape') this.setState({ active: null, hover: null, placing: false });
    };
    const faceName = { pz: '위', nz: '아래', px: '오른쪽', nx: '왼쪽', py: '앞', ny: '뒤' };
    const orientLabel = '윗면 ← 자재 ' + faceName[this.frameFor(this.state.orient, 'pz').L] + ' · 앞면 ← 자재 ' + faceName[this.frameFor(this.state.orient, 'py').L];
    const cubeClick = (e) => {
      const g = e.target.closest ? e.target.closest('[data-face]') : null;
      const id = g ? g.getAttribute('data-face') : '';
      const snap = { pz: { pitch: 88 }, py: { yaw: 0, pitch: 18 }, ny: { yaw: 180, pitch: 18 }, px: { yaw: 90, pitch: 18 }, nx: { yaw: 270, pitch: 18 } }[id];
      if (snap) this.setState(snap);
    };
    // 칸 수 변경: 가운데를 기준으로 블록을 옮기고, 새 육각형 밖으로 나간 블록은 뺀다
    const setN = (e) => {
      const nN = Math.max(4, Math.min(64, Math.round(Number(e.target.value) / 2) * 2));
      if (nN === N) return;
      // 도로는 화소 수만 바꾼다: 팔 모양(실제 크기)을 그대로 두고 새 격자로 다시 뽑는다 (16 → 32면 블록 하나가 2×2×2)
      const nReg = this.region(nN), k = nN / N;
      const shift = (bl) => {
        const M = new Map(bl.map((b) => [b[0] + ',' + b[1] + ',' + b[2], b])), out = [];
        nReg.cells.forEach((info, key) => {
          const [x, y] = key.split(',').map(Number), ox = Math.floor((x + 0.5) / k), oy = Math.floor((y + 0.5) / k);
          for (let z = 0; z < nN; z++) { const b = M.get(ox + ',' + oy + ',' + Math.floor((z + 0.5) / k)); if (b) out.push([x, y, z, b[3], b[4] || 0]); }
        });
        return out;
      };
      const moved = this.state.blocks.length, kept = shift(this.state.blocks);
      // 모든 프레임을 같이 옮긴다
      const fr = this.framesNow().map((f) => f ? shift(f) : null);
      // 이벤트 디자인 · 맡아 둔 기본 모습도 같이
      const shD = (d) => (d ? Object.assign({}, d, { blocks: shift(d.blocks || []), frames: d.frames ? d.frames.map((f) => (f ? shift(f) : null)) : null }) : d);
      const evsN = {}; Object.keys(this.state.evs || {}).forEach((e) => { evsN[e] = shD(this.state.evs[e]); });
      this.setState({ evs: evsN, baseD: shD(this.state.baseD) });
      const hb = this.state.hub || {};
      this.setState({ N: nN, blocks: kept, frames: fr, dropped: 0, saved: false, hover: null, hub: Object.assign({}, hb, { h: Math.round((hb.h || 0) * k) }) });   // 합류 높이도 같은 실제 높이로
    };

    const bpsState = this.state.bps, cur = this.state.cur;
    const bpById = (id) => bpsState.find((b) => b.id === id);
    const loadBp = (i) => {
      if (this.state.playing) this.animPlay(false);
      this._evSnap = null; this.setState({ ev: 'base', evs: Object.assign({}, bpsState[i].events || {}), custom: (bpsState[i].customEvents || []).slice(), baseD: null, evNew: null });
      const fr = this.bpFrames(bpsState[i]);
      this.setState({ hub: Object.assign({ h: 1, top: 'm1', side: 'm1' }, bpsState[i].hub), cur: i, N: bpsState[i].N, blocks: this._loadedRef = fr[0].map((b) => b.slice()), frames: fr, fi: 0, anim: this.keyCount(fr) > 1, confirmBasic: false, exported: null, saved: true, hover: null, dropped: 0, note: '' });
    };
    // 저장: 지금 편집 중인 것(기본 / 이벤트)을 제자리에 넣고 설계 전체(기본 + 이벤트 + 사용자 이벤트)를 목록에
    const save = () => {
      const next = bpsState.slice(), r = this.evCommit();
      next[cur] = Object.assign({}, next[cur], { N: this.state.N, blocks: r.base.blocks, frames: r.base.frames, period: r.base.period }, { hub: Object.assign({}, r.base.hub || this.state.hub) }, { events: r.evs, customEvents: this.state.custom.slice() });
      this.setState({ bps: next, saved: true, evs: r.evs });
      return next;
    };

    // 새 설계도 · 새 폴더는 지금 설계도가 든 셋(과 폴더)에 만든다
    const where = (id) => {
      let found = null;
      this.state.bpSets.forEach((st, si) => st.items.forEach((it, ii) => {
        if (it === id) found = { si, fi: -1 };
        else if (typeof it !== 'string' && it.items.indexOf(id) >= 0) found = { si, fi: ii };
      }));
      return found || { si: 0, fi: -1 };
    };
    const insertAt = (sets, loc, item) => sets.map((st, si) => si !== loc.si ? st : Object.assign({}, st, {
      items: loc.fi < 0 ? st.items.concat([item]) : st.items.map((it, ii) => ii === loc.fi ? Object.assign({}, it, { items: it.items.concat([item]) }) : it)
    }));
    const stripId = (sets, id) => sets.map((st) => Object.assign({}, st, { items: st.items.filter((it) => it !== id).map((it) => typeof it === 'string' ? it : Object.assign({}, it, { items: it.items.filter((x) => x !== id) })) }));
    const newBp = () => {
      this._evSnap = null; this.setState({ ev: 'base', evs: {}, custom: [], baseD: null, evNew: null });
      const id = 'road' + Date.now().toString(36);
      const next = bpsState.concat([{ id, name: '새 도로 ' + (bpsState.length - 2), N: 48, blocks: [], hub: { h: 3, top: 'm1', side: 'm15', r: 40 } }]);
      if (this.state.playing) this.animPlay(false);
      this.setState({ bps: next, bpSets: insertAt(this.state.bpSets, where(bpsState[cur].id), id), hub: { h: 3, top: 'm1', side: 'm15', r: 40 }, cur: next.length - 1, N: 48, blocks: this._loadedRef = [], frames: [[]].concat(new Array(15).fill(null)), fi: 0, anim: false, confirmBasic: false, exported: null, saved: true, dropped: 0, note: '' });
    };
    const newFolder = () => {
      const loc = where(bpsState[cur].id), n = this.state.bpSets.reduce((a, st) => a + st.items.filter((it) => typeof it !== 'string').length, 0) + 1;
      const name = '새 폴더 ' + n;
      this.setState({ bpSets: insertAt(this.state.bpSets, { si: loc.si, fi: -1 }, { folder: name, items: [] }), bpOpen: Object.assign({}, this.state.bpOpen, { [name]: true }) });
    };
    const delBp = () => {
      this._evSnap = null; this.setState({ ev: 'base', evs: {}, custom: [], baseD: null, evNew: null });
      if (bpsState.length <= 1) return;
      const id = bpsState[cur].id, next = bpsState.filter((b) => b.id !== id);
      if (this.state.playing) this.animPlay(false);
      const fr = this.bpFrames(next[0]);
      this.setState({ bps: next, bpSets: stripId(this.state.bpSets, id), cur: 0, N: next[0].N, blocks: this._loadedRef = fr[0].map((b) => b.slice()), frames: fr, fi: 0, anim: this.keyCount(fr) > 1, confirmBasic: false, exported: null, saved: true, dropped: 0, note: '' });
    };

    // 설계도 트리 (셋 → 설계도 / 폴더 → 설계도). 행을 끌면: 설계 화면에 놓아 합치기 · 셋·폴더에 놓아 옮기기
    const drag = this.state.bpDrag;
    const dropOn = drag ? drag.dropOn : null;
    const bpTree = [];
    const bpRow = (id, depth) => {
      const i = bpsState.findIndex((b) => b.id === id);
      if (i < 0) return;
      const bp = bpsState[i], on = i === cur;
      const nFr = on ? (this.state.anim ? this.animKeys(this.state.frames) : 1) : this.keyCount(bp.frames), lenS = on ? this.state.frames.length / 16 : (bp.frames ? bp.frames.length / 16 : 1);
      bpTree.push({
        isBp: true, isSet: false, isFolder: false, label: bp.name, indent: (depth * 14) + 'px',
        meta: (on ? this.state.N : bp.N) + '×' + (on ? this.state.N : bp.N) + ' · 블록 ' + (on ? this.state.blocks.length : bp.blocks.length) + (nFr > 1 ? ' · ' + nFr + '프레임' : ''),
        playDisp: nFr > 1 ? 'inline' : 'none', playTip: '애니메이션 · 프레임 ' + nFr + '개 · ' + lenS + '초 (' + lenS * 16 + '칸)',
        pressed: on ? 'true' : 'false', border: on ? '1px solid rgba(255,216,77,0.55)' : '1px solid transparent', bg: on ? 'rgba(255,255,255,0.07)' : 'transparent',
        fw: on ? 600 : 500, state: on ? '편집 중' : '', op: drag && drag.id === id ? 0.5 : 1,
        grab: (e) => { if (e.button === 0) this.pend = { id, x: e.clientX, y: e.clientY }; },
        load: () => { if (this.justDragged) { this.justDragged = false; return; } if (!on) loadBp(i); }
      });
    };
    const dropStyle = (key) => ({ drop: key, dropBg: dropOn === key ? 'rgba(255,216,77,0.10)' : 'transparent', dropLine: dropOn === key ? '1px dashed #ffd84d' : 'none' });
    this.state.bpSets.forEach((st, si) => {
      bpTree.push(Object.assign({ isSet: true, isFolder: false, isBp: false, label: st.name }, dropStyle('s' + si)));
      st.items.forEach((it, ii) => {
        if (typeof it === 'string') { bpRow(it, 1); return; }
        const open = !!this.state.bpOpen[it.folder];
        bpTree.push(Object.assign({
          isFolder: true, isSet: false, isBp: false, label: it.folder + (it.items.length ? '' : ' (비어 있음)'), indent: '14px', caret: open ? '▾' : '▸', expanded: open ? 'true' : 'false',
          toggle: () => this.setState({ bpOpen: Object.assign({}, this.state.bpOpen, { [it.folder]: !open }) })
        }, dropStyle('s' + si + 'f' + ii)));
        if (open) it.items.forEach((id) => bpRow(id, 2));
      });
    });
    const rootMove = (e) => {
      const r = e.currentTarget.getBoundingClientRect(), k = r.width / 1440 || 1;
      const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
      if (this.pend && !this.state.bpDrag) {
        if (Math.abs(e.clientX - this.pend.x) + Math.abs(e.clientY - this.pend.y) < 6) return;
        e.currentTarget.tabIndex = -1; e.currentTarget.focus({ preventScroll: true });
        this.setState({ bpDrag: { id: this.pend.id, over: null, rot: 0, x, y, dropOn: null } });
        return;
      }
      if (this.state.bpDrag) {
        const el = e.target && e.target.closest ? e.target.closest('[data-bpdrop]') : null;
        const dOn = el ? el.getAttribute('data-bpdrop') : null;
        this.setState({ bpDrag: Object.assign({}, this.state.bpDrag, { x, y, dropOn: dOn }) });
      }
    };
    const rootUp = () => {
      this.pend = null;
      const d = this.state.bpDrag;
      if (!d) return;
      this.justDragged = true;
      setTimeout(() => { this.justDragged = false; }, 0);
      if (d.dropOn) {
        const m = /^s(\d+)(?:f(\d+))?$/.exec(d.dropOn);
        const loc = { si: Number(m[1]), fi: m[2] === undefined ? -1 : Number(m[2]) };
        this.setState({ bpSets: insertAt(stripId(this.state.bpSets, d.id), loc, d.id), bpDrag: null });
        return;
      }
      this.setState({ bpDrag: null });
    };
    const rootCancel = () => { this.pend = null; if (this.state.bpDrag) this.setState({ bpDrag: null }); };
    const rootKey = (e) => {
      if (!this.state.bpDrag) return;
      if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') { e.preventDefault(); this.setState({ bpDrag: Object.assign({}, this.state.bpDrag, { rot: ((this.state.bpDrag.rot || 0) + 1) % 4 }) }); }
      else if (e.key === 'Escape') this.setState({ bpDrag: null });
    };
    const dragBp = drag ? bpById(drag.id) : null;
    const chip = drag ? {
      x: Math.round(drag.x + 14), y: Math.round(drag.y + 12), disp: 'block', name: dragBp ? dragBp.name : '',
      hint: drag.dropOn ? '→ 여기로 옮기기' : drag.over ? (dropInfo ? '블록 ' + dropInfo.ok.length + '개 합치기' : '') + ' · ' + (90 * (drag.rot || 0)) + '° (R)' : '설계 화면에 놓으면 합치기 · 폴더에 놓으면 옮기기'
    } : { x: 0, y: 0, disp: 'none', name: '', hint: '' };
    // 내보내기 = 저장 + localStorage 'terra.gui.roads' (기본 도로도 고쳤으면 같은 id로) — 열려 있는 노드 화면이 storage 이벤트로 바로 받는다
    const exportNow = () => {
      const all = save().map((b, i) => (i === cur ? Object.assign({}, b, { v: (b.v || 0) + 1 }) : b));
      const out = all.filter((b, i) => i === cur || b.v || ['stone', 'garden', 'rail'].indexOf(b.id) < 0).map((b) => ({ id: b.id, name: b.name, N: b.N, blocks: b.blocks, frames: b.frames || null, period: b.period || 1, hub: b.hub, events: b.events || {}, customEvents: b.customEvents || [], v: b.v || 0 }));
      try { window.localStorage.setItem('terra.gui.roads', JSON.stringify(out)); } catch (e) { this.setState({ exportNote: '브라우저 저장이 막혀 내보내지 못했습니다', noteC: '#ff5d5d' }); return; }
      this.setState({ bps: all, exportNote: new Date().toTimeString().slice(0, 5) + ' 노드 화면으로 내보냄 — 도로 ' + out.length + '개', noteC: '#3ecf8e', bpSets: this.bpSets(all) });
    };

    let ex = null;
    if (this.state.exported) {
      const e = this.state.exported;
      ex = {
        name: e.name, blocks: e.blocks, unit: e.unit, merged: e.merged,
        patterns: [].concat(...e.views.map((v) => v.patterns)),
        views: e.views.map((v, r) => {
          const pad = 10, w = Math.max(40, v.bbox[2] - v.bbox[0]), h = Math.max(40, v.bbox[3] - v.bbox[1]);
          const cxv = (v.bbox[0] + v.bbox[2]) / 2, cyv = (v.bbox[1] + v.bbox[3]) / 2;
          const sc = Math.max(w / 150, h / 120);
          const W = 150 * sc + pad * 2, H = 120 * sc + pad * 2;
          return { paths: v.paths, shadow: v.shadow, count: v.count, label: '회전 ' + r + ' · ' + (45 + 90 * r) + '°', vb: f(cxv - W / 2) + ' ' + f(cyv - H / 2) + ' ' + f(W) + ' ' + f(H) };
        })
      };
    }

    // 자재 트리 (셋 → 자재 / 폴더 → 자재)
    const tree = [];
    const matRow = (id, depth) => {
      const m = mat(id), on = this.state.active === id;
      tree.push({
        isMat: true, isSet: false, isFolder: false, label: m.name, indent: (depth * 14) + 'px',
        top: this.avgC(m.faces.pz), left: this.scaleC(this.avgC(m.faces.nx), 0.85), right: this.scaleC(this.avgC(m.faces.py), 0.68),
        playDisp: this.keyCount(m.frames) > 1 ? 'inline' : 'none', playTip: '애니메이션 자재 · 프레임 ' + this.keyCount(m.frames) + '개 · 1초 (16칸)',
        pressed: on ? 'true' : 'false', border: on ? '1px solid rgba(255,216,77,0.55)' : '1px solid transparent', bg: on ? 'rgba(255,216,77,0.08)' : 'transparent',
        fw: on ? 600 : 400, state: on ? '활성' : '',
        pick: () => this.setState({ active: on ? null : id, hover: null })
      });
    };
    this.state.sets.forEach((set) => {
      tree.push({ isSet: true, isFolder: false, isMat: false, label: set.name });
      set.items.forEach((it) => {
        if (typeof it === 'string') { matRow(it, 1); return; }
        const open = !!this.state.folderOpen[it.folder];
        tree.push({
          isFolder: true, isSet: false, isMat: false, label: it.folder, indent: '14px', caret: open ? '▾' : '▸', expanded: open ? 'true' : 'false',
          toggle: () => this.setState({ folderOpen: Object.assign({}, this.state.folderOpen, { [it.folder]: !open }) })
        });
        if (open) it.items.forEach((id) => matRow(id, 2));
      });
    });
    const delMat = () => {
      const a = this.state.active;
      if (!a) return;
      const strip = (items) => items.filter((it) => it !== a).map((it) => typeof it === 'string' ? it : Object.assign({}, it, { items: strip(it.items) }));
      this.setState({ sets: this.state.sets.map((st) => Object.assign({}, st, { items: strip(st.items) })), active: null });
    };

    const active = this.state.active ? mat(this.state.active) : null;
    // 미리보기 (맵과 같은 투시). 재생 중이면 그 칸
    const hubS = this.state.hub || { h: 1, top: 'm1', side: 'm1' };
    const rdNow = { id: 'pv', N, blocks, frames: null, hub: hubS };
    const pvKey = N + '|' + this.state.mask + '|' + JSON.stringify(blocks) + '|' + JSON.stringify(hubS);
    if (this._pvKey !== pvKey) { this._pvKey = pvKey; const v = this.roadModel(rdNow, this.state.mask, 0, null, 'pv'); this._pvSrc = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(this.roadSvg(v, -130, -100, 260, 188, 2)); }
    const { K } = this.geo(), pvs = 276 / 260;
    const pv = {
      src: this._pvSrc, vb: '-130 -100 260 188', n: [0, 1, 2, 3, 4, 5].filter((i) => this.state.mask & (1 << i)).length,
      ground: [0, 1, 2, 3, 4, 5].map((k) => (92.4 * Math.cos(k * Math.PI / 3)) + ',' + (92.4 * Math.sin(k * Math.PI / 3) * K)).join(' '),
      dirs: this.roadDirs().map((d) => { const on = !!(this.state.mask & (1 << d.i)), x = Math.cos(d.phi) * (d.len - 6), y = Math.sin(d.phi) * (d.len - 6) * K;
        return { x: Math.round((x + 130) * pvs), y: Math.round((y + 100) * pvs), label: this.roadNames()[d.i].slice(0, 2), tip: this.roadNames()[d.i] + (on ? ' — 팔 있음' : ' — 팔 없음'),
          bg: on ? '#ffd84d' : 'rgba(13,15,19,0.85)', fg: on ? '#111111' : '#b4bac3', line: on ? '#ffd84d' : 'rgba(255,255,255,0.35)', toggle: () => this.setState({ mask: this.state.mask ^ (1 << d.i) }) }; }),
      toggleGhost: () => this.setState({ ghost: !this.state.ghost }), ghostBg: this.state.ghost ? 'rgba(255,216,77,0.12)' : 'rgba(255,255,255,0.04)', ghostFg: this.state.ghost ? '#ffd84d' : '#9aa1ab', ghostLine: this.state.ghost ? 'rgba(255,216,77,0.5)' : 'rgba(255,255,255,0.18)'
    };
    const setHub = (p) => this.setState({ hub: Object.assign({}, hubS, p), saved: false });
    const hub = { r: hubS.r || 40, rUp: () => setHub({ r: Math.min(70, (hubS.r || 40) + 4) }), rDown: () => setHub({ r: Math.max(12, (hubS.r || 40) - 4) }), h: hubS.h, up: () => setHub({ h: Math.min(N, (hubS.h || 0) + 1) }), down: () => setHub({ h: Math.max(0, (hubS.h || 0) - 1) }),
      topC: this.avgC(mat(hubS.top).faces.pz), topName: mat(hubS.top).name, sideC: this.avgC(mat(hubS.side).faces.py), sideName: mat(hubS.side).name,
      setTop: () => { if (this.state.active) setHub({ top: this.state.active }); }, setSide: () => { if (this.state.active) setHub({ side: this.state.active }); } };
    const yawN = ((Math.round(this.state.yaw) % 360) + 360) % 360;
    const unsafe = blocks.some(([x, y]) => { const i = reg.cells.get(x + ',' + y); return i && !i.safe; });
    return {
      evb: this.evBar(), curName: bpsState[cur].name, pv, hub, exportNote: this.state.exportNote, noteC: this.state.noteC,
      saveText: this.state.saved ? '저장됨' : '● 저장 안 됨',
      saveColor: this.state.saved ? '#6b7280' : '#f5b83d',
      save, exportNow, newBp, newFolder, delBp,
      an: this.animVals({ typeLabel: '도로', basicLabel: '일반 도로', animLabel: '애니메이션 도로', thumb: null, copy: (f) => f.map((b) => b.slice()), slotH: 26, slotHM: 22, slotHS: 18, maxLen: 4 }),
      bpTree, rootMove, rootUp, rootCancel, rootKey, chip,
      delBpColor: bpsState.length > 1 ? '#ff5d5d' : '#6b7280',
      N, setN, cap: reg.cells.size,
      warnText: (this.state.note ? this.state.note + '. ' : '') + (this.state.dropped ? '칸 수를 줄여 범위 밖 블록 ' + this.state.dropped + '개를 뺐습니다. ' : '') + (unsafe ? '회색 칸의 블록은 합류에 덮여 맵에서 보이지 않습니다' : ''),
      pats, plate, plateRim, hexOutline, faces,
      gridW: f(Math.min(1, cellPx / 12)),
      cursor: this.state.bpDrag ? 'copy' : this.state.dragging ? 'grabbing' : (active ? 'crosshair' : 'grab'),
      down, move, up, leave, ctx, key,
      orientLabel,
      activeText: active ? '활성 자재: ' + active.name + (this.state.placing ? ' — 설치 준비 중: R 옆으로 · T 위로 돌리고 떼면 설치' : ' — 우클릭을 누르고 있으면 설치 준비') : '자재를 눌러 활성화하세요',
      cube, cubeClick,
      yawLabel: yawN + '°',
      pitchLabel: Math.round(this.state.pitch) + '°',
      resetView: () => this.setState({ yaw: 45, pitch: this.fieldPitch() }),
      tree, delMat,
      delColor: this.state.active ? '#ff5d5d' : '#6b7280',
      hasExport: !!ex,
      ex: ex || { name: '', views: [], patterns: [], blocks: 0, unit: 0, merged: 0 },
      pitchField: Math.round(this.fieldPitch() * 10) / 10,
      closeExport: () => this.setState({ exported: null })
    };
  }
  // ───── 도로 (건물 타입 · 도로) — 도로 편집기 · 노드 화면이 같은 코드 ─────
  // 도로 = 가운데 합류(작은 정육각 기둥) + 여섯 방향의 팔.
  //   팔 하나의 설치 범위 = 그라운드 크기의 정육각형을 6등분한 정삼각형(중심 + 한 변). 블록(정육면체)으로 쌓고 프레임으로 움직일 수 있다
  //   정육면체 격자로는 6방향을 한 격자에 맞출 수 없다 → 팔은 자기 방향으로 돌린 격자를 쓰고, 격자가 어긋나는 가운데는 합류가 덮는다
  //   합류 = 한 변이 필드 한 변의 1/2인 정육각 기둥. 높이(블록 단위) · 윗면 · 옆면 자재를 정한다 — 모든 방향의 입출력을 받아 보내는 자리
  //   팔은 이웃(노드 · 노드 자원 · 다른 도로)이 있는 방향에만 그린다 → 이웃과 경계에서 자연스럽게 이어진다
  // 격자: 건물과 같이 그라운드 폭 160을 N칸으로 (N = 4~64, 기본 16). 칸 한 변 S = 160 / N, 가운데 c = N / 2
  //   팔 격자 (x, y): u = (x + 0.5 − c)·S (가로) · v = (y + 0.5 − c)·S (가운데에서 바깥으로). 블록 = [x, y, z, 자재, 방향]
  ROAD(N, r) { const n = N || 16; return { N: n, S: 160 / n, c: n / 2, AP: 80, HUB: r || 40 }; }
  // 이벤트 (건물 · 도로 공통): 노드 · 자원 상태에 따라 다른 모습. 디자인이 없는 이벤트는 기본 모습에 효과(빛 · 색)를 입힌다.
  //   방향 이벤트(도로 전용): 연결의 흐름이 합류로 들어오는 팔 · 나가는 팔 · 양방향 팔의 모습 (팔만)
  evtCommon() { return [{ id: 'run', name: '동작', c: '#1f9d55' }, { id: 'wait', name: '대기', c: '#e0a100' }, { id: 'stop', name: '정지', c: '#8b95a6' }, { id: 'fail', name: '실패', c: '#d33d52' }]; }
  evtDirs() { return [{ id: 'dir-in', name: '들어옴', c: '#2563eb', g: '→◎' }, { id: 'dir-out', name: '나감', c: '#7c3aed', g: '◎→' }, { id: 'dir-both', name: '양방향', c: '#0e7490', g: '⇄' }]; }
  // 상태 이벤트 디자인을 적용한 도로 (디자인이 있으면 팔 · 합류 · 애니메이션이 그것으로)
  roadEff(rd, ev) {
    const d = ev && rd.events && rd.events[ev];
    if (!d) return rd;
    return Object.assign({}, rd, { blocks: d.blocks || [], frames: d.frames || null, period: d.period || 1, hub: Object.assign({}, rd.hub, d.hub || {}) });
  }
  // 화소 수 바꾸기: 실제 크기는 그대로 새 격자로 다시 뽑는다 (기본 · 이벤트 디자인 모두, 합류 높이도)
  roadResample(rd, nN) {
    const N = rd.N || 16; if (N === nN) return rd;
    const k = nN / N, cells = this.roadCells(nN);
    const rs = (bl) => {
      if (!bl) return bl;
      const M = new Map(bl.map((b) => [b[0] + ',' + b[1] + ',' + b[2], b])), out = [], zs = new Set(bl.map((b) => b[2]));
      const zMax = zs.size ? Math.ceil((Math.max(...zs) + 1) * k) : 0;
      cells.forEach((key) => { const [x, y] = key.split(',').map(Number), ox = Math.floor((x + 0.5) / k), oy = Math.floor((y + 0.5) / k);
        for (let z = 0; z < zMax; z++) { const b = M.get(ox + ',' + oy + ',' + Math.floor((z + 0.5) / k)); if (b) out.push([x, y, z, b[3], b[4] || 0]); } });
      return out;
    };
    const des = (d) => Object.assign({}, d, { blocks: rs(d.blocks || []), frames: d.frames ? d.frames.map((f) => (f ? rs(f) : null)) : d.frames, hub: d.hub ? Object.assign({}, d.hub, { h: Math.round((d.hub.h || 0) * k) }) : d.hub });
    const o = des(rd); o.N = nN;
    if (rd.events) { o.events = {}; Object.keys(rd.events).forEach((e) => { o.events[e] = des(rd.events[e]); }); }
    return o;
  }
  roadUV(x, y, N) { const R = this.ROAD(N); return [(x + 0.5 - R.c) * R.S, (y + 0.5 - R.c) * R.S]; }
  // 설계할 수 있는 칸 = 칸 가운데가 정삼각형(중심 + 그라운드 육각형의 한 변) 안
  roadCells(N) {
    this._rcells = this._rcells || {};
    const n = N || 16; if (this._rcells[n]) return this._rcells[n];
    const R = this.ROAD(n), t30 = Math.tan(Math.PI / 6), out = new Set();
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) { const [u, v] = this.roadUV(x, y, n); if (v > 0 && Math.abs(u) <= v * t30 + 1e-6 && v <= R.AP + 1e-6) out.add(x + ',' + y); }
    return (this._rcells[n] = out);
  }
  // 합류(정육각, 한 변 = HUB, 꼭짓점이 팔의 가로 방향) 안에 가운데가 들어가는 칸 — 합류에 덮여 그리지 않는다
  roadUnderHub(x, y, N, r) { const R = this.ROAD(N, r), [u, v] = this.roadUV(x, y, N), au = Math.abs(u), av = Math.abs(v), h = R.HUB - 0.5; return av <= h * Math.sqrt(3) / 2 && Math.sqrt(3) * au + av <= Math.sqrt(3) * h; }
  // 여섯 방향 (지도 세계 좌표, 북쪽부터 시계 방향 — nbKeys와 같은 차례). len = 이웃 칸 중심까지의 절반
  roadDirs() {
    const K = this.geo().K;
    return [[0, -92 / K], [130, -46 / K], [130, 46 / K], [0, 92 / K], [-130, 46 / K], [-130, -46 / K]].map(([x, y], i) => ({ i, phi: Math.atan2(y, x), len: Math.hypot(x, y) / 2 }));
  }
  roadNames() { return ['북', '북동', '남동', '남', '남서', '북서']; }
  // 예전 모양(가로 10 · 세로 8 격자 · 키프레임 + fps)을 지금 모양(N 격자 · 칸 배열 16×초)으로
  roadNorm(rd) {
    if (!rd) return rd;
    const o = Object.assign({}, rd, { hub: Object.assign({ h: 1, top: 'm1', side: 'm1' }, rd.hub || {}) });
    if (!o.N) {
      o.N = 16;
      const mv = (f) => f ? f.map(([x, y, z, m, r]) => [x + 3, y + 8, z, m, r || 0]) : f;
      if (o.blocks) o.blocks = mv(o.blocks);
      if (o.frames) o.frames = o.frames.map(mv);
    }
    if (o.fps) {
      const keys = (o.frames || [[]]).filter(Boolean), n = keys.length, fps = Math.max(1, o.fps), T = Math.max(16, Math.ceil(16 * n / fps / 16) * 16);
      const slots = new Array(T).fill(null); keys.forEach((f, k) => { slots[Math.min(T - 1, Math.round(k * 16 / fps))] = f; });
      o.blocks = keys[0] || []; o.frames = n > 1 ? slots : null; o.period = T / 16; delete o.fps;
    }
    if (!o.blocks) o.blocks = (o.frames && o.frames[0]) || [];
    return o;
  }
  // 기본 도로 설계 (팔 한 개 · 합류). 16칸 격자 · 예전 좌표(ox = x − 3, oy = y − 8)로 그린다
  roadSamples() {
    const ok = this.roadCells(16);
    const fill = (pred, z, m) => { const out = []; ok.forEach((k) => { const [x, y] = k.split(',').map(Number); if (pred(x - 3, y - 8)) out.push([x, y, z, m, 0]); }); return out; };
    const stone = fill((x) => x >= 3 && x <= 6, 0, 'm15').map((b) => (b[0] - 3 === 4 || b[0] - 3 === 5 ? [b[0], b[1], 0, 'm1', 0] : b));
    const garden = fill((x) => x >= 4 && x <= 5, 0, 'm20').concat(fill((x, y) => (x === 3 || x === 6) && y >= 4 && y % 2 === 0, 0, 'm19'), fill((x, y) => (x === 2 || x === 7) && y === 6, 0, 'm16'), fill((x, y) => (x === 2 || x === 7) && y === 6, 1, 'm16'));
    const rail = (py) => fill((x) => x === 4 || x === 5, 0, 'm7').concat(fill((x, y) => (x === 3 || x === 6) && y >= 3, 0, 'm12'), py >= 0 ? fill((x, y) => (x === 4 || x === 5) && y === py, 1, 'm3') : []);
    const railSlots = new Array(32).fill(null); [3, 4, 5, 6, 7].forEach((py, k) => { railSlots[k * 4] = rail(py); });
    // 16칸으로 그린 뒤 기본 화소 48로 다시 뽑는다. 데이터 레일은 상태 · 방향 이벤트 예시를 함께 든다
    const failRail = rail(-1).map((b) => [b[0], b[1], b[2], b[3] === 'm7' ? 'm2' : b[3], 0]);
    const dirIn = rail(-1).concat(fill((x, y) => (x === 4 || x === 5) && y === 4, 1, 'm13')), dirOut = rail(-1).concat(fill((x, y) => (x === 4 || x === 5) && y === 6, 1, 'm18'));
    if (this._rsamp) return this._rsamp.map((r) => Object.assign({}, r));
    return (this._rsamp = [
      { id: 'stone', name: '돌길', N: 16, blocks: stone, frames: null, period: 1, hub: { h: 1, top: 'm15', side: 'm15', r: 40 } },
      { id: 'garden', name: '정원길', N: 16, blocks: garden, frames: null, period: 1, hub: { h: 1, top: 'm19', side: 'm20', r: 34 } },
      { id: 'rail', name: '데이터 레일', N: 16, blocks: railSlots[0], frames: railSlots, period: 2, hub: { h: 2, top: 'm22', side: 'm12', r: 40 },
        events: { fail: { blocks: failRail, frames: null, period: 1, hub: { top: 'm2' } }, 'dir-in': { blocks: dirIn, frames: null, period: 1 }, 'dir-out': { blocks: dirOut, frames: null, period: 1 } } }
    ].map((r) => this.roadResample(r, 48))).map((r) => Object.assign({}, r));
  }
  // 칸 배열 (16 × 초, 빈 칸 = 앞 프레임). 움직이지 않는 도로는 [blocks]
  roadFrames(rd) { return rd.frames && rd.frames.length ? rd.frames : [rd.blocks || []]; }
  roadFrameAt(rd, t) { const fr = this.roadFrames(rd); return fr[this.holdAt(fr, t || 0)] || rd.blocks || []; }
  // 블록 → 화면 다각형 (exportModel과 같은 면 합치기 · 무늬). proj(X, Y, Z) → [화면 x, 화면 y, 깊이], (ct, st) = 격자의 돌림
  voxFaces(blocks, proj, ct, st, prefix, mf, polys, patterns) {
    const mat = (id) => this.MATS.find((m) => m.id === id) || this.MATS[0];
    const occ = new Set(blocks.map((b) => b[0] + ',' + b[1] + ',' + b[2]));
    const has = (x, y, z) => occ.has(x + ',' + y + ',' + z);
    const DM = this.dirMap(), ids = ['pz', 'px', 'nx', 'py', 'ny'];
    const f2 = (v) => Math.round(v * 100) / 100;
    const groups = new Map();
    blocks.forEach(([x, y, z, m, o]) => ids.forEach((id) => {
      const [dx, dy, dz] = DM[id].n;
      if (has(x + dx, y + dy, z + dz)) return;
      if (id !== 'pz' && dx * st + dy * ct <= 0.001) return;
      const plane = this.planeOf(id, x, y, z), gk = id + '|' + plane + '|' + m + '|' + (o || 0);
      if (!groups.has(gk)) groups.set(gk, { id, plane, m, o: o || 0, cells: [] });
      groups.get(gk).cells.push(this.uvOf(id, x, y, z));
    }));
    let gi = 0;
    groups.forEach((g) => {
      const d = DM[g.id], fr = this.frameFor(g.o, g.id), pid = prefix + '-' + (gi++);
      const b0 = this.blockOnPlane(g.id, g.plane), c0 = [b0[0] + fr.c0[0], b0[1] + fr.c0[1], b0[2] + fr.c0[2]];
      const O = proj(...c0), Up = proj(c0[0] + fr.U[0], c0[1] + fr.U[1], c0[2] + fr.U[2]), Vp = proj(c0[0] + fr.V[0], c0[1] + fr.V[1], c0[2] + fr.V[2]);
      const lf = this.lightF(g.id, d.n[0] * ct - d.n[1] * st, d.n[0] * st + d.n[1] * ct);
      const px = this.matFrame(mat(g.m), mf ? mf[g.m] : 0)[fr.L];
      patterns.push(this.pattern(pid, px, lf, O, [Up[0] - O[0], Up[1] - O[1]], [Vp[0] - O[0], Vp[1] - O[1]]));
      const edge = this.scaleC(this.avgC(px), lf);
      const set = new Set(g.cells.map((q) => q[0] + ',' + q[1])), seen = new Set();
      g.cells.forEach((q0) => {
        const k0 = q0[0] + ',' + q0[1];
        if (seen.has(k0)) return;
        const comp = [], stack = [q0]; seen.add(k0);
        while (stack.length) {
          const q = stack.pop(); comp.push(q);
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => { const k = (q[0] + a) + ',' + (q[1] + b); if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push([q[0] + a, q[1] + b]); } });
        }
        let near = 0, cnt = 0, dd = '';
        this.outline(comp).forEach((loop) => {
          loop.forEach((p, i) => { const q = proj(...this.to3(g.id, g.plane, p[0], p[1])); near += q[2]; cnt++; dd += (i === 0 ? 'M' : 'L') + f2(q[0]) + ' ' + f2(q[1]) + ' '; });
          dd += 'Z ';
        });
        // 층: 윗면 = 그 면의 높이, 옆면 = 블록 높이 + 0.5 — 낮은 것부터 그려 납작한 길 위의 블록이 가려지지 않게
        const lvl = g.id === 'pz' ? g.plane : Math.min(...comp.map((q) => q[1])) + 0.5;
        polys.push({ d: dd.trim(), fill: 'url(#' + pid + ')', edge, near: near / cnt, lvl });
      });
    });
  }
  // 도로 한 장: mask = 팔을 그릴 방향(비트 i = roadDirs()[i]). opts.rot = 보기 돌림(라디안) · opts.uniform = 팔 길이를 이웃 거리에 맞추지 않음
  roadModel(rd, mask, fi, mf, prefix, opts) {
    const o = opts || {}, N = rd.N || 16, hr = (rd.hub && rd.hub.r) || 40, R = this.ROAD(N, hr), s = R.S, { K, C } = this.geo(), f2 = (v) => Math.round(v * 100) / 100;
    const mat = (id) => this.MATS.find((m) => m.id === id) || this.MATS[0];
    const cells = this.roadCells(N), keep = (bl) => bl.filter((b) => cells.has(b[0] + ',' + b[1]) && !this.roadUnderHub(b[0], b[1], N, hr));
    const blocks = keep(this.roadFrameAt(rd, fi || 0));
    // 방향 이벤트: 팔마다 흐름(들어옴 · 나감 · 양방향)에 맞는 디자인이 있으면 그 팔은 그것으로 (같은 칸 번호의 프레임)
    const armBlocks = (i) => { const k = o.kinds && o.kinds[i], d = k && rd.events && rd.events['dir-' + k]; if (!d) return blocks; const fr = d.frames && d.frames.length ? d.frames : [d.blocks || []]; return keep(fr[this.holdAt(fr, fi || 0)] || d.blocks || []); };
    const polys = [], patterns = [];
    this.roadDirs().forEach((dd) => {
      if (!(mask & (1 << dd.i))) return;
      const phi = dd.phi + (o.rot || 0), kv = o.uniform ? 1 : dd.len / R.AP, th = phi - Math.PI / 2, ct = Math.cos(th), st = Math.sin(th);
      const proj = (X, Y, Z) => { const wx = (X - R.c) * s, wy = (Y - R.c) * s * kv, wz = Z * s, xr = wx * ct - wy * st, yr = wx * st + wy * ct; return [xr, yr * K - wz * C, yr * C + wz * K]; };
      this.voxFaces(armBlocks(dd.i), proj, ct, st, prefix + '-a' + dd.i, mf, polys, patterns);
    });
    // 합류: 정육각 기둥 (평평한 위아래 · 꼭짓점이 좌우 — 필드와 같은 방향)
    const hub = rd.hub || { h: 1, top: 'm1', side: 'm1' }, H = Math.max(0, hub.h || 0) * s, rh = R.HUB, rot = o.rot || 0;
    if (hub.h > 0) {
      const P = (x, y, z) => { const xr = x * Math.cos(rot) - y * Math.sin(rot), yr = x * Math.sin(rot) + y * Math.cos(rot); return [xr, yr * K - z * C, yr * C + z * K]; };
      const V = [0, 1, 2, 3, 4, 5].map((k) => [rh * Math.cos(k * Math.PI / 3), rh * Math.sin(k * Math.PI / 3)]);
      const tm = mat(hub.top), sm = mat(hub.side), TS = 2 * s;
      for (let k = 0; k < 6; k++) {
        const a = V[k], b = V[(k + 1) % 6], na = k * Math.PI / 3 + Math.PI / 6 + rot, ny = Math.sin(na);
        if (ny <= 0.001) continue;
        const lf = this.lightF('px', Math.cos(na), ny), px = this.matFrame(sm, mf ? mf[sm.id] : 0).py, pid = prefix + '-hs' + k;
        const ex = (b[0] - a[0]) / rh * TS, ey = (b[1] - a[1]) / rh * TS;
        const O = P(a[0], a[1], H), Up = P(a[0] + ex, a[1] + ey, H), Vp = P(a[0], a[1], H - TS);
        patterns.push(this.pattern(pid, px, lf, O, [Up[0] - O[0], Up[1] - O[1]], [Vp[0] - O[0], Vp[1] - O[1]]));
        const q = [P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], H), P(a[0], a[1], H)];
        polys.push({ d: q.map((p, i) => (i ? 'L' : 'M') + f2(p[0]) + ' ' + f2(p[1])).join(' ') + ' Z', fill: 'url(#' + pid + ')', edge: this.scaleC(this.avgC(px), lf), near: q.reduce((u, p) => u + p[2], 0) / 4 + 1e3 });
      }
      const tp = this.matFrame(tm, mf ? mf[tm.id] : 0).pz, tid = prefix + '-ht';
      const O = P(-rh, -rh, H), Up = P(-rh + TS, -rh, H), Vp = P(-rh, -rh + TS, H);
      patterns.push(this.pattern(tid, tp, 1, O, [Up[0] - O[0], Up[1] - O[1]], [Vp[0] - O[0], Vp[1] - O[1]]));
      const top = V.map((v) => P(v[0], v[1], H));
      polys.push({ d: top.map((p, i) => (i ? 'L' : 'M') + f2(p[0]) + ' ' + f2(p[1])).join(' ') + ' Z', fill: 'url(#' + tid + ')', edge: this.scaleC(this.avgC(tp), 0.86), near: 2e3 });
    }
    // 그리는 차례: 팔(뒤 → 앞) 중 합류 뒤에 있는 것 → 합류 → 합류 앞의 팔. 합류의 깊이 = 가운데(0)
    const back = polys.filter((p) => p.near < 0), hubP = polys.filter((p) => p.near >= 1e3), front = polys.filter((p) => p.near >= 0 && p.near < 1e3);
    const byL = (a, b) => (a.lvl - b.lvl) || (a.near - b.near);
    back.sort(byL); front.sort(byL); hubP.sort((a, b) => a.near - b.near);
    const all = back.concat(hubP, front);
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    all.forEach((p) => { const n = p.d.match(/-?\d+(\.\d+)?/g) || []; for (let i = 0; i + 1 < n.length; i += 2) { const x = +n[i], y = +n[i + 1]; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); } });
    if (!all.length) { minx = -10; miny = -10; maxx = 10; maxy = 10; }
    return { paths: all.map((p) => ({ d: p.d, fill: p.fill, edge: p.edge })), patterns, bbox: [minx, miny, maxx, maxy], count: all.length, shadow: 'M0 0' };
  }
  // 한 벌을 그림 한 장(svg 문자열)으로 — 노드 화면은 이 문자열을 PNG로 굽고, 도로 편집기는 그대로 보인다
  roadSvg(v, X, Y, W, H, scale) {
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;'), f2 = (q) => Math.round(q * 100) / 100;
    const pats = v.patterns.map((pt) => '<pattern id="' + pt.id + '" patternUnits="userSpaceOnUse" width="1" height="1" patternTransform="' + pt.m + '">' +
      pt.rects.map((q) => '<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '" fill="' + q.fill + '"/>').join('') + '</pattern>').join('');
    const paths = v.paths.map((q) => '<path d="' + esc(q.d) + '" fill="' + q.edge + '" fill-rule="evenodd" stroke="' + q.edge + '" stroke-width="0.5" stroke-linejoin="round"/><path d="' + esc(q.d) + '" fill="' + q.fill + '" fill-rule="evenodd"/>').join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(W * scale) + '" height="' + Math.ceil(H * scale) + '" viewBox="' + [f2(X), f2(Y), f2(W), f2(H)].join(' ') + '"><defs>' + pats + '</defs>' + paths + '</svg>';
  }
  // 애니메이션 차례: 1초 = 16틱. 팔 칸 배열(건물과 같은 모양) × 쓰인 애니메이션 자재(16틱)의 조합이 바뀌는 순간만 모은다. fi = 칸 번호
  roadSeq(rd) {
    const frames = this.roadFrames(rd);
    const used = new Set(); frames.forEach((f) => f && f.forEach((q) => used.add(q[3]))); if (rd.hub) { used.add(rd.hub.top); used.add(rd.hub.side); }
    const am = this.MATS.filter((m) => used.has(m.id) && m.frames && this.keyCount(m.frames) > 1);
    const T = rd.frames && rd.frames.length ? Math.max(16, rd.frames.length) : 16, keys = [], seq = [], combos = [];
    for (let t = 0; t < T; t++) {
      const fi = rd.frames && rd.frames.length ? this.holdAt(rd.frames, t) : 0, mf = {};
      am.forEach((m) => { mf[m.id] = this.holdAt(m.frames, t % 16); });
      const key = fi + '|' + am.map((m) => mf[m.id]).join(',');
      let i = keys.indexOf(key); if (i < 0) { i = keys.length; keys.push(key); combos.push({ fi, mf }); }
      seq.push(i);
    }
    return { T, seq, combos, anim: combos.length > 1 };
  }
}
