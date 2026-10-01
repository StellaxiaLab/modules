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
    assert '</script' not in tpl
    open(OUT+f'src/screens/{name}.js','w').write(
        f"// {title} — 디자인 캔버스 원본 design/{src}.dc.html 에서 옮긴 화면 로직 (tools/gen-pages.py로 다시 만든다)\n// 데이터 연동 지점은 docs/api/frontend-api.md 참고\nimport {{ DCLogic }} from '../runtime/dc.js';\n\n"+
        js.replace('class Component extends DCLogic','export default class Component extends DCLogic',1)+'\n')
    stage_css = f"#stage{{width:{W}px;height:{H}px}}" if not dofit else f".frame{{margin:12px auto;overflow:hidden;box-shadow:0 6px 24px rgba(22,25,31,0.16);border-radius:6px}}\n#stage{{width:{W}px;height:{H}px;transform-origin:0 0;background:#ffffff}}"
    stage_html = '<div id="stage"></div>' if not dofit else '<div class="frame"><div id="stage"></div></div>'
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
const stage = document.getElementById('stage');
window.__screen = mount(Screen, {{ template: document.getElementById('view').textContent, target: stage, props: {json.dumps(defaults, ensure_ascii=False)} }});
{'fit(stage, %d, %d);' % (W, H) if dofit else ''}
{"import('./src/api/wire.js').then((m) => m.wireFromUrl(window.__screen));   // Terra 안이면 frame 토큰으로, 밖이면 ?live=1&gw=… 일 때만 Gateway에 연결" if name=='node' else ''}
</script>
</body>
</html>
'''
    open(OUT+name+'.html','w').write(page)
PAGES=[{'page':n+'.html','title':t,'desc':d,'src':s} for s,n,t,f,d in screens]
os.makedirs(OUT+'public',exist_ok=True)
for f in ('tools/pages.json','public/pages.json'): json.dump(PAGES, open(OUT+f,'w'), ensure_ascii=False, indent=2)
print('ok', len(screens))
