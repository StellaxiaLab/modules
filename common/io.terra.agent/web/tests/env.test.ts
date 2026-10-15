import { describe, expect, it } from 'vitest';
import { detectHost } from '../src/env';

describe('detectHost', () => {
  it('최상위 창이면 셸 밖이다', () => {
    const w = {} as { parent?: unknown; self?: unknown };
    w.parent = w;
    w.self = w;
    expect(detectHost(w)).toBe('standalone');
  });
  it('부모가 다르면 셸 안이다', () => {
    expect(detectHost({ parent: {}, self: {} })).toBe('shell');
  });
  it('창이 없으면 셸 밖이다', () => {
    expect(detectHost(undefined)).toBe('standalone');
  });
});
