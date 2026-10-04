#!/usr/bin/env python3
# design/*.dc.html (디자인 캔버스 원본) → 화면 페이지(*.html) + src/screens/*.js 를 다시 만든다.
# 사용: npm run gen   (= python3 tools/gen-pages.py)  — Linux · Windows(py tools\gen-pages.py) · macOS 같은 명령
#   변형(variant)은 public/config.json 의 "variant" 를 따른다. 이 모듈의 변형은 module 하나다:
#     module = Terra 안(terra.web/frame)에서 도는 배포용 — 예시 데이터를 지우고 이 노드의 게이트웨이 값만 보인다
#   짝 프로젝트 terra-node-gui(service) · terra-node-gui-demo(demo)와 같은 원본 · 같은 생성 규칙이다.
#   다른 것은 부트 프로필(src/boot/module.js)과 아래 MODULE_TPL 패치, 첫 import(frame-boot) 셋뿐이다 — docs/guides/module-profile.md
# 원본을 고친 뒤 실행한다. src/screens/*.js 는 덮어쓰인다 (손으로 고치지 말고 src/boot/module.js · src/data/*.js 에서 바꿔 끼운다).
import re, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'design') + '/'
OUT = ROOT + '/'
cfg = json.load(open(OUT + 'public/config.json', encoding='utf-8'))
VARIANT = sys.argv[1] if len(sys.argv) > 1 else cfg.get('variant', 'module')
if VARIANT != 'module':
    sys.exit(f'[gen] 이 모듈은 module 변형만 만든다 (받은 값: {VARIANT}) — service · demo 는 짝 프로젝트에서 만든다')
os.makedirs(OUT + 'src/screens', exist_ok=True)

# (원본, 페이지, 제목, 맞춤, 설명, 변형) — 맞춤: self = 화면이 스스로 창에 맞춤 · fit = 카드로 줄여 보임 · full = 창 가운데 꽉 차게
#   · viewport = 무대를 창 그대로(줄이지 않음) — 루트가 스스로 100vw × 100vh 인 화면
# 변형 all = 모든 변형 · demo = 디자인 노트(예시 데이터 시안)라 모듈에는 싣지 않는다
screens = [
    ('Intro', 'index', '시작', 'viewport', '시작 화면 — Terra 로그인(비밀번호는 Terra가 받는다) · 노드 화면으로 내려가기', 'all'),
    ('Artboard-qcfu', 'node', '노드 화면', 'self', '육각 필드 맵 · 관리 노드 창 · 조타륜 · 오버헤드 패널 · 노드 자원 · 연결 · 도로', 'all'),
    ('BuildingEditor', 'building', '건물 편집기', 'fit', '블록 설계 · 이벤트(동작 · 대기 · 정지 · 실패 · 사용자) · 노드 화면으로 내보내기', 'all'),
    ('RoadEditor', 'road', '도로 편집기', 'fit', '팔(1/6 정삼각형) · 합류 · 화소 48 · 상태 · 방향 이벤트', 'all'),
    ('MaterialEditor', 'material', '자재 편집기', 'fit', '6면 8×8 픽셀 자재 · 8×8×8 커스텀 복셀 자재 · 애니메이션', 'all'),
    ('FieldEditor', 'field', '필드 편집기', 'fit', '타일 스킨 — 테두리 · 윗면 · 옆면 띠', 'all'),
    ('GroundEditor', 'ground', '그라운드 편집기', 'fit', '높이 0 바닥 무늬', 'all'),
    ('Network', 'network', '네트워크', 'fit', 'mesh · 진단 · 터널 · WireGuard', 'all'),
    ('Settings', 'settings', '설정', 'fit', 'GUI · 계정 · 로컬 노드 · 클러스터 설정', 'all'),
    ('Components', 'components', '공통 부품 (디자인 노트)', 'fit', '버튼 · 칩 · 배지 등 공통 부품', 'demo'),
    ('Helm', 'helm', '조타륜 (디자인 노트)', 'fit', '조타륜 단독 시안', 'demo'),
    ('HelmApps', 'helm-apps', '조타륜 앱 노트 (디자인 노트)', 'fit', '조타륜 앱별 자원 · 동작 노트', 'demo'),
]
ALL = screens
screens = [s for s in ALL if s[5] in ('all', VARIANT)]
links = {f'{a}.dc.html': f'{b}.html' for a, b, *_ in screens}
BOOT_NAME = {'index': 'intro'}   # 부트 프로필이 받는 화면 이름 (페이지 이름과 다른 것만)

# ── 모듈 변형에서 원본 글을 바꾸는 곳 — 원본이 바뀌어 못 찾으면 멈춘다(조용히 예시가 남지 않게) ──
SIMUL_SWITCHES_NET = '''    <span style="font-size: 11.5px; color: #8b95a6;">시연</span>
    <div role="group" aria-label="GUI를 연 노드 (시연)" style="display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: #eef1f5;">
      <sc-for list="{{hdr.roles}}" as="ro" hint-placeholder-count="2">
        <button type="button" aria-pressed="{{ro.on}}" onClick="{{ro.pick}}" style="height: 26px; padding: 0 10px; border: 0; border-radius: 7px; background: {{ro.bg}}; color: {{ro.fg}}; box-shadow: {{ro.sh}}; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;">{{ro.label}}</button>
      </sc-for>
    </div>
'''
DEMO_SELECT = '''    <select aria-label="상태 시연" onChange="{{hdr.setDemo}}" style="height: 30px; padding: 0 8px; border: 1px solid #d8dde5; border-radius: 6px; background: #ffffff; font: inherit; font-size: 12px; color: #16191f;">
      <sc-for list="{{hdr.demos}}" as="dm" hint-placeholder-count="4">
        <option value="{{dm.v}}" selected="{{dm.sel}}">{{dm.label}}</option>
      </sc-for>
    </select>
    <span style="font-size: 12px; font-weight: 600; color: #a65f00; border: 1px solid #a65f00; border-radius: 4px; padding: 1px 6px;">예시 데이터</span>
'''
# 시작 화면의 입력 판 — 모듈에서는 웹이 비밀번호를 받지 않는다(웹 프로그램 감싸기 설계 §3.3.1).
# 아이디 · 비밀번호 칸과 자동 로그인 스위치 자리에 Terra 로그인 단추와 지금 세션 줄을 둔다 → src/boot/module.js prep('intro')
INTRO_FORM_START = '<sc-if value="{{v.form}}" hint-placeholder-val="{{true}}">'
INTRO_FORM_END = '\n      </sc-if>\n\n      <!-- 자동 로그인 중 · 로그인됨 -->'
INTRO_FORM_MODULE = '''<sc-if value="{{v.form}}" hint-placeholder-val="{{true}}">
        <!-- 모듈: 비밀번호는 Terra가 받는다. 이 판은 Terra 로그인 카드를 부르고(terra.emit('login')) 세션이 생기면 내려간다 -->
        <div data-in-terra="1" style="display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid #d8dde5; border-radius: 12px; background: #ffffff;">
          <span style="display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 700; color: #16191f;"><span style="width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: {{v.whoDot}};"></span>{{v.whoTitle}}</span>
          <span style="font-size: 12px; color: #5b6472; line-height: 1.5;">{{v.whoSub}}</span>
        </div>

        <span data-in-msg="1" style="min-height: 18px; font-size: 12px; font-weight: 600; color: {{v.msgC}};">{{v.msg}}</span>

        <button type="button" data-in-go="1" onClick="{{v.submit}}" class="in-btn" style="height: 48px; border: 0; border-radius: 12px; background: #16191f; color: #ffffff; font: inherit; font-size: 15px; font-weight: 800; letter-spacing: 0.02em; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;">
          <sc-if value="{{v.busy}}" hint-placeholder-val="{{false}}"><span aria-hidden="true" style="width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.35); border-top-color: #ffffff; animation: in-spin 700ms linear infinite;"></span></sc-if>
          {{v.goLabel}}
        </button>
        <span style="font-size: 11px; color: #8b95a6; text-align: center;">{{v.goNote}}</span>'''
MODULE_TPL = {
    'node': [
        ('<span style="color: #1f7a4d; font-size: 10px;">●</span>\n        <span style="font-weight: 700;">admin</span>\n        <span style="color: #5b6472; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; min-width: 0;">만료 21:40 · 권한: 모듈 관리 · 노드 조회</span>',
         '<span style="color: {{who.dotC}}; font-size: 10px;">●</span>\n        <span style="font-weight: 700;">{{who.name}}</span>\n        <span title="{{who.sub}}" style="color: #5b6472; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; min-width: 0;">{{who.sub}}</span>'),
        ('\n        <span style="font-size: 11px; font-weight: 700; color: #a65f00; border: 1px solid #a65f00; border-radius: 4px; padding: 0 5px; line-height: 16px;">예시 데이터</span>', ''),
        ('{{leafResCount}}개 · 예시', '{{leafResCount}}개'),
        # 전체 화면 보드: src 대신 data-board — Terra 안에서 src 탐색은 frame-ancestors 에 막힌다. src/api/frame-boards.js 가 srcdoc(밖은 src)으로 연다
        ('<iframe class="win-fs-full" src="{{w.href}}"', '<iframe class="win-fs-full" data-board="{{w.href}}"'),
    ],
    'network': [
        ('이 보드는 머리의 "열린 곳" 전환으로 tree GUI · leaf GUI를 둘 다 보여 준다. 데이터는 전부 예시 -->', '역할(tree · leaf)은 카탈로그로 정하고, 데이터는 이 노드의 게이트웨이에서 읽는다(src/data/network-live.js) -->'),
        (SIMUL_SWITCHES_NET + DEMO_SELECT, ''),
        ('<div>권한 <span class="mono">node.read</span> · <span class="mono">node.control</span> ✓</div>', '<div>{{sess.perm}}</div>'),
    ],
    'settings': [
        ('데이터는 예시 -->', '데이터는 이 노드의 게이트웨이에서 읽는다(src/data/settings-live.js) -->'),
        (SIMUL_SWITCHES_NET, ''),
        ('<button type="button" onClick="{{hdr.togglePerm}}" aria-pressed="{{hdr.permOn}}" title="node.config★는 기본 권한 밖 — 관리자도 명시해야 열린다" style="height: 30px; padding: 0 10px; border: 1px solid {{hdr.permLine}}; border-radius: 6px; background: {{hdr.permBg}}; color: {{hdr.permFg}}; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;">{{hdr.permLabel}}</button>',
         '<span title="node.config★는 기본 권한 밖 — 관리자도 명시해야 열린다" style="display: inline-flex; align-items: center; height: 30px; box-sizing: border-box; padding: 0 10px; border: 1px solid {{hdr.permLine}}; border-radius: 6px; background: {{hdr.permBg}}; color: {{hdr.permFg}}; font-size: 12px; font-weight: 600;">{{hdr.permLabel}}</span>'),
        ('\n' + DEMO_SELECT.rstrip('\n'), ''),
        ('title="시연: 재시작을 마친 것으로"', 'title="Daemon을 재시작한 뒤 실행 중인 값을 다시 읽는다 (config.get)"'),
        ('>재시작함 (시연)</button>', '>다시 읽기</button>'),
    ],
    'index': [
        # 노드 화면 미리 읽기: src 대신 data-src — Terra 안에서는 중첩 iframe 이 frame-ancestors 에 막혀 boot 가 srcdoc 으로 넣는다
        ('<iframe data-in-map="1" src="node.html"', '<iframe data-in-map="1" data-src="node.html"'),
        ('>다른 계정으로 · 자동 로그인 끄기</button>', '>다른 계정으로 로그인</button>'),
        ('>취소 — 직접 로그인</button>', '>취소 — 여기 머물기</button>'),
        ('<span>v0.2</span><span style="opacity: 0.6;">·</span><span style="color: #ffd479; font-weight: 700;">예시 데이터</span>',
         '<span>Terra 노드</span><span style="opacity: 0.6;">·</span><span style="font-weight: 700;">{{v.where}}</span>'),
        # 아래 두 알약(게이트웨이 · 꼬리말)은 내려갈 때 opacity 0 으로 사라지지만 누름은 그대로 받는다 — 모듈은 내려간 뒤에도
        # 이 문서 안에 노드 화면(iframe)을 둬서, 그 알약이 노드 화면 왼쪽 · 오른쪽 아래의 누름을 가로챈다(폼 저장 단추 등). 누름도 끈다
        ('z-index: 3; opacity: {{v.chromeOp}}; transition: opacity 400ms; left: 20px; bottom: 16px;',
         'z-index: 3; opacity: {{v.chromeOp}}; pointer-events: {{v.chromePe}}; transition: opacity 400ms; left: 20px; bottom: 16px;'),
        ('z-index: 3; opacity: {{v.chromeOp}}; transition: opacity 400ms; right: 20px; bottom: 16px;',
         'z-index: 3; opacity: {{v.chromeOp}}; pointer-events: {{v.chromePe}}; transition: opacity 400ms; right: 20px; bottom: 16px;'),
    ],
}
MODULE_BETWEEN = {
    # (시작 표지, 끝 표지, 바꿀 글) — 시작 ~ 끝 앞까지를 통째로 바꾼다. 둘 다 정확히 한 번 있어야 한다
    'index': [(INTRO_FORM_START, INTRO_FORM_END, INTRO_FORM_MODULE)],
}


def patch(text, pairs, where):
    for a, b in pairs:
        n = text.count(a)
        if n != 1:
            sys.exit(f'[gen] {where}: 바꿀 글을 {n}번 찾음 (1번이어야 함) — tools/gen-pages.py MODULE_TPL 을 원본에 맞춘다: {a[:70]!r}…')
        text = text.replace(a, b)
    return text


def patch_between(text, items, where):
    for start, end, new in items:
        i, j = text.count(start), text.count(end)
        if i != 1 or j != 1:
            sys.exit(f'[gen] {where}: 바꿀 구간의 표지를 시작 {i}번 · 끝 {j}번 찾음 (1번씩이어야 함) — MODULE_BETWEEN 을 원본에 맞춘다')
        a = text.index(start)
        b = text.index(end)
        if b < a:
            sys.exit(f'[gen] {where}: 바꿀 구간의 끝이 시작보다 앞에 있다')
        text = text[:a] + new + text[b:]
    return text


for src, name, title, mode, desc, _ in screens:
    s = open(SRC + src + '.dc.html', encoding='utf-8').read()
    body = s.split('<x-dc>')[1].split('</x-dc>')[0]
    m = re.search(r'<helmet>(.*?)</helmet>', body, re.S)
    helmet = m.group(1) if m else ''
    # 외부 글꼴(구글 폰트)은 싣지 않는다. Terra 안(terra.web/frame)에서는 앱 자산 CSP의 style-src · font-src 'self'가
    # 막아 콘솔 오류와 헛요청만 남는다. 글꼴 스택이 Noto Sans KR → 시스템 글꼴로 이어지므로 화면은 그대로 선다.
    helmet = re.sub(r'\s*<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>', '', helmet)
    tpl = re.sub(r'<helmet>.*?</helmet>', '', body, flags=re.S).strip()
    js = s.split('data-dc-script')[1].split('>', 1)[1].split('</script>')[0].strip()
    props = json.loads(re.search(r"data-props='([^']*)'", s).group(1))
    W, H = props['$preview']['width'], props['$preview']['height']
    defaults = {k: v.get('default') for k, v in props.items() if not k.startswith('$') and isinstance(v, dict) and 'default' in v}
    for a, b in links.items():
        tpl = tpl.replace(a, b); js = js.replace(a, b)
    tpl = patch_between(tpl, MODULE_BETWEEN.get(name, []), name + ' 템플릿')
    tpl = patch(tpl, MODULE_TPL.get(name, []), name + ' 템플릿')
    assert '</script' not in tpl
    open(OUT + f'src/screens/{name}.js', 'w', encoding='utf-8').write(
        f"// {title} — 디자인 캔버스 원본 design/{src}.dc.html 에서 옮긴 화면 로직 ({VARIANT} 변형 · tools/gen-pages.py로 다시 만든다)\n"
        f"// 데이터를 바꿔 끼우는 곳은 src/boot/{VARIANT}.js · src/data/*.js — 이 파일은 손으로 고치지 않는다\nimport {{ DCLogic }} from '../runtime/dc.js';\n\n" +
        js.replace('class Component extends DCLogic', 'export default class Component extends DCLogic', 1) + '\n')
    if mode == 'self':
        # 노드 화면은 창 크기를 따라 늘고 준다(fitScreen → scr → lay). 무대를 미리보기 크기(1447×945)로 박아 두면
        # fitScreen 이 html · body 에 건 overflow:hidden 때문에 body 가 무대 높이에서 화면을 자른다 — 창이 945보다 높으면
        # 아래 테이블이 잘리고 회색 띠가 남는다(짝 프로젝트도 같다 — 원본에 올릴 것). 무대를 창 크기로 둔다
        css, html = "html,body{height:100%}\n#stage{width:100vw;height:100vh}", '<div id="stage"></div>'
    elif mode == 'viewport':
        # 시작 화면의 루트는 스스로 100vw × 100vh 다. full 로 무대를 한 번 더 키우면 창 비율이 1447:945 가 아닐 때
        # 루트가 무대 밖으로 넘쳐 잘리고, 그 안에 미리 읽은 노드 화면도 같이 잘린다(짝 프로젝트의 full 맞춤 — 원본에 올릴 것)
        css = "html,body{height:100%;overflow:hidden;background:#a9dbf7}\n#stage{position:fixed;left:0;top:0;width:100vw;height:100vh}"
        html = '<div id="stage"></div>'
    elif mode == 'full':
        css = (f"html,body{{height:100%;overflow:hidden;background:#bfe0f2}}\n.frame{{position:absolute;left:50%;top:50%;overflow:hidden}}\n"
               f"#stage{{width:{W}px;height:{H}px;transform-origin:0 0}}")
        html = '<div class="frame"><div id="stage"></div></div>'
    else:
        css = (f".frame{{margin:12px auto;overflow:hidden;box-shadow:0 6px 24px rgba(22,25,31,0.16);border-radius:6px}}\n"
               f"#stage{{width:{W}px;height:{H}px;transform-origin:0 0;background:#ffffff}}")
        html = '<div class="frame"><div id="stage"></div></div>'
    fit_js = ''
    if mode == 'fit':
        fit_js = f'fit(stage, {W}, {H});'
    elif mode == 'full':
        fit_js = (f"const fr = stage.parentElement, cover = () => {{ const k = Math.min(innerWidth / {W}, innerHeight / {H}); stage.style.transform = 'scale(' + k + ')'; "
                  f"fr.style.width = {W} * k + 'px'; fr.style.height = {H} * k + 'px'; fr.style.marginLeft = -{W} * k / 2 + 'px'; fr.style.marginTop = -{H} * k / 2 + 'px'; }}; cover(); addEventListener('resize', cover);")
    boot = BOOT_NAME.get(name, name)
    page = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terra · {title}</title>
{helmet.strip()}
<style>
html,body{{margin:0;background:#dfe3ea}}
{css}
</style>
</head>
<body>
{html}
<script type="text/x-template" id="view">
{tpl}
</script>
<script type="module">
import './src/api/frame-boot.js';   // 첫 import — Terra 안이면 마운트보다 먼저 frame에 hello를 보낸다
import {{ mount, fit }} from './src/runtime/dc.js';
import Screen from './src/screens/{name}.js';
import * as Boot from './src/boot/{VARIANT}.js';
const stage = document.getElementById('stage');
const View = (Boot.prep && Boot.prep('{boot}', Screen)) || Screen;   // 프로필이 예시를 지운 클래스를 돌려주면 그것을 띄운다
window.__screen = mount(View, {{ template: document.getElementById('view').textContent, target: stage, props: {json.dumps(defaults, ensure_ascii=False)} }});
{fit_js}
Boot.boot && Boot.boot('{boot}', window.__screen);
</script>
</body>
</html>
'''
    open(OUT + name + '.html', 'w', encoding='utf-8').write(page)

PAGES = [{'page': n + '.html', 'title': t, 'desc': d, 'src': s} for s, n, t, f, d, _ in screens]
for f in ('tools/pages.json', 'public/pages.json'):
    json.dump(PAGES, open(OUT + f, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
# 원본 그림(로고)은 public/assets 로 옮기지 않는다 — 화면은 로고를 data URL 로 품고 있어 쓰는 곳이 없다(포장에 군더더기만 남는다)
# 이 변형에 없는 페이지(디자인 노트)는 앞 판이 만든 것이 남아 있으면 지운다 — 빌드 입력 · 포장에 섞이지 않게
for _, n, *_ in [x for x in ALL if x not in screens]:
    for stale in (OUT + n + '.html', OUT + 'src/screens/' + n + '.js'):
        if os.path.exists(stale):
            os.remove(stale)
print('ok', VARIANT, len(screens), 'pages')
