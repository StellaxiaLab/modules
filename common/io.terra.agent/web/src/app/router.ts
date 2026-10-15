// hash 라우팅 — 서버 경로에 기대지 않는다(base './', 앱 자산은 /api/v1/gui/apps/<id>/files/ 아래에서 나온다).
//   #/            준비 상태 + 세션 고르기
//   #/new         새 세션 열기
//   #/s/<id>      세션(대화)
//   #/settings    설정(읽기 전용) · 자격 거두기

import { isValidSessionId } from '../api/client';

export type Route = { name: 'home' } | { name: 'new' } | { name: 'settings' } | { name: 'session'; id: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '/new') return { name: 'new' };
  if (path === '/settings') return { name: 'settings' };
  const m = /^\/s\/([^/?#]+)$/.exec(path);
  if (m) {
    let id: string;
    try {
      id = decodeURIComponent(m[1] ?? '');
    } catch {
      return { name: 'home' };
    }
    if (isValidSessionId(id)) return { name: 'session', id };
  }
  return { name: 'home' };
}

export function routeHash(route: Route): string {
  if (route.name === 'new') return '#/new';
  if (route.name === 'settings') return '#/settings';
  if (route.name === 'session') return `#/s/${encodeURIComponent(route.id)}`;
  return '#/';
}
