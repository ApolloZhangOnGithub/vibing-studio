#!/bin/zsh
# 跑一个测试：tools/run-test.sh name.js [额外 env...]
# 测试用的 App（bundle id 带 .dev，和装着的那份互不干扰）：DEV=1 APP_DIR="$HOME/Library/Developer/Vibing Studio Test" tools/build-app.sh；页面从本地开发服务器（teyvat-mac-simulator 里 node dev/run.mjs --port 8787）载入
js="$PWD/$1"; shift # 测试脚本在当前目录；结果写在它旁边（同名 .json）
open -g -n -W --env NADOS_TESTJS="$js" --env NADOS_SELFTEST_WAIT=1 "$@" "${VS_TEST_APP:-$HOME/Library/Developer/Vibing Studio Test/Vibing Studio.app}" --args --url "http://localhost:8787/auth/login?dev=2&next=/terminal.html"
cat "${js%.js}.json" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get("page"), ensure_ascii=False, indent=1)[:6000])'
