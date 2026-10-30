
  // ═════ 전역 틀 — 화면 왼쪽 1/3 (글자 장 — 빈 화면 보드의 전역 틀을 그대로, 이름만 gf_ · _q_ 로) ═════
  // 텍스트 · 마스크 컴포넌트는 씬 글자 장의 칸 글자를 바꾼다(_q_gfMap → 씬 drawField 가 그 칸에 기록). 레거시 선만 맨 위 캔버스(data-gf)에. 그 밖은 투명
  // 뷰(트리 · 리프 · 리소스)는 화면 가운데 그대로 — 전역 틀이 왼쪽을 덮는다 (viewX0 = 컨트롤 구역 너비)
  viewX0() { return this._q_ctrlX || 0; }
  sceneCs() { return this._cs || 11; }   // 전역 틀 칸 = 씬 글자 장 칸
  sceneGrid() { const S = this._scr || { ox: 0, oy: 0 }; return { cw: this._cw || 7, ch: this._ch || 13, ox: S.ox || 0, oy: S.oy || 0, t: this._tt || 0 }; }
  gfStart() {
    const cv = document.querySelector('canvas[data-gf="scene"]'); if (!cv || !this._glyphs) return;
    this._q_cv = cv; this._q_ctx = cv.getContext('2d'); this._q_boot = performance.now(); this._q_last = 0;
    this._q_ro = new ResizeObserver(() => this.gf_sizeField()); this._q_ro.observe(cv);
    if (document.fonts && document.fonts.load) { document.fonts.load('700 12px "Geist Mono"').catch(() => {}); document.fonts.load('700 12px GmarketSans', '가').then(() => { this._fullRedraw = true; }).catch(() => {}); document.fonts.load('700 40px Geist').then(() => { if (this._live && this._q_ctx) this.gf_sizeField(); }).catch(() => {}); }
    this.gf_sizeField();
  }
  gfFrame(now) { if (!this._q_ctx) this.gfStart(); if (this._q_ctx) this.gf_drawField(now); }
  // 전역 틀이 받는 자리 — 글자 말고는 투명이라 영역으로 막지 않는다: 펼치기 전엔 '>_' 칸만, 펼친 뒤엔 로고 구역 · 지도 노드 · 맨 아래 'ESC 뒤로'
  gfLogoZone() { const on = this._q_lg && this._q_lg.on; return on ? this._q_zones && this._q_zones.logo : this._q_pz || (this._q_zones && this._q_zones.logo); }
  // 전역 틀을 펼친 동안 — 컨트롤 구역(왼쪽 1/4) 위의 누르기는 전역 틀만 받는다 (그 아래 뷰 · 다른 컴포넌트로 넘기지 않음). 마우스 위치(호버)는 그대로
  gfOver(x, y) { const L = this._q_lg; return !!(L && (L.on || L.open)) && x < this.viewX0(); }
  gfHit(x, y) {
    const Z = this.gfLogoZone(), cw = this._q_cw, ch = this._q_ch; if (!Z || !cw) return false;
    if (x >= Z.c0 * cw - cw && x <= Z.c1 * cw + cw && y >= Z.r0 * ch - ch && y <= Z.r1 * ch + ch) return true;
    if (!(this._q_lg && this._q_lg.open)) return false;
    if (Math.floor(y / ch) === this._q_rows - 3 && x >= 3 * cw && x < 11 * cw) return true;
    return !!this.gf_mapHitAt(x, y);
  }
  // 전역 틀 누르기(뗄 때) — 지도 노드: 누르기 · 두 번 누르기 (길게 누르기는 누르는 동안 걸음에서) / 로고: 내용 열기 · 닫기 / 맨 아래 ESC: 뒤로
  gfDown(x, y) { return this.gfHit(x, y) && this.gf_mapDown(x, y); }
  gfTap(x, y) {
    if (this._q_hold) { this.gf_mapUp(x, y); return; }
    if (this.gf_ctlTap(x, y)) return;   // 노드 제어 — 머리(모드 전환) · 목록 줄
    const Z = this.gfLogoZone(), cw = this._q_cw, ch = this._q_ch; if (!Z) return;
    if (x >= Z.c0 * cw - cw && x <= Z.c1 * cw + cw && y >= Z.r0 * ch - ch && y <= Z.r1 * ch + ch) { this._q_tapLogo = true; return; }
    if (Math.floor(y / ch) === this._q_rows - 3 && x >= 3 * cw && x < 11 * cw) { this.goBack(); return; }
  }
  // 지도 데이터 — 씬의 트리(계정 · 트리 · 하위 트리) · 트리마다의 리프(행성) · 리프마다의 리소스(위성). 형제는 같은 궤도
  sceneMap() {
    const sys = this.build(), N = Math.max(1, Math.min(12, this.props.planets ?? 6)), TP = this.TOPO ? this.TOPO() : null, key = sys.key + ':' + N + (TP ? ':' + TP.rev + ':' + TP.localId : '');
    if (this._smap && this._smap.key === key) return this._smap;
    const all = [], byId = {}, mk = (o) => { all.push(o); byId[o.id] = o; return o; };
    const conv = (nd, parent) => { const name = nd.depth === 0 ? '계정' : nd.label, o = mk({ id: 'T' + nd.id, ref: nd.id, name, parent, rid: nd.rid || '', kids: [], kind: nd.depth === 0 ? 'root' : 'tree', path: (parent ? parent.path : '') + '/' + name });
      sys.nodes.filter((m) => m.parent === nd).forEach((m) => o.kids.push(conv(m, o)));
      const LV = TP && nd.tpath ? TP.leaves(nd.tpath) : null;   // 실제 노드(Master 노드 목록) — 그 트리에 등록된 리프 · 없으면 시안 행성
      if (nd.depth > 0) for (let k = 0; k < (LV ? LV.length : N); k++) { const pn = LV ? LV[k].name : nd.label + '·' + String.fromCharCode(97 + k), L = mk({ id: 'P' + nd.id + ':' + pn, rid: LV ? LV[k].id : '', ref: nd.id, planet: pn, name: pn, parent: o, kids: [], kind: 'leaf', path: o.path + '/' + pn }); o.kids.push(L);
        for (const sat of this.SATS(pn)) L.kids.push(mk({ id: 'R' + nd.id + ':' + pn + ':' + sat.name, ref: nd.id, planet: pn, name: sat.name, parent: L, kids: [], kind: 'res', path: L.path + '/' + sat.name })); }   // 리프의 리소스(위성)
      return o; };
    const root = conv(sys.nodes[0], null);
    if (TP && TP.localId) { const me = all.find((n) => n.rid === TP.localId); if (me) me.local = true; }   // 이 GUI 를 띄운 노드
    return (this._smap = { key, root, all, byId });
  }
  // 지금 위치 — 리소스 뷰: 그 행성(리프) · 리프 뷰: 들어간 트리 · 트리 뷰: 초점 트리(처음엔 계정)
  sceneCur() { const M = this.sceneMap(); if (this._lv && this._leafId != null) { if (this._res && this._res.dir === 'in' && this._res.name) { const p = M.byId['P' + this._leafId + ':' + this._res.name]; if (p) return p; } return M.byId['T' + this._leafId] || M.root; } return M.byId['T' + (this._focus ? this._focus.id : 0)] || M.root; }
  sceneLevel() { return this._res && this._res.dir === 'in' ? 'res' : this._lv ? 'leaf' : 'tree'; }   // 지도 뷰 — 지금 뷰를 따른다
  sceneView() { return this._res && this._res.dir === 'in' ? '리소스 뷰' : this._lv ? '리프 뷰' : '트리 뷰'; }
  sceneKey() { return this.sceneCur().id + '|' + this.sceneView(); }
  // 워프 최고 속도에서 — 씬을 곧바로 목적지로 (어두운 막 아래, 배율 0 — 도착하며 커진다): 계정 → 트리 뷰 · 트리 → 리프 뷰 · 리프 → 그 트리의 리프 뷰 (리소스 진입은 navStep 이 이어 간다)
  sceneJump(n) {
    const now = performance.now(), TL = this.ENTER_TL();
    this._res = null; this._rs = null; this._resFlow = null; this._entL = null; this._entNow = null; this._entP = null; this._orbExt = null; this._hist = []; this._look = { yaw: 0, pitch: 0 }; this._par = { x: 0, y: 0 };
    if (this.state.resIn) this.setState({ resIn: false });
    if (n.kind === 'root') { this._lv = false; this._enter = null; this._focus = { id: 0, from: null }; this._seq = null; this.setState({ entered: false, stage: 'tree', focus: 0, hidden: true }); setTimeout(() => { if (this._live) this.play(); }, 30); return; }
    const tid = n.ref; this._leafId = tid; this._pl = null; this._focus = { id: tid, from: null, at: 0 };
    this._enter = { id: tid, dir: 'in', at: now - 1e6, tl0: TL.end, tl: TL.end, e: 1 }; this._lv = true;
    this._seq = null; this.setState({ entered: true, stage: 'leaf', focus: tid, hidden: true });
    setTimeout(() => { if (this._live) this.play(); }, 30);
  }
  // ───── 화면 전환 — 워프 (화면 전체, 소실점 = 화면 가운데 — 뷰와 같은 가운데. 칸은 씬 글자 장 칸 그대로. 전역 틀 글자는 그 위) ─────
  wsE() { return this._ws ? this._ws.e : 0; }
  wsTo(n) {
    const W = this._ws || (this._ws = { e: 0, tgt: 0, v: 0, S: [] }); if (W.tgt || W.e > 0) return;
    W.tgt = 1; W.dest = n; W.hold = 0;   // 가운데 목적지 글자는 띄우지 않는다
  }
  wsF() { return Math.min(this._w - 0, this._h) * 0.5; }
  wsNew(s, z) { const F = this.wsF(), ax = (this._w - 0) / 2 / F * 1.15, ay = this._h / 2 / F * 1.15; let x, y; do { x = (Math.random() * 2 - 1) * ax; y = (Math.random() * 2 - 1) * ay; } while (Math.hypot(x, y) < 0.04);
    s.x = x; s.y = y; s.z = z; s.c = (Math.random() * 6) | 0; s.b = 0.55 + Math.random() * 0.45; s.a = 0; s.f = 1; s.on = true; s.lv0 = 0.3 + Math.random() * 0.5; s.g = (Math.random() * this._glyphs.length) | 0; return s; }
  wsRadK(s) { const F = this.wsF(), vx0 = 0, rn = Math.min(1.2, Math.hypot(s.x / s.z * F, s.y / s.z * F) / Math.hypot((this._w - vx0) / 2, this._h / 2)); return 0.2 + 1.45 * Math.pow(rn, 1.4); }
  wsTw(st, now) { const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; return (this.props.motion ?? true) && !reduce ? 0.5 + 0.5 * Math.sin(now / 1000 * 1.4 * st + st * 9.0) : 0.75; }
  wsArr() { const n = this._cols * this._rows; if (!this._wh || this._wh.length !== n) { this._wh = new Float32Array(n); this._whc = new Uint8Array(n); this._whd = new Uint8Array(n); this._whg = new Uint8Array(n); this._wrg = new Uint8Array(n); this._wrn = new Float32Array(n); } }
  wsStep(now, dt) {
    const W = this._ws; if (!W || !this._star) return;
    if (W.tgt > W.e) W.e = Math.min(1, W.e + dt / 2200); else if (W.tgt < W.e) W.e = Math.max(0, W.e - dt / 1600);
    const e = W.e, v = Math.pow(e, 2.2); W.v = v;
    const cols = this._cols, vx0 = 0, F = this.wsF(), cx = vx0 + (this._w - vx0) / 2, cy = this._h / 2;
    if (e <= 0) { if (W.seeded) {   // 해제 끝 — 멈춘 별을 그 자리 · 그 글자 · 그 밝기 그대로 씬 글자 장 별로 (반짝임 위상이 맞는 st 를 고른다)
        for (const s of W.S) { if (!s.on || s.f < 0.5) continue; const c = Math.floor((cx + s.x / s.z * F) / this._cw), r = Math.floor((cy + s.y / s.z * F) / this._ch); if (c < 0 || r < 0 || c >= cols || r >= this._rows || c * this._cw < vx0) continue;
          const i = r * cols + c, tw = Math.min(1, Math.max(0, (s.lv0 - 0.3) / 0.5)); let best = 0.6, bd = 9; for (let k = 0; k < 240; k++) { const st = 0.2 + k / 240, d = Math.abs(this.wsTw(st, now) - tw); if (d < bd) { bd = d; best = st; } }
          this._star[i] = best; this._g[i] = s.g; }
        W.seeded = false; W.S = []; } return; }
    if (!W.seeded) {   // 진입 — 뷰 자리에 떠 있던 흰 별을 그 자리 그대로 3D 별로 (씬 글자 장에선 빼고 워프 칸이 이어 그린다)
      W.S = []; for (let i = 0; i < this._star.length; i++) { const st = this._star[i]; if (!st) continue; const px = (i % cols) * this._cw + this._cw / 2, py = ((i / cols) | 0) * this._ch + this._ch / 2; if (px < vx0 + this._cw || Math.hypot(px - cx, py - cy) < 6) continue;
        const z = 0.55 + Math.random() * 0.45; W.S.push({ x: (px - cx) / F * z, y: (py - cy) / F * z, z, c: (Math.random() * 6) | 0, b: 0.6 + st * 0.3, lv0: 0.3 + this.wsTw(st, now) * 0.5, g: this._g[i], a: 1, f: 1, on: true }); this._star[i] = 0; }
      W.nField = W.S.length; W.seeded = true; }
    if (W.tgt === 1 && e >= 1) { if (!W.hold) W.hold = now; else if (now - W.hold > 400) { this.sceneJump(W.dest); if (this._navS) { this._navS.phase = 'arrive'; this._navS.tiltHold = 0; } W.tgt = 0; } }
    const N = Math.max(W.nField, 840), want = Math.round(W.nField + (N - W.nField) * Math.min(1, v / 0.7) ** 2);
    let act = 0; for (const s of W.S) if (s.on) act++;
    for (let k = act; k < want; k++) { const s = W.S.find((q) => !q.on) || (W.S.push({}), W.S[W.S.length - 1]); this.wsNew(s, 0.7 + Math.random() * 0.3); }
    for (const s of W.S) if (s.on && s.a < 1) s.a = Math.min(1, s.a + dt / 400);
    if (W.tgt === 0) { let k = 0; for (const s of W.S) { if (!s.on) continue; if (k++ >= want) { s.f -= dt / 350; if (s.f <= 0) { s.on = false; s.f = 1; } } else if (s.f < 1) s.f = Math.min(1, s.f + dt / 350); } }
    const dz = v * dt * 0.0026; act = 0; for (const s of W.S) if (s.on) act++;
    for (const s of W.S) { if (!s.on) continue; s.z -= dz * this.wsRadK(s); const px = cx + s.x / s.z * F, py = cy + s.y / s.z * F;
      if (s.z < 0.04 || px < vx0 - 20 || px > this._w + 40 || Math.abs(py - cy) > this._h / 2 + 40) { if (act > want) { s.on = false; act--; } else this.wsNew(s, 0.85 + Math.random() * 0.15); } }
  }
  wsHeat() {
    const W = this._ws; this.wsArr(); const cols = this._cols, rows = this._rows, cw = this._cw, ch = this._ch, heat = this._wh, hc = this._whc, hd = this._whd, hg = this._whg, LN = []; heat.fill(0);
    const v = W.v, F = this.wsF(), vx0 = 0, cx = vx0 + (this._w - vx0) / 2, cy = this._h / 2, TR = 0.6 * v, cl = (x) => Math.min(1, Math.max(0, x)), c0min = Math.ceil(vx0 / cw);
    for (const s of W.S) { if (!s.on) continue;
      const k0 = this.wsRadK(s), hx = cx + s.x / s.z * F, hy = cy + s.y / s.z * F, zt = Math.min(1.3, s.z + TR * (0.6 + s.z) * k0), tx = cx + s.x / zt * F, ty = cy + s.y / zt * F;
      const born = s.a < 1 ? Math.sin(s.a * Math.PI) : 0, dep = cl(0.45 + (1 - s.z) * 0.8) * s.b, kk = cl(v / 0.25);
      const bright = (s.lv0 + (dep - s.lv0) * kk) * s.a * s.f * (1 - 0.45 * cl(v * 2) * (1 - cl(k0 - 0.2)));
      if (bright < 0.04) continue;
      let a = Math.atan2(hy - ty, hx - tx) * 180 / Math.PI; if (a < 0) a += 180;
      const dch = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 2 : a < 112.5 ? 1 : 3;
      const C0 = tx / cw, R0 = ty / ch, C1 = hx / cw, R1 = hy / ch, n = Math.max(1, Math.ceil(Math.max(Math.abs(C1 - C0), Math.abs(R1 - R0))));
      for (let k = 0; k <= n; k++) { const f = k / n, c = Math.floor(C0 + (C1 - C0) * f), r = Math.floor(R0 + (R1 - R0) * f);
        if (c < c0min || r < 0 || c >= cols || r >= rows) continue;
        const i = r * cols + c, hv = bright * (n === 1 ? 1 : f ** 1.3) + (k === n ? born * 0.5 : 0);
        if (hv > heat[i] || (k === n && hv >= heat[i] * 0.98)) { heat[i] = hv; hc[i] = s.c; hd[i] = k === n ? 4 : dch; hg[i] = s.g; } }
      if (v > 0.2 && n > 2) LN.push([Math.max(vx0, tx), ty, hx, hy, s.c, bright * cl((v - 0.2) / 0.5)]);
    }
    return LN;
  }
  wsCol(v) { const Wc = [236, 241, 255], blue = [[120, 162, 255], [86, 128, 255], [150, 188, 255], [100, 146, 250], [176, 206, 255], [70, 112, 240]], k = Math.min(1, Math.max(0, (v - 0.04) / 0.6)), s = k * k * (3 - 2 * k); return blue.map((b) => (s > 0 ? this.lerpHsv(Wc, b, s) : Wc)); }
  // 워프 그리기 (전역 틀 캔버스 위, 뷰 자리만) — 어두운 막(최고 속도에선 거의 가림 · 가운데 소실점 더 어둡게) → 가는 선 → 꼬리 칸(바탕을 칠하고 글자)
  wsDraw(ctx, now) {
    const W = this._ws, LNs = this.wsHeat(), WE = W.e, WV = W.v, HD = this.props.holeDim ?? 0.6, dk = Math.min(1, WE / 0.2), vx0 = 0, cx = vx0 + (this._w - vx0) / 2, cy = this._h / 2, cols = this._cols, rows = this._rows, cw = this._cw, ch = this._ch, G = this._glyphs;
    const base = Math.min(0.9, (1 - HD) * dk + (0.88 - (1 - HD)) * Math.min(1, WV / 0.8)), core = Math.min(0.95, base + 0.5 * dk * Math.min(1, WV * 1.4 + 0.3));
    { const R = Math.hypot(cx - vx0, cy), gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, 'rgba(1,2,8,' + core.toFixed(3) + ')'); gr.addColorStop(0.14, 'rgba(1,2,8,' + (base + (core - base) * 0.35).toFixed(3) + ')'); gr.addColorStop(0.4, 'rgba(1,2,8,' + base.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(1,2,8,' + base.toFixed(3) + ')');
      ctx.fillStyle = gr; ctx.fillRect(vx0, 0, this._w - vx0, this._h); }
    const SC = this.wsCol(WV);
    if (LNs.length) { ctx.save(); ctx.beginPath(); ctx.rect(vx0, 0, this._w, this._h); ctx.clip(); ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      for (const [x0, y0, x1, y1, c, a] of LNs) { if (a < 0.03) continue; const Cc = SC[c], gl = ctx.createLinearGradient(x0, y0, x1, y1), rgb = Math.round(Cc[0]) + ',' + Math.round(Cc[1]) + ',' + Math.round(Cc[2]);
        gl.addColorStop(0, 'rgba(' + rgb + ',0)'); gl.addColorStop(1, 'rgba(' + rgb + ',' + Math.min(1, a * 1.1).toFixed(3) + ')'); ctx.strokeStyle = gl; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
      ctx.restore(); }
    const FN = '500 ' + Math.round(this._cs * 0.86) + 'px "Geist Mono", ui-monospace, monospace', FB = FN.replace(/^\d+ /, '700 ');
    const DCH = ['-', '|', '\\', '/'], dkB = 1 - base, BG = [[5, 8, 27].map((c) => c * dkB), [3, 5, 16].map((c) => c * dkB)], groups = new Map(), wh = this._wh, hc = this._whc, hd = this._whd, hg = this._whg, rg = this._wrg, rn = this._wrn, c0min = Math.ceil(vx0 / cw);
    for (let i = 0; i < wh.length; i++) { if (wh[i] <= 0.16 || (i % cols) < c0min) continue; const lvl = Math.min(7, (wh[i] * 8) | 0), key = (hc[i] * 16 + lvl * 2 + (WV > 0.08 && (hd[i] === 4 || lvl >= 6) ? 1 : 0)) * 2 + (((i / cols) | 0) / rows < 0.46 ? 0 : 1); let a = groups.get(key); if (!a) { a = []; groups.set(key, a); } a.push(i); }
    ctx.textBaseline = 'top';
    groups.forEach((list, key) => { const bg = BG[key & 1], k2 = key >> 1, c = SC[k2 >> 4], lvl = (k2 >> 1) & 7, bold = k2 & 1, al = Math.min(1, 0.12 + lvl * 0.12);
      const css = 'rgb(' + Math.round(bg[0] + (c[0] - bg[0]) * al) + ',' + Math.round(bg[1] + (c[1] - bg[1]) * al) + ',' + Math.round(bg[2] + (c[2] - bg[2]) * al) + ')', bgc = 'rgb(' + Math.round(bg[0]) + ',' + Math.round(bg[1]) + ',' + Math.round(bg[2]) + ')';
      ctx.font = bold ? FB : FN;
      for (const i of list) { let gl; if (hd[i] === 4 && WV < 0.06) gl = G[hg[i]]; else if (hd[i] === 4) { if (now >= rn[i]) { rg[i] = (Math.random() * G.length) | 0; rn[i] = now + (16 + 520 * (1 - WV) * (1 - WV)) * (0.6 + Math.random() * 0.8); } gl = G[rg[i]]; } else gl = DCH[hd[i]];
        const X = (i % cols) * cw, Y = ((i / cols) | 0) * ch; ctx.fillStyle = bgc; ctx.fillRect(X, Y, cw, ch); ctx.fillStyle = css; ctx.fillText(gl, X, Y); if (bold) { ctx.strokeStyle = css; ctx.lineWidth = 0.6; ctx.strokeText(gl, X, Y); } } });
  }
  // ───── 노드 이동 (지도 두 번 누르기) — 떠나기 → 워프 → 도착 [→ 리소스 카메라]. 그동안 마우스 위치 피드백(시차 · 호버 · 시선)은 끄고, 다 끝난 뒤 다시 따라간다 ─────
  //   떠나기 — 트리 · 리프 뷰: 궤도 사이 빈 틈에 초점을 잡고 궤도가 화면 밖으로 나갈 때까지 확대(1.2초, 절반쯤에서 워프 시작)
  //            리소스 뷰: 먼저 시선을 위로(행성과 겹치지 않게, 0.7초) → 화면 가운데로 확대
  //   도착 — 크기 0 에서 워프 감속(속도 v)에 맞춰 커진다: 배율 = 1 − v. 리소스 뷰로 가면 그 리프 뷰로 도착한 뒤(배율 0.9 쯤) 기존 리소스 진입(카메라 이동)으로 끊김 없이 이어 간다
  // 전환 중인가 — 어떤 전환이든(노드 이동 · 워프 · 궤도 비행 · 트리 초점 이동 · 트리 ↔ 리프 진입 · 나가기 · 리소스 진입 · 나가기 · 뷰 생성) 마우스 피드백(시차 · 시선 · 호버 · 위성 호버)을 끈다. 끝나면 부드럽게 다시 따라감
  transMove() {
    const E = this._enter, R = this._res;
    return !!(this._navS || this._orb || (this._ws && (this._ws.tgt || this._ws.e > 0)) || this._entL || (this._focus && this._focus.from)
      || (E && !this._lv && (E.dir === 'out' || E.tl < this.ENTER_TL().end)) || (R && (R.dir === 'out' || (this._rs && this._rs.animating) || (R.e != null && R.e < 1))) || this._vBusy);
  }
  NAV_TL() { return { tilt: 700, dive: 1200, warpAt: 0.5, tiltRad: 0.75 }; }
  // 노드 이동 시작 — 먼저 마우스 피드백만 끄고(정렬), 시차 · 시선이 기본 자리로 돌아오면 그때 이동을 시작한다 (피드백이 풀리는 움직임과 이동이 겹쳐 끊겨 보이지 않게)
  navStart(n) {
    if (this._navS || (this._ws && (this._ws.tgt || this._ws.e > 0))) return;
    if (n.kind === 'leaf' && this._lv && n.ref === this._leafId && this._res && this._res.dir === 'in' && this._res.name === n.planet) return;   // 이미 거기
    // 리소스 뷰 → 그 행성이 속한 리프 뷰(자식 → 부모) — 화면 전환(워프) 대신, 리소스 뷰를 빠져나오는 카메라 이동(exitRes)을 그대로 쓴다 (정렬 대기도 없이 바로)
    if (n.kind === 'tree' && this._lv && n.ref === this._leafId && this._res && this._res.dir === 'in' && !this._orb) { this.exitRes(); return; }
    this._navS = { phase: 'align', t0: performance.now(), dest: n, lk: null };
  }
  // 정렬 끝 — 시차가 0 에 가깝고 시선이 멈췄으면(또는 0.9초) 실제 이동을 시작
  navAligned(now) {
    const N = this._navS, par = this._par || { x: 0, y: 0 }, LK = this._look || { yaw: 0, pitch: 0 };
    const lk = [LK.yaw, LK.pitch], still = N.lk && Math.abs(lk[0] - N.lk[0]) < 2e-4 && Math.abs(lk[1] - N.lk[1]) < 2e-4; N.lk = lk;
    return (Math.hypot(par.x, par.y) < 1.2 && still) || now - N.t0 > 900;
  }
  navBegin(n) {
    this._navS = null;
    const now = performance.now();
    if (n.kind === 'leaf' && this._lv && n.ref === this._leafId && !this._entL) {   // 같은 트리(지금 항성계)의 리프
      const RI = this._res && this._res.dir === 'in' ? this._res : null; if (RI && RI.name === n.planet) return;
      if (RI && (RI.e || 0) > 0.5) { this.orbStart(n); return; }   // 리소스 뷰에서 — 궤도 비행
      this.enterRes(n.planet); this._navS = { phase: 'res', t0: now, dest: n }; return;   // 리프 뷰에서 자기 자식 리프로 — 행성을 직접 눌렀을 때와 같은 리소스 진입
    }
    const w = this._sw || this._w, h = this._sh || this._h, diag = Math.hypot(w, h), res = !!(this._res && this._res.dir === 'in');
    let g = [w / 2, h / 2], K = 10;
    if (!res) { const G = this._lv ? this.gapLeaf() : this.gapTree(); if (G) { g = [G.x, G.y]; K = Math.min(90, Math.max(6, 1.3 * diag / Math.max(6, G.d / 2))); } }
    this._navS = { phase: res ? 'tilt' : 'dive', t0: now, dest: n, K, gx: g[0], gy: g[1], warped: false, tiltHold: 0 };
  }
  navStep(now) {
    const N = this._navS; this._navTilt = 0; if (!N) { this._navZ = null; return; }
    const T = this.NAV_TL(), w = this._sw || this._w, h = this._sh || this._h, ss = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    if (N.phase === 'align') { this._navZ = null; if (this.navAligned(now)) this.navBegin(N.dest); return; }   // 정렬 — 피드백만 끄고 기다린다
    if (N.phase === 'orbit') { this._navZ = null; const O = this._orb;   // 궤도 비행 — 끝은 여기서(그리기 전에) 정한다: 한 프레임 안에서 행성 계산이 여러 번 불려도 모두 같은 카메라(리소스 뷰)를 보게
      if (O && O.dur && now - O.t0 >= O.dur) { this._orb = null; this._res = { name: O.to, dir: 'in', at: now - 1e5, e0: 1, e: 1 }; this._rs = { name: O.to, e: 1, animating: false }; this.setState({ resIn: true, resName: O.to }); }
      if (!this._orb) this._navS = null; return; }
    if (N.phase === 'tilt') { const p = (now - N.t0) / T.tilt; this._navTilt = T.tiltRad * ss(p); this._navZ = null; if (p >= 1) { N.phase = 'dive'; N.t0 = now; N.tiltHold = T.tiltRad; } return; }
    this._navTilt = N.tiltHold || 0;
    if (N.phase === 'dive') { const p = Math.min(1, (now - N.t0) / T.dive); this._navZ = { k: Math.exp(Math.log(N.K) * Math.pow(p, 1.8)), gx: N.gx, gy: N.gy }; if (p >= T.warpAt && !N.warped) { N.warped = true; this.wsTo(N.dest); } return; }
    if (N.phase === 'arrive') { const W = this._ws, v = W ? W.v : 0; this._navZ = { k: Math.max(1e-3, 1 - v), gx: w / 2, gy: h / 2 };
      if (N.dest.kind === 'leaf' && !N.resGo && W && W.e < 0.35) { N.resGo = true; this.enterRes(N.dest.planet); }
      if (!W || W.e <= 0) { this._navZ = null; if (N.dest.kind === 'leaf') { N.phase = 'res'; if (!N.resGo) { N.resGo = true; this.enterRes(N.dest.planet); } } else this._navS = null; }
      return; }
    if (N.phase === 'res') { const R0 = this._res; if (!R0 || (this._rs && !this._rs.animating) || (R0.dir === 'in' && now - R0.at > 2400)) this._navS = null; }   // 진입 끝 — 그리기가 쉬어 _rs 가 멈춰 있어도 시간으로 끝낸다(안 그러면 다음 이동이 막힌다)
  }
  // 트리 뷰의 빈 틈 — 초점 트리의 자식 궤도 사이(가장 안쪽은 노드 몸체 바깥 ~ 첫 궤도) 중 화면 안에서 가장 넓은 틈, 각도는 자식 노드에서 가장 먼 쪽
  gapTree() {
    const sys = this.build(), fid = this._focus ? this._focus.id : 0, fn = sys.nodes[fid] || sys.nodes[0], H = this._hits, S = this._lastS; if (!H || !S || !H[fid]) return null;
    const c = H[fid], kids = sys.nodes.filter((m) => m.parent === fn); if (!kids.length) return null;
    const rs = [...new Set(kids.map((m) => m.orbit))].sort((a, b) => a - b), cand = []; let prev = rs.length > 1 ? rs[0] : c.r / S * 1.8; for (const r of rs) { if (r > prev) cand.push([prev, r]); prev = r; }   // 궤도 사이만 (궤도가 하나면 몸체 ~ 궤도)
    const lim = 0.46 * Math.min(this._sw || this._w, this._sh || this._h); let best = null;
    for (const [a, b] of cand) { const mid = (a + b) / 2 * S, d = (b - a) * S; if (mid > lim) continue; if (!best || d > best.d) best = { mid, d }; }
    if (!best) return null;
    const angs = kids.map((m) => Math.atan2(H[m.id].y - c.y, H[m.id].x - c.x)); let ba = 0, bs = -1;
    for (let k = 0; k < 72; k++) { const a = k / 72 * Math.PI * 2; let s = Math.PI; for (const q of angs) s = Math.min(s, Math.abs(((a - q + Math.PI * 3) % (Math.PI * 2)) - Math.PI)); s += 0.15 * Math.abs(Math.cos(a)); if (s > bs) { bs = s; ba = a; } }
    return { x: c.x + Math.cos(ba) * best.mid, y: c.y + Math.sin(ba) * best.mid, d: best.d };
  }
  // 리프 뷰의 빈 틈 — 행성 궤도 사이(항성 가까이 ~ 첫 궤도 포함)를 화면에 투영해, 행성에서 멀고 틈이 넓은 자리
  gapLeaf() {
    const PN = this._pnLast; if (!PN) return null; const C = PN.C, Rs = PN.Rs.slice().sort((a, b) => a - b), cand = []; let prev = Rs.length > 1 ? Rs[0] : PN.rIn; for (const r of Rs) { if (r > prev) cand.push([prev, r]); prev = r; }   // 궤도 사이만
    const W = this._sw || this._w, Hh = this._sh || this._h; let best = null;
    for (const [a, b] of cand) for (let k = 0; k < 48; k++) { const an = k / 48 * Math.PI * 2, rm = (a + b) / 2, P1 = this.proj(C, [Math.cos(an) * a, Math.sin(an) * a, 0]), P2 = this.proj(C, [Math.cos(an) * b, Math.sin(an) * b, 0]), Pm = this.proj(C, [Math.cos(an) * rm, Math.sin(an) * rm, 0]);
      if (Pm[0] < 60 || Pm[0] > W - 60 || Pm[1] < 60 || Pm[1] > Hh - 60) continue;
      const d = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]); let near = Math.hypot(PN.sc[0] - Pm[0], PN.sc[1] - Pm[1]) - PN.sr * 1.5; for (const o of PN.pl) near = Math.min(near, Math.hypot(o.x - Pm[0], o.y - Pm[1]) - o.r);   // 항성 · 행성에서 멀리
      const sc = Math.min(d, Math.max(0, near) * 2) * (1 - 0.6 * Math.hypot(Pm[0] - W / 2, Pm[1] - Hh / 2) / Math.hypot(W / 2, Hh / 2)); if (!best || sc > best.sc) best = { sc, x: Pm[0], y: Pm[1], d }; }   // 화면 가운데에 가까운 틈을 더 고른다
    return best;
  }
  // ───── 같은 트리 안의 리프로 — 궤도 비행 (워프 대신, 리소스 뷰에서) ─────
  //   카메라는 다른 행성처럼 항성을 중심으로 궤도를 따라 돈다. 항성 둘레 극좌표(공전축 둘레 각 φ · 반지름 r · 높이 z)로 길을 짠다:
  //     시간 · 최고 속도 제한 없음 — 속도 0 에서 고정 가속도(ORB_A)로 계속 빨라지다가, 도착할 즈음 더 큰 고정 감속도(ORB_D = 2배)로 감속해 0 에서 멈춘다
  //     φ 는 공전 방향으로만 나아가고(최소 0.4 rad) · r 과 z 는 출발 → 목표로 고르게 · 가운데에서 공전면 위로 살짝 떠올라(다른 행성을 피해) 내려앉는다
  //     → 항성 쪽으로 질러가는 현(직선)이 없고, 꺾이는 곳 없이 한 방향으로 돈다
  //   출발 · 도착 카메라 = 출발 행성 · 목표 행성의 리소스 카메라(매 프레임 새로 — 두 행성은 계속 공전). φ 진행 s 가 0 이면 출발 행성 좌표계, 1 이면 목표 행성 좌표계 그대로
  //   바라보는 쪽 — 움직이는 동안은 길 앞쪽 궤도 위의 점(항성 쪽으로 당김, 후반엔 목표 행성), 빠르기에 맞춰 출발 · 도착 구도와 섞는다(가속 · 감속 구간). 섞기 전 구도는 그 자리 궤도 좌표계(지름 · 접선 · 공전축)로 나타내 둘 사이를 구면 보간 → 돌면서도 늘 공전 방향을 본다
  ORB_A() { return 0.0006; }   // 궤도 비행 가속도 (세계 단위 / ms², 고정)
  ORB_D() { return 0.0012; }   // 궤도 비행 감속도 — 가속도의 2배 (도착할 즈음 감속)
  orbStart(n) {
    const now = performance.now();
    this._orb = { to: n.planet, from: this._res ? this._res.name : null, t0: now };
    this._res = null; this._rs = null; this._satE = null; if (this.state.resIn) this.setState({ resIn: false });
    this._navS = { phase: 'orbit', t0: now, dest: n, K: 1, gx: 0, gy: 0, tiltHold: 0 };
  }
  orbNow(world, Fr) {
    const O = this._orb; if (!O) return null;
    const now = performance.now(), B = world.find((x) => x.p.name === O.to), A = (O.from && world.find((x) => x.p.name === O.from)) || B; if (!B) return null;
    const CA = this.camOf(Fr, A, 1), CB = this.camOf(Fr, B, 1);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
    if (!O.ax) {   // 공전축 — 두 행성 공전면 법선의 평균. 기준 방향 e1 · e2 는 공전 방향으로 φ 가 늘게
      const ax = nrm([A.N[0] + B.N[0], A.N[1] + B.N[1], A.N[2] + B.N[2]]), u = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], d0 = dot(u, ax);
      const e1 = nrm([u[0] - ax[0] * d0, u[1] - ax[1] * d0, u[2] - ax[2] * d0]); let e2 = cross(ax, e1);
      if (dot(cross(A.W, A.T), ax) < 0) e2 = [-e2[0], -e2[1], -e2[2]];
      Object.assign(O, { ax, e1, e2 });
    }
    const { ax, e1, e2 } = O;
    const pol = (P) => { const z = dot(P, ax), x = dot(P, e1), y = dot(P, e2); return { ph: Math.atan2(y, x), r: Math.hypot(x, y), z }; };
    const fr = (ph) => { const c = Math.cos(ph), sn = Math.sin(ph); return [[e1[0] * c + e2[0] * sn, e1[1] * c + e2[1] * sn, e1[2] * c + e2[2] * sn], [-e1[0] * sn + e2[0] * c, -e1[1] * sn + e2[1] * c, -e1[2] * sn + e2[2] * c], ax]; };   // 지름 · 접선 · 축
    const loc = (v, F3) => [dot(v, F3[0]), dot(v, F3[1]), dot(v, F3[2])], glob = (l, F3) => [0, 1, 2].map((i) => F3[0][i] * l[0] + F3[1][i] * l[1] + F3[2][i] * l[2]);
    const pa = pol(CA.P), pb = pol(CB.P);
    if (O.dur == null) {
      let d = wrap(pb.ph - pa.ph); while (d < 0.4) d += Math.PI * 2;   // 공전 방향으로만 (최소 0.4 rad)
      O.rel0 = pb.ph - pa.ph; O.dPh = A === B ? 0 : d; O.t0 = now;
      // 시간 — 제한 없이 거리로: 길이 L(호 + 반지름 · 높이 차) ÷ 순항 속도 + 가속 · 감속. 가까우면 짧게, 멀면(바로 뒤 행성 = 거의 한 바퀴) 오래 걸려도 같은 빠르기로
      const L = Math.hypot((pa.r + pb.r) / 2 * O.dPh, pb.r - pa.r, pb.z - pa.z), AC = this.ORB_A(), AD = this.ORB_D(), Vp = Math.max(1e-4, Math.sqrt(L / (0.75 * (1 / AC + 1 / AD))));   // 최고 속도 제한 없음 — 고정 가속도(ORB_A)로 빨라지다가, 더 큰 고정 감속도(ORB_D)로 멈출 수 있는 지점에서 곧바로 감속
      O.Ta = 1.5 * Vp / AC; O.Td = 1.5 * Vp / AD; O.L = L; O.Vp = Vp; O.dur = A === B ? 1 : O.Ta + O.Td;
      O.lift = 0.16 * Math.max(pa.r, pb.r) * Math.min(1, O.dPh / (Math.PI / 2));   // 가운데에서 떠오르는 높이 — 멀리 갈수록 (최대 궤도 반지름의 16%)
    }
    // 진행 s — 부드럽게 가속(ramp) → 같은 빠르기로 순항 → 부드럽게 감속. 순항 빠르기 = 1 / (dur − ramp)
    // 진행 s — 빠르기 곡선: 가속 구간 v = Vp · smoothstep(t / Ta) → 감속 구간 v = Vp · smoothstep((dur − t) / Td). 최대 가속도 = ORB_A · 최대 감속도 = ORB_D
    const k = Math.min(1, (now - O.t0) / O.dur), tt = k * O.dur, Gr = (x) => x * x * x - x * x * x * x / 2;
    const s = O.dur <= 1 ? 1 : tt < O.Ta ? O.Vp * O.Ta * Gr(tt / O.Ta) / O.L : 1 - O.Vp * O.Td * Gr((O.dur - tt) / O.Td) / O.L;
    if (k >= 1) return { C: CB };
    const D = O.dPh + wrap((pb.ph - pa.ph) - O.rel0), at = (q) => glob([pa.r + (pb.r - pa.r) * q, 0, pa.z + (pb.z - pa.z) * q + O.lift * Math.sin(Math.PI * q)], fr(pa.ph + D * q));
    const ph = pa.ph + D * s, F3 = fr(ph), FA = fr(pa.ph), FB = fr(pb.ph);
    const P = at(s);
    // 이동 중 바라볼 점 — 접선(궤도 바깥 우주)이 아니라 길 앞쪽 궤도 위의 점(최대 0.5 rad 앞, 떠오른 높이는 빼고 공전면 높이 — 떠오르면 그만큼 숙여 봄)을
    //   항성 쪽으로 25% 당긴 곳 → 항성과 앞의 행성들이 화면에 남는다. 후반(진행 50% → 90%)엔 목표 행성 쪽으로 옮겨 간다
    const lead = Math.min(0.5, D * (1 - s)), rq = pa.r + (pb.r - pa.r) * Math.min(1, s + lead / Math.max(1e-6, D)), zq = pa.z + (pb.z - pa.z) * Math.min(1, s + lead / Math.max(1e-6, D));
    const LP = glob([rq * 0.75, 0, zq * 0.75], fr(ph + lead)), wB = ((x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); })((s - 0.5) / 0.4);
    const LT = [LP[0] + (B.W[0] - LP[0]) * wB, LP[1] + (B.W[1] - LP[1]) * wB, LP[2] + (B.W[2] - LP[2]) * wB], MV = nrm([LT[0] - P[0], LT[1] - P[1], LT[2] - P[2]]);
    // 바라보는 쪽 — 빠르기에 맞춰 이동 방향으로: 가속하며 출발 구도 → 이동 방향, 순항 중엔 늘 이동 방향, 감속하며 이동 방향 → 도착 구도 (w = 지금 빠르기 / 순항 빠르기)
    const ssm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }, w = tt < O.Ta ? ssm(tt / O.Ta) : ssm((O.dur - tt) / O.Td);
    const sl = (a, b, t) => { const c = Math.max(-1, Math.min(1, dot(a, b))); if (c > 0.9995) return nrm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); const om = Math.acos(c), so = Math.sin(om), wa = Math.sin((1 - t) * om) / so, wb = Math.sin(t * om) / so; return nrm([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]); };
    const F0 = nrm(glob(sl(loc(CA.F, FA), loc(CB.F, FB), s), F3)), U0 = glob(sl(loc([-CA.Dn[0], -CA.Dn[1], -CA.Dn[2]], FA), loc([-CB.Dn[0], -CB.Dn[1], -CB.Dn[2]], FB), s), F3);
    const F = sl(F0, MV, w), du = dot(ax, F), Um = nrm([ax[0] - F[0] * du, ax[1] - F[1] * du, ax[2] - F[2] * du]), U = sl(nrm(U0), Um, w);   // 위쪽 — 이동 중엔 공전축 쪽
    const R = nrm(cross(U, F)), Dn = cross(R, F), f = Math.exp(Math.log(CA.f) + (Math.log(CB.f) - Math.log(CA.f)) * s);
    return { C: { P, F, R, Dn, f, cx: CA.cx + (CB.cx - CA.cx) * s, cy: CA.cy + (CB.cy - CA.cy) * s } };
  }


