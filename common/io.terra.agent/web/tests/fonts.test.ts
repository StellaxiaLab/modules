// 글꼴(D-11) — 앱에 싣는 Pretendard·Inter 의 선언·파일·고지를 지킨다.
// 소스 쪽(src/styles/fonts.css ↔ public/fonts)은 늘 보고, 빌드 산출물(../ui)은 있을 때만 본다
// (`npm run build` 뒤에 `npm test` 를 돌리면 둘 다 본다). Node 타입 없이 import.meta.glob 만 쓴다.
import { describe, expect, it } from 'vitest';
import fontsCss from '../src/styles/fonts.css?raw';

const publicFiles = Object.keys(import.meta.glob('../public/fonts/**/*', { query: '?url', import: 'default' })).map((k) => k.replace('../public', ''));
const publicTexts = import.meta.glob<string>('../public/fonts/**/*.txt', { query: '?raw', import: 'default', eager: true });
const uiFiles = Object.keys(import.meta.glob('../../ui/**/*', { query: '?url', import: 'default' })).map((k) => k.replace('../../ui/', ''));
const uiTexts = import.meta.glob<string>('../../ui/**/*.{html,css,js}', { query: '?raw', import: 'default', eager: true });

const urlsOf = (css: string): string[] => [...css.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)].map((m) => m[1] as string);
/** dir 에서 상대 경로 rel 을 푼 산출물 기준 경로. */
const resolveIn = (dir: string, rel: string): string => {
  const out = dir ? dir.split('/') : [];
  for (const part of rel.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join('/');
};

describe('글꼴 선언 (src/styles/fonts.css)', () => {
  const faces = fontsCss.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  it('Pretendard 92조각 + Inter 2조각을 선언한다', () => {
    expect(faces.filter((f) => /Pretendard Variable/.test(f))).toHaveLength(92);
    expect(faces.filter((f) => /font-family:\s*'Inter'/.test(f))).toHaveLength(2);
  });
  it('모든 선언이 font-display: swap 과 unicode-range 를 갖고 woff2 하나만 가리킨다', () => {
    for (const f of faces) {
      expect(f).toMatch(/font-display:\s*swap/);
      expect(f).toMatch(/unicode-range:/);
      expect(urlsOf(f)).toHaveLength(1);
    }
  });
  it('외부 URL 이 없다 — url() 은 /fonts/ 아래 같은 출처 파일뿐이다', () => {
    expect(fontsCss).not.toMatch(/https?:\/\/(?!scripts\.sil\.org)/);
    for (const u of urlsOf(fontsCss)) expect(u).toMatch(/^\/fonts\/(pretendard|inter)\/[\w.-]+\.woff2$/);
  });
  it('url() 대상 파일이 모두 public/fonts 에 있다', () => {
    for (const u of urlsOf(fontsCss)) expect(publicFiles, u).toContain(u);
  });
  it('public/fonts 의 woff2 는 모두 선언에서 쓰인다(안 쓰는 파일을 싣지 않는다)', () => {
    const used = new Set(urlsOf(fontsCss));
    const files = publicFiles.filter((f) => f.endsWith('.woff2'));
    expect(files.length).toBe(94);
    expect(files.filter((f) => !used.has(f))).toEqual([]);
  });
  it('OFL 고지 파일이 글꼴 옆에 있다', () => {
    for (const d of ['pretendard', 'inter']) {
      const text = publicTexts[`../public/fonts/${d}/OFL-${d}.txt`] ?? '';
      expect(text).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
      expect(text).toMatch(/Copyright/);
    }
  });
});

describe.skipIf(uiFiles.length === 0)('글꼴 빌드 산출물 (../ui)', () => {
  it('html·css·js 에 외부 URL 이 없다', () => {
    expect(Object.keys(uiTexts).length).toBeGreaterThanOrEqual(3);
    for (const [f, code] of Object.entries(uiTexts)) {
      // SVG 이름공간 식별자(createElementNS)는 요청을 만들지 않는다 — 그것만 뺀다.
      const external = (code.match(/(?:https?:)?\/\/[\w.-]+\.[a-z]{2,}[^\s"')`]*/gi) ?? []).filter((u) => u !== 'http://www.w3.org/2000/svg');
      expect(external, f).toEqual([]);
    }
  });
  it('모든 css 의 url() 대상 파일이 산출물에 있다', () => {
    let checked = 0;
    for (const [f, code] of Object.entries(uiTexts).filter(([k]) => k.endsWith('.css'))) {
      const dir = f.replace('../../ui/', '').split('/').slice(0, -1).join('/');
      for (const u of urlsOf(code)) {
        if (u.startsWith('data:')) continue;
        expect(u, `${f}: 상대 경로여야 한다(base './')`).toMatch(/^\.\.?\//);
        expect(uiFiles, `${f}: ${u}`).toContain(resolveIn(dir, u));
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(94);
  });
  it('산출물에 OFL 고지가 들어 있다', () => {
    expect(uiFiles).toContain('fonts/pretendard/OFL-pretendard.txt');
    expect(uiFiles).toContain('fonts/inter/OFL-inter.txt');
  });
});
