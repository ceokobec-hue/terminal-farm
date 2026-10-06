#!/bin/zsh
# 터미널 농장 끄기: 이 폴더의 서버(포트 5274)만 끈다.
PORT="${PORT:-5274}"
for pid in $(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null); do
  case "$(ps -o command= -p "$pid")" in
    *server/serve.mjs*|*vite*) kill "$pid" && echo "껐습니다 (pid $pid)" ;;
    *) echo "포트 $PORT 를 다른 프로그램이 쓰고 있어 건드리지 않았습니다 (pid $pid)" ;;
  esac
done
