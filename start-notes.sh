#!/bin/sh
# Opens the notes site. Starts the server in the background first if it isn't running.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
PORT="${PORT:-6683}"

is_running() {
  node -e "require('net').connect($PORT,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
}

if ! is_running; then
  nohup node "$DIR/server.js" > "$DIR/notes-server.log" 2>&1 &
  i=0
  while [ $i -lt 20 ] && ! is_running; do sleep 0.25; i=$((i + 1)); done
fi

case "$(uname -s)" in
  # Safari doesn't resolve notes.localhost, so use plain localhost on macOS.
  Darwin) open "http://localhost:$PORT" ;;
  *) xdg-open "http://notes.localhost:$PORT" >/dev/null 2>&1 || echo "Open http://notes.localhost:$PORT in your browser." ;;
esac
