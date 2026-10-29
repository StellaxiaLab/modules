# 통합 화면(씬) + 전역 틀 — mkscene.py 다음에 실행. scene_base.html(= mkscene 출력)과 Field.dc.html(전역 틀)을 묶어 Scene.dc.html 로
import re
import os
d=os.path.dirname(os.path.abspath(__file__))+'/'   # web/design/build/
OUT=d+'../'                                       # web/design/ — 캔버스 보드
S=open(d+'scene_base.html').read(); F=open(OUT+'Field.dc.html').read()
# ── 전역 틀 클래스 몸통
body=F[F.index('class Component extends DCLogic {\n')+len('class Component extends DCLogic {\n'):F.index('  renderVals() {')]
lines=body.split('\n'); starts=[k for k,l in enumerate(lines) if re.match(r'^  [A-Za-z_]\w*\(.*\) \{',l)]
DROP={'componentDidMount','componentWillUnmount','PALETTES','startField','stopField','mapData','nodeOf','warpTo','wF','wNew','wRadK','wTw','warpStep','warpHeat','warpCol','hex','rgb2hsv','hsv2rgb','lerpHsv'}
chunks=[]; 
for j,k in enumerate(starts):
    end=starts[j+1] if j+1<len(starts) else len(lines)
    name=re.match(r'^  ([A-Za-z_]\w*)\(',lines[k]).group(1)
    chunks.append((name,'\n'.join(lines[k:end])))
G='\n'.join(c for n,c in chunks if n not in DROP)
KEEP=[n for n,c in chunks if n not in DROP]
def rep(a,b,cnt=1):
    global G
    assert G.count(a)==cnt,(G.count(a),a[:90]); G=G.replace(a,b)
# 크기 · 칸
rep("const cs = Math.max(11, Math.min(24, this.props.cell ?? 14));","const cs = this.sceneCs();   // 칸 = 씬 글자 장 칸 (텍스트 컴포넌트는 그 칸의 글자를 바꾼다)")
G=re.sub(r"\n    this\._wh = new Float32Array\(n\);[^\n]*","",G)
# 경로 → 씬 상태
rep("this._pathText = this.props.path ?? '/계정/01/01·c'; const names = (this._nav || this._pathText).split('/').filter(Boolean), curN = this.nodeOf(names), VIEW","const curN = this.sceneCur(), names = curN.path.split('/').filter(Boolean), VIEW")
rep("const MD = this.mapData(), cur = this.nodeOf(names),","const MD = this.sceneMap(), cur = curN,")
G=G.replace("this.mapData()","this.sceneMap()").replace("this.warpTo(","this.navStart(")
# 걸음 — 씬 상태가 바뀌면 다시 배치(바뀐 줄만 다시 찍힘)
rep("    this.warpStep(now, dt);\n","    { const k = this.sceneKey(); if (k !== this._SK) { this._SK = k; this._mv = null; this.layout(); } }\n")
rep(" if (this._cv && this._cv.parentElement) this._cv.parentElement.style.cursor = hv ? 'pointer' : '';","")
# 그리기
rep("if ((this.props.cell ?? 14) !== this._cs) { this.sizeField(); return; }","if (this.sceneCs() !== this._cs) { this.sizeField(); return; }")
rep("if ((this.props.path ?? '/계정/01/01·c') !== this._pathText && (this._nav = null, this._mv = null, true) || Math.round(","if (Math.round(")
rep("    this._tt = (this._tt || 0) + (moving ? (now - (this._prev || now)) / 1000 * speed : 0); this._prev = now;\n    const t = this._tt;","    const SG = this.sceneGrid(), t = SG.t;   // 무늬 시간 · 좌표는 씬 글자 장과 같게")
rep("(1 + (this._W ? this._W.v : 0) * 5)","1")
rep("      let b = buckets.get(key); if (!b) { b = []; buckets.set(key, b); } b.push(i);","      continue;   // 바탕 글자 장은 그리지 않는다 — 씬 글자 장이 비친다(투명)")
rep("if (DIMS.has(i) || (legDim && !TX.has(i))) { special.push({ i, y, kind: 'dim', key }); continue; }","if (DIMS.has(i) || (legDim && !TX.has(i))) continue;   // 레거시 아래도 투명 (어두운 화면 없음)")
rep("    this._logo = L; this._path","    { let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1; L.idx.forEach((m, i) => { if (!m.a) return; const c = i % cols, r = (i / cols) | 0; c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }); this._pz = c1 >= 0 ? { c0, c1, r0, r1 } : null; }   // '>_' 칸 범위 — 펼치기 전 전역 틀 범위\n    this._logo = L; this._path")
rep("    const M = this._mouse, Z = this._zones.logo, cw = this._cw, ch = this._ch;","    const M = this._mouse, Z = LG.on ? this._zones.logo : this._pz || this._zones.logo, cw = this._cw, ch = this._ch;   // 펼치기 전엔 '>_' 칸만")
rep("        ctx.fillText(glyph, X, Y); ctx.strokeText(glyph, X, Y);","        GM.set(S.i, [glyph, css, 1]);   // 씬 글자 장의 그 칸 글자를 바꾼다 (볼드)")
a=G.index("    const WE = this._W ? this._W.e : 0,"); b=G.index("\n",a); G=G[:a]+"    const WE = this.wsE(), vc0 = Math.ceil(this._ctrlX / this._cw);"+G[b:]
rep("    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {\n      const i = y * cols + x, W = this._bw[i], gx = x * this._cw / 15, gy = y * this._ch / 15;",
    "    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {\n      if (x >= vc0 && !TX.has(y * cols + x)) continue;   // 뷰 자리 — 텍스트(워프 목적지)만\n      const i = y * cols + x, W = this._bw[i], gx = (x * this._cw / SG.cw + SG.ox) * SG.cw / 15, gy = (y * this._ch / SG.ch + SG.oy) * SG.ch / 15;")
rep("if (st && !(WE > 0 && x >= vc0)) { const tw = this.wTw(i, now);","if (st) { const tw = moving ? 0.5 + 0.5 * Math.sin(now / 1000 * 1.4 * st + st * 9.0) : 0.75;")
rep("      if (WE > 0 && x >= vc0 && wh[i] > 0.16) { wCells.push(i); continue; }   // 워프 별 꼬리 칸\n","")
a=G.index("    // 워프 — 뷰 자리(오른쪽 2/3)만:"); b=G.index("    const DATA = [230, 234, 247], legBg = new Map();")
G=G[:a]+"    if (WE > 0) this.wsDraw(ctx, now);   // 워프 — 뷰 자리만\n"+G[b:]
rep("        if (!glyph || glyph === ' ') continue;\n        ctx.font = this.segBold(T, j) ? FGB : FG; ctx.fillStyle = 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';   // 기본 미디움 · 강조 데이터는 볼드\n        // 넓은 글자(한글)는 두 칸에 꽉 차게 — 칸 높이의 0.82 크기로 키워 두 칸 가운데에 (영문과 같은 글자 밀도)\n        const wide = glyph === chr && T.cells[j + 1] === '';\n        if (wide) { const fz = Math.round(this._ch * 0.82); ctx.font = ctx.font.replace(/[\\d.]+px/, fz + 'px'); const mw = ctx.measureText(glyph).width, kx = Math.min(1, (2 * this._cw - 1) / Math.max(1, mw)); ctx.save(); ctx.translate(X + (2 * this._cw - mw * kx) / 2, Y + (this._ch - fz) / 2); ctx.scale(kx, 1); ctx.fillText(glyph, 0, 0); ctx.restore(); }\n        else ctx.fillText(glyph, X, Y);",
    "        if (chr === '' && glyph === '') { GM.set(S.i, ['', null, 0]); continue; }   // 넓은 글자의 오른쪽 반 칸 — 비운다\n        if (!glyph || glyph === ' ') continue;   // 빈칸은 바탕 글자 그대로 (투명)\n        GM.set(S.i, [glyph, 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')', this.segBold(T, j) ? 3 : 2]);   // 씬 글자 장의 그 칸 글자를 바꾼다 (2 = G마켓 산스 미디움 · 3 = 강조 데이터 볼드) (넓은 글자는 씬이 두 칸 가운데에)")
assert 'wLN' not in G and 'wCells' not in G, 'leftover'
rep("    const buckets = new Map(), special = [];\n","    const buckets = new Map(), special = [], GM = this._gfMap = new Map();   // 씬 글자 장에 넘길 칸 (칸 → [글자, 색, 볼드])\n")
# ── 이름 바꾸기 — 메서드 gf_ · 필드 _q_ (씬과 나눠 쓰는 것: 마우스 · 노이즈 · 글자 목록 · 살아 있음)
for n in sorted(KEEP,key=len,reverse=True):
    G=re.sub(r'(?m)^  '+n+r'\(','  gf_'+n+'(',G); G=re.sub(r'this\.'+n+r'\(','this.gf_'+n+'(',G)
SHARED={'mouse','perm','glyphs','live'}
G=re.sub(r'this\._([A-Za-z0-9_]+)',lambda m:'this._'+m.group(1) if m.group(1) in SHARED else 'this._q_'+m.group(1),G)
G=G.replace('this.gf_lerpHsv','this.lerpHsv')
# ── 씬 쪽
def srep(a,b,cnt=1):
    global S
    assert S.count(a)==cnt,(S.count(a),a[:90]); S=S.replace(a,b)
srep("family=Geist:wght@400;500;600&amp;","family=Geist:wght@400;500;600;700&amp;")
srep('<canvas data-field="scene" role="img" aria-label="{{sceneLabel}}" style="position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; z-index: 1"></canvas>',
     '<canvas data-field="scene" role="img" aria-label="{{sceneLabel}}" style="position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; z-index: 1"></canvas>\n<canvas data-gf="scene" aria-hidden="true" style="position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; z-index: 3"></canvas>')
srep('onClick="{{back.go}}" style="position: absolute; z-index: 3;','onClick="{{back.go}}" style="display: none; position: absolute; z-index: 3;')
srep("&quot;$preview&quot;","&quot;logoWidth&quot;:{&quot;editor&quot;:&quot;range&quot;,&quot;min&quot;:0.1,&quot;max&quot;:0.25,&quot;step&quot;:0.01,&quot;default&quot;:0.2,&quot;section&quot;:&quot;전역 틀&quot;},&quot;$preview&quot;")
srep("// 씬 — 트리 뷰 · 리프 뷰 · 리소스 뷰를 한 화면에서 잇는다.","// 통합 화면 — 왼쪽 1/4 은 전역 틀(로고 · 정보 · 지도 · 명령), 뷰는 화면 가운데. 지도 두 번 누르기 = 워프로 그 노드의 뷰로.\n// 씬 — 트리 뷰 · 리프 뷰 · 리소스 뷰를 한 화면에서 잇는다.")
# 프레임 — 뷰(궤도 컴포넌트)는 화면 가운데 그대로. 노드 이동 중엔 화면 배율(navZoom: 빈 틈 둘레로 확대 · 도착 땐 0 에서 커짐)을 곱하고, 마우스 피드백은 끈다
srep("    const F = this.focusNow(now, sys, t), S = Math.min(w, h) * 0.42 * F.Z;","    const ZM = this._navZ || { k: 1, gx: w / 2, gy: h / 2 }, zx = (x) => ZM.gx + (x - ZM.gx) * ZM.k, zy = (y) => ZM.gy + (y - ZM.gy) * ZM.k;   // 노드 이동 — 화면 배율\n    const F = this.focusNow(now, sys, t), S = Math.min(w, h) * 0.42 * F.Z * ZM.k;")
srep("sc = Math.min(w, h) * 0.32, M = this._mouse;","sc = Math.min(w, h) * 0.32, M = this.transMove() ? null : this._mouse;")
srep("const ox = w / 2 + par.x, oy = h / 2 + par.y;","const ox = zx(w / 2 + par.x), oy = zy(h / 2 + par.y);")
srep("cx0 = w / 2, cy0 = h / 2;","cx0 = zx(w / 2), cy0 = zy(h / 2);")
srep("    return { t, sys, S, sp, spRaw,","    this._lastS = S;\n    return { t, sys, S, sp, spRaw,")
srep("M2 = this._mouse, D2 = Math.PI / 180;","M2 = this.transMove() ? null : this._mouse, D2 = Math.PI / 180;")
srep("      if (LK) turn((LK.yaw - by) * e, (LK.pitch - bp) * e);","      if (LK) turn((LK.yaw - by) * e, (LK.pitch - bp) * e + (this._navTilt || 0));   // 노드 이동 — 시선을 위로")
srep("    return { P, F, R, Dn, f, cx: Fr.w / 2, cy: Fr.h / 2 };","    const ZM = this._navZ, zk = ZM ? ZM.k : 1, cx0 = Fr.w / 2, cy0 = Fr.h / 2;   // 노드 이동 — 화면 배율\n    return { P, F, R, Dn, f: f * zk, cx: ZM ? ZM.gx + (cx0 - ZM.gx) * zk : cx0, cy: ZM ? ZM.gy + (cy0 - ZM.gy) * zk : cy0 };")
srep("    this._entP = this._entNow ? out : null;","    this._entP = this._entNow ? out : null;\n    if (!this._navS) this._pnLast = { C, Rs: world.map((x) => x.R), rIn, sc: c, sr: R0, pl: out.map((o) => ({ x: o.x, y: o.y, r: o.r })) };   // 노드 이동의 빈 틈 찾기")
srep("    let R0w = Fr.rOf(n); R0w = R0w","    let R0w = Fr.rOf(n) / ((this._navZ && this._navZ.k) || 1); R0w = R0w")   # 항성 크기(세계)는 트리 배율에서 오므로 화면 배율을 한 번 빼 둔다 (카메라에서 곱해짐)
srep("    const label = (o) => {\n      const VW = Fr.w, VH = Fr.h, MG = 14;","    const label = (o) => {\n      if ((this._orb || (this._navZ && (this._navZ.k > 1.15 || this._navZ.k < 0.85))) && (o.x + o.r < 0 || o.y + o.r < 0 || o.x - o.r > Fr.w || o.y - o.r > Fr.h)) return;   // 노드 이동 중 — 화면 밖 행성의 이름표는 가장자리에 붙이지 않는다\n      const VW = Fr.w, VH = Fr.h, MG = 14;")
srep("    const tgt = RS ? world.find((x) => x.p.name === RS.name) : null;\n    const C = this.camOf(Fr, tgt, eR);","    const tgt = RS ? world.find((x) => x.p.name === RS.name) : null, OB = this.orbNow(world, Fr);\n    const C = OB ? OB.C : this.camOf(Fr, tgt, eR);   // 같은 트리 안 리프로 — 궤도 비행 카메라 (항성 둘레 궤도)")
srep("    if (tgt && eR > 0) {","    if (tgt && eR > 0 && !OB) {")
srep("    const sampleNow = !this._MSkind ||","    const sampleNow = !this._MSkind || !!this._navS ||")   # 노드 이동 중엔 매 박자 샘플링 (반 박자 늦은 행성 투영이 뚝뚝 끊겨 보이지 않게)
srep("      if (this._rs) { ty2 += ","      if (this._rs || this._orb) { ty2 += ")   # 궤도 비행 중에도 리소스 뷰의 기본 시선을 그대로 — 출발 · 도착에서 시선이 풀렸다 걸리지 않게
srep("ease = 1 - Math.exp(-dt * (LV ? 2.5 : 5));","ease = 1 - Math.exp(-dt * (LV ? 2.5 : 5) * (this._navS && this._navS.phase === 'align' ? 3 : 1));")   # 이동 전 정렬은 세 배 빠르게 가운데로
srep("const ee = this._satHov ? 0 : 1 - Math.exp(-dt * 4);","const ee = this._satHov ? 0 : 1 - Math.exp(-dt * 4 * (this._navS && this._navS.phase === 'align' ? 3 : 1));")
srep("  BGMOVE() { return this.state.bgMove ?? this.props.bgMove ?? '없음'; }","  BGMOVE() { if (!this._lv) return '없음'; return this.state.bgMove ?? this.props.bgMove ?? '없음'; }   // 트리 뷰는 공전하지 않으니 배경 이동 없음")
# 호버 · 커서 — 컨트롤 구역에선 씬 호버 없음
srep("    const M = this._mouse, inLeaf = this._enter && this._enter.dir === 'in';","    const M = this._mouse && !this.transMove() && !this.gfHit(this._mouse.x, this._mouse.y) ? this._mouse : null, inLeaf = this._enter && this._enter.dir === 'in';")
srep("cur = hov ? 'pointer' : 'crosshair';","cur = hov || (this._mouse && this.gfHit(this._mouse.x, this._mouse.y)) ? 'pointer' : 'crosshair';")
# 박자 — 워프 걸음(앞) · 전역 틀 그리기(끝)
srep("    if (this._entL) this._entNow = this.entNow(now);\n    this._last = now;","    if (this._entL) this._entNow = this.entNow(now);\n    this._last = now;\n    this.wsStep(now, dt * 1000); this.navStep(now);   // 워프 (최고 속도에서 씬을 목적지로) · 노드 이동 단계")
srep("    this.drawField(now);\n  }\n  // ───── 글자 장 그리기 — 바뀐 칸만 ─────","    this.drawField(now);\n    this.gfFrame(now);   // 전역 틀 (맨 위 캔버스)\n  }\n  // ───── 글자 장 그리기 — 바뀐 칸만 ─────")
# 워프 중엔 매 프레임
srep("|| this._hlBusy || this._entL ||","|| this._hlBusy || this._entL || this._navS || (this._ws && this._ws.e > 0) ||")
srep("    this.fieldFlush(RC, ctx);   // 바뀐 칸만 실제 캔버스에","    { const GM = this._q_gfMap; if (GM) GM.forEach((v, i) => { if (i < ctx.n) { ctx.css[i] = v[1] ? this.qcss(v[1]) : '#bg'; ctx.gl[i] = v[0]; ctx.bd[i] = v[2] || 0; } }); }   // 전역 틀 — 텍스트 · 마스크 컴포넌트가 그 칸의 글자를 바꾼다\n    this.fieldFlush(RC, ctx);   // 바뀐 칸만 실제 캔버스에")
srep("      for (let i = 0; i < n; i++) if ((i >= i0 && i < i1) || R.css[i] !== R.pcss[i] || R.gl[i] !== R.pgl[i] || R.bd[i] !== R.pbd[i]) dirty.push(i);\n    }","      for (let i = 0; i < n; i++) if ((i >= i0 && i < i1) || R.css[i] !== R.pcss[i] || R.gl[i] !== R.pgl[i] || R.bd[i] !== R.pbd[i]) dirty.push(i);\n      // 넓은 글자(한글) — 두 칸에 걸쳐 그려지므로, 한쪽이 바뀌면 이웃 칸도 함께 다시 그린다\n      const WD = (g) => !!g && g.charCodeAt(0) >= 0x1100, ds = new Set(dirty), more = [];\n      for (const i of dirty) { if (i > 0 && !ds.has(i - 1) && (WD(R.gl[i - 1]) || WD(R.pgl[i - 1]))) { ds.add(i - 1); more.push(i - 1); } if (i + 1 < n && !ds.has(i + 1) && (WD(R.gl[i]) || WD(R.pgl[i]))) { ds.add(i + 1); more.push(i + 1); } }\n      for (const i of more) dirty.push(i);\n    }")
srep("      for (const i of list) { const x0 = X(i % cols) + IN, y0 = Y((i / cols) | 0) + INY; RC.fillText(R.gl[i], x0, y0); if (bold) RC.strokeText(R.gl[i], x0, y0); }","      for (const i of list) { const g = R.gl[i], c0 = i % cols, x0 = g.charCodeAt(0) >= 0x1100 ? X(c0) + Math.max(0, (X(c0 + 2) - X(c0) - RC.measureText(g).width) / 2) : X(c0) + IN, y0 = Y((i / cols) | 0) + INY; RC.fillText(g, x0, y0); if (bold) RC.strokeText(g, x0, y0); }   // 넓은 글자는 두 칸 가운데")
srep("    this.drawField(now);\n    this.gfFrame(now);   // 전역 틀 (맨 위 캔버스)","    this.gfFrame(now);   // 전역 틀 — 칸(텍스트 · 마스크)을 먼저 정하고, 레거시 선은 맨 위 캔버스에\n    this.drawField(now);")
srep("      const bold = k.charCodeAt(0) === 49, css = k.slice(1);\n      RC.font = bold ? FB : FN; RC.fillStyle = css;","      const bold = k.charCodeAt(0) === 49, gui = k.charCodeAt(0) === 50, guiB = k.charCodeAt(0) === 51, css = k.slice(1);   // 2 · 3 = 전역 틀 글꼴 (미디움 · 볼드)\n      RC.font = gui ? FG : guiB ? FGB : bold ? FB : FN; RC.fillStyle = css;")
srep("FB = FN.replace(/^\\d+ /, '700 ');\n    RC.textBaseline = 'top';","FB = FN.replace(/^\\d+ /, '700 '), FG = '500 ' + (sz * dpr).toFixed(2) + 'px GmarketSans, \"Geist Mono\", \"Noto Sans KR\", sans-serif', FGB = FG.replace(/^\\d+ /, '700 ');   // 전역 틀 글꼴 — 기본 미디움 · 강조 볼드\n    RC.textBaseline = 'top';")
# 누르기 — 컨트롤 구역은 전역 틀로
srep("        const rc = this._cv.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;\n        if (this._res && this._res.dir === 'in') return;",
     "        const rc = this._cv.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;\n        if (this.gfHit(mx, my) || this._q_hold || this.gfOver(mx, my)) { this.gfTap(mx, my); return; }   // 전역 틀이 받는 자리만 (지도 노드를 누르고 있었으면 떼는 자리와 상관없이)\n        if (this._navS) return;   // 노드 이동 중\n        if (this._res && this._res.dir === 'in') return;")
srep('<div onPointerUp="{{tap}}"','<div onPointerDown="{{pdown}}" onPointerUp="{{tap}}"')
srep("      pleave: () => { this._mouse = null; },","      pleave: () => { this._mouse = null; },\n      pdown: (e) => { if (!e || !this._cv || (e.target && e.target.closest && e.target.closest('[data-ctlwin]'))) return; const rc = this._cv.getBoundingClientRect(); this.gfDown(e.clientX - rc.left, e.clientY - rc.top); },   // 지도 노드 — 길게 누르기를 잰다")
# 위성(리소스) 이름 — 배경 글자의 1.5배 · 융기 높이 3칸 · 나타날 땐 텍스트 컴포넌트 랜덤 갱신(주기가 점점 길어지다 멈춤)
srep("""    for (let j = 0; j < st.name.length; j++) { ctx.fillText(st.name[j], st.x + (2 + j) * cw, st.y); ctx.strokeText(st.name[j], st.x + (2 + j) * cw, st.y); }""",
"""    // 이름 — 배경 글자의 1.5배(SAT_NAME) · 밝기는 늘 그대로(이전의 어두움 → 밝아짐 모션 없음). 글자마다 랜덤 글자로 갱신하다가 주기가 점점 길어지며 제 글자로 멈춘다
    const kn = this.SAT_NAME(), cwN = this._cw * kn, x0n = st.x + cw / 2 + this._cw, RV = this.satReveal(st), G = this._glyphs || 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
    ctx.font = '700 ' + Math.round(this._cs * 0.86 * kn) + 'px GmarketSans, "Geist Mono", monospace'; ctx.fillStyle = ctx.strokeStyle = 'rgb(255,255,255)';
    const RS = this._satRnd && this._satRnd.name === st.name ? this._satRnd : (this._satRnd = { name: st.name, c: [] }), nowR = performance.now();
    for (let j = 0; j < st.name.length; j++) { const p = RV(j); if (p <= 0) continue; let g = st.name[j];
      if (p < 1 && g !== ' ') { const q = RS.c[j] || (RS.c[j] = { g: G[(Math.random() * G.length) | 0], next: 0 }); if (nowR >= q.next) { q.g = G[(Math.random() * G.length) | 0]; q.next = nowR + (16 + 170 * p * p) * (0.7 + Math.random() * 0.6); } g = q.g; }   // 주기 16ms → 186ms 로 점점 길어진다
      const X = x0n + cwN * (j + 0.5); ctx.fillText(g, X, st.y); ctx.strokeText(g, X, st.y); }""")
srep("""  // 위성의 복원 방식 — 레거시 옵션""","""  SAT_NAME() { return this.props.satNameScale ?? 1.5; }   // 위성 이름 글자 크기 — 배경 글자의 1.5배 (■ 는 SAT_SCALE)
  // 위성 이름이 나타나는 정도(글자 j → 0..1) — 호버하면 곧바로 왼쪽 글자부터 차례로(글자마다 35ms 늦게) 0.42초 동안 랜덤 갱신. 떼면 거꾸로
  satReveal(st) { const SE = this._satE; if (!SE || SE.name !== st.name) return () => 1; return (j) => Math.min(1, Math.max(0, (SE.tl - j * 35) / 420)); }
  // 위성의 복원 방식 — 레거시 옵션""")
srep("""    const k = this.SAT_SCALE(), gw = this._cw * k, gh = this._ch * k, cw = this._cw, ch = this._ch, n = withLabel ? 1 + st.name.length : 0;   // 컴포넌트는 배율만큼 크고, 패딩은 글자 장 1칸 그대로
    const l = st.x - gw / 2, r = st.x + gw / 2 + n * gw, t = st.y - gh / 2, b = st.y + gh / 2;
    return { l, r, t, b, pl: l - cw, pr: r + cw, pt: t - ch, pb: b + ch };""",
"""    const k = this.SAT_SCALE(), gw = this._cw * k, gh = this._ch * k, cw = this._cw, ch = this._ch;   // ■ 는 배율만큼 크고, 이름은 배경 글자의 1.5배 · 한 칸 띄우고
    const l = st.x - gw / 2, r = st.x + gw / 2 + (withLabel ? cw + st.name.length * cw * this.SAT_NAME() : 0), t = st.y - gh / 2, b = st.y + gh / 2;
    const rc = Math.floor(st.y / ch);   // 융기 높이 = 3칸 — 위성이 있는 칸 줄과 그 위 · 아래 한 줄씩
    return { l, r, t, b, pl: l - cw, pr: r + cw, pt: (rc - 1) * ch, pb: (rc + 2) * ch };""")
srep("const SPn = this.satPlan(), SLV = this.legacyVals(SPn, SE.tl), restoring = SPn[3].on && SE.tl >= SPn[3].start,","const SPn = this.satPlan(), SLV = { fr: 0, ga: 0, top: true, cur: -1, b: 1 }, restoring = false,")   # 위성 이름 — 융기(구멍 · 발광 · 어두운 화면 복원) 없이 이름만 맨 위에, 배경은 그대로
srep("      const M3 = this._mouse, SE0 = this._satE; let sh = null;","      const M3 = this.transMove() ? null : this._mouse, SE0 = this._satE; let sh = null;")   # 전환 중엔 위성 호버 없음
srep("    const V2 = this.vals(now);","    const V2 = this.vals(now); this._vBusy = !!(V2 && !V2.done);   // 뷰 생성(융기 재생) 중 — 전환으로 본다")
srep("      F = slerp(F0, FT, e, N); U = slerp(U0, N, e, T); f = Math.exp","      { const dt3 = (a, b) => Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])), s0 = nrm([-P[0], -P[1], -P[2]]), th = Math.acos(dt3(FT, s0)), a1 = Math.acos(dt3(FT, nrm([-P1[0], -P1[1], -P1[2]]))), ga = Math.min(th, a1) * e;\n        F = th < 1e-4 ? s0 : slerp(s0, FT, ga / th, N); }   // 보는 쪽 — 항성 방향에서 리소스 구도 쪽으로 돌리되, 항성과의 각을 리소스 구도에서의 각 이하로(× e) — 들어가고 나올 때 항성이 화면 밖으로 휙 튀지 않는다\n      U = slerp(U0, N, e, T); f = Math.exp")   # 리소스 진입 · 나가기 카메라
srep("    // 화면 밖으로 나간 정도 — 마우스 시차 범위 계산에 쓴다 (기본 시점에서만)\n    if (!RS) {","    // 화면 밖으로 나간 정도 — 마우스 시차 범위 계산에 쓴다 (기본 시점에서만 — 궤도 비행 · 노드 이동 확대 중엔 재지 않는다: 그때 잰 터무니없는 범위로 시차가 커져, 리소스 뷰를 나갈 때 항성이 화면 밖으로 튀어 나갔다)\n    if (!RS && !OB && !this._navZ) {")
srep("  componentWillUnmount() {\n    this._live = false;\n    window.removeEventListener('keydown', this._onKey);","  componentWillUnmount() {\n    this._live = false;\n    window.removeEventListener('keydown', this._onKey);\n    this.gf_cmdDispose();   // 전역 틀 입력 칸")
srep("    this.fieldFlush(RC, ctx);   // 바뀐 칸만 실제 캔버스에","    this.gf_ctlFieldFx(ctx, cols, this._cw, this._ch);   // 제어기 창 — 중앙 생성 · 어두운 화면 복원 (칸 효과)\n    this.fieldFlush(RC, ctx);   // 바뀐 칸만 실제 캔버스에")
srep("|| this._hlBusy || this._entL || this._navS ||","|| this._hlBusy || this._entL || this._q_ctlAnim || this._q_ctlWin || this._navS ||")   # 제어기 창이 있는 동안은 매 프레임 (창 둘레 어두운 테 · 이동)
srep('<canvas data-gf="scene" aria-hidden="true" style="position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; z-index: 3"></canvas>','<canvas data-gf="scene" aria-hidden="true" style="position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; z-index: 3"></canvas>\n<div data-ctlwin="scene" data-slot="0" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeDesktopEmbed" chrome="none" node-name="{{ctlNode0}}" win-w="{{ctlW0}}" win-h="{{ctlH0}}" on-close="{{ctlCloseFn0}}" on-full="{{ctlFullFn0}}" zoom="{{ctlZoom0}}" on-zoom="{{ctlZoomFn0}}" remote="{{ctlRemote0}}" on-open="{{ctlOpenFn0}}" hint-size="1240px,760px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="1" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeDesktopEmbed" chrome="none" node-name="{{ctlNode1}}" win-w="{{ctlW1}}" win-h="{{ctlH1}}" on-close="{{ctlCloseFn1}}" on-full="{{ctlFullFn1}}" zoom="{{ctlZoom1}}" on-zoom="{{ctlZoomFn1}}" remote="{{ctlRemote1}}" on-open="{{ctlOpenFn1}}" hint-size="1240px,760px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="2" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeDesktopEmbed" chrome="none" node-name="{{ctlNode2}}" win-w="{{ctlW2}}" win-h="{{ctlH2}}" on-close="{{ctlCloseFn2}}" on-full="{{ctlFullFn2}}" zoom="{{ctlZoom2}}" on-zoom="{{ctlZoomFn2}}" remote="{{ctlRemote2}}" on-open="{{ctlOpenFn2}}" hint-size="1240px,760px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="3" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeDesktopEmbed" chrome="none" node-name="{{ctlNode3}}" win-w="{{ctlW3}}" win-h="{{ctlH3}}" on-close="{{ctlCloseFn3}}" on-full="{{ctlFullFn3}}" zoom="{{ctlZoom3}}" on-zoom="{{ctlZoomFn3}}" remote="{{ctlRemote3}}" on-open="{{ctlOpenFn3}}" hint-size="1240px,760px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="4" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeDesktopEmbed" chrome="none" node-name="{{ctlNode4}}" win-w="{{ctlW4}}" win-h="{{ctlH4}}" on-close="{{ctlCloseFn4}}" on-full="{{ctlFullFn4}}" zoom="{{ctlZoom4}}" on-zoom="{{ctlZoomFn4}}" remote="{{ctlRemote4}}" on-open="{{ctlOpenFn4}}" hint-size="1240px,760px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="5" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeDesktopEmbed" chrome="none" node-name="{{ctlNode5}}" win-w="{{ctlW5}}" win-h="{{ctlH5}}" on-close="{{ctlCloseFn5}}" on-full="{{ctlFullFn5}}" zoom="{{ctlZoom5}}" on-zoom="{{ctlZoomFn5}}" remote="{{ctlRemote5}}" on-open="{{ctlOpenFn5}}" hint-size="1240px,760px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="6" style="display: none"><div data-ctlbody="scene"><dc-import name="StarMaker" win-w="{{smW}}" win-h="{{smH}}" load="{{smLoad}}" on-saved="{{smSavedFn}}" hint-size="1100px,720px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="7" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeConf" node-name="{{wNode7}}" node-kind="{{wKind7}}" parent-name="{{wPar7}}" node-key="{{wId7}}" node-path="{{wPath7}}" remote="{{wRemote7}}" on-skin="{{skinFn}}" res-list="{{wRes7}}" on-open="{{openFn7}}" win-w="{{ctlW7}}" win-h="{{ctlH7}}" hint-size="860px,600px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="8" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeStatus" node-name="{{wNode8}}" node-kind="{{wKind8}}" parent-name="{{wPar8}}" win-w="{{ctlW8}}" win-h="{{ctlH8}}" hint-size="560px,540px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="9" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeStatus" node-name="{{wNode9}}" node-kind="{{wKind9}}" parent-name="{{wPar9}}" win-w="{{ctlW9}}" win-h="{{ctlH9}}" hint-size="560px,540px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="10" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeStatus" node-name="{{wNode10}}" node-kind="{{wKind10}}" parent-name="{{wPar10}}" win-w="{{ctlW10}}" win-h="{{ctlH10}}" hint-size="560px,540px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="11" style="display: none"><div data-ctlbody="scene"><dc-import name="NodeShare" node-name="{{wNode11}}" node-kind="{{wKind11}}" node-key="{{wId11}}" res-list="{{wRes11}}" focus-res="{{wFocus11}}" peers="{{wPeers11}}" on-open="{{openFn11}}" win-w="{{ctlW11}}" win-h="{{ctlH11}}" hint-size="860px,600px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="12" style="display: none"><div data-ctlbody="scene"><dc-import name="ResStatus" res-name="{{wNode12}}" node-name="{{wPar12}}" src="{{wSrc12}}" win-w="{{ctlW12}}" win-h="{{ctlH12}}" hint-size="600px,600px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="13" style="display: none"><div data-ctlbody="scene"><dc-import name="ResStatus" res-name="{{wNode13}}" node-name="{{wPar13}}" src="{{wSrc13}}" win-w="{{ctlW13}}" win-h="{{ctlH13}}" hint-size="600px,600px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="14" style="display: none"><div data-ctlbody="scene"><dc-import name="ResStatus" res-name="{{wNode14}}" node-name="{{wPar14}}" src="{{wSrc14}}" win-w="{{ctlW14}}" win-h="{{ctlH14}}" hint-size="600px,600px"></dc-import></div></div>\n<div data-ctlwin="scene" data-slot="15" style="display: none"><div data-ctlbody="scene"><dc-import name="TreeLogin" tree-name="{{wNode15}}" tree-key="{{wId15}}" direction="{{wDir15}}" login-url="{{wUrl15}}" reachable="{{wReach15}}" needs-resolve="{{wNeed15}}" tunnel-port="{{wTun15}}" current="{{wCur15}}" on-done="{{treeLoginDoneFn}}" on-cancel="{{treeLoginCancelFn}}" win-w="{{ctlW15}}" win-h="{{ctlH15}}" hint-size="600px,540px"></dc-import></div></div>')   # 제어기 창 — 노드 데스크톱 자식 컴포넌트
srep("    return {\n      // 지금 어디인지 — 범위 경로","    return {\n      ...this.gf_ctlProps(),   // 제어기 창\n      // 지금 어디인지 — 범위 경로")
srep("      tap: (e) => {\n        if (!e || !this._cv || !this._hits) return;","      tap: (e) => {\n        if (!e || !this._cv || !this._hits || (e.target && e.target.closest && e.target.closest('[data-ctlwin]'))) return;   // 제어기 창 안의 누르기는 창이 받는다")
# 메서드 붙이기 — 클래스 끝(renderVals 앞)
methods=open(d+'gf_scene_methods.js').read()
a=S.index('  renderVals() {')
S=S[:a]+methods.lstrip('\n')+'\n'+G.rstrip()+'\n\n'+S[a:]
import sys as _sys; _sys.path.insert(0, d); import atlas; S = atlas.patch(S)   # 글자 타일(아틀라스)로 그리기 — 글꼴이 바뀌어도 노이즈 없음
open(OUT+'Scene.dc.html','w').write(S)
print('ok', len(S))

exec(open(d+'mklogin.py').read())   # 로그인 씬을 붙인다
