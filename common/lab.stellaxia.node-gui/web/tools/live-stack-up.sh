#!/usr/bin/env bash
# 진짜 스택(도커 없이) — Master 1 + Daemon 2(같은 사용자 · 같은 클러스터) + leaf 게이트웨이 + 이 앱의 토큰.
# live-linkio.mjs 가 이 위에서 돈다. 설명과 막혔던 곳: docs/api/real-data-layer.md §5.9 · §5.10
#
#   tools/live-stack-up.sh <Terra 체크아웃> <작업 폴더>       # 바이너리 빌드(Go 1.25, 툴체인 자동) + 기동
#   tools/live-stack-up.sh --down <작업 폴더>                 # 내리기
#
# 끝나면 <작업 폴더>/env.sh 가 생긴다 — `. <작업 폴더>/env.sh` 로 live-linkio.mjs 의 환경변수를 얻는다.
# 의도적으로 하지 않는 것: 모듈 설치(io-weave 등). 정상 바인딩(active)은 파일 싱크를 **런타임 선언**으로 올려 만든다(Daemon svi.runtime.file_roots).
set -euo pipefail

if [ "${1:-}" = "--down" ]; then
  W="$(cd "${2:?작업 폴더}" && pwd)"
  for p in terra-gateway terra-daemon terra-master; do pkill -x "$p" 2>/dev/null || true; done
  echo "내렸다 — $W"; exit 0
fi

TERRA="$(cd "${1:?Terra 체크아웃}" && pwd)"
W="$(mkdir -p "${2:?작업 폴더}" && cd "$2" && pwd)"
APP_ID="lab.stellaxia.node-gui.web"
MODDIR="$(cd "$(dirname "$0")/../.." && pwd)"          # common/lab.stellaxia.node-gui
M=http://127.0.0.1:28080; GW=http://127.0.0.1:28787
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
{"http_addr":"127.0.0.1:28080","data_dir":"$W/master","database_url":"sqlite://$W/master/master.db","jwt_secret":"live-stack-secret","log_level":"warn","bootstrap_email":"$EMAIL","bootstrap_password":"$PW","bootstrap_user_type":"master_admin","service_credential":"live-stack-core-peer"}
E
nohup "$B/terra-master" --config "$W/master.json" > "$W/master.log" 2>&1 &
for i in $(seq 1 30); do curl -sf "$M/api/v1/health" >/dev/null && break; sleep 1; done
printf '%s' "$PW" > "$W/pw"; chmod 600 "$W/pw"

daemon() {  # 이름 · 로컬 API 포트
  local d="$W/$1"
  python3 - "$d" "$1" "$2" "$FILES" <<'E'
import json,sys
d,name,port,files=sys.argv[1:5]
json.dump({"daemon":{"device_name":"live-"+name,"data_dir":d,"environment":"dev"},
 "master":{"url":"http://127.0.0.1:28080","reconnect":True,"reconnect_initial_delay_ms":1000,"reconnect_max_delay_ms":30000,"request_timeout_sec":15},
 "heartbeat":{"interval_sec":10,"timeout_sec":5},"logging":{"level":"warn","file_enabled":False},
 "security":{"device_token_path":d+"/device_token","require_tls":False},
 "storage":{"data_dir":d,"cache_dir":d+"/cache","temp_dir":d+"/tmp"},
 "enrollment":{"enabled":True,"state_path":d+"/registration.json"},
 "gateway_service":{"enabled":False},"modules":{"enabled":False},
 "svi":{"runtime":{"file_roots":[files]}},
 "local_api":{"enabled":True,"bind_host":"127.0.0.1","port":int(port),"auth_token_path":d+"/local_api_token","require_auth":True}},
 open(d+".json","w"))
E
  nohup "$B/terra-daemon" --config "$d.json" --enroll-email "$EMAIL" --enroll-password-file "$W/pw" --enroll-name "live-$1" > "$d.log" 2>&1 &
}
echo "== Daemon 둘"
daemon d1 28321; sleep 6; daemon d2 28322
for i in $(seq 1 30); do [ -s "$W/d1/registration.json" ] && [ -s "$W/d2/registration.json" ] && break; sleep 1; done

echo "== 관리자 권한 · 토큰"
LOGIN() { curl -s -X POST "$M/api/v1/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}"; }
UID_=$(LOGIN | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["user"]["id"])')
TOK=$(LOGIN | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])')
curl -s -o /dev/null -X PATCH "$M/api/v1/admin/users/$UID_" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"permissions":["node.read","node.control","file.read","file.write","process.execute","module.manage","session.identity"]}'
TOK=$(LOGIN | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])')   # 권한을 준 뒤 다시 로그인

echo "== leaf 게이트웨이(d1 의 노드 자격)"
N1=$(python3 -c "import json;print(json.load(open('$W/d1/registration.json'))['node_id'])")
N2=$(python3 -c "import json;print(json.load(open('$W/d2/registration.json'))['node_id'])")
CRED=$(curl -s -X POST "$M/api/v1/daemon/nodes/$N1/gateway-credential" -H "Authorization: Bearer $(cat "$W/d1/device_token")" -H "X-Terra-Node-Id: $N1" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["credential"])')
cp "$MODDIR/module.json" "$W/scene/lab.stellaxia.node-gui/"; echo '<html>x</html>' > "$W/scene/lab.stellaxia.node-gui/ui/index.html"
cp "$MODDIR/scene/scene.json" "$W/scene/lab.stellaxia.node-gui/scene/" 2>/dev/null || true
cp "$TERRA/products/leaf/daemon/contracts/api/terra-api.json" "$W/prov/contracts/api/"
nohup "$B/terra-gateway" --addr 127.0.0.1:28787 --ipc "$W/gw.sock" --master-url "$M" --master-service-credential "$CRED" --scene-root "$W/scene" "$W/prov" > "$W/gw.log" 2>&1 &
for i in $(seq 1 30); do curl -sf "$GW/api/v1/health" >/dev/null && break; sleep 1; done
curl -s -X POST "$GW/api/v1/gui/apps/$APP_ID/token" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{}' \
  | python3 -c 'import sys,json;open("'"$W"'/app.tok","w").write(json.load(sys.stdin)["token"])'

echo "== 준비 기다리기(두 노드의 자원 보고 · Local API)"
for i in $(seq 1 60); do
  N=$(curl -s "$M/api/v1/svi/resources?limit=100" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json
try: print(sum(1 for r in json.load(sys.stdin)["data"]["items"] if r["kind"]=="test.stream"))
except Exception: print(0)')
  L1=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:28321/svi/declarations -H "Authorization: Bearer $(cat "$W/d1/local_api_token" 2>/dev/null)")
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
export TERRA_D1_LOCAL=http://127.0.0.1:28321
export TERRA_D1_LOCAL_TOKEN_FILE=$W/d1/local_api_token
export TERRA_D2_LOCAL=http://127.0.0.1:28322
export TERRA_D2_LOCAL_TOKEN_FILE=$W/d2/local_api_token
export TERRA_FILES_DIR=$FILES
E
echo "준비됨 — . $W/env.sh"
