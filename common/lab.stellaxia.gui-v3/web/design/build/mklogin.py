# 통합 화면에 로그인 씬을 붙인다 — mkglobal.py 마지막에 불린다 (Scene.dc.html 을 고쳐 쓴다)
#   맨 위 층: 로그인 보드(embed) — 메인 화면 → 로그인 → 전환. 로그인 층은 이 씬의 글자 장을 그대로 읽어 그리고(바탕이 같다), 확대 단계에서는 항성계(트리 뷰 컴포넌트)만 _introS 배율로 소실점에서 커진다
#   로그인 중엔 통합 화면이 탭 · 단축키(ESC · Ctrl+K · '/' · Tab)를 받지 않는다
import os
d=os.path.dirname(os.path.abspath(__file__))+'/'
P=d+'../Scene.dc.html'; S=open(P).read()
def rep(a,b,cnt=1):
    global S; assert S.count(a)==cnt,(S.count(a),a[:90]); S=S.replace(a,b)
rep('\n</div>\n</x-dc>','''
<button type="button" onPointerUp="{{stopProp}}" onClick="{{loginAgain}}" style="display: {{loginAgainD}}; position: absolute; right: 20px; bottom: 18px; z-index: 5; font: 600 12px 'Geist Mono', monospace; padding: 4px 9px; border-radius: 4px; border: 1px solid rgba(108,118,156,0.35); background: #040614; color: #9aa4c8; cursor: pointer;">TEST · 로그인부터</button>
<div data-loginwrap="scene" aria-hidden="{{loginHid}}" style="position: absolute; inset: 0; z-index: 60; display: {{loginD}};"><dc-import name="Login" embed="true" reset="{{loginKey}}" on-done="{{loginDoneFn}}" hint-size="1440px,900px"></dc-import></div>
</div>
</x-dc>''')
rep("closest('[data-ctlwin]')","closest('[data-ctlwin],[data-loginwrap],[data-minfly]')",2)
# 창을 끄는 동안 · 창 · 최소화 찾기 판 · 로그인 층 위에선 씬의 마우스 피드백(호버 · 시차)을 끈다
rep("      pmove: (e) => { if (!e || !this._cv) return; const rc = this._cv.getBoundingClientRect(); this._mouse = { x: e.clientX - rc.left, y: e.clientY - rc.top }; },",
    "      pmove: (e) => { if (!e || !this._cv) return; if (this._q_ctlDrag || (e.target && e.target.closest && e.target.closest('[data-ctlwin],[data-minfly],[data-loginwrap]'))) { this._mouse = null; return; } const rc = this._cv.getBoundingClientRect(); this._mouse = { x: e.clientX - rc.left, y: e.clientY - rc.top }; },")
rep("      if (e.key !== 'Escape') return;\n","      if (e.key !== 'Escape' || this.loginOn()) return;   // 로그인 중엔 로그인 씬이 ESC 를 쓴다\n")
rep("this._q_cmdKey = (e) => { if (!this._live) return this.gf_cmdDispose();","this._q_cmdKey = (e) => { if (!this._live) return this.gf_cmdDispose(); if (this.loginOn && this.loginOn()) return;")
rep("  renderVals() {\n    const S = this.state, sys = this.build()","""  // 로그인 — 처음엔 로그인 씬이 맨 위(패널 '로그인'), 전환이 끝나면 걷힌다. TEST · 로그인부터 = 다시 메인 화면부터
  loginOn() { const S = this.state || {}; return (S.loginOn ?? (this.props.login ?? true)) !== false; }
  // 로그아웃 — 전역 틀의 '로그아웃' 에서. 창을 모두 닫고(최소화 목록도 비움) 로그인 층을 다시 올린다 → 로그인 씬이 전환을 거꾸로
  sceneLogout() { if (this.loginOn()) return; this.gf_ctlCloseAll(); this._q_wins = []; this._q_flyPin = false; if (this._q_fly) this.gf_minFly(false); if (this._q_lg) this._q_lg.open = false; this.setState({ loginOn: true, logoutKey: ((this.state || {}).logoutKey || 0) + 1 }); }
  renderVals() {
    const S = this.state, sys = this.build()""")
rep("    return {\n      ...this.gf_ctlProps(),","""    const LON = this.loginOn();
    return {
      loginD: LON ? 'block' : 'none', loginHid: LON ? 'false' : 'true', loginAgainD: LON ? 'none' : 'block', loginKey: S.loginKey || 0, logoutKey: S.logoutKey || 0,
      loginDoneFn: this._lgDF || (this._lgDF = () => this.setState({ loginOn: false })),
      loginAgain: () => this.setState({ loginOn: true, loginKey: (S.loginKey || 0) + 1 }),
      ...this.gf_ctlProps(),""")
rep('data-props="{&quot;','data-props="{&quot;login&quot;:{&quot;editor&quot;:&quot;boolean&quot;,&quot;default&quot;:true,&quot;section&quot;:&quot;로그인&quot;},&quot;')

# 항성계만 확대 — 로그인 씬이 넘겨 주는 배율(_introS)을 트리 뷰 카메라 배율에 곱한다 (바탕 글자 장 · 전역 틀은 그대로)
rep("const F = this.focusNow(now, sys, t), S = Math.min(w, h) * 0.42 * F.Z * ZM.k;","const F = this.focusNow(now, sys, t), S = Math.min(w, h) * 0.42 * F.Z * ZM.k * (this._introS ?? 1);   // _introS — 로그인 전환에서 항성계만 소실점에서 확대")
# 로그인 씬이 이 씬의 글자 장을 그대로 읽어 그리도록 자신을 알린다
rep("  componentDidMount() {\n    this._live = true;\n","  componentDidMount() {\n    this._live = true;\n    window.__terraScene = this;   // 로그인 씬(embed)이 같은 글자 장(칸 · 글자 · 별 · 무늬 · 시간)을 읽는다\n")
rep("  componentWillUnmount() {\n    this._live = false;\n","  componentWillUnmount() {\n    this._live = false;\n    if (window.__terraScene === this) window.__terraScene = null;\n")
rep('reset="{{loginKey}}" on-done="{{loginDoneFn}}"','reset="{{loginKey}}" on-done="{{loginDoneFn}}" on-zoom="{{loginZoomFn}}"')
rep("      loginDoneFn: this._lgDF || (this._lgDF = () => this.setState({ loginOn: false })),","      loginDoneFn: this._lgDF || (this._lgDF = () => { this._introS = 1; this.setState({ loginOn: false }); }), loginZoomFn: this._lgZF || (this._lgZF = (s) => { this._introS = s; }),")
rep('on-zoom="{{loginZoomFn}}"','on-zoom="{{loginZoomFn}}" logout="{{logoutKey}}"')

# 우클릭 — 노드(트리 뷰: 트리 · 계정 / 리프 뷰: 항성 · 행성 / 리소스 뷰: 위성 · 행성) 이름 · 종류 · 속성을 지도 마커 꼴로 (전역 틀 popShow). 빈 곳 우클릭 · 다른 곳 누르기 · ESC = 닫기
rep('<div onPointerDown="{{pdown}}"','<div onContextMenu="{{ctxMenu}}" onPointerDown="{{pdown}}"')
rep("      if (e.key !== 'Escape' || this.loginOn()) return;   // 로그인 중엔 로그인 씬이 ESC 를 쓴다\n","      if (e.key !== 'Escape' || this.loginOn()) return;   // 로그인 중엔 로그인 씬이 ESC 를 쓴다\n      if (this._q_pop) { e.preventDefault(); this.gf_popHide(); return; }   // 우클릭 속성부터 닫는다\n")
rep("e.target.closest('[data-ctlwin],[data-loginwrap],[data-minfly]'))) return;   // 제어기 창 안의 누르기는 창이 받는다","e.target.closest('[data-ctlwin],[data-loginwrap],[data-minfly]'))) return;   // 제어기 창 안의 누르기는 창이 받는다\n        if (this._q_pop) { const rc0 = this._cv.getBoundingClientRect(); if (this.gf_popTap(e.clientX - rc0.left, e.clientY - rc0.top)) return; this.gf_popHide(); }   // 우클릭 할 일 누르기 · 다른 곳을 누르면 닫기")
rep("  loginOn() {","""  sceneCtx(e) {
    if (!e) return; if (e.target && e.target.closest && e.target.closest('[data-ctlwin],[data-loginwrap],[data-minfly]')) return; e.preventDefault(); if (this.loginOn() || !this._cv) return;
    const rc = this._cv.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top, T = this.ctxTarget(mx, my);
    if (T) this.gf_popShow(T); else this.gf_popHide();
  }
  // 우클릭 대상 → 지도 노드(전역 틀과 같은 노드: 창 · 이동이 그대로 통함) + 할 일 목록
  ctxTarget(mx, my) {
    const MD = this.sceneMap(), lid = this._leafId;
    let mn = null, x = mx, y = my, r = 6, track = null;
    if (this._res && this._sats) for (const st of this._sats) { if (st.hidden || Math.hypot(st.x - mx, st.y - my) > 14) continue; const nm = st.name, pn = st.planet.p.name;
      mn = MD.byId['R' + lid + ':' + pn + ':' + nm]; x = st.x; y = st.y; r = 5; track = () => { const q = (this._sats || []).find((z) => z.name === nm && !z.hidden); return q ? [q.x, q.y] : null; }; break; }
    if (!mn) { let best = null, bd = 1e9;
      for (const h of this._hits || []) { if (h.vis < 0.5) continue; const d = Math.hypot(h.x - mx, h.y - my); if (d < Math.max(h.r || 0, 8) + 6 && d < bd) { bd = d; best = h; } }
      if (!best) return null; const id = best.id; x = best.x; y = best.y; r = best.r;
      track = () => { const h = this._hitById && this._hitById.get(id); return h && h.vis >= 0.5 ? [h.x, h.y] : null; };
      mn = typeof id === 'string' && id.startsWith('p:') ? MD.byId['P' + lid + ':' + id.slice(2)] : MD.byId['T' + id]; }
    if (!mn) return null;
    const KN = { root: '계정', tree: '트리', leaf: '리프', res: '리소스' }, acts = [];
    const here = this.sceneCur && this.sceneCur() === mn;
    if (mn.kind !== 'root' && this.gf_needLogin(mn)) acts.push({ label: '로그인', desc: (this.gf_treeOf(mn) || mn).name + ' 세션 없음', run: () => this.gf_loginOpen(mn) });
    if (mn.kind !== 'root' && !here) acts.push({ label: '진입', desc: { tree: '리프 뷰', leaf: '리소스 뷰', res: '자원 보기' }[mn.kind], run: () => this.navStart(mn) });
    acts.push({ label: '상태', desc: mn.kind === 'res' ? '값 · 연결' : '동작 · 상태', run: () => this.gf_ctlOpenWin(mn, undefined, 'stat') });
    acts.push({ label: '설정', desc: mn.kind === 'tree' ? 'GUI · Terra · Tree' : mn.kind === 'leaf' ? 'GUI · Terra · Leaf' : 'GUI', run: () => this.gf_ctlOpenWin(mn, undefined, 'conf') });
    if (mn.kind === 'leaf' || mn.kind === 'res') acts.push({ label: '자원', desc: '공유 · 등록', run: () => this.gf_ctlOpenWin(mn, undefined, 'share') });
    if (mn.kind === 'tree' || mn.kind === 'leaf') acts.push({ label: '제어기', desc: '노드 데스크톱', run: () => this.gf_ctlOpenWin(mn) });
    return { x, y, r, name: mn.name, kind: KN[mn.kind] || '노드', acts, track };
  }
  loginOn() {""")
rep("      loginDoneFn:","      ctxMenu: this._ctxF || (this._ctxF = (e) => this.sceneCtx(e)),\n      loginDoneFn:")

rep("  enterLeaf(id) {\n", "  enterLeaf(id) {\n    { const t = this.sceneMap().byId['T' + id]; if (t && this.gf_loginGate && this.gf_loginGate(t, () => this.enterLeaf(id))) return; }   // 트리 뷰에서 항성을 눌러 들어가기 — 세션 없는 Tree 면 들어가기 전에 로그인 창(되면 그때 들어간다)\n")
rep("  navStart(n) {\n", "  navStart(n) {\n    if (this.gf_loginGate && this.gf_loginGate(n)) return;   // 세션 없는 Tree 로 — Tree 로그인 창이 먼저(로그인되면 이어서 간다)\n")
open(P,'w').write(S); print('login ok')
