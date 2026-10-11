import { detectHost } from './env';

export function render(root: HTMLElement, host = detectHost(typeof window === 'undefined' ? undefined : window)): void {
  root.replaceChildren();
  const title = document.createElement('h1');
  title.textContent = 'Terra Agent';
  const note = document.createElement('p');
  note.textContent = host === 'shell' ? '준비 중입니다.' : '이 앱은 Terra 셸 안에서 여세요.';
  root.append(title, note);
}

const root = typeof document === 'undefined' ? null : document.getElementById('app');
if (root) render(root);
