#!/usr/bin/env bash
# 진짜 tree 스택(도커 없이) — Master 1(자기 게이트웨이를 앞에 둔다) + Daemon 2 + 설치된 node-gui 모듈 + 이 앱의 토큰.
# live-tree.mjs 가 이 위에서 돈다. leaf 스택(live-stack-up.sh)과 다른 점: 게이트웨이가 Master 계약을 provider 로 앞세우고(--provider terra.master=…
# --provider-forward-auth), 앱 토큰은 **세션 id 위임 입구**(Terra ADR-GW-003 · 004)로 operation id 를 부른다. 틀은 Terra 의
# products/common/tests/remote-invocation-integration/delegated_session_e2e_test.go 를 따른다. 설명과 결과: docs/api/real-data-layer.md §5.11
#
#   tools/live-tree-up.sh <Terra 체크아웃> <작업 폴더>       # 바이너리 빌드(Go 1.25, 툴체인 자동) + 기동
#   tools/live-tree-up.sh --down <작업 폴더>                 # 내리기
#
# TREE_NODE_CONFIG=1 tools/live-tree-up.sh … — 사용자와 설치본 module.json(작업 폴더 안의 사본)의 앱 권한에 node.config 를 더한다: 중계 선언 쓰기가 열리는 변형(§5.11)
# 끝나면 <작업 폴더>/env.sh — `. <작업 폴더>/env.sh && node tools/live-tree.mjs`.
# 포트는 leaf 스택과 겹치지 않는다(Master 38080 · 게이트웨이 38787 · Daemon 38321 · 38322).
set -euo pipefail

if [ "${1:-}" = "--down" ]; then
  W="$(cd "${2:?작업 폴더}" && pwd)"
  for f in "$W"/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; done   # leaf 스택의 프로세스는 건드리지 않는다(pkill -x 를 쓰지 않는다)
  echo "내렸다 — $W"; exit 0
fi

TERRA="$(cd "${1:?Terra 체크아웃}" && pwd)"
W="$(mkdir -p "${2:?작업 폴더}" && cd "$2" && pwd)"
APP_ID="lab.stellaxia.node-gui.web"
MODDIR="$(cd "$(dirname "$0")/../.." && pwd)"          # common/lab.stellaxia.node-gui
M=http://127.0.0.1:38080; GW=http://127.0.0.1:38787
PW=hunter2hunter2; EMAIL=admin@example.com
export GOTOOLCHAIN=auto
FILES="$W.files"   # 작업 폴더 **바깥** — Daemon 의 svi.runtime 울타리가 자기 디렉터리 안의 경로를 거절한다(SVI_DECLARATION_OUTSIDE_ENVELOPE)
B="$W/bin"; mkdir -p "$B" "$W/master" "$W/d1" "$W/d2" "$FILES" "$W/prov/contracts/api" "$W/scene/lab.stellaxia.node-gui/ui" "$W/scene/lab.stellaxia.node-gui/scene"

echo "== 빌드"
[ -x "$B/terra-master" ]  || (cd "$TERRA/products/tree/master" && go build -o "$B/terra-master" ./cmd/terra-master)
[ -x "$B/terra-daemon" ]  || (cd "$TERRA/products/leaf/daemon" && go build -o "$B/terra-daemon" ./cmd/terra-daemon)
[ -x "$B/terra-gateway" ] || (cd "$TERRA/products/common/apps/terra-gateway-service" && go build -o "$B/terra-gateway" ./cmd/terra-gateway)

echo "== Master"
cat > "$W/master.json" <<E
{"http_addr":"127.0.0.1:38080","data_dir":"$W/master","database_url":"sqlite://$W/master/master.db","jwt_secret":"live-stack-secret","log_level":"warn","bootstrap_email":"$EMAIL","bootstrap_password":"$PW","bootstrap_user_type":"master_admin","service_credential":"live-stack-core-peer"}
E
nohup "$B/terra-master" --config "$W/master.json" > "$W/master.log" 2>&1 & echo $! > "$W/master.pid"
for i in $(seq 1 30); do curl -sf "$M/api/v1/health" >/dev/null && break; sleep 1; done
printf '%s' "$PW" > "$W/pw"; chmod 600 "$W/pw"

daemon() {  # 이름 · 로컬 API 포트
  local d="$W/$1"
  python3 - "$d" "$1" "$2" "$FILES" <<'E'
import json,sys
d,name,port,files=sys.argv[1:5]
json.dump({"daemon":{"device_name":"live-"+name,"data_dir":d,"environment":"dev"},
 "master":{"url":"http://127.0.0.1:38080","reconnect":True,"reconnect_initial_delay_ms":1000,"reconnect_max_delay_ms":30000,"request_timeout_sec":15},
 "heartbeat":{"interval_sec":10,"timeout_sec":5},"logging":{"level":"warn","file_enabled":False},
 "security":{"device_token_path":d+"/device_token","require_tls":False},
 "storage":{"data_dir":d,"cache_dir":d+"/cache","temp_dir":d+"/tmp"},
 "enrollment":{"enabled":True,"state_path":d+"/registration.json"},
 "gateway_service":{"enabled":False},"modules":{"enabled":False},
 "svi":{"runtime":{"file_roots":[files]}},
 "local_api":{"enabled":True,"bind_host":"127.0.0.1","port":int(port),"auth_token_path":d+"/local_api_token","require_auth":True}},
 open(d+".json","w"))
E
  nohup "$B/terra-daemon" --config "$d.json" --enroll-email "$EMAIL" --enroll-password-file "$W/pw" --enroll-name "live-$1" > "$d.log" 2>&1 & echo $! > "$W/$1.pid"
}
echo "== Daemon 둘"
daemon d1 38321; sleep 6; daemon d2 38322
for i in $(seq 1 30); do [ -s "$W/d1/registration.json" ] && [ -s "$W/d2/registration.json" ] && break; sleep 1; done

NC=""; [ -n "${TREE_NODE_CONFIG:-}" ] && NC=",\"node.config\""
echo "== 관리자 권한 · 토큰"
LOGIN() { curl -s -X POST "$M/api/v1/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}"; }
UID_=$(LOGIN | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["user"]["id"])')
TOK=$(LOGIN | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])')
curl -s -o /dev/null -X PATCH "$M/api/v1/admin/users/$UID_" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"permissions\":[\"node.read\",\"node.control\",\"file.read\",\"file.write\",\"process.execute\",\"module.manage\",\"session.identity\"${NC}]}"
TOK=$(LOGIN | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])')   # 권한을 준 뒤 다시 로그인

echo "== tree 게이트웨이(Master 앞 · Core-peer 자격 · forward-auth · node-gui 설치)"
N1=$(python3 -c "import json;print(json.load(open('$W/d1/registration.json'))['node_id'])")
N2=$(python3 -c "import json;print(json.load(open('$W/d2/registration.json'))['node_id'])")
CRED=live-stack-core-peer   # master.json 의 service_credential — 게이트웨이가 Core peer 로 Master 에 말한다
cp "$MODDIR/module.json" "$W/scene/lab.stellaxia.node-gui/"; echo '<html>x</html>' > "$W/scene/lab.stellaxia.node-gui/ui/index.html"
cp "$MODDIR/scene/scene.json" "$W/scene/lab.stellaxia.node-gui/scene/" 2>/dev/null || true
if [ -n "${TREE_NODE_CONFIG:-}" ]; then python3 -c 'import json,sys;p=sys.argv[1];d=json.load(open(p));d["contributions"]["gui"]["apps"][0]["permissions"].append("node.config");json.dump(d,open(p,"w"),indent=1)' "$W/scene/lab.stellaxia.node-gui/module.json"; fi
cp "$TERRA/products/tree/master/contracts/api/terra-api.json" "$W/prov/contracts/api/"   # leaf 와 다른 줄 — Master 계약이 카탈로그가 된다
nohup "$B/terra-gateway" --addr 127.0.0.1:38787 --ipc "$W/gw.sock" --master-url "$M" --master-service-credential "$CRED" \
  --provider "terra.master=$M" --provider-forward-auth terra.master --scene-root "$W/scene" "$W/prov" > "$W/gw.log" 2>&1 & echo $! > "$W/gw.pid"
for i in $(seq 1 30); do curl -sf "$GW/api/v1/health" >/dev/null && break; sleep 1; done
curl -s -X POST "$GW/api/v1/gui/apps/$APP_ID/token" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{}' \
  | python3 -c 'import sys,json;open("'"$W"'/app.tok","w").write(json.load(sys.stdin)["token"])'

echo "== 준비 기다리기(두 노드의 자원 보고 · Local API)"
for i in $(seq 1 60); do
  N=$(curl -s "$M/api/v1/svi/resources?limit=100" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json
try: print(sum(1 for r in json.load(sys.stdin)["data"]["items"] if r["kind"]=="test.stream"))
except Exception: print(0)')
  L1=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:38321/svi/declarations -H "Authorization: Bearer $(cat "$W/d1/local_api_token" 2>/dev/null)")
  [ "$N" = "2" ] && [ "$L1" = "200" ] && break; sleep 1
done
[ "$N" = "2" ] || { echo "자원 보고가 2개가 되지 않았다($N) — $W/d1.log · d2.log 를 본다" >&2; exit 1; }

cat > "$W/env.sh" <<E
export TERRA_GW=$GW
export TERRA_MASTER=$M
export TERRA_APP_TOKEN_FILE=$W/app.tok
export TERRA_ADMIN_TOKEN=$TOK
export TERRA_NODE_1=$N1
export TERRA_NODE_2=$N2
export TERRA_SRC_RES=svi.$N1.test.stream
export TERRA_PEER_NODE=$N2
export TERRA_D1_LOCAL=http://127.0.0.1:38321
export TERRA_D1_LOCAL_TOKEN_FILE=$W/d1/local_api_token
export TERRA_D2_LOCAL=http://127.0.0.1:38322
export TERRA_D2_LOCAL_TOKEN_FILE=$W/d2/local_api_token
export TERRA_FILES_DIR=$FILES
E
echo "준비됨 — . $W/env.sh"
