// 모든 동적 텍스트는 textContent 로만 넣는다(I1·I7). 소스에 HTML 삽입 API 가 없음을 지킨다.
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

const sources = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });
const stripComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('HTML 삽입 금지 (I1·I7)', () => {
  const entries = Object.entries(sources).map(([file, code]) => [file, stripComments(code)] as const);
  it('소스를 찾았다', () => {
    expect(entries.length).toBeGreaterThan(20);
  });
  const banned = [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\bnew Function\b/, /\beval\s*\(/, /dangerouslySetInnerHTML/, /\.srcdoc\b/];
  for (const re of banned) {
    it(`${String(re)} 를 쓰지 않는다`, () => {
      expect(entries.filter(([, code]) => re.test(code)).map(([file]) => file)).toEqual([]);
    });
  }
  it("index.html 에 인라인 스크립트·이벤트 속성이 없다 (앱 자산 CSP script-src 'self')", () => {
    const inline = [...indexHtml.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/\bsrc\s*=/.test(m[1] ?? ''));
    expect(inline).toEqual([]);
    expect(indexHtml).not.toMatch(/\son[a-z]+\s*=/i);
  });
  it('세션 내용·자격을 브라우저 저장소에 두지 않는다 (토큰은 메모리에만, I19)', () => {
    expect(entries.filter(([, code]) => /localStorage|sessionStorage|indexedDB/.test(code)).map(([file]) => file)).toEqual([]);
  });
});
