# 창 보드(설정 창 · 상태 창 · 스타메이커 · 자원 창 · 자원 상태 창 · Tree 로그인 창)을 parts/<보드>/ 의 markup.html · style.css · script.js 로 다시 굽는다.
#   python3 build_parts.py            — 셋 다
#   python3 build_parts.py nodeconf   — 하나만
# 보드의 나머지(머리 · 글꼴 · data-props)는 그대로 두고, 세 조각이 들어가는 자리만 바꾼다:
#   style  — 보드 <style> 안에서 style.css 의 첫 줄부터 </style> 앞까지 (앞의 @font-face 는 남긴다)
#   markup — 루트 요소(START)부터 </x-dc>(있으면) 또는 <script type="text/x-dc" 앞까지
#   script — <script type="text/x-dc" …> 안 전부
import os, sys
d = os.path.dirname(os.path.abspath(__file__)) + '/'
BOARDS = {
    'nodeconf':   ('NodeConf.dc.html',   '<div class="nc"'),
    'nodestatus': ('NodeStatus.dc.html', '<div class="ns"'),
    'starmaker':  ('StarMaker.dc.html',  '<div data-smroot="1"'),
    'nodeshare':  ('NodeShare.dc.html',  '<div class="sh"'),
    'resstatus':  ('ResStatus.dc.html',  '<div class="ns'),
    'treelogin':  ('TreeLogin.dc.html',  '<div class="tl'),
}

def build(key):
    board, start = BOARDS[key]
    path = d + '../' + board
    h = open(path, encoding='utf-8').read()
    part = lambda n: open(d + 'parts/' + key + '/' + n, encoding='utf-8').read()
    css, markup, script = part('style.css'), part('markup.html'), part('script.js')
    a = h.index('<style>') + len('<style>'); e = h.index('</style>', a)
    first = css.strip().split('\n', 1)[0]
    k = h.find(first, a, e)
    h = h[:(k if k >= 0 else a)] + ('' if k >= 0 else '\n') + css.rstrip('\n') + '\n' + h[e:]
    i = h.index(start); j = h.index('<script type="text/x-dc"')
    x = h.rfind('</x-dc>', i, j)   # 보드가 <x-dc> 로 감싸여 있으면 그 닫는 꼬리는 남긴다
    if x >= 0: j = x
    h = h[:i] + markup.rstrip() + '\n' + h[j:]
    i = h.index('>', h.index('<script type="text/x-dc"')) + 1; j = h.rindex('</script>')
    h = h[:i] + '\n' + script.rstrip('\n') + '\n' + h[j:]
    open(path, 'w', encoding='utf-8').write(h)
    print('built', board)

for key in (sys.argv[1:] or BOARDS):
    build(key)
