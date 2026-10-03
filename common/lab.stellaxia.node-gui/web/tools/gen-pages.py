#!/usr/bin/env python3
# design/*.dc.html (디자인 캔버스 원본) → 화면 페이지(*.html) + src/screens/*.js 를 다시 만든다.
# 사용: npm run gen  (또는 python3 tools/gen-pages.py) — Linux · Windows(py tools\gen-pages.py) · macOS 동일
# 원본을 고친 뒤 실행한다. src/screens/*.js 를 손으로 고쳤다면 덮어쓰이니 주의.
import re, json, os, shutil
import sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC=os.path.join(ROOT,'design')+'/'; OUT=ROOT+'/'
os.makedirs(OUT+'src/screens',exist_ok=True); os.makedirs(OUT+'src/runtime',exist_ok=True); os.makedirs(OUT+'design',exist_ok=True)
# (원본, 페이지, 제목, 맞춤, 설명)
screens=[('Artboard-qcfu','node','노드 화면',False,'육각 필드 맵 · 관리 노드 창 · 조타륜 · 오버헤드 패널 · 유틸 서랍 · 서브 창 · 전체 화면'),
 ('BuildingEditor','building','건물 편집기',True,'16³ 블록 설계 · 설계도 트리 · 2D 벡터 4방향 내보내기'),
 ('MaterialEditor','material','자재 편집기',True,'6면 8×8 픽셀 자재 · 8×8×8 커스텀 복셀 자재 · 애니메이션'),
 ('FieldEditor','field','필드 편집기',True,'타일 스킨 — 테두리 · 윗면 · 옆면 띠'),
 ('GroundEditor','ground','그라운드 편집기',True,'높이 0 바닥 무늬'),
 ('Network','network','네트워크',True,'mesh · 진단 · 터널 · WireGuard'),
 ('Settings','settings','설정',True,'GUI · 계정 · 로컬 노드 · 클러스터 설정'),
 ('Components','components','공통 부품 (디자인 노트)',True,'버튼 · 칩 · 배지 등 공통 부품'),
 ('Helm','helm','조타륜 (디자인 노트)',True,'조타륜 단독 시안'),
 ('HelmApps','helm-apps','조타륜 앱 노트 (디자인 노트)',True,'조타륜 앱별 자원 · 동작 노트')]
links={f'{a}.dc.html':f'{b}.html' for a,b,*_ in screens}
# 실데이터 층 — 화면 클래스를 이어받아 예시 데이터를 지운 클래스(src/data/*-live.js). 없는 화면은 디자인 그대로 마운트한다
REAL={'node':('./src/data/node-live.js','realNode'),'network':('./src/data/network-live.js','realNetwork'),
 'settings':('./src/data/settings-live.js','realSettings'),'material':('./src/data/editors-live.js','realMaterial'),
 'field':('./src/data/editors-live.js','realField')}
# 템플릿에 박힌 예시 문구 → 바인딩 · 삭제 (원본 design/*.dc.html 은 그대로 둔다). 대상이 정확히 한 번 있어야 한다 — 원본이 바뀌면 여기서 멈춘다
SIMUL_SWITCHES_NET='''    <span style="font-size: 11.5px; color: #8b95a6;">시연</span>
    <div role="group" aria-label="GUI를 연 노드 (시연)" style="display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: #eef1f5;">
      <sc-for list="{{hdr.roles}}" as="ro" hint-placeholder-count="2">
        <button type="button" aria-pressed="{{ro.on}}" onClick="{{ro.pick}}" style="height: 26px; padding: 0 10px; border: 0; border-radius: 7px; background: {{ro.bg}}; color: {{ro.fg}}; box-shadow: {{ro.sh}}; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;">{{ro.label}}</button>
      </sc-for>
    </div>
'''
DEMO_SELECT='''    <select aria-label="상태 시연" onChange="{{hdr.setDemo}}" style="height: 30px; padding: 0 8px; border: 1px solid #d8dde5; border-radius: 6px; background: #ffffff; font: inherit; font-size: 12px; color: #16191f;">
      <sc-for list="{{hdr.demos}}" as="dm" hint-placeholder-count="4">
        <option value="{{dm.v}}" selected="{{dm.sel}}">{{dm.label}}</option>
      </sc-for>
    </select>
    <span style="font-size: 12px; font-weight: 600; color: #a65f00; border: 1px solid #a65f00; border-radius: 4px; padding: 1px 6px;">예시 데이터</span>
'''
TEMPLATE_PATCHES={
 'node':[
  ('<span style="color: #1f7a4d; font-size: 10px;">●</span>\n        <span style="font-weight: 700;">admin</span>\n        <span style="color: #5b6472; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; min-width: 0;">만료 21:40 · 권한: 모듈 관리 · 노드 조회</span>',
   '<span style="color: {{who.dotC}}; font-size: 10px;">●</span>\n        <span style="font-weight: 700;">{{who.name}}</span>\n        <span title="{{who.sub}}" style="color: #5b6472; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; min-width: 0;">{{who.sub}}</span>'),
  ('\n        <span style="font-size: 11px; font-weight: 700; color: #a65f00; border: 1px solid #a65f00; border-radius: 4px; padding: 0 5px; line-height: 16px;">예시 데이터</span>', ''),
  ('{{leafResCount}}개 · 예시', '{{leafResCount}}개')],
 'network':[
  ('이 보드는 머리의 "열린 곳" 전환으로 tree GUI · leaf GUI를 둘 다 보여 준다. 데이터는 전부 예시 -->', '역할(tree · leaf)은 카탈로그로 정하고, 데이터는 이 노드의 게이트웨이에서 읽는다(src/data/network-live.js) -->'),
  (SIMUL_SWITCHES_NET+DEMO_SELECT, ''),
  ('<div>권한 <span class="mono">node.read</span> · <span class="mono">node.control</span> ✓</div>', '<div>{{sess.perm}}</div>')],
 'settings':[
  ('데이터는 예시 -->', '데이터는 이 노드의 게이트웨이에서 읽는다(src/data/settings-live.js) -->'),
  (SIMUL_SWITCHES_NET, ''),
  ('<button type="button" onClick="{{hdr.togglePerm}}" aria-pressed="{{hdr.permOn}}" title="node.config★는 기본 권한 밖 — 관리자도 명시해야 열린다" style="height: 30px; padding: 0 10px; border: 1px solid {{hdr.permLine}}; border-radius: 6px; background: {{hdr.permBg}}; color: {{hdr.permFg}}; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;">{{hdr.permLabel}}</button>',
   '<span title="node.config★는 기본 권한 밖 — 관리자도 명시해야 열린다" style="display: inline-flex; align-items: center; height: 30px; box-sizing: border-box; padding: 0 10px; border: 1px solid {{hdr.permLine}}; border-radius: 6px; background: {{hdr.permBg}}; color: {{hdr.permFg}}; font-size: 12px; font-weight: 600;">{{hdr.permLabel}}</span>'),
  ('\n'+DEMO_SELECT.rstrip('\n'), ''),
  ('title="시연: 재시작을 마친 것으로"', 'title="Daemon을 재시작한 뒤 실행 중인 값을 다시 읽는다 (config.get)"'),
  ('>재시작함 (시연)</button>', '>다시 읽기</button>')],
 'components':[('tree-home (Master가 정함)', '상위 tree (Master가 정함)')]
}
for src,name,title,dofit,desc in screens:
    s=open(SRC+src+'.dc.html').read()
    body=s.split('<x-dc>')[1].split('</x-dc>')[0]
    m=re.search(r'<helmet>(.*?)</helmet>',body,re.S)
    helmet=m.group(1) if m else ''
    # 외부 글꼴(구글 폰트)은 싣지 않는다. Terra 안(terra.web/frame)에서는 앱 자산 CSP의 style-src · font-src 'self'가
    # 막아 콘솔 오류와 헛요청만 남는다. 글꼴 스택이 Noto Sans KR → 시스템 글꼴로 이어지므로 화면은 그대로 선다.
    helmet=re.sub(r'\s*<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>','',helmet)
    tpl=re.sub(r'<helmet>.*?</helmet>','',body,flags=re.S).strip()
    js=s.split('data-dc-script')[1].split('>',1)[1].split('</script>')[0].strip()
    props=json.loads(re.search(r"data-props='([^']*)'",s).group(1))
    W,H=props['$preview']['width'],props['$preview']['height']
    defaults={k:v.get('default') for k,v in props.items() if not k.startswith('$') and isinstance(v,dict) and 'default' in v}
    for a,b in links.items(): tpl=tpl.replace(a,b); js=js.replace(a,b)
    for old,new in TEMPLATE_PATCHES.get(name,[]):
        n=tpl.count(old)
        if n!=1: sys.exit(f'{src}.dc.html: 템플릿 패치 대상이 {n}번 있다 — tools/gen-pages.py TEMPLATE_PATCHES 를 원본에 맞춰 고친다: {old[:60]!r}')
        tpl=tpl.replace(old,new)
    assert '</script' not in tpl
    open(OUT+f'src/screens/{name}.js','w').write(
        f"// {title} — 디자인 캔버스 원본 design/{src}.dc.html 에서 옮긴 화면 로직 (tools/gen-pages.py로 다시 만든다)\n// 데이터 연동 지점은 docs/api/frontend-api.md 참고\nimport {{ DCLogic }} from '../runtime/dc.js';\n\n"+
        js.replace('class Component extends DCLogic','export default class Component extends DCLogic',1)+'\n')
    stage_css = f"#stage{{width:{W}px;height:{H}px}}" if not dofit else f".frame{{margin:12px auto;overflow:hidden;box-shadow:0 6px 24px rgba(22,25,31,0.16);border-radius:6px}}\n#stage{{width:{W}px;height:{H}px;transform-origin:0 0;background:#ffffff}}"
    stage_html = '<div id="stage"></div>' if not dofit else '<div class="frame"><div id="stage"></div></div>'
    real_imp = ("import { %s } from '%s';   // 실데이터 층 — 이 노드의 게이트웨이에서 읽은 값만 보인다\n" % (REAL[name][1], REAL[name][0])) if name in REAL else ''
    page=f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terra · {title}</title>
{helmet.strip()}
<style>
html,body{{margin:0;background:#dfe3ea}}
{stage_css}
</style>
</head>
<body>
{stage_html}
<script type="text/x-template" id="view">
{tpl}
</script>
<script type="module">
import './src/api/frame-boot.js';   // 첫 import — Terra 안이면 마운트보다 먼저 frame에 hello를 보낸다
import {{ mount, fit }} from './src/runtime/dc.js';
import Screen from './src/screens/{name}.js';
{real_imp}const stage = document.getElementById('stage');
window.__screen = mount({(REAL[name][1]+'(Screen)') if name in REAL else 'Screen'}, {{ template: document.getElementById('view').textContent, target: stage, props: {json.dumps(defaults, ensure_ascii=False)} }});
{'fit(stage, %d, %d);' % (W, H) if dofit else ''}
{"import('./src/api/wire.js').then((m) => m.wireFromUrl(window.__screen));   // Terra 안이면 frame 토큰으로 이 노드의 게이트웨이에 연결" if name=='node' else ''}
</script>
</body>
</html>
'''
    open(OUT+name+'.html','w').write(page)
PAGES=[{'page':n+'.html','title':t,'desc':d,'src':s} for s,n,t,f,d in screens]
os.makedirs(OUT+'public',exist_ok=True)
for f in ('tools/pages.json','public/pages.json'): json.dump(PAGES, open(OUT+f,'w'), ensure_ascii=False, indent=2)
print('ok', len(screens))
