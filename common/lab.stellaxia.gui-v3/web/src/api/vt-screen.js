// 최소 터미널 화면 — 노드 셸(PTY)이 보내는 바이트를 글자 격자로(ADR-GW-014 P16-4a).
//
// 하는 것 : 글자 · 줄바꿈(CR · LF · BS · TAB) · 자동 줄바꿈 · 스크롤 + 스크롤백 · 커서 이동 · 지우기 · 줄/글자 넣고 빼기 · 스크롤 영역 ·
//          SGR(굵게 · 흐리게 · 밑줄 · 반전 · 16색 · 256색 · 24비트) · 대체 화면(1049) · 커서 보임/숨김 · 제목(OSC 0/2) · 커서 위치 · 장치 속성 질의 응답.
// 안 하는 것 : 마우스 · 대체 문자 집합 · 글꼴 바꾸기 · 이미지. 모르는 순서는 조용히 버린다(화면을 깨지 않게).
// 순수 함수 · DOM 없음 — 시험은 문자열을 먹이고 view() 를 본다. 칸 하나 = { c: 글자, s: 모양, w: 1|2|0(넓은 글자의 뒷칸) } — 칸은 고치지 않고 바꿔 끼운다.

export const DEF_FG = '#d7dbe5';
const INV_BG = '#0b0e14';
const PAL16 = ['#1d2230', '#e5604f', '#4fc78a', '#e5b84f', '#5b8def', '#b57edc', '#4fc1c9', '#c9ced8', '#5c6475', '#ff7b6b', '#6fe3a5', '#ffd36b', '#7aa7ff', '#d2a0f0', '#6fdce4', '#f2f4fa'];
const hex2 = (n) => n.toString(16).padStart(2, '0');
/** xterm 256색 → CSS 색 */
export function color256(n) {
  if (n < 16) return PAL16[n];
  if (n < 232) { const k = n - 16, lv = [0, 95, 135, 175, 215, 255]; return '#' + hex2(lv[Math.floor(k / 36)]) + hex2(lv[Math.floor(k / 6) % 6]) + hex2(lv[k % 6]); }
  const g = 8 + (n - 232) * 10; return '#' + hex2(g) + hex2(g) + hex2(g);
}
// 모양 비트
const BOLD = 1, DIM = 2, UL = 4, INV = 8, ITAL = 16;
const DEF = Object.freeze({ fg: '', bg: '', fl: 0 });
const BLANK = Object.freeze({ c: ' ', s: DEF, w: 1 });
const blankRow = (n, s = DEF) => { const r = new Array(n); const cell = s === DEF ? BLANK : { c: ' ', s, w: 1 }; for (let i = 0; i < n; i++) r[i] = cell; return r; };

/** 글자 폭 — 0(결합) · 1 · 2(한글 · 한자 · 전각 · 이모지) */
export function charWidth(cp) {
  if (cp < 0x300) return 1;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || (cp >= 0x20d0 && cp <= 0x20ff)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f)
    || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

export class VtScreen {
  /** @param {number} cols @param {number} rows @param {{ scrollback?: number, onReply?: (s: string) => void, onTitle?: (t: string) => void }} [o] */
  constructor(cols = 80, rows = 24, o = {}) {
    this.cols = Math.max(1, cols | 0); this.rows = Math.max(1, rows | 0);
    this.max = o.scrollback ?? 2000; this.onReply = o.onReply || null; this.onTitle = o.onTitle || null;
    this.grid = Array.from({ length: this.rows }, () => blankRow(this.cols)); this.sb = [];
    this.cx = 0; this.cy = 0; this.wrapNext = false; this.pen = DEF; this.top = 0; this.bot = this.rows - 1;
    this.saved = null; this.mainSave = null; this.alt = false; this.cursorOn = true; this.title = '';
    this.st = 'g'; this.buf = ''; this.prev = '';
  }

  // ── 입력 ──
  write(text) {
    for (const ch of String(text)) this.feed(ch);
  }
  feed(ch) {
    const code = ch.codePointAt(0);
    switch (this.st) {
      case 'g':
        if (code === 0x1b) { this.st = 'esc'; return; }
        if (code < 0x20) return this.ctl(code);
        if (code === 0x7f) return;
        return this.put(ch, code);
      case 'esc':
        this.st = 'g';
        if (ch === '[') { this.st = 'csi'; this.buf = ''; return; }
        if (ch === ']') { this.st = 'osc'; this.buf = ''; return; }
        if (ch === '(' || ch === ')' || ch === '*' || ch === '+' || ch === '#' || ch === '%') { this.st = 'skip1'; return; }
        if (ch === 'P' || ch === '^' || ch === '_' || ch === 'X') { this.st = 'str'; this.buf = ''; return; }
        if (ch === '7') { this.saved = { cx: this.cx, cy: this.cy, pen: this.pen }; return; }
        if (ch === '8') { this.restoreCursor(); return; }
        if (ch === 'M') { if (this.cy === this.top) this.scrollDown(1); else if (this.cy > 0) this.cy--; return; }
        if (ch === 'D') { this.lineFeed(); return; }
        if (ch === 'E') { this.cx = 0; this.wrapNext = false; this.lineFeed(); return; }
        if (ch === 'c') { this.hardReset(); return; }
        return;   // = > H 따위 — 버림
      case 'skip1': this.st = 'g'; return;
      case 'csi':
        if (code >= 0x40 && code <= 0x7e) { this.st = 'g'; this.csi(ch, this.buf); return; }
        if (code === 0x1b) { this.st = 'esc'; return; }
        if (code < 0x20) { this.ctl(code); return; }   // 순서 도중의 제어 문자는 그대로 먹는다
        if (this.buf.length < 64) this.buf += ch;
        return;
      case 'osc': case 'str':
        if (code === 0x07) { this.endString(); return; }
        if (code === 0x1b) { this.st = this.st === 'osc' ? 'ost' : 'sst'; return; }
        if (this.st === 'osc' && this.buf.length < 512) this.buf += ch;
        return;
      case 'ost': case 'sst':
        if (ch === '\\') { this.st = this.st === 'ost' ? 'osc' : 'str'; this.endString(); return; }
        this.st = 'g'; if (ch === '[') { this.st = 'csi'; this.buf = ''; } return;
      default: this.st = 'g';
    }
  }
  endString() {
    if (this.st === 'osc') { const m = /^([02]);(.*)$/s.exec(this.buf); if (m) { this.title = m[2]; if (this.onTitle) try { this.onTitle(this.title); } catch {} } }
    this.st = 'g'; this.buf = '';
  }
  ctl(code) {
    switch (code) {
      case 0x0d: this.cx = 0; this.wrapNext = false; return;                      // CR
      case 0x0a: case 0x0b: case 0x0c: this.wrapNext = false; this.lineFeed(); return;   // LF · VT · FF
      case 0x08: if (this.cx > 0) this.cx--; this.wrapNext = false; return;       // BS
      case 0x09: { const n = Math.min(this.cols - 1, (Math.floor(this.cx / 8) + 1) * 8); this.cx = n; this.wrapNext = false; return; }   // TAB
      default: return;                                                             // BEL · 그 밖
    }
  }
  put(ch, code) {
    const w = charWidth(code);
    if (w === 0) {   // 결합 글자 — 앞 칸에 붙인다
      const x = this.wrapNext ? this.cx : this.cx - 1, row = this.grid[this.cy];
      if (x >= 0 && row[x] && row[x].c !== ' ' && row[x].c !== '') row[x] = { c: row[x].c + ch, s: row[x].s, w: row[x].w };
      return;
    }
    if (this.wrapNext || this.cx + w > this.cols) { this.cx = 0; this.wrapNext = false; this.lineFeed(); }
    const row = this.grid[this.cy];
    this.clearWide(row, this.cx); if (w === 2) this.clearWide(row, this.cx + 1);
    row[this.cx] = { c: ch, s: this.pen, w };
    if (w === 2) row[this.cx + 1] = { c: '', s: this.pen, w: 0 };
    this.cx += w;
    if (this.cx >= this.cols) { this.cx = this.cols - 1; this.wrapNext = true; }
  }
  /** 넓은 글자의 반쪽을 덮어쓰면 남은 반쪽을 빈칸으로 */
  clearWide(row, x) {
    const c = row[x]; if (!c) return;
    if (c.w === 2 && row[x + 1]) row[x + 1] = BLANK;
    if (c.w === 0 && x > 0) row[x - 1] = BLANK;
  }

  // ── 줄 · 스크롤 ──
  lineFeed() { if (this.cy === this.bot) this.scrollUp(1); else if (this.cy < this.rows - 1) this.cy++; }
  scrollUp(n) {
    for (let i = 0; i < n; i++) {
      const gone = this.grid.splice(this.top, 1)[0];
      this.grid.splice(this.bot, 0, blankRow(this.cols));
      if (!this.alt && this.top === 0) { this.sb.push(gone); if (this.sb.length > this.max) this.sb.splice(0, this.sb.length - this.max); }
    }
  }
  scrollDown(n) { for (let i = 0; i < n; i++) { this.grid.splice(this.bot, 1); this.grid.splice(this.top, 0, blankRow(this.cols)); } }
  restoreCursor() { const s = this.saved; if (s) { this.cx = Math.min(s.cx, this.cols - 1); this.cy = Math.min(s.cy, this.rows - 1); this.pen = s.pen; this.wrapNext = false; } }

  // ── CSI ──
  csi(fin, raw) {
    const priv = /^[?<=>]/.test(raw) ? raw[0] : '';
    const nums = raw.replace(/^[?<=>]/, '').replace(/[ -/]+$/, '').split(/[;:]/).map((v) => (v === '' ? NaN : parseInt(v, 10)));
    const p = (i, d) => (Number.isFinite(nums[i]) ? nums[i] : d), n1 = () => Math.max(1, p(0, 1));
    const row = () => this.grid[this.cy];
    this.wrapNext = false;
    switch (fin) {
      case 'm': return this.sgr(nums);
      case 'A': this.cy = Math.max(this.cy - n1(), this.cy >= this.top ? this.top : 0); return;
      case 'B': this.cy = Math.min(this.cy + n1(), this.cy <= this.bot ? this.bot : this.rows - 1); return;
      case 'C': this.cx = Math.min(this.cols - 1, this.cx + n1()); return;
      case 'D': this.cx = Math.max(0, this.cx - n1()); return;
      case 'E': this.cy = Math.min(this.rows - 1, this.cy + n1()); this.cx = 0; return;
      case 'F': this.cy = Math.max(0, this.cy - n1()); this.cx = 0; return;
      case 'G': this.cx = Math.min(this.cols - 1, Math.max(0, p(0, 1) - 1)); return;
      case 'd': this.cy = Math.min(this.rows - 1, Math.max(0, p(0, 1) - 1)); return;
      case 'H': case 'f': this.cy = Math.min(this.rows - 1, Math.max(0, p(0, 1) - 1)); this.cx = Math.min(this.cols - 1, Math.max(0, p(1, 1) - 1)); return;
      case 'J': {
        const m = p(0, 0);
        if (m === 0) { this.eraseRow(this.cy, this.cx, this.cols); for (let y = this.cy + 1; y < this.rows; y++) this.eraseRow(y, 0, this.cols); }
        else if (m === 1) { for (let y = 0; y < this.cy; y++) this.eraseRow(y, 0, this.cols); this.eraseRow(this.cy, 0, this.cx + 1); }
        else if (m === 2) { for (let y = 0; y < this.rows; y++) this.eraseRow(y, 0, this.cols); }
        else if (m === 3) this.sb = [];
        return;
      }
      case 'K': { const m = p(0, 0); if (m === 0) this.eraseRow(this.cy, this.cx, this.cols); else if (m === 1) this.eraseRow(this.cy, 0, this.cx + 1); else if (m === 2) this.eraseRow(this.cy, 0, this.cols); return; }
      case 'L': if (this.cy >= this.top && this.cy <= this.bot) { const n = Math.min(n1(), this.bot - this.cy + 1); for (let i = 0; i < n; i++) { this.grid.splice(this.bot, 1); this.grid.splice(this.cy, 0, blankRow(this.cols)); } this.cx = 0; } return;
      case 'M': if (this.cy >= this.top && this.cy <= this.bot) { const n = Math.min(n1(), this.bot - this.cy + 1); for (let i = 0; i < n; i++) { this.grid.splice(this.cy, 1); this.grid.splice(this.bot, 0, blankRow(this.cols)); } this.cx = 0; } return;
      case 'P': { const r = row(), n = Math.min(n1(), this.cols - this.cx); r.splice(this.cx, n); while (r.length < this.cols) r.push(BLANK); return; }
      case '@': { const r = row(), n = Math.min(n1(), this.cols - this.cx); r.splice(this.cx, 0, ...blankRow(n)); r.length = this.cols; return; }
      case 'X': this.eraseRow(this.cy, this.cx, Math.min(this.cols, this.cx + n1())); return;
      case 'S': this.scrollUp(n1()); return;
      case 'T': this.scrollDown(n1()); return;
      case 'r': { const t = Math.max(1, p(0, 1)), b = Math.min(this.rows, p(1, this.rows)); if (t < b) { this.top = t - 1; this.bot = b - 1; } else { this.top = 0; this.bot = this.rows - 1; } this.cx = 0; this.cy = 0; return; }
      case 's': if (!priv) this.saved = { cx: this.cx, cy: this.cy, pen: this.pen }; return;
      case 'u': this.restoreCursor(); return;
      case 'h': case 'l': if (priv === '?') for (const v of nums) this.mode(v, fin === 'h'); return;
      case 'n': if (priv) return; if (p(0, 0) === 6) this.reply('\x1b[' + (this.cy + 1) + ';' + (this.cx + 1) + 'R'); else if (p(0, 0) === 5) this.reply('\x1b[0n'); return;
      case 'c': if (!priv && p(0, 0) === 0) this.reply('\x1b[?1;2c'); return;
      default: return;   // q · t · 그 밖 — 버림
    }
  }
  reply(s) { if (this.onReply) try { this.onReply(s); } catch {} }
  eraseRow(y, from, to) { const r = this.grid[y]; if (!r) return; const cell = this.pen.bg ? { c: ' ', s: { fg: '', bg: this.pen.bg, fl: 0 }, w: 1 } : BLANK; for (let x = Math.max(0, from); x < Math.min(this.cols, to); x++) r[x] = cell; }
  mode(v, on) {
    if (v === 25) { this.cursorOn = on; return; }
    if (v === 1049 || v === 1047 || v === 47) {
      if (on && !this.alt) { this.mainSave = { grid: this.grid, cx: this.cx, cy: this.cy, pen: this.pen, top: this.top, bot: this.bot }; this.alt = true; this.grid = Array.from({ length: this.rows }, () => blankRow(this.cols)); this.cx = 0; this.cy = 0; this.top = 0; this.bot = this.rows - 1; }
      else if (!on && this.alt) { const m = this.mainSave; this.alt = false; this.grid = m.grid; this.cx = m.cx; this.cy = m.cy; this.pen = m.pen; this.top = m.top; this.bot = m.bot; this.mainSave = null; }
    }
  }
  sgr(nums) {
    let { fg, bg, fl } = this.pen; const a = nums.length ? nums : [0];
    for (let i = 0; i < a.length; i++) {
      const v = Number.isFinite(a[i]) ? a[i] : 0;
      if (v === 0) { fg = ''; bg = ''; fl = 0; }
      else if (v === 1) fl |= BOLD; else if (v === 2) fl |= DIM; else if (v === 3) fl |= ITAL; else if (v === 4) fl |= UL; else if (v === 7) fl |= INV;
      else if (v === 22) fl &= ~(BOLD | DIM); else if (v === 23) fl &= ~ITAL; else if (v === 24) fl &= ~UL; else if (v === 27) fl &= ~INV;
      else if (v >= 30 && v <= 37) fg = PAL16[v - 30]; else if (v === 39) fg = '';
      else if (v >= 40 && v <= 47) bg = PAL16[v - 40]; else if (v === 49) bg = '';
      else if (v >= 90 && v <= 97) fg = PAL16[v - 90 + 8]; else if (v >= 100 && v <= 107) bg = PAL16[v - 100 + 8];
      else if (v === 38 || v === 48) {
        let col = '';
        if (a[i + 1] === 5 && Number.isFinite(a[i + 2])) { col = color256(Math.max(0, Math.min(255, a[i + 2]))); i += 2; }
        else if (a[i + 1] === 2 && Number.isFinite(a[i + 4])) { const c = (k) => Math.max(0, Math.min(255, a[k] || 0)); col = '#' + hex2(c(i + 2)) + hex2(c(i + 3)) + hex2(c(i + 4)); i += 4; }
        else i = a.length;
        if (col) { if (v === 38) fg = col; else bg = col; }
      }
    }
    this.pen = (fg === '' && bg === '' && fl === 0) ? DEF : { fg, bg, fl };
  }
  hardReset() { const { cols, rows } = this; Object.assign(this, new VtScreen(cols, rows, { scrollback: this.max, onReply: this.onReply, onTitle: this.onTitle })); }

  // ── 크기 ──
  resize(cols, rows) {
    cols = Math.max(1, cols | 0); rows = Math.max(1, rows | 0);
    if (cols === this.cols && rows === this.rows) return;
    const fix = (r) => { if (r.length > cols) r.length = cols; while (r.length < cols) r.push(BLANK); if (r[cols - 1] && r[cols - 1].w === 2) r[cols - 1] = BLANK; return r; };
    this.grid.forEach(fix); this.sb.forEach(fix);
    while (this.grid.length > rows) { if (this.cy > 0 && this.cy >= rows) { const gone = this.grid.shift(); if (!this.alt) this.sb.push(gone); this.cy--; } else this.grid.pop(); }
    while (this.grid.length < rows) this.grid.push(blankRow(cols));
    this.cols = cols; this.rows = rows; this.top = 0; this.bot = rows - 1;
    this.cx = Math.min(this.cx, cols - 1); this.cy = Math.min(this.cy, rows - 1); this.wrapNext = false;
    if (this.mainSave) { this.mainSave.grid.forEach(fix); while (this.mainSave.grid.length > rows) this.mainSave.grid.pop(); while (this.mainSave.grid.length < rows) this.mainSave.grid.push(blankRow(cols)); this.mainSave.top = 0; this.mainSave.bot = rows - 1; }
  }

  // ── 보기 ──
  /** 스크롤백을 지금 얼마나 거슬러 볼 수 있나(줄 수) */
  get history() { return this.alt ? 0 : this.sb.length; }
  /**
   * 화면 rows 줄. offset = 위로 거슬러 간 줄 수(0 이면 맨 아래, 커서 보임).
   * 줄 = { runs: [{ t, fg, bg, fl }], cur: 커서가 이 줄이면 칸 번호 아니면 -1 }. 모양 fl : 1 굵게 · 2 흐리게 · 4 밑줄 · 16 기울임 (반전은 색을 맞바꿔 이미 반영)
   */
  view(offset = 0) {
    const off = Math.max(0, Math.min(offset | 0, this.history)), all = this.alt ? this.grid : this.sb.concat(this.grid), start = all.length - this.rows - off, out = [];
    for (let i = 0; i < this.rows; i++) {
      const row = all[start + i] || blankRow(this.cols), isCur = off === 0 && i === this.cy && this.cursorOn, runs = [];
      for (let x = 0; x < this.cols; x++) {
        const c = row[x]; if (c.w === 0) continue;
        let s = c.s, ch = c.c === '' ? ' ' : c.c;
        const cur = isCur && x === this.cx;
        let fg = s.fg, bg = s.bg, fl = s.fl;
        if (fl & INV) { const f = fg || DEF_FG, b = bg || INV_BG; fg = b; bg = f; }   // 반전 — 색을 맞바꾼다
        if (cur) { const f = fg || DEF_FG, b = bg || INV_BG; fg = b; bg = f; }       // 커서 — 한 번 더
        fl &= ~INV;
        const last = runs[runs.length - 1];
        if (last && last.fg === fg && last.bg === bg && last.fl === fl) last.t += ch; else runs.push({ t: ch, fg, bg, fl });
      }
      out.push({ runs, cur: isCur ? this.cx : -1 });
    }
    return out;
  }
  /** 화면 글자만 — 시험 · 복사용. 오른쪽 빈칸은 뗀다 */
  text(offset = 0) { return this.view(offset).map((l) => l.runs.map((r) => r.t).join('').replace(/\s+$/, '')); }
}
