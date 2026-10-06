#!/bin/zsh
# 터미널 농장 켜기: 서버가 꺼져 있으면 빌드해서 뒤에서 켜고, 브라우저로 연다.
# 바탕화면의 「터미널 농장」 앱이 이 파일을 부른다. 직접 실행해도 된다.
set -e
cd "${0:A:h}/.."
PORT="${PORT:-5274}"
URL="http://localhost:$PORT/"
up() { curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/api/harnesses" }

if ! up; then
  [ -d node_modules ] || npm install --silent
  npx vite build --logLevel error
  mkdir -p data
  # setsid: 이 스크립트를 부른 창이 닫혀도 서버는 계속 돈다.
  PORT="$PORT" /usr/bin/perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' node server/serve.mjs \
    >> data/server.log 2>&1 < /dev/null &
  for i in {1..60}; do up && break; sleep 0.25; done
fi

up || { echo "서버를 켜지 못했습니다 — data/server.log 를 보세요"; exit 1 }
open "$URL"
