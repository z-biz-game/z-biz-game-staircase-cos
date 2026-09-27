#!/usr/bin/env bash
# One-shot verification: the node suites first, then a real browser against a real server,
# driven over CDP. Everything exits with the script, including the Chrome it started in a
# temp profile.
#
# PORTS: this repo owns WEB_PORT 5212 and CDP_PORT 9353. Do NOT reuse :5180/:9340 (those are
# z-biz-game-gridlock-cos) or :5181/:9341 (z-biz-game-nine-rings-cos) — a sibling builder's
# server answers on them and the suite silently tests the wrong game. Check before running:
#   pgrep -fl remote-debugging-port ; lsof -nP -iTCP -sTCP:LISTEN | grep -E '5212|9353'
# and pass CDP_PORT=/WEB_PORT= if they are taken.
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterization saturates the cores and, with no CDP client attached, the process will not
# exit on its own. This game is 2D canvas, so plain headless Chrome is enough.
#
#   ./tools/verify.sh                       # node suites + @boot @play @routes @save @pointer
#   SCENARIOS="pointer" ./tools/verify.sh   # one browser suite while editing the view
#   SKIP_UNIT=1 ./tools/verify.sh           # browser only (what the CI browser job does)
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
CDP_PORT=${CDP_PORT:-9353}
WEB_PORT=${WEB_PORT:-5212}
BASE=${BASE_URL:-http://127.0.0.1:$WEB_PORT/}
SHOTDIR=${SHOTDIR:-/tmp/puzzle-brief/shots}
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }
mkdir -p "$SHOTDIR"

if lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -q ":$WEB_PORT "; then
  echo "something already listens on :$WEB_PORT — another repo? pass WEB_PORT=..." >&2
  exit 6
fi

UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$CDP_PORT --user-data-dir=$UDD \
  --window-size=1180,820 --no-first-run --no-default-browser-check about:blank >/tmp/stair-chrome.log 2>&1 &
CPID=$!
node "$HERE/server.cjs" $WEB_PORT >/tmp/stair-server.log 2>&1 &
SPID=$!
cleanup() {
  kill -9 $CPID $SPID 2>/dev/null
  wait $CPID 2>/dev/null
  wait $SPID 2>/dev/null
  rm -rf $UDD
}
trap cleanup EXIT
# Watchdog redirects its fds: a background subshell inherits the script's stdout, and if
# this runs inside a pipeline it would hold the write end open for the full timeout and
# stall the consumer long after the tests finished.
( sleep ${WD_TIMEOUT:-300}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools noticeably later than a warm profile, so wait on
# the endpoints rather than guessing a sleep duration.
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$CDP_PORT" >&2; exit 3; }
for i in $(seq 1 40); do
  curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS -m 2 "$BASE" >/dev/null 2>&1 || {
  echo "static server never answered on $BASE" >&2; exit 4; }

cd "$HERE"
FAILED=0

echo "=== node suites ==="
# SKIP_UNIT=1 for the browser job in CI: the suites are its own job there.
if [ -z "${SKIP_UNIT:-}" ]; then
  for f in test/*.test.mjs; do
    echo "--- $f"
    node "$f" || FAILED=1
  done
fi

export CDP_PORT
export BASE_URL=$BASE
node tools/playtest.mjs open "$BASE" | head -3
# The shell resolves a route (and for #/daily runs the generator) before it reports a state,
# so wait on window.stair rather than on a timer.
BOOT=""
for i in $(seq 1 60); do
  BOOT=$(node tools/playtest.mjs eval "window.stair?window.stair.state.id:'nope'" nonav 2>/dev/null | tr -d '\n" ')
  case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
done
echo "boot lot: $BOOT"
[ "$BOOT" = "nope" ] && { echo "window.stair never appeared at $BASE" >&2; exit 5; }

for s in ${SCENARIOS:-boot play routes save pointer}; do
  echo "=== @$s ==="
  node tools/playtest.mjs eval "@$s" nonav 2>&1 | python3 -c '
import sys, json
raw = sys.stdin.read()
start = raw.find("{")
if start < 0:
    print("NO RESULT", raw[-300:]); sys.exit(1)
depth = 0
for i in range(start, len(raw)):
    if raw[i] == "{": depth += 1
    elif raw[i] == "}":
        depth -= 1
        if depth == 0:
            try: d = json.loads(raw[start:i + 1])
            except Exception as e:
                print("BAD JSON", e, raw[start:start+200]); sys.exit(1)
            break
rows = d.get("rows", [])
print("rows:", len(rows), "fail:", len(d.get("fail") or []))
for r in rows:
    if not r["pass"]: print("  FAIL", r["test"], json.dumps(r["detail"], ensure_ascii=False)[:300])
sys.exit(1 if d.get("fail") else 0)
' || FAILED=1
  node tools/playtest.mjs shot "$SHOTDIR/stair-$s.png" >/dev/null 2>&1
done

echo "=== console ==="
node tools/playtest.mjs logs
kill $WD 2>/dev/null
wait $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
