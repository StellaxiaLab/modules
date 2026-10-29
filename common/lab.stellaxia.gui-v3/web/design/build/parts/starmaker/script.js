// 스타메이커 — 항성 · 행성(구) 컴포넌트를 만들고 · 저장하고 · 내보내고 · 받아오는 창 (유틸 › 스타메이커)
//   ① 원본: 사진 · GIF(프레임마다) 또는 미리 만든 구 데이터(terra.sphere JSON)
//   ② 구 형성: 원본을 구의 표면 지도(등장방형, 가로 = 경도 360° · 세로 = 위도 180°)로 펴는 방법 4가지
//   ③ 표면: 해상도 · 밝기 · 자전 · 기울기 · (GIF) 프레임 빠르기   ④ 렌더: 항성(스스로 빛남 · 가장자리 어두워짐) / 행성(빛 방향 · 밤). 발광(코로나 · 대기)은 쓰지 않는다
//   구 형성 방법은 아래 표면 지도 위에 — 지도는 지구본 고어(12 · 8 조각) 또는 펼친 등장방형, 자전과 함께 흐른다
//   ⑤ 저장: 구 데이터(terra.sphere v1) → 보관함 star/… (폴더로 정리). 내보내기 = .sphere.json 파일
//   구 데이터 형식 — 확장을 염두에 둔 JSON: format · version · 이름 · 종류 · 원본 · 형성 · 표면(투영 + 프레임 이미지들) · 렌더 값 · 미리보기 · ext(앞으로 붙일 것)
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { algo: 'equirect', res: 256, gain: 1, spin: 0.06, tilt: 12, fps: 12, kind: 'star', limb: 0.55, light: 225, map: 'gore12', view: 'px', play: true, name: '', folder: 'star', newFolder: '', msg: '', msgErr: false, drop: false, srcLabel: '', help: false, saveWarn: null, srcType: 'none', nFrames: 1, texW: 256, cur: null, rev: 0 };
  }
  componentDidMount() {
    this._live = true; this._t0 = performance.now(); this._spinA = 0;
    this._src = null; this._tex = null; this.buildDefault();
    // 다른 화면과 같은 규칙 — 30fps, 탭이 숨겨졌거나 창이 안 보이면(최소화 · 닫힘 — frame 안에서 크기 0) 쉰다
    const loop = (now) => { if (!this._live) return; if (!document.hidden && now - (this._tick || 0) >= 32) { this._tick = now; this.frame(now); } this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }
  componentWillUnmount() { this._live = false; cancelAnimationFrame(this._raf); }

  // ───── 보관함 — 브라우저 저장소(색인 + 파일마다 한 칸). 전역 틀의 유틸 › 스타메이커 › star 가 같은 색인을 읽는다 ─────
  IDX() { return 'terra.star.index'; }
  lib() { try { const v = JSON.parse(localStorage.getItem(this.IDX()) || 'null'); if (v && Array.isArray(v.files)) { if (!v.folders || !v.folders.includes('star')) v.folders = ['star'].concat(v.folders || []); return v; } } catch (e) {} return { v: 1, folders: ['star'], files: [] }; }
  libPut(L) { localStorage.setItem(this.IDX(), JSON.stringify(L)); }
  // ───── 원본 → 표면 지도(등장방형) ─────
  ALGOS() { return [
    ['equirect', '등장방형', '원본을 그대로 경위도 지도로 — 가로 360° · 세로 180° (2 : 1 원본에 맞음)'],
    ['mirror', '거울 감싸기', '원본을 반 바퀴에 펴고 나머지 반은 거울로 — 이음매 없이 감김'],
    ['disc', '원판 펴기', '사진 속 둥근 천체(가운데 원)를 정사영으로 되돌려 앞 반구에, 뒤 반구는 거울로'],
    ['polar', '극 투영', '원본 가운데 = 북극, 바깥으로 갈수록 남쪽 — 한 장으로 구 전체'],
    ['billboard', '원판 (바라보기)', '구로 감싸지 않고 원으로 — 어디에 있든 늘 나를 바라봐 원본이 일그러지지 않음. 음영(가장자리 · 빛)으로 구처럼 보이게, 자전 = 원판 안에서 돌기']]; }
  // 기본 무늬 — 원본이 없을 때: 값 노이즈 두 겹(파랑 → 하늘 → 흰빛, 씬의 항성과 같은 계열)
  buildDefault() {
    const W = 256, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'), im = c.createImageData(W, H), P = new Uint8Array(512);
    for (let i = 0; i < 256; i++) P[i] = P[i + 256] = (Math.random() * 256) | 0;
    const h3 = (x, y, z) => P[(P[(P[x & 255] + y) & 255] + z) & 255] / 255, L = (a, b, k) => a + (b - a) * k, sm = (t) => t * t * (3 - 2 * t);
    const n3 = (x, y, z) => { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
      return L(L(L(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), L(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v), L(L(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), L(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v), w); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const lo = x / W * Math.PI * 2, la = (0.5 - y / H) * Math.PI, X = Math.cos(la) * Math.cos(lo), Y = Math.sin(la), Z = Math.cos(la) * Math.sin(lo);
      const n = n3(X * 2.2 + 9, Y * 2.2 + 3, Z * 2.2) * 0.65 + n3(X * 7 + 1, Y * 7 + 5, Z * 7 + 2) * 0.35, k = Math.min(1, Math.max(0, (n - 0.25) / 0.6)), j = (y * W + x) * 4;
      im.data[j] = L(40, 236, k * k); im.data[j + 1] = L(70, 244, k); im.data[j + 2] = L(170, 255, Math.sqrt(k)); im.data[j + 3] = 255; }
    c.putImageData(im, 0, 0);
    this._tex = [{ cv, im, d: 100 }]; this._texSrc = 'default'; this._proj = 'equirect';
  }
  // 원본 불러오기 — 이미지 · GIF(ImageDecoder 로 프레임마다, 최대 48장) / 구 데이터(JSON)
  async loadFile(f) {
    if (!f) return;
    if (/json$/i.test(f.type) || /\.json$/i.test(f.name)) { try { this.loadSphere(JSON.parse(await f.text()), null); } catch (e) { this.say('구 데이터를 읽지 못했어요 — ' + e.message, true); } return; }
    if (!/^image\//.test(f.type)) { this.say('이미지 · GIF · 구 데이터(.json)만 불러올 수 있어요', true); return; }
    const frames = [];
    try {
      if (/gif$/i.test(f.type) && window.ImageDecoder) {
        const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: f.type }); await dec.tracks.ready; const n = Math.min(48, dec.tracks.selectedTrack.frameCount || 1);
        for (let i = 0; i < n; i++) { const r = await dec.decode({ frameIndex: i }), vf = r.image, cv = document.createElement('canvas'); cv.width = vf.displayWidth; cv.height = vf.displayHeight; cv.getContext('2d').drawImage(vf, 0, 0); frames.push({ cv, d: Math.max(20, (vf.duration || 100000) / 1000) }); vf.close(); }
      }
    } catch (e) { frames.length = 0; }
    if (!frames.length) { const url = URL.createObjectURL(f), img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }).catch(() => {}); if (!img.naturalWidth) { this.say('이미지를 열지 못했어요', true); return; } const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; cv.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(url); frames.push({ cv, d: 100 }); }
    this._src = { name: f.name, frames, w: frames[0].cv.width, h: frames[0].cv.height, type: frames.length > 1 ? 'gif' : 'image' };
    const avg = frames.reduce((a, q) => a + q.d, 0) / frames.length;
    this.setState({ srcType: this._src.type, nFrames: frames.length, fps: frames.length > 1 ? Math.max(2, Math.min(30, Math.round(1000 / avg))) : this.state.fps, name: this.state.name || f.name.replace(/\.[^.]+$/, ''), cur: null,
      srcLabel: f.name + ' · ' + this._src.w + '×' + this._src.h + (frames.length > 1 ? ' · ' + frames.length + '프레임' : '') }, () => this.build());
    this.say('');
  }
  // 표면 지도 만들기 — 고른 형성 방법으로 프레임마다 W × W/2
  build() {
    const S = this._src; if (!S) return; const W = this.state.res, H = W / 2, A = this.state.algo, out = [];
    if (A === 'billboard') {   // 원판 — 원본 가운데 정사각(꽉 채우기)을 원으로 잘라 W × W 그대로 (투영 없음)
      for (const fr of S.frames) { const cv = document.createElement('canvas'); cv.width = cv.height = W; const c = cv.getContext('2d'), sw = fr.cv.width, sh = fr.cv.height, m = Math.min(sw, sh);
        c.save(); c.beginPath(); c.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); c.clip(); c.drawImage(fr.cv, (sw - m) / 2, (sh - m) / 2, m, m, 0, 0, W, W); c.restore(); out.push({ cv, im: c.getImageData(0, 0, W, W), d: fr.d }); }
      this._tex = out; this._texSrc = 'build'; this._proj = 'billboard'; this.setState({ texW: W, rev: this.state.rev + 1 }); return;
    }
    this._proj = 'equirect';
    for (const fr of S.frames) {
      const sw = fr.cv.width, sh = fr.cv.height, sd = fr.cv.getContext('2d').getImageData(0, 0, sw, sh).data, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'), im = c.createImageData(W, H), d = im.data;
      const samp = (u, v, j) => { const x = Math.min(sw - 1, Math.max(0, Math.floor(u * sw))), y = Math.min(sh - 1, Math.max(0, Math.floor(v * sh))), k = (y * sw + x) * 4; d[j] = sd[k]; d[j + 1] = sd[k + 1]; d[j + 2] = sd[k + 2]; d[j + 3] = 255; };
      const R = Math.min(sw, sh) / 2 * 0.98, cx = sw / 2, cy = sh / 2;
      for (let y = 0; y < H; y++) { const la = (0.5 - (y + 0.5) / H) * Math.PI; for (let x = 0; x < W; x++) { const j = (y * W + x) * 4, u = (x + 0.5) / W, lo = u * Math.PI * 2;
        if (A === 'equirect') samp(u, (y + 0.5) / H, j);
        else if (A === 'mirror') { const m = u < 0.5 ? u * 2 : (1 - u) * 2; samp(m, (y + 0.5) / H, j); }
        else if (A === 'disc') { const X = Math.cos(la) * Math.sin(lo), Y = Math.sin(la); samp((cx + X * R) / sw, (cy - Y * R) / sh, j); }   // 앞 · 뒤 반구 모두 같은 정사영 — 뒤는 거울
        else { const co = (0.5 - la / Math.PI), rr = co * R; samp((cx + Math.cos(lo) * rr) / sw, (cy + Math.sin(lo) * rr) / sh, j); } } }
      c.putImageData(im, 0, 0); out.push({ cv, im, d: fr.d });
    }
    this._tex = out; this._texSrc = 'build'; this.setState({ texW: W, rev: this.state.rev + 1 });
  }
  // 구 데이터 받아오기 — terra.sphere v1. 표면 프레임 이미지를 그대로 쓰고(형성 단계 건너뜀), 렌더 값을 따른다
  async loadSphere(J, id) {
    if (!J || J.format !== 'terra.sphere') { this.say('terra.sphere 형식이 아니에요', true); return; }
    const fr = (J.surface && J.surface.frames) || [], out = [];
    for (const src of fr) { const img = new Image(); await new Promise((res) => { img.onload = res; img.onerror = res; img.src = src.data || src; }); if (!img.naturalWidth) continue; const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight; const c = cv.getContext('2d'); c.drawImage(img, 0, 0); out.push({ cv, im: c.getImageData(0, 0, cv.width, cv.height), d: src.d || 1000 / ((J.surface && J.surface.fps) || 12) }); }
    if (!out.length) { this.say('표면 이미지가 없어요', true); return; }
    const Rn = J.render || {};
    this._src = null; this._tex = out; this._texSrc = 'sphere'; this._proj = J.surface && J.surface.projection === 'billboard' ? 'billboard' : 'equirect';
    this.setState({ srcType: 'sphere', nFrames: out.length, texW: out[0].cv.width, name: J.name || '', kind: J.kind === 'planet' ? 'planet' : 'star', spin: Rn.spin ?? 0.06, tilt: Rn.tilt ?? 12, limb: Rn.limb ?? 0.55, light: Rn.light ?? 225, gain: Rn.gain ?? 1, fps: (J.surface && J.surface.fps) || 12, cur: id,
      srcLabel: '구 데이터 · ' + (J.name || '이름 없음') + ' · ' + out[0].cv.width + '×' + out[0].cv.height + (out.length > 1 ? ' · ' + out.length + '프레임' : ''), rev: this.state.rev + 1 });
    this.say(id ? '보관함에서 불러왔어요' : '구 데이터를 불러왔어요');
  }
  // 구 데이터 만들기 — 확장 가능한 JSON (모르는 키는 무시하고 ext 에 덧붙여 나간다)
  sphereData() {
    const S = this.state, T = this._tex || [], anim = T.length > 1, q = anim ? 0.82 : 0.9;
    const enc = (cv) => { let u = ''; try { u = cv.toDataURL('image/webp', q); } catch (e) {} return u && u.startsWith('data:image/webp') ? u : cv.toDataURL('image/png'); };
    const id = S.cur || 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return { format: 'terra.sphere', version: 1, id, name: (S.name || '이름 없는 구').trim(), kind: S.kind, created: new Date().toISOString(),
      source: { type: this._texSrc === 'sphere' ? 'sphere' : this._src ? this._src.type : 'procedural', name: this._src ? this._src.name : null, w: this._src ? this._src.w : null, h: this._src ? this._src.h : null },
      build: { algo: this._texSrc === 'build' ? S.algo : null, res: T[0] ? T[0].cv.width : S.res },
      surface: { projection: this._proj || 'equirect', w: T[0] ? T[0].cv.width : 0, h: T[0] ? T[0].cv.height : 0, fps: anim ? S.fps : 0, loop: true, frames: T.map((t) => ({ data: enc(t.cv), d: Math.round(1000 / S.fps) })) },
      render: { spin: S.spin, tilt: S.tilt, gain: S.gain, limb: S.limb, light: S.kind === 'planet' ? S.light : null, ambient: 0.22 },
      thumb: this.thumb(), ext: {} };
  }
  thumb() { const cv = document.createElement('canvas'); cv.width = cv.height = 56; this.renderSphere(cv.getContext('2d'), 56, 56, 22, false, performance.now()); return cv.toDataURL('image/png'); }
  // 저장 — 같은 폴더에 같은 이름이 있으면 경고하고(한 번 더 누르면 그 파일을 덮어씀), 없으면 새 파일로 더한다 (불러온 파일이라도 이름을 바꾸면 새 파일)
  save() {
    const S = this.state; if (!this._tex) return;
    const nm = (S.name || '이름 없는 구').trim(), path = S.folder || 'star', L0 = this.lib(), dup = L0.files.find((f) => f.path === path && f.name === nm), now = Date.now();
    if (dup && !(S.saveWarn && S.saveWarn.id === dup.id && now - S.saveWarn.at < 6000)) { this.setState({ saveWarn: { id: dup.id, at: now } }); this.say(path + '/' + nm + ' 이(가) 이미 있어요 — 한 번 더 누르면 덮어써요', true); clearTimeout(this._swT); this._swT = setTimeout(() => this.setState({ saveWarn: null }), 6000); return; }
    this.setState({ saveWarn: null, cur: dup ? dup.id : null });
    this.state = Object.assign({}, this.state, { cur: dup ? dup.id : null });
    const J = this.sphereData(), txt = JSON.stringify(J), L = this.lib();
    const meta = { id: J.id, name: J.name, path: S.folder || 'star', kind: J.kind, bytes: txt.length, frames: J.surface.frames.length, thumb: J.thumb, at: Date.now() };
    try { localStorage.setItem('terra.star.f.' + J.id, txt); L.files = L.files.filter((f) => f.id !== J.id).concat([meta]); if (!L.folders.includes(meta.path)) L.folders.push(meta.path); this.libPut(L); }
    catch (e) { this.say('저장 공간이 모자라요 (' + Math.round(txt.length / 1024) + 'KB) — 해상도를 낮추거나 내보내기로 파일로 받으세요', true); return; }
    this.setState({ cur: J.id }); this.say(meta.path + '/' + J.name + (dup ? ' 덮어씀 · ' : ' 저장 · ') + Math.round(txt.length / 1024) + 'KB');
    if (this.props.onSaved) this.props.onSaved(J.id);
  }
  exportFile() { if (!this._tex) return; const J = this.sphereData(), b = new Blob([JSON.stringify(J, null, 1)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (J.name || 'sphere').replace(/[\\/:*?"<>|]+/g, '_') + '.sphere.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); this.say('내보냈어요 — ' + a.download); }
  openLib(id) { let J = null; try { J = JSON.parse(localStorage.getItem('terra.star.f.' + id) || 'null'); } catch (e) {} if (!J) { this.say('보관함에서 찾지 못했어요', true); return; } const m = this.lib().files.find((f) => f.id === id); this.setState({ folder: m ? m.path : 'star' }); this.loadSphere(J, id); }
  delLib(id) { const L = this.lib(); L.files = L.files.filter((f) => f.id !== id); try { localStorage.removeItem('terra.star.f.' + id); this.libPut(L); } catch (e) {} if (this.state.cur === id) this.setState({ cur: null }); this.say('지웠어요'); if (this.props.onSaved) this.props.onSaved(null); }
  addFolder() { const nm = (this.state.newFolder || '').trim().replace(/[\\/]+/g, '-'); if (!nm) return; const p = (this.state.folder || 'star') + '/' + nm, L = this.lib(); if (!L.folders.includes(p)) L.folders.push(p); try { this.libPut(L); } catch (e) {} this.setState({ folder: p, newFolder: '' }); if (this.props.onSaved) this.props.onSaved(null); }
  say(t, err) { this.setState({ msg: t, msgErr: !!err }); }

  // ───── 그리기 — 구(광선 · 구 교차 → 법선 → 기울기 · 자전 → 경위도 → 표면 지도) ─────
  frame(now) {
    const dt = Math.min(0.1, (now - (this._last || now)) / 1000); this._last = now;
    // 밖에서 보관함 파일 열기 (전역 틀 › star 의 파일 → load = id#번호)
    const LD = this.props.load; if (LD && LD !== this._ldSeen) { this._ldSeen = LD; this.openLib(String(LD).split('#')[0]); }
    if (this.state.play) this._spinA += dt * this.state.spin * Math.PI * 2;
    const cv = this._cv && this._cv.isConnected ? this._cv : (this._cv = document.querySelector('canvas[data-smprev]')); if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const R = Math.max(30, Math.min(w, h) * 0.34);
    if (this.state.view === 'glyph') this.renderGlyph(g, w, h, R, now); else this.renderSphere(g, w, h, R, true, now);
    if (now - (this._mapAt || 0) > 33) { this._mapAt = now; this.drawMap(now); }
  }
  // 지금 프레임의 표면 지도
  texNow(now) { const T = this._tex; if (!T || !T.length) return null; if (T.length === 1) return T[0]; const fd = 1000 / Math.max(1, this.state.fps), k = Math.floor((now - this._t0) / fd) % T.length; return T[(k + T.length) % T.length]; }
  renderSphere(g, w, h, R, deco, now) {
    const S = this.state, TX = this.texNow(now); if (!TX) return; const cx = w / 2, cy = h / 2, star = S.kind === 'star';
    const D = Math.ceil(R * 2), key = D + '|' + S.tilt;
    if (!this._geo || this._geo.key !== key) {   // 화소마다 법선 → (기울인) 위도 · 기준 경도 · μ(= 보는 방향 cos) — 크기 · 기울기가 바뀔 때만
      //   기울기 = 자전축을 화면에서 기울인 각(+ 는 반시계) · 그 위에 늘 15° 앞으로 숙여 북극 쪽이 조금 보이게
      const n = D * D, la = new Float32Array(n), lo = new Float32Array(n), mu = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), on = new Uint8Array(n), t = S.tilt * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t), PT = 15 * Math.PI / 180, cp = Math.cos(PT), sp = Math.sin(PT);
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) { const X = (x + 0.5 - R) / R, Y = (R - y - 0.5) / R, r2 = X * X + Y * Y, i = y * D + x; if (r2 > 1) continue; const Z = Math.sqrt(1 - r2);
        const X1 = X * ct + Y * st, Y1 = -X * st + Y * ct, Y2 = Y1 * cp + Z * sp, Z2 = -Y1 * sp + Z * cp; on[i] = 1; la[i] = Math.asin(Math.max(-1, Math.min(1, Y2))); lo[i] = Math.atan2(X1, Z2); mu[i] = Z; nx[i] = X; ny[i] = Y; }
      this._geo = { key, D, la, lo, mu, nx, ny, on, im: null };
    }
    const G = this._geo; if (!G.im || G.im.width !== D) G.im = g.createImageData(D, D);
    const d = G.im.data, td = TX.im.data, TW = TX.im.width, TH = TX.im.height, A = this._spinA, BB = this._proj === 'billboard', ca = Math.cos(A), sa = Math.sin(A), gain = S.gain, limb = S.limb, L = S.light * Math.PI / 180, lx = Math.cos(L), ly = Math.sin(L), lz = 0.35, ll = Math.hypot(lx, ly, lz);
    for (let i = 0, n = D * D; i < n; i++) { const j = i * 4; if (!G.on[i]) { d[j + 3] = 0; continue; }
      let tx, ty;
      if (BB) { const X = G.nx[i] * ca + G.ny[i] * sa, Y = -G.nx[i] * sa + G.ny[i] * ca; tx = Math.min(TW - 1, Math.max(0, ((X + 1) / 2 * TW) | 0)); ty = Math.min(TH - 1, Math.max(0, ((1 - Y) / 2 * TH) | 0)); }   // 원판 — 화면을 바라보는 원, 자전 = 원판 안에서 돌기
      else { let u = (G.lo[i] + A) / (Math.PI * 2); u -= Math.floor(u); const v = 0.5 - G.la[i] / Math.PI; tx = Math.min(TW - 1, (u * TW) | 0); ty = Math.min(TH - 1, Math.max(0, (v * TH) | 0)); }
      const k = (ty * TW + tx) * 4;
      let s;
      if (star) s = gain * (1 - limb * (1 - G.mu[i]));   // 가장자리 어두워짐 I = 1 − u(1 − μ)
      else { const dl = (G.nx[i] * lx + G.ny[i] * ly + G.mu[i] * lz) / ll; s = gain * (0.22 + 0.78 * Math.max(0, dl)) * (1 - limb * 0.5 * (1 - G.mu[i])); }
      let r = td[k] * s, gg = td[k + 1] * s, b = td[k + 2] * s;
      const aa = Math.min(1, (1 - Math.hypot(G.nx[i], G.ny[i])) * R * 1.2 + 0.0001);   // 테두리 반 화소 부드럽게
      if (BB && td[k + 3] < 8) { d[j + 3] = 0; continue; }
      d[j] = r > 255 ? 255 : r; d[j + 1] = gg > 255 ? 255 : gg; d[j + 2] = b > 255 ? 255 : b; d[j + 3] = Math.min(255, aa * 255); }
    const oc = this._oc || (this._oc = document.createElement('canvas')); if (oc.width !== D) { oc.width = oc.height = D; } oc.getContext('2d').putImageData(G.im, 0, 0);
    g.drawImage(oc, cx - R, cy - R, D, D);
    if (deco) this.drawDirs(g, cx, cy, R);
  }
  // 방향 표시 — 자전축(점선, 북극 점) · 자전 방향(적도 앞쪽의 화살) · 빛 방향(행성: 빛이 오는 쪽 바깥에서 들어오는 화살). 흐린 레거시 선
  drawDirs(g, cx, cy, R) {
    const S = this.state, t = S.tilt * Math.PI / 180, ax = -Math.sin(t), ay = Math.cos(t), BB = this._proj === 'billboard';
    g.save(); g.lineWidth = 1; g.strokeStyle = 'rgba(150,240,170,0.55)'; g.fillStyle = 'rgba(208,255,150,0.9)';
    if (!BB) {
      g.setLineDash([3, 4]); g.beginPath(); g.moveTo(cx + ax * R * 1.28, cy - ay * R * 1.28); g.lineTo(cx - ax * R * 1.28, cy + ay * R * 1.28); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(cx + ax * R * 1.28, cy - ay * R * 1.28, 2.2, 0, Math.PI * 2); g.fill();   // 북극 쪽
      g.font = '600 10px "Geist Mono", monospace'; g.fillText('N', cx + ax * R * 1.36 + 4, cy - ay * R * 1.36);
    }
    if (S.spin) { const dir = S.spin > 0 ? -1 : 1, ex = Math.cos(t), ey = Math.sin(t), r2 = R * 1.12, a0 = Math.PI / 2 - 0.35, a1 = Math.PI / 2 + 0.35;   // 적도 앞쪽 — 표면이 흐르는 쪽으로 (원판이면 원 둘레를 따라)
      g.beginPath(); if (BB) g.arc(cx, cy, r2, a0, a1); else g.ellipse(cx, cy, r2, r2 * 0.26, -t, a0, a1); g.stroke();
      const ae = dir < 0 ? a1 : a0, px = BB ? cx + Math.cos(ae) * r2 : cx + (Math.cos(ae) * r2 * ex - Math.sin(ae) * r2 * 0.26 * (-ey)), py = BB ? cy + Math.sin(ae) * r2 : cy + (Math.cos(ae) * r2 * (-ey) + Math.sin(ae) * r2 * 0.26 * ex);
      const tx = BB ? -Math.sin(ae) * -dir : ex * dir, ty = BB ? Math.cos(ae) * -dir : -ey * dir, nx2 = -ty, ny2 = tx;
      g.beginPath(); g.moveTo(px + tx * 6, py + ty * 6); g.lineTo(px - nx2 * 3.5, py - ny2 * 3.5); g.lineTo(px + nx2 * 3.5, py + ny2 * 3.5); g.closePath(); g.fill(); }
    if (S.kind === 'planet') { const L = S.light * Math.PI / 180, lx = Math.cos(L), ly = -Math.sin(L), r0 = R * 1.55, r1 = R * 1.18;   // 빛 — 바깥 r0 의 빛 점에서 행성 쪽으로
      g.strokeStyle = 'rgba(255,230,160,0.75)'; g.fillStyle = 'rgba(255,230,160,0.95)'; g.beginPath(); g.arc(cx + lx * (r0 + 6), cy + ly * (r0 + 6), 3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(cx + lx * r0, cy + ly * r0); g.lineTo(cx + lx * r1, cy + ly * r1); g.stroke();
      const hx = cx + lx * r1, hy = cy + ly * r1; g.beginPath(); g.moveTo(hx - lx * 1, hy - ly * 1); g.lineTo(hx + lx * 6 - ly * 3.5, hy + ly * 6 + lx * 3.5); g.lineTo(hx + lx * 6 + ly * 3.5, hy + ly * 6 - lx * 3.5); g.closePath(); g.fill(); }
    g.restore();
  }
  // 글자 장 미리보기 — 실제 씬처럼: 구를 칸(11px 글꼴 · 7 × 13)마다 평균 색으로 투영(마스크), 투영된 글자는 볼드 · 바깥은 흐린 바탕 글자
  renderGlyph(g, w, h, R, now) {
    const cw = 7, ch = 13, cols = Math.ceil(w / cw), rows = Math.ceil(h / ch), sc = this._gc || (this._gc = document.createElement('canvas'));
    if (sc.width !== w || sc.height !== h) { sc.width = w; sc.height = h; } const sg = sc.getContext('2d'); sg.clearRect(0, 0, w, h); this.renderSphere(sg, w, h, R, true, now);
    const lo = this._lc || (this._lc = document.createElement('canvas')); lo.width = cols; lo.height = rows; const lg = lo.getContext('2d'); lg.imageSmoothingEnabled = true; lg.imageSmoothingQuality = 'high'; lg.clearRect(0, 0, cols, rows); lg.drawImage(sc, 0, 0, cols, rows);
    const px = lg.getImageData(0, 0, cols, rows).data, GL = this._gl || (this._gl = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789+-*/=<>:;.#%&|~^'), GS = this._gs || (this._gs = new Uint8Array(cols * rows * 2).map(() => (Math.random() * GL.length) | 0));
    if (Math.random() < 0.5) GS[(Math.random() * GS.length) | 0] = (Math.random() * GL.length) | 0;
    g.textBaseline = 'top';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const k = (y * cols + x) * 4, a = px[k + 3] / 255, ch2 = GL[GS[(y * cols + x) % GS.length]];
      if (a < 0.08 || px[k] + px[k + 1] + px[k + 2] < 18) { g.font = '500 9px "Geist Mono", monospace'; g.fillStyle = 'rgba(40,52,96,0.55)'; g.fillText(ch2, x * cw, y * ch); continue; }
      const q = 1.3 / Math.max(0.2, a), c = 'rgb(' + Math.min(255, px[k] * q | 0) + ',' + Math.min(255, px[k + 1] * q | 0) + ',' + Math.min(255, px[k + 2] * q | 0) + ')';   // 칸 평균 색(투영) — 작은 볼드 글자라 조금 밝힌다
      g.font = '700 9px "Geist Mono", monospace'; g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 0.5; g.fillText(ch2, x * cw, y * ch); g.strokeText(ch2, x * cw, y * ch); }
  }
  // 표면 지도 — 지구본 고어: 경도를 n 조각으로 나눠, 조각마다 위도 φ 에서 폭 ∝ cos φ (사인 곡선 고어 — 오려 붙이면 구가 된다). 펼침 = 등장방형 그대로
  //   자전과 함께 경도가 흐르고(구 미리보기와 같은 면), GIF 는 지금 프레임. 지도 높이 H · 폭 2H (경도 360° : 위도 180°)
  drawMap(now) {
    const cv = this._mc && this._mc.isConnected ? this._mc : (this._mc = document.querySelector('canvas[data-smtex]')), TX = this.texNow(now); if (!cv || !TX) return;
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'), mode = this.state.map, n = mode === 'gore8' ? 8 : mode === 'gore12' ? 12 : 0, top = 58, H = Math.max(40, Math.min(h - top - 10, (w - 40) / 2.1)), W = Math.round(H * 2), x0 = Math.round((w - W) / 2), y0 = Math.round(top + (h - top - 10 - H) / 2);
    g.fillStyle = '#020308'; g.fillRect(0, 0, w, h);
    if (this._proj === 'billboard') {   // 원판 — 투영 없이 그대로: 원 하나 (자전 = 돌기)
      const D = Math.round(H), xc = Math.round(w / 2), yc = Math.round(y0 + H / 2); g.save(); g.translate(xc, yc); g.rotate(-this._spinA); g.drawImage(TX.cv, -D / 2, -D / 2, D, D); g.restore();
      g.strokeStyle = 'rgba(70,160,108,0.4)'; g.lineWidth = 1; g.beginPath(); g.arc(xc, yc, D / 2 + 0.5, 0, Math.PI * 2); g.stroke(); return; }
    const Hh = Math.round(H), key = W + 'x' + Hh + n;
    if (!this._mg || this._mg.key !== key) {   // 화소마다 (경도 비율, 위도 비율, 안/밖) — 크기 · 조각 수가 바뀔 때만
      const N = W * Hh, U = new Float32Array(N), V = new Float32Array(N), on = new Uint8Array(N), gw = W / Math.max(1, n);
      for (let y = 0; y < Hh; y++) { const v = (y + 0.5) / Hh, cph = Math.cos((0.5 - v) * Math.PI); for (let x = 0; x < W; x++) { const i = y * W + x; V[i] = v;
        if (!n) { U[i] = (x + 0.5) / W; on[i] = 1; continue; }
        const k = Math.floor(x / gw), dx = (x + 0.5) - (k + 0.5) * gw, half = gw / 2 * cph; if (Math.abs(dx) > half) continue;   // 조각 밖
        U[i] = (k + 0.5 + dx / (gw / 2) / Math.max(1e-3, cph) * 0.5) / n; on[i] = Math.abs(dx) > half - 1 ? 2 : 1; } }
      this._mg = { key, U, V, on, im: g.createImageData(W, Hh) };
    }
    const M = this._mg, d = M.im.data, td = TX.im.data, TW = TX.im.width, TH = TX.im.height, sh = this._spinA / (Math.PI * 2);
    for (let i = 0, N = W * Hh; i < N; i++) { const j = i * 4; if (!M.on[i]) { d[j + 3] = 0; continue; } let u = M.U[i] - sh; u -= Math.floor(u); const tx = Math.min(TW - 1, (u * TW) | 0), ty = Math.min(TH - 1, (M.V[i] * TH) | 0), k = (ty * TW + tx) * 4, e = M.on[i] === 2 ? 0.55 : 1;
      d[j] = td[k] * e; d[j + 1] = td[k + 1] * e; d[j + 2] = td[k + 2] * e; d[j + 3] = 255; }
    const oc = this._moc || (this._moc = document.createElement('canvas')); if (oc.width !== W || oc.height !== Hh) { oc.width = W; oc.height = Hh; } oc.getContext('2d').putImageData(M.im, 0, 0); g.drawImage(oc, x0, y0);
    // 눈금 — 적도 · 회귀선(흐린 레거시 선), 펼침이면 테두리
    g.strokeStyle = 'rgba(70,160,108,0.28)'; g.lineWidth = 1; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(x0, y0 + Hh / 2 + 0.5); g.lineTo(x0 + W, y0 + Hh / 2 + 0.5); g.stroke(); g.setLineDash([]);
    if (!n) { g.strokeStyle = 'rgba(70,160,108,0.4)'; g.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, Hh - 1); }
  }

  renderVals() {
    const S = this.state, L = this.lib(), on = (b) => (b ? 'true' : 'false');
    const files = L.files.slice().sort((a, b) => (a.path + '/' + a.name).localeCompare(b.path + '/' + b.name));
    return {
      rootH: this.props.winH ? this.props.winH + 'px' : '100vh',
      help: S.help, helpOn: on(S.help), helpCls: S.help ? 'on' : '', helpDot: S.help ? '●' : '○', helpT: S.help ? '켬' : '끔', toggleHelp: () => this.setState({ help: !S.help }),
      srcLabel: S.help ? (S.srcLabel ? S.srcLabel + ' — 다른 원본은 단추나 미리보기에 끌어 놓기로' : '원본이 없어 기본 무늬로 미리 봐요 — 이미지 · GIF(프레임마다) · 구 데이터(.json)를 불러오거나 미리보기에 끌어 놓으세요') : (S.srcLabel || '원본 없음 · 기본 무늬'),
      nfHolder: S.help ? '새 폴더 (지금 폴더 아래) — Enter' : '새 폴더', libEmptyT: S.help ? '아직 없어요 — 만든 구를 저장하면 여기와 전역 제어 › 유틸 › 스타메이커 › star 에 보여요' : '비어 있음',
      tiltIc: -S.tilt, spinDir: S.spin < 0 ? -1 : 1, lightIc: -S.light,
      saveT: S.saveWarn ? '덮어쓰기 → ' + S.folder : '저장 → ' + S.folder, saveCls: S.saveWarn ? 'sm-warn' : '',
      algos: this.ALGOS().map(([id, name, desc]) => ({ name, desc, on: on(S.algo === id), cls: S.algo === id ? 'on' : '', dot: S.algo === id ? '●' : '○', pick: () => this.setState({ algo: id }, () => this.build()) })),
      resList: [128, 256, 512].map((r) => ({ name: r + '', on: on(S.res === r), cls: S.res === r ? 'on' : '', pick: () => this.setState({ res: r }, () => this.build()) })),
      gain: S.gain, gainT: Math.round(S.gain * 100) + '%', setGain: (e) => this.setState({ gain: +e.target.value }),
      spin: S.spin, spinT: (S.spin > 0 ? '← ' : S.spin < 0 ? '→ ' : '') + Math.abs(S.spin).toFixed(2) + '/s', setSpin: (e) => this.setState({ spin: +e.target.value }),
      tilt: S.tilt, tiltT: (S.tilt > 0 ? '↶ ' : S.tilt < 0 ? '↷ ' : '') + Math.abs(S.tilt) + '°', setTilt: (e) => this.setState({ tilt: +e.target.value }),
      isAnim: (this._tex || []).length > 1, fps: S.fps, fpsT: S.fps + 'fps', setFps: (e) => this.setState({ fps: +e.target.value }),
      kinds: [['star', '항성'], ['planet', '행성']].map(([id, name]) => ({ name, on: on(S.kind === id), cls: S.kind === id ? 'on' : '', pick: () => this.setState({ kind: id }) })),
      limb: S.limb, limbT: Math.round(S.limb * 100) + '%', setLimb: (e) => this.setState({ limb: +e.target.value }),
      isPlanet: S.kind === 'planet', light: S.light, lightT: S.light + '°', setLight: (e) => this.setState({ light: +e.target.value }),
      name: S.name, setName: (e) => this.setState({ name: e.target.value, saveWarn: null }),
      folders: L.folders.slice().sort().map((p) => ({ name: p, on: on(S.folder === p), cls: S.folder === p ? 'on' : '', pick: () => this.setState({ folder: p }) })),
      folder: S.folder, newFolder: S.newFolder, setNewFolder: (e) => this.setState({ newFolder: e.target.value }), newFolderKey: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.addFolder(); } },
      save: () => this.save(), exportFile: () => this.exportFile(), msg: S.msg, msgCol: S.msgErr ? '#ffb2a6' : '#96f0aa',
      lib: files.map((f) => ({ name: f.name, path: f.path, kind: f.kind === 'planet' ? '행성' : '항성', size: Math.max(1, Math.round(f.bytes / 1024)) + 'KB', thumb: f.thumb || '', cls: f.id === S.cur ? 'on' : '', load: () => this.openLib(f.id), del: () => this.delLib(f.id) })),
      libN: files.length + '', libEmpty: !files.length,
      prevNote: (S.kind === 'star' ? '항성' : '행성') + ' · ' + ({ none: '기본 무늬', image: '이미지', gif: 'GIF', sphere: '구 데이터' }[S.srcType] || '') + ((this._tex || []).length > 1 ? ' · ' + this._tex.length + '프레임' : ''),
      texNote: '표면 ' + (this._tex && this._tex[0] ? this._tex[0].cv.width + ' × ' + this._tex[0].cv.height : '') + (this._proj === 'billboard' ? ' · 원판(바라보기)' : ' · 등장방형') + ((this._tex || []).length > 1 ? ' · ' + this._tex.length + '프레임' : ''),
      algoDesc: this._texSrc === 'sphere' ? '구 데이터 — 형성 없이 그대로 (방법을 고르려면 이미지 · GIF 를 불러오세요)' : !this._src ? '원본을 불러오면 이 방법으로 구를 만들어요 · ' + ((this.ALGOS().find((a) => a[0] === S.algo) || [])[2] || '') : (this.ALGOS().find((a) => a[0] === S.algo) || [])[2] || '',
      maps: [['gore12', '고어 12'], ['gore8', '고어 8'], ['flat', '펼침']].map(([id, name]) => ({ name, on: on(S.map === id), cls: S.map === id ? 'on' : '', pick: () => this.setState({ map: id }) })),
      views: [['px', '픽셀'], ['glyph', '글자 장']].map(([id, name]) => ({ name, on: on(S.view === id), cls: S.view === id ? 'on' : '', pick: () => this.setState({ view: id }) })),
      togglePlay: () => this.setState({ play: !S.play }), playT: S.play ? '멈춤' : '돌리기', playLabel: S.play ? '자전 멈춤' : '자전 시작',
      pickImg: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; this.loadFile(f); },
      pickSphere: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; this.loadFile(f); },
      dropOn: S.drop, dragOver: (e) => { e.preventDefault(); if (!S.drop) { this.setState({ drop: true }); clearTimeout(this._dropT); } clearTimeout(this._dropT); this._dropT = setTimeout(() => this.setState({ drop: false }), 160); },
      drop: (e) => { e.preventDefault(); this.setState({ drop: false }); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; this.loadFile(f); }
    };
  }
}
