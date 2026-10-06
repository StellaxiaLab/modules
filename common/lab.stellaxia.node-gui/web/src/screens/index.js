// 시작 — 디자인 캔버스 원본 design/Intro.dc.html 에서 옮긴 화면 로직 (module 변형 · tools/gen-pages.py로 다시 만든다)
// 데이터를 바꿔 끼우는 곳은 src/boot/module.js · src/data/*.js — 이 파일은 손으로 고치지 않는다
import { DCLogic } from '../runtime/dc.js';

export default class Component extends DCLogic {
  constructor(props) {
    super(props);
    const saved = this.readAuto();
    this.state = {
      username: saved ? saved.username : 'admin', password: '', auto: !!saved, showPw: false, caps: false,
      // phase: form(입력) · auto(자동 로그인 중) · loading(확인 중) · fail(실패) · done(로그인됨)
      phase: saved ? 'auto' : 'form', msg: '', msgC: '#ff5d5d', shake: 0, gw: 'check'
    };
  }
  // 자동 로그인 기억 (예시 — 실제로는 비밀번호를 화면이 저장하지 않고 Gateway가 자격 핸들을 보관한다)
  readAuto() { try { const v = window.localStorage.getItem('terra.gui.autoLogin'); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  writeAuto(v) { try { if (v) window.localStorage.setItem('terra.gui.autoLogin', JSON.stringify(v)); else window.localStorage.removeItem('terra.gui.autoLogin'); } catch (e) { /* 저장 못 해도 화면은 돈다 */ } }
  componentDidMount() {
    this.introSky();
    this._gwT = setTimeout(() => this.setState({ gw: 'ok' }), 700);   // 예시: health.get 응답
    // 노드 화면(맵)을 뒤에 미리 읽어 둔다 — 로그인하고 내려갈 때 기다리지 않게 (보이지 않음)
    this._preT = setTimeout(() => {
      this.setState({ preload: true });
      setTimeout(() => {
        const fr = document.querySelector('[data-in-map]'); if (!fr) return;
        // 읽힌 것이 정말 노드 화면인지 본다 (없는 주소면 빈 쪽이 뜬다 → 준비 안 됨 → 구름 뒤 '노드 화면으로' 버튼)
        fr.addEventListener('load', () => { setTimeout(() => {
          let ok = true; try { ok = !!(fr.contentDocument && fr.contentDocument.querySelector('[data-node-root]')); } catch (e) { ok = true; }
          if (ok) { this._mapReady = true; if (this._fly) this._fly.ready = true; }
        }, 900); });
      }, 0);
    }, 1200);
    if (this.state.phase === 'auto') this._autoT = setTimeout(() => this.finish(true), 1800);
    else setTimeout(() => { const el = document.querySelector('[data-in-pass]'); if (el && this.state.phase === 'form') el.focus(); }, 300);
  }
  componentWillUnmount() { this._dead = true; clearTimeout(this._flyT); clearTimeout(this._preT); clearTimeout(this._gwT); clearTimeout(this._autoT); clearTimeout(this._loginT); if (this._raf) cancelAnimationFrame(this._raf); if (this._rs) window.removeEventListener('resize', this._rs); }
  // 로그인 (예시): username · password가 비면 막고, password가 4자 미만이면 실패. 실제로는 terra.gateway.auth.credentials.post
  submit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const S = this.state;
    if (S.phase === 'loading') return;
    if (!S.username.trim() || !S.password) { this.fail(!S.username.trim() ? 'username을 입력하세요' : 'password를 입력하세요'); return; }
    this.setState({ phase: 'loading', msg: '' });
    this._loginT = setTimeout(() => {
      if (this.state.password.length < 4) { this.fail('로그인 실패 — 비밀번호를 확인하세요'); return; }
      this.finish(false);
    }, 900);
  }
  fail(msg) {
    this.setState({ phase: 'form', msg, msgC: '#ff5d5d', shake: this.state.shake + 1 });
    const card = document.querySelector('[data-in-card]');
    if (card) { card.classList.remove('in-shake'); void card.offsetWidth; card.classList.add('in-shake'); }
  }
  finish(fromAuto) {
    const S = this.state;
    if (!fromAuto) this.writeAuto(S.auto ? { username: S.username.trim() } : null);
    this.setState({ phase: 'done', password: '', msg: '' });
    clearTimeout(this._flyT); this._flyT = setTimeout(() => this.startFly(), 700);
  }
  // 카메라 내려가기: 노드 화면을 미리 읽기 시작하고(iframe), 그리는 루프가 _fly를 보고 움직인다
  startFly() {
    if (this._fly || this._dead) return;
    this._fly = { t0: performance.now(), last: performance.now(), p: 0, ready: !!this._mapReady };   // 맵이 아직이면 구름 한가운데서 기다린다
    this.setState({ fly: true });
  }
  renderVals() {
    const S = this.state;
    // 미등록 노드 등록 (A-19): 로그인도 자동 로그인도 아닌 세 번째 단계다. 로그인할 Master가
    // 아직 없으니 로그인 칸을 보여 줄 수 없고, '로그인됨' 칸도 아니다 — 그래서 form · status와
    // 나란히 서는 제3의 묶음으로 둔다. 실제 값은 src/boot/service.js가 채운다(서비스 변형만)
    const enroll = S.phase === 'enroll' || S.phase === 'enrolling' || S.phase === 'enrolled';
    const form = !enroll && (S.phase === 'form' || S.phase === 'loading'), busy = S.phase === 'loading' || S.phase === 'auto';
    const name = S.username.trim() || 'admin';
    return {
      v: {
        form, status: !form && !enroll, enroll, busy, ok: S.phase === 'done', canCancel: S.phase === 'auto',
        // 등록 묶음 — 변형(demo)에서는 enroll이 거짓이라 그려지지 않는다
        enrLocal: false, enrNote: '', enrWhy: '', enrWhyDisp: 'none', enrFieldsDisp: 'none',
        enrCode: '', enrName: '', enrAddr: '', enrAddrDisp: 'none', enrMsg: '', enrMsgC: '#fbbf24', enrMsgDisp: 'none',
        enrBusy: false, enrGoLabel: '등록', enrGoDisp: 'none', enrDone: false,
        setEnrCode: () => {}, setEnrName: () => {}, setEnrAddr: () => {}, enrGo: () => {}, enrBack: () => {},
        cardCls: S.fly ? 'in-away' : 'in-rise', cardTop: 70, frameOn: !!(S.fly || S.preload), mapFail: !!S.mapFail, cardDisp: S.flyDone ? 'none' : 'flex', chromeOp: S.fly ? 0 : 1, chromePe: S.fly ? 'none' : 'auto', spokes: [0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ a })),
        sub: S.phase === 'done' ? name + ' — 로그인됨' : '노드에 로그인',
        username: S.username, password: S.password,
        setUser: (e) => this.setState({ username: e.target.value, msg: '' }),
        setPass: (e) => this.setState({ password: e.target.value, msg: '' }),
        key: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submit(); return; } const c = e.getModifierState && e.getModifierState('CapsLock'); if (!!c !== S.caps) this.setState({ caps: !!c }); },
        enter: (e) => { if (e.key === 'Enter') { e.preventDefault(); const pw = document.querySelector('[data-in-pass]'); if (pw && !S.password) pw.focus(); else this.submit(); } },
        caps: S.caps ? '⇪ Caps Lock 켜짐' : '',
        pwType: S.showPw ? 'text' : 'password', pwTip: S.showPw ? '비밀번호 숨기기' : '비밀번호 보기',
        eye: S.showPw ? 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM4 4l16 16' : 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', eyeR: 3,
        togglePw: () => this.setState({ showPw: !S.showPw }),
        autoOn: S.auto ? 'true' : 'false', swBg: S.auto ? '#ede9e1' : 'rgba(255,255,255,0.08)', swX: S.auto ? 18 : 0,
        toggleAuto: () => this.setState({ auto: !S.auto }),
        userLine: S.msg && !S.username.trim() ? '#ff5d5d' : 'rgba(255,255,255,0.18)', passLine: S.msg && S.username.trim() ? '#ff5d5d' : 'rgba(255,255,255,0.18)',
        msg: S.msg, msgC: S.msgC,
        goLabel: S.phase === 'loading' ? '확인 중…' : '로그인',
        submit: (e) => this.submit(e),
        stBg: S.phase === 'done' ? '#3ecf8e' : 'rgba(255,255,255,0.05)', stLine: S.phase === 'done' ? '#3ecf8e' : 'rgba(255,255,255,0.14)',
        stTitle: S.phase === 'auto' ? name + '(으)로 자동 로그인 중…' : '로그인됨',
        stSub: S.phase === 'auto' ? '이 기기에 기억된 로그인 — 잠시 뒤 들어간다' : (S.auto ? '자동 로그인 켜짐 · ' : '') + '맵으로 내려간다…',
        cancel: () => { clearTimeout(this._autoT); this.setState({ phase: 'form', msg: '' }); setTimeout(() => { const el = document.querySelector('[data-in-pass]'); if (el) el.focus(); }, 50); },
        logout: () => { this.writeAuto(null); this.setState({ phase: 'form', auto: false, password: '', msg: '' }); },
        gwDot: S.gw === 'ok' ? '#3ecf8e' : '#f5b83d', gwText: S.gw === 'ok' ? '127.0.0.1:8787 · 연결됨' : '응답 확인 중…'
      }
    };
  }
  // 구름 지나기: 아래(카메라가 숙이는 쪽)에서 큰 구름 덩어리가 올라와 화면을 덮었다 걷힌다. 한가운데쯤 거의 하얗다
  flyDraw(g, W, H, DPR, p, t) {
    if (!g) return;
    g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, W, H);
    if (p <= 0 || p >= 1) return;
    const rnd = (s) => { const x = Math.sin(s * 91.7) * 24634.6345; return x - Math.floor(x); }, M = Math.max(W, H);
    for (let i = 0; i < 18; i++) {
      const r = (0.18 + rnd(i) * 0.22) * M * (0.7 + p * 0.9), sp = 0.8 + rnd(i + 30) * 0.7;
      const x = rnd(i + 10) * W + Math.sin(t * 0.7 + i) * 20, y = H + r - (p * sp + (rnd(i + 20) - 0.5) * 0.3) * (H + 2 * r);
      g.fillStyle = 'rgba(214,232,244,0.75)'; g.beginPath(); g.arc(x, y + r * 0.12, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const wash = Math.pow(Math.sin(p * Math.PI), 1.6) * 0.92;
    g.fillStyle = 'rgba(255,255,255,' + wash.toFixed(3) + ')'; g.fillRect(0, 0, W, H);
  }
  // ───── 배경: 맑은 하늘 · 구름 · 해 · 수평선 · 바다(물결 · 해 반사 · 갈매기). 30fps로 캔버스에 직접 그린다 ─────
  introSky() {
    const cv = document.querySelector('[data-in-sky]');
    if (!cv || this._raf) return;
    const g = cv.getContext('2d'), DPR = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    const fv = document.querySelector('[data-in-fly]'), g2 = fv ? fv.getContext('2d') : null;
    const size = () => { const r = cv.getBoundingClientRect(); W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height)); cv.width = W * DPR; cv.height = H * DPR; if (fv) { fv.width = W * DPR; fv.height = H * DPR; } };
    size(); this._rs = size; window.addEventListener('resize', size);
    // 구름: 둥근 덩어리 몇 개를 겹쳐 만든 뭉게구름. 높이 · 크기 · 속도가 다르다 (멀수록 작고 느림)
    const rnd = (s) => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
    const clouds = Array.from({ length: 7 }, (_, i) => ({ x: rnd(i + 1), y: 0.08 + rnd(i + 11) * 0.3, s: 0.55 + rnd(i + 21) * 0.9, v: 0.004 + rnd(i + 31) * 0.006,
      puffs: Array.from({ length: 5 + Math.floor(rnd(i + 41) * 3) }, (_, k) => ({ dx: (k - 2.5) * 34 + rnd(i * 9 + k) * 16, dy: -Math.sin((k + 0.5) / 6 * Math.PI) * 22 * (0.6 + rnd(i * 7 + k) * 0.6), r: 26 + rnd(i * 5 + k) * 20 })) }));
    const birds = Array.from({ length: 3 }, (_, i) => ({ x: rnd(i + 51), y: 0.16 + rnd(i + 61) * 0.18, v: 0.012 + rnd(i + 71) * 0.01, ph: rnd(i + 81) * 6, s: 0.7 + rnd(i + 91) * 0.5 }));
    let last = 0;
    const t0Of = (now) => now / 1000;
    const draw = (now) => {
      if (this._dead) return;
      this._raf = requestAnimationFrame(draw);
      const F = this._fly;
      if (now - last < (F ? 16 : 33)) return; last = now;
      // 카메라: cam 0 → 1 = 앞을 보다가 아래로 숙인다 (수평선이 위로 올라가 화면 밖으로). 구름 지나기: p 0 → 1
      let cam = 0;
      if (F) {
        const e = now - F.t0, dt = Math.min(40, now - F.last); F.last = now;   // 한 프레임이 길어도 건너뛰지 않게
        const k = Math.min(1, e / 1700); cam = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        if (e > 1150 && (F.p < 0.5 || F.ready || e > 4500)) F.p = Math.min(1, F.p + dt / 2800);   // 수평선이 먼저 올라간 뒤 구름으로   // 맵이 준비될 때까지 구름 한가운데서 기다린다
        this.flyDraw(g2, W, H, DPR, F.p, t0Of(now));
        const fr = document.querySelector('[data-in-map]');
        if (fr) { const op = F.ready ? Math.max(0, Math.min(1, (F.p - 0.45) / 0.3)) : 0; fr.style.opacity = op.toFixed(3); }
        if (F.p >= 1 && !F.done) { F.done = true; if (fr) fr.style.pointerEvents = 'auto'; g2 && g2.clearRect(0, 0, fv.width, fv.height); this.setState({ flyDone: true, mapFail: !F.ready }); }
        if (F.done) return;   // 맵이 다 드러나면 하늘은 더 그리지 않는다
      }
      const HZ0 = Math.round(H * 0.58), HZ = Math.round(HZ0 - cam * (HZ0 + H * 0.35));
      const t = now / 1000, sunX = W * 0.68, sunY = HZ - Math.min(H * 0.2, 150);
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      // 하늘
      const sky = g.createLinearGradient(0, 0, 0, HZ);
      sky.addColorStop(0, '#3f9fe3'); sky.addColorStop(0.45, '#7cc4f0'); sky.addColorStop(0.85, '#c4e8fa'); sky.addColorStop(1, '#e8f7fd');
      g.fillStyle = sky; g.fillRect(0, 0, W, HZ + 1);
      const top = HZ - HZ0;   // 하늘에 붙은 것(구름 · 새 · 해)도 수평선과 함께 올라간다
      // 해: 부드러운 빛무리 + 흰 핵
      const glow = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(W, H) * 0.45);
      glow.addColorStop(0, 'rgba(255,253,235,0.95)'); glow.addColorStop(0.06, 'rgba(255,250,220,0.55)'); glow.addColorStop(0.25, 'rgba(255,245,210,0.16)'); glow.addColorStop(1, 'rgba(255,245,210,0)');
      g.fillStyle = glow; g.fillRect(0, 0, W, HZ + 1);
      g.fillStyle = '#fffdf2'; g.beginPath(); g.arc(sunX, sunY, 26, 0, Math.PI * 2); g.fill();
      // 구름 (오른쪽으로 흘러간다)
      clouds.forEach((c) => {
        const span = W + 500, cx = ((c.x * span + t * c.v * span) % span) - 250, cy = c.y * HZ0 + top, s = c.s * Math.min(1.2, W / 1400 + 0.4);
        g.save(); g.translate(cx, cy); g.scale(s, s);
        g.fillStyle = 'rgba(206,229,244,0.9)';   // 아래 그늘
        c.puffs.forEach((p) => { g.beginPath(); g.arc(p.dx, p.dy + 8, p.r, 0, Math.PI * 2); g.fill(); });
        g.fillStyle = '#ffffff';
        c.puffs.forEach((p) => { g.beginPath(); g.arc(p.dx, p.dy, p.r, 0, Math.PI * 2); g.fill(); });
        g.fillRect(-100, -6, 200, 14);
        g.restore();
      });
      // 갈매기
      g.strokeStyle = 'rgba(40,62,84,0.75)'; g.lineWidth = 1.8; g.lineCap = 'round';
      birds.forEach((b) => {
        const span = W + 200, x = ((b.x * span + t * b.v * span) % span) - 100, y = b.y * HZ0 + top + Math.sin(t * 0.9 + b.ph) * 8, f = Math.sin(t * 5 + b.ph) * 4 * b.s, w = 11 * b.s;
        g.beginPath(); g.moveTo(x - w, y - f); g.quadraticCurveTo(x - w / 2, y - 4 * b.s - f / 2, x, y); g.quadraticCurveTo(x + w / 2, y - 4 * b.s - f / 2, x + w, y - f); g.stroke();
      });
      // 먼 섬 (수평선 왼쪽, 엷은 실루엣)
      g.fillStyle = 'rgba(94,140,160,0.55)';
      g.beginPath(); const ix = W * 0.16; g.moveTo(ix - 120, HZ); g.quadraticCurveTo(ix - 60, HZ - 22, ix, HZ - 20); g.quadraticCurveTo(ix + 50, HZ - 30, ix + 140, HZ); g.closePath(); g.fill();
      g.fillStyle = 'rgba(94,140,160,0.35)';
      g.beginPath(); g.moveTo(ix + 120, HZ); g.quadraticCurveTo(ix + 170, HZ - 12, ix + 230, HZ); g.closePath(); g.fill();
      // 바다: 수평선은 밝고 아래로 갈수록 깊다 (노드 화면 바다 색과 이어지게)
      const sea = g.createLinearGradient(0, HZ, 0, H);
      sea.addColorStop(0, '#5cc3d6'); sea.addColorStop(0.18, '#3fb0c9'); sea.addColorStop(0.6, '#2a9fb8'); sea.addColorStop(1, '#1f8aa3');
      g.fillStyle = sea; g.fillRect(0, HZ, W, H - HZ);
      // 수평선 아지랑이
      const haze = g.createLinearGradient(0, HZ - 8, 0, HZ + 10);
      haze.addColorStop(0, 'rgba(255,255,255,0)'); haze.addColorStop(0.5, 'rgba(255,255,255,0.55)'); haze.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = haze; g.fillRect(0, HZ - 8, W, 18);
      // 해 반사: 해 아래로 흔들리는 빛 조각
      for (let i = 0; i < 46; i++) {
        const d = i / 46, y = HZ + 4 + Math.pow(d, 1.5) * (H - HZ) * 0.9, w = (8 + d * 70) * (0.4 + 0.6 * Math.abs(Math.sin(t * 1.7 + i * 1.3))), x = sunX + Math.sin(t * 1.1 + i * 2.1) * (6 + d * 40);
        g.fillStyle = 'rgba(255,252,230,' + (0.5 * (1 - d) + 0.08).toFixed(3) + ')';
        g.fillRect(x - w / 2, y, w, 1.5 + d * 2.5);
      }
      // 물결: 노드 화면 바다의 '‿' 표시를 원근으로 — 멀수록 작고 촘촘, 가까울수록 크고 느리게 흔들린다
      g.strokeStyle = 'rgba(255,255,255,0.38)'; g.lineCap = 'round';
      let y = HZ + 6, row = 0;
      while (y < H + 20) {
        const d = (y - HZ) / Math.max(1, H - HZ), sz = 3 + d * 18, gap = 34 + d * 150, off = (row * 47.3) % gap + Math.sin(t * 0.6 + row) * (4 + d * 14) + t * (6 + d * 10);
        g.lineWidth = 1 + d * 2;
        for (let x = -gap + (off % gap); x < W + gap; x += gap) {
          const bob = Math.sin(t * 1.4 + x * 0.013 + row) * d * 3;
          g.beginPath(); g.moveTo(x - sz, y + bob); g.quadraticCurveTo(x, y + bob + sz * 0.55, x + sz, y + bob); g.stroke();
        }
        y += 6 + d * 34; row++;
      }
    };
    this._raf = requestAnimationFrame(draw);
  }
}
